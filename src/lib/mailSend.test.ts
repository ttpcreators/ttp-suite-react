import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHtml, cancelSend, clearSentDraft, dismissFailedSend, draftKeys, markDraftSending, parseEmails, readDraft, readDraftRaw,
  readMailSettings, replyDraftKey, restoreDraft, retryFailedSend, scheduleSend, sendErrorText, sendFailText, sendGmail,
  subscribeFailed, subscribePending, writeDraft, type FailedSend,
} from "./mailSend";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/appState", () => ({ saveAppStateKey: vi.fn() }));

/** localStorage minimal (les tests tournent sous Node). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe("mailSend", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = memoryStorage();
    invoke.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("sépare adresses valides et invalides", () => {
    expect(parseEmails("a@b.fr, C@D.com;x")).toEqual({ ok: ["a@b.fr", "c@d.com"], bad: ["x"] });
    expect(parseEmails("")).toEqual({ ok: [], bad: [] });
    expect(parseEmails('a@b.fr"<script>').bad.length).toBe(1);
  });

  it("échappe le texte et ajoute signature + contenu cité", () => {
    const html = buildHtml("<b>salut</b>", { signature: "<i>Marc</i>", quoted: "<p>orig</p>" });
    expect(html).toContain("&lt;b&gt;salut&lt;/b&gt;");
    expect(html).toContain('<div class="ttp-signature"><i>Marc</i></div>');
    expect(html).toContain('<div class="gmail_quote"><p>orig</p></div>');
    expect(buildHtml("x")).not.toContain("ttp-signature");
  });

  it("réglages : valeurs par défaut et délai borné", () => {
    expect(readMailSettings({})).toEqual({ signatureHtml: "", signatureOn: true, delaySec: 10 });
    expect(readMailSettings({ mailSettings: { delaySec: 7, signatureOn: false } }).delaySec).toBe(10);
    expect(readMailSettings({ mailSettings: { delaySec: 30, signatureOn: false } })).toMatchObject({ delaySec: 30, signatureOn: false });
  });

  it("messages d'erreur d'envoi", () => {
    expect(sendErrorText("limite_gmail")).toMatch(/Gmail limite/);
    expect(sendErrorText("pieces_trop_lourdes")).toContain("18 Mo");
    expect(sendFailText()).toBe("Envoi échoué, brouillon conservé");
    expect(sendFailText("limite_gmail")).toMatch(/Brouillon conservé\.$/);
  });

  it("envoi différé : part après le délai, annulable avant (le brouillon est rendu)", () => {
    vi.useFakeTimers();
    const g = globalThis as unknown as { window?: unknown };
    g.window = globalThis;
    const sent = vi.fn(async () => {});
    let items: { id: number }[] = [];
    const off = subscribePending((l) => (items = l));
    scheduleSend("A", 10, sent);
    expect(items.length).toBe(1);
    vi.advanceTimersByTime(9000);
    expect(sent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(items.length).toBe(0);

    const other = vi.fn(async () => {});
    const cancelled = vi.fn();
    scheduleSend("B", 5, other, { onCancel: cancelled });
    expect(cancelSend(items[0].id)).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    expect(other).not.toHaveBeenCalled();

    const now = vi.fn(async () => {});
    scheduleSend("C", 0, now);
    expect(now).toHaveBeenCalledTimes(1);
    off();
  });

  it("brouillons : gardés pendant l'envoi, rendus en cas d'échec, effacés après succès", () => {
    const key = replyDraftKey("talent", "t1");
    expect(key).toBe("reply:talent:t1");
    writeDraft(key, { at: 1, text: "Bonjour" } as never);
    expect(readDraft<{ at: number; text: string }>(key)?.text).toBe("Bonjour");
    expect(draftKeys("reply:")).toEqual([key]);

    markDraftSending(key);
    expect(readDraft(key)).toBeNull(); // pas proposé pendant l'envoi
    expect(readDraftRaw(key)).not.toBeNull(); // mais gardé
    expect(draftKeys("reply:")).toEqual([]);

    restoreDraft(key);
    expect(readDraft<{ at: number; text: string }>(key)?.text).toBe("Bonjour");

    // Réécrit après l'envoi : le succès de l'envoi précédent ne l'efface pas.
    clearSentDraft(key);
    expect(readDraft(key)).not.toBeNull();
    markDraftSending(key);
    clearSentDraft(key);
    expect(readDraftRaw(key)).toBeNull();
  });

  it("envois échoués : gardés, renvoyés, oubliés après un envoi identique réussi", async () => {
    let failed: FailedSend[] = [];
    const off = subscribeFailed((l) => (failed = l));
    for (const f of failed) dismissFailedSend(f.id);

    const params = { to: "a@b.fr", subject: "Re: Test", html: "<p>Coucou</p>", box: "partnerships" as const, threadId: "t9" };
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: "limite_gmail" }) } } });
    const r1 = await sendGmail(params, { label: "Réponse à a@b.fr" });
    expect(r1.error).toBe("limite_gmail");
    expect(failed.length).toBe(1);
    expect(failed[0]).toMatchObject({ label: "Réponse à a@b.fr", error: "limite_gmail" });
    expect(globalThis.localStorage.getItem("ttp:mail-failed")).toContain("Coucou");

    // Coupure réseau : erreur « reseau », toujours une seule entrée pour ce mail.
    invoke.mockResolvedValueOnce({ data: null, error: new Error("fetch failed") });
    const r2 = await retryFailedSend(failed[0].id);
    expect(r2.error).toBe("reseau");
    expect(failed.length).toBe(1);

    invoke.mockResolvedValueOnce({ data: { ok: true, id: "m1" }, error: null });
    const r3 = await sendGmail(params);
    expect(r3.ok).toBe(true);
    expect(failed.length).toBe(0);
    off();
  });
});

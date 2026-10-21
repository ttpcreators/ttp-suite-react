import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composerPrefill, deleteGmailDraft, draftBodyText, draftDeleteErrText, draftHtmlToText, draftPlainText, gmailDraftLocalKey,
  isReplyDraft, parseDraftsRes, parseReplyDraftKey, seedReplyDraft, type GmailDraftRow, type ReplyDraft,
} from "./mailDrafts";
import { buildHtml, readDraftRaw, replyDraftKey, writeDraft } from "./mailSend";

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

const row = (o: Partial<GmailDraftRow> = {}): GmailDraftRow => ({
  draftId: "r-1", messageId: "m1", threadId: "t1", box: "partnerships", subject: "Collab", name: "Anna", email: "anna@nike.com",
  snippet: "Bonjour", ts: 10, to: ["anna@nike.com"], cc: [], bcc: [], reply: false, inReplyTo: "", references: "", byClaude: false,
  html: "", text: "Bonjour Anna,\n\nVoici l'offre.", attachments: [], ...o,
});

describe("liste des brouillons", () => {
  it("reconnaît une ancienne version (pas d'écho du dossier)", () => {
    expect(parseDraftsRes({ ok: true, threads: [{ threadId: "x" }] })).toEqual({ kind: "old" });
    expect(parseDraftsRes({ error: "limite_gmail" })).toEqual({ kind: "error", error: "limite_gmail" });
    expect(parseDraftsRes({})).toEqual({ kind: "error", error: "erreur" });
  });
  it("nettoie et trie les lignes, ignore les invalides", () => {
    const r = parseDraftsRes({
      ok: true, folder: "drafts", partial: true, failedBoxes: ["talent", "autre"],
      threads: [
        { draftId: "r-1", box: "partnerships", subject: "A", ts: 5, to: ["a@x.fr", 3], byClaude: true },
        { draftId: "r-2", box: "talent", subject: "B", ts: 9, reply: true, threadId: "t9" },
        { draftId: "", box: "talent" },
        { draftId: "r-3", box: "ailleurs" },
        null,
      ],
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.rows.map((x) => x.draftId)).toEqual(["r-2", "r-1"]);
    expect(r.rows[1]).toMatchObject({ to: ["a@x.fr"], byClaude: true, reply: false, cc: [], attachments: [] });
    expect(r.rows[0]).toMatchObject({ reply: true, threadId: "t9", byClaude: false });
    expect(r.partial).toBe(true);
    expect(r.failedBoxes).toEqual(["talent"]);
  });
});

describe("corps d'un brouillon → texte", () => {
  it("garde les paragraphes de Gmail et retire signature et citation", () => {
    const html =
      '<div dir="ltr"><div>Bonjour Anna,</div><div><br></div><div>Voici l&#39;offre &amp; le planning.</div>' +
      '<ul><li>Un reel</li><li>Deux stories</li></ul>' +
      '<br clear="all"><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature">Marc<br>TTP</div></div>' +
      '<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">Le lun. 20 oct., Anna a écrit :<br></div><blockquote>ancien</blockquote></div>';
    expect(draftHtmlToText(html)).toBe("Bonjour Anna,\n\nVoici l'offre & le planning.\n\n• Un reel\n• Deux stories");
  });
  it("relit un corps écrit par l'app (texte préformaté + signature)", () => {
    const html = buildHtml("Bonjour,\n\nMerci <3\nÀ demain", { signature: "<b>Marc</b>" });
    expect(draftHtmlToText(html)).toBe("Bonjour,\n\nMerci <3\nÀ demain");
  });
  it("ignore les retours à la ligne du code HTML et les styles", () => {
    expect(draftHtmlToText("<style>p{color:red}</style>\n<p>Un\n  deux</p>\n<p>trois&nbsp;!</p>")).toBe("Un deux\n\ntrois !");
  });
  it("texte brut : sans signature ni citation", () => {
    expect(draftPlainText("Salut\r\n\r\nOK pour moi\r\n-- \r\nMarc")).toBe("Salut\n\nOK pour moi");
    expect(draftPlainText("Merci !\n\nLe 3 oct. 2026, Anna <a@x.fr> a écrit :\n> avant")).toBe("Merci !");
    expect(draftPlainText("Top\n> cité")).toBe("Top");
  });
  it("préfère le HTML, sinon le texte", () => {
    expect(draftBodyText({ html: "<div>Depuis HTML</div>", text: "Depuis texte" })).toBe("Depuis HTML");
    expect(draftBodyText({ html: "", text: "Depuis texte\n" })).toBe("Depuis texte");
    expect(draftBodyText({ html: '<div class="gmail_signature">sig</div>', text: "Repli" })).toBe("Repli");
  });
});

describe("ouverture d'un brouillon", () => {
  it("pré-remplit Nouveau mail avec un seul destinataire", () => {
    expect(composerPrefill(row({ to: ["a@x.fr", "b@x.fr"], cc: ["c@x.fr", "b@x.fr"], bcc: ["d@x.fr"] }))).toEqual({
      to: "a@x.fr", cc: "b@x.fr, c@x.fr", bcc: "d@x.fr", subject: "Collab", body: "Bonjour Anna,\n\nVoici l'offre.",
    });
    expect(composerPrefill(row({ to: [] })).to).toBe("");
  });
  it("distingue une réponse d'un nouveau mail", () => {
    expect(isReplyDraft(row({ reply: true }))).toBe(true);
    expect(isReplyDraft(row({ reply: true, threadId: "" }))).toBe(false);
    expect(isReplyDraft(row())).toBe(false);
  });
  it("clés locales", () => {
    expect(gmailDraftLocalKey({ box: "talent", draftId: "r-9" })).toBe("gdraft:talent:r-9");
    expect(parseReplyDraftKey(replyDraftKey("talent", "18abc"))).toEqual({ box: "talent", threadId: "18abc" });
    expect(parseReplyDraftKey("new")).toBeNull();
    expect(parseReplyDraftKey("reply:autre:1")).toBeNull();
  });
});

describe("zone de réponse pré-remplie", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  it("prépare la réponse avec le lien vers le brouillon Gmail", () => {
    const key = replyDraftKey("partnerships", "t1");
    expect(seedReplyDraft(key, row({ reply: true, to: ["a@x.fr", "b@x.fr"], cc: ["c@x.fr"] }), { subject: "Re: Collab", toLabel: "Anna" })).toBe("seeded");
    expect(readDraftRaw<ReplyDraft>(key)).toMatchObject({
      text: "Bonjour Anna,\n\nVoici l'offre.", cc: "b@x.fr, c@x.fr", bcc: "", replyAll: false,
      gdraft: { id: "r-1", box: "partnerships" }, subject: "Re: Collab", toLabel: "Anna",
    });
    // Déjà repris : les modifications sont gardées.
    writeDraft(key, { ...readDraftRaw<ReplyDraft>(key)!, text: "Modifié" });
    expect(seedReplyDraft(key, row({ reply: true }))).toBe("same");
    expect(readDraftRaw<ReplyDraft>(key)?.text).toBe("Modifié");
  });
  it("n'écrase jamais une réponse commencée sur l'appareil", () => {
    const key = replyDraftKey("talent", "t2");
    writeDraft(key, { text: "Ma réponse", cc: "", bcc: "", replyAll: false, at: 1 } satisfies ReplyDraft);
    expect(seedReplyDraft(key, row({ reply: true, box: "talent" }))).toBe("kept");
    expect(readDraftRaw<ReplyDraft>(key)?.text).toBe("Ma réponse");
    expect(seedReplyDraft(replyDraftKey("talent", "t3"), row({ html: "", text: "" }))).toBe("kept");
  });
});

describe("suppression d'un brouillon Gmail", () => {
  beforeEach(() => invoke.mockReset());
  it("confirmée seulement avec l'écho de l'action", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, action: "draft-delete" }, error: null });
    await expect(deleteGmailDraft({ id: "r-1", box: "talent" })).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("gmail-thread", expect.objectContaining({ body: { action: "draft-delete", draftId: "r-1", box: "talent" } }));
  });
  it("ancienne version, erreur Gmail, réseau", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: "action_inconnue" }) } } });
    await expect(deleteGmailDraft({ id: "r-1", box: "partnerships" })).resolves.toEqual({ ok: false, error: "ancienne_version" });
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: "limite_gmail" }) } } });
    await expect(deleteGmailDraft({ id: "r-1", box: "partnerships" })).resolves.toEqual({ ok: false, error: "limite_gmail" });
    invoke.mockRejectedValueOnce(new Error("offline"));
    await expect(deleteGmailDraft({ id: "r-1", box: "partnerships" })).resolves.toEqual({ ok: false, error: "reseau" });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(deleteGmailDraft({ id: "r-1", box: "partnerships" })).resolves.toEqual({ ok: false, error: "erreur" });
    expect(draftDeleteErrText("ancienne_version")).toMatch(/pas encore déployée/);
  });
});

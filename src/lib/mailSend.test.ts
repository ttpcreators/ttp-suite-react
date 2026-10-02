import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHtml, cancelSend, parseEmails, readMailSettings, scheduleSend, subscribePending } from "./mailSend";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/appState", () => ({ saveAppStateKey: vi.fn() }));

describe("mailSend", () => {
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

  it("envoi différé : part après le délai, annulable avant", () => {
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
    scheduleSend("B", 5, other);
    expect(cancelSend(items[0].id)).toBe(true);
    vi.advanceTimersByTime(6000);
    expect(other).not.toHaveBeenCalled();

    const now = vi.fn(async () => {});
    scheduleSend("C", 0, now);
    expect(now).toHaveBeenCalledTimes(1);
    off();
  });
});

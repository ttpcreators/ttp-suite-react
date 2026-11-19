import { describe, expect, it } from "vitest";
import { nouvelleCle, widgetScript } from "./widgetScript";
import { KEY_RE, resumeWidget } from "../../supabase/functions/_shared/widget.ts";

const CLE = "A".repeat(43);
const opts = { supabaseUrl: "https://x.supabase.co/", anonKey: "anon", cle: CLE, creeLe: new Date("2026-11-19T12:00:00Z") };

/** Faux Scriptable : juste ce que le script appelle, pour le faire tourner en vrai. */
function fauxScriptable(reponse: { code: number; body: unknown } | "panne", famille: string, cache: Record<string, string> = {}) {
  const textes: string[] = [];
  const urls: string[] = [];
  let pose: unknown = null;
  let presente = "";
  class Stack {
    url = "";
    size: unknown;
    backgroundColor: unknown;
    addText(s: string) { textes.push(s); return { centerAlignText() {}, rightAlignText() {} }; }
    addStack() { const s = new Stack(); return new Proxy(s, { set(t, k, v) { if (k === "url") urls.push(v); (t as never as Record<string, unknown>)[k as string] = v; return true; } }); }
    addSpacer() {}
    layoutVertically() {}
    centerAlignContent() {}
    topAlignContent() {}
    setPadding() {}
  }
  class ListWidget extends Stack {
    refreshAfterDate: unknown;
    async presentSmall() { presente = "small"; }
    async presentMedium() { presente = "medium"; }
    async presentLarge() { presente = "large"; }
  }
  class Request {
    headers: Record<string, string> = {};
    timeoutInterval = 0;
    response: { statusCode: number } | null = null;
    url: string;
    constructor(url: string) { this.url = url; }
    async loadJSON() {
      if (reponse === "panne") throw new Error("offline");
      this.response = { statusCode: reponse.code };
      return reponse.body;
    }
  }
  class Color { static dynamic() { return new Color(); } }
  const Font = { systemFont: () => ({}), semiboldSystemFont: () => ({}), boldRoundedSystemFont: () => ({}) };
  const FileManager = { local: () => ({
    cacheDirectory: () => "/c", joinPath: (a: string, b: string) => `${a}/${b}`,
    writeString: (p: string, s: string) => { cache[p] = s; }, readString: (p: string) => cache[p], fileExists: (p: string) => p in cache,
  }) };
  class DateFormatter { dateFormat = ""; string() { return "15:30"; } }
  class Size { w: number; h: number; constructor(w: number, h: number) { this.w = w; this.h = h; } }
  const config = { runsInWidget: famille !== "app", widgetFamily: famille === "app" ? undefined : famille };
  const Script = { setWidget: (w: unknown) => { pose = w; }, complete() {} };
  const env = { ListWidget, Request, Color, Font, FileManager, DateFormatter, Size, config, Script };
  return { env, textes, urls, cache, get pose() { return pose; }, get presente() { return presente; } };
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<void>;
async function lancer(f: ReturnType<typeof fauxScriptable>) {
  const keys = Object.keys(f.env);
  await new AsyncFunction(...keys, widgetScript(opts))(...keys.map((k) => (f.env as Record<string, unknown>)[k]));
}

const DATA = resumeWidget(
  [{ text: "Relancer Nakd", due: "2026-11-10" }, { text: "Envoyer le devis", due: "2026-11-19" }, { text: "Idée" }],
  [{ date: "2026-11-19", time: "17:00", title: "Call Nakd", type: "call" }, { date: "2026-11-20", title: "Poster le reel", type: "deadline" }],
  new Date("2026-11-19T14:30:00Z"),
);

describe("nouvelleCle", () => {
  it("43 caractères base64url, différente à chaque fois", () => {
    const a = nouvelleCle(), b = nouvelleCle();
    expect(KEY_RE.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("widgetScript", () => {
  it("pointe vers la fonction widget avec la clé", () => {
    const s = widgetScript(opts);
    expect(s).toContain('const API = "https://x.supabase.co/functions/v1/widget";');
    expect(s).toContain(`const CLE = "${CLE}";`);
    expect(s).toContain("créé le 19 novembre 2026");
  });
  it("refuse une clé mal formée", () => {
    expect(() => widgetScript({ ...opts, cle: "court" })).toThrow();
  });

  for (const famille of ["small", "medium", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"]) {
    it(`se dessine en ${famille}`, async () => {
      const f = fauxScriptable({ code: 200, body: DATA }, famille);
      await lancer(f);
      expect(f.pose).not.toBeNull();
      expect(f.textes.join(" | ")).not.toMatch(/undefined|NaN|\[object/);
      if (famille === "medium" || famille === "large") {
        expect(f.textes).toContain("Relancer Nakd");
        expect(f.textes).toContain("Call Nakd");
        expect(f.textes).toContain("1 en retard · 1 aujourd'hui");
        expect(f.urls).toEqual(expect.arrayContaining([expect.stringContaining("view=todo"), expect.stringContaining("view=planning")]));
      }
    });
  }

  it("ouvert dans l'app Scriptable : aperçu moyen", async () => {
    const f = fauxScriptable({ code: 200, body: DATA }, "app");
    await lancer(f);
    expect(f.presente).toBe("medium");
  });

  it("clé refusée : le dit clairement", async () => {
    const f = fauxScriptable({ code: 401, body: { error: "unauthorized" } }, "medium");
    await lancer(f);
    expect(f.textes.join(" ")).toMatch(/Clé refusée/);
  });

  it("hors connexion : reprend la dernière réponse", async () => {
    const cache: Record<string, string> = {};
    await lancer(fauxScriptable({ code: 200, body: DATA }, "medium", cache));
    const f = fauxScriptable("panne", "medium", cache);
    await lancer(f);
    expect(f.textes).toContain("Relancer Nakd");
    expect(f.textes.join(" ")).toMatch(/hors ligne/);
  });

  it("hors connexion sans rien en mémoire : message simple", async () => {
    const f = fauxScriptable("panne", "small");
    await lancer(f);
    expect(f.textes.join(" ")).toMatch(/Pas de connexion/);
  });
});

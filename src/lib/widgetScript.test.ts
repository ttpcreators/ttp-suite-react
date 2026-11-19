import { afterEach, describe, expect, it } from "vitest";
import { nouvelleCle, widgetScript } from "./widgetScript";
import { KEY_RE, resumeWidget } from "../../supabase/functions/_shared/widget.ts";
import { WIDGET_RENDERER } from "../../supabase/functions/_shared/widgetRenderer.ts";

const CLE = "A".repeat(43);
const opts = { supabaseUrl: "https://x.supabase.co/", anonKey: "anon", cle: CLE, creeLe: new Date("2026-11-19T12:00:00Z") };

type Net = { dessin: "ok" | "panne" | "refus"; data: { code: number; body: unknown } | "panne" };

/** Faux Scriptable : ce que le lanceur et le dessin appellent, posé en global le temps d'un test. */
function fauxScriptable(net: Net, famille: string, parametre = "", cache: Record<string, string> = {}) {
  const textes: string[] = [];
  const urls: string[] = [];
  const icones: string[] = [];
  const appels: string[] = [];
  let pose: unknown = null;
  let presente = "";
  const suivi = <T extends object>(o: T): T =>
    new Proxy(o, { set(t, k, v) { if (k === "url") urls.push(v); (t as Record<string | symbol, unknown>)[k] = v; return true; } });
  class Stack {
    addText(s: string) { textes.push(s); return { centerAlignText() {}, rightAlignText() {}, leftAlignText() {} }; }
    addStack() { return suivi(new Stack()); }
    addImage() { return {}; }
    addSpacer() {}
    layoutVertically() {}
    layoutHorizontally() {}
    centerAlignContent() {}
    topAlignContent() {}
    bottomAlignContent() {}
    setPadding() {}
  }
  class ListWidget extends Stack {
    async presentSmall() { presente = "small"; }
    async presentMedium() { presente = "medium"; }
    async presentLarge() { presente = "large"; }
  }
  class Request {
    headers: Record<string, string> = {};
    timeoutInterval = 0;
    response: { statusCode: number } | null = null;
    url: string;
    constructor(url: string) { this.url = url; appels.push(url); }
    async loadString() {
      if (net.dessin === "panne") throw new Error("offline");
      this.response = { statusCode: net.dessin === "refus" ? 401 : 200 };
      return net.dessin === "refus" ? '{"error":"unauthorized"}' : WIDGET_RENDERER;
    }
    async loadJSON() {
      if (net.data === "panne") throw new Error("offline");
      this.response = { statusCode: net.data.code };
      return net.data.body;
    }
  }
  class Color { static dynamic() { return new Color(); } }
  const Font = new Proxy({}, { get: () => () => ({}) });
  const SFSymbol = { named: (n: string) => { icones.push(n); return { applyFont() {}, image: {} }; } };
  const FileManager = { local: () => ({
    cacheDirectory: () => "/c", joinPath: (a: string, b: string) => `${a}/${b}`,
    writeString: (p: string, s: string) => { cache[p] = s; }, readString: (p: string) => cache[p], fileExists: (p: string) => p in cache,
  }) };
  class DateFormatter { dateFormat = ""; locale = ""; string() { return this.dateFormat === "HH:mm" ? "15:30" : "jeudi 19 novembre"; } }
  class Size { w: number; h: number; constructor(w: number, h: number) { this.w = w; this.h = h; } }
  const Device = { screenSize: () => ({ width: 393, height: 852 }) };
  const config = { runsInWidget: famille !== "app", widgetFamily: famille === "app" ? undefined : famille };
  const args = { widgetParameter: parametre || null };
  const Script = { setWidget: (w: unknown) => { pose = w; }, complete() {} };
  const env = { ListWidget, Request, Color, Font, SFSymbol, FileManager, DateFormatter, Size, Device, config, args, Script };
  return { env, textes, urls, icones, appels, cache, get pose() { return pose; }, get presente() { return presente; } };
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => () => Promise<void>;
const poses: string[] = [];
async function lancer(f: ReturnType<typeof fauxScriptable>) {
  // Le dessin est créé par le lanceur avec le constructeur de fonctions : il ne voit que les globales.
  for (const [k, v] of Object.entries(f.env)) {
    (globalThis as Record<string, unknown>)[k] = v;
    poses.push(k);
  }
  await new AsyncFunction(widgetScript(opts))();
}
afterEach(() => {
  for (const k of poses.splice(0)) delete (globalThis as Record<string, unknown>)[k];
});

const NOW = new Date("2026-11-19T14:30:00Z");
const DATA = resumeWidget(
  [{ text: "Relancer Nakd", due: "2026-11-10" }, { text: "Envoyer le devis", due: "2026-11-19" }, { text: "Idée" }],
  [{ date: "2026-11-19", time: "17:00", title: "Call Nakd", type: "call" }, { date: "2026-11-20", title: "Poster le reel", type: "deadline" }],
  NOW,
  [
    { contact_name: "Manon Le Moal", contact_email: "manon@fitaya.fr", subject: "Facture Fitaya", created_at: "2026-11-19T13:02:00Z", box: "partnerships", direction: "in" },
    { contact_name: "Adelina", contact_email: "adelina@x.fr", subject: "Contrat", created_at: "2026-11-18T09:00:00Z", box: "talent", direction: "in" },
  ],
);
const OK: Net = { dessin: "ok", data: { code: 200, body: DATA } };
const FAMILLES = ["small", "medium", "large", "extraLarge", "accessoryRectangular", "accessoryInline", "accessoryCircular"];

describe("nouvelleCle", () => {
  it("43 caractères base64url, différente à chaque fois", () => {
    const a = nouvelleCle(), b = nouvelleCle();
    expect(KEY_RE.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("widgetScript (lanceur)", () => {
  it("pointe vers la fonction widget avec la clé", () => {
    const s = widgetScript(opts);
    expect(s).toContain('const API = "https://x.supabase.co/functions/v1/widget";');
    expect(s).toContain(`const CLE = "${CLE}";`);
    expect(s).toContain("créé le 19 novembre 2026");
  });
  it("refuse une clé mal formée", () => {
    expect(() => widgetScript({ ...opts, cle: "court" })).toThrow();
  });
  it("le dessin ne contient ni accent grave ni « ${ » (il vit dans une chaîne)", () => {
    expect(WIDGET_RENDERER.startsWith("// ttp-widget-renderer")).toBe(true);
    expect(WIDGET_RENDERER).not.toMatch(/`|\$\{/);
  });
});

describe("dessin du widget", () => {
  for (const vue of ["", "mails", "taches", "planning"]) {
    for (const famille of FAMILLES) {
      it(`se dessine en ${famille}${vue ? ` (${vue})` : ""}`, async () => {
        const f = fauxScriptable(OK, famille, vue);
        await lancer(f);
        expect(f.pose).not.toBeNull();
        expect(f.textes.join(" | ")).not.toMatch(/undefined|NaN|\[object|null/);
        if (famille === "medium" || famille === "large") {
          if (vue === "" || vue === "taches") expect(f.textes).toContain("Relancer Nakd");
          if (vue === "" || vue === "planning") expect(f.textes).toContain("Call Nakd");
          if (vue === "mails") expect(f.textes).toEqual(expect.arrayContaining(["Manon Le Moal", "Facture Fitaya", "partnerships 1", "talent 1"]));
          if (vue === "mails") expect(f.textes).not.toContain("Relancer Nakd");
        }
      });
    }
  }

  it("moyen par défaut : deux colonnes cliquables, icônes SF", async () => {
    const f = fauxScriptable(OK, "medium");
    await lancer(f);
    expect(f.textes).toEqual(expect.arrayContaining(["1 retard", "1 auj.", "Aujourd'hui", "Demain", "17:00"]));
    expect(f.urls).toEqual(expect.arrayContaining([expect.stringContaining("view=todo"), expect.stringContaining("view=planning")]));
    expect(f.icones).toEqual(expect.arrayContaining(["checklist", "calendar", "flag.fill"]));
  });

  it("paramètre « Mails » (casse, accents) : ouvre la page Mails", async () => {
    const f = fauxScriptable(OK, "medium", " Mails ");
    await lancer(f);
    expect((f.pose as { url: string }).url).toContain("view=mails");
    const g = fauxScriptable(OK, "medium", "Tâches");
    await lancer(g);
    expect(g.textes).toContain("9 j");
    expect((g.pose as { url: string }).url).toContain("view=todo");
  });

  it("ouvert dans l'app Scriptable : aperçu moyen", async () => {
    const f = fauxScriptable(OK, "app");
    await lancer(f);
    expect(f.presente).toBe("medium");
  });

  it("clé refusée : le dit clairement", async () => {
    const f = fauxScriptable({ dessin: "ok", data: { code: 401, body: { error: "unauthorized" } } }, "medium");
    await lancer(f);
    expect(f.textes.join(" ")).toMatch(/Clé refusée/);
    const g = fauxScriptable({ dessin: "refus", data: "panne" }, "medium");
    await lancer(g);
    expect(g.textes.join(" ")).toMatch(/clé refusée/);
  });

  it("hors connexion : reprend le dernier dessin et les dernières données", async () => {
    const cache: Record<string, string> = {};
    await lancer(fauxScriptable(OK, "medium", "", cache));
    for (const k of poses.splice(0)) delete (globalThis as Record<string, unknown>)[k];
    const f = fauxScriptable({ dessin: "panne", data: "panne" }, "medium", "", cache);
    await lancer(f);
    expect(f.textes).toContain("Relancer Nakd");
    expect(f.textes.join(" ")).toMatch(/Hors ligne/);
  });

  it("hors connexion sans rien en mémoire : message simple", async () => {
    const f = fauxScriptable({ dessin: "panne", data: "panne" }, "small");
    await lancer(f);
    expect(f.textes.join(" ")).toMatch(/pas de connexion/);
  });
});

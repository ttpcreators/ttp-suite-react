import { describe, expect, it } from "vitest";
import {
  FOLDER_PAGES, FOLDER_TONES, TONE_LABEL, TONE_VAR, contratsSubFromTab, contratsTabFromSub, isFolderTone, pageDefaultTones, parseTabOrder,
  resolveTabTones, sanitizePageTones, sanitizeToneMap, sortByOrder, tabFromSub, tabLabel, withTabTone, withVisited,
} from "./folderTabs";

describe("Classeurs : code couleur", () => {
  it("chaque teinte a un jeton CSS et un nom en français", () => {
    for (const t of FOLDER_TONES) {
      expect(TONE_VAR[t]).toMatch(/^var\(--chart-\d\)$/);
      expect(TONE_LABEL[t]).toBeTruthy();
    }
  });

  it("teintes automatiques stables : même résultat quel que soit l'ordre des onglets", () => {
    const a = resolveTabTones(["alpha", "beta", "gamma"]);
    const b = resolveTabTones(["gamma", "alpha", "beta"]);
    expect(a).toEqual(b);
    // Sur une page, les teintes automatiques ne se répètent pas tant que la palette suffit.
    expect(new Set(Object.values(a)).size).toBe(3);
    // Rose et gris ne sont jamais tirés au hasard.
    for (const t of Object.values(resolveTabTones(["a", "b", "c", "d", "e"]))) expect(["pink", "grey"]).not.toContain(t);
  });

  it("plus d'onglets que de teintes : on recommence la palette sans planter", () => {
    const vals = ["a", "b", "c", "d", "e", "f", "g"];
    const out = resolveTabTones(vals);
    expect(Object.keys(out).sort()).toEqual(vals);
    for (const t of Object.values(out)) expect(isFolderTone(t)).toBe(true);
  });

  it("priorité : choix de l'équipe, puis défaut de la page, puis automatique (sans reprendre une teinte prise)", () => {
    const out = resolveTabTones(["x", "y", "z"], { x: "blue", y: "green" }, { y: "pink" });
    expect(out.x).toBe("blue");
    expect(out.y).toBe("pink");
    expect(["blue", "pink"]).not.toContain(out.z);
  });

  it("valeurs inconnues ignorées sans planter", () => {
    expect(sanitizePageTones({ a: "blue", b: "fuchsia", c: 3, d: null })).toEqual({ a: "blue" });
    expect(sanitizePageTones("oups")).toEqual({});
    expect(sanitizePageTones(["blue"])).toEqual({});
    expect(sanitizeToneMap({ roster: { roster: "teal", suivi: "rainbow" }, vide: { a: "x" }, cassé: 12 })).toEqual({ roster: { roster: "teal" } });
    expect(sanitizeToneMap(null)).toEqual({});
    expect(resolveTabTones(["a"], { a: "nope" as never }, { a: "nope" })).toEqual({ a: expect.any(String) });
  });

  it("choisir puis revenir à l'automatique", () => {
    expect(withTabTone({ a: "blue" }, "b", "orange")).toEqual({ a: "blue", b: "orange" });
    expect(withTabTone({ a: "blue", b: "orange" }, "b", null)).toEqual({ a: "blue" });
    expect(withTabTone("illisible", "a", "grey")).toEqual({ a: "grey" });
  });

  it("pages en classeur : ids uniques, défauts valides et lus par page", () => {
    const ids = FOLDER_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FOLDER_PAGES) for (const t of p.tabs) if (t.tone) expect(isFolderTone(t.tone)).toBe(true);
    expect(pageDefaultTones("parametres").notifications).toBe("orange");
    expect(pageDefaultTones("inconnue")).toEqual({});
  });

  it("onglets visités : ajoutés une fois", () => {
    expect(withVisited(["a"], "b")).toEqual(["a", "b"]);
    const v = ["a", "b"] as const;
    expect(withVisited(v, "a")).toBe(v);
  });
});

describe("Onglets dossier", () => {
  it("compteur dans le libellé, rien quand il est nul", () => {
    expect(tabLabel("Agents", 2)).toBe("Agents · 2");
    expect(tabLabel("Agents", 0)).toBe("Agents");
    expect(tabLabel("Agents")).toBe("Agents");
    expect(tabLabel("Agents", null)).toBe("Agents");
  });

  it("ordre enregistré, nouveaux onglets à la fin dans leur ordre d'origine", () => {
    const items = [{ value: "a" }, { value: "b" }, { value: "c" }, { value: "d" }];
    expect(sortByOrder(items, ["c", "a"]).map((i) => i.value)).toEqual(["c", "a", "b", "d"]);
    expect(sortByOrder(items, []).map((i) => i.value)).toEqual(["a", "b", "c", "d"]);
    // Un id enregistré qui n'existe plus ne gêne pas.
    expect(sortByOrder(items, ["zz", "d"]).map((i) => i.value)).toEqual(["d", "a", "b", "c"]);
  });

  it("ordre gardé : JSON illisible ou autre chose qu'une liste = vide", () => {
    expect(parseTabOrder('["b","a"]')).toEqual(["b", "a"]);
    expect(parseTabOrder(null)).toEqual([]);
    expect(parseTabOrder("{oups")).toEqual([]);
    expect(parseTabOrder('{"a":1}')).toEqual([]);
  });

  it("sous-page de la sidebar → onglet, sinon l'onglet par défaut", () => {
    const tabs = ["creatrices", "agence", "files"] as const;
    expect(tabFromSub("agence", tabs, "creatrices")).toBe("agence");
    expect(tabFromSub(null, tabs, "creatrices")).toBe("creatrices");
    expect(tabFromSub("inconnu", tabs, "creatrices")).toBe("creatrices");
  });

  it("Contrats : sous-page nulle = « Tous », aller-retour sans perte", () => {
    expect(contratsTabFromSub(null)).toBe("tous");
    expect(contratsTabFromSub("repr")).toBe("repr");
    expect(contratsTabFromSub("autre")).toBe("tous");
    expect(contratsSubFromTab("tous")).toBeNull();
    for (const t of ["marque", "repr", "ugc"] as const) expect(contratsTabFromSub(contratsSubFromTab(t))).toBe(t);
  });
});

describe("couleur du cadre des classeurs", async () => {
  const { sanitizeFrameMap, frameColorFor, isLightColor } = await import("./folderTabs");
  it("garde seulement des couleurs #rrggbb", () => {
    expect(sanitizeFrameMap({ contrats: "#49060E", x: "rouge", y: 3, "*": "#1f2a44" })).toEqual({ contrats: "#49060e", "*": "#1f2a44" });
    expect(sanitizeFrameMap(null)).toEqual({});
  });
  it("page, puis tous les classeurs, puis d'origine", () => {
    expect(frameColorFor({ contrats: "#111111", "*": "#222222" }, "contrats")).toBe("#111111");
    expect(frameColorFor({ "*": "#222222" }, "roster")).toBe("#222222");
    expect(frameColorFor({}, "roster")).toBeNull();
  });
  it("cadre clair ou foncé", () => {
    expect(isLightColor("#ebe4d8")).toBe(true);
    expect(isLightColor("#292929")).toBe(false);
    expect(isLightColor("#49060e")).toBe(false);
  });
});

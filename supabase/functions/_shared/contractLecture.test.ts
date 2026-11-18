import { describe, expect, it } from "vitest";
import { texteContrat, trouverContrats } from "./contractLecture.ts";
import { normaliserBrouillon } from "./contractDraft.ts";
import { buildRepresentation, CONDITIONS_MENTION, rcDefaultConfig, representationText } from "./representation.ts";

const brouillon = (repr: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const r = normaliserBrouillon({ type: "representation", representation: repr, ...extra }, { id: "cd1", ts: Date.UTC(2026, 10, 18), ctName: "Adelina", by: "Alfred" });
  if ("erreur" in r) throw new Error(r.erreur);
  return r.brouillon;
};

describe("conditions particulières", () => {
  it("garde le texte libre sur plusieurs lignes et l'imprime en fin de contrat avec la mention", () => {
    const d = brouillon({ variante: "nonexclusif", conditionsParticulieres: "Ligne 1\nLigne 2 {pas un réglage}" });
    expect(d.config?.conditionsParticulieres).toBe("Ligne 1\nLigne 2 {pas un réglage}");
    const t = texteContrat({ kind: "brouillon", id: d.id, qui: d.ctName, date: "2026-11-18", brouillon: d });
    expect(t).toContain("Article 13 — Conditions particulières\nLigne 1\nLigne 2 {pas un réglage}");
    expect(t).toContain(CONDITIONS_MENTION);
    expect(t.indexOf("Article 13")).toBeGreaterThan(t.indexOf("Article 12"));
  });

  it("range les clauses envoyées à part dans les conditions particulières", () => {
    const d = brouillon({ variante: "nonexclusif" }, { clauses: [{ titre: "Gifting", texte: "Aucune commission sur les cadeaux." }] });
    expect(d.config?.conditionsParticulieres).toBe("Gifting — Aucune commission sur les cadeaux.");
  });

  it("sans texte, pas d'article 13", () => {
    expect(representationText(rcDefaultConfig("nonexclusif"))).not.toContain("Conditions particulières\n");
  });
});

describe("options d'articles", () => {
  const base = { ...rcDefaultConfig("nonexclusif"), talentNom: "Adelina" };
  const art = (cfg: Record<string, string>, num: string) => buildRepresentation(cfg).articles.filter((a) => a.number === num).map((a) => a.body).join("\n");

  it("article 7 : la déclaration des approches peut être retirée", () => {
    expect(art(base, "Article 7")).toContain("approche directe de marque");
    const off = art({ ...base, declarationApproches: "false" }, "Article 7");
    expect(off).not.toContain("approche directe");
    expect(off).toContain("n'est pas tenu d'en informer");
    expect(art({ ...base, declarationApproches: "false" }, "Article 4")).not.toContain("en informe néanmoins");
  });

  it("clause pénale : désactivable", () => {
    expect(art(base, "Article 10")).toContain("Clause pénale");
    expect(art({ ...base, clausePenaleActive: "false" }, "Article 10")).not.toContain("Clause pénale");
  });

  it("articles 4.1 et 4.4 : pas de commission sur les cadeaux seuls", () => {
    const off = art({ ...base, avantagesNatureInclus: "false" }, "Article 4");
    expect(off).toContain("la seule rémunération en numéraire");
    expect(off).toContain("ne donne lieu à aucune commission");
    expect(off).not.toContain("avantages inclus");
    expect(art(base, "Article 4")).toContain("numéraire + valeur des avantages en nature");
  });

  it("article 6 simplifié : e-mail, 30 jours, ni recommandé ni périodes de 4 mois", () => {
    const cfg = { ...base, art6Souple: "true" };
    const a6 = art(cfg, "Article 6");
    expect(a6).toContain("par simple e-mail");
    expect(a6).toContain("préavis de 30 jours");
    expect(a6).not.toMatch(/recommandée|4 mois/);
    const a10 = art(cfg, "Article 10");
    expect(a10).toContain("10.1 Résiliation libre");
    expect(a10).not.toContain("10.1 Après la période d'essai");
  });
});

describe("trouverContrats", () => {
  it("trouve un brouillon par id et un contrat enregistré par créateur", () => {
    const d = brouillon({ variante: "nonexclusif" });
    const hist = [{ id: "h1", creator: "Adelina", title: "x", variante: "nonexclusif", config: { variante: "nonexclusif" }, createdAt: "2026-11-10T10:00:00Z", status: "pending" }];
    expect(trouverContrats([d], hist, { id: "cd1" }).map((c) => c.id)).toEqual(["cd1"]);
    expect(trouverContrats([d], hist, { createur: "adelina" }).map((c) => c.kind)).toEqual(["brouillon", "enregistre"]);
  });
});

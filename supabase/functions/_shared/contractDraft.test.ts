import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DRAFT_OPTS, choisirCreateur, lireBrouillons, normaliserBrouillon, resumeBrouillon } from "./contractDraft.ts";

const base = { id: "cdtest", ts: 1_800_000_000_000, ctName: "Léa", by: "Alfred" };

describe("Brouillons de contrat préparés par Claude", () => {
  it("retrouve le créateur du roster sans accents ni majuscules, et refuse l'ambiguïté", () => {
    const noms = ["Léa", "Léa Martin", "Nova", "Paul Durand"];
    expect(choisirCreateur(noms, "lea")).toBe("Léa");
    expect(choisirCreateur(noms, "NOVA")).toBe("Nova");
    expect(choisirCreateur(noms, "paul")).toBe("Paul Durand");
    expect(choisirCreateur(["Léa Martin", "Léa Roux"], "léa")).toBeNull();
    expect(choisirCreateur(noms, "Inès")).toBeNull();
    expect(choisirCreateur(noms, "")).toBeNull();
  });

  it("remplit le formulaire du générateur avec les conditions convenues", () => {
    const r = normaliserBrouillon(
      {
        marque: "Nova Cosmetics", montant: "400 € HT", livrables: "1 Reel + whitelisting 30 jours", duree: "3 mois",
        droits: "paid", duree_droits: "3 mois", paiement: "30j", note: "Facturation à confirmer (mail du 12 novembre)",
        clauses: [{ titre: "Whitelisting", texte: "Sponsorisation limitée à 30 jours." }, { titre: "", texte: "vide" }],
      },
      base,
    );
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.brouillon).toMatchObject({ id: "cdtest", by: "Alfred", ctType: "marque", ctName: "Léa", brand: "Nova Cosmetics", note: "Facturation à confirmer (mail du 12 novembre)" });
    expect(r.brouillon.form).toMatchObject({
      ctType: "marque", value: "400 € HT", commission: "20", duration: "3 mois", deliverables: "1 Reel + whitelisting 30 jours",
      collab: "sponso", rights: "paid", rightsDuration: "3 mois", territory: "France", payment: "30j", tva: "non", exclScope: "non", excl: false, defraiement: false,
    });
    expect(r.brouillon.form.extra).toEqual([{ id: "cdtestx0", l: "Whitelisting", v: "Sponsorisation limitée à 30 jours." }]);
    expect(resumeBrouillon(r.brouillon)).toContain("Nova Cosmetics × Léa");
  });

  it("met l'UGC par défaut en nature UGC, et refuse une valeur que le générateur ne connaît pas", () => {
    const ugc = normaliserBrouillon({ type: "ugc", marque: "Nova" }, base);
    expect("brouillon" in ugc && ugc.brouillon.form.collab).toBe("ugc");
    expect(normaliserBrouillon({ marque: "Nova", droits: "pub" }, base)).toEqual({ erreur: expect.stringMatching(/n'est pas permis pour droits/) });
    expect(normaliserBrouillon({ montant: "400" }, base)).toEqual({ erreur: "Indique la marque." });
    const excl = normaliserBrouillon({ marque: "Nova", exclusivite: "cat90" }, base);
    expect("brouillon" in excl && excl.brouillon.form.excl).toBe(true);
  });

  it("lit le blob sans planter sur une entrée d'un autre format", () => {
    expect(lireBrouillons([{ id: "a", ctName: "Léa", brand: "Nova", form: {} }, { id: 3 }, null, "x"])).toHaveLength(1);
    expect(lireBrouillons(undefined)).toEqual([]);
  });

  it("propose seulement des valeurs qui existent dans les menus du générateur de contrats", () => {
    const page = readFileSync(join(__dirname, "../../../src/views/Contrats.tsx"), "utf8");
    for (const valeurs of Object.values(DRAFT_OPTS)) {
      for (const v of valeurs) expect(page, `valeur « ${v} » absente de Contrats.tsx`).toContain(`{ v: "${v}"`);
    }
  });
});

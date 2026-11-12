import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderContract } from "./contrats.mjs";
import { fabriquer } from "../../scripts/alfred-contrats.mjs";
import { renderContract as moteurApp } from "../../src/lib/contractRender";

describe("Alfred : les contrats avec le moteur de l'app", () => {
  it("contrats.mjs est à jour avec le moteur de l'app (sinon : npm run alfred:contrats)", async () => {
    expect(readFileSync(join(__dirname, "contrats.mjs"), "utf8")).toBe(await fabriquer());
  }, 30_000);

  it("fait le même contrat Marque × Créateur que l'app", () => {
    const entrees = { createur: "Léa", marque: "Nova", montant: "400 € HT", livrables: "1 Reel", droits: "paid", duree_droits: "3 mois" };
    const r = renderContract(entrees);
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.titre).toBe("Contrat de partenariat commercial · Nova × Léa");
    expect(r.html).toContain("Paid media / whitelisting · 3 mois");
    expect(r.html).toContain("https://app.ttpcreators.pro/logo.png");
    const app = moteurApp(entrees);
    // Mêmes clauses et conditions (seuls le logo et les polices changent d'adresse hors navigateur).
    if ("erreur" in app) throw new Error(app.erreur);
    const corps = (h: string) => h.slice(h.indexOf("<body>")).replace(/src="[^"]*logo\.png"/g, "");
    expect(corps(r.html)).toBe(corps(app.html));
  });

  it("fait le contrat de représentation avec ses réglages", () => {
    const r = renderContract({ type: "representation", createur: "Inès Roux", representation: { variante: "nonexclusif", gestionMail: true, talentEmailPro: "ines@example.com" } });
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.titre).toBe("Contrat de représentation · Inès Roux");
    expect(r.html).toContain("ines@example.com");
    expect(r.html).toContain("Inès Roux");
  });

  it("dit ce qui manque au lieu de fabriquer un contrat faux", () => {
    expect(renderContract({ marque: "Nova" })).toEqual({ erreur: "Indique le créateur (createur)." });
    expect(renderContract({ createur: "Léa" })).toEqual({ erreur: "Indique la marque." });
    expect(renderContract({ createur: "Léa", marque: "Nova", droits: "pub" })).toEqual({ erreur: expect.stringMatching(/n'est pas permis/) });
  });
});

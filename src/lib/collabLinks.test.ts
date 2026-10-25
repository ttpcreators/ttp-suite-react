import { describe, expect, it } from "vitest";
import { autoTaskFor, cachetAmount, collabChoices, collabIdMissing, collabLabel, concernsCreator, hasAutoTask, linkGroups, mentionsBrand, type CollabLite } from "./collabLinks";

const nutri: CollabLite = { id: "c1", brand: "Nutripure", creator: "LÉNA TEST", step: 2, status: "active" };

describe("collab au centre", () => {
  it("libellé et colonne absente", () => {
    expect(collabLabel(nutri)).toBe("Nutripure × Léna");
    expect(collabIdMissing({ code: "42703" })).toBe(true);
    expect(collabIdMissing({ message: "column collab_id does not exist" })).toBe(true);
    expect(collabIdMissing({ code: "23505" })).toBe(false);
  });
  it("suggestions : marque citée et bon créateur", () => {
    expect(mentionsBrand("Envoyer le script pour le brief Nutripure de Novembre", "Nutripure")).toBe(true);
    expect(mentionsBrand("Nutripurex promo", "Nutripure")).toBe(false);
    expect(mentionsBrand("Call Opéra Air", "Opera Air")).toBe(true);
    expect(concernsCreator("Ana Test, Léna Test", "LÉNA TEST")).toBe(true);
    expect(concernsCreator(["Ana Test"], "Léna Test")).toBe(false);
  });
  it("champ Collab : collabs du créateur choisi, en cours ou gagnées", () => {
    const list: CollabLite[] = [nutri, { ...nutri, id: "c2", creator: "Ana Test" }, { ...nutri, id: "c3", status: "perdue" }];
    expect(collabChoices(list, "léna test").map((c) => c.id)).toEqual(["c1"]);
    expect(collabChoices(list, "").map((c) => c.id)).toEqual(["c1", "c2"]);
  });
  it("tâche de l'étape atteinte, sans doublon", () => {
    const now = new Date(2026, 9, 23, 10).getTime();
    expect(autoTaskFor(2, nutri, now)).toEqual({ text: "Résumer le brief pour Léna", due: "2026-10-24" });
    expect(autoTaskFor(8, nutri, now)).toEqual({ text: "Relancer Nutripure pour le paiement", due: "2026-11-22" });
    expect(autoTaskFor(3, nutri, now)).toBeNull();
    expect(hasAutoTask([{ text: "résumer le brief pour Léna", collab_id: "c1" }], "c1", "Résumer le brief pour Léna")).toBe(true);
    expect(hasAutoTask([{ text: "Résumer le brief pour Léna", collab_id: "c9" }], "c1", "Résumer le brief pour Léna")).toBe(false);
  });
  it("montant du cachet", () => {
    expect(cachetAmount("1 500 €")).toBe(1500);
    expect(cachetAmount("1500€ HT")).toBe(1500);
    expect(cachetAmount("950,50 €")).toBe(950.5);
    expect(cachetAmount("")).toBe(0);
    // Point des milliers à la française et suffixe k : jamais une facture à 1,50 €.
    expect(cachetAmount("1.500 €")).toBe(1500);
    expect(cachetAmount("1,5k€")).toBe(1500);
    expect(cachetAmount("1 500 € / 3 mois")).toBe(1500);
    expect(cachetAmount("à définir")).toBe(0);
  });
});

describe("fiche collab : reliés et suggérés", () => {
  it("relie par collab_id, suggère par marque + créateur, signale la facture en retard", () => {
    const data = {
      briefs: [{ id: "b1", brand: "Nutripure", creator: "LÉNA TEST", due: "2026-11-01", status: "cours" }],
      todos: [{ id: "t1", text: "Envoyer le script Nutripure", creators: ["Léna Test"], collab_id: "c1" }, { id: "t2", text: "Nutripure stats", creator: "Ana Test" }],
      events: [{ id: "e1", title: "Call Nutripure", who: "Léna Test, Ana Test", date: "2026-10-30", time: "10:00" }],
      invoices: [{ id: "i1", ref: "TTP-1", party: "Nutripure × Léna", creator: "Léna Test", status: "attente", date: "01/10/2026", amount: "1 500 €", collab_id: "c1" }],
      gifting: [{ id: "g1", brand: "Autre", creator: "Léna Test" }],
    };
    const g = linkGroups(nutri, data, (v) => String(v ?? ""), new Date(2026, 9, 23));
    expect(g.todos.linked.map((i) => i.id)).toEqual(["t1"]);
    expect(g.todos.suggested).toEqual([]);
    expect(g.briefs.suggested.map((i) => i.id)).toEqual(["b1"]);
    expect(g.events.suggested.map((i) => i.id)).toEqual(["e1"]);
    expect(g.invoices.linked[0].late).toBe(true);
    expect(g.gifting.suggested).toEqual([]);
  });
});

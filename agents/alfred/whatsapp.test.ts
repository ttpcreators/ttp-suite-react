import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { appleVersDate, cleVocal, contenu, duree, correspond, dateVersApple, heure, ligne, lireDate, lireListe, numeroDe, trouver } from "./whatsapp.mjs";

describe("Alfred : discussions WhatsApp", () => {
  it("convertit les dates WhatsApp (secondes depuis 2001) à l'heure de Paris", () => {
    const d = new Date("2026-11-10T14:48:00Z");
    expect(appleVersDate(dateVersApple(d)).getTime()).toBe(d.getTime());
    expect(heure(d)).toBe("2026-11-10 15:48");
    expect(lireDate("2026-11-10 09:05")?.getHours()).toBe(9);
    expect(lireDate("n'importe quoi")).toBeNull();
  });

  it("lit la liste autorisée sans planter sur une ligne bizarre", () => {
    const liste = lireListe("# créateurs\n33600000000@s.whatsapp.net | Créateur Test\n\nmauvais id ; drop | X\n120363000000@g.us | Groupe Marque × Test\n");
    expect(liste).toEqual([
      { jid: "33600000000@s.whatsapp.net", nom: "Créateur Test" },
      { jid: "120363000000@g.us", nom: "Groupe Marque × Test" },
    ]);
    expect(trouver(liste, "createur test")?.jid).toBe("33600000000@s.whatsapp.net");
    expect(trouver(liste, "120363000000@g.us")?.nom).toBe("Groupe Marque × Test");
    expect(trouver(liste, "Inconnu")).toBeNull();
  });

  it("ne cherche qu'avec des mots de 3 lettres ou plus", () => {
    expect(correspond("Léna PSL", ["lena"])).toBe(true);
    expect(correspond("Léna PSL", ["le"])).toBe(false);
    expect(correspond("Maman", ["lena", "pasquale"])).toBe(false);
  });

  it("montre les médias et cache les évènements système", () => {
    expect(contenu(0, " Coucou ")).toBe("Coucou");
    expect(contenu(3, null)).toBe("[vocal]");
    expect(contenu(8, null, "Contrat.pdf")).toBe("[document : Contrat.pdf]");
    expect(contenu(1, "regarde")).toBe("[photo] regarde");
    expect(contenu(10, null)).toBeNull();
    expect(contenu(14, null)).toBe("[message supprimé]");
    const m = { date: dateVersApple(new Date("2026-11-10T14:48:00Z")), type: 0, texte: "ligne 1\nligne 2" };
    expect(ligne(m, "Créateur Test")).toBe("2026-11-10 15:48 · Créateur Test : ligne 1 / ligne 2");
    expect(ligne({ ...m, type: 6 }, "X")).toBeNull();
  });

  it("montre la transcription d'un vocal, ou pourquoi elle manque", () => {
    expect(duree(42)).toBe("0:42");
    expect(duree(725)).toBe("12:05");
    expect(contenu(3, null, null, { secondes: 42, texte: "Je peux tourner jeudi" })).toBe("[vocal 0:42] « Je peux tourner jeudi »");
    expect(contenu(3, null, null, { secondes: 900, raison: "trop long pour être transcrit" })).toBe("[vocal 15:00] (trop long pour être transcrit)");
    expect(contenu(3, null)).toBe("[vocal]");
    expect(cleVocal("Media/123@lid/8/0/abc.opus")).toBe("Media_123_lid_8_0_abc.opus.txt");
  });

  it("trouve le numéro d'une discussion à deux, jamais d'un groupe", () => {
    expect(numeroDe("33600000000@s.whatsapp.net")).toBe("33600000000");
    expect(numeroDe("111@lid", [{ lid: "111@lid", wa: "33600000001@s.whatsapp.net" }])).toBe("33600000001");
    expect(numeroDe("111@lid", [{ lid: "111", wa: null, tel: "+33 6 00 00 00 02" }])).toBe("33600000002");
    expect(numeroDe("222@lid", [{ lid: "111@lid", wa: "33600000001@s.whatsapp.net" }])).toBeNull();
    expect(numeroDe("120363000000@g.us")).toBeNull();
  });
});

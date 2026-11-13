import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { appleVersDate, attente, balleChezMarc, cleVocal, contenu, duree, correspond, dateVersApple, heure, ligne, lireDate, lireListe, numeroDe, trouver } from "./whatsapp.mjs";

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

  it("voit quand la balle est dans le camp de Marc", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const a = (iso: string, moi: number, type = 0) => ({ date: dateVersApple(new Date(iso)), moi, type, texte: "msg" });
    expect(balleChezMarc([a("2026-11-10T08:00:00Z", 1), a("2026-11-10T09:00:00Z", 0)], now)?.heures).toBe(27);
    // Marc a répondu en dernier : rien.
    expect(balleChezMarc([a("2026-11-10T09:00:00Z", 0), a("2026-11-10T10:00:00Z", 1)], now)).toBeNull();
    // Un évènement système après le message ne compte pas ; trop récent : rien.
    expect(balleChezMarc([a("2026-11-10T09:00:00Z", 0), a("2026-11-10T10:00:00Z", 1, 6)], now)).not.toBeNull();
    expect(balleChezMarc([a("2026-11-11T08:00:00Z", 0)], now)).toBeNull();
    expect(attente(5)).toBe("5 h");
    expect(attente(28)).toBe("1 j 4 h");
    expect(attente(150)).toBe("6 j");
  });
});

describe("WhatsApp : les pièces jointes", () => {
  it("donne le numéro de la pièce à ouvrir, ou dit pourquoi elle ne s'ouvre pas", async () => {
    const { ligne, nomPiece, reperePiece } = await import("./whatsapp.mjs");
    const doc = { id: 123, type: 8, titre: "brief Nova.pdf", fichier: "Media/x/brief.pdf", date: 784_400_000, moi: 0 };
    expect(reperePiece(doc)).toBe(" · pièce 123");
    expect(ligne(doc, "Léa")).toMatch(/Léa : \[document : brief Nova\.pdf · pièce 123\]$/);
    expect(reperePiece({ ...doc, fichier: null })).toBe(" · pas téléchargée sur ce Mac");
    expect(reperePiece({ ...doc, type: 0 })).toBe("");
    expect(reperePiece({ ...doc, type: 3 })).toBe("");
  });

  it("nomme la copie sans pouvoir sortir du dossier", async () => {
    const { nomPiece } = await import("./whatsapp.mjs");
    expect(nomPiece(123, "brief Nova.pdf")).toBe("wa-123-brief_Nova.pdf");
    expect(nomPiece(7, "../../.ssh/id_rsa")).toBe("wa-7-id_rsa");
    expect(nomPiece(8, "")).toBe("wa-8-piece");
  });
});

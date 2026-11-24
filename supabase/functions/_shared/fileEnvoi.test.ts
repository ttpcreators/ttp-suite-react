import { describe, expect, it } from "vitest";
import { REGLES, adresses, cleSociete, coupeCircuit, dansLaFenetre, ligneFile, planifier, prochainCreneau, quandCourt, raisonDeBloquer } from "./fileEnvoi.ts";

// Le mercredi 25 novembre 2026, Paris est à UTC+1.
const at = (iso: string) => new Date(iso);

describe("file d'envoi : heures d'envoi", () => {
  it("jours ouvrés, de 8 h 30 à 18 h 30 à Paris", () => {
    expect(dansLaFenetre(at("2026-11-25T07:29:00Z"))).toBe(false); // 8 h 29
    expect(dansLaFenetre(at("2026-11-25T07:30:00Z"))).toBe(true); // 8 h 30
    expect(dansLaFenetre(at("2026-11-25T17:29:00Z"))).toBe(true); // 18 h 29
    expect(dansLaFenetre(at("2026-11-25T17:30:00Z"))).toBe(false); // 18 h 30
    expect(dansLaFenetre(at("2026-11-28T10:00:00Z"))).toBe(false); // samedi
  });
  it("le prochain créneau : tout de suite, plus tard le jour même, ou lundi", () => {
    expect(prochainCreneau(at("2026-11-25T10:00:00Z")).toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(prochainCreneau(at("2026-11-25T05:00:00Z")).toISOString()).toBe("2026-11-25T07:30:00.000Z");
    expect(prochainCreneau(at("2026-11-25T19:00:00Z")).toISOString()).toBe("2026-11-26T07:30:00.000Z");
    expect(prochainCreneau(at("2026-11-27T18:00:00Z")).toISOString()).toBe("2026-11-30T07:30:00.000Z"); // vendredi soir → lundi
  });
});

describe("file d'envoi : planification", () => {
  const fixe = () => 0.5; // écart de 5 minutes
  it("espace les mails de 3 à 7 minutes, à partir d'une minute après maintenant", () => {
    const t = planifier(3, at("2026-11-25T09:00:00Z"), [], REGLES, fixe).map((d) => d.toISOString());
    expect(t).toEqual(["2026-11-25T09:01:00.000Z", "2026-11-25T09:06:00.000Z", "2026-11-25T09:11:00.000Z"]);
  });
  it("part après les mails déjà prévus de la boîte", () => {
    const t = planifier(1, at("2026-11-25T09:00:00Z"), [at("2026-11-25T11:00:00Z")], REGLES, fixe);
    expect(t[0].toISOString()).toBe("2026-11-25T11:03:00.000Z");
  });
  it("la nuit : le lendemain à 8 h 30", () => {
    expect(planifier(1, at("2026-11-25T22:00:00Z"), [], REGLES, fixe)[0].toISOString()).toBe("2026-11-26T07:30:00.000Z");
  });
  it("au-delà du plafond du jour : le jour ouvré suivant", () => {
    const r = { ...REGLES, parJour: 2 };
    const t = planifier(3, at("2026-11-27T09:00:00Z"), [], r, fixe).map((d) => d.toISOString());
    expect(t).toEqual(["2026-11-27T09:01:00.000Z", "2026-11-27T09:06:00.000Z", "2026-11-30T07:30:00.000Z"]);
    const plein = planifier(1, at("2026-11-25T09:00:00Z"), [at("2026-11-25T08:00:00Z"), at("2026-11-25T08:10:00Z")], r, fixe);
    expect(plein[0].toISOString()).toBe("2026-11-26T07:30:00.000Z");
  });
  it("tous les envois restent dans la fenêtre", () => {
    const t = planifier(120, at("2026-11-25T16:50:00Z"), [], REGLES);
    expect(t.every((d) => dansLaFenetre(d))).toBe(true);
    expect(new Set(t.map((d) => d.toISOString())).size).toBe(120);
  });
});

describe("file d'envoi : ce qui bloque un mail", () => {
  const base = { reponse: false, liste: [], enErreur: [], recents: [], maintenant: at("2026-11-25T10:00:00Z") };
  it("lit les adresses et la société", () => {
    expect(adresses("Julie <Julie@Nova.fr>, presse@nova.fr, julie@nova.fr")).toEqual(["julie@nova.fr", "presse@nova.fr"]);
    expect(cleSociete("Julie@Nova.fr")).toBe("nova.fr");
    expect(cleSociete("novaparis@gmail.com")).toBe("novaparis@gmail.com");
  });
  it("la liste « ne plus contacter », par adresse ou par domaine", () => {
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], liste: [{ email: "Julie@Nova.fr", domaine: null, raison: "refus" }] })).toBe("julie@nova.fr est dans la liste « ne plus contacter » (refus)");
    expect(raisonDeBloquer({ ...base, destinataires: ["presse@nova.fr"], liste: [{ email: null, domaine: "@nova.fr", raison: "arret" }] })).toContain("ne plus contacter");
    expect(raisonDeBloquer({ ...base, reponse: true, destinataires: ["presse@nova.fr"], liste: [{ email: null, domaine: "nova.fr", raison: "arret" }] })).toContain("ne plus contacter");
  });
  it("l'adresse en erreur", () => {
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], enErreur: ["JULIE@nova.fr"] })).toBe("julie@nova.fr est marquée « adresse en erreur » sur sa fiche");
  });
  it("un premier mail à la même société depuis moins de 30 jours, pas une réponse", () => {
    const recents = [{ email: "contact@nova.fr", at: "2026-11-10T09:00:00Z" }];
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], recents })).toBe("un premier mail est déjà parti chez nova.fr le 10 nov. (contact@nova.fr) : pas de nouveau premier mail à la même société avant 30 jours");
    expect(raisonDeBloquer({ ...base, reponse: true, destinataires: ["julie@nova.fr"], recents })).toBeNull();
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], recents: [{ email: "contact@nova.fr", at: "2026-10-20T09:00:00Z" }] })).toBeNull();
    expect(raisonDeBloquer({ ...base, destinataires: ["a@gmail.com"], recents: [{ email: "b@gmail.com", at: "2026-11-20T09:00:00Z" }] })).toBeNull();
  });
  it("les adresses de l'agence ne bloquent jamais", () => {
    expect(raisonDeBloquer({ ...base, destinataires: ["talent@ttpcreators.pro"], recents: [{ email: "partnerships@ttpcreators.pro", at: "2026-11-24T09:00:00Z" }] })).toBeNull();
  });
});

describe("file d'envoi : coupe-circuit et affichage", () => {
  it("s'arrête au-delà de 3 rebonds et 5 % des envois", () => {
    expect(coupeCircuit(40, 2)).toBeNull();
    expect(coupeCircuit(100, 3)).toBeNull();
    expect(coupeCircuit(40, 3)).toContain("la file est en pause");
    expect(coupeCircuit(0, 3)).toContain("3 rebond(s) sur 0");
  });
  it("écrit une ligne lisible", () => {
    expect(quandCourt("2026-11-25T08:42:00Z")).toBe("mer. 25 nov. à 9 h 42");
    expect(ligneFile({ id: "0123456789abcdef", boite: "talent", destinataires: "julie@nova.fr", objet: "Nova × Léa", statut: "en_attente", prevu_a: "2026-11-25T08:42:00Z", envoye_at: null, erreur: null, lot: "25/11" }))
      .toBe("- prévu · mer. 25 nov. à 9 h 42 · talent@ → julie@nova.fr · « Nova × Léa » · lot 25/11 [01234567]");
  });
});

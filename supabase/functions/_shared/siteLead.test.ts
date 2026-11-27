import { describe, expect, it } from "vitest";
import { ilikeExact, ligneScouting, lireCandidature, lireLead, noteCandidature, tacheCandidature, tacheLead, toucheLead } from "./siteLead.ts";

describe("lireLead", () => {
  it("lit et nettoie une demande", () => {
    const r = lireLead({ email: " Anais@Kosbiotic.COM ", marque: "Kosbiotic<script>", nom: "Anaïs", message: "Campagne\nde janvier" });
    expect(r).toEqual({ lead: { email: "anais@kosbiotic.com", marque: "Kosbiotic script", nom: "Anaïs", message: "Campagne\nde janvier" } });
  });
  it("refuse sans email valable ou sans marque", () => {
    expect(lireLead({ email: "pas-un-mail", marque: "X" })).toEqual({ erreur: "email" });
    expect(lireLead({ email: "a@b.fr", marque: "  " })).toEqual({ erreur: "marque" });
    expect(lireLead(null)).toEqual({ erreur: "email" });
  });
  it("piège à robots rempli : ignoré", () => {
    expect(lireLead({ email: "a@b.fr", marque: "X", site: "http://spam" })).toEqual({ robot: true });
  });
  it("borne les longueurs", () => {
    const r = lireLead({ email: "a@b.fr", marque: "M".repeat(500), message: "x".repeat(5000) });
    expect("lead" in r && r.lead.marque.length).toBe(80);
    expect("lead" in r && r.lead.message.length).toBe(1500);
  });
});

describe("touche et tâche", () => {
  const lead = { email: "a@b.fr", marque: "Nakd", nom: "", message: "Budget 3 000 €" };
  it("touche « réponse » par mail, datée", () => {
    expect(toucheLead(lead, new Date("2026-11-20T10:00:00Z"))).toMatchObject({ canal: "email", kind: "reponse", date: "2026-11-20T10:00:00.000Z", note: "Demande du roster via le site : Budget 3 000 €" });
  });
  it("tâche au format fixe", () => {
    expect(tacheLead(lead)).toBe("Lead site : Nakd demande le roster (tri : question du budget)");
  });
});

describe("ilikeExact", () => {
  it("neutralise les jokers d'un email pour un filtre ilike", () => {
    expect(ilikeExact("%@%.com")).toBe("\\%@\\%.com");
    expect(ilikeExact("prenom_nom@marque.fr")).toBe("prenom\\_nom@marque.fr");
    expect(ilikeExact("a\\b@c.fr")).toBe("a\\\\b@c.fr");
    expect(ilikeExact("simple@marque.fr")).toBe("simple@marque.fr");
  });
});

describe("lireCandidature", () => {
  it("lit et nettoie une candidature", () => {
    expect(lireCandidature({ type: "createur", nom: " Léa  Martin ", email: " Lea@Mail.FR ", compte: "@lea.fit_", niche: "Fitness", message: "Bonjour\nJe fais du CrossFit <3" }))
      .toEqual({ cand: { email: "lea@mail.fr", nom: "Léa Martin", compte: "@lea.fit_", niche: "Fitness", message: "Bonjour\nJe fais du CrossFit  3" } });
  });
  it("accepte le @, le nom seul ou le lien du profil Instagram ou TikTok", () => {
    for (const compte of ["https://www.instagram.com/lea.fit_/?hl=fr", "instagram.com/lea.fit_", "https://www.tiktok.com/@lea.fit_", "lea.fit_", "@@lea.fit_"]) {
      const r = lireCandidature({ nom: "Léa", email: "a@b.fr", compte });
      expect("cand" in r && r.cand.compte).toBe("@lea.fit_");
    }
  });
  it("refuse sans email, sans nom ou avec un compte invalide", () => {
    expect(lireCandidature({ nom: "Léa", email: "x", compte: "lea" })).toEqual({ erreur: "email" });
    expect(lireCandidature({ nom: " ", email: "a@b.fr", compte: "lea" })).toEqual({ erreur: "nom" });
    expect(lireCandidature({ nom: "Léa", email: "a@b.fr", compte: "" })).toEqual({ erreur: "compte" });
    expect(lireCandidature({ nom: "Léa", email: "a@b.fr", compte: "<script>alert(1)</script>" })).toEqual({ erreur: "compte" });
    expect(lireCandidature({ nom: "Léa", email: "a@b.fr", compte: "a".repeat(31) })).toEqual({ erreur: "compte" });
    expect(lireCandidature(null)).toEqual({ erreur: "email" });
  });
  it("piège à robots rempli : ignoré", () => {
    expect(lireCandidature({ nom: "Léa", email: "a@b.fr", compte: "lea", site: "http://spam" })).toEqual({ robot: true });
  });
  it("borne les longueurs", () => {
    const r = lireCandidature({ nom: "N".repeat(300), email: "a@b.fr", compte: "lea", niche: "x".repeat(100), message: "m".repeat(5000) });
    expect("cand" in r && [r.cand.nom.length, r.cand.niche.length, r.cand.message.length]).toEqual([80, 40, 1500]);
  });
});

describe("profil et tâche de candidature", () => {
  const cand = { email: "a@b.fr", nom: "Léa Martin", compte: "@lea.fit_", niche: "Fitness", message: "Je fais du CrossFit" };
  const now = new Date("2026-11-27T10:00:00Z");
  it("note datée, avec le message s'il y en a un", () => {
    expect(noteCandidature(cand, now)).toBe("Candidature via le site le 2026-11-27 : Je fais du CrossFit");
    expect(noteCandidature({ ...cand, message: "" }, now)).toBe("Candidature via le site le 2026-11-27");
  });
  it("profil du scouting créateurs", () => {
    expect(ligneScouting(cand, now)).toEqual({ name: "Léa Martin", handle: "@lea.fit_", email: "a@b.fr", tag: "Fitness", note: "Candidature via le site le 2026-11-27 : Je fais du CrossFit" });
    expect(ligneScouting({ ...cand, niche: "" }, now).tag).toBeNull();
  });
  it("tâche au format fixe", () => {
    expect(tacheCandidature(cand)).toBe("Candidature site : Léa Martin (@lea.fit_) veut rejoindre l'agence");
  });
});

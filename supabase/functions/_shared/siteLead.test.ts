import { describe, expect, it } from "vitest";
import { compteNettoye, handleScouting, ilikeExact, jourParis, ligneCandidature, ligneScouting, lireCandidature, lireCompte, lireLead, noteCandidature, noteFusionnee, tacheCandidature, tacheLead, toucheLead } from "./siteLead.ts";

describe("lireLead", () => {
  it("lit et nettoie une demande", () => {
    const r = lireLead({ email: " Anais@Kosbiotic.COM ", marque: "Kosbiotic<script>", nom: "Anaïs", message: "Campagne\nde janvier" });
    expect(r).toEqual({ lead: { email: "anais@kosbiotic.com", marque: "Kosbiotic script", nom: "Anaïs", message: "Campagne\nde janvier" } });
  });
  it("refuse sans email valable ou sans marque", () => {
    expect(lireLead({ email: "pas-un-mail", marque: "X" })).toEqual({ erreur: "email" });
    expect(lireLead({ email: "*@nakd.com", marque: "X" })).toEqual({ erreur: "email" });
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
  it("marque et message coupés sans casser d'emoji", () => {
    const r = lireLead({ email: "a@b.fr", marque: `${"m".repeat(79)}😀`, message: `${"z".repeat(1499)}😀` });
    expect("lead" in r && r.lead.marque).toBe("m".repeat(79));
    expect("lead" in r && r.lead.message).toBe("z".repeat(1499));
  });
});

describe("lireCompte", () => {
  it("lit le @, le nom seul ou le lien du profil, avec son réseau", () => {
    expect(lireCompte("@lea.fit_")).toEqual({ compte: "lea.fit_", reseau: "instagram" });
    expect(lireCompte("lea.fit_", "tiktok")).toEqual({ compte: "lea.fit_", reseau: "tiktok" });
    expect(lireCompte("https://www.instagram.com/lea.fit_/?hl=fr", "tiktok")).toEqual({ compte: "lea.fit_", reseau: "instagram" });
    expect(lireCompte("instagram.com/lea.fit_")).toEqual({ compte: "lea.fit_", reseau: "instagram" });
    expect(lireCompte("https://www.tiktok.com/@lea.fit_/video/123")).toEqual({ compte: "lea.fit_", reseau: "tiktok" });
    expect(lireCompte("https://www.instagram.com/stories/lea.fit_/3412/")).toEqual({ compte: "lea.fit_", reseau: "instagram" });
  });
  it("refuse le lien d'une publication et tout ce qui n'est pas un compte", () => {
    for (const v of ["https://www.instagram.com/p/C1abc/", "https://www.instagram.com/reel/C1abc/", "instagram.com/explore/tags/sport", "https://vm.tiktok.com/ZMabc/", "", "pas un compte", "<script>alert(1)</script>", "a".repeat(31)]) {
      expect(lireCompte(v)).toBeNull();
    }
  });
  it("compte nettoyé d'une ligne du scouting, pour comparer", () => {
    expect(compteNettoye("@Lea.Fit_")).toBe("lea.fit_");
    expect(compteNettoye("https://www.tiktok.com/@lea.fit_")).toBe("lea.fit_");
    expect(compteNettoye(null)).toBe("");
  });
});

describe("lireCandidature", () => {
  it("lit et nettoie une candidature", () => {
    expect(lireCandidature({ type: "createur", nom: " Léa  Martin ", email: " Lea@Mail.FR ", compte: "@lea.fit_", reseau: "tiktok", niche: "Fitness", message: "Bonjour\nJe fais du CrossFit <3" }))
      .toEqual({ cand: { email: "lea@mail.fr", nom: "Léa Martin", compte: "@lea.fit_", reseau: "tiktok", niche: "Fitness", message: "Bonjour\nJe fais du CrossFit  3" } });
  });
  it("refuse sans email, sans nom ou avec un compte invalide", () => {
    expect(lireCandidature({ nom: "Léa", email: "x", compte: "lea" })).toEqual({ erreur: "email" });
    expect(lireCandidature({ nom: "Léa", email: "*@b.fr", compte: "lea" })).toEqual({ erreur: "email" });
    expect(lireCandidature({ nom: " ", email: "a@b.fr", compte: "lea" })).toEqual({ erreur: "nom" });
    expect(lireCandidature({ nom: "Léa", email: "a@b.fr", compte: "https://www.instagram.com/p/C1abc/" })).toEqual({ erreur: "compte" });
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

describe("profil, note et tâche de candidature", () => {
  const cand = { email: "a@b.fr", nom: "Léa Martin", compte: "@lea.fit_", reseau: "instagram" as const, niche: "Fitness", message: "Je fais du CrossFit" };
  const now = new Date("2026-11-27T10:00:00Z");
  it("jour de Paris, même la nuit", () => {
    expect(jourParis(new Date("2026-11-27T23:30:00Z"))).toBe("2026-11-28");
    expect(jourParis(now)).toBe("2026-11-27");
  });
  it("note d'un nouveau profil, avec le réseau et le message", () => {
    expect(noteCandidature(cand, now)).toBe("Candidature via le site le 2026-11-27 (Instagram) : Je fais du CrossFit");
    expect(noteCandidature({ ...cand, message: "" }, now)).toBe("Candidature via le site le 2026-11-27 (Instagram)");
  });
  it("la note de l'agence reste entière et en tête, la ligne n'est ajoutée qu'une fois", () => {
    const agence = "Tarif 800 €. " + "Très bonne audience. ".repeat(200);
    const ligne = ligneCandidature(cand, now);
    const fusion = noteFusionnee(agence, ligne);
    expect(fusion.startsWith(agence.trim())).toBe(true);
    expect(fusion.endsWith(ligne)).toBe(true);
    expect(noteFusionnee(fusion, ligne)).toBe(fusion);
    expect(noteFusionnee(null, ligne)).toBe(ligne);
  });
  it("profil du scouting : @ pour Instagram, lien du profil pour TikTok", () => {
    expect(ligneScouting(cand, now)).toEqual({ name: "Léa Martin", handle: "@lea.fit_", email: "a@b.fr", tag: "Fitness", note: "Candidature via le site le 2026-11-27 (Instagram) : Je fais du CrossFit" });
    expect(handleScouting({ ...cand, reseau: "tiktok" })).toBe("https://www.tiktok.com/@lea.fit_");
    expect(ligneScouting({ ...cand, niche: "" }, now).tag).toBeNull();
  });
  it("tâche au format fixe, avec le réseau", () => {
    expect(tacheCandidature(cand)).toBe("Candidature site : Léa Martin (@lea.fit_, Instagram) veut rejoindre l'agence");
    expect(tacheCandidature({ ...cand, reseau: "tiktok" })).toBe("Candidature site : Léa Martin (@lea.fit_, TikTok) veut rejoindre l'agence");
  });
});

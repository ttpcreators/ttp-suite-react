import { describe, expect, it } from "vitest";
import { chercherProfil, compteNettoye, handleScouting, ilikeExact, jourParis, ligneAutreReseau, ligneCandidature, ligneScouting, lireCandidature, lireCompte, lireLead, noteCandidature, noteFusionnee, tacheCandidature, tacheLead, toucheLead } from "./siteLead.ts";

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
  it("même compte déjà au scouting sur l'autre réseau : les deux profils se citent", () => {
    const tiktok = { ...cand, reseau: "tiktok" as const };
    expect(ligneScouting(tiktok, now, true).note).toBe("Candidature via le site le 2026-11-27 (TikTok, même compte déjà au scouting sur Instagram) : Je fais du CrossFit");
    expect(ligneScouting({ ...cand, message: "" }, now, true).note).toBe("Candidature via le site le 2026-11-27 (Instagram, même compte déjà au scouting sur TikTok)");
    expect(ligneAutreReseau(tiktok, now)).toBe("Candidature via le site le 2026-11-27 avec son compte TikTok : Léa Martin, a@b.fr, profil TikTok ajouté au scouting, message dans la tâche");
    expect(ligneAutreReseau({ ...tiktok, message: "" }, now)).toBe("Candidature via le site le 2026-11-27 avec son compte TikTok : Léa Martin, a@b.fr, profil TikTok ajouté au scouting");
  });
  it("tâche au format fixe, avec le réseau", () => {
    expect(tacheCandidature(cand)).toBe("Candidature site : Léa Martin (@lea.fit_, Instagram) veut rejoindre l'agence");
    expect(tacheCandidature({ ...cand, reseau: "tiktok" })).toBe("Candidature site : Léa Martin (@lea.fit_, TikTok) veut rejoindre l'agence");
  });
});

describe("chercherProfil : le profil du même compte au scouting, sans doublon", () => {
  const cand = { email: "a@b.fr", nom: "Ana", compte: "@ana", reseau: "instagram" as const, niche: "", message: "" };
  /** Le scouting vu par site-lead : les lignes proches (filtre ilike de la base), lues dans l'ordre des id, page par page. */
  const scouting = (lignes: { handle: string | null; note?: string | null }[]) => {
    const rows = lignes.map((l, i) => ({ id: `id-${String(i).padStart(5, "0")}`, note: l.note ?? null, handle: l.handle }));
    return async (apres: string | null, taille: number) => ({ data: rows.filter((r) => apres === null || r.id > apres).slice(0, taille), error: null });
  };

  it("trouve le profil exact même derrière plus de 20 lignes proches", async () => {
    const proches = Array.from({ length: 1200 }, (_, i) => ({ handle: `@banana_${i}` }));
    const lirePage = scouting([...proches, { handle: "@Ana", note: "Note de l'agence" }]);
    expect(await chercherProfil(lirePage, cand)).toEqual({ profil: { id: "id-01200", note: "Note de l'agence", handle: "@Ana" } });
  });

  it("une lecture échouée n'est jamais prise pour « aucun profil »", async () => {
    const enPanne = async () => ({ data: null, error: { message: "délai dépassé" } });
    expect(await chercherProfil(enPanne, cand)).toEqual({ erreur: "délai dépassé" });
    const sansReponse = async () => ({ data: null, error: null });
    expect(await chercherProfil(sansReponse, cand)).toEqual({ erreur: "lecture" });
    const pagePleine = scouting(Array.from({ length: 500 }, (_, i) => ({ handle: `@banana_${i}` })));
    const panneEnPage2 = async (apres: string | null, taille: number) => (apres === null ? pagePleine(apres, taille) : { data: null, error: { message: "délai dépassé" } });
    expect(await chercherProfil(panneEnPage2, cand)).toEqual({ erreur: "délai dépassé" });
  });

  it("même compte sur l'autre réseau seulement : signalé à part, jamais pris pour le même profil", async () => {
    const tiktok = { ...cand, reseau: "tiktok" as const };
    expect(await chercherProfil(scouting([{ handle: "https://www.tiktok.com/@ana", note: "Vu sur TikTok" }]), cand)).toEqual({ autreReseau: { id: "id-00000", note: "Vu sur TikTok", handle: "https://www.tiktok.com/@ana" } });
    expect(await chercherProfil(scouting([{ handle: "@ana" }]), tiktok)).toEqual({ autreReseau: { id: "id-00000", note: null, handle: "@ana" } });
    const deux = scouting([{ handle: "https://www.tiktok.com/@ana" }, { handle: "instagram.com/ana/" }]);
    expect(await chercherProfil(deux, cand)).toEqual({ profil: { id: "id-00001", note: null, handle: "instagram.com/ana/" } });
    expect(await chercherProfil(deux, tiktok)).toEqual({ profil: { id: "id-00000", note: null, handle: "https://www.tiktok.com/@ana" } });
  });

  it("le profil du même réseau l'emporte, même lu plusieurs pages après celui de l'autre réseau", async () => {
    const lignes = Array.from({ length: 1200 }, (_, i) => ({ handle: `@banana_${i}` }));
    lignes[3] = { handle: "https://www.tiktok.com/@ana" };
    lignes[1100] = { handle: "@ANA" };
    expect(await chercherProfil(scouting(lignes), cand)).toEqual({ profil: { id: "id-01100", note: null, handle: "@ANA" } });
    lignes[1100] = { handle: "@banana_1100" };
    expect(await chercherProfil(scouting(lignes), cand)).toEqual({ autreReseau: { id: "id-00003", note: null, handle: "https://www.tiktok.com/@ana" } });
  });

  it("jusqu'à 10 000 lignes proches : réponse sûre ; au-delà, erreur plutôt qu'un doublon", async () => {
    const proches = (n: number) => scouting(Array.from({ length: n }, (_, i) => ({ handle: `@banana_${i}` })));
    expect(await chercherProfil(proches(10000), cand)).toEqual({ aucun: true });
    expect(await chercherProfil(proches(10001), cand)).toEqual({ erreur: "trop de lignes proches" });
  });

  it("ne lit jamais sans fin", async () => {
    let appels = 0;
    const sansFin = async (apres: string | null, taille: number) => {
      if (++appels > 100) throw new Error("lecture sans fin");
      const debut = apres === null ? 0 : Number(apres) + 1;
      return { data: Array.from({ length: taille }, (_, i) => ({ id: String(debut + i), note: null, handle: `@banana_${debut + i}` })), error: null };
    };
    expect(await chercherProfil(sansFin, cand)).toEqual({ erreur: "trop de lignes proches" });
    expect(appels).toBe(21);
  });
});

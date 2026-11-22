import { describe, expect, it } from "vitest";
import {
  appelsCorrection, appliquerCorrections, chiffresReels, compact, controlerKit, corrections, createursDuMail, jourIso, kitDeclare, piecesKit, refusProspection, ressembleKit, texteControle,
  type FicheRoster, type Mesure,
} from "./mediakitControle.ts";

const NOW = new Date("2026-11-22T10:00:00Z");
const kit = (...platforms: Record<string, string>[]) => ({ bio: "Coach à Lyon", platforms });

describe("contrôle des chiffres du media kit", () => {
  it("attrape un kit gonflé (210 K annoncés, 5,9 K réels)", () => {
    const c = controlerKit({ name: "Zoé Test", mediakit: kit({ key: "instagram", followers: "210000" }), ig: { followers: 5910, ok: "2026-11-22T05:20:00Z" } }, [], NOW);
    expect(c.etat).toBe("a_corriger");
    expect(c.aCorriger[0].texte).toBe("Instagram : kit 210 K, réel 5,9 K");
    expect(corrections(c)).toEqual([{ plateforme: "instagram", abonnes: 5910 }]);
  });

  it("laisse passer un petit écart (arrondi, croissance)", () => {
    const c = controlerKit({ name: "Zoé Test", mediakit: kit({ key: "instagram", followers: "12,3k" }), ig: { followers: 11000, ok: "2026-11-21T05:20:00Z" } }, [], NOW);
    expect(c.etat).toBe("ok");
    expect(c.lignes[0].ecart).toBeCloseTo(0.118, 2);
  });

  it("le seuil des abonnés est à 25 % du réel, dans les deux sens", () => {
    const at = (f: string) => controlerKit({ name: "Z", mediakit: kit({ key: "instagram", followers: f }), ig: { followers: 10000, ok: "2026-11-21" } }, [], NOW).etat;
    expect(at("12500")).toBe("ok");
    expect(at("12600")).toBe("a_corriger");
    expect(at("7500")).toBe("ok");
    expect(at("7000")).toBe("a_corriger");
  });

  it("sans chiffre réel, ou avec un chiffre trop vieux : à vérifier, jamais faux", () => {
    const sans = controlerKit({ name: "Zoé Test", mediakit: kit({ key: "tiktok", followers: "496000" }) }, [], NOW);
    expect(sans.etat).toBe("a_verifier");
    expect(sans.aVerifier[0].texte).toBe("TikTok : kit 496 K, aucun chiffre réel dans l'app");
    const vieux: Mesure[] = [{ creator: "zoé test", platform: "tiktok", followers: "12000", date: "04/07/2026" }];
    const v = controlerKit({ name: "Zoé Test", mediakit: kit({ key: "tiktok", followers: "496000" }) }, vieux, NOW);
    expect(v.etat).toBe("a_verifier");
    expect(v.aVerifier[0].texte).toContain("du 4 juil. (trop vieux)");
  });

  it("prend le chiffre réel le plus récent : relevé automatique ou mesure du calculateur", () => {
    const mesures: Mesure[] = [
      { creator: "Zoé Test", platform: "instagram", followers: "9900", er: "6,65 %", date: "02/11/2026" },
      { creator: "Zoé Test", platform: "tiktok", followers: "150000", er: "10,19 %", date: "02/11/2026" },
      { creator: "Zoé Test", platform: "tiktok", followers: "90000", date: "02/09/2026" },
    ];
    const r = chiffresReels({ name: "Zoé Test", ig: { followers: 90985, ok: "2026-11-22T14:30:00Z" }, tt: { followers: 140000, ok: "2026-10-01T05:00:00Z" } }, mesures);
    expect(r.instagram.abonnes).toMatchObject({ valeur: 90985, source: "relevé automatique" });
    expect(r.tiktok.abonnes).toMatchObject({ valeur: 150000, date: "2026-11-02", source: "mesure du calculateur" });
    expect(r.tiktok.engagement?.valeur).toBe(10.19);
  });

  it("engagement : seul un écart de plus de 50 % ET d'au moins un point est faux", () => {
    const m = (er: string): Mesure[] => [{ creator: "Z", platform: "instagram", er, followers: "10000", date: "05/11/2026" }];
    const base = { name: "Z", mediakit: kit({ key: "instagram", followers: "10000", er: "6,00%" }) };
    expect(controlerKit(base, m("3,5 %"), NOW).etat).toBe("a_corriger");
    expect(controlerKit(base, m("4,5 %"), NOW).etat).toBe("ok");
    const petit = { name: "Z", mediakit: kit({ key: "instagram", followers: "10000", er: "1,40%" }) };
    expect(controlerKit(petit, m("0,8 %"), NOW).etat).toBe("ok"); // 75 % d'écart mais 0,6 point
  });

  it("vues moyennes comparées aux relevés automatiques (TikTok)", () => {
    const c = controlerKit({ name: "Z", mediakit: kit({ key: "tiktok", followers: "50000", avgViews: "210000" }), tt: { followers: 50500, avgViews: 30000, ok: "2026-11-20" } }, [], NOW);
    expect(c.aCorriger.map((l) => l.texte)).toEqual(["TikTok (vues moyennes) : kit 210 K, réel 30 K"]);
    expect(corrections(c)).toEqual([{ plateforme: "tiktok", vues_moyennes: 30000 }]);
  });

  it("YouTube aux abonnés masqués : pas de chiffre réel", () => {
    const c = controlerKit({ name: "Z", mediakit: kit({ key: "youtube", followers: "30600" }), yt: { subscribers: 100, hiddenSubs: true, ok: "2026-11-20" } }, [], NOW);
    expect(c.etat).toBe("a_verifier");
  });

  it("sans kit ou kit sans chiffre : sans_kit", () => {
    expect(controlerKit({ name: "Z", mediakit: null }, [], NOW).etat).toBe("sans_kit");
    expect(controlerKit({ name: "Z", mediakit: { platforms: [{ key: "instagram" }] } }, [], NOW).etat).toBe("sans_kit");
  });

  it("les corrections s'appliquent au kit avec appliquerChiffres (rien d'autre ne bouge)", () => {
    const fiche = { name: "Z", mediakit: kit({ key: "instagram", followers: "210000", er: "9,00%" }), ig: { followers: 5910, ok: "2026-11-22" } };
    const c = controlerKit(fiche, [{ creator: "Z", platform: "instagram", er: "3,2 %", date: "10/11/2026" }], NOW);
    const r = appliquerCorrections(fiche.mediakit, c);
    if ("error" in r) throw new Error(r.error);
    const mk = r.mediakit;
    expect(r.changements).toEqual(["Instagram abonnés : 210000 → 5910", "Instagram engagement : 9,00% → 3,20%"]);
    expect(mk).toMatchObject({ bio: "Coach à Lyon", platforms: [{ key: "instagram", followers: "5910", er: "3,20%" }] });
    expect(controlerKit({ ...fiche, mediakit: mk }, [{ creator: "Z", platform: "instagram", er: "3,2 %", date: "10/11/2026" }], NOW).etat).toBe("ok");
  });

  it("textes pour Alfred", () => {
    const c = controlerKit({ name: "Zoé Test", mediakit: kit({ key: "instagram", followers: "210000" }, { key: "tiktok", followers: "496000" }), ig: { followers: 5910, ok: "2026-11-22" } }, [], NOW);
    const t = texteControle("Zoé Test", c);
    expect(t).toContain("À CORRIGER");
    expect(t).toContain("• Instagram : kit 210 K, réel 5,9 K");
    expect(t).toContain("• TikTok : kit 496 K, aucun chiffre réel");
    expect(appelsCorrection("Zoé Test", c)).toEqual(['maj_chiffres_mediakit(createur: "Zoé Test", plateforme: "instagram", abonnes: "5910")']);
  });

  it("formats", () => {
    expect(compact(5910)).toBe("5,9 K");
    expect(compact(210000)).toBe("210 K");
    expect(compact(1250000)).toBe("1,3 M");
    expect(jourIso("4/7/2026")).toBe("2026-07-04");
    expect(jourIso("2026-11-22T14:30:00Z")).toBe("2026-11-22");
    expect(jourIso("hier")).toBeNull();
  });
});

describe("garde-fou des mails de prospection", () => {
  const ROSTER: FicheRoster[] = [
    { name: "Zoé Test", email: "zoe@exemple.fr", handle: "@zoe.test", instagram: "https://instagram.com/zoe.test/", mediakit: { slug: "zoe" } },
    { name: "Marc Fictif", email_pro: "pro@fictif.fr", tiktok: "@marcfictif", mediakit: null },
    { name: "Léa Exemple", handle: "@lea", mediakit: {} },
  ];

  it("reconnaît le créateur par son nom, son alias, sa copie cachée, son @ ou son kit en ligne", () => {
    const noms = (i: Parameters<typeof createursDuMail>[1]) => createursDuMail(ROSTER, i).map((c) => c.name);
    expect(noms({ createur: "zoe test" })).toEqual(["Zoé Test"]);
    expect(noms({ alias: "Zoe <zoe@ttp.pro>", aliases: [{ creator: "ZOÉ TEST", alias: "zoe@ttp.pro" }] })).toEqual(["Zoé Test"]);
    expect(noms({ copies: ["PRO@fictif.fr"] })).toEqual(["Marc Fictif"]);
    expect(noms({ texte: "Bonjour, Zoé (@zoe.test) est coach." })).toEqual(["Zoé Test"]);
    expect(noms({ texte: "Voir @marcfictif et @lea." })).toEqual(["Marc Fictif", "Léa Exemple"]);
    expect(noms({ texte: "écrire à contact@lea.fr ou @leane" })).toEqual([]);
    expect(noms({ texte: "Son kit : https://ttpcreators.pro/mediakit/zoe/" })).toEqual(["Zoé Test"]);
    expect(noms({ slugs: ["zoe-2"] })).toEqual(["Zoé Test"]);
  });

  it("un mail écrit AU créateur ne le « propose » pas", () => {
    expect(createursDuMail(ROSTER, { a: ["zoe@exemple.fr"], texte: "Salut @zoe.test, voici ton kit" })).toEqual([]);
  });

  it("repère les media kits joints, du site ou hors de l'app", () => {
    expect(piecesKit([
      { url: "https://ttpcreators.pro/mediakit/zoe/media-kit.pdf" },
      { document: "mediakits/zoe-123.pdf" },
      { fil: "abc", nom: "Media Kit Zoé 2026.pdf" },
      { document: "Contrat Zoé.pdf" },
      { fil: "abc", nom: "KIT_presse.pdf" },
    ])).toEqual([
      { nom: "https://ttpcreators.pro/mediakit/zoe/media-kit.pdf", site: true, slug: "zoe" },
      { nom: "mediakits/zoe-123.pdf", site: false, slug: null },
      { nom: "Media Kit Zoé 2026.pdf", site: false, slug: null },
      { nom: "KIT_presse.pdf", site: false, slug: null },
    ]);
    expect(ressembleKit("devis-kitchen.pdf")).toBe(false);
  });

  it("refuse un kit faux, demande les chiffres d'un PDF hors de l'app, laisse passer le reste", () => {
    const faux = { name: "Zoé Test", mediakit: kit({ key: "instagram", followers: "210000" }), ig: { followers: 5910, ok: "2026-11-22" } };
    const bon = { ...faux, mediakit: kit({ key: "instagram", followers: "6000" }) };
    const ctl = (f: typeof faux) => controlerKit(f, [], NOW);
    const r1 = refusProspection([{ fiche: faux, controle: ctl(faux), kitHorsApp: false, declares: null }]);
    expect(r1).toContain("Instagram : kit 210 K, réel 5,9 K");
    expect(r1).toContain('maj_chiffres_mediakit(createur: "Zoé Test", plateforme: "instagram", abonnes: "5910")');
    expect(refusProspection([{ fiche: bon, controle: ctl(bon), kitHorsApp: false, declares: null }])).toBeNull();
    // PDF hors de l'app, sans ses chiffres : on les demande.
    const sansKit = { name: "Zoé Test", mediakit: null, ig: { followers: 5910, ok: "2026-11-22" } };
    expect(refusProspection([{ fiche: sansKit, controle: ctl(sansKit), kitHorsApp: true, declares: null }])).toContain("chiffres_kit");
    // … avec ses chiffres (210 K lus dans le PDF) : refusé ; avec les bons : accepté.
    const declare = (ig: string) => controlerKit({ ...sansKit, mediakit: kitDeclare({ instagram: ig, tiktok: "496000" }) }, [], NOW);
    expect(refusProspection([{ fiche: sansKit, controle: ctl(sansKit), kitHorsApp: true, declares: declare("210000") }])).toContain("le PDF joint annonce des chiffres faux");
    expect(refusProspection([{ fiche: sansKit, controle: ctl(sansKit), kitHorsApp: true, declares: declare("5,9k") }])).toBeNull();
  });
});

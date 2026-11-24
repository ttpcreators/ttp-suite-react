import { describe, expect, it } from "vitest";
import { compteDe, donneesBase, preparerComptes, raisonEchec, resumerProfil, texteProfil, type ProfilMeta } from "./profilInstagram.ts";

// Profil fictif (dépôt public : aucune vraie personne).
const meta: ProfilMeta = {
  username: "Zoe.Test", name: "Zoé Test", bio: "Running 🏃‍♀️ Lyon\nCollab : zoe@studio-zoe.fr\nMgmt @orbit_mgmt", website: "https://zoe.example",
  picture: "https://cdn.example/p.jpg", followers: 24500, following: 310, posts: 412,
  media: [{ at: "2026-11-20T10:00:00Z", likes: 900, comments: 30 }, { at: "2026-11-10T10:00:00Z", likes: null, comments: 4 }],
};

describe("profil Instagram", () => {
  it("nettoie une liste de @ (doublons, liens, illisibles, 100 au plus)", () => {
    expect(compteDe("https://www.instagram.com/Zoe.Test/?hl=fr")).toBe("zoe.test");
    const r = preparerComptes(["@Zoe.Test", "zoe.test", "pas un compte !", "", 3, "@nova_run"]);
    expect(r).toEqual({ comptes: ["zoe.test", "nova_run"], illisibles: ["pas un compte !"], enTrop: 0 });
    expect(preparerComptes(Array.from({ length: 105 }, (_, i) => `compte${i}`)).enTrop).toBe(5);
  });

  it("résume : email de la bio, dernier post, agence", () => {
    const r = resumerProfil(meta, { engagement: 3.79, parSemaine: 1.5 });
    expect(r).toMatchObject({ username: "zoe.test", email: "zoe@studio-zoe.fr", dernierPost: "2026-11-20T10:00:00Z", postsMesures: 1, engagement: 3.79 });
    expect(r.agence).toMatchObject({ agence: "oui", agence_nom: "@orbit_mgmt" });
    const t = texteProfil(r, Date.parse("2026-11-24T10:00:00Z"));
    expect(t).toContain("24,5 K abonnés");
    expect(t).toContain("il y a 4 j");
    expect(t).toContain("Agence : oui (@orbit_mgmt)");
  });

  it("données de la Base : chiffres remplacés, calculs du Sourcing gardés, plus « en attente »", () => {
    const r = resumerProfil(meta, { engagement: 3.79, parSemaine: 1.5 });
    const d = donneesBase({ v: 3, deals: ["marque.fictive"], isBrand: false, pending: true, followers: 1, agency: null }, r, "2026-11-24T10:00:00.000Z");
    expect(d).toMatchObject({ v: 3, deals: ["marque.fictive"], isBrand: false, followers: 24500, email: "zoe@studio-zoe.fr", agency: "@orbit_mgmt", agence: "oui", profilLu: "2026-11-24T10:00:00.000Z" });
    expect("pending" in d).toBe(false);
    // Sans email dans la bio : l'email déjà connu reste ; « à vérifier » garde l'indice du Sourcing.
    const r2 = resumerProfil({ ...meta, bio: "Booking en DM" }, { engagement: null, parSemaine: null }, undefined, "agence citée sur le site");
    const d2 = donneesBase({ email: "ancien@exemple.fr", agency: "agence citée sur le site" }, r2, "x");
    expect(d2).toMatchObject({ email: "ancien@exemple.fr", agency: "agence citée sur le site", agence: "a_verifier" });
  });

  it("raisons d'échec lisibles", () => {
    expect(raisonEchec("compte_perso")).toContain("comptes professionnels");
    expect(raisonEchec("meta_42")).toBe("erreur Meta (meta_42)");
  });
});

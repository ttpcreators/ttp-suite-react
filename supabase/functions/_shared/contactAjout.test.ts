import { describe, expect, it } from "vitest";
import { alerteMemeMarque, chercherDoublon, citerContact, cleMarque, compteInstagram, domaineSociete, lienLinkedin, lireContact, trierContacts, type ContactExistant } from "./contactAjout.ts";

const carnet: ContactExistant[] = [
  { id: "c1", brand: "Nova Paris", person: "Julie Martin", email: "julie@nova.fr", instagram: "@Nova.Paris", linkedin: "https://www.linkedin.com/in/julie-martin/" },
  { id: "c2", brand: "Atelier Lune", person: null, email: "atelierlune@gmail.com", instagram: null, linkedin: null },
  { id: "c3", brand: "K18 Hair", person: null, email: null, instagram: "@k18hair", linkedin: null },
];

describe("ajout de contacts par le connecteur Claude", () => {
  it("lit un compte Instagram, un lien LinkedIn, un domaine, une clé de marque", () => {
    expect(compteInstagram("https://www.instagram.com/Nova.Paris/?hl=fr")).toBe("@nova.paris");
    expect(compteInstagram("@@Nova.Paris")).toBe("@nova.paris");
    expect(compteInstagram("https://www.instagram.com/p/Cabc123/")).toBe("");
    expect(compteInstagram("pas un compte !")).toBe("");
    expect(lienLinkedin("fr.linkedin.com/in/julie-martin?trk=abc")).toBe("https://www.linkedin.com/in/julie-martin");
    expect(lienLinkedin("https://www.linkedin.com/company/nova/")).toBe("https://www.linkedin.com/company/nova");
    expect(lienLinkedin("https://exemple.fr/in/julie")).toBe("");
    expect(domaineSociete("Julie@Nova.fr")).toBe("nova.fr");
    expect(domaineSociete("atelierlune@gmail.com")).toBe("");
    expect(domaineSociete(null)).toBe("");
    expect(cleMarque("K18 Hair")).toBe(cleMarque("k18-hair"));
    expect(cleMarque("Éclat & Co")).toBe("eclatco");
  });

  it("nettoie une fiche et dit ce qu'elle a laissé vide", () => {
    const lu = lireContact({ marque: "  Nova   Paris ", prenom: "Zoé", nom: "Roux", role: "Influence", email: " Zoe@Nova.fr ", instagram: "instagram.com/nova.paris", linkedin: "pas un lien", ville: "Lyon", categorie: "brand", telephone: "06 00 00 00 00" });
    expect(lu).toEqual({
      c: { brand: "Nova Paris", person: "Zoé Roux", first_name: "Zoé", last_name: "Roux", role: "Influence", email: "zoe@nova.fr", instagram: "@nova.paris", phone: "06 00 00 00 00", linkedin: null, city: "Lyon", tag: "Marque", tone: "cyan" },
      remarques: ["lien LinkedIn illisible, laissé vide"],
    });
    const simple = lireContact({ marque: "Nova", personne: "Service presse" });
    expect("c" in simple && simple.c).toMatchObject({ person: "Service presse", first_name: null, last_name: null, tag: "Marque" });
  });

  it("refuse une fiche sans marque ou avec une adresse illisible", () => {
    expect(lireContact({ email: "zoe@nova.fr" })).toEqual({ erreur: "il manque la marque" });
    expect(lireContact({ marque: "Nova", email: "zoe chez nova" })).toEqual({ erreur: "adresse e-mail illisible (zoe chez nova)" });
    expect(lireContact("Nova")).toEqual({ erreur: "il manque la marque" });
    expect(lireContact(null)).toEqual({ erreur: "il manque la marque" });
  });

  it("reconnaît la même fiche : même e-mail, même LinkedIn, même @ sans autre adresse", () => {
    const base = { brand: "Autre nom", email: null, instagram: null, linkedin: null, phone: null };
    expect(chercherDoublon({ ...base, email: "julie@nova.fr" }, carnet).identique?.id).toBe("c1");
    expect(chercherDoublon({ ...base, linkedin: "https://www.linkedin.com/in/Julie-Martin" }, carnet).identique?.id).toBe("c1");
    expect(chercherDoublon({ ...base, instagram: "@nova.paris" }, carnet).identique?.id).toBe("c1");
    expect(chercherDoublon({ ...base, instagram: "@k18hair", email: "pro@k18.com" }, carnet).identique?.id).toBe("c3");
  });

  it("même marque, autre personne : on ajoute et on le dit", () => {
    const d = chercherDoublon({ brand: "nova paris", email: "zoe@nova.fr", instagram: "@nova.paris", linkedin: null, phone: null }, carnet);
    expect(d.identique).toBeNull();
    expect(d.memeMarque.map((e) => e.id)).toEqual(["c1"]);
    expect(alerteMemeMarque(d.memeMarque)).toBe("⚠ Cette marque a déjà 1 fiche(s) : Julie Martin · julie@nova.fr [contact c1]. Écrire à une seule personne de la marque à la fois.");
    // Même domaine de société, autre nom de marque.
    expect(chercherDoublon({ brand: "Nova Group", email: "presse@nova.fr", instagram: null, linkedin: null, phone: null }, carnet).memeMarque.map((e) => e.id)).toEqual(["c1"]);
    // Une messagerie grand public ne relie pas deux marques.
    expect(chercherDoublon({ brand: "Maison Soleil", email: "maisonsoleil@gmail.com", instagram: null, linkedin: null, phone: null }, carnet)).toEqual({ identique: null, memeMarque: [] });
  });

  it("même marque et rien de neuf pour la joindre : c'est la même fiche", () => {
    expect(chercherDoublon({ brand: "k18hair", email: null, instagram: null, linkedin: null, phone: null }, carnet).identique?.id).toBe("c3");
  });

  it("trie un lot : à créer, déjà là, refusées, doublons dans le lot", () => {
    const tri = trierContacts([
      { marque: "Maison Soleil", email: "contact@maisonsoleil.fr" },
      { marque: "Nova Paris", email: "julie@nova.fr" },
      { marque: "Maison Soleil", email: "CONTACT@maisonsoleil.fr" },
      { marque: "Maison Soleil", personne: "Inès Petit", email: "ines@maisonsoleil.fr" },
      { marque: "", email: "x@y.fr" },
      { marque: "Verso", email: "pas une adresse" },
    ], carnet);
    expect(tri.aCreer.map((x) => x.c.email)).toEqual(["contact@maisonsoleil.fr", "ines@maisonsoleil.fr"]);
    expect(tri.aCreer[0].memeMarque).toEqual([]);
    expect(tri.aCreer[1].memeMarque).toHaveLength(1);
    expect(alerteMemeMarque(tri.aCreer[1].memeMarque)).toContain("contact@maisonsoleil.fr (dans ce lot)");
    expect(tri.dejaLa.map((x) => [x.marque, x.existant.id])).toEqual([["Nova Paris", "c1"], ["Maison Soleil", ""]]);
    expect(tri.refuses).toEqual([{ marque: "fiche 5", raison: "il manque la marque" }, { marque: "Verso", raison: "adresse e-mail illisible (pas une adresse)" }]);
  });

  it("cite une fiche existante", () => {
    expect(citerContact(carnet[2])).toBe("K18 Hair [contact c3]");
    expect(alerteMemeMarque([])).toBe("");
  });
});

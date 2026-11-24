import { describe, expect, it } from "vitest";
import { adresseCloudflare, adresseSite, adressesDans, domaineDuSite, emailsDuSite, genreEmail, ligneEmailSite, pagesALire, reseauxDuSite, texteLisible } from "./siteMarque.ts";

describe("lire le site d'une marque", () => {
  it("n'accepte que des sites publics", () => {
    expect(adresseSite("Nova.fr/contact?x=1")).toBe("https://nova.fr");
    expect(adresseSite("https://www.Nova.fr")).toBe("https://www.nova.fr");
    expect(adresseSite("http://shop.nova.co.uk/a")).toBe("https://shop.nova.co.uk");
    expect(adresseSite("contact@nova.fr")).toBe("https://nova.fr");
    for (const refus of ["", "nova", "localhost", "http://127.0.0.1/", "http://192.168.1.10", "http://[::1]/", "https://nova.fr:8443", "https://user:pass@nova.fr", "ftp://nova.fr", "nova.local", "intranet.corp", "https://www.instagram.com/nova", "linkedin.com/company/nova", "x.com/nova", "t.me/nova", "nova .fr", "169.254.169.254"]) {
      expect(adresseSite(refus)).toBe("");
    }
    expect(adresseSite(null)).toBe("");
    expect(domaineDuSite("https://www.nova.fr")).toBe("nova.fr");
  });

  it("choisit les pages du même site, les plus utiles d'abord", () => {
    const html = `
      <a href="/collections/robes">Robes</a>
      <a href="/pages/cgv">Conditions générales</a>
      <a href="/pages/qui"> Mentions légales </a>
      <a class="x" href="/pages/contact">Nous écrire</a>
      <a href="https://www.nova.fr/pages/contact/">Contact</a>
      <a href="https://autre-site.fr/contact">Contact du partenaire</a>
      <a href="mailto:hello@nova.fr">Écrire</a>
      <a href="/pages/presse"><span>Presse</span></a>
      <a href="/pages/histoire">À propos</a>
      <a href="/pages/partenariats">Devenir partenaire</a>`;
    expect(pagesALire("nova.fr", html)).toEqual([
      "https://nova.fr/pages/contact", "https://nova.fr/pages/presse", "https://nova.fr/pages/partenariats", "https://nova.fr/pages/qui", "https://nova.fr/contact",
    ]);
    expect(pagesALire("https://www.nova.fr", "<p>rien</p>")).toEqual(["https://www.nova.fr/contact", "https://www.nova.fr/pages/contact", "https://www.nova.fr/mentions-legales"]);
    expect(pagesALire("localhost", html)).toEqual([]);
  });

  it("boutique Shopify : les pages de la société passent juste après le contact", () => {
    const html = `<link href="https://cdn.shopify.com/s/x.css"><a href="/pages/faq">Contact</a><a href="/policies/terms-of-service">Terms</a>`;
    expect(pagesALire("komono.com", html)).toEqual([
      "https://komono.com/pages/faq", "https://komono.com/policies/contact-information", "https://komono.com/policies/legal-notice", "https://komono.com/contact", "https://komono.com/pages/contact",
    ]);
  });

  it("décode une adresse masquée par Cloudflare", () => {
    const masquer = (email: string, cle = 0x5a) => cle.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ cle).toString(16).padStart(2, "0")).join("");
    const hex = masquer("info@nova.fr");
    expect(adresseCloudflare(hex)).toBe("info@nova.fr");
    expect(adresseCloudflare("zz")).toBe("");
    expect(adresseCloudflare("")).toBe("");
    expect(texteLisible(`<a href="/cdn-cgi/l/email-protection#${hex}">[email&#160;protected]</a>`)).toContain(" info@nova.fr ");
    expect(texteLisible(`<span class="__cf_email__" data-cfemail="${masquer("presse@nova.fr", 0x1f)}">x</span>`)).toContain(" presse@nova.fr ");
  });

  it("rend lisibles les adresses cachées simplement", () => {
    expect(texteLisible('<a href="mailto:presse%40nova.fr?subject=Bonjour">x</a>')).toContain(" presse@nova.fr ");
    expect(texteLisible("hello&#64;nova&#46;fr")).toContain("hello@nova.fr");
    expect(texteLisible("hello&#x40;nova.fr")).toContain("hello@nova.fr");
    expect(texteLisible("contact [at] nova (dot) fr")).toContain("contact@nova.fr");
  });

  it("lit les adresses d'un texte, vite même sur une très grosse page", () => {
    expect(adressesDans("Écrire à Hello@Nova.fr, ou presse@nova.fr. Pas logo@2x.png ni a@b ni @nova.fr, encore hello@nova.fr")).toEqual(["hello@nova.fr", "presse@nova.fr"]);
    expect(adressesDans("<p>contact@nova.fr.</p>(julie.martin+pro@nova.co.uk)")).toEqual(["contact@nova.fr", "julie.martin+pro@nova.co.uk"]);
    expect(adressesDans("")).toEqual([]);
    const debut = Date.now();
    const grosse = "x".repeat(400_000) + " contact@nova.fr " + " ".repeat(200_000) + "[at]" + "@".repeat(2_000) + "y".repeat(200_000) + "@nova.fr";
    expect(adressesDans(texteLisible(grosse))).toContain("contact@nova.fr");
    expect(Date.now() - debut).toBeLessThan(2000);
  });

  it("dit ce qu'est une adresse", () => {
    expect(genreEmail("partenariats@nova.fr")).toBe("partenariats");
    expect(genreEmail("presse@nova.fr")).toBe("partenariats");
    expect(genreEmail("pr@nova.fr")).toBe("partenariats");
    expect(genreEmail("contact@nova.fr")).toBe("general");
    expect(genreEmail("hello@nova.fr")).toBe("general");
    expect(genreEmail("sales@nova.fr")).toBe("general");
    expect(genreEmail("julie.martin@nova.fr")).toBe("nominative");
    expect(genreEmail("sav@nova.fr")).toBe("service client");
    expect(genreEmail("service-client@nova.fr")).toBe("service client");
    for (const inutile of ["noreply@nova.fr", "no-reply@nova.fr", "dpo@nova.fr", "rgpd@nova.fr", "recrutement@nova.fr", "jobs@nova.fr", "abuse@nova.fr", "3f2a9c1b7d4e5f60a1b2@nova.fr", "x@o123.ingest.sentry.io", "test@test.com", "nom@exemple.fr", "john.doe@nova.fr", "julie@yourdomain.com"]) {
      expect(genreEmail(inutile)).toBeNull();
    }
  });

  it("classe les adresses d'un site, les plus utiles d'abord", () => {
    const pages = [
      { url: "https://nova.fr/", html: 'Écrivez-nous : <a href="mailto:contact@nova.fr">contact@nova.fr</a> · SAV sav@nova.fr · logo@2x.png · noreply@nova.fr' },
      { url: "https://nova.fr/pages/presse", html: "Presse : presse&#64;nova.fr, agence : julie@agence-rp.fr, perso : novaparis@gmail.com, encore contact@nova.fr" },
    ];
    const r = emailsDuSite(pages, "nova.fr");
    expect(r.map((e) => e.email)).toEqual(["presse@nova.fr", "contact@nova.fr", "julie@agence-rp.fr", "novaparis@gmail.com", "sav@nova.fr"]);
    expect(r[0]).toEqual({ email: "presse@nova.fr", genre: "partenariats", duSite: true, page: "https://nova.fr/pages/presse" });
    expect(r[2].duSite).toBe(false);
    expect(ligneEmailSite(r[0])).toBe("- presse@nova.fr · partenariats ou presse · lue sur /pages/presse");
    expect(ligneEmailSite(r[1])).toBe("- contact@nova.fr · adresse générale · lue sur la page d'accueil");
    expect(ligneEmailSite(r[3])).toBe("- novaparis@gmail.com · adresse d'une personne · pas au nom du site · lue sur /pages/presse");
    expect(emailsDuSite([{ url: "https://shop.nova.fr/", html: "hello@nova.fr" }], "https://shop.nova.fr")[0].duSite).toBe(true);
    expect(emailsDuSite([], "nova.fr")).toEqual([]);
  });

  it("trouve le compte Instagram et la page LinkedIn liés depuis le site", () => {
    expect(reseauxDuSite([{ html: '<a href="https://www.instagram.com/p/Cabc/">post</a><a href="https://www.instagram.com/Nova.Paris/">IG</a><a href="https://fr.linkedin.com/company/nova-paris/about">LI</a>' }]))
      .toEqual({ instagram: "@nova.paris", linkedin: "https://www.linkedin.com/company/nova-paris" });
    expect(reseauxDuSite([{ html: "rien" }])).toEqual({ instagram: "", linkedin: "" });
  });
});

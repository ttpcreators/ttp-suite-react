import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { dossierAutorise, lireArgs, nbPages, nomDossier, urlPublique } from "../araignee.mjs";

describe("Alfred : l'araignée, seulement sur des pages publiques", () => {
  it("accepte une page web publique", () => {
    expect(urlPublique("https://www.marque.fr/presse")).toBe("https://www.marque.fr/presse");
    expect(urlPublique(" http://marque.com ")).toBe("http://marque.com/");
  });

  it("refuse le Mac, le réseau local, les identifiants et ce qui n'est pas une page web", () => {
    for (const u of ["http://localhost:3000", "http://127.0.0.1:47321/ping", "http://192.168.1.10", "http://10.0.0.2", "http://172.20.1.1",
      "http://169.254.169.254/latest", "http://[::1]/", "http://imac.local", "http://intranet", "file:///etc/hosts", "javascript:alert(1)",
      "https://moi:secret@marque.fr", "pas une adresse"]) {
      expect(() => urlPublique(u), u).toThrow();
    }
  });

  it("garde le tour de site entre 1 et 30 pages (15 par défaut)", () => {
    expect(nbPages(undefined)).toBe(15);
    expect(nbPages("8")).toBe(8);
    expect(nbPages("500")).toBe(30);
    expect(nbPages("0")).toBe(1);
    expect(() => nbPages("beaucoup")).toThrow(/nombre/);
  });

  it("range chaque tour de site dans un dossier daté au nom du site", () => {
    expect(nomDossier("https://www.Ma-Marque.fr/a/b", new Date(2026, 10, 16, 9, 5))).toBe("2026-11-16-0905-ma-marque-fr");
  });

  it("n'écrit dans la fenêtre de l'araignée que dans ses dossiers de scraping", () => {
    expect(dossierAutorise("/Users/x/.araignee/jobs/2026-11-16-marques", "/Users/x")).toBe("/Users/x/.araignee/jobs/2026-11-16-marques");
    for (const d of ["/Users/x/.araignee/jobs", "/Users/x/.araignee/jobs/../salle", "/Users/x/.araignee/jobs/a/b", "/tmp/jobs/a", "", undefined]) {
      expect(() => dossierAutorise(d, "/Users/x"), String(d)).toThrow();
    }
  });

  it("lit les options et refuse les inconnues", () => {
    expect(lireArgs(["https://a.fr", "--pages", "5"], ["--pages"], [])).toEqual({ opts: { "--pages": "5" }, libres: ["https://a.fr"] });
    expect(lireArgs(["d", "t", "--ecarte"], ["--url"], ["--ecarte"]).opts["--ecarte"]).toBe(true);
    expect(() => lireArgs(["--rm", "x"], [], [])).toThrow(/inconnue/);
    expect(() => lireArgs(["--pages"], ["--pages"], [])).toThrow(/valeur/);
  });
});

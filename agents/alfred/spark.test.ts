import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { boiteAutorisee, boiteDeLien, boiteDePortee, filtrerComptes, lireArgs, listeBoites, refusPortees } from "./spark.mjs";

const lien = (boite: string) =>
  `https://sparkmailapp.com/dpl/bl?token=${encodeURIComponent(Buffer.from(`A:${boite};ID:abc@mail.example.com;gID:123`).toString("base64"))}`;

describe("Alfred : Spark limité aux boîtes de TTP Creators", () => {
  const liste = listeBoites("contact.lea@example.com, Nova.Pro@example.com  pas-une-adresse");

  it("lit la liste des boîtes ajoutées (config.env), en minuscules, sans les valeurs invalides", () => {
    expect(liste).toEqual(["contact.lea@example.com", "nova.pro@example.com"]);
    expect(listeBoites(undefined)).toEqual([]);
  });

  it("autorise l'agence et la liste, refuse tout le reste", () => {
    expect(boiteAutorisee("partnerships@ttpcreators.pro", [])).toBe(true);
    expect(boiteAutorisee("Talent@TTPcreators.pro", [])).toBe(true);
    expect(boiteAutorisee("contact.lea@example.com", liste)).toBe(true);
    expect(boiteAutorisee("contact@autre-projet.app", liste)).toBe(false);
    expect(boiteAutorisee("x@ttpcreators.pro.autre.app", liste)).toBe(false);
    expect(boiteAutorisee("Inbox", liste)).toBe(false);
    expect(boiteAutorisee("", liste)).toBe(false);
  });

  it("trouve la boîte d'une portée de recherche", () => {
    expect(boiteDePortee("contact.lea@example.com:Archive")).toBe("contact.lea@example.com");
    expect(boiteDePortee("Inbox")).toBeNull();
    expect(boiteDePortee("Équipe:Sent")).toBeNull();
  });

  it("refuse une recherche sans boîte, dans un dossier commun ou hors liste", () => {
    expect(refusPortees([], liste)).toMatch(/précise la boîte/);
    expect(refusPortees(["Inbox"], liste)).toMatch(/n'est pas une boîte/);
    expect(refusPortees(["contact@autre-projet.app"], liste)).toMatch(/pas une boîte de TTP Creators/);
    expect(refusPortees(["partnerships@ttpcreators.pro:Archive", "nova.pro@example.com"], liste)).toBeNull();
  });

  it("lit la boîte d'un mail dans son lien Spark, et rien d'un lien illisible", () => {
    expect(boiteDeLien(lien("Contact.Lea@example.com"))).toBe("contact.lea@example.com");
    expect(boiteDeLien("https://sparkmailapp.com/dpl/bl?token=%%%")).toBeNull();
    expect(boiteDeLien("pas un lien")).toBeNull();
    expect(boiteDeLien("https://sparkmailapp.com/dpl/bl")).toBeNull();
  });

  it("accepte seulement les options prévues, et refuse supprimer, partager ou envoyer", () => {
    expect(lireArgs("search", ["Nova", "--in", "a@ttpcreators.pro", "--filter=newer_than:2d", "--json"])).toEqual({
      opts: { "--in": ["a@ttpcreators.pro"], "--filter": ["newer_than:2d"], "--json": true },
      libres: ["Nova"],
    });
    expect(lireArgs("draft", ["--account", "a@ttpcreators.pro", "--to", "x@y.fr", "--to", "z@y.fr"]).opts["--to"]).toEqual(["x@y.fr", "z@y.fr"]);
    for (const o of ["--delete", "--team", "--user", "--allow-send", "--attach-stream", "--unshare"]) {
      expect(() => lireArgs("draft", [o, "1"])).toThrow(/option refusée/);
    }
    expect(() => lireArgs("search", ["--in"])).toThrow(/attend une valeur/);
    expect(() => lireArgs("action", ["archive"])).toThrow(/non autorisée/);
    expect(() => lireArgs("attachment", ["1", "--stream"])).toThrow(/option refusée/);
  });

  it("ne montre que les boîtes autorisées dans la liste des comptes", () => {
    const donnees = {
      accounts: [
        { email: "partnerships@ttpcreators.pro", access: "read-only" },
        { email: "contact@autre-projet.app", access: "triage" },
        { email: "contact.lea@example.com", access: "triage", shared_inboxes: [{ email: "x@autre-projet.app" }, { email: "talent@ttpcreators.pro" }] },
      ],
    };
    const r = filtrerComptes(donnees, liste);
    expect(r.accounts.map((a: { email: string }) => a.email)).toEqual(["partnerships@ttpcreators.pro", "contact.lea@example.com"]);
    expect(r.accounts[1].shared_inboxes).toEqual([{ email: "talent@ttpcreators.pro" }]);
  });
});

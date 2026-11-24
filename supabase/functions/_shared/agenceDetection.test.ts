import { describe, expect, it } from "vitest";
import { AGENCES_CONNUES, agencesAvecSuivies, comptesCites, detecterAgence, texteAgence } from "./agenceDetection.ts";

// Comptes et agences fictifs (dépôt public : aucune vraie personne).
describe("détection d'agence", () => {
  it("agence connue : @ cité, domaine de l'email ou du site", () => {
    const agences = agencesAvecSuivies(AGENCES_CONNUES, [{ username: "agence.lumiere", name: "Lumière Agency" }, { username: "ttpcreators", self: true }]);
    expect(detecterAgence({ username: "zoe.test", bio: "Lifestyle 📍Lyon\nMgmt @agence.lumiere" }, agences)).toEqual({ agence: "oui", agence_nom: "Lumière Agency", indices: ["@agence.lumiere cité dans la bio"] });
    expect(detecterAgence({ bio: "Collab : contact@ttpcreators.pro" }).agence_nom).toBe("TTP Creators");
    expect(detecterAgence({ bio: "Mode", website: "https://www.imgmodels.com/x" }).agence_nom).toBe("IMG Models");
  });

  it("email sur un domaine d'agence, jamais sur une messagerie gratuite", () => {
    expect(detecterAgence({ bio: "📩 zoe@etoile-talents.fr" })).toMatchObject({ agence: "oui", agence_nom: "etoile-talents.fr" });
    expect(detecterAgence({ email: "booking@nova-management.com" })).toMatchObject({ agence: "oui", agence_nom: "nova-management.com" });
    // Le mot « booking » est dans l'adresse, pas dans le domaine : gratuit = pas une agence.
    expect(detecterAgence({ bio: "booking.zoe@gmail.com" }).agence).toBe("a_verifier");
    expect(detecterAgence({ bio: "hello@zoe-creations.fr" }).agence).toBe("non");
  });

  it("@ d'agence cité dans la bio (sauf son propre compte)", () => {
    expect(detecterAgence({ username: "zoe.test", bio: "Représentée par @orbit_mgmt" })).toMatchObject({ agence: "oui", agence_nom: "@orbit_mgmt" });
    expect(detecterAgence({ username: "talents.zoe", bio: "Fan de sport @talents.zoe" }).agence).toBe("non");
  });

  it("« représentée par X » donne le nom ; « management : moi@gmail » reste à vérifier", () => {
    expect(detecterAgence({ bio: "Créatrice food\nReprésentée par Maison Orbite, Paris" })).toMatchObject({ agence: "oui", agence_nom: "Maison Orbite" });
    expect(detecterAgence({ bio: "managed by Studio Nord | collabs" })).toMatchObject({ agence: "oui", agence_nom: "Studio Nord" });
    const soi = detecterAgence({ bio: "Management : zoe.pro@gmail.com" });
    expect(soi.agence).toBe("a_verifier");
    expect(soi.agence_nom).toBeNull();
  });

  it("un mot seul ou un indice du Sourcing : à vérifier", () => {
    expect(detecterAgence({ bio: "Booking & collabs en DM" })).toMatchObject({ agence: "a_verifier", agence_nom: null });
    expect(detecterAgence({ bio: "Running", indiceSourcing: "agence citée sur le site" })).toMatchObject({ agence: "a_verifier" });
    expect(detecterAgence({ bio: "Running et pâtisserie, Lyon" })).toEqual({ agence: "non", agence_nom: null, indices: [] });
  });

  it("textes pour Claude et comptes cités", () => {
    expect(texteAgence({ agence: "oui", agence_nom: "Studio Nord", indices: [] })).toBe("oui (Studio Nord)");
    expect(texteAgence({ agence: "a_verifier", agence_nom: null, indices: ["« booking »"] })).toBe("à vérifier (« booking »)");
    expect(texteAgence({ agence: "non", agence_nom: null, indices: [] })).toBe("non");
    expect(comptesCites("Mgmt @Orbit_Mgmt. et @zoe.test, mail a@b.fr")).toEqual(["orbit_mgmt", "zoe.test"]);
  });
});

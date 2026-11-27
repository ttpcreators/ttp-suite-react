import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aideFaite,
  departParLien,
  DUREE_STATE_LIEN_MS,
  dureeState,
  ECHECS_AVANT_AIDE,
  FAIT_PAR_AIDE,
  fautAide,
  ligneAide,
  messageExpire,
  prenomAide,
  ratesRecents,
  stateExpire,
  texteAide,
  titreAide,
} from "./igRetour.ts";
import { STATE_TTL_MS } from "./state.ts";

const now = Date.parse("2026-11-27T12:00:00Z");
const MIN = 60_000;
const essai = (minutesAvant: number, ok = false) => ({ at: new Date(now - minutesAvant * MIN).toISOString(), ok });

describe("temps accepté au retour d'Instagram", () => {
  it("30 min pour un départ par lien (anciens et nouveaux jetons), 10 min depuis l'app", () => {
    expect(DUREE_STATE_LIEN_MS).toBe(30 * MIN);
    expect(STATE_TTL_MS).toBe(10 * MIN);
    expect(dureeState("lien")).toBe(30 * MIN);
    expect(dureeState("lien:1764240000000")).toBe(30 * MIN);
    expect(dureeState("espace")).toBe(10 * MIN);
    expect(dureeState("agence")).toBe(10 * MIN);
    expect(dureeState(undefined)).toBe(10 * MIN);
    expect(departParLien("lienx")).toBe(false);
  });
  it("un créateur parti d'un lien a 30 min pour revenir, plus 10 min depuis l'app", () => {
    expect(stateExpire({ iat: now - 25 * MIN, via: "lien:1764240000000" }, now)).toBe(false);
    expect(stateExpire({ iat: now - 31 * MIN, via: "lien:1764240000000" }, now)).toBe(true);
    expect(stateExpire({ iat: now - 9 * MIN, via: "espace" }, now)).toBe(false);
    expect(stateExpire({ iat: now - 11 * MIN, via: "espace" }, now)).toBe(true);
  });
  it("le message noté dit le vrai temps", () => {
    expect(messageExpire("lien:1764240000000")).toBe("state_expired (plus de 30 minutes entre le départ et le retour)");
    expect(messageExpire("agence")).toBe("state_expired (plus de 10 minutes entre le départ et le retour)");
  });
});

describe("tâche « Aider … à connecter Instagram »", () => {
  it("titre avec le prénom (premier mot, majuscule puis minuscules)", () => {
    expect(prenomAide("CRÉATRICE A")).toBe("Créatrice");
    expect(prenomAide("  éclair  test ")).toBe("Éclair");
    expect(prenomAide("")).toBe("le créateur");
    expect(titreAide("CRÉATRICE A")).toBe("Aider Créatrice à connecter Instagram");
  });
  it("due après 2 essais ratés en 24 h, depuis la dernière réussite", () => {
    expect(ECHECS_AVANT_AIDE).toBe(2);
    expect(fautAide([essai(0), essai(1)], now)).toBe(true);
    expect(fautAide([essai(0)], now)).toBe(false);
    expect(fautAide([essai(0), essai(60, true), essai(120)], now)).toBe(false);
    expect(fautAide([essai(0), essai(25 * 60)], now)).toBe(false);
    expect(ratesRecents([essai(0), essai(1), essai(2), essai(30 * 60)], now)).toBe(3);
  });
  it("interne : jamais visible par le créateur, sans étiquette Claude, la description dit où trouver sa fiche", () => {
    const l = ligneAide({ nom: "CRÉATRICE A", rates: 2, now: new Date("2026-11-27T23:30:00Z") });
    expect(l).toMatchObject({
      text: "Aider Créatrice à connecter Instagram",
      creator: "CRÉATRICE A",
      creators: ["CRÉATRICE A"],
      tag: "CRÉATEUR",
      source: "agency",
      status: "À faire",
      done: false,
      visible_createur: false,
      due: "2026-11-28",
    });
    expect("pour_createur" in l).toBe(false);
    expect(String(l.tag)).not.toMatch(/claude/i);
    expect(String(l.descr)).toContain("2 essais ratés en 24 h");
    expect(String(l.descr)).toContain("Roster › fiche de Créatrice › carte Instagram");
    expect(String(l.descr)).toContain("Testeur Instagram");
    expect(String(l.descr)).not.toMatch(/[—–]/);
  });
  it("sans pièce jointe : la To-do prendrait un lien vers une fiche pour un fichier", () => {
    // Todo.tsx (openAttachment) n'ouvre que les liens « /?open=mails » et les adresses http(s) ;
    // tout autre chemin part vers le stockage des fichiers et échoue.
    const l = ligneAide({ nom: "CRÉATRICE A", rates: 2, now: new Date("2026-11-27T12:00:00Z") });
    expect("attachments" in l).toBe(false);
    expect(texteAide(3, "")).toContain("sa fiche du Roster, carte Instagram");
  });
  it("cochée toute seule à la connexion réussie, la description gardée", () => {
    const f = aideFaite("Détail d'avant", new Date("2026-11-27T12:00:00Z"));
    expect(f).toMatchObject({ done: true, status: "Fait", done_by: FAIT_PAR_AIDE, done_at: "2026-11-27T12:00:00.000Z" });
    expect(f.descr).toBe("Détail d'avant\n\nCochée toute seule le 27 nov. : Instagram connecté.");
    expect(aideFaite(null, new Date("2026-11-27T12:00:00Z")).descr).toBe("Cochée toute seule le 27 nov. : Instagram connecté.");
  });
});

describe("page de fin du lien (public/instagram-relie)", () => {
  it("explique qu'un « refus » peut venir d'un écran d'erreur de Meta", () => {
    const html = readFileSync(new URL("../../../public/instagram-relie/index.html", import.meta.url), "utf8");
    expect(html).toContain("refus: \"Instagram t'a montré une erreur au lieu du bouton « Autoriser » ?");
    expect(html).toContain("if (Object.prototype.hasOwnProperty.call(AIDE, code)) para([AIDE[code]]);");
  });
});

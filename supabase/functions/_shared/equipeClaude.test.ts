import { describe, expect, it } from "vitest";
import { ligneActionEquipe } from "./equipeClaude.ts";

describe("ce que l'équipe fait par son Claude", () => {
  it("résume un brouillon de mail", () => {
    const s = JSON.stringify({ a: "adele@exemple.fr", boite: "partnerships", message: "Hello Adèle,\n\nJ'espère que tu vas bien." });
    expect(ligneActionEquipe("creer_brouillon_mail", s)).toBe("brouillon (partnerships) à adele@exemple.fr · Hello Adèle, J'espère que tu vas bien.…");
  });
  it("lit un résumé coupé en plein milieu", () => {
    const s = '{"a":"mandy@exemple.fr","boite":"talent","message":"Hello Mandy, C\'est Marc, de TTP Cre';
    expect(ligneActionEquipe("creer_brouillon_mail", s)).toContain("brouillon (talent) à mandy@exemple.fr");
  });
  it("résume un contact et une tâche", () => {
    expect(ligneActionEquipe("ajouter_contact", JSON.stringify({ nom: "Louna Test", marque: "Agence Test" }))).toBe("contact ajouté : Louna Test, Agence Test");
    expect(ligneActionEquipe("creer_tache", JSON.stringify({ texte: "Relancer Nova" }))).toBe("tâche créée : Relancer Nova");
  });
});

import { doublonEquipe } from "./equipeClaude.ts";

describe("pas de doublon de message dans l'équipe", () => {
  const l = (summary: object | string, qui = "Gianni") => ({ tool: "creer_brouillon_mail", summary: typeof summary === "string" ? summary : JSON.stringify(summary), at: "2026-11-25T20:00:00Z", qui });
  it("trouve un nouveau mail au même destinataire", () => {
    expect(doublonEquipe([l({ a: "Adele@Exemple.fr", boite: "partnerships" })], ["adele@exemple.fr"], "")?.qui).toBe("Gianni");
  });
  it("lit un résumé coupé", () => {
    expect(doublonEquipe([l('{"a":"mandy@exemple.fr","boite":"talent","message":"Hello Ma')], ["mandy@exemple.fr"], "")).not.toBeNull();
  });
  it("ne confond pas une réponse dans un fil avec un premier mail", () => {
    expect(doublonEquipe([l({ a: "adele@exemple.fr", fil: "abc123" })], ["adele@exemple.fr"], "")).toBeNull();
    expect(doublonEquipe([l({ a: "adele@exemple.fr", fil: "abc123" })], ["adele@exemple.fr"], "abc123")).not.toBeNull();
    expect(doublonEquipe([l({ a: "autre@exemple.fr" })], ["adele@exemple.fr"], "")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { auteurDuMessage, auteursDuFil, nomLigne, prenom, type SendLogRow } from "./sentBy";

const G = "11111111-1111-1111-1111-111111111111";
const M = "22222222-2222-2222-2222-222222222222";
const row = (p: Partial<SendLogRow>): SendLogRow => ({ thread_id: null, gmail_message_id: null, created_at: null, envoye_par: null, envoye_par_nom: null, ...p });
const T0 = Date.parse("2026-11-25T10:00:00Z");

describe("prenom et nomLigne", () => {
  it("garde le prénom", () => {
    expect(prenom("Gianni.V")).toBe("Gianni");
    expect(prenom("marc.test")).toBe("Marc");
    expect(prenom("  ")).toBe("");
    expect(prenom(null)).toBe("");
  });
  it("préfère le nom réglé aujourd'hui", () => {
    const names = new Map([[G, "Gianni.V"]]);
    expect(nomLigne(row({ envoye_par: G, envoye_par_nom: "ancien" }), names)).toBe("Gianni");
    expect(nomLigne(row({ envoye_par: M, envoye_par_nom: "Marc.M" }), names)).toBe("Marc");
  });
});

describe("auteurDuMessage", () => {
  const rows = [
    row({ thread_id: "t1", gmail_message_id: "m1", created_at: "2026-11-25T10:00:05Z", envoye_par: G, envoye_par_nom: "Gianni.V" }),
    row({ thread_id: "t2", created_at: "2026-11-25T10:00:30Z", envoye_par: M, envoye_par_nom: "Marc.M" }),
    row({ thread_id: "t3", gmail_message_id: "m3", created_at: "2026-11-25T10:00:00Z" }),
  ];
  it("par l'id Gmail", () => {
    expect(auteurDuMessage({ id: "m1", threadId: "t1", ts: 0 }, rows)).toBe("Gianni");
  });
  it("par le fil et l'heure (moins de 3 minutes)", () => {
    expect(auteurDuMessage({ id: "x", threadId: "t2", ts: T0 }, rows)).toBe("Marc");
    expect(auteurDuMessage({ id: "x", threadId: "t2", ts: T0 + 10 * 60_000 }, rows)).toBe("");
  });
  it("un mail envoyé depuis Gmail plus tard dans le fil n'est pas attribué", () => {
    expect(auteurDuMessage({ id: "autre", threadId: "t1", ts: T0 + 60_000 }, rows)).toBe("");
  });
  it("ligne sans auteur : rien", () => {
    expect(auteurDuMessage({ id: "m3", threadId: "t3", ts: T0 }, rows)).toBe("");
  });
  it("fil inconnu ou heure absente : rien", () => {
    expect(auteurDuMessage({ id: "", threadId: "t9", ts: T0 }, rows)).toBe("");
    expect(auteurDuMessage({ id: "", threadId: "t2", ts: 0 }, rows)).toBe("");
  });
});

describe("auteursDuFil", () => {
  it("liste les personnes sans doublon", () => {
    const rows = [
      row({ thread_id: "t1", envoye_par: G, envoye_par_nom: "Gianni.V" }),
      row({ thread_id: "t1", envoye_par: G, envoye_par_nom: "Gianni.V" }),
      row({ thread_id: "t1", envoye_par: M, envoye_par_nom: "Marc.M" }),
      row({ thread_id: "t2", envoye_par: M, envoye_par_nom: "Marc.M" }),
    ];
    expect(auteursDuFil("t1", rows)).toEqual(["Gianni", "Marc"]);
    expect(auteursDuFil("t3", rows)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { RDV_DEFAUT, creneauOk, creneauxLibres, instantParis, lireRdv, lireReservation, paris, quandFr } from "./rdv.ts";

const cfg = { ...RDV_DEFAUT, actif: true }; // mardi 14 h-18 h, jeudi 9 h-12 h 30, 30 min, 20 h de délai
// Dimanche 22 novembre 2026, 16 h à Paris (15 h UTC).
const NOW = new Date("2026-11-22T15:00:00Z");

describe("heure de Paris", () => {
  it("instant d'une heure de Paris, hiver et été", () => {
    expect(new Date(instantParis("2026-11-24", "14:00")).toISOString()).toBe("2026-11-24T13:00:00.000Z");
    expect(new Date(instantParis("2027-06-15", "14:00")).toISOString()).toBe("2027-06-15T12:00:00.000Z");
  });
  it("jour de la semaine", () => {
    expect(paris(new Date("2026-11-24T13:00:00Z"))).toMatchObject({ jour: "2026-11-24", semaine: 2, heure: "14:00" });
  });
});

describe("creneauxLibres", () => {
  const c = creneauxLibres(cfg, NOW, []);
  it("mardi après-midi et jeudi matin, toutes les 30 min, dans l'ordre", () => {
    expect(c[0]).toMatchObject({ jour: "2026-11-24", heure: "14:00" });
    expect(c.filter((x) => x.jour === "2026-11-24").map((x) => x.heure)).toEqual(["14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"]);
    expect(c.filter((x) => x.jour === "2026-11-26").map((x) => x.heure)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
    expect(c.every((x) => ["2026-11-24", "2026-11-26", "2026-12-01", "2026-12-03"].includes(x.jour))).toBe(true);
  });
  it("retire les rendez-vous déjà pris (même partiellement)", () => {
    const occupe = [{ debut: instantParis("2026-11-24", "14:15"), fin: instantParis("2026-11-24", "15:00") }];
    const mardi = creneauxLibres(cfg, NOW, occupe).filter((x) => x.jour === "2026-11-24").map((x) => x.heure);
    expect(mardi).not.toContain("14:00");
    expect(mardi).not.toContain("14:30");
    expect(mardi[0]).toBe("15:00");
  });
  it("respecte le délai minimum", () => {
    const lundiSoir = new Date("2026-11-23T19:00:00Z"); // 20 h à Paris : mardi 14 h est à 18 h, sous 20 h
    expect(creneauxLibres(cfg, lundiSoir, [])[0]).toMatchObject({ jour: "2026-11-24", heure: "16:00" });
  });
  it("creneauOk", () => {
    expect(creneauOk(cfg, NOW, [], "2026-11-24", "14:30")).toBe(true);
    expect(creneauOk(cfg, NOW, [], "2026-11-24", "14:15")).toBe(false);
    expect(creneauOk(cfg, NOW, [], "2026-11-25", "14:00")).toBe(false);
  });
});

describe("lireRdv et lireReservation", () => {
  it("réglages tolérants, inactif par défaut", () => {
    expect(lireRdv(null)).toEqual(RDV_DEFAUT);
    expect(lireRdv({ actif: true, plages: [{ jour: 9, debut: "x", fin: "y" }], duree: 5 })).toMatchObject({ actif: true, plages: [], duree: 30 });
  });
  it("réservation nettoyée, robot ignoré", () => {
    expect(lireReservation({ jour: "2026-11-24", heure: "14:30", nom: "Julie", email: "Julie@Nakd.com", marque: "Nakd<b>", message: "Campagne janvier" }))
      .toEqual({ r: { jour: "2026-11-24", heure: "14:30", nom: "Julie", email: "julie@nakd.com", marque: "Nakd b", message: "Campagne janvier" } });
    expect(lireReservation({ site: "x" })).toEqual({ robot: true });
    expect(lireReservation({ jour: "2026-11-24", heure: "14:30", nom: "J", email: "pas-un-mail", marque: "N" })).toEqual({ erreur: "email" });
  });
  it("quandFr", () => {
    expect(quandFr("2026-11-24", "14:30")).toBe("mardi 24 novembre à 14 h 30");
    expect(quandFr("2026-11-24", "14:00")).toBe("mardi 24 novembre à 14 h");
  });
});

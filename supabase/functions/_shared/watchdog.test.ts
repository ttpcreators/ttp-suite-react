import { describe, expect, it } from "vitest";
import { parisNow, veilleAlfred } from "./watchdog.ts";

// Lundi 9 novembre 2026 (hiver : Paris = UTC+1).
const lundi = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00+01:00`);

describe("alerte si Alfred tombe", () => {
  it("lit l'heure de Paris", () => {
    expect(parisNow(lundi("10:30"))).toEqual({ jour: 1, date: "2026-11-09", minutes: 630 });
    expect(parisNow(new Date("2026-11-08T12:00:00+01:00")).jour).toBe(7);
  });

  it("ne dit rien le week-end ni trop tôt", () => {
    expect(veilleAlfred(new Date("2026-11-08T11:00:00+01:00"), []).etat).toBe("weekend");
    expect(veilleAlfred(lundi("10:00"), []).etat).toBe("trop_tot");
  });

  it("voit qu'Alfred a travaillé ce matin", () => {
    const rows = [{ action: "Point du matin", cree_le: "2026-11-09T09:12:00+01:00" }];
    expect(veilleAlfred(lundi("10:40"), rows).etat).toBe("ok");
    // Sa session suffit (il a démarré, même sans point noté)
    expect(veilleAlfred(lundi("10:40"), [{ action: "agent_session", cree_le: "2026-11-09T09:01:00+01:00" }]).etat).toBe("ok");
  });

  it("alerte une seule fois quand rien n'est noté ce matin", () => {
    const hier = [{ action: "Point du soir", cree_le: "2026-11-06T17:10:00+01:00" }, { action: "x", cree_le: "2026-11-09T07:00:00+01:00" }];
    const r = veilleAlfred(lundi("10:40"), hier);
    expect(r.etat).toBe("alerte");
    expect(r.message).toContain("iMac");
    expect(veilleAlfred(lundi("11:40"), [...hier, { action: "veille_alfred", cree_le: "2026-11-09T10:40:00+01:00" }]).etat).toBe("deja_alerte");
  });
});

import { describe, expect, it } from "vitest";
import { doublonPlanning, motsCles } from "./planningDoublon.ts";

const ev = (id: string, date: string, time: string | null, title: string, extra: Record<string, string> = {}) => ({ id, date, time, title, ...extra });

describe("planning : doublons et chevauchements", () => {
  it("garde les mots qui portent le sujet", () => {
    expect([...motsCles("Call Visio avec Lorna (Seoni) · rdv")]).toEqual(["lorna", "seoni"]);
  });

  it("repère le même rendez-vous écrit autrement", () => {
    const list = [ev("a", "2026-11-12", "15:00", "Call Seoni × Candice")];
    expect(doublonPlanning(list, { date: "2026-11-12", time: "15:30", title: "Visio Seoni" }).doublon?.id).toBe("a");
    // Par l'adresse de l'invité notée dans l'évènement
    const avecMail = [ev("b", "2026-11-12", "10:00", "Point marque", { description: "Invités : lorna@lornawood.fr" })];
    expect(doublonPlanning(avecMail, { date: "2026-11-12", time: "10:00", title: "Rendez-vous Lorna Consulting", emails: ["Lorna@lornawood.fr"] }).doublon?.id).toBe("b");
    // Le même créateur, sans mot en commun
    const meme = [ev("c", "2026-11-12", "18:00", "Tournage", { who: "Léna Pasquale" })];
    expect(doublonPlanning(meme, { date: "2026-11-12", time: "18:30", title: "Shoot Yade", who: "Lena Pasquale" }).doublon?.id).toBe("c");
  });

  it("ne confond pas deux rendez-vous différents, et signale un chevauchement", () => {
    const list = [ev("a", "2026-11-12", "15:00", "Call Seoni"), ev("b", "2026-11-13", "15:00", "Call Nakd")];
    const r = doublonPlanning(list, { date: "2026-11-12", time: "15:30", title: "Visio Nike" });
    expect(r.doublon).toBeNull();
    expect(r.chevauche?.id).toBe("a");
    expect(doublonPlanning(list, { date: "2026-11-12", time: "18:00", title: "Call Seoni" }).doublon).toBeNull();
    expect(doublonPlanning(list, { date: "2026-11-14", time: "15:00", title: "Call Seoni" })).toEqual({ doublon: null, chevauche: null });
  });
});

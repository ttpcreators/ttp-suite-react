import { describe, expect, it } from "vitest";
import { devisARelancer } from "./devisRelances.ts";

describe("devisARelancer", () => {
  const q = (o: Record<string, unknown>) => ({ ref: "D-2026-010", brand: "Nakd", creator: "Léna", status: "envoye", dueDate: "2026-12-20", clientEmail: "julie@nakd.com", ...o });
  it("J+2, J+5, J+10 à partir de la date d'envoi", () => {
    expect(devisARelancer([q({ sentAt: "2026-11-20" })], "2026-11-22")[0]).toMatchObject({ relance: "J+2", jours: 2, dateLimite: "2026-12-20", expire: false });
    expect(devisARelancer([q({ sentAt: "2026-11-17" })], "2026-11-22")[0]).toMatchObject({ relance: "J+5" });
    expect(devisARelancer([q({ sentAt: "2026-11-12" })], "2026-11-22")[0]).toMatchObject({ relance: "J+10" });
  });
  it("entre deux relances, ou après J+12 : rien", () => {
    expect(devisARelancer([q({ sentAt: "2026-11-21" })], "2026-11-22")).toEqual([]);
    expect(devisARelancer([q({ sentAt: "2026-11-01" })], "2026-11-22")).toEqual([]);
  });
  it("seulement les devis envoyés ; date du devis à défaut d'envoi", () => {
    expect(devisARelancer([q({ status: "brouillon", sentAt: "2026-11-20" }), q({ status: "accepte", sentAt: "2026-11-20" })], "2026-11-22")).toEqual([]);
    expect(devisARelancer([q({ issueDate: "2026-11-17" })], "2026-11-22")[0].relance).toBe("J+5");
  });
  it("date limite dépassée signalée", () => {
    expect(devisARelancer([q({ sentAt: "2026-11-12", dueDate: "2026-11-21" })], "2026-11-22")[0].expire).toBe(true);
  });
});

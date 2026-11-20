import { describe, expect, it } from "vitest";
import { domaineDe, verdictMx } from "./mxCheck.ts";

describe("verdictMx", () => {
  it("MX présent : bon", () => {
    expect(verdictMx({ Status: 0, Answer: [{ type: 15, data: "1 smtp.google.com." }] })).toEqual({ ok: true });
  });
  it("domaine inexistant", () => {
    expect(verdictMx({ Status: 3 })).toEqual({ ok: false, raison: "domaine inexistant" });
  });
  it("pas de MX : sans serveur mail ; MX nul : refuse tout", () => {
    expect(verdictMx({ Status: 0, Answer: [] }, { Status: 0, Answer: [{ type: 1, data: "1.2.3.4" }] })).toEqual({ ok: false, raison: "domaine sans serveur mail" });
    expect(verdictMx({ Status: 0, Answer: [{ type: 15, data: "0 ." }] })).toEqual({ ok: false, raison: "le domaine refuse tout mail" });
  });
  it("DNS injoignable ou erreur serveur : on ne bloque pas", () => {
    expect(verdictMx(null)).toEqual({ ok: null });
    expect(verdictMx({ Status: 2 })).toEqual({ ok: null });
  });
  it("domaineDe", () => {
    expect(domaineDe("Jean@Marque.FR")).toBe("marque.fr");
  });
});

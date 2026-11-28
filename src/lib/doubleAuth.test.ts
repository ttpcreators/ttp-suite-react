import { describe, expect, it } from "vitest";
import { cleLisible, codeAttendu, codeComplet, facteursTotp, messageErreurDoubleAuth, nettoyerCode, sourceQr } from "./doubleAuth";

describe("code à 6 chiffres", () => {
  it("garde les chiffres seulement, 6 au plus", () => {
    expect(nettoyerCode(" 123 456 ")).toBe("123456");
    expect(nettoyerCode("12a3-4567")).toBe("123456");
    expect(codeComplet("123456")).toBe(true);
    expect(codeComplet("12345")).toBe(false);
  });
});

describe("codeAttendu", () => {
  it("seulement pour un compte inscrit dont la session n'a pas encore de code", () => {
    expect(codeAttendu({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(codeAttendu({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(codeAttendu({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(codeAttendu(null)).toBe(false);
  });
});

describe("QR code et clé", () => {
  it("SVG brut ou adresse data: déjà prête", () => {
    expect(sourceQr("<svg></svg>")).toBe("data:image/svg+xml;utf-8,%3Csvg%3E%3C%2Fsvg%3E");
    expect(sourceQr("data:image/svg+xml;utf-8,abc")).toBe("data:image/svg+xml;utf-8,abc");
    expect(sourceQr("")).toBe("");
  });
  it("clé par groupes de 4", () => {
    expect(cleLisible("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});

describe("facteursTotp", () => {
  it("sépare le facteur actif de ceux laissés en cours", () => {
    expect(facteursTotp([
      { id: "a", factor_type: "totp", status: "unverified" },
      { id: "b", factor_type: "totp", status: "verified" },
      { id: "c", factor_type: "phone", status: "verified" },
    ])).toEqual({ actif: "b", enCours: ["a"] });
    expect(facteursTotp(null)).toEqual({ actif: null, enCours: [] });
  });
});

describe("messageErreurDoubleAuth", () => {
  it("traduit les refus connus", () => {
    expect(messageErreurDoubleAuth({ code: "mfa_verification_failed" })).toBe("Code incorrect. Regarde l'application et réessaie.");
    expect(messageErreurDoubleAuth({ code: "mfa_totp_enroll_not_enabled" })).toBe("La double authentification n'est pas ouverte pour l'instant. Préviens l'agence.");
    expect(messageErreurDoubleAuth({ code: "insufficient_aal" })).toBe("Entre d'abord un code de ton application.");
    expect(messageErreurDoubleAuth(null)).toBe("Ça n'a pas marché. Réessaie dans un instant.");
  });
});

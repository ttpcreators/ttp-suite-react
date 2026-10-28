import { describe, expect, it } from "vitest";
import { canReply, cleanDm, DM_MAX, sendWhy } from "./igSend.ts";

describe("envoi d'un DM Instagram", () => {
  it("fenêtre de 24 h après le dernier message reçu", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(canReply("2026-10-28T09:00:00Z", now)).toBe(true);
    expect(canReply("2026-10-27T11:00:00Z", now)).toBe(false);
    expect(canReply(null, now)).toBe(false);
  });
  it("raisons d'échec lisibles", () => {
    expect(sendWhy({ code: 10, error_subcode: 2534022 })).toBe("hors_fenetre");
    expect(sendWhy({ code: 551 })).toBe("indisponible");
    expect(sendWhy({ code: 190 })).toBe("meta_jeton");
    expect(sendWhy({ message: "reseau" })).toBe("reseau");
    expect(sendWhy({ code: 100 })).toBe("meta_100");
  });
  it("texte nettoyé et borné", () => {
    expect(cleanDm("  Salut\r\nça va ?  ")).toBe("Salut\nça va ?");
    expect(cleanDm("   ")).toBeNull();
    expect(cleanDm("x".repeat(DM_MAX + 1))).toBeNull();
  });
});

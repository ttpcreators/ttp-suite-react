import { describe, expect, it } from "vitest";
import { alfredHorsLigne, cibleDePhoto, commandesGagnantes, reglagesPropres, REGLAGES_DE_BASE, typePhoto } from "./alfredPont.ts";

describe("pont Alfred ↔ app", () => {
  it("complète et borne les réglages", () => {
    expect(reglagesPropres(undefined)).toEqual(REGLAGES_DE_BASE);
    const r = reglagesPropres({ heures: { matin: 8, soir: 99, veille: [15, 11, 11, "x"] }, sonner: { points: false } });
    expect(r.heures.matin).toBe(8);
    expect(r.heures.soir).toBe(17);
    expect(r.heures.veille).toEqual([11, 15]);
    expect(r.sonner).toEqual({ points: false, valider: true });
  });

  it("garde les commandes les plus récentes", () => {
    expect(commandesGagnantes({ texte: "/a = A", maj_le: "2026-11-18T10:00:00Z" }, { texte: "/b = B", maj_le: "2026-11-17T10:00:00Z" }).source).toBe("imac");
    expect(commandesGagnantes({ texte: "/a = A", maj_le: "2026-11-16T10:00:00Z" }, { texte: "/b = B", maj_le: "2026-11-17T10:00:00Z" }).texte).toBe("/b = B");
    expect(commandesGagnantes(undefined, undefined).source).toBe("aucune");
  });

  it("alerte une seule fois par panne, pas la nuit", () => {
    const midi = new Date("2026-11-18T11:00:00Z"); // 12 h à Paris
    expect(alfredHorsLigne(midi, "2026-11-18T10:50:00Z", null).alerte).toBe(false);
    expect(alfredHorsLigne(midi, "2026-11-18T10:30:00Z", null).alerte).toBe(true);
    expect(alfredHorsLigne(midi, "2026-11-18T10:30:00Z", "2026-11-18T10:50:00Z").alerte).toBe(false);
    expect(alfredHorsLigne(new Date("2026-11-18T02:00:00Z"), "2026-11-18T01:00:00Z", null).alerte).toBe(false);
    expect(alfredHorsLigne(midi, null, null).alerte).toBe(false);
  });

  it("lit la cible d'une photo téléversée par Alfred", () => {
    const id = "0a1b2c3d-1111-2222-3333-444455556666";
    expect(cibleDePhoto("")).toEqual({ kind: "aucune" });
    expect(cibleDePhoto(`createur:${id}`)).toEqual({ kind: "createur", id });
    expect(cibleDePhoto(`mediakit:${id}:hero`)).toEqual({ kind: "mediakit", id, cle: "hero" });
    expect(cibleDePhoto(`MEDIAKIT:${id.toUpperCase()}:Instagram`)).toEqual({ kind: "mediakit", id, cle: "instagram" });
    expect(cibleDePhoto("createur:lena")).toBeNull();
    expect(cibleDePhoto(`mediakit:${id}:../x`)).toBeNull();
    expect(cibleDePhoto(`invoices:${id}`)).toBeNull();
  });

  it("n'accepte que des photos", () => {
    expect(typePhoto("Léna.JPG")).toBe("image/jpeg");
    expect(typePhoto("a.heic")).toBe("image/heic");
    expect(typePhoto("contrat.pdf")).toBeNull();
  });
});

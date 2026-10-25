import { describe, expect, it } from "vitest";
import { mergeBlobRows, parseBlobRow } from "./appState.ts";

describe("blob agence côté serveur", () => {
  it("la ligne finance recouvre la ligne commune", () => {
    const app = { a: JSON.stringify({ notifPrefs: { x: true }, creatorPayouts: { vieux: [] } }) };
    const fin = { a: JSON.stringify({ creatorPayouts: { lea: [{ amount: 100 }] } }) };
    expect(mergeBlobRows(app, fin)).toEqual({ notifPrefs: { x: true }, creatorPayouts: { lea: [{ amount: 100 }] } });
  });
  it("sans ligne finance (avant le SQL) : la ligne commune telle quelle", () => {
    expect(mergeBlobRows({ a: JSON.stringify({ k: 1 }) }, undefined)).toEqual({ k: 1 });
  });
  it("ligne vide, illisible ou tableau : objet vide", () => {
    expect(parseBlobRow({ a: "" })).toEqual({});
    expect(parseBlobRow({ a: "{pas du json" })).toEqual({});
    expect(parseBlobRow({ a: "[1]" })).toEqual({});
    expect(parseBlobRow(undefined)).toEqual({});
  });
});

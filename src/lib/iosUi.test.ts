import { describe, it, expect } from "vitest";
import { isTextEntry } from "./iosUi";

// Faux éléments : seuls tagName, type et isContentEditable comptent.
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as Element;

describe("isTextEntry (barre d'onglets cachée clavier ouvert)", () => {
  it("champs qui ouvrent le clavier ou la roue de choix", () => {
    expect(isTextEntry(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "date" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "" }))).toBe(true);
    expect(isTextEntry(el("TEXTAREA"))).toBe(true);
    expect(isTextEntry(el("SELECT"))).toBe(true);
    expect(isTextEntry(el("DIV", { isContentEditable: true }))).toBe(true);
  });
  it("cases, boutons et rien du tout : la barre reste", () => {
    expect(isTextEntry(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTextEntry(el("INPUT", { type: "range" }))).toBe(false);
    expect(isTextEntry(el("BUTTON"))).toBe(false);
    expect(isTextEntry(el("DIV", { isContentEditable: false }))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

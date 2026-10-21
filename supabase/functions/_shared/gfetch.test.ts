import { describe, expect, it } from "vitest";
import { decodeGmailBody } from "./gfetch.ts";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("décodage des corps de mail", () => {
  const phrase = "Demain à 14h me convient très bien. Liévin";
  it("UTF-8 annoncé à tort en iso-8859-1 : accents corrects", () => {
    const utf8 = new TextEncoder().encode(phrase);
    expect(decodeGmailBody(b64url(utf8), "iso-8859-1")).toBe(phrase);
    expect(decodeGmailBody(b64url(utf8), "windows-1252")).toBe(phrase);
  });
  it("vrai latin-1 : toujours lu en latin-1", () => {
    const latin1 = Uint8Array.from([...phrase].map((c) => c.charCodeAt(0)));
    expect(decodeGmailBody(b64url(latin1), "iso-8859-1")).toBe(phrase);
  });
  it("UTF-8 annoncé : inchangé", () => {
    expect(decodeGmailBody(b64url(new TextEncoder().encode(phrase)), "utf-8")).toBe(phrase);
  });
});

import { describe, expect, it } from "vitest";
import { isSingleEmoji, parseReactionJson, REACTION_MIME, reactionBody, reactionSubject } from "./emailReaction.ts";

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));

describe("réactions emoji (format Gmail)", () => {
  it("un seul emoji, sinon refusé", () => {
    expect(isSingleEmoji("❤️")).toBe(true);
    expect(isSingleEmoji("👍🏽")).toBe(true);
    expect(isSingleEmoji("👨‍👩‍👧")).toBe(true);
    expect(isSingleEmoji("👍👍")).toBe(false);
    expect(isSingleEmoji("ok")).toBe(false);
    expect(isSingleEmoji("")).toBe(false);
    expect(isSingleEmoji("❤️ merci")).toBe(false);
  });
  it("lit la partie JSON : version 1 exactement", () => {
    expect(parseReactionJson('{"emoji":"😂","version":1}')).toBe("😂");
    expect(parseReactionJson('{"emoji":"😂","version":"1"}')).toBe(null);
    expect(parseReactionJson('{"emoji":"😂"}')).toBe(null);
    expect(parseReactionJson("pas du json")).toBe(null);
  });
  it("corps : texte, réaction, HTML dans cet ordre", () => {
    const body = reactionBody("❤️", "Marc", "b1");
    expect(body.startsWith('Content-Type: multipart/alternative; boundary="b1"')).toBe(true);
    const plain = body.indexOf("text/plain");
    const react = body.indexOf(REACTION_MIME);
    const html = body.indexOf("text/html");
    expect(plain).toBeGreaterThan(0);
    expect(react).toBeGreaterThan(plain);
    expect(html).toBeGreaterThan(react);
    const parts = body.split("--b1");
    const json = parts[2].split("\r\n\r\n")[1];
    expect(JSON.parse(decode(json))).toEqual({ emoji: "❤️", version: 1 });
    expect(decode(parts[1].split("\r\n\r\n")[1])).toBe("Marc a réagi avec ❤️");
    expect(body.trimEnd().endsWith("--b1--")).toBe(true);
  });
  it("objet en « Re: » sans doublon", () => {
    expect(reactionSubject("Collab été")).toBe("Re: Collab été");
    expect(reactionSubject("RE: Collab")).toBe("RE: Collab");
  });
});

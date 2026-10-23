import { describe, expect, it } from "vitest";
import { reactionOf, splitThreadReactions } from "./mailThreadReactions";

const msg = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, from: "Emma S <emma@x.fr>", text, html: "", ...extra });

describe("réactions dans un échange", () => {
  it("reconnaît une réaction par le serveur ou par le texte de repli", () => {
    expect(reactionOf(msg("a", "Marc a réagi avec ❤️"))).toEqual({ emoji: "❤️", who: "Marc" });
    expect(reactionOf(msg("a", "Emma reacted with 👍🏽"))).toEqual({ emoji: "👍🏽", who: "Emma" });
    expect(reactionOf(msg("a", "", { html: "<p>Marc a réagi avec 😂</p>" }))?.emoji).toBe("😂");
    expect(reactionOf(msg("a", "x", { reaction: "🎉" }))?.emoji).toBe("🎉");
    expect(reactionOf(msg("a", "Bonjour, Marc a réagi avec plaisir à votre proposition et nous revenons vers vous."))).toBe(null);
  });
  it("range les réactions en pastilles sous le message précédent", () => {
    const { shown, pills } = splitThreadReactions([
      msg("1", "Bonjour, voici notre proposition."),
      msg("2", "Marc a réagi avec ❤️", { fromAgency: true }),
      msg("3", "Léa a réagi avec ❤️"),
      msg("4", "Merci !"),
    ]);
    expect(shown.map((m) => m.id)).toEqual(["1", "4"]);
    expect(pills.get("1")).toEqual([{ emoji: "❤️", who: "Marc, Léa", count: 2 }]);
  });
  it("une réaction seule en tête du fil reste affichée", () => {
    expect(splitThreadReactions([msg("1", "Marc a réagi avec ❤️")]).shown.map((m) => m.id)).toEqual(["1"]);
  });
});

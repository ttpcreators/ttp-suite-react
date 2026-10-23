import { describe, expect, it } from "vitest";
import { canReact, reactionErrorText, reactionRecipients, reactorName, splitReactions, type ReactionMsg } from "./mailReactions";

const D = "ttpcreators.pro";
const brand: ReactionMsg = {
  id: "m1", from: "Julie Martin <julie@marque.fr>", to: "partnerships@ttpcreators.pro", cc: "chef@marque.fr",
  direction: "in", messageIdHeader: "<a1@marque.fr>",
};

describe("réactions aux mails", () => {
  it("propose une réaction sur un mail reçu où l'agence est en To / Cc", () => {
    expect(canReact(brand, D)).toBe(true);
    expect(canReact({ ...brand, direction: "out" }, D)).toBe(false);
    expect(canReact({ ...brand, list: true }, D)).toBe(false);
    expect(canReact({ ...brand, messageIdHeader: "" }, D)).toBe(false);
    // En Cci : l'agence n'apparaît ni en To ni en Cc.
    expect(canReact({ ...brand, to: "autre@marque.fr", cc: "" }, D)).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@x.fr`).join(", ");
    expect(canReact({ ...brand, cc: many }, D)).toBe(false);
  });
  it("répond à l'expéditeur (ou Reply-To), les autres en copie, sans l'agence", () => {
    expect(reactionRecipients(brand, D)).toEqual({ to: "julie@marque.fr", cc: ["chef@marque.fr"] });
    expect(reactionRecipients({ ...brand, replyTo: "rp@marque.fr" }, D).to).toBe("rp@marque.fr");
  });
  it("range les réactions sous le message visé, groupées par emoji", () => {
    const r1: ReactionMsg = { id: "r1", from: "Julie <julie@marque.fr>", direction: "in", reaction: "❤️", inReplyTo: "<o1@ttpcreators.pro>" };
    const r2: ReactionMsg = { id: "r2", from: "TTP <partnerships@ttpcreators.pro>", direction: "out", reaction: "❤️", inReplyTo: "<o1@ttpcreators.pro>" };
    const lost: ReactionMsg = { id: "r3", from: "x@y.fr", direction: "in", reaction: "👍", inReplyTo: "<absent@x>" };
    const out: ReactionMsg = { id: "o1", from: "TTP <partnerships@ttpcreators.pro>", direction: "out", messageIdHeader: "<o1@ttpcreators.pro>" };
    const { shown, pills } = splitReactions([out, r1, r2, lost]);
    expect(shown.map((m) => m.id)).toEqual(["o1", "r3"]);
    expect(pills.get("o1")).toEqual([{ emoji: "❤️", who: "Julie, Toi", mine: true, count: 2 }]);
  });
  it("nom court du réacteur", () => {
    expect(reactorName("Julie Martin <julie@marque.fr>")).toBe("Julie");
    expect(reactorName("<jean.dupont@marque.fr>")).toBe("Jean.dupont");
  });
  it("ancienne fonction déployée : message clair", () => {
    expect(reactionErrorText("contenu_requis")).toMatch(/mise à jour serveur/);
  });
});

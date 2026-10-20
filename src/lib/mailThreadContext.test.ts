import { describe, expect, it } from "vitest";
import { claudeUrl, contextPrompt, htmlToText, stripQuoted, threadTranscript } from "./mailThreadContext";

describe("contexte d'un fil de mails", () => {
  it("transforme le HTML en texte lisible", () => {
    expect(htmlToText("<p>Bonjour&nbsp;Marc,</p><p>Ça marche<br>pour le 14.</p><style>p{}</style>")).toBe("Bonjour Marc,\nÇa marche\npour le 14.");
  });
  it("retire la citation en bas d'une réponse", () => {
    expect(stripQuoted("Parfait, merci !\n\nLe 12 oct. 2026 à 10:02, Marc <m@ttp.pro> a écrit :\n> Bonjour")).toBe("Parfait, merci !");
    expect(stripQuoted("Top\n> ancien\n> texte")).toBe("Top");
  });
  it("met le fil dans l'ordre, avec qui écrit et quand", () => {
    const t = threadTranscript("Partenariat", "partnerships", [
      { from: "Julie", fromEmail: "julie@nike.com", fromAgency: false, ts: 2000, text: "Réponse de Julie" },
      { from: "Marc", fromEmail: "marc@ttpcreators.pro", fromAgency: true, ts: 1000, text: "Premier message" },
    ]);
    expect(t.indexOf("Premier message")).toBeLessThan(t.indexOf("Réponse de Julie"));
    expect(t).toContain("De : Marc <marc@ttpcreators.pro> (TTP Creators)");
    expect(t).toContain("Message 2 sur 2");
  });
  it("garde les messages récents quand le fil est trop long", () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({ from: "X", fromAgency: false, ts: i, text: `${i}`.repeat(400) }));
    const t = threadTranscript("S", "talent", msgs, 900);
    expect(t).toContain("4".repeat(400));
    expect(t).not.toContain("0".repeat(400));
    expect(t).toContain("plus anciens non repris");
  });
  it("demande pour un agent, et lien raccourci si trop long", () => {
    const p = contextPrompt({ transcript: "fil", threadId: "t1", box: "talent", agent: "Talent manager", consigne: "accepte" });
    expect(p).toContain("lire_agent (Talent manager)");
    expect(p).toContain("en suivant cette consigne : accepte");
    expect(claudeUrl(p).full).toBe(true);
    expect(claudeUrl("x".repeat(9000)).full).toBe(false);
  });
});

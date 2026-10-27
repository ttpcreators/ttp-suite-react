import { describe, expect, it } from "vitest";
import { replyHtml, replyRaw, replyRecipient, replyReferences, replySubject } from "./creatorReply.ts";

const decode = (r: string) => new TextDecoder().decode(Uint8Array.from(atob(r.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

describe("réponse d'un créateur à la marque", () => {
  it("répond à la marque, jamais à l'agence", () => {
    expect(replyRecipient('"Jennifer" <Jennifer.Garcia@aroma-zone.com>', "", "ttpcreators.pro")).toBe("jennifer.garcia@aroma-zone.com");
    expect(replyRecipient("a@marque.fr", "pr@marque.fr", "ttpcreators.pro")).toBe("pr@marque.fr");
    expect(replyRecipient("TTP <talent@ttpcreators.pro>", "", "ttpcreators.pro")).toBe("");
    // Démarchage sans réponse : on écrit au destinataire du mail de l'agence.
    expect(replyRecipient("TTP <talent@ttpcreators.pro>", "ana@ttpcreators.pro", "ttpcreators.pro", "ana@ttpcreators.pro, Jennifer <j@aroma-zone.com>")).toBe("j@aroma-zone.com");
  });
  it("objet et références du fil", () => {
    expect(replySubject("Partenariat")).toBe("Re: Partenariat");
    expect(replySubject("RE: Partenariat")).toBe("RE: Partenariat");
    expect(replyReferences("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
    expect(replyReferences("", "<c@x>")).toBe("<c@x>");
  });
  it("texte échappé, liens cliquables", () => {
    const h = replyHtml("Avec plaisir <3\nhttps://ttpcreators.pro/mediakit/ana/.");
    expect(h).toContain("&lt;3");
    expect(h).toContain('<a href="https://ttpcreators.pro/mediakit/ana/">https://ttpcreators.pro/mediakit/ana/</a>.');
  });
  it("mail complet : au nom du créateur, alias en copie et en Répondre à", () => {
    const raw = decode(replyRaw({
      fromName: "Ana Milanović", fromAddress: "talent@ttpcreators.pro", to: "j@aroma-zone.com",
      cc: ["ana@ttpcreators.pro"], replyTo: "ana@ttpcreators.pro", subject: "Re: Aroma Zone",
      inReplyTo: "<m1@x>", references: "<m0@x> <m1@x>", html: "<p>ok</p>",
    }));
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?[^?]+\?= <talent@ttpcreators\.pro>\r\n/);
    expect(raw).toContain("\r\nCc: ana@ttpcreators.pro\r\n");
    expect(raw).toContain("\r\nReply-To: ana@ttpcreators.pro\r\n");
    expect(raw).toContain("\r\nIn-Reply-To: <m1@x>\r\nReferences: <m0@x> <m1@x>\r\n");
  });
});

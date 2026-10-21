import { describe, expect, it } from "vitest";
import { BODY_MAX, draftRow, isDraftId, type DraftPart, type GmailDraft } from "./gmailDrafts.ts";

const b64url = (s: string) => Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function draft(headers: Record<string, string>, parts: DraftPart): GmailDraft {
  return {
    id: "r-123456789",
    message: {
      id: "18c0ffee",
      threadId: "18c0ffee",
      labelIds: ["DRAFT"],
      snippet: "Bonjour Anna",
      internalDate: "1761040000000",
      payload: { ...parts, headers: [...Object.entries(headers).map(([name, value]) => ({ name, value })), ...(parts.headers ?? [])] },
    },
  };
}

describe("brouillons Gmail", () => {
  it("accepte les identifiants de brouillon et refuse le reste", () => {
    expect(isDraftId("r-5402868484013488361")).toBe(true);
    expect(isDraftId("r5402868484013488361")).toBe(true);
    expect(isDraftId("")).toBe(false);
    expect(isDraftId("r-1/../messages")).toBe(false);
    expect(isDraftId("r 1")).toBe(false);
    expect(isDraftId("a".repeat(65))).toBe(false);
    expect(isDraftId(42)).toBe(false);
  });

  it("brouillon de Claude (texte seul, nouveau mail)", () => {
    const r = draftRow(
      draft(
        { To: "Anna Martin <Anna@Nike.com>, bob@nike.com", Subject: "Proposition", "X-TTP-Source": "claude" },
        { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { data: b64url("Bonjour Anna,\n\nVoici l'offre.") } },
      ),
      "partnerships",
    );
    expect(r).toMatchObject({
      draftId: "r-123456789", threadId: "18c0ffee", box: "partnerships", subject: "Proposition",
      name: "Anna Martin", email: "anna@nike.com", to: ["anna@nike.com", "bob@nike.com"], cc: [], bcc: [],
      reply: false, byClaude: true, text: "Bonjour Anna,\n\nVoici l'offre.", html: "", attachments: [],
      ts: 1761040000000, count: 1, direction: "out", unread: false, archived: false,
    });
    expect(r?.bodyCut).toBeUndefined();
  });

  it("réponse Gmail (HTML + texte, copie, pièce jointe)", () => {
    const r = draftRow(
      draft(
        { To: "brand@x.fr", Cc: "A <a@x.fr>", Bcc: "b@x.fr", Subject: "Re: Collab", "In-Reply-To": "<abc@mail>", References: "<root@mail> <abc@mail>" },
        {
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "multipart/alternative", parts: [
              { mimeType: "text/plain", body: { data: b64url("Merci !") } },
              { mimeType: "text/html", body: { data: b64url("<div>Merci !</div>") } },
            ] },
            { mimeType: "application/pdf", filename: "devis.pdf", body: { attachmentId: "att1", size: 1000 } },
          ],
        },
      ),
      "talent",
    );
    expect(r).toMatchObject({
      box: "talent", reply: true, inReplyTo: "<abc@mail>", references: "<root@mail> <abc@mail>",
      cc: ["a@x.fr"], bcc: ["b@x.fr"], text: "Merci !", html: "<div>Merci !</div>", attachments: ["devis.pdf"], byClaude: false,
      name: "brand@x.fr", email: "brand@x.fr",
    });
  });

  it("coupe un corps trop long et ignore un brouillon illisible", () => {
    const long = "a".repeat(BODY_MAX + 10);
    const r = draftRow(draft({ To: "x@y.fr" }, { mimeType: "text/plain", body: { data: b64url(long) } }), "partnerships");
    expect(r?.text.length).toBe(BODY_MAX);
    expect(r?.bodyCut).toBe(true);
    expect(r?.subject).toBe("");
    expect(draftRow({ id: "r1" }, "partnerships")).toBeNull();
    expect(draftRow({ message: { id: "m" } }, "partnerships")).toBeNull();
  });

  it("décode le charset de la partie", () => {
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    const r = draftRow(draft({ To: "x@y.fr" }, { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=iso-8859-1" }], body: { data: latin } }), "partnerships");
    expect(r?.text).toBe("café");
  });
});

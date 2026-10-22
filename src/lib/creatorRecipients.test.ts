import { describe, expect, it } from "vitest";
import { insertRecipient, matchRecipients, recipientEmails, recipientToken, type CreatorRecipient } from "./creatorRecipients";

const list: CreatorRecipient[] = [
  { name: "Léna Pasquale", photo: null, emails: ["lena@ttpcreators.pro", "lena.pasquale@gmail.com"] },
  { name: "Léa Berenger", photo: null, emails: ["lea@ttpcreators.pro"] },
  { name: "Justine Gentet", photo: null, emails: ["justine@ttpcreators.pro"] },
];

describe("« @lena » dans les destinataires", () => {
  it("repère le mot en cours", () => {
    expect(recipientToken("@lena").query).toBe("lena");
    expect(recipientToken("a@b.fr, @").query).toBe("");
    expect(recipientToken("a@b.fr, jus")).toEqual({ start: 8, query: "jus" });
    expect(recipientToken("lena@ttp").query).toBeNull();
    expect(recipientToken("a@b.fr, l").query).toBeNull();
    expect(recipientToken("").query).toBeNull();
  });
  it("cherche sans accents, par prénom, nom ou adresse", () => {
    expect(matchRecipients(list, "lena").map((o) => o.email)).toEqual(["lena@ttpcreators.pro", "lena.pasquale@gmail.com"]);
    expect(matchRecipients(list, "le").map((o) => o.name)).toEqual(["Léna Pasquale", "Léna Pasquale", "Léa Berenger"]);
    expect(matchRecipients(list, "gentet")[0].email).toBe("justine@ttpcreators.pro");
    expect(matchRecipients(list, "lena", "x@y.fr, lena@ttpcreators.pro").map((o) => o.email)).toEqual(["lena.pasquale@gmail.com"]);
    expect(matchRecipients(list, "").length).toBe(4);
  });
  it("remplace le mot par l'adresse", () => {
    expect(insertRecipient("@len", 4, "lena@ttpcreators.pro")).toEqual({ value: "lena@ttpcreators.pro, ", caret: 22 });
    expect(insertRecipient("a@b.fr, @jus", 12, "justine@ttpcreators.pro").value).toBe("a@b.fr, justine@ttpcreators.pro, ");
    expect(insertRecipient("@le, c@d.fr", 3, "lea@ttpcreators.pro").value).toBe("lea@ttpcreators.pro, c@d.fr");
  });
  it("alias de l'agence d'abord, jamais une boîte commune", () => {
    expect(recipientEmails("talent@ttpcreators.pro", ["Lena@Gmail.com"], "lena@ttpcreators.pro")).toEqual(["lena@ttpcreators.pro", "lena@gmail.com"]);
  });
});

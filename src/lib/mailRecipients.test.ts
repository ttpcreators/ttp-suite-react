import { describe, expect, it } from "vitest";
import { addressParts, contactRecipient, insertRecipient, matchRecipients, recipientEmails, recipientToken, type Recipient } from "./mailRecipients";

const list: Recipient[] = [
  { name: "Léna Morel", hint: "Créateur", photo: null, emails: ["lena@ttpcreators.pro", "lena.morel@exemple.fr"] },
  { name: "Léa Fontaine", hint: "Créateur", photo: null, emails: ["lea@ttpcreators.pro"] },
  { name: "Justine Faure", hint: "Créateur", photo: null, emails: ["justine@ttpcreators.pro"] },
  { name: "Nora Picard", hint: "Nova", photo: null, emails: ["npicard@nova.fr"] },
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
  it("cherche sans accents, par prénom, nom, marque ou adresse", () => {
    expect(matchRecipients(list, "lena").map((o) => o.email)).toEqual(["lena@ttpcreators.pro", "lena.morel@exemple.fr"]);
    expect(matchRecipients(list, "le").map((o) => o.name)).toEqual(["Léna Morel", "Léna Morel", "Léa Fontaine"]);
    expect(matchRecipients(list, "faure")[0].email).toBe("justine@ttpcreators.pro");
    expect(matchRecipients(list, "nova")[0]).toEqual({ name: "Nora Picard", hint: "Nova", photo: null, email: "npicard@nova.fr" });
    expect(matchRecipients(list, "nora")[0].email).toBe("npicard@nova.fr");
    expect(matchRecipients(list, "lena", "x@y.fr, lena@ttpcreators.pro").map((o) => o.email)).toEqual(["lena.morel@exemple.fr"]);
    expect(matchRecipients(list, "").length).toBe(5);
  });
  it("une même adresse n'apparaît qu'une fois", () => {
    const dup: Recipient[] = [list[1], { name: "Léa", hint: "Nike", photo: null, emails: ["lea@ttpcreators.pro"] }];
    expect(matchRecipients(dup, "lea").length).toBe(1);
  });
  it("remplace le mot par l'adresse", () => {
    expect(insertRecipient("@len", 4, "lena@ttpcreators.pro")).toEqual({ value: "lena@ttpcreators.pro, ", caret: 22 });
    expect(insertRecipient("a@b.fr, @jus", 12, "justine@ttpcreators.pro").value).toBe("a@b.fr, justine@ttpcreators.pro, ");
    expect(insertRecipient("@le, c@d.fr", 3, "lea@ttpcreators.pro").value).toBe("lea@ttpcreators.pro, c@d.fr");
  });
  it("alias de l'agence d'abord, jamais une boîte commune", () => {
    expect(recipientEmails("talent@ttpcreators.pro", ["Lena@Gmail.com"], "lena@ttpcreators.pro")).toEqual(["lena@ttpcreators.pro", "lena@gmail.com"]);
  });
  it("contacts : personne et marque, sinon la marque seule", () => {
    expect(contactRecipient({ brand: "Nova", person: "Nora Picard", email: " NPicard@nova.fr " })).toEqual({ name: "Nora Picard", hint: "Nova", photo: null, emails: ["npicard@nova.fr"] });
    expect(contactRecipient({ brand: "Livy", person: "—", email: "hello@livy.fr" })?.name).toBe("Livy");
    expect(contactRecipient({ brand: "X", person: "Y", email: "pas-une-adresse" })).toBeNull();
  });
});

describe("liste des destinataires d'un mail", () => {
  it("découpe Nom <adresse>, même avec une virgule dans le nom", () => {
    expect(addressParts('"Durand, Sophie" <sophie.durand@exemple.fr>, anavidal@ttpcreators.pro')).toEqual([
      { name: "Durand, Sophie", email: "sophie.durand@exemple.fr" },
      { name: "", email: "anavidal@ttpcreators.pro" },
    ]);
    expect(addressParts("")).toEqual([]);
  });
});

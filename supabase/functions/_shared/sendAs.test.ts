import { describe, expect, it } from "vitest";
import { addressOf, findSendAs, fromHeader, refusSendAs, usableSendAs } from "./sendAs.ts";

const raw = [
  { sendAsEmail: "talent@ttpcreators.pro", displayName: "TTP Talent", isPrimary: true },
  { sendAsEmail: "AnaMilanovic@ttpcreators.pro", displayName: "Ana Milanović", verificationStatus: "accepted", signature: "<b>Ana</b>" },
  { sendAsEmail: "candice@ttpcreators.pro", displayName: "Candice", verificationStatus: "pending" },
  { sendAsEmail: "lunivana@ttpcreators.pro", displayName: "Ivana" },
  { sendAsEmail: "pas-une-adresse", displayName: "x" },
];

describe("usableSendAs", () => {
  it("garde l'adresse principale et les alias validés, refuse ceux en attente", () => {
    const l = usableSendAs(raw);
    expect(l.map((x) => x.email)).toEqual(["talent@ttpcreators.pro", "anamilanovic@ttpcreators.pro", "lunivana@ttpcreators.pro"]);
    expect(l[1].signature).toBe("<b>Ana</b>");
  });
});

describe("findSendAs", () => {
  const l = usableSendAs(raw);
  it("trouve l'alias, casse et nom affiché ignorés", () => {
    expect(findSendAs(l, " ANAMILANOVIC@ttpcreators.pro ")?.name).toBe("Ana Milanović");
    expect(findSendAs(l, "Ana <anamilanovic@ttpcreators.pro>")?.email).toBe("anamilanovic@ttpcreators.pro");
  });
  it("refuse une adresse qui n'est pas réglée dans Gmail", () => {
    expect(findSendAs(l, "candice@ttpcreators.pro")).toBeNull();
    expect(findSendAs(l, "marc@gmail.com")).toBeNull();
  });
});

describe("fromHeader", () => {
  it("met le nom affiché, encodé s'il a des accents", () => {
    expect(fromHeader({ email: "lunivana@ttpcreators.pro", name: "Ivana", signature: "", primary: false })).toBe('From: "Ivana" <lunivana@ttpcreators.pro>');
    expect(fromHeader({ email: "a@ttpcreators.pro", name: "Ana Milanović", signature: "", primary: false })).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@ttpcreators\.pro>$/);
    expect(fromHeader({ email: "a@ttpcreators.pro", name: "", signature: "", primary: false })).toBe("From: <a@ttpcreators.pro>");
  });
  it("ne laisse passer ni retour à la ligne ni guillemet dans le nom", () => {
    expect(fromHeader({ email: "a@b.fr", name: 'X"\r\nBcc: z@z.fr', signature: "", primary: false })).not.toMatch(/\r|\n/);
  });
});

describe("addressOf et refusSendAs", () => {
  it("lit l'adresse d'un en-tête From", () => {
    expect(addressOf('"Ana" <AnaMilanovic@ttpcreators.pro>')).toBe("anamilanovic@ttpcreators.pro");
  });
  it("dit quelle boîte a l'alias, ou liste les alias", () => {
    expect(refusSendAs("x@ttpcreators.pro", "partnerships", [], { box: "talent", found: true })).toMatch(/boite « talent »/);
    expect(refusSendAs("x@ttpcreators.pro", "talent", usableSendAs(raw))).toMatch(/anamilanovic@ttpcreators\.pro, lunivana@ttpcreators\.pro/);
  });
});

import { describe, expect, it } from "vitest";
import {
  DUPLICATE_ADDRESS_MESSAGE, INVALID_ADDRESS_MESSAGE, SHARED_BOX_MESSAGE,
  aliasesColumnMissing, allAddresses, checkNewAddress, extraAddresses, joinWith, normAddress,
} from "./mailAddresses";

const MAIN = "lea@ttpcreators.pro";
const PERSO = "lea.martin@gmail.com";

describe("adresses mail d'un créateur", () => {
  it("normalise et valide une adresse", () => {
    expect(normAddress("  Lea.Martin@Gmail.COM ")).toBe(PERSO);
    expect(normAddress("lea")).toBe("");
    expect(normAddress("a b@c.fr")).toBe("");
    expect(normAddress("a@b.fr, c@d.fr")).toBe("");
    expect(normAddress(null)).toBe("");
  });

  it("liste complète : principale d'abord, minuscules, sans doublon", () => {
    expect(allAddresses("LEA@ttpcreators.pro", [PERSO, "lea@TTPcreators.pro", "", null, PERSO.toUpperCase()])).toEqual([MAIN, PERSO]);
    expect(allAddresses(null, [PERSO])).toEqual([PERSO]);
    expect(allAddresses("", null)).toEqual([]);
  });

  it("adresses en plus : sans la principale ni doublon ni adresse invalide", () => {
    expect(extraAddresses(MAIN, [MAIN, PERSO, "Lea.Martin@gmail.com", "pas-un-mail"])).toEqual([PERSO]);
    expect(extraAddresses(null, [PERSO])).toEqual([PERSO]);
    expect(extraAddresses(MAIN, undefined)).toEqual([]);
  });

  it("contrôle d'une adresse à ajouter", () => {
    expect(checkNewAddress(" Lea.Martin@Gmail.com ", { alias: MAIN, aliases: [] })).toEqual({ address: PERSO });
    expect(checkNewAddress("lea", { alias: MAIN })).toEqual({ error: INVALID_ADDRESS_MESSAGE });
    expect(checkNewAddress("partnerships@ttpcreators.pro", { alias: MAIN })).toEqual({ error: SHARED_BOX_MESSAGE });
    expect(checkNewAddress("Talent@TTPcreators.pro", { alias: MAIN })).toEqual({ error: SHARED_BOX_MESSAGE });
    expect(checkNewAddress("LEA@ttpcreators.pro", { alias: MAIN })).toEqual({ error: DUPLICATE_ADDRESS_MESSAGE });
    expect(checkNewAddress(PERSO, { alias: MAIN, aliases: [PERSO] })).toEqual({ error: DUPLICATE_ADDRESS_MESSAGE });
    // Un talent@ d'un autre domaine n'est pas une boîte de l'agence.
    expect(checkNewAddress("talent@gmail.com", { alias: MAIN })).toEqual({ address: "talent@gmail.com" });
  });

  it("joint les adresses avec « ou »", () => {
    expect(joinWith([], "ou")).toBe("");
    expect(joinWith([MAIN], "ou")).toBe(MAIN);
    expect(joinWith([MAIN, PERSO], "ou")).toBe(`${MAIN} ou ${PERSO}`);
    expect(joinWith(["a@b.fr", "c@d.fr", "e@f.fr"], "or")).toBe("a@b.fr, c@d.fr or e@f.fr");
  });

  it("reconnaît la colonne aliases absente", () => {
    expect(aliasesColumnMissing({ code: "42703", message: "column creator_mail_settings.aliases does not exist" })).toBe(true);
    expect(aliasesColumnMissing({ code: "PGRST204", message: "Could not find the 'aliases' column" })).toBe(true);
    expect(aliasesColumnMissing({ code: "P0001", message: "Adresse déjà utilisée" })).toBe(false);
    expect(aliasesColumnMissing(null)).toBe(false);
  });
});

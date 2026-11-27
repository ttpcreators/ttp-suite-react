import { describe, expect, it } from "vitest";
import { infosPatch } from "./creatorInfos";

describe("infos modifiées par le créateur", () => {
  it("n'envoie que les champs vraiment changés", () => {
    const fiche = { ville: "Ville A", address: null, siren: " SIREN A ", email: "Mail A", birth: null };
    const form = { ville: "Ville B", address: "", siren: "SIREN A", email: "Mail A ", birth: "" };
    expect(infosPatch(fiche, form)).toEqual({ ville: "Ville B" });
  });

  it("rien de changé : rien à envoyer", () => {
    expect(infosPatch({ phone: "Téléphone A" }, { phone: "Téléphone A" })).toEqual({});
  });

  it("un champ vidé part vide", () => {
    expect(infosPatch({ address: "Adresse A" }, { address: "  " })).toEqual({ address: "" });
  });

  it("date de naissance : même date dans un autre format = pas de changement", () => {
    expect(infosPatch({ birth: "12/03/1998" }, { birth: "1998-03-12" })).toEqual({});
    expect(infosPatch({ birth: "1998-03-12" }, { birth: "1998-03-13" })).toEqual({ birth: "1998-03-13" });
  });

  it("date de naissance illisible (texte libre) : gardée telle quelle", () => {
    expect(infosPatch({ birth: "printemps 1998" }, { birth: "" })).toEqual({});
  });
});

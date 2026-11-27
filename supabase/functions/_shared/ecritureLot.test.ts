import { describe, expect, it } from "vitest";
import { ecrireParLots, refusDeDonnees, type ErreurBase } from "./ecritureLot.ts";

const JSON_ILLISIBLE: ErreurBase = { code: "22P02", message: "invalid input syntax for type json" };

/** Fausse base : refuse tout paquet qui contient une ligne « mauvaise », note chaque appel. */
function base(mauvaises: Set<number>, panne?: ErreurBase) {
  const appels: number[][] = [];
  const ecrites: number[] = [];
  const ecrire = async (lot: number[]) => {
    appels.push(lot);
    if (panne) return { error: panne };
    if (lot.some((x) => mauvaises.has(x))) return { error: JSON_ILLISIBLE };
    ecrites.push(...lot);
    return { error: null };
  };
  return { appels, ecrites, ecrire };
}

describe("ecrireParLots", () => {
  it("tout passe : un appel par paquet", async () => {
    const b = base(new Set());
    const r = await ecrireParLots([1, 2, 3, 4, 5], 2, b.ecrire);
    expect(r).toEqual({ refusees: [], erreur: null });
    expect(b.appels).toEqual([[1, 2], [3, 4], [5]]);
    expect(b.ecrites).toEqual([1, 2, 3, 4, 5]);
  });
  it("un paquet refusé pour ses données : réessayé ligne par ligne, seule la mauvaise est perdue", async () => {
    const b = base(new Set([3]));
    const r = await ecrireParLots([1, 2, 3, 4, 5], 3, b.ecrire);
    expect(r.refusees).toEqual([3]);
    expect(r.erreur).toBe("invalid input syntax for type json");
    expect(b.ecrites.sort()).toEqual([1, 2, 4, 5]);
    expect(b.appels).toEqual([[1, 2, 3], [1], [2], [3], [4, 5]]);
  });
  it("toutes les lignes refusées : 1 + 10 appels pour un paquet de 200, et les 200 lignes dans refusees", async () => {
    const lignes = Array.from({ length: 200 }, (_, i) => i + 1);
    const b = base(new Set(lignes));
    const r = await ecrireParLots(lignes, 200, b.ecrire);
    expect(r.refusees).toEqual(lignes);
    expect(r.erreur).toBe("invalid input syntax for type json");
    expect(b.appels).toHaveLength(11);
    expect(b.appels.slice(1)).toEqual(lignes.slice(0, 10).map((x) => [x]));
    expect(b.ecrites).toEqual([]);
  });
  it("une panne n'est pas réessayée ligne par ligne", async () => {
    const b = base(new Set(), { message: "TypeError: fetch failed" });
    const r = await ecrireParLots([1, 2, 3], 10, b.ecrire);
    expect(r.refusees).toEqual([1, 2, 3]);
    expect(b.appels).toHaveLength(1);
  });
  it("rien à écrire : aucun appel", async () => {
    const b = base(new Set());
    expect(await ecrireParLots([], 200, b.ecrire)).toEqual({ refusees: [], erreur: null });
    expect(b.appels).toHaveLength(0);
  });
});

describe("refusDeDonnees", () => {
  it("texte illisible, valeur trop longue, contrainte : oui ; panne : non", () => {
    expect(refusDeDonnees({ code: "22P02" })).toBe(true); // json illisible (moitié d'emoji)
    expect(refusDeDonnees({ code: "22P05" })).toBe(true); // caractère nul
    expect(refusDeDonnees({ code: "22001" })).toBe(true); // valeur trop longue
    expect(refusDeDonnees({ code: "23502" })).toBe(true); // valeur obligatoire manquante
    expect(refusDeDonnees({ code: "PGRST102" })).toBe(true); // corps JSON refusé par l'API
    expect(refusDeDonnees({ code: "42P01" })).toBe(false); // table absente
    expect(refusDeDonnees({ code: "" })).toBe(false); // réseau
    expect(refusDeDonnees(null)).toBe(false);
  });
});

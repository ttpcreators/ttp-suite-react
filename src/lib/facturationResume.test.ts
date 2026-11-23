import { describe, expect, it } from "vitest";
import { brouillonsLegende, encaisserLegende, encaisserResume } from "./facturationResume";

// Montants fictifs.
const now = new Date("2026-11-24T10:00:00");

describe("encaisserResume : chaque case en euros, le nombre en légende", () => {
  it("1 facture en attente et 4 brouillons : 650 € à encaisser, pas « 1 »", () => {
    const r = encaisserResume(
      [
        { status: "attente", date: "2026-12-21", amount: "650,00 €" },
        { status: "brouillon", date: null, amount: "1 000,00 €" },
        { status: "brouillon", date: null, amount: "500" },
        { status: "brouillon", date: null, amount: "250,50 €" },
        { status: "brouillon", date: null, amount: "" },
        { status: "payee", date: "2026-10-01", amount: "1 440,00 €" },
      ],
      now,
    );
    expect(r).toEqual({ aEncaisser: 650, nbAEncaisser: 1, nbRetard: 0, brouillons: 1750.5, nbBrouillons: 4 });
    expect(encaisserLegende(r)).toBe("1 facture en attente");
    expect(brouillonsLegende(r.nbBrouillons)).toBe("4 factures pas encore émises");
  });

  it("une facture en attente échue compte en retard", () => {
    const r = encaisserResume(
      [
        { status: "attente", date: "2026-11-01", amount: "300" },
        { status: "retard", date: "2026-10-01", amount: "200" },
        { status: "attente", date: "2026-12-30", amount: "100" },
      ],
      now,
    );
    expect(r.aEncaisser).toBe(600);
    expect(r.nbRetard).toBe(2);
    expect(encaisserLegende(r)).toBe("3 factures, dont 2 en retard");
  });

  it("rien à encaisser", () => {
    const r = encaisserResume([], now);
    expect(encaisserLegende(r)).toBe("Aucune facture en attente");
    expect(brouillonsLegende(0)).toBe("Aucun brouillon");
  });
});

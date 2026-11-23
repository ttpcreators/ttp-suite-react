import { describe, expect, it } from "vitest";
import { parseAmountStrict } from "./money";
import { cachetCurrency } from "./collabLinks";
import { payoutNotedSince } from "./collabs";
import { cachetCurrency as cachetCurrencyServeur, parseAmountStrict as parseAmountStrictServeur, versementDepuis } from "../../supabase/functions/_shared/controle.ts";
import { controler, sansDoublonAujourdhui, toneOf, type ControleInput } from "./controle";

// Le contrôle (supabase/functions/_shared/controle.ts) garde ses copies des lectures de
// montant de l'app : elles doivent rendre exactement la même chose.
const CACHETS = ["1 500 €", "1500€ HT", "1.500 €", "1,5k", "3k€", "800 € x 2", "2 x 500 €", "550 $", "550 usd", "300 £", "affiliation", "gifting", "", null, "0 €", "1 200,50 €", "10 % des ventes", "500 CHF", "2000 AED"];

describe("contrôle : mêmes lectures que l'app", () => {
  it("parseAmountStrict", () => {
    for (const c of CACHETS) expect(parseAmountStrictServeur(c)).toBe(parseAmountStrict(c));
  });
  it("cachetCurrency", () => {
    for (const c of CACHETS) expect(cachetCurrencyServeur(c)).toBe(cachetCurrency(c));
  });
  it("versement noté (payoutNotedSince)", () => {
    const payouts = { "LÉA TEST": [{ date: "2026-11-10", amount: 300 }], Autre: [{ date: "2026-12-01", amount: 5 }] };
    for (const [who, since] of [["Lea Test", "2026-11-01"], ["lea test", "2026-11-11"], ["Autre", null], ["Personne", null]] as const) {
      expect(versementDepuis(payouts, who, since)).toBe(payoutNotedSince(payouts, who, since));
    }
  });
});

const input = (o: Partial<ControleInput>): ControleInput => ({
  aujourdhui: "2026-11-23",
  collabs: [],
  collabSteps: [],
  invoices: [],
  creators: [],
  briefs: [],
  prospects: [],
  todos: [],
  contacts: [],
  payouts: {},
  contractHistory: null,
  ...o,
});

describe("sansDoublonAujourdhui", () => {
  const list = controler(
    input({
      collabs: [
        { id: "c1", brand: "Alpha", creator: null, step: 6, status: "active", cachet: "500 €" },
        { id: "c2", brand: "Beta", creator: null, step: 7, status: "active", cachet: "500 €" },
      ],
      collabSteps: [
        { collab_id: "c1", step: 6, reached_at: "2026-10-01T10:00:00Z" },
        { collab_id: "c2", step: 6, reached_at: "2026-10-01T10:00:00Z" },
      ],
    }),
  );
  it("une collab déjà dans « Collabs à faire avancer » n'est pas répétée", () => {
    expect(list.map((p) => p.id)).toEqual(["publiee_sans_facture:c1", "publiee_sans_facture:c2"]);
    expect(sansDoublonAujourdhui(list, new Set(["c1"])).map((p) => p.id)).toEqual(["publiee_sans_facture:c2"]);
  });
  it("teinte par gravité (jamais le rouge de l'argent en retard)", () => {
    expect([toneOf("haute"), toneOf("moyenne"), toneOf("basse")]).toEqual(["wait", "info", "closed"]);
  });
});

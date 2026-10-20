import { describe, expect, it } from "vitest";
import { filterItems, rangeLabel, sectionsOf } from "./aujourdhui";
import {
  anticipationLine,
  buildAnticipation,
  collabStaleDays,
  collapseItems,
  contractEnd,
  contractsToRenew,
  groupSteps,
  sectionFor,
  statsMissing,
  type AnticipationInput,
} from "./anticipation";

// Mercredi 21 octobre 2026, 9 h 30 (heure locale) : « Cette semaine » = 23 au 28 oct.
const NOW = new Date(2026, 9, 21, 9, 30);

const base: AnticipationInput = {
  todos: [],
  events: [],
  briefs: [],
  invoices: [],
  contracts: [],
  collabs: [],
  collabSteps: {},
  statsCreators: [],
  snoozed: {},
  now: NOW,
};

const todo = (id: string, due: string, over: Partial<{ priority: string | null; done: boolean; status: string }> = {}) => ({
  id,
  text: `Tâche ${id}`,
  due,
  done: over.done ?? false,
  status: over.status ?? null,
  priority: over.priority ?? null,
  creator: null,
});

const inv = (id: string, date: string, status = "attente") => ({ id, ref: `2026-${id}`, party: "JNPR", amount: "600", date, status, creator: "léna pasquale" });

describe("fenêtres", () => {
  it("demain, cette semaine (J+2 à J+7), à anticiper (J+8 à J+30)", () => {
    expect(sectionFor(0)).toBeNull();
    expect(sectionFor(1)).toBe("tomorrow");
    expect(sectionFor(2)).toBe("week");
    expect(sectionFor(7)).toBe("week");
    expect(sectionFor(8)).toBe("later");
    expect(sectionFor(30)).toBe("later");
    expect(sectionFor(31)).toBeNull();
  });

  it("plage de dates à droite de la section", () => {
    expect(rangeLabel("2026-10-23", "2026-10-28")).toMatch(/^23 au 28 oct\.?$/);
    expect(rangeLabel("2026-10-29", "2026-11-20")).toMatch(/^29 oct\.? au 20 nov\.?$/);
  });
});

describe("tâches, agenda, briefs", () => {
  it("tâches ouvertes par fenêtre, priorité haute en tête de section", () => {
    const items = buildAnticipation({
      ...base,
      todos: [
        todo("today", "2026-10-21"),
        todo("demain", "2026-10-22"),
        todo("j5", "2026-10-26"),
        todo("j3haute", "2026-10-24", { priority: "haute" }),
        todo("j10", "2026-10-31"),
        todo("j40", "2026-11-30"),
        todo("fait", "2026-10-25", { done: true }),
        todo("fait2", "2026-10-25", { status: "Fait" }),
      ],
    });
    expect(items.map((i) => [i.id, i.section])).toEqual([
      ["todo:j3haute", "week"],
      ["todo:demain", "tomorrow"],
      ["todo:j5", "week"],
      ["todo:j10", "later"],
    ]);
    expect(items[0].priority).toBe(true);
    expect(items[0].sub).toBe("Agence · priorité haute");
    expect(items[2].metaSub).toBe("dans 5 j");
  });

  it("agenda et briefs : J+2 à J+30 (demain reste dans « Demain »)", () => {
    const items = buildAnticipation({
      ...base,
      events: [
        { id: "1", date: "2026-10-22", day: null, time: "10:00", title: "Demain", type: "call", who: null },
        { id: "2", date: "2026-10-27", day: null, time: "14h30", title: "Shoot Nike", type: "shoot", who: "léna" },
        { id: "3", date: "2026-11-15", day: null, time: null, title: "Event", type: "event", who: null },
      ],
      briefs: [
        { id: "b1", brand: "Saucony", creator: null, due: "2026-10-25", status: "cours", deliverables: null },
        { id: "b2", brand: "Fini", creator: null, due: "2026-10-25", status: "terminé", deliverables: null },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["brief:b1", "ev:2", "ev:3"]);
    expect(items[1].metaSub).toBe("14:30");
    expect(items[1].sub).toBe("Léna · Shoot");
  });
});

describe("factures qui arrivent à échéance", () => {
  it("« En attente » pas en retard, d'aujourd'hui à J+30", () => {
    const items = buildAnticipation({
      ...base,
      invoices: [inv("1", "2026-10-26"), inv("2", "2026-10-20"), inv("3", "2026-10-26", "payee"), inv("4", "21/10/2026"), inv("5", "2026-12-01"), inv("6", "2026-11-05")],
    });
    expect(items.map((i) => [i.id, i.section])).toEqual([
      ["due:4", "tomorrow"],
      ["due:1", "week"],
      ["due:6", "later"],
    ]);
    expect(items[0].metaSub).toBe("en retard demain");
    expect(items[1].kind).toBe("echeance");
    expect(items[1].title).toBe("JNPR × Léna Pasquale");
    expect(items[1].sub).toMatch(/^Facture #2026-1 arrive à échéance le 26 oct\.?$/);
    expect(items[1].amount).toBe(600);
  });

  it("sans accès Finance : aucune", () => {
    expect(buildAnticipation({ ...base, invoices: null })).toEqual([]);
  });
});

describe("contrats à renouveler", () => {
  it("fin = début + durée, bornée à la fin du mois", () => {
    expect(contractEnd("2026-01-31", 1)).toBe("2026-02-28");
    expect(contractEnd("2025-11-15", 12)).toBe("2026-11-15");
    expect(contractEnd("pas une date", 12)).toBeNull();
  });

  it("sous 30 jours ou expirés, sauf s'ils ont été renouvelés", () => {
    const list = contractsToRenew(
      [
        { id: "a", creator: "LÉNA", type: "représentation", start: "2025-11-15", months: 12 }, // fin 15 nov. (J+25)
        { id: "b", creator: "Ana", type: "marque", start: "2026-04-26", months: 6 }, // fin 26 oct. (J+5)
        { id: "c", creator: "Sarah", type: "ugc", start: "2026-04-11", months: 6 }, // fin 11 oct. (expiré)
        { id: "d", creator: "Zoé", type: "marque", start: "2026-06-01", months: 12 }, // trop loin
        { id: "e", creator: "Mia", type: "représentation", start: "2025-10-01", months: 12 }, // expiré...
        { id: "f", creator: "mia", type: "Représentation", start: "2026-10-01", months: 12 }, // ...mais renouvelé
      ],
      "2026-10-21",
    );
    expect(list.map((c) => [c.id, c.left])).toEqual([
      ["c", -10],
      ["b", 5],
      ["a", 25],
    ]);
  });

  it("lignes : expiré et proche dans la semaine, le reste à anticiper", () => {
    const items = buildAnticipation({
      ...base,
      contracts: [
        { id: "a", creator: "LÉNA", type: "représentation", start: "2025-11-15", months: 12 },
        { id: "c", creator: "sarah benali", type: "ugc", start: "2026-04-11", months: 6 },
      ],
    });
    expect(items.map((i) => [i.id, i.section, i.metaSub])).toEqual([
      ["ct:c", "week", "expiré depuis 10 j"],
      ["ct:a", "later", "expire dans 25 j"],
    ]);
    expect(items[0].title).toBe("Contrat à renouveler");
    expect(items[0].sub).toBe("Sarah Benali · UGC");
    expect(items[0].tone).toBe("wait");
    expect(items[1].tone).toBe("info");
  });

  it("page Échéances fermée au profil : aucun", () => {
    expect(buildAnticipation({ ...base, contracts: null })).toEqual([]);
  });
});

describe("collabs bloquées", () => {
  const collab = (id: string, step: number, status = "active", updated_at: string | null = "2026-10-01T10:00:00Z") => ({ id, brand: "Nike", creator: "léna pasquale", step, status, updated_at });
  const steps = groupSteps([
    { collab_id: "x", step: 3, reached_at: "2026-10-01T10:00:00Z" },
    { collab_id: "x", step: 4, reached_at: "2026-10-12T06:00:00Z" },
    { collab_id: "y", step: 4, reached_at: "2026-10-19T08:00:00Z" },
  ]);

  it("7 jours ou plus sur l'étape courante, collab en cours et pas bouclée", () => {
    expect(collabStaleDays(collab("x", 4), steps.x, NOW)).toBe(9);
    expect(collabStaleDays(collab("y", 4), steps.y, NOW)).toBeNull();
    expect(collabStaleDays(collab("z", 2), undefined, NOW)).toBe(19); // repli sur updated_at
    expect(collabStaleDays(collab("w", 11), undefined, NOW)).toBeNull();
    expect(collabStaleDays(collab("v", 2, "gagnee"), undefined, NOW)).toBeNull();
  });

  it("ligne « Débloquer » dans la semaine, la plus ancienne en tête", () => {
    const items = buildAnticipation({ ...base, collabs: [collab("x", 4), collab("z", 2), collab("y", 4)], collabSteps: steps });
    expect(items.map((i) => i.id)).toEqual(["collab:z", "collab:x"]);
    expect(items[1].title).toBe("Débloquer : Nike × Léna Pasquale");
    expect(items[1].sub).toBe("Bloquée depuis 9 j à Tournage");
    expect(items[1].section).toBe("week");
  });
});

describe("stats du mois", () => {
  const creators = [
    { name: "léna pasquale", status: "actif", stats_month: "2026-09" },
    { name: "ana", status: null, stats_month: null },
    { name: "zoé", status: "actif", stats_month: "2026-10" },
    { name: "mia", status: "Inactif", stats_month: null },
  ];

  it("seulement à partir du 25, créateurs actifs pas à jour", () => {
    expect(statsMissing(creators, NOW)).toEqual([]);
    expect(statsMissing(creators, new Date(2026, 9, 25, 9))).toEqual(["Léna Pasquale", "Ana"]);
  });

  it("une seule ligne « Relancer les stats »", () => {
    const items = buildAnticipation({ ...base, statsCreators: creators, now: new Date(2026, 9, 26, 9) });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Relancer les stats de 2 créateurs");
    expect(items[0].sub).toBe("Léna Pasquale, Ana");
    expect(items[0].section).toBe("week");
  });
});

describe("page", () => {
  const items = buildAnticipation({
    ...base,
    todos: [todo("a", "2026-10-22"), todo("b", "2026-10-24"), todo("c", "2026-11-02")],
    invoices: [inv("1", "2026-10-26")],
    contracts: [{ id: "c", creator: "sarah", type: "ugc", start: "2026-04-11", months: 6 }],
  });

  it("filtres : échéance de facture dans Argent, contrats dans Talents", () => {
    expect(filterItems(items, "argent").map((i) => i.kind)).toEqual(["echeance"]);
    expect(filterItems(items, "talents").map((i) => i.kind)).toEqual(["contrat", "todo", "todo", "todo"]);
    expect(filterItems(items, "boite")).toEqual([]);
  });

  it("sections « Cette semaine » et « À anticiper » avec leur plage", () => {
    const s = sectionsOf(items, NOW);
    expect(s.map((x) => x.id)).toEqual(["tomorrow", "week", "later"]);
    expect(s[1].title).toBe("Cette semaine");
    expect(s[1].right).toMatch(/^23 au 28 oct\.?$/);
    expect(s[2].title).toBe("À anticiper");
    expect(s[2].right).toMatch(/^29 oct\.? au 20 nov\.?$/);
  });

  it("ligne d'en-tête : demain et la semaine", () => {
    expect(anticipationLine(items)).toBe("+ 4 à anticiper cette semaine");
    expect(anticipationLine([])).toBe("");
  });

  it("report « Demain » : la ligne disparaît", () => {
    expect(buildAnticipation({ ...base, todos: [todo("b", "2026-10-24")], snoozed: { "todo:b": "2026-10-22" } })).toEqual([]);
  });

  it("repli : 5 lignes puis « Voir les N autres »", () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(collapseItems(list, false)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 3 });
    expect(collapseItems(list, true)).toEqual({ shown: list, hidden: 0 });
    expect(collapseItems([1, 2, 3, 4, 5, 6], false)).toEqual({ shown: [1, 2, 3, 4, 5, 6], hidden: 0 });
  });
});

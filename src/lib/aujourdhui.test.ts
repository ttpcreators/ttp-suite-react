import { describe, expect, it } from "vitest";
import {
  buildToday,
  commissionRateFor,
  creatorShare,
  filterItems,
  invoiceTitle,
  isSnoozed,
  mailMinutes,
  parseSnooze,
  parseTime,
  relativeIn,
  sectionsOf,
  snooze,
  summaryLine,
  totalMinutes,
  type TodayInput,
} from "./aujourdhui";
import { overdueInvoices, relanceEmail } from "./relance";

// Mardi 20 octobre 2026, 9 h 30 (heure locale).
const NOW = new Date(2026, 9, 20, 9, 30);

const base: TodayInput = {
  invoices: [],
  reminders: {},
  todos: [],
  events: [],
  briefs: [],
  mails: null,
  snoozed: {},
  money: true,
  now: NOW,
};

const inv = (id: string, over: Partial<{ amount: string; date: string; status: string; creator: string | null; party: string }> = {}) => ({
  id,
  ref: `2026-${id}`,
  party: over.party ?? "JNPR",
  amount: over.amount ?? "600",
  date: over.date ?? "2026-09-17",
  status: over.status ?? "attente",
  creator: over.creator === undefined ? "LÉNA PASQUALE" : over.creator,
});

describe("factures en retard", () => {
  it("garde « retard » et « attente » échue, trie de la plus ancienne", () => {
    const list = overdueInvoices(
      [inv("1", { date: "2026-10-01" }), inv("2", { date: "2026-09-17" }), inv("3", { status: "payee" }), inv("4", { date: "2026-10-25" }), inv("5", { status: "retard", date: "" })],
      NOW,
    );
    expect(list.map((o) => o.iv.id)).toEqual(["2", "1", "5"]);
    expect(list[0].late).toBe(33);
  });

  it("ligne argent : titre marque × créateur, montant et jours de retard", () => {
    const { items } = buildToday({ ...base, invoices: [inv("186")] });
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.section).toBe("argent");
    expect(it0.title).toBe("JNPR × Léna Pasquale");
    expect(it0.sub).toBe("Facture #2026-186 · relance prête");
    expect(it0.metaSub).toBe("33 j");
    expect(it0.tone).toBe("late");
    expect(it0.verb).toBe("Relancer");
  });

  it("relancée aujourd'hui : sort de la liste et compte comme traitée", () => {
    const r = buildToday({ ...base, invoices: [inv("186")], reminders: { "186": { last: "2026-10-20", count: 1 } } });
    expect(r.items).toHaveLength(0);
    expect(r.done).toEqual([{ id: "inv:186", label: "Relance JNPR × Léna Pasquale", kind: "relance" }]);
  });

  it("sans accès Finance : aucune ligne argent", () => {
    expect(buildToday({ ...base, invoices: [inv("1")], money: false }).items).toHaveLength(0);
  });

  it("titre sans créateur", () => {
    expect(invoiceTitle({ party: "Sanytol", creator: null })).toBe("Sanytol");
    expect(invoiceTitle({ party: "Nike x Sarah", creator: "sarah benali" })).toBe("Nike x Sarah");
    expect(invoiceTitle({ party: "JNPR", creator: "léna pasquale" })).toBe("JNPR × Léna Pasquale");
  });
});

describe("to-do, agenda, briefs, mails", () => {
  it("tâche en retard : teinte attente et « N j de retard »", () => {
    const { items } = buildToday({
      ...base,
      todos: [
        { id: "a", text: "Monte une vidéo", due: "14/10/2026", done: false, priority: "haute", creator: "ANA MILANOVIC", subtasks: [{ done: false }, { done: false }] },
        { id: "b", text: "Plus tard", due: "2026-10-30", done: false, priority: null, creator: null },
        { id: "c", text: "Sans date", due: "—", done: false, priority: null, creator: null },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["todo:a"]);
    expect(items[0].sub).toBe("Ana Milanovic · priorité haute");
    expect(items[0].meta).toBe("0 / 2");
    expect(items[0].metaSub).toBe("6 j de retard");
    expect(items[0].metaTone).toBe("wait");
  });

  it("tâche terminée aujourd'hui : dans les traitées", () => {
    const r = buildToday({ ...base, todos: [{ id: "x", text: "Envoyer le contrat", due: null, done: true, priority: null, creator: null, done_at: new Date(2026, 9, 20, 8, 0).toISOString() }] });
    expect(r.done.map((d) => d.id)).toEqual(["todo:x"]);
  });

  it("agenda : aujourd'hui trié par heure, terminé depuis plus d'une heure retiré, demain à part", () => {
    const { items } = buildToday({
      ...base,
      events: [
        { id: "1", date: "2026-10-20", day: null, time: "14:30", title: "Call avec Pauline", type: "call", who: null },
        { id: "2", date: "2026-10-20", day: null, time: "07:00", title: "Petit déj", type: "reunion", who: null },
        { id: "3", date: "2026-10-20", day: null, time: "10h", title: "Shoot", type: "shoot", who: "léna" },
        { id: "4", date: "2026-10-21", day: null, time: null, title: "Event Zeina", type: "event", who: "LÉNA PASQUALE" },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["ev:3", "ev:1", "ev:4"]);
    expect(items[1].meta).toBe("14:30");
    expect(items[1].metaSub).toBe("dans 5 h");
    expect(items[2].section).toBe("tomorrow");
    expect(items[2].sub).toBe("Léna Pasquale · Event");
  });

  it("briefs : échéance aujourd'hui ou demain, hors terminés", () => {
    const { items } = buildToday({
      ...base,
      briefs: [
        { id: "b1", brand: "Saucony", creator: "léna", due: "2026-10-21", status: "cours", deliverables: "1 reel" },
        { id: "b2", brand: "Fini", creator: null, due: "2026-10-20", status: "terminé", deliverables: null },
      ],
    });
    expect(items.map((i) => [i.id, i.section])).toEqual([["brief:b1", "tomorrow"]]);
    expect(items[0].sub).toBe("Léna · 1 reel");
  });

  it("mails : une ligne avec le détail par boîte", () => {
    const { items } = buildToday({ ...base, mails: [{ box: "partnerships", label: "partnerships@", count: 9 }, { box: "talent", label: "talent@", count: 4 }] });
    expect(items[0].title).toBe("13 mails non lus");
    expect(items[0].sub).toBe("partnerships@ 9 · talent@ 4");
    expect(items[0].minutes).toBe(mailMinutes(13));
  });
});

describe("estimation, filtres, sections", () => {
  const r = buildToday({
    ...base,
    invoices: [inv("1"), inv("2", { amount: "100", party: "Sanytol", creator: "webedia" })],
    todos: [{ id: "a", text: "Tâche", due: "2026-10-20", done: false, priority: null, creator: null }],
    mails: [{ box: "partnerships", label: "partnerships@", count: 3 }],
    events: [{ id: "e", date: "2026-10-21", day: null, time: "09:00", title: "Brief", type: "call", who: null }],
  });

  it("minutes = somme des constantes par type", () => {
    expect(totalMinutes(r.items)).toBe(2 + 2 + 3 + 2 + 2);
    expect(summaryLine(r.items)).toBe("5 actions à traiter · environ 11 min");
  });

  it("filtres Argent / Talents / Boîte", () => {
    expect(filterItems(r.items, "argent").map((i) => i.kind)).toEqual(["relance", "relance"]);
    expect(filterItems(r.items, "boite").map((i) => i.kind)).toEqual(["mails"]);
    expect(filterItems(r.items, "talents").map((i) => i.kind)).toEqual(["todo", "event"]);
    expect(filterItems(r.items, "tout")).toHaveLength(5);
  });

  it("sections non vides, total € à droite de l'argent, date à droite de demain", () => {
    const s = sectionsOf(r.items, NOW);
    expect(s.map((x) => x.id)).toEqual(["argent", "today", "tomorrow"]);
    expect(s[0].right.replace(/\s/g, " ")).toBe("700 €");
    expect(s[2].right).toMatch(/^Mer\. 21 oct\.?$/);
    expect(sectionsOf([], NOW)).toEqual([]);
  });
});

describe("snooze « Demain »", () => {
  it("cache jusqu'au lendemain puis oublie les reports échus", () => {
    const m = snooze({ old: "2026-10-19" }, "inv:1", "2026-10-21", "2026-10-20");
    expect(m).toEqual({ "inv:1": "2026-10-21" });
    expect(isSnoozed(m, "inv:1", "2026-10-20")).toBe(true);
    expect(isSnoozed(m, "inv:1", "2026-10-21")).toBe(false);
    expect(buildToday({ ...base, invoices: [inv("1")], snoozed: m }).items).toHaveLength(0);
  });

  it("lecture tolérante du stockage", () => {
    expect(parseSnooze(null)).toEqual({});
    expect(parseSnooze("pas du json")).toEqual({});
    expect(parseSnooze('{"a":"2026-10-21","b":3,"c":"demain"}')).toEqual({ a: "2026-10-21" });
  });
});

describe("heures, commission, email", () => {
  it("heures", () => {
    expect(parseTime("14:30")).toBe(870);
    expect(parseTime("9h")).toBe(540);
    expect(parseTime("—")).toBeNull();
    expect(relativeIn(20)).toBe("dans 20 min");
    expect(relativeIn(0)).toBe("maintenant");
  });

  it("part du créateur : HT moins la commission, taux roster puis ancien blob puis défaut", () => {
    expect(commissionRateFor("léna", { léna: 25 }, { léna: 10 })).toBe(25);
    expect(commissionRateFor("ana", {}, { ana: 10 })).toBe(10);
    expect(commissionRateFor(null, {}, {})).toBe(20);
    expect(creatorShare("600", undefined, 20).reversal).toBe(480);
    // Sous 100 € HT : pas de commission (seuil du contrat).
    expect(creatorShare("80", undefined, 20).reversal).toBe(80);
    // Facture détaillée : commission sur le HT, taux de la facture.
    expect(creatorShare("1200", { items: [{ id: "1", label: "Reel", qty: 1, unit: 1000 }], franchise: false, vatRate: 20, commissionRate: 30 }, 20).reversal).toBe(700);
  });

  it("email de relance : ton qui monte, sans tiret long", () => {
    const first = relanceEmail({ ref: "2026-186", party: "JNPR", amount: "600" }, 0);
    expect(first.subject).not.toMatch(/[—–]/);
    expect(first.body).toContain("Je me permets de revenir vers vous");
    expect(relanceEmail({ ref: "2026-186", party: "JNPR", amount: "600" }, 2).body).toContain("Malgré nos précédentes relances");
  });
});

import { describe, expect, it } from "vitest";
import { KEY_RE, dueIso, parisNow, quandTache, resumeWidget, sha256Hex, timeOf, widgetKeyOf } from "./widget.ts";

// Jeudi 19 novembre 2026, 15 h 30 à Paris (14 h 30 UTC, heure d'hiver).
const NOW = new Date("2026-11-19T14:30:00Z");

describe("parisNow", () => {
  it("donne le jour et l'heure de Paris, pas d'UTC", () => {
    expect(parisNow(NOW)).toEqual({ day: "2026-11-19", time: "15:30" });
    // 23 h 30 UTC le 19 = déjà le 20 à Paris.
    expect(parisNow(new Date("2026-11-19T23:30:00Z")).day).toBe("2026-11-20");
  });
});

describe("dueIso et timeOf", () => {
  it("lit les deux formats d'échéance", () => {
    expect(dueIso("2026-11-20")).toBe("2026-11-20");
    expect(dueIso("5/12/2026")).toBe("2026-12-05");
    expect(dueIso("—")).toBe("");
    expect(dueIso(null)).toBe("");
  });
  it("lit l'heure ou rien", () => {
    expect(timeOf("9:00")).toBe("09:00");
    expect(timeOf("14h30")).toBe("14:30");
    expect(timeOf("—")).toBe("");
  });
});

describe("quandTache", () => {
  it("retard, aujourd'hui, demain, bientôt", () => {
    expect(quandTache("2026-11-17", "2026-11-19")).toEqual({ quand: "2 j de retard", ton: "retard" });
    expect(quandTache("2026-11-19", "2026-11-19")).toEqual({ quand: "aujourd'hui", ton: "jour" });
    expect(quandTache("2026-11-20", "2026-11-19")).toEqual({ quand: "demain", ton: "bientot" });
    expect(quandTache("2026-11-22", "2026-11-19").ton).toBe("bientot");
    expect(quandTache("2026-12-01", "2026-11-19").ton).toBe("");
    expect(quandTache("", "2026-11-19")).toEqual({ quand: "", ton: "" });
  });
});

describe("resumeWidget", () => {
  const todos = [
    { text: "Sans échéance basse", priority: "basse", sort_order: 1 },
    { text: "Sans échéance haute", priority: "haute", sort_order: 9 },
    { text: "À venir", due: "2026-11-25", priority: "moyenne" },
    { text: "Du jour", due: "2026-11-19", creators: ["LÉNA MOREL", "inès faure"] },
    { text: "Très en retard", due: "2026-11-10", creator: "CAMILLE LEFORT" },
    { text: "Un peu en retard", due: "18/11/2026" },
    { text: "   " },
  ];
  const events = [
    { date: "2026-11-19", time: "10:00", title: "Call passé", type: "call" },
    { date: "2026-11-19", time: "17:00", title: "Call Nova", type: "call", who: "LÉNA MOREL" },
    { date: "2026-11-19", time: "—", title: "Poster le reel", type: "deadline" },
    { date: "2026-11-20", time: "09:00", title: "Tournage", type: "shoot" },
    { date: "2026-11-27", title: "Trop loin", type: "call" },
    { date: "2026-11-18", title: "Hier", type: "call" },
  ];
  const r = resumeWidget(todos, events, NOW);

  it("compte les tâches ouvertes, en retard et du jour", () => {
    expect(r.taches).toMatchObject({ ouvertes: 6, retard: 2, aujourdhui: 1 });
  });
  it("trie : retard, jour, à venir, puis sans échéance (haute d'abord)", () => {
    expect(r.taches.liste.map((t) => t.t.split(" · ")[0])).toEqual([
      "Très en retard", "Un peu en retard", "Du jour", "À venir", "Sans échéance haute", "Sans échéance basse",
    ]);
    expect(r.taches.liste[0]).toMatchObject({ t: "Très en retard · Camille Lefort", quand: "9 j de retard", ton: "retard" });
    expect(r.taches.liste[2].t).toBe("Du jour · Léna Morel, Inès Faure");
    expect(r.taches.liste[4].haute).toBe(true);
  });
  it("planning : de maintenant à J+7, rendez-vous passés du jour retirés", () => {
    expect(r.planning.liste.map((e) => e.t)).toEqual(["Poster le reel", "Call Nova · Léna Morel", "Tournage"]);
    expect(r.planning.liste[0]).toMatchObject({ quand: "Aujourd'hui", heure: "", deadline: true, ton: "jour" });
    expect(r.planning.liste[2]).toMatchObject({ quand: "Demain", heure: "09:00", deadline: false, ton: "demain" });
    expect(r.planning.total).toBe(3);
    expect(r.planning.liste.map((e) => e.court)).toEqual(["Auj.", "17:00", "Dem. 09:00"]);
    expect(resumeWidget([], [{ date: "2026-11-21", title: "Samedi", type: "call" }], NOW).planning.liste[0].court).toBe("sam. 21");
  });
  it("borne les listes", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ text: `T${i}` }));
    expect(resumeWidget(many, [], NOW).taches.liste).toHaveLength(12);
    expect(resumeWidget(many, [], NOW).taches.ouvertes).toBe(30);
  });
  it("rend un JSON léger (le widget le lit en entier)", () => {
    expect(JSON.stringify(r).length).toBeLessThan(4000);
  });
});

describe("clé du widget", () => {
  it("n'accepte qu'une empreinte SHA-256 bien formée", () => {
    expect(widgetKeyOf({ hash: "a".repeat(64), ts: 5 })).toEqual({ hash: "a".repeat(64), ts: 5 });
    expect(widgetKeyOf({ hash: "court" })).toBeNull();
    expect(widgetKeyOf(null)).toBeNull();
    expect(widgetKeyOf("x")).toBeNull();
  });
  it("forme de la clé et empreinte", async () => {
    expect(KEY_RE.test("A".repeat(43))).toBe(true);
    expect(KEY_RE.test("A".repeat(42))).toBe(false);
    expect(KEY_RE.test("A".repeat(42) + "/")).toBe(false);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("resumeMails", () => {
  const rows = [
    { contact_name: "Manon", contact_email: "manon@marque-exemple.fr", subject: "Facture", created_at: "2026-11-19T13:02:00Z", box: "partnerships", direction: "in" },
    { contact_name: "", contact_email: "Inès <ines@x.fr>", subject: "  Contrat\n signé ", created_at: "2026-11-18T09:00:00Z", box: "talent", direction: "in" },
    { contact_name: "Lu ailleurs", contact_email: "a@b.fr", subject: "x", created_at: "2026-11-19T10:00:00Z", box: "talent", read_at: "2026-11-19T11:00:00Z" },
    { contact_name: "Newsletter", contact_email: "news@promo.fr", subject: "x", created_at: "2026-11-19T12:00:00Z", box: "partnerships" },
    { contact_name: "Envoyé", contact_email: "c@d.fr", subject: "x", created_at: "2026-11-19T12:00:00Z", direction: "out" },
    { contact_name: "Vieux", contact_email: "e@f.fr", subject: "x", created_at: "2026-11-16T12:00:00Z" },
  ];
  const m = resumeWidget([], [], NOW, rows, { "news@promo.fr": 1 }).mails;
  it("garde les non lus reçus, sans les expéditeurs « Pas à traiter »", () => {
    expect(m.liste.map((x) => x.de)).toEqual(["Manon", "ines@x.fr", "Vieux"]);
    expect(m).toMatchObject({ nonLus: 3, partnerships: 1, talent: 1 });
  });
  it("heure du jour, « hier », sinon le jour", () => {
    expect(m.liste.map((x) => x.quand)).toEqual(["14:02", "hier", "lun. 16"]);
    expect(m.liste[1]).toMatchObject({ objet: "Contrat signé", boite: "talent" });
  });
});

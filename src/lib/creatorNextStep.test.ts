import { describe, expect, it } from "vitest";
import { creatorSteps, depositBrand, invoiceForCollab, monthlyStatsSent, openBriefs, pickNextStep, whenLabel, type NextStepInput, type NsCollab, type NsDoc } from "./creatorNextStep";

// Mardi 20 octobre 2026, 9 h 30 (heure locale).
const NOW = new Date(2026, 9, 20, 9, 30);

const base: NextStepInput = { briefs: [], collabs: [], todos: [], events: [], invoices: [], statsStale: false, now: NOW };
const brief = (over: Partial<NextStepInput["briefs"][number]>) => ({
  id: "b1", brand: "Marque X", deliverables: "1 reel", due: null, status: "cours", consignes: "Mon script", ...over,
});

describe("prochaine étape du créateur", () => {
  it("rien à faire : aucune étape", () => {
    expect(pickNextStep(base)).toBeNull();
    expect(creatorSteps(base)).toEqual([]);
  });

  it("un contenu en retard passe avant tout le reste", () => {
    const s = pickNextStep({
      ...base,
      statsStale: true,
      briefs: [brief({ id: "a", status: "valider", due: "2026-10-30" }), brief({ id: "b", brand: "Marque Y", due: "2026-10-18" })],
    });
    expect(s?.kind).toBe("deliverable");
    expect(s?.vars.brand).toBe("Marque Y");
    expect(s?.days).toBe(-2);
    expect(s?.target).toEqual({ tab: "missions", briefId: "b" });
  });

  it("brief « À valider » : rien à demander ; brief seul sans script : pas de carte script", () => {
    const steps = creatorSteps({
      ...base,
      statsStale: true,
      briefs: [brief({ id: "s", consignes: null, due: "2026-11-20" }), brief({ id: "v", status: "À valider", due: "2026-10-01" })],
    });
    expect(steps.map((x) => x.kind)).toEqual(["stats"]);
  });

  it("un brief terminé n'apparaît pas", () => {
    expect(creatorSteps({ ...base, briefs: [brief({ status: "Terminé", due: "2026-10-01" })] })).toEqual([]);
  });

  it("à rendre d'ici 2 jours : urgent, avec les livrables en détail", () => {
    const s = pickNextStep({ ...base, briefs: [brief({ due: "21/10/2026" })] });
    expect(s?.bucket).toBe(1);
    expect(s?.detail).toBe("{text}");
    expect(s?.detailVars.text).toBe("1 reel");
  });

  it("rendez-vous de demain avant une tâche prioritaire sans date", () => {
    const steps = creatorSteps({
      ...base,
      events: [{ id: "e1", date: "2026-10-21", day: null, time: "14:00", title: "Tournage Marque X", type: "shoot" }],
      todos: [{ id: "t1", text: "Monter la vidéo", due: null, priority: "haute", done: false }],
    });
    expect(steps.map((x) => x.id)).toEqual(["event:e1", "todo:t1"]);
    expect(steps[0].detailVars.time).toBe("14:00");
    expect(steps[0].days).toBe(1);
  });

  it("les rendez-vous passés ou lointains et les tâches faites sont ignorés", () => {
    const steps = creatorSteps({
      ...base,
      events: [
        { id: "old", date: "2026-10-19", day: null, time: null, title: "Hier", type: null },
        { id: "far", date: "2026-11-20", day: null, time: null, title: "Loin", type: null },
      ],
      todos: [{ id: "t", text: "Fait", due: null, priority: null, done: true }],
    });
    expect(steps).toEqual([]);
  });

  it("vague 1 : une tâche suivie par l'agence n'est pas sa prochaine étape, une tâche demandée oui", () => {
    const steps = creatorSteps({
      ...base,
      todos: [
        { id: "suivie", text: "Relancer Marque X", due: "2026-10-17", priority: "haute", done: false, source: "agency", pour_createur: false },
        { id: "demandee", text: "Envoyer ta preview à Marque X", due: "2026-10-21", priority: null, done: false, source: "agency", pour_createur: true },
        { id: "avant-sql", text: "Signer le contrat", due: null, priority: null, done: false, source: "agency" },
      ],
    });
    expect(steps.map((x) => x.id)).toEqual(["todo:demandee", "todo:avant-sql"]);
  });

  it("collab à l'étape facturation sans facture à ce nom : dépôt proposé", () => {
    const steps = creatorSteps({
      ...base,
      collabs: [
        { id: "c1", brand: "Marque A", step: 9, status: "active", brief_id: null },
        { id: "c2", brand: "Marque B", step: 9, status: "active", brief_id: null },
        { id: "c3", brand: "Perdue", step: 9, status: "perdue", brief_id: null },
      ],
      invoices: [{ party: "marque b" }],
    });
    expect(steps.map((x) => x.id)).toEqual(["invoice:c1"]);
    // Le dépôt part de la carte avec sa collab (lien documents.collab_id).
    expect(steps[0].target).toEqual({ tab: "gains", collabId: "c1" });
  });

  describe("briefs selon l'étape de la collab", () => {
    const col = (step: number, over: Partial<NsCollab> = {}): NsCollab => ({ id: "c1", brand: "Marque X", step, status: "active", brief_id: "bx", ...over });
    const bx = (over: Partial<NextStepInput["briefs"][number]> = {}) => brief({ id: "bx", brand: "Marque X", consignes: null, ...over });
    const ids = (input: Partial<NextStepInput>) => creatorSteps({ ...base, ...input }).map((s) => s.id);

    it("signature (étape 1) : aucune carte, même un brief vide ou une échéance passée", () => {
      expect(ids({ collabs: [col(1)], briefs: [bx()] })).toEqual([]);
      expect(ids({ collabs: [col(1)], briefs: [bx({ due: "2026-10-10" })] })).toEqual([]);
      // Une collab gagnée suit la même règle.
      expect(ids({ collabs: [col(1, { status: "gagnee" })], briefs: [bx()] })).toEqual([]);
    });

    it("script seulement à l'étape 2, tant qu'aucun concept n'est proposé", () => {
      expect(ids({ collabs: [col(2)], briefs: [bx()] })).toEqual(["brief-script:bx"]);
      expect(ids({ collabs: [col(3)], briefs: [bx()] })).toEqual([]);
      expect(ids({ collabs: [col(4)], briefs: [bx()] })).toEqual([]);
      const proposed = { bx: { read_at: "2026-10-18T10:00:00Z", concept: "Une idée", concept_status: "propose" } };
      expect(ids({ collabs: [col(2)], briefs: [bx()], concepts: proposed })).toEqual([]);
    });

    it("« Lire le brief » avant le script, quand « J'ai lu » n'est pas encore touché", () => {
      const unread = { bx: { read_at: null, concept: null, concept_status: null } };
      const steps = creatorSteps({ ...base, collabs: [col(2)], briefs: [bx()], concepts: unread });
      expect(steps.map((s) => [s.id, s.title, s.bucket])).toEqual([["brief-read:bx", "Lire le brief {brand}", 2]]);
      expect(steps[0].target).toEqual({ tab: "missions", briefId: "bx" });
      const read = { bx: { read_at: "2026-10-19T08:00:00Z", concept: null, concept_status: null } };
      expect(ids({ collabs: [col(2)], briefs: [bx()], concepts: read })).toEqual(["brief-script:bx"]);
      // Colonnes absentes (concepts null) : on ne sait pas, pas de carte « Lire ».
      expect(ids({ collabs: [col(2)], briefs: [bx()], concepts: null })).toEqual(["brief-script:bx"]);
    });

    it("échéance : jusqu'à l'étape 4, plus rien une fois le contenu validé (étape 5)", () => {
      expect(ids({ collabs: [col(4)], briefs: [bx({ due: "2026-10-18" })] })).toEqual(["brief-late:bx"]);
      expect(ids({ collabs: [col(4)], briefs: [bx({ due: "2026-10-21" })] })).toEqual(["brief-soon:bx"]);
      expect(ids({ collabs: [col(5)], briefs: [bx({ due: "2026-10-18" })] })).toEqual([]);
      // Collab perdue : son brief redevient un brief seul (échéance, pas de script).
      expect(ids({ collabs: [col(5, { status: "perdue" })], briefs: [bx({ due: "2026-10-18" })] })).toEqual(["brief-late:bx"]);
    });

    it("rapprochement par marque sans brief_id, comme les missions", () => {
      const open = openBriefs({ collabs: [col(1, { brief_id: null }), col(3, { id: "c2", brand: "Marque Y", brief_id: null })], briefs: [bx(), brief({ id: "by", brand: "marque y" }), brief({ id: "bz", brand: "Marque Z" })] });
      expect(open.map((o) => [o.brief.id, o.collab?.id ?? null])).toEqual([["by", "c2"], ["bz", null]]);
    });
  });

  describe("facture qui n'apparaît pas", () => {
    const waiting = (over: Partial<NsCollab> = {}): NsCollab => ({ id: "c1", brand: "Marque A", step: 10, status: "active", brief_id: null, ...over });
    const ids = (input: Partial<NextStepInput>) => creatorSteps({ ...base, ...input }).map((s) => s.id);

    it("libellé « Marque × Prénom » ou facture reliée à la collab : rien à déposer", () => {
      expect(invoiceForCollab({ party: "Marque A × Créatrice" }, waiting())).toBe(true);
      expect(invoiceForCollab({ party: "MARQUE A x Créatrice" }, waiting())).toBe(true);
      expect(invoiceForCollab({ party: "Marque B × Créatrice" }, waiting())).toBe(false);
      expect(invoiceForCollab({ party: "Autre libellé", collab_id: "c1" }, waiting())).toBe(true);
      // Facture reliée à une autre collab de la même marque : elle ne compte pas pour celle-ci.
      expect(invoiceForCollab({ party: "Marque A × Créatrice", collab_id: "c0" }, waiting())).toBe(false);
      expect(ids({ collabs: [waiting({ status: "gagnee" })], invoices: [{ party: "Marque A × Créatrice", collab_id: "c1" }] })).toEqual([]);
    });

    it("facture déjà déposée par le créateur pour cette collab", () => {
      const doc = (over: Partial<NsDoc>): NsDoc => ({ type: "facture", name: "Facture · Créatrice · 10 oct.", path: "creator-uploads/u1/facture-1.pdf", created_at: "2026-10-10T10:00:00Z", ...over });
      const two = [waiting(), waiting({ id: "c2", brand: "Marque B" })];
      // Reliée à la collab : seulement celle-là.
      expect(ids({ collabs: two, docs: [doc({ collab_id: "c2" })] })).toEqual(["invoice:c1"]);
      // Sans lien (avant le SQL) : un dépôt récent qui cite la marque.
      expect(ids({ collabs: two, docs: [doc({ name: "Facture Marque A · Créatrice · 10 oct." })] })).toEqual(["invoice:c2"]);
      // Dépôt sans marque : compte seulement quand une seule collab attend sa facture.
      expect(ids({ collabs: two, docs: [doc({})] })).toEqual(["invoice:c1", "invoice:c2"]);
      expect(ids({ collabs: [waiting()], docs: [doc({})] })).toEqual([]);
      // Jamais de masquage sans limite : un dépôt sans lien de plus de 30 jours ne compte plus.
      expect(ids({ collabs: [waiting()], docs: [doc({ created_at: "2026-09-01T10:00:00Z" })] })).toEqual(["invoice:c1"]);
      // Un autre type de dépôt ne compte pas.
      expect(ids({ collabs: [waiting()], docs: [doc({ type: "contenu" })] })).toEqual(["invoice:c1"]);
      // Fichier facture de l'agence (page Documents, hors creator-uploads/) : la carte reste.
      expect(ids({ collabs: [waiting()], docs: [doc({ name: "facture-scan.pdf", path: "1730000000000-facture-scan.pdf" })] })).toEqual(["invoice:c1"]);
    });

    it("la marque d'un dépôt se lit après « Facture », jamais dans le nom du créateur ni dans la date", () => {
      expect(depositBrand("Facture Marque B · Créatrice A · 12 mai")).toBe("Marque B");
      expect(depositBrand("Facture · Créatrice A · 12 mai")).toBe("");
      expect(depositBrand("facture-scan.pdf")).toBe("");
      expect(depositBrand(null)).toBe("");
      const doc = (name: string, created_at: string): NsDoc => ({ type: "facture", name, path: "creator-uploads/u1/facture-1.pdf", created_at });
      // Dépôt sans marque fait en mai : la collab « Mai » n'est pas cachée pour autant.
      const may = { now: new Date(2026, 4, 20, 9, 30), collabs: [waiting({ brand: "Mai" }), waiting({ id: "c2", brand: "Marque B" })] };
      expect(ids({ ...may, docs: [doc("Facture · Créatrice A · 12 mai", "2026-05-12T10:00:00Z")] })).toEqual(["invoice:c1", "invoice:c2"]);
      expect(ids({ ...may, docs: [doc("Facture Mai · Créatrice A · 12 mai", "2026-05-12T10:00:00Z")] })).toEqual(["invoice:c2"]);
      // Marque qui porte le nom du créateur : même règle.
      const two = [waiting({ brand: "Créatrice" }), waiting({ id: "c2", brand: "Marque B" })];
      expect(ids({ collabs: two, docs: [doc("Facture · Créatrice A · 10 oct.", "2026-10-10T10:00:00Z")] })).toEqual(["invoice:c1", "invoice:c2"]);
    });
  });

  describe("stats du mois déjà envoyées", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const capture = (over: Partial<NsDoc>): NsDoc => ({ type: "stats", name: "Stats · Créatrice · 14 nov.", path: "creator-uploads/u1/stats-1-0.jpg", created_at: "2026-11-14T09:00:00Z", ...over });
    it("une capture du mois (mois de Paris) envoyée depuis son espace", () => {
      expect(monthlyStatsSent([capture({})], now)).toBe(true);
      expect(monthlyStatsSent([capture({ name: "Stats — Créatrice — 14 nov." })], now)).toBe(true);
      // 1er novembre à 0 h 30 à Paris : novembre, même si c'est encore octobre en UTC.
      expect(monthlyStatsSent([capture({ created_at: "2026-10-31T23:30:00Z" })], now)).toBe(true);
      expect(monthlyStatsSent([capture({ created_at: "2026-10-31T21:00:00Z" })], now)).toBe(false);
      expect(monthlyStatsSent([], now)).toBe(false);
    });
    it("pas les stats à 7 jours d'un post, ni un fichier déposé par l'agence", () => {
      expect(monthlyStatsSent([capture({ name: "Stats Marque X · Créatrice · 14 nov." })], now)).toBe(false);
      expect(monthlyStatsSent([capture({ collab_id: "c1" })], now)).toBe(false);
      expect(monthlyStatsSent([capture({ path: "agence/stats.png" })], now)).toBe(false);
      expect(monthlyStatsSent([capture({ type: "contenu" })], now)).toBe(false);
    });
  });

  it("libellés du « quand »", () => {
    expect(whenLabel(null)).toBeNull();
    expect(whenLabel(-3)).toEqual({ key: "Depuis {n} jours", vars: { n: 3 } });
    expect(whenLabel(-1)?.key).toBe("Depuis hier");
    expect(whenLabel(0)?.key).toBe("Aujourd'hui");
    expect(whenLabel(1)?.key).toBe("Demain");
    expect(whenLabel(4)).toEqual({ key: "Dans {n} jours", vars: { n: 4 } });
    expect(whenLabel(10)).toBeNull();
  });

  it("colonnes vides en base : jamais de titre vide ni de mot français en dur", () => {
    const steps = creatorSteps({
      ...base,
      briefs: [brief({ id: "x", brand: null, due: "2026-10-10" })],
      todos: [{ id: "t", text: " ", due: null, priority: null, done: false }],
      events: [{ id: "e", date: "2026-10-21", day: null, time: null, title: null, type: null }],
    });
    expect(steps.find((s) => s.id === "brief-late:x")?.vars.brand).toBe("—");
    expect(steps.find((s) => s.id === "todo:t")?.vars.text).toBe("—");
    // Rendez-vous sans titre : la clé elle-même (traduite à l'affichage), pas une variable.
    expect(steps.find((s) => s.id === "event:e")).toMatchObject({ title: "Rendez-vous", vars: {} });
  });
});

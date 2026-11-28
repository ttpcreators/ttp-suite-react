import { describe, expect, it } from "vitest";
import {
  cachetGifting, collabDeFacture, gagneeHorsBilan, collabsSoldees, etapeAAtteindre, memeMarque, prospectASigner, prospectOuvert, texteAvance, texteProspectSigne,
  type LigneDue, type ProspectAuto,
} from "./collabAuto";
import { ligneAvance, ligneProspectSigne } from "../../supabase/functions/_shared/collabAuto.ts";
import { apresCollabSignee, apresFacturePayee, apresVersement, atteindreEtape } from "../../supabase/functions/_shared/collabAutoDb.ts";
import { guessCollabId } from "./collabLinks";
import { sameBrand } from "./brandRecord";
import { dealKind } from "./dealKind";

describe("étape à atteindre", () => {
  it("avance, jamais en arrière, jamais une collab perdue ou archivée", () => {
    expect(etapeAAtteindre({ step: 8, status: "active" }, 9)).toBe(9);
    expect(etapeAAtteindre({ step: 6, status: "gagnee" }, 9)).toBe(9);
    expect(etapeAAtteindre({ step: 9, status: "active" }, 10)).toBe(10);
    expect(etapeAAtteindre({ step: 9, status: "active" }, 9)).toBeNull();
    expect(etapeAAtteindre({ step: 11, status: "active" }, 10)).toBeNull();
    expect(etapeAAtteindre({ step: 2, status: "perdue" }, 9)).toBeNull();
    expect(etapeAAtteindre({ step: 2, status: "archivee" }, 9)).toBeNull();
    expect(etapeAAtteindre(null, 9)).toBeNull();
  });
  it("étape plancher : acompte payé trop tôt, versement avant le paiement de la marque", () => {
    expect(etapeAAtteindre({ step: 2, status: "active" }, 9)).toBeNull(); // facture d'acompte payée à l'étape 2
    expect(etapeAAtteindre({ step: 5, status: "active" }, 9)).toBeNull();
    expect(etapeAAtteindre({ step: 4, status: "active" }, 10)).toBeNull(); // versement à l'étape 4
    expect(etapeAAtteindre({ step: 8, status: "active" }, 10)).toBeNull();
  });
});

describe("collab d'une facture", () => {
  const collabs = [
    { id: "c1", brand: "Nutripure", creator: "LÉNA TEST" },
    { id: "c2", brand: "Opéra Air", creator: "ANA TEST" },
    { id: "c3", brand: "Opéra Air", creator: "ANA TEST" },
  ];
  it("le lien enregistré d'abord, sinon la seule collab de même marque et même créateur", () => {
    expect(collabDeFacture({ collab_id: "c9", party: "Nutripure × Léna", creator: "LÉNA TEST" }, collabs)).toBe("c9");
    expect(collabDeFacture({ party: "Nutripure × Léna", creator: "Léna Test" }, collabs)).toBe("c1");
    expect(collabDeFacture({ party: "Nutripure × Léna", creator: "Zoé Test" }, collabs)).toBeNull();
    // Deux collabs candidates : on ne devine pas.
    expect(collabDeFacture({ party: "Opera Air × Ana", creator: "ANA TEST" }, collabs)).toBeNull();
  });
  it("même rapprochement que la fiche collab (guessCollabId)", () => {
    const cas = [
      { party: "Nutripure × Léna", creator: "LÉNA TEST" },
      { party: "Nutripure x Léna", creator: "Léna" },
      { party: "Nutripurex", creator: "LÉNA TEST" },
      { party: "Opéra Air", creator: "ANA TEST" },
      { party: "Autre marque", creator: null },
    ];
    for (const f of cas) expect(collabDeFacture(f, collabs)).toBe(guessCollabId("invoices", f, collabs));
  });
});

describe("versement au créateur : collabs soldées", () => {
  const a: LigneDue = { id: "f1", collabId: "c1", paidOn: "2026-10-01", du: 800 };
  const b: LigneDue = { id: "f2", collabId: "c2", paidOn: "2026-11-01", du: 400 };
  it("le versement solde la plus ancienne facture : sa collab", () => {
    expect(collabsSoldees([a, b], 0, 800)).toEqual(["c1"]);
    expect(collabsSoldees([b, a], 800, 400)).toEqual(["c2"]);
    expect(collabsSoldees([a, b], 0, 1200)).toEqual(["c1", "c2"]);
    // Arrondi toléré (0,50 €).
    expect(collabsSoldees([a], 0, 799.6)).toEqual(["c1"]);
  });
  it("doute : rien (facture à moitié payée, trop versé, versement nul)", () => {
    expect(collabsSoldees([a, b], 0, 400)).toEqual([]); // la part de b, mais a est la plus ancienne
    expect(collabsSoldees([a, b], 0, 1000)).toEqual([]);
    expect(collabsSoldees([a], 0, 900)).toEqual([]);
    expect(collabsSoldees([a], 800, 100)).toEqual([]);
    expect(collabsSoldees([a], 0, 0)).toEqual([]);
  });
  it("une facture sans collab soldée ne fait rien avancer", () => {
    expect(collabsSoldees([{ ...a, collabId: null }], 0, 800)).toEqual([]);
  });
});

describe("collab signée : prospect de la marque", () => {
  const p = (x: Partial<ProspectAuto>): ProspectAuto => ({ id: "p1", brand: "Nutripure", stage: "Négociation", created_at: "2026-11-01T09:00:00Z", ...x });
  const collab = { id: "c1", brand: "NUTRIPURE", creator: "Léna Test", cachet: "800 €", created_at: "2026-11-10T09:00:00Z" };
  it("normalisation des marques identique à la fiche marque", () => {
    for (const [x, y] of [["Décathlon", "decathlon"], ["Alo Yoga", "aloyoga"], ["L'Oréal", "LOreal"], ["Nike", "Nikes"], ["", ""]]) {
      expect(memeMarque(x, y)).toBe(sameBrand(x, y));
    }
  });
  it("prospect ouvert : ni signé ni perdu", () => {
    expect(prospectOuvert("Négociation")).toBe(true);
    expect(prospectOuvert(null)).toBe(true);
    expect(prospectOuvert("Signé")).toBe(false);
    expect(prospectOuvert("Perdue")).toBe(false);
    expect(prospectOuvert("perdu")).toBe(false);
  });
  it("gifting : même règle que dealKind", () => {
    for (const c of ["gifting", "Produits offerts", "0 €", "800 €", "300 € + produits", "", "—", "affiliation"]) {
      expect(cachetGifting(c)).toBe(dealKind(c) === "gifting");
    }
  });
  it("le prospect ouvert de la marque, jamais un perdu, jamais relié à une autre collab", () => {
    expect(prospectASigner([p({})], collab)?.id).toBe("p1");
    expect(prospectASigner([p({ stage: "Perdue" })], collab)).toBeNull();
    expect(prospectASigner([p({ stage: "Signé" })], collab)).toBeNull();
    expect(prospectASigner([p({ collab_id: "c2" })], collab)).toBeNull();
    expect(prospectASigner([p({ collab_id: "c1" })], collab)?.id).toBe("p1");
    expect(prospectASigner([p({ creator: "Ana Test" })], collab)).toBeNull();
    expect(prospectASigner([p({ brand: "Autre" })], collab)).toBeNull();
    expect(prospectASigner([p({})], { ...collab, cachet: "gifting" })).toBeNull();
  });
  it("jamais un prospect d'un autre créateur, jamais un prospect plus récent que la collab", () => {
    expect(prospectASigner([p({ creator: "LÉNA TEST" })], collab)?.id).toBe("p1");
    expect(prospectASigner([p({ creator: "Ana Test" })], { ...collab, creator: null })).toBeNull();
    expect(prospectASigner([p({ created_at: "2026-11-12T09:00:00Z" })], collab)).toBeNull();
    expect(prospectASigner([p({ created_at: null })], collab)).toBeNull();
    expect(prospectASigner([p({})], { ...collab, created_at: null })).toBeNull();
    expect(prospectASigner([p({ created_at: collab.created_at })], collab)?.id).toBe("p1");
  });
  it("gagnée à la main avant le bilan seulement : pas le renouvellement après l'étape 11", () => {
    expect(gagneeHorsBilan("active", "gagnee", 5)).toBe(true);
    expect(gagneeHorsBilan("active", "gagnee", 11)).toBe(false);
    expect(gagneeHorsBilan("gagnee", "gagnee", 5)).toBe(false);
    expect(gagneeHorsBilan("active", "perdue", 5)).toBe(false);
  });
  it("plusieurs prospects : celui du même créateur s'il est seul, sinon rien", () => {
    expect(prospectASigner([p({}), p({ id: "p2", creator: "LÉNA TEST" })], collab)?.id).toBe("p2");
    expect(prospectASigner([p({}), p({ id: "p2" })], collab)).toBeNull();
  });
});

describe("textes", () => {
  it("toasts de l'app et lignes du connecteur", () => {
    expect(texteAvance({ brand: "Nutripure", creator: "LÉNA TEST", step: 9 })).toBe("Nutripure × Léna : étape 9 · Paiement marque ✓");
    expect(texteProspectSigne("Nutripure")).toBe("Prospect Nutripure passé en « Signée » ✓");
    expect(ligneAvance({ brand: "Nutripure", creator: "LÉNA TEST", step: 10 })).toBe("Collab Nutripure × Léna passée toute seule à l'étape 10 « Créateur payé ».");
    expect(ligneProspectSigne("Nutripure")).toContain("Signé");
    for (const t of [texteAvance({ brand: "X", creator: null, step: 9 }), ligneAvance({ brand: "X", creator: null, step: 9 })]) expect(t).not.toMatch(/[—–]/);
  });
});

// ── Écritures, sur une base en mémoire ──────────────────────────────────────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { failTables?: string[] } = {}) {
  const calls: string[] = [];
  const from = (table: string) => {
    let op: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const b = {
      select: () => b,
      update: (p: Row) => ((op = "update"), (patch = p), b),
      insert: (p: Row) => ((op = "insert"), (patch = p), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      lt: (c: string, v: number) => (filters.push((r) => Number(r[c]) < v), b),
      not: (c: string, _o: string, list: string) => (filters.push((r) => !list.replace(/[()]/g, "").split(",").includes(String(r[c]))), b),
      limit: () => b,
      maybeSingle: () => ((single = true), b),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        try {
          if (opts.failTables?.includes(table)) return Promise.resolve({ data: null, error: { message: "réseau" } }).then(ok, ko);
          const rows = (tables[table] ??= []);
          calls.push(`${op} ${table}`);
          if (op === "insert") {
            rows.push({ id: `n${rows.length}`, ...patch });
            return Promise.resolve({ data: [patch], error: null }).then(ok, ko);
          }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") hit.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: single ? hit[0] ?? null : hit, error: null }).then(ok, ko);
        } catch (e) {
          return Promise.reject(e).then(ok, ko);
        }
      },
    };
    return b;
  };
  return { from, calls, tables };
}

describe("écritures des étapes automatiques", () => {
  it("facture payée : la collab passe à 9 une seule fois, avec son historique", async () => {
    const db = fakeDb({
      invoices: [{ id: "f1", status: "payee", party: "Nutripure × Léna", creator: "LÉNA TEST", collab_id: null, paid_at: "2026-11-20T10:00:00Z" }],
      collabs: [{ id: "c1", brand: "Nutripure", creator: "LÉNA TEST", step: 8, status: "active" }],
      collab_steps: [],
    });
    expect(await apresFacturePayee(db, "f1")).toEqual({ collabId: "c1", brand: "Nutripure", creator: "LÉNA TEST", step: 9 });
    expect(db.tables.collabs[0].step).toBe(9);
    expect(db.tables.collab_steps).toEqual([{ id: "n0", collab_id: "c1", step: 9, reached_at: "2026-11-20T10:00:00.000Z" }]);
    expect(await apresFacturePayee(db, "f1")).toBeNull();
    expect(db.tables.collab_steps.length).toBe(1);
  });
  it("facture payée sans lien : le lien est écrit avant que l'étape avance (indice ou rapprochement)", async () => {
    // Indice : collab choisie dans l'éditeur, lien pas encore enregistré.
    const db = fakeDb({
      invoices: [{ id: "f1", status: "payee", party: "Autre", creator: "X", collab_id: null }],
      collabs: [{ id: "c1", brand: "Marque X", creator: "CRÉATRICE A", step: 8, status: "active" }],
      collab_steps: [],
    });
    expect((await apresFacturePayee(db, "f1", "c1"))?.step).toBe(9);
    expect(db.tables.invoices[0].collab_id).toBe("c1");
    expect(db.calls.indexOf("update invoices")).toBeLessThan(db.calls.indexOf("update collabs"));
    // Rapprochement marque + créateur.
    const db2 = fakeDb({
      invoices: [{ id: "f2", status: "payee", party: "Marque X × Créatrice", creator: "CRÉATRICE A", collab_id: null }],
      collabs: [{ id: "c2", brand: "Marque X", creator: "CRÉATRICE A", step: 8, status: "active" }],
      collab_steps: [],
    });
    expect((await apresFacturePayee(db2, "f2"))?.collabId).toBe("c2");
    expect(db2.tables.invoices[0].collab_id).toBe("c2");
    expect(db2.calls.indexOf("update invoices")).toBeLessThan(db2.calls.indexOf("update collabs"));
    // Facture déjà liée : son lien ne change jamais.
    const db3 = fakeDb({
      invoices: [{ id: "f3", status: "payee", collab_id: "c3" }],
      collabs: [{ id: "c3", step: 8, status: "active" }, { id: "c4", step: 8, status: "active" }],
      collab_steps: [],
    });
    await apresFacturePayee(db3, "f3", "c4");
    expect(db3.tables.invoices[0].collab_id).toBe("c3");
    expect(db3.calls).not.toContain("update invoices");
  });
  it("jamais en arrière, jamais une facture non payée, jamais une collab perdue", async () => {
    const db = fakeDb({
      invoices: [{ id: "f1", status: "attente", collab_id: "c1" }, { id: "f2", status: "payee", collab_id: "c2" }],
      collabs: [{ id: "c1", step: 3, status: "active" }, { id: "c2", step: 10, status: "active" }, { id: "c3", step: 3, status: "perdue" }],
    });
    expect(await apresFacturePayee(db, "f1")).toBeNull();
    expect(await apresFacturePayee(db, "f2")).toBeNull();
    expect(db.tables.collabs[1].step).toBe(10);
    expect(await atteindreEtape(db, "c3", 9)).toBeNull();
    expect(db.tables.collabs[2].step).toBe(3);
  });
  it("erreur réseau : rien, sans lever", async () => {
    const db = fakeDb({ collabs: [{ id: "c1", step: 3, status: "active" }] }, { failTables: ["invoices", "prospects", "collabs"] });
    expect(await apresFacturePayee(db, "f1", "c1")).toBeNull();
    expect(await apresCollabSignee(db, "c1")).toBeNull();
    expect(await apresVersement(db, { createur: "X", lignes: [{ id: "f", collabId: "c1", paidOn: "2026-11-01", du: 10 }], dejaVerse: 0, montant: 10 })).toEqual([]);
  });
  it("versement : collab soldée à 10, collab désignée seulement si elle est à ce créateur", async () => {
    const db = fakeDb({
      collabs: [
        { id: "c1", brand: "Nutripure", creator: "LÉNA TEST", step: 9, status: "gagnee" },
        { id: "c2", brand: "Opéra Air", creator: "ANA TEST", step: 9, status: "active" },
        { id: "c3", brand: "Seoni", creator: "LÉNA TEST", step: 4, status: "active" },
      ],
      collab_steps: [{ collab_id: "c1", step: 10 }],
    });
    const lignes = [{ id: "f1", collabId: null, party: "Nutripure × Léna", paidOn: "2026-11-01", du: 640 }];
    expect((await apresVersement(db, { createur: "Léna Test", lignes, dejaVerse: 0, montant: 640 })).map((a) => a.collabId)).toEqual(["c1"]);
    expect(db.tables.collab_steps.length).toBe(1); // ligne d'historique déjà là : pas de doublon
    expect(await apresVersement(db, { createur: "Léna Test", lignes: [], dejaVerse: 0, montant: 100, collab: "c2" })).toEqual([]);
    expect(db.tables.collabs[1].step).toBe(9);
    expect((await apresVersement(db, { createur: "Ana Test", lignes: [], dejaVerse: 0, montant: 100, collab: "c2" })).length).toBe(1);
    // Versement pour une collab encore à l'étape 4 : rien.
    expect(await apresVersement(db, { createur: "Léna Test", lignes: [], dejaVerse: 0, montant: 100, collab: "c3" })).toEqual([]);
    expect(db.tables.collabs[2].step).toBe(4);
  });
  it("facture d'acompte payée à l'étape 2 : rien", async () => {
    const db = fakeDb({ invoices: [{ id: "f1", status: "payee", collab_id: "c1" }], collabs: [{ id: "c1", step: 2, status: "active" }] });
    expect(await apresFacturePayee(db, "f1")).toBeNull();
    expect(db.tables.collabs[0].step).toBe(2);
  });
  it("collab signée : le prospect passe « Signé » et garde le lien, une fois", async () => {
    const db = fakeDb({
      collabs: [
        { id: "c1", brand: "nutripure", creator: "LÉNA TEST", cachet: "800 €", created_at: "2026-11-10T09:00:00Z" },
        { id: "c2", brand: "Opéra Air", creator: "LÉNA TEST", cachet: "500 €", created_at: "2026-11-10T09:00:00Z" },
      ],
      prospects: [
        { id: "p1", brand: "Nutripure", stage: "Négociation", creator: null, collab_id: null, created_at: "2026-11-01T09:00:00Z" },
        { id: "p2", brand: "Nutripure", stage: "Perdue", created_at: "2026-11-01T09:00:00Z" },
        { id: "p3", brand: "Opera Air", stage: "Négociation", creator: null, collab_id: null, created_at: "2026-11-15T09:00:00Z" },
      ],
    });
    expect(await apresCollabSignee(db, "c1")).toEqual({ id: "p1", brand: "Nutripure" });
    expect(db.tables.prospects[0]).toMatchObject({ stage: "Signé", collab_id: "c1" });
    expect(db.tables.prospects[1].stage).toBe("Perdue");
    expect(await apresCollabSignee(db, "c1")).toBeNull();
    // Prospect ouvert APRÈS la collab (renouvellement en discussion) : jamais signé.
    expect(await apresCollabSignee(db, "c2")).toBeNull();
    expect(db.tables.prospects[2].stage).toBe("Négociation");
  });
});

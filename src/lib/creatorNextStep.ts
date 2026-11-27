import { daysBetween, eventISO, localISO } from "./aujourdhui";
import { toISODate } from "./dates";
import { briefKey, pairCollabBriefs } from "./creatorMissions";
import { isDone } from "./collabs";
import { conceptState } from "./briefConcept";
import { partyBrand, sameBrand } from "./brandRecord";
import { mentionsBrand } from "./collabLinks";

/**
 * « Ta prochaine étape » de l'espace créateur (logique PURE, testable sous Node).
 * Une seule question : qu'est-ce que je fais maintenant ? On classe ce que l'espace
 * lit DÉJÀ (briefs, collabs, tâches, planning, factures, stats du mois) par urgence :
 *   0  contenu dont l'échéance est passée
 *   1  à rendre d'ici 2 jours, rendez-vous aujourd'hui ou demain, tâche due
 *   2  brief à lire (étape 2, « J'ai lu » pas encore touché)
 *   3  script à écrire (étape 2, pas encore de concept)
 *   4  à rendre d'ici 14 jours, rendez-vous de la semaine
 *   5  stats du mois à envoyer
 *   6  facture qui n'apparaît pas, tâche prioritaire
 *   7  autres tâches
 * À urgence égale : la date la plus proche d'abord. Les textes sont des clés
 * françaises (+ variables) traduites à l'affichage.
 */

export type NsBrief = { id: string; brand: string | null; deliverables: string | null; due: string | null; status: string | null; consignes: string | null };
export type NsCollab = { id: string; brand: string; step: number; status: string | null; brief_id: string | null };
/** `pour_createur` : tâche de l'agence demandée au créateur (SQL 2026-11-27 ; undefined tant que la colonne manque). */
export type NsTodo = { id: string; text: string; due: string | null; priority: string | null; done: boolean; status?: string | null; source?: string | null; pour_createur?: boolean | null };
export type NsEvent = { id: string; date: string | null; day: number | null; time: string | null; title: string | null; type: string | null };
/** `collab_id` : collab de la facture (absent si la colonne n'est pas lue). */
export type NsInvoice = { party: string | null; collab_id?: string | null };
/** « J'ai lu » et concept d'un brief (colonnes SQL 2026-11-23). */
export type NsConcept = { read_at: string | null; concept: string | null; concept_status: string | null };
/** Un fichier de son dossier (table documents) ; `collab_id` : dépôt fait depuis une mission (SQL 2026-11-27). */
export type NsDoc = { type: string | null; name: string | null; path: string | null; created_at: string | null; collab_id?: string | null };

/** `validate` (l'ancienne carte « Valider le brief ») n'est plus produit ; le type reste pour les écrans qui le citent. */
export type NextStepKind = "deliverable" | "validate" | "script" | "event" | "todo" | "stats" | "invoice";
export type NextStepTarget =
  | { tab: "missions"; briefId?: string; collabId?: string }
  | { tab: "todo"; todoId: string }
  | { tab: "planning" }
  | { tab: "gains"; collabId?: string }
  | { tab: "stats" };

export type NextStep = {
  id: string;
  kind: NextStepKind;
  /** Clé française du titre + variables. */
  title: string;
  vars: Record<string, string>;
  /** Clé française du détail + variables (texte libre passé par « {text} »). */
  detail: string;
  detailVars: Record<string, string>;
  /** Date ISO de l'échéance, null si aucune. */
  due: string | null;
  /** Jours d'ici l'échéance (négatif = passée), null si aucune. */
  days: number | null;
  bucket: number;
  target: NextStepTarget;
};

export type NextStepInput = {
  briefs: NsBrief[];
  collabs: NsCollab[];
  todos: NsTodo[];
  events: NsEvent[];
  invoices: NsInvoice[];
  /** Stats du mois pas encore à jour (même indicateur que l'accueil). */
  statsStale: boolean;
  now: Date;
  /** « J'ai lu » et concept par id de brief ; null ou absent : colonnes pas lues, rien n'est demandé là-dessus. */
  concepts?: Record<string, NsConcept> | null;
  /** Son dossier (dépôts de factures surtout) ; absent : aucun. */
  docs?: NsDoc[];
};

/** Texte repris tel quel dans un titre : jamais vide (« — » si la base n'a rien). */
const shown = (s: string | null | undefined) => String(s ?? "").trim() || "—";
const text = (s: string | null | undefined, fallback: string): { detail: string; detailVars: Record<string, string> } =>
  s && s.trim() && s.trim() !== "—" ? { detail: "{text}", detailVars: { text: s.trim() } } : { detail: fallback, detailVars: {} };

/**
 * Briefs qui demandent encore quelque chose au créateur, avec leur collab (null : brief
 * seul), reliés comme les missions. Jamais un brief terminé ni « À valider » (son travail
 * attend l'agence, même sens que la cloche de l'agence). Brief relié à une collab :
 * seulement du brief transmis (étape 2) au tournage (étape 4). À la signature, le brief
 * créé avec la collab est vide ; une fois le contenu validé, son échéance ne le concerne plus.
 */
export function openBriefs(input: Pick<NextStepInput, "briefs" | "collabs">): { brief: NsBrief; collab: NsCollab | null }[] {
  const collabOf = new Map<string, NsCollab>();
  for (const [collabId, b] of pairCollabBriefs(input.collabs, input.briefs)) {
    const c = input.collabs.find((x) => x.id === collabId);
    if (c) collabOf.set(b.id, c);
  }
  const out: { brief: NsBrief; collab: NsCollab | null }[] = [];
  for (const b of input.briefs) {
    const k = briefKey(b.status ?? "attente");
    if (k === "terminé" || k === "valider") continue;
    const collab = collabOf.get(b.id) ?? null;
    if (collab && (collab.step < 2 || collab.step > 4)) continue;
    out.push({ brief: b, collab });
  }
  return out;
}

/** La facture est-elle celle de cette collab ? Reliée (`collab_id`), sinon la marque de son libellé (« Marque × Prénom »). */
export function invoiceForCollab(i: NsInvoice, c: Pick<NsCollab, "id" | "brand">): boolean {
  if (i.collab_id) return i.collab_id === c.id;
  return sameBrand(partyBrand(i.party), c.brand) || mentionsBrand(i.party, c.brand);
}

/** Un dépôt sans lien vers sa collab compte au plus 30 jours (jamais de masquage sans limite). */
const DEPOSIT_DAYS = 30;

const parisMonth = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(d);

/**
 * Captures « stats du mois » envoyées ce mois-ci (mois de Paris) depuis son espace : son
 * dépôt (`creator-uploads/…`) de type stats nommé « Stats · … ». Les captures des stats à
 * 7 jours d'un post (reliées à une collab, nommées « Stats {marque} · … ») ne comptent pas.
 * Elles attendent l'agence : seule l'agence coche le mois (`creators.stats_month`).
 */
export function monthlyStatsSent(docs: readonly NsDoc[], now: Date): boolean {
  const month = parisMonth(now);
  return docs.some((d) => {
    if (d.type !== "stats" || d.collab_id || !String(d.path ?? "").startsWith("creator-uploads/")) return false;
    if (!/^Stats\s+[·—–-]\s/.test(d.name ?? "")) return false;
    const at = new Date(d.created_at ?? "");
    return !Number.isNaN(at.getTime()) && parisMonth(at) === month;
  });
}

export function creatorSteps(input: NextStepInput): NextStep[] {
  const today = localISO(input.now);
  const out: NextStep[] = [];
  const daysTo = (iso: string) => daysBetween(today, iso);

  // ── Briefs en cours : une seule étape par brief, la plus urgente (voir openBriefs).
  for (const { brief: b, collab: c } of openBriefs(input)) {
    const due = toISODate(b.due) || null;
    const days = due ? daysTo(due) : null;
    const target: NextStepTarget = { tab: "missions", briefId: b.id };
    const base = { due, days, target, vars: { brand: shown(b.brand) } };
    const concept = input.concepts?.[b.id];
    // Lire le brief puis écrire son script : à l'étape 2 seulement (à l'étape 3, le concept
    // est validé), tant qu'aucun concept n'est proposé. Brief seul : pas de carte script.
    const atBrief = c?.step === 2 && conceptState(concept) === "aucun";
    if (days != null && days < 0) {
      out.push({ ...base, id: `brief-late:${b.id}`, kind: "deliverable", title: "Rendre ton contenu {brand}", ...text(b.deliverables, "Livrables à préciser"), bucket: 0 });
    } else if (days != null && days <= 2) {
      out.push({ ...base, id: `brief-soon:${b.id}`, kind: "deliverable", title: "Contenu à rendre pour {brand}", ...text(b.deliverables, "Livrables à préciser"), bucket: 1 });
    } else if (atBrief && concept && !concept.read_at) {
      // Type « deliverable » : le bouton de la page Aujourd'hui dit « Ouvrir ».
      out.push({ ...base, id: `brief-read:${b.id}`, kind: "deliverable", title: "Lire le brief {brand}", detail: "Puis touche « J'ai lu » : ton agence le voit.", detailVars: {}, bucket: 2 });
    } else if (atBrief && !b.consignes?.trim()) {
      out.push({ ...base, id: `brief-script:${b.id}`, kind: "script", title: "Écrire ton script pour {brand}", detail: "Ton agence le voit dès que tu l'enregistres.", detailVars: {}, bucket: 3 });
    } else if (days != null && days <= 14) {
      out.push({ ...base, id: `brief-next:${b.id}`, kind: "deliverable", title: "Contenu à rendre pour {brand}", ...text(b.deliverables, "Livrables à préciser"), bucket: 4 });
    }
  }

  // ── Collabs à l'étape facturation (8 à 10) dont la facture n'apparaît pas : on propose
  // le dépôt (même filet que « Déposer ma facture »). Une facture qu'il a déjà déposée
  // pour cette collab suffit : reliée à la collab, sinon un dépôt récent qui cite la marque,
  // ou qui n'en cite aucune quand une seule collab attend sa facture.
  const waiting = input.collabs.filter(
    (c) => c.status !== "perdue" && c.status !== "archivee" && !isDone(c.step) && c.step >= 8 && c.step <= 10 && !input.invoices.some((i) => invoiceForCollab(i, c)),
  );
  const deposits = (input.docs ?? []).filter((d) => d.type === "facture");
  const depositFor = (d: NsDoc, c: NsCollab) => {
    if (d.collab_id) return d.collab_id === c.id;
    const at = Date.parse(d.created_at ?? "");
    if (!Number.isFinite(at) || input.now.getTime() - at > DEPOSIT_DAYS * 86_400_000) return false;
    if (mentionsBrand(d.name, c.brand)) return true;
    return waiting.length === 1 && !input.collabs.some((x) => mentionsBrand(d.name, x.brand));
  };
  for (const c of waiting) {
    if (deposits.some((d) => depositFor(d, c))) continue;
    out.push({
      id: `invoice:${c.id}`, kind: "invoice", title: "Ta facture {brand} n'apparaît pas", vars: { brand: c.brand },
      detail: "Dépose-la, ton agence la reçoit aussitôt.", detailVars: {}, due: null, days: null, bucket: 6, target: { tab: "gains", collabId: c.id },
    });
  }

  // ── Planning : aujourd'hui et demain d'abord, puis la semaine.
  for (const e of input.events) {
    const iso = eventISO({ ...e, who: null }, input.now);
    if (!iso) continue;
    const days = daysTo(iso);
    if (days < 0 || days > 7) continue;
    const time = e.time && e.time.trim() && e.time.trim() !== "—" ? e.time.trim() : "";
    out.push({
      // Sans titre : la clé « Rendez-vous » elle-même, pour qu'elle soit traduite.
      id: `event:${e.id}`, kind: "event", ...(e.title?.trim() ? { title: "{text}", vars: { text: e.title.trim() } } : { title: "Rendez-vous", vars: {} }),
      detail: time ? "Rendez-vous à {time}" : "Rendez-vous", detailVars: time ? { time } : {},
      due: iso, days, bucket: days <= 1 ? 1 : 4, target: { tab: "planning" },
    });
  }

  // ── Stats du mois.
  if (input.statsStale) {
    out.push({
      id: "stats", kind: "stats", title: "Envoyer tes stats du mois", vars: {},
      detail: "Ton agence s'en sert pour te proposer aux marques.", detailVars: {}, due: null, days: null, bucket: 5, target: { tab: "stats" },
    });
  }

  // ── Tâches ouvertes.
  for (const td of input.todos) {
    if (td.done || td.status === "Fait") continue;
    const due = toISODate(td.due) || null;
    const days = due ? daysTo(due) : null;
    const urgent = days != null && days <= 1;
    const bucket = urgent ? 1 : td.priority === "haute" ? 6 : 7;
    out.push({
      id: `todo:${td.id}`, kind: "todo", title: "{text}", vars: { text: shown(td.text) },
      detail: td.priority === "haute" ? "Tâche prioritaire" : "Tâche", detailVars: {},
      due, days, bucket, target: { tab: "todo", todoId: td.id },
    });
  }

  return out.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.days !== b.days) return a.days == null ? 1 : b.days == null ? -1 : a.days - b.days;
    return a.id.localeCompare(b.id);
  });
}

/** La prochaine étape (la plus urgente), ou null si tout est à jour. */
export function pickNextStep(input: NextStepInput): NextStep | null {
  return creatorSteps(input)[0] ?? null;
}

/** Libellé court du « quand » (clé française + variables), null au-delà d'une semaine. */
export function whenLabel(days: number | null): { key: string; vars?: Record<string, number> } | null {
  if (days == null) return null;
  if (days < -1) return { key: "Depuis {n} jours", vars: { n: -days } };
  if (days === -1) return { key: "Depuis hier" };
  if (days === 0) return { key: "Aujourd'hui" };
  if (days === 1) return { key: "Demain" };
  if (days < 7) return { key: "Dans {n} jours", vars: { n: days } };
  return null;
}

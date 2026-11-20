// ============================================================================
// _shared/tableauLundi.ts : le tableau de bord du lundi (stratégie du 20 nov. 2026).
// ----------------------------------------------------------------------------
// Deux parties, comme l'organisation Gianni / Marc :
//   Gianni : contacts touchés par canal (journal de contact des fiches, `contacts.touches`),
//            taux de réponse, contacts passés à Marc (tâches « Visio : … »), créatrices
//            approchées (Scouting, `creator_pool.last_contacted`).
//   Marc   : visios faites (planning : calls et réunions passés), devis envoyés (Facturation
//            → Devis), deals signés (étape « Signature » des collabs) et montant moyen.
// Puis le mois en cours face aux cibles : montant HT signé, deal moyen, part de Léna,
// créatrices qui signent, carnet traité, agences actives.
// Lu par la page Objectifs et par l'outil MCP `tableau_lundi` (Alfred). Règles PURES,
// testées par tableauLundi.test.ts. Ce qui n'est pas mesuré est dit, jamais estimé.
// ============================================================================

import { CIBLES_MENSUELLES, VOLUMES_SEMAINE } from "./strategie.ts";
import { amountOf } from "./reversements.ts";

export type Canal = "email" | "linkedin" | "instagram" | "whatsapp" | "tel" | "autre";
export const CANAUX: { key: Canal; label: string; cible: number | null }[] = [
  { key: "email", label: "Mails", cible: VOLUMES_SEMAINE.mailsOneToOne },
  { key: "linkedin", label: "LinkedIn", cible: VOLUMES_SEMAINE.invitationsLinkedIn },
  { key: "instagram", label: "Instagram", cible: VOLUMES_SEMAINE.dmInstagramMarques },
  { key: "whatsapp", label: "WhatsApp", cible: 15 },
  { key: "tel", label: "Téléphone", cible: null },
];

export type ContactIn = { tag?: unknown; touches?: unknown; last_contacted?: unknown };
export type SignatureIn = { reached_at?: unknown; cachet?: unknown; creator?: unknown; brand?: unknown };
export type TableauIn = {
  contacts: ContactIn[];
  creatorPool: { last_contacted?: unknown }[];
  todos: { text?: unknown; created_at?: unknown }[];
  events: { date?: unknown; type?: unknown; deleted?: unknown }[];
  /** null : devis illisibles (pas fondateur) → « non mesuré ». */
  quotes: { issueDate?: unknown; createdAt?: unknown; status?: unknown }[] | null;
  signatures: SignatureIn[];
};

export type Semaine = {
  du: string;
  au: string;
  gianni: {
    parCanal: Record<Canal, { envois: number; reponses: number }>;
    envois: number;
    reponses: number;
    /** Réponses ÷ envois, en %, null sans envoi. */
    tauxReponse: number | null;
    contactsTouches: number;
    passesAMarc: number;
    creatricesApprochees: number;
  };
  marc: { visios: number; devisEnvoyes: number | null; dealsSignes: number; dealsPayes: number; montantHT: number; montantMoyen: number | null };
};

export type Mois = {
  mois: string;
  montantHT: number;
  cible: number | null;
  deals: number;
  dealsPayes: number;
  montantMoyen: number | null;
  partLena: number | null;
  creatricesQuiSignent: number;
  carnetTraite: number;
  carnetTotal: number;
  agencesActives: number;
};

export type Tableau = { maintenant: Semaine; precedente: Semaine; mois: Mois };

const TZ = "Europe/Paris";

/** « AAAA-MM-JJ » à Paris. */
export function jourParis(d: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lundi de la semaine du jour donné. */
export function lundiDe(jour: string): string {
  const wd = new Date(jour + "T12:00:00Z").getUTCDay(); // 0 = dimanche
  return addDays(jour, -((wd + 6) % 7));
}

/** Jour (Paris) d'une date ISO ou « AAAA-MM-JJ » ; "" si illisible. */
function jourDe(v: unknown): string {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? jourParis(new Date(t)) : "";
}

const dans = (j: string, du: string, au: string) => !!j && j >= du && j <= au;

/**
 * Montant HT d'un cachet de collab (texte libre). 0 pour le gifting et l'affiliation seule ;
 * sinon le premier montant suivi d'une devise ou de « HT », ou un nombre seul.
 */
export function montantCachet(cachet: unknown): number {
  const t = String(cachet ?? "").trim();
  if (!t) return 0;
  if (/affiliation seule|gifting|sans r[ée]mun|pas de r[ée]mun|produits? offerts?|^produits?\b|^affiliation\b(?!.*\d\s*(€|eur))/i.test(t)) return 0;
  const m = /(\d[\d\s  .,]*)\s*(k\b)?\s*(€|eur\b|euros?\b|usd\b|\$|ht\b)/i.exec(t) ?? /[€$]\s*(\d[\d\s  .,]*)/.exec(t);
  if (m) {
    const brut = m[1].trim().replace(/[\s\u00a0\u202f]/g, "");
    // « 1.500 » : le point sépare les milliers.
    const n = amountOf(/^\d{1,3}(\.\d{3})+$/.test(brut) ? brut.replace(/\./g, "") : brut);
    return m[2] ? n * 1000 : n;
  }
  return /^\d[\d\s  .,]*$/.test(t) ? amountOf(t) : 0;
}

function touchesDe(c: ContactIn): { jour: string; canal: Canal; kind: string }[] {
  if (!Array.isArray(c.touches)) return [];
  return (c.touches as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const canal = String(x.canal ?? "");
      return { jour: jourDe(x.date), canal: (CANAUX.some((k) => k.key === canal) ? canal : "autre") as Canal, kind: String(x.kind ?? "") };
    })
    .filter((x) => x.jour);
}

const isLena = (s: unknown) => /^l[ée]na\b/i.test(String(s ?? "").trim());

function semaine(d: TableauIn, du: string, au: string, aujourdhui: string): Semaine {
  const parCanal = Object.fromEntries([...CANAUX.map((c) => c.key), "autre"].map((k) => [k, { envois: 0, reponses: 0 }])) as Semaine["gianni"]["parCanal"];
  let touches = 0;
  for (const c of d.contacts) {
    let vu = false;
    for (const t of touchesDe(c)) {
      if (!dans(t.jour, du, au)) continue;
      vu = true;
      if (t.kind === "reponse") parCanal[t.canal].reponses++;
      else parCanal[t.canal].envois++;
    }
    if (vu) touches++;
  }
  const envois = Object.values(parCanal).reduce((s, x) => s + x.envois, 0);
  const reponses = Object.values(parCanal).reduce((s, x) => s + x.reponses, 0);
  const signes = d.signatures.filter((s) => dans(jourDe(s.reached_at), du, au));
  const montants = signes.map((s) => montantCachet(s.cachet));
  const payes = montants.filter((m) => m > 0);
  const total = payes.reduce((a, b) => a + b, 0);
  const finVisios = au < aujourdhui ? au : aujourdhui;
  return {
    du,
    au,
    gianni: {
      parCanal,
      envois,
      reponses,
      tauxReponse: envois ? Math.round((reponses / envois) * 100) : null,
      contactsTouches: touches,
      passesAMarc: d.todos.filter((t) => /^\s*visio\b/i.test(String(t.text ?? "")) && dans(jourDe(t.created_at), du, au)).length,
      creatricesApprochees: d.creatorPool.filter((p) => dans(jourDe(p.last_contacted), du, au)).length,
    },
    marc: {
      visios: d.events.filter((e) => e.deleted !== true && /^(call|reunion)$/.test(String(e.type ?? "")) && dans(jourDe(e.date), du, finVisios)).length,
      devisEnvoyes: d.quotes == null ? null : d.quotes.filter((q) => /^(envoye|accepte|refuse)$/.test(String(q.status ?? "")) && dans(jourDe(q.issueDate ?? q.createdAt), du, au)).length,
      dealsSignes: signes.length,
      dealsPayes: payes.length,
      montantHT: Math.round(total),
      montantMoyen: payes.length ? Math.round(total / payes.length) : null,
    },
  };
}

/** Le tableau : semaine en cours (jusqu'à aujourd'hui), semaine précédente, mois en cours. */
export function tableauLundi(d: TableauIn, now: Date): Tableau {
  const auj = jourParis(now);
  const lundi = lundiDe(auj);
  const mois = auj.slice(0, 7);
  const debutMois = `${mois}-01`;
  const signes = d.signatures.filter((s) => dans(jourDe(s.reached_at), debutMois, auj));
  const lignes = signes.map((s) => ({ m: montantCachet(s.cachet), creator: s.creator }));
  const payes = lignes.filter((l) => l.m > 0);
  const total = payes.reduce((a, l) => a + l.m, 0);
  const lena = payes.filter((l) => isLena(l.creator)).reduce((a, l) => a + l.m, 0);
  const il30 = addDays(auj, -30);
  const agences = d.contacts.filter((c) => /agence|agency/i.test(String(c.tag ?? "")) && touchesDe(c).some((t) => t.kind === "reponse" && dans(t.jour, il30, auj)));
  return {
    maintenant: semaine(d, lundi, addDays(lundi, 6), auj),
    precedente: semaine(d, addDays(lundi, -7), addDays(lundi, -1), auj),
    mois: {
      mois,
      montantHT: Math.round(total),
      cible: CIBLES_MENSUELLES.find((c) => c.mois === mois)?.montantHT ?? null,
      deals: signes.length,
      dealsPayes: payes.length,
      montantMoyen: payes.length ? Math.round(total / payes.length) : null,
      partLena: total > 0 ? Math.round((lena / total) * 100) : null,
      creatricesQuiSignent: new Set(payes.map((l) => String(l.creator ?? "").trim().toLowerCase()).filter(Boolean)).size,
      carnetTraite: d.contacts.filter((c) => touchesDe(c).length > 0 || !!String(c.last_contacted ?? "").trim()).length,
      carnetTotal: d.contacts.length,
      agencesActives: agences.length,
    },
  };
}

const eur = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/ /g, " ")} €`;
const frJour = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });
const sur = (n: number | null, cible: number | null) => (n == null ? "non mesuré" : cible ? `${n} / ${cible}` : String(n));

function texteSemaine(s: Semaine, titre: string): string {
  const g = s.gianni, m = s.marc;
  return [
    `## ${titre} (du ${frJour(s.du)} au ${frJour(s.au)})`,
    `Gianni : ${CANAUX.map((c) => `${c.label} ${sur(g.parCanal[c.key].envois, c.cible)}`).join(" · ")} · contacts touchés ${g.contactsTouches} · réponses ${g.reponses}${g.tauxReponse != null ? ` (${g.tauxReponse} %)` : ""} · passés à Marc ${g.passesAMarc} · créatrices approchées ${sur(g.creatricesApprochees, VOLUMES_SEMAINE.approchesCreatrices)}`,
    `Marc : visios ${m.visios} · devis envoyés ${m.devisEnvoyes ?? "non mesuré"} · deals signés ${m.dealsSignes} (dont ${m.dealsPayes} payés) · ${eur(m.montantHT)} HT${m.montantMoyen != null ? ` · moyen ${eur(m.montantMoyen)}` : ""}`,
  ].join("\n");
}

/** Le tableau en texte (Alfred, point du lundi). */
export function tableauTexte(t: Tableau): string {
  const m = t.mois;
  return [
    "# Tableau de bord du lundi",
    "Envois et réponses : le journal de contact des fiches (mail, LinkedIn, Instagram, WhatsApp, téléphone). Un envoi non noté dans la fiche n'est pas compté.",
    texteSemaine(t.precedente, "Semaine dernière"),
    texteSemaine(t.maintenant, "Cette semaine, à ce jour"),
    `## Mois ${m.mois}`,
    `Montant HT signé ${eur(m.montantHT)}${m.cible ? ` sur ${eur(m.cible)} (${Math.round((m.montantHT / m.cible) * 100)} %)` : ""} · ${m.deals} deals (${m.dealsPayes} payés) · deal moyen ${m.montantMoyen != null ? eur(m.montantMoyen) : "—"} · part de Léna ${m.partLena != null ? `${m.partLena} %` : "—"} · créatrices qui signent ${m.creatricesQuiSignent} · carnet traité ${m.carnetTraite} / ${m.carnetTotal} · agences actives (réponse sur 30 jours) ${m.agencesActives}`,
    "Non mesurés ici : contrats mensuels actifs, relations proches suivies sur WhatsApp, recrues signées, incidents de conformité.",
    "Règle : un indicateur en retard deux lundis de suite → changer de méthode, pas seulement de volume.",
  ].join("\n");
}

// deno-lint-ignore no-explicit-any
type Sb = { from: (table: string) => any };

/**
 * Lit tout ce qu'il faut (mêmes requêtes dans l'app et le connecteur). `quotes` : la liste
 * des devis du blob finance, ou null si l'appelant ne la voit pas.
 */
export async function chargerTableau(sb: Sb, now: Date, quotes: TableauIn["quotes"]): Promise<TableauIn> {
  const auj = jourParis(now);
  const depuis = [addDays(lundiDe(auj), -7), `${auj.slice(0, 7)}-01`].sort()[0];
  const depuisIso = new Date(depuis + "T00:00:00Z").toISOString();
  const [contacts, pool, todos, events, steps] = await Promise.all([
    sb.from("contacts").select("*").limit(3000),
    sb.from("creator_pool").select("last_contacted").gte("last_contacted", depuis).limit(2000),
    sb.from("todos").select("text, created_at").gte("created_at", depuisIso).limit(1000),
    sb.from("events").select("date, type, deleted").gte("date", depuis).lte("date", auj).limit(1000),
    sb.from("collab_steps").select("collab_id, reached_at").eq("step", 1).gte("reached_at", depuisIso).limit(1000),
  ]);
  for (const r of [contacts, pool, todos, events, steps]) if (r.error) throw new Error(r.error.message);
  const ids = [...new Set(((steps.data ?? []) as { collab_id: string }[]).map((s) => s.collab_id))];
  const collabs = ids.length ? await sb.from("collabs").select("id, cachet, creator, brand").in("id", ids) : { data: [], error: null };
  if (collabs.error) throw new Error(collabs.error.message);
  const byId = new Map(((collabs.data ?? []) as Record<string, unknown>[]).map((c) => [String(c.id), c]));
  return {
    contacts: (contacts.data ?? []).map((c: Record<string, unknown>) => ({ tag: c.tag, touches: c.touches, last_contacted: c.last_contacted })),
    creatorPool: pool.data ?? [],
    todos: todos.data ?? [],
    events: events.data ?? [],
    quotes,
    signatures: ((steps.data ?? []) as { collab_id: string; reached_at: string }[]).map((s) => {
      const c = byId.get(String(s.collab_id)) ?? {};
      return { reached_at: s.reached_at, cachet: c.cachet, creator: c.creator, brand: c.brand };
    }),
  };
}

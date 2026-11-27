// ============================================================================
// _shared/igHistorique.ts : import de TOUT l'historique des DM Instagram de TTP.
// ----------------------------------------------------------------------------
// Logique PURE (sans réseau), testée par igHistorique.test.ts. La lecture chez Meta et
// l'écriture en base sont dans igHistoriqueDb.ts (action « backfill » de ig-inbox, outil
// `importer_historique_instagram` du connecteur Claude).
// Une conversation → une ligne ig_threads, mêmes colonnes et même logique que ig-inbox,
// plus first_at (date du premier message, SQL 2026-11-24-dm-historique.sql).
// ============================================================================

import { NO_TEXT, type DmMsg } from "./inbox.ts";
import { emailsIn } from "./signals.ts";

export type Personne = { id?: string; username?: string; name?: string };
export type MessageMeta = { id?: string; created_time?: string; message?: string; from?: Personne };
export type ConvMeta = { id: string; updated_time?: string; participants?: { data?: Personne[] } };

/** État de l'import, gardé dans ig_sync_state (clé « inbox_historique »). Le curseur est
 *  celui de Meta (« after ») : jamais l'adresse complète, qui contient le jeton. */
export type EtatHistorique = {
  after: string | null;
  termine: boolean;
  pages: number;
  vues: number;
  importees: number;
  maj: number;
  anciennes: number;
  erreurs: number;
  debut: string;
  dernier: string | null;
  fin: string | null;
  arret: string | null;
  arretDetail: string | null;
  enCours: string | null;
};

export const ETAT_VIDE = (now: string): EtatHistorique => ({
  after: null, termine: false, pages: 0, vues: 0, importees: 0, maj: 0, anciennes: 0, erreurs: 0,
  debut: now, dernier: null, fin: null, arret: null, arretDetail: null, enCours: null,
});

/** État relu (forme ancienne ou abîmée → valeurs par défaut, jamais d'erreur). */
export function lireEtat(raw: unknown, now: string): EtatHistorique {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = ETAT_VIDE(typeof o.debut === "string" ? o.debut : now);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    ...base, after: s(o.after), termine: o.termine === true, pages: n(o.pages), vues: n(o.vues), importees: n(o.importees), maj: n(o.maj),
    anciennes: n(o.anciennes), erreurs: n(o.erreurs), dernier: s(o.dernier), fin: s(o.fin), arret: s(o.arret), arretDetail: s(o.arretDetail), enCours: s(o.enCours),
  };
}

/** Une tranche déjà en cours (lancée il y a moins de 3 minutes) : on n'en lance pas une seconde. */
export const trancheEnCours = (e: EtatHistorique, now = Date.now()) => !!e.enCours && now - Date.parse(e.enCours) < 3 * 60_000;

export const TROIS_ANS_MS = 3 * 365 * 86400000;
/** Au-delà de 3 ans après le dernier échange, ig-inbox efface la conversation (politique de confidentialité). */
export const tropAncienne = (updated: string | undefined, now = Date.now()) => !!updated && now - Date.parse(updated) > TROIS_ANS_MS;

/** Curseur de la page suivante : seulement s'il y a vraiment une suite. */
export function curseurSuivant(paging: unknown): string | null {
  const p = paging && typeof paging === "object" ? (paging as { next?: string; cursors?: { after?: string } }) : {};
  return p.next && p.cursors?.after ? p.cursors.after : null;
}

/** Messages Meta → messages de l'app (même forme que ig-inbox). */
export function messagesDe(raw: MessageMeta[], estMoi: (p?: Personne) => boolean): DmMsg[] {
  return raw
    .filter((m) => m.id && m.created_time && !Number.isNaN(Date.parse(m.created_time)))
    .map((m) => ({ id: String(m.id), at: new Date(String(m.created_time)).toISOString(), me: estMoi(m.from), text: String(m.message ?? "").trim() || NO_TEXT }));
}

export type AncienneLigne = { username: string | null; emails: string[] | null; hidden?: boolean | null };

/**
 * Ligne ig_threads d'une conversation : le @ et l'id Instagram de la personne, la date du
 * dernier message, qui a parlé en dernier, le dernier texte, les emails qu'elle a donnés
 * (ajoutés à ceux déjà notés), et la date du premier message (`premier`, la plus ancienne vue).
 */
export function ligneConversation(conv: ConvMeta, autre: Personne, msgs: DmMsg[], prev: AncienneLigne | undefined, premier: string | null, now: string) {
  const tri = [...msgs].sort((a, b) => b.at.localeCompare(a.at));
  const last = tri[0];
  const username = (autre.username ?? "").trim().replace(/^@/, "").toLowerCase() || prev?.username || null;
  const emails = [...new Set([...(prev?.emails ?? []), ...msgs.filter((m) => !m.me).flatMap((m) => emailsIn(m.text))])].slice(0, 10);
  const datesConnues = [premier, tri.length ? tri[tri.length - 1].at : null].filter((d): d is string => !!d).sort();
  return {
    id: conv.id,
    username,
    igsid: autre.id ?? null,
    updated_at: conv.updated_time ? new Date(conv.updated_time).toISOString() : last?.at ?? now,
    last_text: last ? last.text.slice(0, 300) : null,
    last_from_me: last ? last.me : null,
    emails,
    synced_at: now,
    first_at: datesConnues[0] ?? null,
  };
}

const fr = (n: number) => n.toLocaleString("fr-FR");
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais");

export type Tranche = { pages: number; vues: number; importees: number; maj: number; dejaFaites: number; anciennes: number; erreurs: number; coupee: boolean };

/** Compte rendu d'une tranche, pour Claude. `total` = nombre annoncé par l'app Instagram (estimation). */
export function texteTranche(e: EtatHistorique, t: Tranche | null, enBase: number | null, total: number, extra: string[] = []): string {
  const reste = e.termine ? 0 : Math.max(0, total - e.vues);
  const lignes = [
    e.termine ? "# Historique Instagram : import terminé" : "# Historique Instagram : import en cours",
    t ? `Cette tranche : ${t.pages} page(s) de 25 conversations, ${fr(t.vues)} conversation(s) vues, ${fr(t.importees)} nouvelle(s), ${fr(t.maj)} mise(s) à jour, ${fr(t.dejaFaites)} déjà faite(s), ${fr(t.anciennes)} de plus de 3 ans laissée(s) de côté, ${fr(t.erreurs)} illisible(s).${t.coupee ? " Page coupée faute de temps : reprise au même endroit." : ""}` : "",
    `Depuis le début (${jour(e.debut)}) : ${fr(e.vues)} conversation(s) parcourues, ${fr(e.importees)} nouvelle(s), ${fr(e.maj)} mise(s) à jour, ${fr(e.anciennes)} trop ancienne(s), ${fr(e.erreurs)} illisible(s), ${fr(e.pages)} page(s).`,
    enBase != null ? `Conversations dans TTP Suite : ${fr(enBase)}.` : "",
    e.termine ? `Fin : ${jour(e.fin)}. L'historique est complet : recommencer (tout relire, des heures d'appels Meta) seulement sur demande explicite de Marc ou de Gianni.` : `Il en reste environ ${fr(reste)} (sur ~${fr(total)} annoncées par Instagram, Meta ne donne pas le total exact). Relancer l'outil pour la tranche suivante.`,
    e.arret ? `Arrêt : ${e.arretDetail ?? e.arret}` : "",
    ...extra,
  ];
  return lignes.filter(Boolean).join("\n");
}

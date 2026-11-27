// ============================================================================
// _shared/igHistoriqueDb.ts : importe TOUT l'historique des DM Instagram de TTP, par
// tranches reprenables. Utilisé par ig-inbox ({ action: "backfill", pages?, recommencer? })
// et par l'outil `importer_historique_instagram` du connecteur Claude.
// ----------------------------------------------------------------------------
// Une tranche = quelques pages de 25 conversations (liste Meta, des plus récentes aux plus
// anciennes). Pour chaque conversation : ses 20 derniers messages (limite Meta), la date
// du premier message (pages d'identifiants suivantes, 3 au plus), la fiche de la personne
// (nom, photo, abonnés) si elle manque. Écrit ig_threads + ig_messages comme ig-inbox
// (upsert : jamais de doublon, rien ne casse si on relance). Le prochain passage de
// ig-inbox relie ensuite les conversations aux fiches contact (même @).
// Pas de notification push (ce sont d'anciens messages).
// Reprise : curseur Meta (« after », jamais l'adresse qui contient le jeton) dans
// ig_sync_state.inbox_historique, avancé seulement quand une page est entièrement écrite.
// Limites Meta : une demande à la fois, 0,4 s d'écart au moins ; pause à 80 % du quota
// (même règle que les scans) ; arrêt propre sur une erreur de limite, avec l'heure de reprise.
// Conversations de plus de 3 ans : laissées de côté (ig-inbox les efface, politique de
// confidentialité) ; Meta les donne en dernier, donc l'import s'arrête là.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { GRAPH, META_IG_ID, getJson, graphWhy, igUser, metaReady, ownAccount, pageAccess, quotaAuDepart, quotaPct, saveState, saveUsage, storePicture } from "./instagram.ts";
import { PLAFONDS } from "./quotaMeta.ts";
import { ETAT_VIDE, curseurSuivant, ligneConversation, lireEtat, messagesDe, texteTranche, trancheEnCours, tropAncienne, type ConvMeta, type EtatHistorique, type MessageMeta, type Personne, type Tranche } from "./igHistorique.ts";
import { couper, texteSur } from "./texteSur.ts";
import { ecrireParLots } from "./ecritureLot.ts";

export const ETAT_HISTORIQUE = "inbox_historique";
/** Conversations annoncées par l'app Instagram de TTP (novembre 2026) : sert seulement à estimer le reste. */
export const TOTAL_ANNONCE = 3045;
const PAGE = 25;
const ECART_MS = 400;
// L'import passe après la lecture des profils, avant le radar (_shared/quotaMeta.ts).
const QUOTA_MAX = PLAFONDS.import;
const PAGES_IDS_MAX = 3; // pages d'identifiants lues pour trouver le premier message d'une longue conversation
const enc = encodeURIComponent;

type GraphError = { code?: number; error_subcode?: number; message?: string };
type Prev = { id: string; username: string | null; name: string | null; emails: string[] | null; picture: string | null; updated_at: string | null; synced_at: string | null; hidden: boolean | null };

class Arret extends Error {
  constructor(public why: string, public detail: string) {
    super(why);
  }
}

/** Raison lisible d'une erreur Meta pendant l'import. */
function arretMeta(e: GraphError, ou: string): Arret {
  if (e.message === "reseau") return new Arret("reseau", `Meta n'a pas répondu (${ou}). Relancer plus tard : l'import reprend au même endroit.`);
  if (e.code === -2 || e.error_subcode === 2534084) return new Arret("meta_validation", `Meta refuse de lister les conversations (${ou}, code ${e.code}/${e.error_subcode ?? "?"}) : il faut l'accès avancé à instagram_manage_messages (App Review). Message de Meta : ${e.message ?? "?"}`);
  const w = graphWhy(e).why;
  const msg = `${e.message ?? "?"} (code ${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""})`;
  if (w === "meta_limite") return new Arret(w, `Limite de demandes Meta atteinte (${ou}) : ${msg}. Relancer après l'heure de reprise.`);
  if (w === "meta_jeton") return new Arret(w, `Jeton Meta refusé (${ou}) : ${msg}. Marc doit régénérer META_TOKEN.`);
  if (w === "meta_autorisation") return new Arret(w, `Permission Meta manquante (${ou}) : ${msg}. Il faut instagram_manage_messages et pages_read_engagement sur le jeton de l'utilisateur système.`);
  if (w === "meta_validation") return new Arret(w, `Fonction non validée par Meta (${ou}) : ${msg}.`);
  return new Arret(w, `Erreur Meta (${ou}) : ${msg}.`);
}

export type HistoriqueResultat = { ok: boolean; texte: string; etat: EtatHistorique; tranche: Tranche | null; quota: Record<string, unknown> | null; why?: string };

async function lireEtatBase(sb: SupabaseClient): Promise<{ etat: unknown } | { error: string }> {
  const { data, error } = await sb.from("ig_sync_state").select("data").eq("key", ETAT_HISTORIQUE).maybeSingle<{ data: unknown }>();
  return error ? { error: error.message } : { etat: data?.data ?? null };
}

async function compterConversations(sb: SupabaseClient): Promise<number | null> {
  const { count, error } = await sb.from("ig_threads").select("id", { count: "exact", head: true });
  return error ? null : count ?? null;
}

/** Où en est l'import, sans rien demander à Meta. */
export async function etatHistorique(sb: SupabaseClient): Promise<HistoriqueResultat> {
  const now = new Date().toISOString();
  const r = await lireEtatBase(sb);
  if ("error" in r) return { ok: false, texte: `État de l'import illisible : ${r.error}`, etat: ETAT_VIDE(now), tranche: null, quota: null, why: "lecture" };
  if (!r.etat) return { ok: true, texte: "Import de l'historique jamais lancé. Lancer une première tranche (sans etat_seulement).", etat: ETAT_VIDE(now), tranche: null, quota: null };
  const etat = lireEtat(r.etat, now);
  return { ok: true, texte: texteTranche(etat, null, await compterConversations(sb), TOTAL_ANNONCE), etat, tranche: null, quota: null };
}

/** Une tranche d'import. pages : 1 à 6 (défaut 2) ; budgetMs : temps max (défaut 100 s). */
export async function trancheHistorique(sb: SupabaseClient, o: { pages?: number; recommencer?: boolean; budgetMs?: number } = {}): Promise<HistoriqueResultat> {
  const t0 = Date.now();
  const nowIso = () => new Date().toISOString();
  const pagesMax = Math.max(1, Math.min(6, Math.round(Number(o.pages) || 2)));
  const budget = Math.max(20_000, Math.min(120_000, o.budgetMs ?? 100_000));
  const vide = ETAT_VIDE(nowIso());
  if (!metaReady()) return { ok: false, texte: "Meta n'est pas configuré (secrets META_TOKEN et META_IG_ID).", etat: vide, tranche: null, quota: null, why: "meta_non_configure" };

  const lu = await lireEtatBase(sb);
  // Lecture ratée : on ne repart surtout pas de zéro (le curseur serait perdu).
  if ("error" in lu) return { ok: false, texte: `État de l'import illisible, rien lancé : ${lu.error}`, etat: vide, tranche: null, quota: null, why: "lecture" };
  let etat = o.recommencer || !lu.etat ? ETAT_VIDE(nowIso()) : lireEtat(lu.etat, nowIso());
  if (!o.recommencer && trancheEnCours(etat)) return { ok: false, texte: `Une tranche tourne déjà (lancée le ${new Date(etat.enCours as string).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}). Attendre 3 minutes avant de relancer.`, etat, tranche: null, quota: null, why: "en_cours" };
  if (etat.termine && !o.recommencer) return { ok: true, texte: texteTranche(etat, null, await compterConversations(sb), TOTAL_ANNONCE), etat, tranche: null, quota: null };

  etat = { ...etat, enCours: nowIso(), arret: null, arretDetail: null };
  await saveState(sb, ETAT_HISTORIQUE, etat);
  const tranche: Tranche = { pages: 0, vues: 0, importees: 0, maj: 0, dejaFaites: 0, anciennes: 0, erreurs: 0, coupee: false };
  const extra: string[] = [];
  let premierApproche = false;
  let sansColonne = false;
  let messagesRefuses = 0; // messages refusés par la base (texte illisible…), dits dans le compte rendu

  // Une demande à la fois, avec un écart minimum ; pause avant le plafond de l'import.
  // Avant la première : le dernier relevé (ig_quota) dit si Meta bloque ou si le quota est déjà haut.
  const auDepart = await quotaAuDepart(sb, QUOTA_MAX);
  let dernierAppel = 0;
  const appel = async (url: string, ou: string, ms = 25_000): Promise<Record<string, unknown>> => {
    if (dernierAppel === 0 && auDepart) throw new Arret(auDepart, auDepart === "meta_limite" ? "Meta limite encore l'app : l'import reprendra au même endroit à la prochaine tranche." : `Pause : le quota Meta de l'heure est déjà au-dessus de ${QUOTA_MAX} %. L'import reprend au même endroit à la prochaine tranche.`);
    // Relevé pris pendant CETTE tranche seulement (une fonction restée chaude garde l'ancien).
    const q = dernierAppel > 0 ? quotaPct() : null;
    if (q != null && q >= QUOTA_MAX) throw new Arret("quota_proche", `Pause : quota Meta à ${Math.round(q)} %. Relancer dans une heure, l'import reprend au même endroit.`);
    const attente = dernierAppel + ECART_MS - Date.now();
    if (attente > 0) await new Promise((r) => setTimeout(r, attente));
    dernierAppel = Date.now();
    const body = await getJson(url, ms);
    if (body.error) {
      const e = body.error as GraphError;
      const w = e.message === "reseau" ? "reseau" : graphWhy(e).why;
      if (["meta_limite", "meta_jeton", "meta_autorisation", "meta_validation"].includes(w) || e.code === -2) throw arretMeta(e, ou);
    }
    return body;
  };

  try {
    const page = await pageAccess();
    if (!page.ok) throw new Arret(page.why, `Accès à la Page Facebook de TTP impossible : ${page.why}${page.detail ? ` (${page.detail})` : ""}.`);
    const me = await ownAccount(page.token);
    const meUser = me?.username ?? "";
    const estMoi = (p?: Personne) => !!p && (p.id === META_IG_ID || (!!meUser && (p.username ?? "").toLowerCase() === meUser));

    for (let n = 0; n < pagesMax && !etat.termine; n++) {
      if (Date.now() - t0 > budget - 15_000) break;
      const liste = await appel(
        `${GRAPH}/${page.pageId}/conversations?platform=instagram&limit=${PAGE}&fields=${enc("id,updated_time,participants")}${etat.after ? `&after=${enc(etat.after)}` : ""}&access_token=${enc(page.token)}`,
        "liste des conversations", 30_000,
      );
      if (liste.error) throw arretMeta(liste.error as GraphError, "liste des conversations");
      const convs = (liste.data as ConvMeta[] | undefined) ?? [];
      const suivant = curseurSuivant(liste.paging);

      const { data: prevRaw, error: prevErr } = convs.length
        ? await sb.from("ig_threads").select("id, username, name, emails, picture, updated_at, synced_at, hidden").in("id", convs.map((c) => c.id))
        : { data: [], error: null };
      // Lecture ratée : on s'arrête (sinon les emails déjà notés seraient remplacés).
      if (prevErr) throw new Arret("lecture", `Conversations déjà connues illisibles : ${prevErr.message}`);
      const prev = new Map(((prevRaw as Prev[] | null) ?? []).map((p) => [p.id, p]));

      let toutLu = true;
      let pageAncienne = false;
      for (const conv of convs) {
        if (Date.now() - t0 > budget - 8_000) {
          toutLu = false;
          tranche.coupee = true;
          break;
        }
        tranche.vues++;
        if (tropAncienne(conv.updated_time)) {
          tranche.anciennes++;
          pageAncienne = true;
          continue;
        }
        const p = prev.get(conv.id);
        // Déjà importée pendant cet import (tranche coupée puis reprise) et rien de neuf depuis.
        if (p?.synced_at && p.synced_at >= etat.debut && p.updated_at && conv.updated_time && Date.parse(p.updated_at) >= Date.parse(conv.updated_time)) {
          tranche.dejaFaites++;
          continue;
        }

        // 20 derniers messages (limite Meta), et s'il y en a d'autres, la date du premier.
        const lus = await appel(`${GRAPH}/${conv.id}?fields=${enc("messages.limit(20){id,created_time,from,message}")}&access_token=${enc(page.token)}`, "messages");
        if (lus.error) {
          tranche.erreurs++;
          continue;
        }
        const bloc = (lus.messages as { data?: MessageMeta[]; paging?: unknown } | undefined) ?? {};
        let raw = bloc.data ?? [];
        // Si Meta ne détaille pas les messages, on les lit un par un (comme ig-inbox).
        if (raw.length && raw.every((m) => m.message === undefined && !m.from)) {
          const full: MessageMeta[] = [];
          for (const m of raw.slice(0, 20)) {
            const one = await appel(`${GRAPH}/${m.id}?fields=id,created_time,from,to,message&access_token=${enc(page.token)}`, "message");
            if (!one.error) full.push(one as MessageMeta);
          }
          raw = full;
        }
        const msgs = messagesDe(raw, estMoi);
        let premier: string | null = null;
        let apres = curseurSuivant(bloc.paging);
        for (let k = 0; apres && k < PAGES_IDS_MAX; k++) {
          const ids = await appel(`${GRAPH}/${conv.id}/messages?fields=created_time&limit=100&after=${enc(apres)}&access_token=${enc(page.token)}`, "dates des messages");
          if (ids.error) break;
          for (const m of (ids.data as MessageMeta[] | undefined) ?? []) if (m.created_time && (!premier || m.created_time < premier)) premier = new Date(m.created_time).toISOString();
          apres = curseurSuivant(ids.paging);
        }
        if (apres) premierApproche = true; // très longue conversation : date du premier message approchée

        const autre = (conv.participants?.data ?? []).find((x) => !estMoi(x)) ?? {};
        const now = nowIso();
        const row: Record<string, unknown> = ligneConversation(conv, autre, msgs, p ? { username: p.username, emails: p.emails, hidden: p.hidden } : undefined, premier, now);

        // Fiche de la personne (nom affiché, photo, abonnés) si on ne l'a pas encore.
        if (autre.id && !p?.name) {
          const f = await appel(`${GRAPH}/${autre.id}?fields=name,username,profile_pic,follower_count&access_token=${enc(page.token)}`, "fiche de la personne");
          if (!f.error) {
            const user = igUser(String(f.username ?? "")).toLowerCase();
            if (user) row.username = user;
            if (f.name) row.name = texteSur(String(f.name));
            if (typeof f.follower_count === "number") row.followers = f.follower_count;
            if (!p?.picture && f.profile_pic && (user || row.username)) {
              const pic = await storePicture(sb, String(user || row.username), String(f.profile_pic));
              if (pic.url) row.picture = pic.url;
            }
          }
        }

        let { error } = await sb.from("ig_threads").upsert(row);
        // Avant le SQL 2026-11-24-dm-historique.sql : pas de colonne first_at, on écrit sans.
        if (error && (error.code === "42703" || error.code === "PGRST204" || /first_at/.test(error.message ?? ""))) {
          sansColonne = true;
          delete row.first_at;
          ({ error } = await sb.from("ig_threads").upsert(row));
        }
        if (error) {
          tranche.erreurs++;
          // La vraie raison, pour Claude (chaque message d'erreur n'est dit qu'une fois).
          extra.push(`Conversation refusée par la base : ${couper(error.message ?? "erreur", 200)}.`);
          continue;
        }
        if (msgs.length) {
          // Les 20 messages en une requête ; refusée, elle est refaite message par message (_shared/ecritureLot.ts).
          const lignes = msgs.map((m) => ({ id: m.id, thread_id: conv.id, at: m.at, me: m.me, text: couper(m.text, 4000) }));
          const r = await ecrireParLots(lignes, lignes.length, (lot) => sb.from("ig_messages").upsert(lot));
          if (r.refusees.length) {
            messagesRefuses += r.refusees.length;
            extra.push(`Messages refusés par la base : ${couper(r.erreur ?? "erreur", 200)}.`);
          }
        }
        if (p) tranche.maj++;
        else tranche.importees++;
      }

      if (!toutLu) break; // page reprise au même endroit à la tranche suivante
      tranche.pages++;
      etat = {
        ...etat,
        after: suivant, pages: etat.pages + 1, vues: etat.vues + convs.length, dernier: nowIso(),
        termine: !suivant || pageAncienne, fin: !suivant || pageAncienne ? nowIso() : null,
      };
      // Sauvegarde après chaque page (compteurs de la tranche compris) : une coupure ne perd rien.
      await saveState(sb, ETAT_HISTORIQUE, { ...etat, importees: etat.importees + tranche.importees, maj: etat.maj + tranche.maj, anciennes: etat.anciennes + tranche.anciennes, erreurs: etat.erreurs + tranche.erreurs });
    }
  } catch (e) {
    const a = e instanceof Arret ? e : new Arret("erreur", (e as Error).message);
    etat = { ...etat, arret: a.why, arretDetail: a.detail };
  }

  // Les compteurs cumulés ne prennent que ce qui est écrit (les pages coupées comptent aussi :
  // leurs conversations sont en base, la reprise les reconnaît comme « déjà faites »).
  etat = {
    ...etat, enCours: null, dernier: nowIso(),
    importees: etat.importees + tranche.importees, maj: etat.maj + tranche.maj, anciennes: etat.anciennes + tranche.anciennes, erreurs: etat.erreurs + tranche.erreurs,
  };
  await saveState(sb, ETAT_HISTORIQUE, etat);
  const quota = await saveUsage(sb);
  if (etat.arret === "meta_limite" && quota?.blockedUntil) extra.push(`Reprise possible vers ${new Date(String(quota.blockedUntil)).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}.`);
  if (sansColonne) extra.push("⚠ Date du premier message pas enregistrée : le SQL 2026-11-24-dm-historique.sql (colonne ig_threads.first_at) n'est pas encore lancé. En attendant, le plus ancien des 20 derniers messages est dans ig_messages.");
  if (premierApproche) extra.push("Très longues conversations (plus de 320 messages) : la date du premier message est la plus ancienne trouvée, pas forcément la vraie.");
  if (messagesRefuses) extra.push(`${messagesRefuses} message(s) pas enregistré(s) (refusés par la base), les autres messages de leurs conversations le sont.`);
  const texte = texteTranche(etat, tranche, await compterConversations(sb), TOTAL_ANNONCE, [...new Set(extra.filter(Boolean))]);
  console.log("ig-historique", JSON.stringify({ tranche, messagesRefuses, arret: etat.arret, ms: Date.now() - t0 }));
  return { ok: !etat.arret || etat.arret === "quota_proche", texte, etat, tranche, quota, why: etat.arret ?? undefined };
}

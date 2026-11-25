// ============================================================================
// _shared/profilInstagramDb.ts : lit des profils Instagram (Business Discovery de Meta)
// et met à jour la Base créateurs (ig_profiles). Outils lire_profil_instagram,
// lire_profils_instagram et scanner_base_createurs du connecteur Claude.
// ----------------------------------------------------------------------------
// Pour chaque @ lu : abonnés, bio, email, site, engagement, dernier post dans
// ig_profiles.data (ce que seul le Sourcing calcule est gardé), et l'agence détectée.
// Colonnes agence / agence_nom / profil_lu_at : SQL 2026-11-24-base-createurs-profils.sql.
// Avant ce SQL, tout va dans data (agence, agence_nom, profilLu) et le résultat le dit.
// Un créateur retiré de la Base à sa demande (creator_base_meta.excluded) n'est jamais
// enregistré. Pause à 80 % du quota Meta (même règle que les scans), 3 lectures à la fois.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { discover, engagementRate, metaReady, postsPerWeek, quotaAuDepart, quotaPct, saveState, saveUsage } from "./instagram.ts";
import { PLAFONDS } from "./quotaMeta.ts";
import { AGENCES_CONNUES, agencesAvecSuivies, type AgenceConnue } from "./agenceDetection.ts";
import { donneesBase, resumerProfil, type ProfilResume } from "./profilInstagram.ts";

type Json = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;
type Ligne = { username: string; data: Json | null; why: string | null; at: string | null };

// La lecture des profils pour la prospection passe avant l'import et le radar (_shared/quotaMeta.ts).
const QUOTA_MAX = PLAFONDS.profils;
const JOUR = 86_400_000;
export const RELIRE_APRES_JOURS = 30;
export const ETAT_SCAN = "base_scan";
const COLONNES = ["agence", "agence_nom", "profil_lu_at"];
export const colonnesAbsentes = (e: DbError) => !!e && (e.code === "42703" || e.code === "PGRST204" || /agence|profil_lu_at/.test(e.message ?? ""));

export type ProfilLu = { username: string; ok: true; resume: ProfilResume; enregistre: boolean } | { username: string; ok: false; why: string };
export type Lecture = { profils: ProfilLu[]; restants: string[]; arret: string | null; sansColonnes: boolean; erreursEcriture: string[]; quota: Json | null };

/** Agences connues + agences concurrentes suivies dans l'app (ig_rivals). */
async function agencesConnues(sb: SupabaseClient): Promise<AgenceConnue[]> {
  const { data } = await sb.from("ig_rivals").select("username, self, data");
  const rows = ((data as Json[] | null) ?? []).map((r) => ({ username: String(r.username ?? ""), self: r.self === true, name: String((r.data as Json | null)?.name ?? "") }));
  return agencesAvecSuivies(AGENCES_CONNUES, rows);
}

/** Écrit une ligne ig_profiles ; avant le SQL, sans les colonnes nouvelles (tout est aussi dans data). */
async function ecrire(sb: SupabaseClient, row: Json, etat: { sansColonnes: boolean }): Promise<DbError> {
  const sans = () => Object.fromEntries(Object.entries(row).filter(([k]) => !COLONNES.includes(k)));
  if (etat.sansColonnes) return (await sb.from("ig_profiles").upsert(sans())).error;
  const { error } = await sb.from("ig_profiles").upsert(row);
  if (!colonnesAbsentes(error)) return error;
  etat.sansColonnes = true;
  return (await sb.from("ig_profiles").upsert(sans())).error;
}

/**
 * Lit les @ donnés (déjà nettoyés) chez Meta, 3 à la fois, tant qu'il reste du temps et du
 * quota, et met à jour la Base si `enregistrer`. Ceux qui n'ont pas pu être lus sont dans `restants`.
 */
export async function lireProfils(sb: SupabaseClient, comptes: string[], o: { enregistrer?: boolean; budgetMs?: number } = {}): Promise<Lecture> {
  const t0 = Date.now();
  const budget = o.budgetMs ?? 100_000;
  const out: Lecture = { profils: [], restants: [], arret: null, sansColonnes: false, erreursEcriture: [], quota: null };
  if (!metaReady()) return { ...out, restants: comptes, arret: "meta_non_configure" };
  const attendre = await quotaAuDepart(sb, QUOTA_MAX);
  if (attendre) return { ...out, restants: comptes, arret: attendre };
  const enregistrer = o.enregistrer !== false;
  const [agences, prevRes, exclRes] = await Promise.all([
    agencesConnues(sb),
    sb.from("ig_profiles").select("username, data, why, at").in("username", comptes),
    sb.from("creator_base_meta").select("username").eq("excluded", true).in("username", comptes),
  ]);
  // Lecture de la Base ratée : on lit quand même chez Meta, mais on n'écrit rien (on écraserait sans fusionner).
  const ecritureSure = enregistrer && !prevRes.error;
  if (enregistrer && prevRes.error) out.erreursEcriture.push(`Base illisible (${prevRes.error.message}) : profils lus mais pas enregistrés.`);
  const prev = new Map(((prevRes.data as Ligne[] | null) ?? []).map((r) => [r.username, r]));
  const retires = new Set(((exclRes.data as { username: string }[] | null) ?? []).map((r) => r.username));
  const etatCol = { sansColonnes: false };

  let i = 0;
  let appels = 0;
  const worker = async () => {
    while (i < comptes.length) {
      if (out.arret || Date.now() - t0 > budget) return;
      // Relevé pris pendant CET appel seulement (une fonction restée chaude garde l'ancien).
      const q = appels > 0 ? quotaPct() : null;
      if (q != null && q >= QUOTA_MAX) {
        out.arret = "quota_proche";
        return;
      }
      const u = comptes[i++];
      const r = await discover(u, 12);
      appels++;
      const now = new Date().toISOString();
      const p = prev.get(u);
      if (!r.ok) {
        if (r.stop) {
          out.arret = r.why;
          out.restants.push(u);
          continue;
        }
        if (r.why === "reseau") {
          out.restants.push(u);
          continue;
        }
        out.profils.push({ username: u, ok: false, why: r.why });
        // Comme le Sourcing : on note l'échec (les données déjà connues restent), pour ne pas
        // redemander ce compte avant 30 jours.
        if (ecritureSure && !retires.has(u) && r.why === "compte_perso") {
          const data = p?.data ? { ...p.data, profilLu: now } : null;
          const e = await ecrire(sb, { username: u, data, why: r.why, at: now, profil_lu_at: now }, etatCol);
          if (e) out.erreursEcriture.push(`@${u} : ${e.message}`);
        }
        continue;
      }
      const media = r.profile.media;
      const last12 = media.slice(0, 12);
      const resume = resumerProfil(r.profile, { engagement: engagementRate(media, r.profile.followers), parSemaine: last12.length ? postsPerWeek(last12) : null }, agences, typeof p?.data?.agency === "string" ? p.data.agency : null);
      let enregistre = false;
      if (ecritureSure && !retires.has(u)) {
        const data = donneesBase(p?.data, resume, now);
        const e = await ecrire(sb, { username: u, data, why: null, at: now, agence: resume.agence.agence, agence_nom: resume.agence.agence_nom, profil_lu_at: now }, etatCol);
        if (e) out.erreursEcriture.push(`@${u} : ${e.message}`);
        else enregistre = true;
      }
      out.profils.push(retires.has(u) ? { username: u, ok: false, why: "retire" } : { username: u, ok: true, resume, enregistre });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  // Ceux qu'on n'a pas eu le temps de lire.
  const vus = new Set([...out.profils.map((p) => p.username), ...out.restants]);
  for (const u of comptes) if (!vus.has(u)) out.restants.push(u);
  if (!out.arret && out.restants.length && Date.now() - t0 > budget) out.arret = "temps";
  out.sansColonnes = etatCol.sansColonnes;
  out.quota = await saveUsage(sb);
  return out;
}

/** Profils de la Base à lire : jamais lus par ces outils, ou lus il y a plus de 30 jours (les plus anciens d'abord). */
async function aScanner(sb: SupabaseClient, lot: number, now: number): Promise<{ comptes: string[]; restants: number | null; sansColonnes: boolean } | { error: string }> {
  // Entre guillemets : une date contient « : » et « . », réservés dans les filtres « or ».
  const limite = `"${new Date(now - RELIRE_APRES_JOURS * JOUR).toISOString()}"`;
  const { data: ex } = await sb.from("creator_base_meta").select("username").eq("excluded", true);
  const retires = new Set(((ex as { username: string }[] | null) ?? []).map((r) => r.username));
  // Pas les marques, pas YouTube, pas un compte personnel déjà essayé ces 30 jours.
  // deno-lint-ignore no-explicit-any
  const filtre = (q: any) => q
    .or("data.is.null,data->>isBrand.is.null,data->>isBrand.neq.true")
    .or("data.is.null,data->>platform.is.null,data->>platform.neq.youtube")
    .or(`why.is.null,why.neq.compte_perso,at.lt.${limite}`);

  // Avec le SQL : colonne profil_lu_at (survit aux relectures du Sourcing, qui réécrit data).
  const avec = await filtre(sb.from("ig_profiles").select("username")).or(`profil_lu_at.is.null,profil_lu_at.lt.${limite}`)
    .order("profil_lu_at", { ascending: true, nullsFirst: true }).order("at", { ascending: true }).limit(lot + retires.size);
  let rows = avec.data as { username: string }[] | null;
  let sansColonnes = false;
  if (avec.error) {
    if (!colonnesAbsentes(avec.error)) return { error: avec.error.message };
    sansColonnes = true;
    const sans = await filtre(sb.from("ig_profiles").select("username")).or(`data.is.null,data->>profilLu.is.null,data->>profilLu.lt.${limite}`)
      .order("at", { ascending: true }).limit(lot + retires.size);
    if (sans.error) return { error: sans.error.message };
    rows = sans.data as { username: string }[] | null;
  }
  const comptes = (rows ?? []).map((r) => r.username).filter((u) => !retires.has(u)).slice(0, lot);
  const compte = sansColonnes
    ? await filtre(sb.from("ig_profiles").select("username", { count: "exact", head: true })).or(`data.is.null,data->>profilLu.is.null,data->>profilLu.lt.${limite}`)
    : await filtre(sb.from("ig_profiles").select("username", { count: "exact", head: true })).or(`profil_lu_at.is.null,profil_lu_at.lt.${limite}`);
  return { comptes, restants: compte.error ? null : compte.count ?? null, sansColonnes };
}

export type Scan = { lecture: Lecture | null; restantsAvant: number | null; sansColonnes: boolean; error?: string };

/** Une tranche du scan de la Base : `lot` profils (1 à 100). Reprenable : ce qui est lu sort de la file. */
export async function scannerBase(sb: SupabaseClient, lot: number, budgetMs = 100_000): Promise<Scan> {
  const f = await aScanner(sb, Math.max(1, Math.min(100, lot)), Date.now());
  if ("error" in f) return { lecture: null, restantsAvant: null, sansColonnes: false, error: f.error };
  if (!f.comptes.length) return { lecture: null, restantsAvant: f.restants, sansColonnes: f.sansColonnes };
  const lecture = await lireProfils(sb, f.comptes, { enregistrer: true, budgetMs });
  await saveState(sb, ETAT_SCAN, {
    at: new Date().toISOString(), lus: lecture.profils.filter((p) => p.ok).length, echecs: lecture.profils.filter((p) => !p.ok).length,
    restants: f.restants, arret: lecture.arret, sansColonnes: f.sansColonnes || lecture.sansColonnes,
  });
  return { lecture, restantsAvant: f.restants, sansColonnes: f.sansColonnes || lecture.sansColonnes };
}

/**
 * Chiffres Instagram venus de l'API officielle de Meta (fonctions ig-avatar,
 * ig-sync, ig-connect, ig-hashtag). Le serveur écrit une colonne `ig` (jsonb) sur
 * `creators`, `collabs` et `contacts` ; l'app ne fait que la lire.
 *
 * Lecture TOLÉRANTE : tant que la migration SQL (2026-10-13-instagram-api) n'est
 * pas passée, la colonne n'existe pas → on ne montre rien, sans casser la vue.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useLiveKey } from "./useLive";
import { getCache, setCache } from "./viewCache";

export type IgSplit = { label: string; pct: number }[];
export type IgPostLite = {
  id: string;
  url: string;
  at: string;
  type?: string;
  product?: string;
  likes: number | null;
  comments: number;
  caption?: string;
  // Stats privées (créatrice qui a connecté son compte)
  reach?: number;
  saves?: number;
  shares?: number;
  views?: number;
};
export type IgCreator = {
  at?: string;
  ok?: string;
  why?: string | null;
  username?: string;
  followers?: number;
  posts?: number;
  er?: number | null;
  perWeek?: number | null;
  lastPost?: string | null;
  history?: { d: string; f: number }[];
  link?: { username: string; at: string; expires: string } | null;
  insights?: {
    at: string;
    reach: number | null;
    views: number | null;
    interactions: number | null;
    engaged: number | null;
    age?: IgSplit;
    gender?: IgSplit;
    city?: IgSplit;
    country?: IgSplit;
  } | null;
  insightsWhy?: string | null;
};
export type IgCollab = { at?: string; ok?: string; why?: string | null; posts?: IgPostLite[] };
export type IgBrand = {
  at?: string;
  ok?: string;
  why?: string | null;
  username?: string;
  name?: string;
  website?: string;
  followers?: number;
  posts?: number;
  er?: number | null;
  perWeek?: number | null;
  lastPost?: { at: string; url: string } | null;
};

/** Raison renvoyée par Meta → phrase courte pour l'écran. */
const IG_WHY: Record<string, string> = {
  compte_perso: "compte personnel (Meta ne donne les chiffres que des comptes pro)",
  sans_photo: "pas de photo sur ce compte",
  sans_handle: "pas de @ Instagram sur la fiche",
  sans_createur: "pas de créatrice sur la collab",
  meta_non_configure: "pas encore relié à Meta",
  meta_jeton: "le lien avec Meta a expiré, à refaire",
  meta_limite: "Meta freine les demandes, nouvel essai plus tard",
  meta_autorisation: "Meta n'a pas encore donné l'autorisation (validation de l'app)",
  page_429: "Instagram freine les demandes, nouvel essai à la prochaine visite",
  pause: "en attente, nouvel essai à la prochaine visite",
  profil_introuvable: "ce @ n'existe pas sur Instagram",
  page_sans_photo: "Instagram n'a pas donné la photo",
  nom_invalide: "le @ n'est pas valide",
  stockage: "la photo n'a pas pu être enregistrée",
  reseau: "Meta n'a pas répondu, nouvel essai plus tard",
  hashtag_invalide: "hashtag non valide",
  hashtag_introuvable: "hashtag inconnu d'Instagram",
  quota_proche: "pause pour ne pas dépasser le quota Meta, la suite au prochain passage",
  page_introuvable: "le robot Meta ne voit pas la Page Facebook liée au compte Instagram de TTP",
  meta_validation: "Meta demande de valider l'app (accès avancé) pour cette fonction",
  migration_manquante: "la base n'est pas encore à jour (SQL à lancer)",
};
export const igWhyText = (why?: string | null) => (why ? IG_WHY[why] ?? `Instagram a refusé (${why})` : "");

const keyOf = (table: string, v: string) => (table === "collabs" ? v : v.trim().toLowerCase());

/**
 * Colonne `ig` d'une table, indexée par `key` (id, ou nom / marque en minuscules).
 * Renvoie aussi `put` pour poser tout de suite le résultat d'un « Actualiser ».
 */
export function useIgColumn<T extends object>(table: "creators" | "collabs" | "contacts", key: "id" | "name" | "brand") {
  const cacheKey = `ig:${table}:${key}`;
  const [map, setMap] = useState<Record<string, T>>(() => getCache<Record<string, T>>(cacheKey) ?? {});
  const live = useLiveKey();
  useEffect(() => {
    let alive = true;
    void supabase
      .from(table)
      .select(`${key}, ig`)
      .not("ig", "is", null)
      .then(({ data, error }) => {
        if (!alive || error) return; // colonne absente : migration pas encore passée
        const m: Record<string, T> = {};
        for (const r of (data as Record<string, unknown>[] | null) ?? []) {
          const k = keyOf(table, String(r[key] ?? ""));
          const v = r.ig as T;
          if (!k || !v) continue;
          // Plusieurs contacts pour une marque : on garde celui qui a des chiffres.
          const fol = (x: T) => (x as { followers?: number }).followers ?? 0;
          if (m[k] && fol(m[k]) >= fol(v)) continue;
          m[k] = v;
        }
        setCache(cacheKey, m);
        setMap(m);
      });
    return () => {
      alive = false;
    };
  }, [table, key, cacheKey, live]);
  const put = useCallback(
    (k: string, v: T) =>
      setMap((m) => {
        const next = { ...m, [keyOf(table, k)]: v };
        setCache(cacheKey, next);
        return next;
      }),
    [table, cacheKey],
  );
  return [map, put] as const;
}

/** « Actualiser » une fiche maintenant (au lieu d'attendre le passage de la nuit). */
export async function igRefresh<T>(scope: "creator" | "collab" | "contact", id: string): Promise<{ ig?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke("ig-sync", { body: { scope, id } });
  if (error) return { error: "reseau" };
  noteQuota(data);
  return (data as { ig?: T; error?: string }) ?? { error: "reseau" };
}

/** Lance la connexion Instagram d'une créatrice (redirige vers Instagram). */
export async function igConnect(creator?: string): Promise<string | null> {
  const origin = window.location.origin + window.location.pathname;
  const { data, error } = await supabase.functions.invoke("ig-connect", { body: { action: "start", origin, creator } });
  const url = (data as { url?: string } | null)?.url;
  if (!error && url) {
    window.location.href = url;
    return null;
  }
  const why = (data as { error?: string } | null)?.error;
  return why === "instagram_login_non_configure"
    ? "La connexion Instagram n'est pas encore activée par l'agence"
    : "Connexion impossible pour l'instant, réessaie";
}
export async function igDisconnect(creator?: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("ig-connect", { body: { action: "disconnect", creator } });
  return !error && !!(data as { ok?: boolean } | null)?.ok;
}
/** Retour d'Instagram (?instagram=connected|error) : nettoie l'adresse et renvoie l'issue. */
export function consumeIgReturn(): "connected" | "error" | null {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("instagram");
  if (!flag) return null;
  url.searchParams.delete("instagram");
  window.history.replaceState({}, "", url.toString());
  return flag === "connected" ? "connected" : "error";
}

// ── Mise en forme ────────────────────────────────────────────────────────────
const frNum = (n: number) => String(n).replace(".", ",");
export const fmtEr = (er?: number | null) => (er == null ? "—" : `${frNum(er)} %`);
export const fmtPerWeek = (n?: number | null) => (n == null ? "—" : `${frNum(n)} / sem.`);
/** « aujourd'hui », « hier », « il y a 5 j », « il y a 3 sem. », « il y a 2 mois ». */
export function fmtAgo(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return "hier";
  if (d < 14) return `il y a ${d} j`;
  if (d < 60) return `il y a ${Math.round(d / 7)} sem.`;
  return `il y a ${Math.round(d / 30)} mois`;
}
/** Évolution des abonnés sur ~`days` jours (relevé quotidien de ig-sync). */
export function followersDelta(hist: IgCreator["history"], days = 30): number | null {
  const list = [...(hist ?? [])].sort((a, b) => a.d.localeCompare(b.d));
  if (list.length < 2) return null;
  const last = list[list.length - 1];
  const limit = new Date(Date.parse(last.d) - days * 86400000).toISOString().slice(0, 10);
  const base = [...list].reverse().find((x) => x.d <= limit) ?? list[0];
  return base === last ? null : last.f - base.f;
}
/** Format d'un post Instagram : Reel, Carrousel, Vidéo, Post. */
export function postKind(p: { type?: string; product?: string }): string {
  if (p.product === "REELS") return "Reel";
  if (p.type === "CAROUSEL_ALBUM") return "Carrousel";
  if (p.type === "VIDEO") return "Vidéo";
  return "Post";
}

// ── Compteur de demandes à Meta (table ig_quota, écrite par les fonctions) ──────
export type MetaQuota = {
  hourStart?: string;
  hourCalls?: number;
  dayCalls?: number;
  appPct?: number | null;
  bucPct?: number | null;
  blockedUntil?: string | null;
  lastAt?: string;
};
const QUOTA_EVENT = "ttp-ig-quota";
/** À appeler avec la réponse d'une fonction Instagram : met le compteur à jour partout. */
export function noteQuota(res: unknown) {
  const q = (res as { quota?: MetaQuota } | null)?.quota;
  if (q) window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: q }));
}
/** Dernier relevé du quota (null tant que la table n'existe pas ou qu'aucune demande n'a été faite). */
export function useMetaQuota(): MetaQuota | null {
  const [q, setQ] = useState<MetaQuota | null>(() => getCache<MetaQuota>("ig:quota"));
  const live = useLiveKey();
  useEffect(() => {
    let alive = true;
    void supabase.from("ig_quota").select("data").eq("id", 1).maybeSingle().then(({ data, error }) => {
      if (!alive || error || !data) return;
      setCache("ig:quota", data.data as MetaQuota);
      setQ(data.data as MetaQuota);
    });
    const on = (e: Event) => {
      const d = (e as CustomEvent<MetaQuota>).detail;
      setCache("ig:quota", d);
      setQ(d);
    };
    window.addEventListener(QUOTA_EVENT, on);
    return () => {
      alive = false;
      window.removeEventListener(QUOTA_EVENT, on);
    };
  }, [live]);
  return q;
}
/** Lecture du relevé : % utilisé, pause en cours, demandes restantes estimées. */
export function readQuota(q: MetaQuota | null, now = Date.now()) {
  const pct = Math.max(q?.appPct ?? 0, q?.bucPct ?? 0);
  const blockedMs = q?.blockedUntil ? Date.parse(q.blockedUntil) - now : 0;
  const blockedMin = blockedMs > 0 ? Math.ceil(blockedMs / 60000) : 0;
  const hourFresh = !!q?.hourStart && now - Date.parse(q.hourStart) < 3600000;
  const hourCalls = hourFresh ? q?.hourCalls ?? 0 : 0;
  // Estimation : si N demandes ont utilisé p %, il en reste environ N × (100 − p) / p.
  const left = pct > 0 && hourCalls > 0 ? Math.max(0, Math.round((hourCalls * (100 - pct)) / pct)) : null;
  // Minutes avant que la fenêtre d'une heure se vide (approximation).
  const resetMin = hourFresh && q?.hourStart ? Math.max(1, Math.ceil((Date.parse(q.hourStart) + 3600000 - now) / 60000)) : null;
  return { pct, blockedMin, hourCalls, dayCalls: q?.dayCalls ?? 0, left, resetMin };
}

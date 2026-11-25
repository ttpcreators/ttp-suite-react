// ============================================================================
// _shared/marquesChaudes.ts : les « marques chaudes » du radar (texte pour le connecteur).
// ----------------------------------------------------------------------------
// Décision de Gianni du 25/11 (point 5) : la prospection du matin commence par les marques
// qui ont payé un partenariat ces derniers jours à un créateur suivi par le radar. La liste
// vient de la fonction SQL radar_marques_chaudes (sql/2026-11-25-radar-marques-chaudes.sql) ;
// ici, seulement la mise en forme. Règles PURES, testées par marquesChaudes.test.ts.
// ============================================================================

export type MarqueChaude = { marque: string; payes: number; createurs: string[]; roster: string[]; dernier: string | null };

/** Relit une ligne renvoyée par la fonction SQL (null si elle est abîmée). */
export function lireMarqueChaude(v: unknown): MarqueChaude | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const marque = typeof r.marque === "string" ? r.marque.trim() : "";
  if (!marque) return null;
  const liste = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()) : []);
  return {
    marque,
    payes: typeof r.payes === "number" && Number.isFinite(r.payes) ? r.payes : 0,
    createurs: liste(r.createurs),
    roster: liste(r.roster),
    dernier: typeof r.dernier === "string" ? r.dernier : null,
  };
}

const jourCourt = (iso: string | null) => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }) : "";
};

/** « - @teveo · 16 partenariats payés · 3 créateurs : @a @b @c · dernier 19 nov. » */
export function ligneMarqueChaude(m: MarqueChaude): string {
  const qui = m.createurs.slice(0, 6).map((c) => `@${c}`).join(" ");
  return [
    `- @${m.marque}`,
    `${m.payes} partenariat${m.payes > 1 ? "s" : ""} payé${m.payes > 1 ? "s" : ""}`,
    `${m.createurs.length} créateur${m.createurs.length > 1 ? "s" : ""}${qui ? ` : ${qui}` : ""}`,
    m.roster.length ? `dont du roster : ${m.roster.map((c) => `@${c}`).join(" ")} (collab de l'agence ? vérifier avant d'écrire)` : "",
    m.dernier ? `dernier ${jourCourt(m.dernier)}` : "",
  ].filter(Boolean).join(" · ");
}

/** Le texte complet rendu par l'outil `sourcing` avec `chaudes`. */
export function texteMarquesChaudes(liste: MarqueChaude[], jours: number): string {
  if (!liste.length) return `# Marques chaudes (${jours} j) · aucune\nAucune marque confirmée, hors carnet, n'a payé de partenariat repéré par le radar sur cette période.`;
  return [
    `# Marques chaudes (${jours} j) · ${liste.length}`,
    "Marques qui ont payé un partenariat à un créateur suivi par le radar, absentes du carnet. Les plus suivies d'abord.",
    "Avant d'écrire : `rechercher` la marque (échange, collab, brouillon), trouver l'adresse (`lire_site_marque`), choisir le créateur du roster de la même niche que les créateurs payés, `verifier_exclusivite`.",
    ...liste.map(ligneMarqueChaude),
  ].join("\n");
}

// ============================================================================
// _shared/hunter.ts : Hunter (hunter.io), e-mails pro des marques.
// ----------------------------------------------------------------------------
// MIS DE CÔTÉ le 24/11/2026 : l'agence passe par FullEnrich seulement (_shared/fullenrich.ts).
// Ce code reste en sommeil : sans la clé HUNTER_API_KEY, il n'appelle rien. Ne pas créer de
// compte Hunter. `domaineDe` sert toujours aux outils FullEnrich.
// Règles PURES, testées par hunter.test.ts. Les appels sont faits par les outils
// `trouver_emails_marque` et `trouver_email_personne` du connecteur Claude
// (ttp-mcp/autonomie.ts), avec la clé du secret HUNTER_API_KEY (jamais dans le code).
// API v2 : https://hunter.io/api-documentation/v2
//   GET /domain-search : personnes d'un domaine (ou d'un nom de marque : Hunter trouve le domaine)
//   GET /email-finder  : e-mail d'une personne (prénom, nom, domaine)
//   GET /email-verifier: vérifie une adresse
// Coûts Hunter : 1 recherche par appel de domain-search (jusqu'à 10 e-mails) et par e-mail
// trouvé ; 1 vérification par appel de email-verifier. Offre gratuite : 25 recherches et
// 50 vérifications par mois, 10 résultats au plus par appel.
// ============================================================================

type J = Record<string, unknown>;
const o = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const HUNTER_API = "https://api.hunter.io/v2";
/** Message quand FullEnrich n'a pas trouvé l'e-mail et que Hunter n'a pas de clé (mis de côté). */
export const CLE_MANQUANTE = "Pas trouvé par FullEnrich. Hunter est mis de côté depuis le 24/11 : chercher l'adresse partenariats ou presse du site (lire_site_marque), sinon le LinkedIn de la personne.";

/** « https://www.Sephora.fr/fr » → « sephora.fr » ; "" si ce n'est pas un domaine. */
export function domaineDe(v: string): string {
  const c = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "").replace(/^.*@/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(c) && !/\.(png|jpe?g)$/.test(c) ? c : "";
}

/** Paramètres de domain-search (sans la clé, envoyée en en-tête). Départements marketing et communication. */
export function paramsRecherche(q: { domaine?: string; marque?: string; limite?: number; offset?: number; departements?: boolean }): string {
  const p = new URLSearchParams();
  if (q.domaine) p.set("domain", q.domaine);
  else if (q.marque) p.set("company", q.marque.trim().slice(0, 120));
  p.set("type", "personal");
  if (q.departements !== false) p.set("department", "marketing,communication");
  p.set("limit", String(Math.max(1, Math.min(100, q.limite ?? 10))));
  if (q.offset) p.set("offset", String(Math.max(0, q.offset)));
  return p.toString();
}

export type PersonneHunter = {
  prenom: string; nom: string; poste: string; departement: string; seniorite: string;
  email: string; confiance: number | null; statut: string; linkedin: string;
};
export type RechercheHunter = { domaine: string; organisation: string; motif: string; acceptAll: boolean; personnes: PersonneHunter[]; total: number };

/** Réponse de domain-search → personnes. */
export function lireRecherche(body: J): RechercheHunter {
  const d = o(body.data);
  const personnes = (Array.isArray(d.emails) ? d.emails : []).map((e0) => {
    const e = o(e0);
    const li = s(e.linkedin);
    return {
      prenom: s(e.first_name), nom: s(e.last_name), poste: s(e.position) || s(e.position_raw), departement: s(e.department), seniorite: s(e.seniority),
      email: s(e.value).toLowerCase(), confiance: n(e.confidence), statut: s(o(e.verification).status),
      linkedin: !li ? "" : /^https?:\/\//i.test(li) ? li : `https://www.linkedin.com/in/${li.replace(/^\/+|\/+$/g, "")}`,
    };
  }).filter((p) => p.email);
  return { domaine: s(d.domain), organisation: s(d.organization), motif: s(d.pattern), acceptAll: d.accept_all === true, personnes, total: n(o(body.meta).results) ?? personnes.length };
}

/** Poids d'un poste pour la prospection d'influence (0 = hors sujet). */
export function pertinence(p: Pick<PersonneHunter, "poste" | "departement">): number {
  const t = p.poste.toLowerCase();
  if (/influen|creator|cr[ée]ateur|talent|ambassad|kol\b|ugc/.test(t)) return 5;
  if (/partenariat|partnership|partner|alliances?/.test(t)) return 4;
  if (/relations? presse|\brp\b|\bpr\b|public relations|press|media relations|relations m[ée]dias/.test(t)) return 4;
  if (/social|community|content|contenu|r[ée]seaux/.test(t)) return 3;
  if (/marketing|brand|marque|growth|acquisition|activation|e-?commerce|cmo\b/.test(t)) return 2;
  if (/communication|digital|num[ée]rique/.test(t)) return 2;
  if (/^(marketing|communication)$/i.test(p.departement)) return 1;
  return 0;
}

/** Personnes marketing, influence, RP ou partenariats, les plus utiles d'abord. */
export function cibles(list: PersonneHunter[]): PersonneHunter[] {
  return list.map((p) => ({ p, w: pertinence(p) })).filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || (b.p.confiance ?? 0) - (a.p.confiance ?? 0)).map((x) => x.p);
}

/** Statut de vérification lisible. */
export function statutEmail(statut: string, confiance: number | null, acceptAll = false): string {
  const c = confiance != null ? `, confiance ${confiance} %` : "";
  switch (statut) {
    case "valid": return `vérifiée${c}`;
    case "invalid": return "INVALIDE, ne pas utiliser";
    case "accept_all": return `non garantie : le domaine accepte toutes les adresses${c}`;
    case "webmail": return `messagerie gratuite${c}`;
    case "disposable": return "jetable, ne pas utiliser";
    case "unknown": return `vérification impossible${c}`;
    default: return acceptAll ? `non vérifiée, le domaine accepte toutes les adresses${c}` : `non vérifiée${c}`;
  }
}

/** Réponse de email-finder → e-mail trouvé. */
export function lireEmailTrouve(body: J): { email: string; confiance: number | null; statut: string; poste: string; linkedin: string; acceptAll: boolean } {
  const d = o(body.data);
  return { email: s(d.email).toLowerCase(), confiance: n(d.score), statut: s(o(d.verification).status), poste: s(d.position), linkedin: s(d.linkedin_url), acceptAll: d.accept_all === true };
}

/** Réponse de email-verifier → statut. */
export function lireVerification(body: J): string {
  return s(o(body.data).status);
}

/** Erreur Hunter → phrase pour Claude. */
export function erreurHunter(status: number, body: J): string {
  const det = (Array.isArray(body.errors) ? body.errors : []).map((e) => s(o(e).details) || s(o(e).id)).filter(Boolean).join(" ; ");
  if (status === 0) return "Hunter n'a pas répondu (réseau). Réessayer plus tard.";
  if (status === 401) return "Clé Hunter refusée : HUNTER_API_KEY est fausse ou désactivée (à refaire par Marc).";
  if (status === 429 || status === 402 || /usage limit|monthly|quota|credits?/i.test(det)) return `Quota Hunter épuisé ou limite atteinte${det ? ` (${det})` : ""}. Recharger le compte Hunter ou attendre le mois suivant.`;
  if (status === 403) return `Hunter limite le nombre de demandes par seconde${det ? ` (${det})` : ""}. Réessayer dans une minute.`;
  if (status === 451) return "Cette personne a demandé à Hunter de ne plus diffuser son adresse.";
  if (status === 400) return `Demande refusée par Hunter${det ? ` : ${det}` : ""}.`;
  return `Erreur Hunter ${status}${det ? ` : ${det}` : ""}.`;
}

/** Offre gratuite : « limited to 10 email addresses » → refaire la demande avec limit=10. */
export function limiteDeLOffre(status: number, body: J): boolean {
  return status === 400 && /limited to \d+|pagination|limit/i.test(JSON.stringify(body.errors ?? ""));
}

/** Ligne d'une personne trouvée, pour Claude. */
export function lignePersonne(p: PersonneHunter, acceptAll = false): string {
  const nom = `${p.prenom} ${p.nom}`.trim() || "nom inconnu";
  return `- ${nom} · ${p.poste || "poste inconnu"} · ${p.email} (${statutEmail(p.statut, p.confiance, acceptAll)})${p.linkedin ? ` · ${p.linkedin}` : " · LinkedIn inconnu"}`;
}

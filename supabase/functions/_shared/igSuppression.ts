// ============================================================================
// _shared/igSuppression.ts : règles PURES de l'annulation d'autorisation (ig-deauth)
// et de la suppression des données Instagram d'une créatrice (ig-data-deletion),
// demandées par Meta quand elle retire l'app ou demande l'effacement.
// ----------------------------------------------------------------------------
// Ce qui vient de SON jeton (Instagram API with Instagram Login), donc effacé :
//   • le jeton (table ig_accounts) ;
//   • creators.ig.link (« Instagram connecté »), ig.insights (couverture, vues,
//     interactions, audience, reels), ig.insightsWhy ;
//   • dans ig.feed : vues, couverture, enregistrements et partages de chaque post
//     (publicFeed garde les likes et commentaires, publics) ;
//   • dans collabs.ig.posts de ses collabs : reach, saves, shares, views, insAt ;
//   • dans l'historique d'engagement (blob, clé engagementHistory) : les mesures
//     « Relevé automatique Instagram … compte connecté » (auto: true).
// Ce qui reste (pas venu du jeton, ou donnée de l'agence) : la fiche, les abonnés et
// l'engagement public (business discovery, sans son jeton), le media kit (saisi ou
// recopié, impossible à distinguer), les images des posts (publiques).
// Testé par igSuppression.test.ts.
// ============================================================================

import { publicFeed } from "./igFeed.ts";

type Json = Record<string, unknown>;

/** Page de statut (statique, sans compte TTP) : public/instagram-donnees/index.html. */
export const PAGE_STATUT_SUPPRESSION = "https://app.ttpcreators.pro/instagram-donnees/";
export const urlStatutSuppression = (code: string) => `${PAGE_STATUT_SUPPRESSION}?code=${encodeURIComponent(code)}`;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I : lisible au téléphone
export const CODE_CONFIRMATION = /^IG-[A-HJ-NP-Z2-9]{10}$/;

/** Code de confirmation donné à Meta et affiché sur la page de statut : « IG-XXXXXXXXXX ». */
export function codeConfirmation(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = rand(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return `IG-${s}`;
}

/** creators.ig après une annulation d'autorisation : seulement le lien retiré. */
export function igSansLien(ig: unknown): Json {
  const prev = ig && typeof ig === "object" && !Array.isArray(ig) ? (ig as Json) : {};
  return { ...prev, link: null };
}

/** creators.ig après une demande de suppression : tout ce qui vient du jeton retiré. */
export function igSansDonneesPrivees(ig: unknown): Json {
  const prev = ig && typeof ig === "object" && !Array.isArray(ig) ? (ig as Json) : {};
  const next: Json = { ...prev, link: null, insights: null, insightsWhy: null };
  if (prev.feed !== undefined) next.feed = publicFeed(prev.feed);
  return next;
}

const CHIFFRES_PRIVES_POST = ["reach", "saves", "shares", "views", "insAt"] as const;

/** collabs.ig sans les chiffres privés de chaque post ; null si rien à changer. */
export function collabIgSansStatsPrivees(ig: unknown): Json | null {
  if (!ig || typeof ig !== "object" || Array.isArray(ig)) return null;
  const prev = ig as Json;
  if (!Array.isArray(prev.posts)) return null;
  let change = false;
  const posts = (prev.posts as unknown[]).map((p) => {
    if (!p || typeof p !== "object") return p;
    const post = { ...(p as Json) };
    for (const k of CHIFFRES_PRIVES_POST) {
      if (k in post) {
        delete post[k];
        change = true;
      }
    }
    return post;
  });
  return change ? { ...prev, posts } : null;
}

/** Ids des mesures d'engagement relevées avec son jeton (à retirer de engagementHistory). */
export function mesuresAutoInstagram(hist: unknown, creatorId: string): string[] {
  if (!Array.isArray(hist)) return [];
  return (hist as Json[])
    .filter((h) => h && h.auto === true && h.platform === "instagram" && h.creatorId === creatorId && /compte connect/i.test(String(h.detail ?? "")))
    .map((h) => String(h.id ?? ""))
    .filter(Boolean);
}

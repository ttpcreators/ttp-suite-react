/**
 * Fonctions qui attendent un accord extérieur (Meta, TikTok, Google). `false` = bouton caché,
 * plutôt qu'un bouton qui répond « pas encore disponible ». Passer à `true` après l'accord.
 * (Tri du 2026-10-15.) Côté agence, les cartes Instagram / TikTok / YouTube de la fiche
 * créateur restent visibles : elles servent aux essais avec les comptes de test.
 */
export const FEATURES = {
  /** Scouting → « Hashtag » : Meta « Instagram Public Content Access » (pas encore demandé). */
  hashtagSearch: false,
  /** Espace créateur → « Envoyer mes stats » → « Connecter mon … », et imports du Debrief. */
  connect: {
    instagram: false, // App Review Meta à faire (instagram_business_basic + manage_insights)
    tiktok: true, // app TikTok validée le 2026-10-20, clés de Production posées le 2026-10-21
    youtube: false, // app Google en test, mise en pause par Marc
  },
} as const;

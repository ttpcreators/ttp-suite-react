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
    tiktok: false, // passage en production demandé à TikTok le 2026-10-14
    youtube: false, // app Google en test, mise en pause par Marc
  },
} as const;

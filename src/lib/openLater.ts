/**
 * Ouvre un onglet dont l'adresse n'arrive qu'après un await (lien signé du stockage…).
 * Sur iPhone (Safari, PWA), un window.open lancé APRÈS un await est bloqué : le
 * geste de l'utilisateur est perdu. On ouvre donc un onglet vide TOUT DE SUITE,
 * dans le clic, puis on y charge l'adresse quand elle arrive.
 */

const STORED_HTML = /^https:\/\/zizvggziggswhrbuyhuo\.supabase\.co\/storage\/v1\/object\/sign\/documents\/[^?#]+\.html?(\?|$)/i;

/**
 * Adresse à ouvrir ou à partager pour un lien signé du stockage. Supabase sert les .html
 * (contrats…) en texte brut : ouverts tels quels, ils montrent le CODE, accents cassés.
 * Ils passent donc par la page de lecture /document/, qui les affiche comme une vraie page.
 */
export function viewableUrl(url: string): string {
  if (!STORED_HTML.test(url)) return url;
  return `${window.location.origin}/document/#${encodeURIComponent(url)}`;
}

/** Charge `url` dans l'onglet pré-ouvert ; s'il a été refusé (null) ou fermé, ouvre un onglet comme avant. */
export function goToTab(w: Window | null, url: string): void {
  const target = viewableUrl(url);
  if (w && !w.closed) w.location.href = target;
  else window.open(target, "_blank");
}

/**
 * À appeler dans le gestionnaire de clic AVANT tout await. Renvoie false si
 * l'adresse n'a pas pu être obtenue : l'onglet vide est refermé, et c'est à
 * l'appelant d'afficher son message d'erreur.
 */
export async function openLater(getUrl: () => Promise<string | null>): Promise<boolean> {
  const w = window.open("", "_blank");
  let url: string | null = null;
  try {
    url = await getUrl();
  } catch {
    url = null;
  }
  if (!url) {
    w?.close();
    return false;
  }
  goToTab(w, url);
  return true;
}

/**
 * Ouvre un onglet dont l'adresse n'arrive qu'après un await (lien signé du stockage…).
 * Sur iPhone (Safari, PWA), un window.open lancé APRÈS un await est bloqué : le
 * geste de l'utilisateur est perdu. On ouvre donc un onglet vide TOUT DE SUITE,
 * dans le clic, puis on y charge l'adresse quand elle arrive.
 */

import { lienContrat } from "./fichierSur";

/**
 * Adresse à ouvrir ou à partager pour un lien signé du stockage. Supabase sert les .html
 * (contrats…) en texte brut : ouverts tels quels, ils montrent le CODE, accents cassés.
 * Les contrats de l'agence (dossier contracts/) passent donc par la page de lecture
 * /document/, qui les affiche comme une vraie page. Tout autre lien reste tel quel.
 */
export function viewableUrl(url: string): string {
  const contrat = lienContrat(url);
  if (!contrat) return url;
  return `${window.location.origin}/document/#${encodeURIComponent(contrat)}`;
}

/** Onglet vide ouvert dans le clic, coupé de l'app : la page qui s'y chargera ne peut pas
 *  remplacer l'onglet de l'app (window.opener). */
export function openBlankTab(): Window | null {
  const w = window.open("", "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* navigateur qui refuse : l'onglet reste utilisable */
    }
  }
  return w;
}

/** Ouvre une adresse externe dans un nouvel onglet, sans lien vers l'app. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Charge `url` dans l'onglet pré-ouvert ; s'il a été refusé (null) ou fermé, ouvre un onglet comme avant. */
export function goToTab(w: Window | null, url: string): void {
  const target = viewableUrl(url);
  if (w && !w.closed) w.location.href = target;
  else openExternal(target);
}

/**
 * À appeler dans le gestionnaire de clic AVANT tout await. Renvoie false si
 * l'adresse n'a pas pu être obtenue : l'onglet vide est refermé, et c'est à
 * l'appelant d'afficher son message d'erreur.
 */
export async function openLater(getUrl: () => Promise<string | null>): Promise<boolean> {
  const w = openBlankTab();
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

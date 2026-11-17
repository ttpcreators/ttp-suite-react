// ============================================================================
// _shared/dejaEchange.ts : avant un brouillon, les derniers échanges avec ce destinataire.
// ----------------------------------------------------------------------------
// Demande de Marc (17 novembre 2026, cas Lumera / Prison Island) : Alfred a préparé l'envoi
// d'une facture déjà partagée depuis la boîte de Léna, et confirmée par la marque. Une
// consigne ne suffit pas : l'outil de brouillon cherche lui même dans TOUTES les boîtes
// (agence et créateurs connectés) et montre les derniers échanges avec cette personne
// ou sa société, pour qu'aucun doublon ne parte.
// ============================================================================

/** Messageries grand public : on cherche l'adresse exacte, pas tout le domaine. */
const PUBLICS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "orange.fr", "free.fr", "sfr.fr", "laposte.net", "wanadoo.fr", "proton.me", "protonmail.com",
]);

/** Ce qu'on cherche pour chaque destinataire : le domaine de la société, ou l'adresse si c'est une messagerie grand public. */
export function ciblesEchange(destinataires: string): string[] {
  const out = new Set<string>();
  for (const m of String(destinataires ?? "").toLowerCase().matchAll(/[^@\s<>,;"']+@([^@\s<>,;"']+\.[a-z]{2,})/g)) {
    const domaine = m[1];
    out.add(PUBLICS.has(domaine) ? m[0] : domaine);
  }
  return [...out].slice(0, 4);
}

/** Requête Gmail : tout ce qui est venu de ces cibles ou leur est parti, sur 60 jours. */
export function requeteEchange(cibles: string[]): string {
  if (!cibles.length) return "";
  const parts = cibles.flatMap((c) => [`from:${c}`, `to:${c}`, `cc:${c}`]);
  return `{${parts.join(" ")}} newer_than:60d`;
}

export type EchangeVu = { box: string; date: string; from: string; subject: string; messages: number; snippet: string; threadId: string };

/** Le bloc ajouté au résultat du brouillon (vide si aucun échange). */
export function texteEchanges(cibles: string[], fils: EchangeVu[]): string {
  if (!fils.length) return "";
  const lignes = fils.slice(0, 6).map((t) =>
    `- ${t.date} · ${t.box.includes("@") ? t.box : `${t.box}@`} · ${t.from} · « ${t.subject} »${t.messages > 1 ? ` (${t.messages} messages)` : ""}\n  ${t.snippet.slice(0, 180)}\n  [fil ${t.threadId}]`);
  return [
    `\n\n⚠️ DÉJÀ DES ÉCHANGES avec ${cibles.join(", ")} (toutes les boîtes, créateurs compris, 60 jours) :`,
    ...lignes,
    "Avant de proposer ce brouillon à Marc : lis le plus récent de ces fils en entier (lire_mail). Si ce que dit ton brouillon est déjà fait (facture déjà envoyée, réponse déjà donnée, date déjà calée), supprime le brouillon (supprimer_brouillon) et dis à Marc « Déjà fait » avec la date et la boîte.",
  ].join("\n");
}

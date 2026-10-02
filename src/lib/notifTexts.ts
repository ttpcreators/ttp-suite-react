/**
 * Textes (titres) PERSONNALISABLES des notifications push. Stockés dans le blob
 * agence `notifTexts` (clé → texte). La fonction serveur `daily-digest` lit ce
 * même blob et utilise le texte custom s'il existe, sinon le défaut.
 *
 * ⚠️ Après modif, la fonction n'a besoin d'AUCUN redéploiement (elle lit le blob
 * à chaque envoi) — SAUF si on ajoute/retire une clé (là il faut redéployer une
 * fois pour que la fonction connaisse la nouvelle clé).
 */

export type NotifTextField = { key: string; label: string; def: string; hint?: string };

/** Notifs reçues par un CRÉATEUR (quand l'agence agit). */
export const NOTIF_TEXTS_CREATOR: NotifTextField[] = [
  { key: "c_task", label: "Nouvelle tâche", def: "Nouvelle tâche" },
  { key: "c_brief", label: "Nouveau brief", def: "Nouveau brief" },
  { key: "c_debrief", label: "Nouveau débrief", def: "Nouveau débrief" },
  { key: "c_document", label: "Nouveau document", def: "Nouveau document" },
  { key: "c_event", label: "Nouvel évènement", def: "Nouvel évènement" },
  { key: "c_mediakit", label: "Nouveau media kit", def: "Media kit mis à jour" },
  { key: "c_taskdone", label: "Demande terminée", def: "Ta demande est faite" },
  { key: "c_idea", label: "Nouvelle idée", def: "Nouvelle idée de l'agence" },
  { key: "c_gift", label: "Cadeau / dotation", def: "Nouveau cadeau" },
  { key: "c_invoice", label: "Facture", def: "Facture mise à jour" },
  { key: "c_roadmap", label: "Feuille de route", def: "Feuille de route mise à jour" },
];

/** Notifs reçues par l'AGENCE (quand un créateur agit), PAR type d'action.
 *  Variable disponible : {createur} = le prénom du créateur. */
export const NOTIF_TEXTS_AGENCY: NotifTextField[] = [
  { key: "a_task", label: "Créateur ajoute une tâche", def: "{createur} · nouvelle tâche", hint: "Variable : {createur} = le prénom du créateur." },
  { key: "a_idea", label: "Créateur propose une idée", def: "{createur} · nouvelle idée" },
  { key: "a_contact", label: "Créateur ajoute un contact", def: "{createur} · nouveau contact" },
  { key: "a_event", label: "Créateur ajoute un évènement", def: "{createur} · nouvel évènement" },
  { key: "a_gift", label: "Créateur — cadeau / dotation", def: "{createur} · cadeau reçu" },
  { key: "a_facture", label: "Créateur dépose une facture", def: "{createur} · facture déposée" },
  { key: "a_stats", label: "Créateur envoie ses stats", def: "{createur} · stats envoyées" },
];

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
  { key: "c_task", label: "Nouvelle tâche", def: "✓ Nouvelle tâche de ton agence" },
  { key: "c_brief", label: "Nouveau brief", def: "📋 Nouveau brief de ton agence" },
  { key: "c_debrief", label: "Nouveau débrief", def: "📊 Nouveau débrief de ton agence" },
  { key: "c_document", label: "Nouveau document", def: "📄 Nouveau document de ton agence" },
  { key: "c_event", label: "Nouvel évènement", def: "📅 Nouvel évènement de ton agence" },
  { key: "c_mediakit", label: "Nouveau media kit", def: "🖼️ Nouveau media kit de ton agence" },
  { key: "c_taskdone", label: "Demande terminée", def: "✅ Ta demande est faite" },
  { key: "c_idea", label: "Nouvelle idée", def: "💡 Une idée de ton agence" },
  { key: "c_gift", label: "Cadeau / dotation", def: "🎁 Nouveau cadeau / dotation" },
  { key: "c_invoice", label: "Facture", def: "💸 Mise à jour de ta facture" },
  { key: "c_roadmap", label: "Feuille de route", def: "🎯 Ta feuille de route a été mise à jour" },
];

/** Notifs reçues par l'AGENCE (quand un créateur agit), PAR type d'action.
 *  Variable disponible : {createur} = le prénom du créateur. */
export const NOTIF_TEXTS_AGENCY: NotifTextField[] = [
  { key: "a_task", label: "Créateur ajoute une tâche", def: "{createur} a ajouté une tâche", hint: "Variable : {createur} = le prénom du créateur." },
  { key: "a_idea", label: "Créateur propose une idée", def: "💡 {createur} a proposé une idée" },
  { key: "a_contact", label: "Créateur ajoute un contact", def: "{createur} a ajouté un contact" },
  { key: "a_event", label: "Créateur ajoute un évènement", def: "📅 {createur} a ajouté un évènement" },
  { key: "a_gift", label: "Créateur — cadeau / dotation", def: "🎁 {createur} — cadeau reçu" },
  { key: "a_facture", label: "Créateur dépose une facture", def: "💸 {createur} a déposé une facture" },
  { key: "a_stats", label: "Créateur envoie ses stats", def: "📊 {createur} a envoyé ses stats" },
];

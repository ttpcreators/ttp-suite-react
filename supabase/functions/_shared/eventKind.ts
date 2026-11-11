/**
 * Type d'un événement d'agenda deviné d'après son titre, quand personne ne l'a choisi
 * (synchro Google, connecteur Claude). Avant, tout devenait « call » : « Poster pour Nakd »
 * ou « Event Intersport × Under Armour » s'affichaient comme des appels (audit du 2 nov., n° 48).
 * Copie de src/lib/eventKind.ts (mêmes règles, à garder identiques).
 */
export type EventKind = "call" | "reunion" | "collab" | "shoot" | "event" | "voyage" | "deadline";

const RULES: [EventKind, RegExp][] = [
  ["deadline", /\b(post(er)?|publi(er|cation)|deadline|livr(er|aison)|rendre|envoyer|mise en ligne|date limite|story|reel)\b/i],
  ["shoot", /\b(shoot(ing)?|tournage|tourner|photo)\b/i],
  ["event", /(?<![\p{L}\p{N}])(event|[ée]v[ée]nement|soir[ée]e|lancement|salon|vernissage|inauguration|festival)(?![\p{L}\p{N}])/iu],
  ["voyage", /\b(voyage|vol|train|d[ée]placement|trip)\b/i],
  ["reunion", /\b(r[ée]union|point|rdv|rendez-vous|d[ée]jeuner|d[îi]ner)\b/i],
  ["call", /\b(call|appel|visio|meet|zoom|t[ée]l[ée]phone)\b/i],
];

/** Type deviné (« call » si rien ne ressort, comme avant). */
export function guessEventKind(title: string | null | undefined): EventKind {
  const t = String(title ?? "");
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return "call";
}

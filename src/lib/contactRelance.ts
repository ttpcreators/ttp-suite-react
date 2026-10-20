import { lastActivityMs, type Touch } from "./touches";

/**
 * Prochaine relance d'un contact marque : règles PURES (sans React ni Supabase)
 * partagées par la liste et la fiche de la page Contacts. Même seuil et même
 * calcul que `needsRelance` (src/lib/touches.ts) : la dernière activité est la
 * touche la plus récente OU le dernier mail sortant ; le contact passe « à
 * relancer » quand elle date de `threshold` jours ou plus.
 */

const DAY = 86400000;

export type RelanceInfo = {
  /** Au moins une prise de contact connue (touche ou mail sortant). */
  contacted: boolean;
  /** Jours pleins depuis le dernier échange (null si aucun échange daté). */
  days: number | null;
  /** Le cycle de recontact est écoulé : « à relancer ». */
  due: boolean;
  /** Jours restants avant « à relancer » (0 si déjà dû, null si jamais contacté). */
  daysLeft: number | null;
  /** Avancement du cycle, de 0 à 1 (temps écoulé / seuil). */
  progress: number;
};

/** État de relance d'un contact à l'instant `now`. */
export function relanceInfo(list: Touch[], lastContacted: string | null | undefined, threshold: number, now: number = Date.now()): RelanceInfo {
  const span = Math.max(1, Number(threshold) || 1) * DAY;
  const contacted = list.length > 0 || Boolean(lastContacted);
  const last = lastActivityMs(list, lastContacted);
  if (!last) return { contacted, days: null, due: false, daysLeft: null, progress: 0 };
  const elapsed = Math.max(0, now - last);
  const due = elapsed >= span;
  return {
    contacted,
    days: Math.floor(elapsed / DAY),
    due,
    daysLeft: due ? 0 : Math.max(1, Math.ceil((span - elapsed) / DAY)),
    progress: Math.min(1, elapsed / span),
  };
}

/** Durée courte : « 5 j », « 2 mois », « 1 an ». */
export function agoShort(days: number): string {
  if (days < 30) return `${Math.max(0, days)} j`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))} mois`;
  const y = Math.floor(days / 365);
  return `${y} an${y > 1 ? "s" : ""}`;
}

/** Dernier échange lisible : « Aujourd'hui », « Hier », « Il y a 22 j », « Il y a 4 mois ». */
export function agoLabel(days: number | null): string {
  if (days == null) return "Jamais contacté";
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return `Il y a ${agoShort(days)}`;
}

/** Échéance de la prochaine relance : « maintenant », « demain », « dans 23 jours ». */
export function relanceCountdown(daysLeft: number | null): string {
  if (daysLeft == null) return "";
  if (daysLeft <= 0) return "maintenant";
  if (daysLeft === 1) return "demain";
  return `dans ${daysLeft} jours`;
}

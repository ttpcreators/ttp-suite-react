// ============================================================================
// _shared/mailIgnore.ts : expéditeurs « Pas à traiter ».
// ----------------------------------------------------------------------------
// Un clic sur « Pas à traiter » (page Mails) retient l'adresse de l'expéditeur : ses
// mails restent dans la boîte de réception mais ne vont plus dans « À traiter », et
// gmail-poll ne crée plus de tâche To-do à partir d'eux. Liste partagée par toute
// l'agence, dans le blob __app_state__, clé `mailIgnoredSenders` :
//   { "adresse@en-minuscules.com": ajoutée le (ms) }
// (objet et non liste : app_state_merge ajoute ou retire une adresse sous verrou, deux
// postes qui cliquent en même temps ne s'effacent pas). Logique PURE, testée par
// mailIgnore.test.ts, utilisée par l'app (src/lib/mailIgnored.ts) et par gmail-poll.
// ============================================================================

export const IGNORED_SENDERS_KEY = "mailIgnoredSenders";
/** Au-delà, les plus anciennes adresses sont oubliées. */
export const IGNORED_SENDERS_MAX = 300;

/** Adresse en minuscules → date d'ajout (ms). */
export type IgnoredSenders = Record<string, number>;

const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;

/** Adresse seule, en minuscules (« Nom <A@B.com> » → « a@b.com ») ; "" si ce n'est pas une adresse. */
export function senderAddress(from: string): string {
  const raw = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  return EMAIL_RE.test(raw) ? raw : "";
}

/** Lecture tolérante de la clé du blob (objet attendu ; une ancienne liste d'adresses passe aussi). */
export function readIgnoredSenders(v: unknown): IgnoredSenders {
  const out: IgnoredSenders = {};
  if (Array.isArray(v)) {
    for (const x of v) {
      const a = typeof x === "string" ? senderAddress(x) : "";
      if (a) out[a] = 0;
    }
    return out;
  }
  if (!v || typeof v !== "object") return out;
  for (const [k, at] of Object.entries(v as Record<string, unknown>)) {
    const a = senderAddress(k);
    if (a) out[a] = typeof at === "number" && Number.isFinite(at) ? at : 0;
  }
  return out;
}

/** Vrai si l'expéditeur est dans la liste « Pas à traiter ». */
export function isIgnoredSender(from: string, ignored: IgnoredSenders): boolean {
  const a = senderAddress(from);
  return !!a && Object.prototype.hasOwnProperty.call(ignored, a);
}

/**
 * Ajout d'une adresse : ce qu'il faut écrire (`set`) et oublier (`remove`, les plus
 * anciennes au-delà de `max`). null si l'adresse est invalide ou déjà retenue.
 */
export function addIgnoredSender(
  cur: IgnoredSenders,
  from: string,
  now: number,
  max = IGNORED_SENDERS_MAX,
): { email: string; set: IgnoredSenders; remove: string[] } | null {
  const email = senderAddress(from);
  if (!email || Object.prototype.hasOwnProperty.call(cur, email)) return null;
  const keep = Math.max(0, max - 1);
  const remove = Object.entries(cur)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(keep)
    .map(([k]) => k);
  return { email, set: { [email]: now }, remove };
}

/** Applique un changement à la liste (sans la modifier). */
export function applyIgnoredChange(cur: IgnoredSenders, set: IgnoredSenders, remove: string[]): IgnoredSenders {
  const out = { ...cur };
  for (const k of remove) delete out[k];
  return { ...out, ...set };
}

/** Adresses retenues, les plus récentes d'abord (liste des réglages). */
export function ignoredList(cur: IgnoredSenders): { email: string; at: number }[] {
  return Object.entries(cur)
    .map(([email, at]) => ({ email, at }))
    .sort((a, b) => b.at - a.at || a.email.localeCompare(b.email));
}

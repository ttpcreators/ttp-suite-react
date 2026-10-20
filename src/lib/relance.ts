import { formatEuro, parseAmount } from "./money";

/**
 * Relances de factures impayées : règles PURES partagées par la page Relances,
 * « Aujourd'hui » et la palette ⌘K (aucune dépendance React ni Supabase, testable).
 *   - une facture est en retard si son statut est « retard », ou « En attente » dont
 *     l'échéance (`invoices.date`) est passée (même règle que Facturation) ;
 *   - l'email de relance monte de ton selon le nombre de relances déjà envoyées ;
 *   - le suivi des relances vit dans le blob agence `invoiceReminders`.
 */

export type RelanceInvoice = { id: string; ref: string; party: string; amount: string; date: string | null; status: string; creator: string | null };
export type Reminder = { last: string; count: number };
export type Reminders = Record<string, Reminder>;

/** Échéance texte (ISO ou jj/mm[/aaaa]) → Date locale, ou null. */
export function parseDueDate(s: string | null): Date | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s.trim());
  if (dm) {
    let y = dm[3] ?? String(new Date().getFullYear());
    if (y.length === 2) y = "20" + y;
    return new Date(Number(y), Number(dm[2]) - 1, Number(dm[1]));
  }
  return null;
}

/** Jours écoulés depuis `d` (date locale, à minuit). */
export function daysSinceDue(d: Date, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}

/** Facture à relancer : « retard », ou « attente » dont l'échéance est passée. */
export function isOverdueInvoice(iv: { status: string; date: string | null }, now: Date = new Date()): boolean {
  if (iv.status === "retard") return true;
  if (iv.status !== "attente") return false;
  const d = parseDueDate(iv.date);
  return d ? daysSinceDue(d, now) > 0 : false;
}

/** Factures en retard + jours de retard, de la plus ancienne à la plus récente. */
export function overdueInvoices<T extends RelanceInvoice>(invoices: T[], now: Date = new Date()): { iv: T; late: number | null }[] {
  return invoices
    .filter((iv) => isOverdueInvoice(iv, now))
    .map((iv) => {
      const d = parseDueDate(iv.date);
      return { iv, late: d ? Math.max(0, daysSinceDue(d, now)) : null };
    })
    .sort((a, b) => (b.late ?? 0) - (a.late ?? 0));
}

/** Email de relance, ton qui s'adapte au nombre de relances déjà envoyées. */
export function relanceEmail(inv: Pick<RelanceInvoice, "ref" | "party" | "amount">, count: number): { subject: string; body: string } {
  const montant = formatEuro(parseAmount(inv.amount));
  const subject = `Relance : facture ${inv.ref} · ${montant}`;
  const opener =
    count <= 0
      ? "Je me permets de revenir vers vous concernant le règlement de"
      : count === 1
        ? "Sauf erreur de notre part, nous n'avons pas encore reçu le règlement de"
        : "Malgré nos précédentes relances, la facture suivante demeure impayée :";
  const closing =
    count <= 1
      ? "Pourriez-vous nous indiquer la date de règlement prévue ? Si le paiement a déjà été effectué, merci de ne pas tenir compte de ce message."
      : "Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais, ou de nous communiquer une date précise.";
  const body = `Bonjour,

${opener} la facture ${inv.ref}${inv.party ? ` (${inv.party})` : ""} d'un montant de ${montant}.

${closing}

Bien cordialement,
TTP Creators
partnerships@ttpcreators.pro`;
  return { subject, body };
}

/** Lien mailto prêt à ouvrir (destinataire = email client saisi sur la facture, si connu). */
export function relanceMailto(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

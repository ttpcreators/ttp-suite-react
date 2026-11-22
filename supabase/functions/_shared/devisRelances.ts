// ============================================================================
// _shared/devisRelances.ts : relances des devis envoyés (stratégie du 20/11/2026, closing :
// « devis envoyé le jour même ; on relance à J+2, J+5 et J+10 avec une date limite »).
// Lu par l'outil MCP `devis_a_relancer` (Alfred prépare les relances, Marc valide).
// Règles PURES, testées par devisRelances.test.ts.
// ============================================================================

export const RELANCES_DEVIS = [2, 5, 10];

export type DevisIn = { id?: unknown; ref?: unknown; brand?: unknown; creator?: unknown; status?: unknown; sentAt?: unknown; issueDate?: unknown; createdAt?: unknown; dueDate?: unknown; clientEmail?: unknown };
export type DevisARelancer = { ref: string; marque: string; createur: string; email: string; envoyeLe: string; relance: string; jours: number; dateLimite: string; expire: boolean };

const jour = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : "");
const ecart = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);

/**
 * Devis « envoyé » dont une relance est due aujourd'hui ou en retard (la dernière relance
 * passée, une seule ligne par devis). La date d'envoi est `sentAt`, sinon la date du devis.
 * Après J+10 sans réponse, le devis sort de la liste (on attend le prochain temps fort).
 */
export function devisARelancer(quotes: readonly DevisIn[], aujourdhui: string): DevisARelancer[] {
  const out: DevisARelancer[] = [];
  for (const q of quotes) {
    if (String(q.status ?? "") !== "envoye") continue;
    const envoye = jour(q.sentAt) || jour(q.issueDate) || jour(q.createdAt);
    if (!envoye) continue;
    const j = ecart(envoye, aujourdhui);
    const due = [...RELANCES_DEVIS].reverse().find((r) => j >= r && j < r + 3);
    if (due === undefined) continue;
    const limite = jour(q.dueDate);
    out.push({
      ref: String(q.ref ?? ""), marque: String(q.brand ?? ""), createur: String(q.creator ?? ""), email: String(q.clientEmail ?? ""),
      envoyeLe: envoye, relance: `J+${due}`, jours: j, dateLimite: limite, expire: !!limite && limite < aujourdhui,
    });
  }
  return out.sort((a, b) => b.jours - a.jours);
}

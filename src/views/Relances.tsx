import { useEffect, useMemo, useState } from "react";
import { Copy, Mail, BellRing, Check } from "lucide-react";
import { useAppState, parseAmount, formatEuro, type AppState } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { overdueInvoices, parseDueDate, relanceEmail, relanceMailto, type RelanceInvoice, type Reminders } from "@/lib/relance";
import { recordReminder, useRelanceInvoices } from "@/lib/useRelanceInvoices";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";

/**
 * Relances de factures impayées : liste des factures « en retard » (+ « en attente »
 * dont l'échéance est passée), avec un email de relance pré-rédigé (ton qui monte
 * selon le nombre de relances) et le suivi de la dernière relance (blob `invoiceReminders`).
 * Règles et email partagés avec « Aujourd'hui » et la palette ⌘K : lib/relance.ts.
 */

type Inv = RelanceInvoice;

function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function Relances() {
  const { invoices, error } = useRelanceInvoices();
  const { data: app } = useAppState<AppState>();
  const [localRem, setLocalRem] = useState<Reminders | null>(null);
  const reminders: Reminders = localRem ?? ((app?.invoiceReminders as Reminders) ?? {});
  // Le blob live a changé (autre poste, realtime) : il redevient la source de vérité
  const liveRem = app?.invoiceReminders;
  useEffect(() => {
    setLocalRem(null);
  }, [liveRem]);

  const overdue = useMemo(() => (invoices ? overdueInvoices(invoices) : []), [invoices]);

  const totalDue = overdue.reduce((s, o) => s + parseAmount(o.iv.amount), 0);

  const markReminded = async (id: string) => {
    const next = await recordReminder(id);
    // Copie locale appliquée SEULEMENT après écriture réussie : pas de relance affichée si non enregistrée
    if (!next) {
      toast("Erreur, relance non enregistrée. Réessaie");
      return;
    }
    setLocalRem(next);
    toast("Relance enregistrée ✓");
  };

  const copyEmail = async (inv: Inv) => {
    const { subject, body } = relanceEmail(inv, reminders[inv.id]?.count ?? 0);
    try {
      await navigator.clipboard.writeText(`Objet : ${subject}\n\n${body}`);
      toast("Email de relance copié ✓");
    } catch {
      toast("Copie impossible — réessaie");
    }
  };

  const openMail = (inv: Inv) => {
    const { subject, body } = relanceEmail(inv, reminders[inv.id]?.count ?? 0);
    // Destinataire = email client saisi sur la facture (blob invoiceDetails), si connu
    const details = (app?.invoiceDetails as Record<string, { clientEmail?: string }> | undefined) ?? {};
    window.location.href = relanceMailto(details[inv.id]?.clientEmail ?? "", subject, body);
  };

  // Erreur affichée seulement s'il n'y a rien à montrer (sinon on garde les données en place)
  if (error && !invoices)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
        Impossible de charger les factures.
      </div>
    );
  if (!invoices)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
        <div className="min-w-0 bg-surface px-5 py-5">
          <div className="text-[13px] text-muted-foreground">Total en retard</div>
          <div className="mt-2 truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums text-dangertext">{formatEuro(totalDue)}</div>
        </div>
        <div className="min-w-0 bg-surface px-5 py-5">
          <div className="text-[13px] text-muted-foreground">Factures à relancer</div>
          <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{overdue.length}</div>
        </div>
      </div>

      {overdue.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-sm">
          Aucune facture en retard 🎉 Tout est encaissé ou dans les délais.
        </div>
      ) : (
        <div className="space-y-3">
          {overdue.map(({ iv, late }) => {
            const rem = reminders[iv.id];
            return (
              <div key={iv.id} className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Réf. toujours sur sa propre ligne sous le titre : mise en page identique quelle que soit la longueur du nom */}
                    <div className="truncate text-sm font-semibold text-foreground">{iv.party || "—"}</div>
                    <div className="mt-1">
                      <span className="inline-block rounded-full bg-rowhover px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">#{iv.ref}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end text-right">
                    <div className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">{formatEuro(parseAmount(iv.amount))}</div>
                    {late != null && late > 0 && (
                      <div className="mt-0.5 whitespace-nowrap rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-dangertext">En retard de {late} j</div>
                    )}
                  </div>
                </div>
                {/* Méta (créateur · échéance) hors de la ligne flex : pleine largeur, jamais comprimée par le montant */}
                <div className="mt-1.5 text-[11px] text-faint">
                  <span className="whitespace-nowrap">{iv.creator ? titleCase(iv.creator) : "Agence"}</span>
                  {iv.date ? (
                    <span className="whitespace-nowrap">
                      {" · échéance "}
                      {(() => {
                        const d = parseDueDate(iv.date);
                        return d ? frDate(d) : iv.date;
                      })()}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => copyEmail(iv)} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Copy className="h-3.5 w-3.5" /> Copier l'email
                  </button>
                  <button type="button" onClick={() => openMail(iv)} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Mail className="h-3.5 w-3.5" /> Ouvrir le mail
                  </button>
                  <button type="button" onClick={() => markReminded(iv.id)} className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                    <BellRing className="h-3.5 w-3.5" /> Marquer relancé
                  </button>
                  {rem ? (
                    <span className="flex items-center gap-1 text-[11px] text-faint">
                      <Check className="h-3.5 w-3.5 text-signaltext" /> Relancé le {frDate(parseDueDate(rem.last) ?? new Date())} · {rem.count}×
                    </span>
                  ) : (
                    <span className="text-[11px] text-faint">Jamais relancé</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

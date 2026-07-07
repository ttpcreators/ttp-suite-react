import { useEffect, useMemo, useState } from "react";
import { Copy, Mail, BellRing, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, parseAmount, formatEuro, type AppState } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";

/**
 * Relances de factures impayées : liste des factures « en retard » (+ « en attente »
 * dont l'échéance est passée), avec un email de relance pré-rédigé (ton qui monte
 * selon le nombre de relances) et le suivi de la dernière relance (blob `invoiceReminders`).
 */

type Inv = { id: string; ref: string; party: string; amount: string; date: string | null; status: string; creator: string | null };
type Reminder = { last: string; count: number };
type Reminders = Record<string, Reminder>;

const todayISO = () => new Date().toISOString().slice(0, 10);

function parseDate(s: string | null): Date | null {
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
function daysSince(d: Date): number {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}
function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Email de relance, ton qui s'adapte au nombre de relances déjà envoyées. */
function relanceEmail(inv: Inv, count: number): { subject: string; body: string } {
  const montant = formatEuro(parseAmount(inv.amount));
  const subject = `Relance — Facture ${inv.ref} · ${montant}`;
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

export function Relances() {
  const [invoices, setInvoices] = useState<Inv[] | null>(() => getCache<Inv[]>("relanceInvoices"));
  const [error, setError] = useState(false);
  const live = useLiveKey();
  const { data: app } = useAppState<AppState>();
  const [localRem, setLocalRem] = useState<Reminders | null>(null);
  const reminders: Reminders = localRem ?? ((app?.invoiceReminders as Reminders) ?? {});

  useEffect(() => {
    let alive = true;
    supabase
      .from("invoices")
      .select("id,ref,party,amount,date,status,creator")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setError(true);
          return;
        }
        const next = (data as Inv[]) ?? [];
        setCache("relanceInvoices", next);
        setInvoices(next);
      });
    return () => {
      alive = false;
    };
  }, [live]);

  const overdue = useMemo(() => {
    if (!invoices) return [];
    const out = invoices
      .filter((iv) => {
        if (iv.status === "retard") return true;
        // "en attente" dont l'échéance est dépassée
        if (iv.status === "attente") {
          const d = parseDate(iv.date);
          return d ? daysSince(d) > 0 : false;
        }
        return false;
      })
      .map((iv) => {
        const d = parseDate(iv.date);
        return { iv, late: d ? Math.max(0, daysSince(d)) : null };
      });
    return out.sort((a, b) => (b.late ?? 0) - (a.late ?? 0));
  }, [invoices]);

  const totalDue = overdue.reduce((s, o) => s + parseAmount(o.iv.amount), 0);

  const saveReminders = async (next: Reminders) => {
    setLocalRem(next);
    const ok = await saveAppStateKey("invoiceReminders", next);
    if (!ok) toast("Erreur — réessaie");
  };

  const markReminded = async (id: string) => {
    // Relecture fraîche : ne pas écraser les compteurs de relance d'autres factures.
    invalidateAppState();
    const fresh = ((await getAppState())["invoiceReminders"] as Reminders) ?? {};
    const cur = fresh[id];
    const next: Reminders = { ...fresh, [id]: { last: todayISO(), count: (cur?.count ?? 0) + 1 } };
    await saveReminders(next);
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
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  if (error)
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Total impayé</div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-rose-500">{formatEuro(totalDue)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Factures à relancer</div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-foreground">{overdue.length}</div>
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{iv.party || "—"}</span>
                      <span className="rounded-md bg-rowhover px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">#{iv.ref}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      {iv.creator ? titleCase(iv.creator) : "Agence"}
                      {iv.date ? ` · échéance ${iv.date}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">{formatEuro(parseAmount(iv.amount))}</div>
                    {late != null && late > 0 && (
                      <div className="mt-0.5 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">En retard de {late} j</div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => copyEmail(iv)} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Copy className="h-3.5 w-3.5" /> Copier l'email
                  </button>
                  <button type="button" onClick={() => openMail(iv)} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Mail className="h-3.5 w-3.5" /> Ouvrir le mail
                  </button>
                  <button type="button" onClick={() => markReminded(iv.id)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                    <BellRing className="h-3.5 w-3.5" /> Marquer relancé
                  </button>
                  {rem ? (
                    <span className="flex items-center gap-1 text-[11px] text-faint">
                      <Check className="h-3.5 w-3.5 text-signaltext" /> Relancé le {frDate(parseDate(rem.last) ?? new Date())} · {rem.count}×
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

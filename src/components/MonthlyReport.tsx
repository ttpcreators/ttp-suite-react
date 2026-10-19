import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, FileBarChart, Handshake, HeartHandshake, TrendingUp, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { formatEuro } from "@/lib/money";
import { fmtCompact } from "@/lib/timeSeries";
import { printHtml } from "@/lib/printPdf";
import { docTitle, esc, pdfKpis, pdfMeta, pdfSection, pdfShell, pdfTicks } from "@/lib/pdfDoc";
import { buildMonthlyReport, currentMonth, shiftMonth, type MonthlyReport as Report, type ReportData } from "@/lib/monthlyReport";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

/**
 * Rapport mensuel d'un créateur (espace créateur + fiche créateur côté agence) :
 * ses gains, ses collabs, l'évolution de ses chiffres et ce que l'agence lui a
 * apporté, avec export PDF. Données : fonction serveur `creator-report`.
 */
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtCompact(Math.abs(n))}`;
const pct = (n: number | null) => (n == null ? "" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1).replace(".", ",")} %`);

function collabLines(r: Report): string[] {
  return [
    ...r.newCollabs.map((c) => `Nouvelle collab : ${c.brand}${c.cachet ? ` (${c.cachet})` : ""}`),
    ...r.published.map((c) => `Publiée : ${c.brand}${c.deliverables ? ` · ${c.deliverables}` : ""}`),
  ];
}
function statLines(r: Report): string[] {
  return [
    ...r.stats.map((s) => `${s.label} : ${fmtCompact(s.start)} → ${fmtCompact(s.end)} abonnés (${signed(s.delta)}${s.pct != null ? `, ${pct(s.pct)}` : ""})`),
    ...(r.reach ? [`Instagram, 28 derniers jours : ${fmtCompact(r.reach.reach)} personnes touchées${r.reach.views ? `, ${fmtCompact(r.reach.views)} vues` : ""}`] : []),
    ...(r.engagement ? [`Taux d'engagement ${r.engagement.label} : ${r.engagement.er}${r.engagement.prev ? ` (le mois d'avant : ${r.engagement.prev})` : ""}`] : []),
  ];
}

/** PDF du rapport (même identité que le brief et le bilan). */
function monthlyReportPdf(r: Report, name: string): string {
  const e = r.earnings;
  const money =
    `<div class="money"><span><span class="k">Facturé</span><b>${esc(formatEuro(e.billed))}</b></span>` +
    `<span class="arrow">→</span><span><span class="k">Ta part</span><b>${esc(formatEuro(e.share))}</b></span>` +
    `<span class="roi"><span class="k">Depuis janvier</span><b>${esc(formatEuro(e.yearShare))}</b></span></div>`;
  const body =
    money +
    pdfMeta([
      ["Commission agence", e.billed ? `${e.rate} %` : ""],
      ["Déjà encaissé", e.cashed ? formatEuro(e.cashed) : ""],
      ["En attente de paiement", e.pending ? formatEuro(e.pending) : ""],
      ["Versé sur ton compte ce mois", e.paidOut ? formatEuro(e.paidOut) : ""],
    ]) +
    (collabLines(r).length || r.ongoing ? pdfSection("Tes collabs", pdfKpis([
      { l: "Nouvelles", v: String(r.newCollabs.length) },
      { l: "Publiées", v: String(r.published.length) },
      { l: "En cours", v: String(r.ongoing) },
    ]) + (collabLines(r).length ? `<div style="margin-top:7mm">${pdfTicks(collabLines(r))}</div>` : "")) : "") +
    (statLines(r).length ? pdfSection("Tes chiffres", pdfTicks(statLines(r))) : "") +
    (r.agency.length ? pdfSection("Ce que l'agence t'a apporté", pdfTicks(r.agency)) : "");
  return pdfShell({
    title: `Rapport ${r.label} ${titleCase(name)}`,
    eyebrow: "Rapport mensuel",
    heading: docTitle(cap(r.label), titleCase(name)),
    sub: r.inProgress ? "Mois en cours : les chiffres continuent d'arriver." : undefined,
    body,
  });
}

function Block({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" /> {title}
      </div>
      {children}
    </div>
  );
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: "good" | "muted" }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2.5">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-[16px] font-semibold tabular-nums tracking-tight", tone === "good" ? "text-signaltext" : tone === "muted" ? "text-faint" : "text-foreground")}>{value}</div>
    </div>
  );
}

export function MonthlyReport({ name, agencyView = false }: { name: string; agencyView?: boolean }) {
  const [month, setMonth] = useState(() => currentMonth());
  const [data, setData] = useState<ReportData | null>(null);
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(false);
    supabase.functions
      .invoke("creator-report", { body: { creator: name } })
      .then(({ data: d, error }) => {
        if (!alive) return;
        if (error || !d) return setErr(true);
        setData(d as ReportData);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [name, retry]);

  const r = useMemo(() => (data ? buildMonthlyReport(data, month) : null), [data, month]);
  const isNow = month === currentMonth();
  const e = r?.earnings;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileBarChart className="h-4 w-4 text-muted-foreground" /> Rapport du mois
          </div>
          {agencyView && <div className="mt-0.5 text-[11px] text-faint">Ce que {titleCase(name)} voit dans son espace</div>}
        </div>
        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <button type="button" aria-label="Mois précédent" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 whitespace-nowrap text-center text-[13px] font-semibold text-foreground sm:min-w-[118px] sm:flex-none">{cap(r?.label ?? month)}{isNow && <span className="ml-1 font-normal text-faint">(en cours)</span>}</span>
          <button type="button" aria-label="Mois suivant" disabled={isNow} onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" disabled={!r || r.empty} onClick={() => r && printHtml(monthlyReportPdf(r, data?.creator.name || name))}
            className="ml-1 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center">
          <div className="text-[13px] font-medium text-foreground">Le rapport n'a pas pu être chargé</div>
          <button type="button" onClick={() => setRetry((n) => n + 1)}
            className="mt-3 rounded-full border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            Réessayer
          </button>
        </div>
      ) : !r || !e ? (
        <AnimatedBadge status="loading" size="sm">Chargement du rapport…</AnimatedBadge>
      ) : r.empty ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
          Rien d'enregistré pour {r.label}.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Block icon={Wallet} title="Gains">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">Ta part, après commission</div>
                <div className="text-[28px] font-semibold leading-tight tabular-nums tracking-tight text-foreground">{formatEuro(e.share)}</div>
                <div className="text-[11px] text-faint">{e.billed ? `sur ${formatEuro(e.billed)} facturés · commission ${e.rate} %` : "aucune facture émise ce mois-ci"}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="Encaissé" value={formatEuro(e.cashed)} tone={e.cashed ? "good" : "muted"} />
              <Mini label="En attente" value={formatEuro(e.pending)} tone={e.pending ? undefined : "muted"} />
              <Mini label="Versé ce mois" value={formatEuro(e.paidOut)} tone={e.paidOut ? "good" : "muted"} />
              <Mini label="Depuis janvier" value={formatEuro(e.yearShare)} />
            </div>
            {r.invoices.length > 0 && (
              <ul className="mt-3 divide-y divide-border">
                {r.invoices.map((i, k) => (
                  <li key={k} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate text-foreground">{i.party || i.ref}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", i.status === "payee" ? "bg-signalsoft text-signaltext" : "bg-foreground/[0.06] text-muted-foreground")}>
                        {i.status === "payee" ? "Payée" : "En attente"}
                      </span>
                      <span className="tabular-nums font-medium text-foreground">{formatEuro(i.share)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block icon={Handshake} title="Collabs">
            <div className="grid grid-cols-3 gap-2">
              <Mini label="Nouvelles" value={String(r.newCollabs.length)} tone={r.newCollabs.length ? undefined : "muted"} />
              <Mini label="Publiées" value={String(r.published.length)} tone={r.published.length ? undefined : "muted"} />
              <Mini label="En cours" value={String(r.ongoing)} tone={r.ongoing ? undefined : "muted"} />
            </div>
            {collabLines(r).length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {collabLines(r).map((l, k) => <li key={k} className="text-[12.5px] text-muted-foreground">{l}</li>)}
              </ul>
            )}
          </Block>

          {(r.stats.length > 0 || r.reach || r.engagement) && (
            <Block icon={TrendingUp} title="Chiffres">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {r.stats.map((s) => (
                  <div key={s.label} className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Abonnés {s.label}</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-[16px] font-semibold tabular-nums tracking-tight text-foreground">{fmtCompact(s.end)}</span>
                      <span className={cn("text-[11.5px] font-semibold tabular-nums", s.delta > 0 ? "text-signaltext" : s.delta < 0 ? "text-amber" : "text-faint")}>
                        {signed(s.delta)}{s.pct != null && ` (${pct(s.pct)})`}
                      </span>
                    </div>
                  </div>
                ))}
                {r.reach && (
                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Instagram, 28 derniers jours</div>
                    <div className="mt-0.5 text-[16px] font-semibold tabular-nums tracking-tight text-foreground">
                      {fmtCompact(r.reach.reach)} <span className="text-[11.5px] font-normal text-muted-foreground">personnes touchées</span>
                    </div>
                  </div>
                )}
                {r.engagement && (
                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Engagement {r.engagement.label}</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-[16px] font-semibold tabular-nums tracking-tight text-foreground">{r.engagement.er}</span>
                      {r.engagement.prev && <span className="text-[11.5px] text-faint">avant : {r.engagement.prev}</span>}
                    </div>
                  </div>
                )}
              </div>
            </Block>
          )}

          {r.agency.length > 0 && (
            <Block icon={HeartHandshake} title="Ce que l'agence t'a apporté">
              <ul className="space-y-1.5">
                {r.agency.map((a, k) => (
                  <li key={k} className="flex items-start gap-2 text-[13px] text-foreground">
                    <span className="mt-0.5 shrink-0 font-bold text-signaltext">✓</span>
                    <span className="flex-1">{a}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      )}
    </section>
  );
}

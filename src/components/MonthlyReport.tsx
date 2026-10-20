import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, FileBarChart, Handshake, HeartHandshake, TrendingUp, Wallet } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { formatEuro } from "@/lib/money";
import { fmtCompact } from "@/lib/timeSeries";
import { printHtml } from "@/lib/printPdf";
import { docTitle, esc, pdfKpis, pdfMeta, pdfSection, pdfShell, pdfTicks } from "@/lib/pdfDoc";
import { buildMonthlyReport, currentMonth, shiftMonth, type MonthlyReport as Report, type ReportData } from "@/lib/monthlyReport";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLang, useT, type Lang, type Vars } from "@/lib/i18n";

/**
 * Rapport mensuel d'un créateur (espace créateur + fiche créateur côté agence) :
 * ses gains, ses collabs, l'évolution de ses chiffres et ce que l'agence lui a
 * apporté, avec export PDF. Données : fonction serveur `creator-report`.
 */
type T = (fr: string, vars?: Vars) => string;
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtCompact(Math.abs(n))}`;
const pct = (n: number | null, lang: Lang) => {
  if (n == null) return "";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const v = Math.abs(n).toFixed(1);
  return lang === "en" ? `${sign}${v}%` : `${sign}${v.replace(".", ",")} %`;
};

function collabLines(r: Report, t: T): string[] {
  return [
    ...r.newCollabs.map((c) => t("Nouvelle collab : {brand}", { brand: c.brand }) + (c.cachet ? ` (${c.cachet})` : "")),
    ...r.published.map((c) => t("Publiée : {brand}", { brand: c.brand }) + (c.deliverables ? ` · ${c.deliverables}` : "")),
  ];
}
function statLines(r: Report, t: T, lang: Lang): string[] {
  return [
    ...r.stats.map((s) => t("{platform} : {start} → {end} abonnés", { platform: s.label, start: fmtCompact(s.start), end: fmtCompact(s.end) }) + ` (${signed(s.delta)}${s.pct != null ? `, ${pct(s.pct, lang)}` : ""})`),
    ...(r.reach ? [t("Instagram, 28 derniers jours : {n} personnes touchées", { n: fmtCompact(r.reach.reach) }) + (r.reach.views ? t(", {n} vues", { n: fmtCompact(r.reach.views) }) : "")] : []),
    ...(r.engagement ? [t("Taux d'engagement {platform} : {er}", { platform: r.engagement.label, er: r.engagement.er }) + (r.engagement.prev ? t(" (le mois d'avant : {er})", { er: r.engagement.prev }) : "")] : []),
  ];
}

/** PDF du rapport (même identité que le brief et le bilan). */
function monthlyReportPdf(r: Report, name: string, t: T, lang: Lang): string {
  const e = r.earnings;
  const collabs = collabLines(r, t);
  const stats = statLines(r, t, lang);
  const money =
    `<div class="money"><span><span class="k">${esc(t("Facturé"))}</span><b>${esc(formatEuro(e.billed))}</b></span>` +
    `<span class="arrow">→</span><span><span class="k">${esc(t("Ta part"))}</span><b>${esc(formatEuro(e.share))}</b></span>` +
    `<span class="roi"><span class="k">${esc(t("Depuis janvier"))}</span><b>${esc(formatEuro(e.yearShare))}</b></span></div>`;
  const body =
    money +
    pdfMeta([
      [t("Commission agence"), e.billed ? (lang === "en" ? `${e.rate}%` : `${e.rate} %`) : ""],
      [t("Déjà encaissé"), e.cashed ? formatEuro(e.cashed) : ""],
      [t("En attente de paiement"), e.pending ? formatEuro(e.pending) : ""],
      [t("Versé sur ton compte ce mois"), e.paidOut ? formatEuro(e.paidOut) : ""],
    ]) +
    (collabs.length || r.ongoing ? pdfSection(t("Tes collabs"), pdfKpis([
      { l: t("Nouvelles"), v: String(r.newCollabs.length) },
      { l: t("Publiées"), v: String(r.published.length) },
      { l: t("En cours"), v: String(r.ongoing) },
    ]) + (collabs.length ? `<div style="margin-top:7mm">${pdfTicks(collabs)}</div>` : "")) : "") +
    (stats.length ? pdfSection(t("Tes chiffres"), pdfTicks(stats)) : "") +
    (r.agency.length ? pdfSection(t("Ce que l'agence t'a apporté"), pdfTicks(r.agency)) : "");
  return pdfShell({
    title: t("Rapport {month} {name}", { month: r.label, name: titleCase(name) }),
    eyebrow: t("Rapport mensuel"),
    heading: docTitle(cap(r.label), titleCase(name)),
    sub: r.inProgress ? t("Mois en cours : les chiffres continuent d'arriver.") : undefined,
    body,
    lang,
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
  const t = useT();
  const lang = useLang();
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

  const r = useMemo(() => (data ? buildMonthlyReport(data, month, new Date(), lang) : null), [data, month, lang]);
  const isNow = month === currentMonth();
  const e = r?.earnings;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Côté créateur, le titre de la page suffit : on garde seulement le choix du mois. */}
        {agencyView && (
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileBarChart className="h-4 w-4 text-muted-foreground" /> {t("Rapport du mois")}
            </div>
            <div className="mt-0.5 text-[11px] text-faint">{t("Ce que {name} voit dans son espace", { name: titleCase(name) })}</div>
          </div>
        )}
        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <button type="button" aria-label={t("Mois précédent")} onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 whitespace-nowrap text-center text-[13px] font-semibold text-foreground sm:min-w-[118px] sm:flex-none">{cap(r?.label ?? month)}{isNow && <span className="ml-1 font-normal text-faint">{t("(en cours)")}</span>}</span>
          <button type="button" aria-label={t("Mois suivant")} disabled={isNow} onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" disabled={!r || r.empty} onClick={() => r && printHtml(monthlyReportPdf(r, data?.creator.name || name, t, lang))}
            className="ml-1 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center">
          <div className="text-[13px] font-medium text-foreground">{t("Le rapport n'a pas pu être chargé")}</div>
          <button type="button" onClick={() => setRetry((n) => n + 1)}
            className="mt-3 rounded-full border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            {t("Réessayer")}
          </button>
        </div>
      ) : !r || !e ? (
        <AnimatedBadge status="loading" size="sm">{t("Chargement du rapport…")}</AnimatedBadge>
      ) : r.empty ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
          {t("Rien d'enregistré pour {month}.", { month: r.label })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data?.money !== false && <Block icon={Wallet} title={t("Gains")}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">{t("Ta part, après commission")}</div>
                <div className="text-[28px] font-semibold leading-tight tabular-nums tracking-tight text-foreground">{formatEuro(e.share)}</div>
                <div className="text-[11px] text-faint">{e.billed ? t("sur {amount} facturés · commission {rate} %", { amount: formatEuro(e.billed), rate: e.rate }) : t("aucune facture émise ce mois-ci")}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label={t("Encaissé")} value={formatEuro(e.cashed)} tone={e.cashed ? "good" : "muted"} />
              <Mini label={t("En attente")} value={formatEuro(e.pending)} tone={e.pending ? undefined : "muted"} />
              <Mini label={t("Versé ce mois")} value={formatEuro(e.paidOut)} tone={e.paidOut ? "good" : "muted"} />
              <Mini label={t("Depuis janvier")} value={formatEuro(e.yearShare)} />
            </div>
            {r.invoices.length > 0 && (
              <ul className="mt-3 divide-y divide-border">
                {r.invoices.map((i, k) => (
                  <li key={k} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate text-foreground">{i.party || i.ref}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", i.status === "payee" ? "bg-signalsoft text-signaltext" : "bg-foreground/[0.06] text-muted-foreground")}>
                        {i.status === "payee" ? t("Payée") : t("En attente")}
                      </span>
                      <span className="tabular-nums font-medium text-foreground">{formatEuro(i.share)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>}

          <Block icon={Handshake} title={t("Collabs")}>
            <div className="grid grid-cols-3 gap-2">
              <Mini label={t("Nouvelles")} value={String(r.newCollabs.length)} tone={r.newCollabs.length ? undefined : "muted"} />
              <Mini label={t("Publiées")} value={String(r.published.length)} tone={r.published.length ? undefined : "muted"} />
              <Mini label={t("En cours")} value={String(r.ongoing)} tone={r.ongoing ? undefined : "muted"} />
            </div>
            {collabLines(r, t).length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {collabLines(r, t).map((l, k) => <li key={k} className="text-[12.5px] text-muted-foreground">{l}</li>)}
              </ul>
            )}
          </Block>

          {(r.stats.length > 0 || r.reach || r.engagement) && (
            <Block icon={TrendingUp} title={t("Chiffres")}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {r.stats.map((s) => (
                  <div key={s.label} className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">{t("Abonnés {platform}", { platform: s.label })}</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-[16px] font-semibold tabular-nums tracking-tight text-foreground">{fmtCompact(s.end)}</span>
                      <span className={cn("text-[11.5px] font-semibold tabular-nums", s.delta > 0 ? "text-signaltext" : s.delta < 0 ? "text-amber" : "text-faint")}>
                        {signed(s.delta)}{s.pct != null && ` (${pct(s.pct, lang)})`}
                      </span>
                    </div>
                  </div>
                ))}
                {r.reach && (
                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">{t("Instagram, 28 derniers jours")}</div>
                    <div className="mt-0.5 text-[16px] font-semibold tabular-nums tracking-tight text-foreground">
                      {fmtCompact(r.reach.reach)} <span className="text-[11.5px] font-normal text-muted-foreground">{t("personnes touchées")}</span>
                    </div>
                  </div>
                )}
                {r.engagement && (
                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">{t("Engagement {platform}", { platform: r.engagement.label })}</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-[16px] font-semibold tabular-nums tracking-tight text-foreground">{r.engagement.er}</span>
                      {r.engagement.prev && <span className="text-[11.5px] text-faint">{t("avant : {er}", { er: r.engagement.prev })}</span>}
                    </div>
                  </div>
                )}
              </div>
            </Block>
          )}

          {r.agency.length > 0 && (
            <Block icon={HeartHandshake} title={t("Ce que l'agence t'a apporté")}>
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

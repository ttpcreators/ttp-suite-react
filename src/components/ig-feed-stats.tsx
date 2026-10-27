/**
 * « Mes stats » : le feed Instagram d'un créateur, ce qui marche, ses chiffres des 28
 * derniers jours et son audience. Données : colonne `creators.ig` écrite chaque jour par
 * ig-sync (feed des 12 derniers posts, images copiées dans le bucket public `avatars`).
 * Sert dans l'espace créateur (onglet « Mes stats ») et dans la fiche créateur de l'agence
 * (sans la rangée de chiffres, déjà dans la carte Instagram).
 */
import { useMemo, type ReactNode } from "react";
import { Heart, Layers, Play } from "@/components/icons";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { Spin } from "@/components/ui/loader";
import { supabase } from "@/lib/supabase";
import { useLocale, useT } from "@/lib/i18n";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { followersDelta, type IgCreator, type IgSplit } from "@/lib/instagram";
import { engagement28, rankFeed, ratioLabel, readFeed, type FeedPost, type RankedPost } from "@/lib/igFeed";

const thumbUrl = (path?: string) => (path ? supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl : "");
const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")} %`;

/** Chiffre principal d'un post : ses vues si connues, sinon ses likes (ou commentaires si likes masqués). */
function mainMetric(p: FeedPost, byViews: boolean): { icon: "play" | "heart"; value: number } {
  if (byViews && typeof p.views === "number") return { icon: "play", value: p.views };
  return { icon: "heart", value: p.likes ?? p.comments };
}

function Thumb({ post, className }: { post: FeedPost; className?: string }) {
  const src = thumbUrl(post.thumb);
  return src ? (
    <img src={src} alt="" loading="lazy" className={cn("h-full w-full object-cover", className)} />
  ) : (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-1.5 bg-panel p-2 text-center", className)}>
      <PlatformIcon platform="instagram" className="h-4 w-4 text-faint" />
      {post.caption && <span className="line-clamp-3 text-[10px] leading-snug text-muted-foreground">{post.caption}</span>}
    </div>
  );
}

export function IgFeedStats({
  ig,
  withKpis = true,
  onConnect,
  connectBusy,
  className,
}: {
  ig: IgCreator | null | undefined;
  /** Rangée de chiffres (abonnés, vues, portée, engagement) : non dans la fiche agence. */
  withKpis?: boolean;
  /** Bouton « Connecter » (espace créateur) quand son compte n'est pas connecté. */
  onConnect?: () => void;
  connectBusy?: boolean;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const feed = useMemo(() => readFeed(ig?.feed), [ig?.feed]);
  const ranked = useMemo(() => rankFeed(feed), [feed]);
  const ins = ig?.insights ?? null;
  const connected = !!ig?.link;
  const delta = followersDelta(ig?.history, 30);
  const er = engagement28(ins);
  const country = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      return null;
    }
  }, [locale]);

  if (!ig?.followers && feed.length === 0) {
    if (!withKpis) return null;
    return (
      <div className={cn("rounded-2xl border border-border bg-surface px-6 py-10 text-center", className)}>
        <PlatformIcon platform="instagram" className="mx-auto h-6 w-6 text-faint" />
        <div className="mt-3 text-sm font-medium text-foreground">{t("Aucun chiffre Instagram pour l'instant")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("Ils arrivent chaque nuit, dès que ton @ Instagram est sur ta fiche.")}</p>
        {onConnect && !connected && <ConnectButton onClick={onConnect} busy={connectBusy} className="mx-auto mt-4" />}
      </div>
    );
  }

  const kpi = (label: string, value: string, sub?: string) => (
    <div key={label} className="min-w-0 bg-surface px-4 py-3.5">
      <div className="truncate text-[12px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-1.5 truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
  const metricLabel = ranked.byViews ? t("vues") : t("likes");

  return (
    <div className={cn("@container flex flex-col gap-6", className)}>
      {withKpis && (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border @3xl:grid-cols-4">
            {kpi(
              t("Abonnés"),
              ig?.followers ? fmtCompact(ig.followers) : "—",
              delta ? t("{n} en 30 j", { n: `${delta > 0 ? "+" : "-"}${fmtCompact(Math.abs(delta))}` }) : undefined,
            )}
            {ins
              ? [
                  kpi(t("Vues 28 j"), ins.views != null ? fmtCompact(ins.views) : "—"),
                  kpi(t("Portée 28 j"), ins.reach != null ? fmtCompact(ins.reach) : "—", t("comptes touchés")),
                  kpi(t("Engagement"), er != null ? pct(er) : "—", t("interactions ÷ vues")),
                ]
              : [
                  kpi(t("Engagement"), ig?.er != null ? pct(ig.er) : "—", t("12 derniers posts")),
                  kpi(t("Rythme"), ig?.perWeek != null ? t("{n} / sem.", { n: String(ig.perWeek).replace(".", ",") }) : "—"),
                  kpi(t("Posts"), ig?.posts ? fmtCompact(ig.posts) : "—"),
                ]}
          </div>
          {onConnect && !connected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-3">
              <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{t("Connecte ton Instagram pour voir tes vues, ta portée et ton audience.")}</span>
              <ConnectButton onClick={onConnect} busy={connectBusy} />
            </div>
          )}
        </section>
      )}

      {ranked.top.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>{t("Ce qui marche")}</SectionTitle>
          <div className="grid grid-cols-2 gap-2 @4xl:grid-cols-4">
            {ranked.top.map((r) => (
              <RankCard key={r.post.id} r={r} byViews={ranked.byViews} label={metricLabel} />
            ))}
            {ranked.weakest && <RankCard r={ranked.weakest} byViews={ranked.byViews} label={metricLabel} weak />}
          </div>
        </section>
      )}

      {feed.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>{t("Derniers posts")}</SectionTitle>
          <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-2xl @md:grid-cols-4 @md:gap-1.5 @4xl:grid-cols-6">
            {feed.map((p) => {
              const m = mainMetric(p, ranked.byViews);
              return (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  title={p.caption || undefined}
                  className="group relative block aspect-[3/4] overflow-hidden bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Thumb post={p} className="transition-transform duration-300 group-hover:scale-[1.03]" />
                  {(p.product === "REELS" || p.type === "VIDEO" || p.type === "CAROUSEL_ALBUM") && (
                    <span className="absolute right-1.5 top-1.5 text-white drop-shadow">
                      {p.type === "CAROUSEL_ALBUM" ? <Layers className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-[12px] font-semibold tabular-nums text-white">
                    {m.icon === "play" ? <Play className="h-3 w-3 fill-current" /> : <Heart className="h-3 w-3 fill-current" />}
                    {fmtCompact(m.value)}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {ins && (ins.age?.length || ins.gender?.length || ins.country?.length) ? (
        <section className="flex flex-col gap-3">
          <SectionTitle>{t("Audience")}</SectionTitle>
          <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-3">
            {!!ins.age?.length && <Bars title={t("Âge")} rows={ins.age.slice(0, 5).map((a) => ({ label: t("{age} ans", { age: a.label }), pct: a.pct }))} />}
            {!!ins.gender?.length && <Bars title={t("Genre")} rows={genderRows(ins.gender, t)} />}
            {!!ins.country?.length && (
              <Bars title={t("Pays")} rows={ins.country.slice(0, 5).map((c) => ({ label: country?.of(c.label) ?? c.label, pct: c.pct }))} />
            )}
          </div>
        </section>
      ) : null}

      {ig?.ok && <div className="text-[11px] text-faint">{t("Donné par Meta · mis à jour le {date}", { date: fmtDay(ig.ok, locale) })}</div>}
    </div>
  );
}

function RankCard({ r, byViews, label, weak }: { r: RankedPost; byViews: boolean; label: string; weak?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const m = mainMetric(r.post, byViews);
  const ratio = ratioLabel(r.ratio);
  return (
    <a
      href={r.post.url}
      target="_blank"
      rel="noreferrer"
      className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-surface p-2 transition-colors hover:bg-rowhover", weak && "opacity-80")}
    >
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg">
        <Thumb post={r.post} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold tabular-nums text-foreground">
          {fmtCompact(m.value)} <span className="text-[12px] font-normal text-muted-foreground">{label}</span>
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          {weak ? t("Le moins vu") : ratio ? t("{ratio} la moyenne", { ratio }) : t("Dans la moyenne")}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-faint">{fmtDay(r.post.at, locale)}</div>
      </div>
    </a>
  );
}

function genderRows(g: IgSplit, t: (fr: string) => string): { label: string; pct: number }[] {
  const name: Record<string, string> = { F: t("Femmes"), M: t("Hommes"), U: t("Non précisé") };
  return g.filter((x) => x.pct > 0).map((x) => ({ label: name[x.label] ?? x.label, pct: x.pct }));
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="px-1 text-[15px] font-semibold text-foreground">{children}</h3>;
}

function Bars({ title, rows }: { title: string; rows: { label: string; pct: number }[] }) {
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate text-foreground">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{pct(r.pct)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel">
              <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(r.pct / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectButton({ onClick, busy, className }: { onClick: () => void; busy?: boolean; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn("flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50", className)}
    >
      {busy ? <Spin size={14} /> : <PlatformIcon platform="instagram" className="h-4 w-4" />} {t("Connecter")}
    </button>
  );
}

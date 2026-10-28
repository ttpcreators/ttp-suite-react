import { ChevronRight } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { followersDelta, type IgCreator } from "@/lib/instagram";
import type { TtCreator } from "@/lib/tiktok";
import type { YtCreator } from "@/lib/youtube";
import { fmtCompact } from "@/lib/timeSeries";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Network = "instagram" | "tiktok" | "youtube";

type Card = {
  net: Network; name: string; followers: number | null; delta: number | null;
  second: { label: string; value: string } | null; connected: boolean; tracked: boolean;
};

const fmtPct = (n: number) => `${n.toFixed(1).replace(".", ",")} %`;

/** Chiffres clés d'un réseau, à partir des relevés de l'app (ig-sync, tt-sync, yt-sync). */
export function networkCards(ig?: IgCreator | null, tt?: TtCreator | null, yt?: YtCreator | null): Card[] {
  const out: Card[] = [];
  if (ig) {
    const views = ig.insights?.views ?? null;
    out.push({
      net: "instagram", name: "Instagram", followers: ig.followers ?? null, delta: followersDelta(ig.history),
      second: views != null ? { label: "vues sur 28 j", value: fmtCompact(views) } : ig.er != null ? { label: "engagement", value: fmtPct(ig.er) } : null,
      connected: !!ig.link, tracked: ig.followers != null,
    });
  }
  if (tt) {
    out.push({
      net: "tiktok", name: "TikTok", followers: tt.followers ?? null, delta: followersDelta(tt.history),
      second: tt.avgViews != null ? { label: "vues moyennes", value: fmtCompact(tt.avgViews) } : tt.er != null ? { label: "engagement", value: fmtPct(tt.er) } : null,
      connected: !!tt.link, tracked: tt.followers != null,
    });
  }
  if (yt) {
    const v30 = yt.a30?.views ?? null;
    out.push({
      net: "youtube", name: "YouTube", followers: yt.hiddenSubs ? null : yt.subscribers ?? null, delta: followersDelta(yt.history),
      second: v30 != null ? { label: "vues sur 30 j", value: fmtCompact(v30) } : yt.avgViews != null ? { label: "vues moyennes", value: fmtCompact(yt.avgViews) } : null,
      connected: !!yt.link, tracked: yt.subscribers != null,
    });
  }
  return out;
}

/**
 * « Mes réseaux » (bas de la page Aujourd'hui du créateur) : une carte par réseau avec ses
 * chiffres clés (abonnés, évolution sur 30 j, vues ou engagement), « Connecter » quand le
 * réseau peut l'être, et un lien vers « Mes stats ».
 */
export function CreatorNetworks({ ig, tt, yt, canConnect, busy, preview, onConnect, onOpenStats }: {
  ig?: IgCreator | null; tt?: TtCreator | null; yt?: YtCreator | null;
  /** Réseaux que le créateur peut connecter lui-même aujourd'hui (accords Meta, TikTok, Google). */
  canConnect: Record<Network, boolean>;
  busy: Network | null;
  /** Aperçu agence : les boutons « Connecter » sont visibles mais désactivés. */
  preview?: boolean;
  onConnect: (n: Network) => void;
  onOpenStats: () => void;
}) {
  const t = useT();
  const known = networkCards(ig, tt, yt);
  // Réseaux à connecter sans aucun chiffre encore : carte vide avec le bouton.
  const cards: Card[] = [...known];
  for (const net of ["instagram", "tiktok", "youtube"] as Network[]) {
    if (canConnect[net] && !cards.some((c) => c.net === net)) {
      cards.push({ net, name: net === "instagram" ? "Instagram" : net === "tiktok" ? "TikTok" : "YouTube", followers: null, delta: null, second: null, connected: false, tracked: false });
    }
  }
  if (!cards.length) return null;
  return (
    <section className="mt-8" aria-label={t("Mes réseaux")}>
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <h2 className="text-[17px] font-semibold text-foreground">{t("Mes réseaux")}</h2>
        <button type="button" onClick={onOpenStats} className="flex items-center gap-0.5 text-[14px] font-medium text-primary hover:underline">
          {t("Mes stats")} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.net} className="flex flex-col gap-3 rounded-[20px] bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={c.net} className="h-4 w-4 text-foreground" />
              <span className="text-[15px] font-semibold text-foreground">{c.name}</span>
              <span className="flex-1" />
              {c.connected ? (
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ok"><span aria-hidden className="h-2 w-2 rounded-full bg-ok" />{t("Connecté")}</span>
              ) : c.tracked ? (
                <span className="text-[12.5px] text-muted-foreground">{t("Suivi par ton agence")}</span>
              ) : null}
            </div>
            {c.followers != null ? (
              <div className="flex items-end gap-4">
                <div>
                  <div className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">{fmtCompact(c.followers)}</div>
                  <div className="mt-1 text-[13px] text-muted-foreground">
                    {t("abonnés")}
                    {c.delta != null && c.delta !== 0 && (
                      <span className={cn("ml-1.5 font-medium tabular-nums", c.delta > 0 ? "text-ok" : "text-muted-foreground")}>
                        {c.delta > 0 ? "+" : ""}{fmtCompact(c.delta)} {t("en 30 j")}
                      </span>
                    )}
                  </div>
                </div>
                {c.second && (
                  <div className="ml-auto text-right">
                    <div className="text-[18px] font-semibold leading-none tabular-nums text-foreground">{c.second.value}</div>
                    <div className="mt-1 text-[13px] text-muted-foreground">{t(c.second.label)}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[13.5px] leading-snug text-muted-foreground">{t("Connecte ton compte : tes chiffres arrivent tout seuls chaque jour.")}</p>
            )}
            {!c.connected && canConnect[c.net] && (
              <button
                type="button"
                onClick={() => onConnect(c.net)}
                disabled={!!busy || preview}
                title={preview ? t("Le créateur le fait depuis son espace") : undefined}
                className="mt-auto flex h-10 items-center justify-center gap-1.5 rounded-full bg-field text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
              >
                {busy === c.net ? <Spin size={14} /> : <PlatformIcon platform={c.net} className="h-3.5 w-3.5" />}
                {t("Connecter mon {name}", { name: c.name })}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

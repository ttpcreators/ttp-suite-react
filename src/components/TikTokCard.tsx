import { useState } from "react";
import { ExternalLink, Eye, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { fmtCompact } from "@/lib/timeSeries";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { fmtAgo, fmtEr, fmtPerWeek, followersDelta } from "@/lib/instagram";
import { ttConnect, ttDisconnect, ttRefresh, ttWhyText, type TtCreator } from "@/lib/tiktok";

/**
 * Fiche créatrice (agence) : son TikTok, quand elle l'a connecté (Login Kit) :
 * abonnés, j'aime cumulés, vues moyennes et engagement de ses dernières vidéos,
 * mis à jour chaque jour (tt-sync).
 */
export function TikTokCard({ creatorId, name, tt, onChange, className }: {
  creatorId: string;
  name: string;
  tt: TtCreator | null | undefined;
  onChange: (tt: TtCreator) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<"" | "sync" | "link">("");
  const linked = !!tt?.link;
  const refresh = async () => {
    setBusy("sync");
    const r = await ttRefresh(creatorId);
    setBusy("");
    if (r.tt) {
      onChange(r.tt);
      toast(r.tt.why ? `TikTok : ${ttWhyText(r.tt.why)}` : "Chiffres TikTok à jour ✓");
    } else toast(ttWhyText(r.error) || "Mise à jour impossible, réessaie");
  };
  const connect = async () => {
    setBusy("link");
    const err = await ttConnect(name);
    setBusy("");
    if (err) toast(err);
  };
  const disconnect = async () => {
    setBusy("link");
    const ok = await ttDisconnect(name);
    setBusy("");
    if (ok && tt) onChange({ ...tt, link: null });
    toast(ok ? "TikTok déconnecté" : "Erreur, réessaie");
  };

  const delta = followersDelta(tt?.history, 30);
  const cell = (label: string, value: string, sub?: string) => (
    <div className="min-w-0 rounded-xl bg-panel px-3 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[16px] font-bold tabular-nums text-foreground">{value}</div>
      {sub && <div className="truncate text-[10px] text-faint">{sub}</div>}
    </div>
  );

  return (
    <div className={cn("rounded-2xl border border-border bg-surface p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <PlatformIcon platform="tiktok" className="h-4 w-4 shrink-0 text-muted-foreground" /> TikTok du jour
        </div>
        {linked && (
          <button type="button" onClick={refresh} disabled={!!busy} title="Redemander les chiffres à TikTok" className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50">
            {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualiser
          </button>
        )}
      </div>

      {linked && tt?.followers != null ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {cell("Abonnés", fmtCompact(tt.followers), delta ? `${delta > 0 ? "+" : "−"}${fmtCompact(Math.abs(delta))} en 30 j` : undefined)}
            {cell("Vues moyennes", tt.avgViews != null ? fmtCompact(tt.avgViews) : "—", "12 dernières vidéos")}
            {cell("Engagement", fmtEr(tt.er), "sur les vues")}
            {cell("J'aime cumulés", tt.likes != null ? fmtCompact(tt.likes) : "—", fmtPerWeek(tt.perWeek))}
          </div>
          {!!tt.recent?.length && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
              {tt.recent.slice(0, 8).map((v) => (
                <a key={v.id} href={v.url} target="_blank" rel="noreferrer" title={v.title} className="relative h-[92px] w-[64px] shrink-0 overflow-hidden rounded-lg bg-panel">
                  {v.cover && <img src={v.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-gradient-to-t from-black/75 to-transparent pb-1 pt-3 text-[10px] font-semibold text-white">
                    <Eye className="h-2.5 w-2.5" />{v.views != null ? fmtCompact(v.views) : "—"}
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="mt-2 text-[10px] text-faint">
            Donné par TikTok {fmtAgo(tt.ok)}{tt.username ? ` · @${tt.username}` : ""}{tt.why ? ` · dernier essai : ${ttWhyText(tt.why)}` : ""}
          </div>
        </>
      ) : linked ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
          {tt?.why ? `Pas de chiffres : ${ttWhyText(tt.why)}.` : "Ses chiffres arrivent dans quelques instants (ou touche « Actualiser »)."}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] leading-snug text-muted-foreground">
          TikTok ne donne les chiffres que si le créateur connecte son compte : abonnés, j'aime, et les vues de chacune de ses vidéos (y compris celles des collabs).
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        {linked ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
              <Link2 className="h-3.5 w-3.5" /> Compte connecté{tt?.link?.username ? ` (@${tt.link.username})` : ""}
            </span>
            <button type="button" onClick={disconnect} disabled={!!busy} className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-rose-500 disabled:opacity-50">
              <Unlink className="h-3 w-3" /> Déconnecter
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] leading-snug text-muted-foreground">Il connecte son TikTok depuis son espace (« Envoyer mes stats »), ou ici avec lui.</span>
            <button type="button" onClick={connect} disabled={!!busy} className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
              {busy === "link" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Connecter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

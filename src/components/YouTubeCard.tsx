import { useState } from "react";
import { ExternalLink, Eye, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { fmtCompact } from "@/lib/timeSeries";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { fmtAgo, fmtEr, fmtPerWeek, followersDelta } from "@/lib/instagram";
import { fmtDuration, ytConnect, ytDisconnect, ytRefresh, ytWhyText, type YtCreator } from "@/lib/youtube";

const COUNTRY = new Intl.DisplayNames(["fr"], { type: "region" });
/** 38,2 → « 38 % » (espace insécable : jamais coupé en fin de ligne). */
const pct = (n: number) => `${Math.round(n)}\u00a0%`;
const countryName = (k: string) => {
  try {
    return COUNTRY.of(k) ?? k;
  } catch {
    return k;
  }
};

/**
 * Fiche créatrice (agence) : sa chaîne YouTube, quand elle l'a connectée (Google) :
 * abonnés, vues moyennes (vidéos et Shorts), stats YouTube Studio des 30 derniers
 * jours (vues, heures regardées, abonnés gagnés) et audience (âge, sexe, pays),
 * mises à jour chaque jour (yt-sync).
 */
export function YouTubeCard({ creatorId, name, yt, onChange, className }: {
  creatorId: string;
  name: string;
  yt: YtCreator | null | undefined;
  onChange: (yt: YtCreator) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<"" | "sync" | "link">("");
  const linked = !!yt?.link;
  const refresh = async () => {
    setBusy("sync");
    const r = await ytRefresh(creatorId);
    setBusy("");
    if (r.yt) {
      onChange(r.yt);
      toast(r.yt.why ? `YouTube : ${ytWhyText(r.yt.why)}` : "Chiffres YouTube à jour ✓");
    } else toast(ytWhyText(r.error) || "Mise à jour impossible, réessaie");
  };
  const connect = async () => {
    setBusy("link");
    const err = await ytConnect(name);
    setBusy("");
    if (err) toast(err);
  };
  const disconnect = async () => {
    setBusy("link");
    const ok = await ytDisconnect(name);
    setBusy("");
    if (ok) onChange({ link: null }); // tout ce qui venait de sa chaîne est effacé côté serveur
    toast(ok ? "YouTube déconnecté, ses données YouTube sont effacées" : "Erreur, réessaie");
  };

  const delta = followersDelta(yt?.history, 30);
  const a = yt?.a30;
  const net = a?.subsGained != null ? a.subsGained - (a.subsLost ?? 0) : null;
  const shortsShare = a?.byType && a.views ? Math.round(((a.byType.SHORTS ?? a.byType.shorts ?? 0) / a.views) * 100) : null;
  const aud = yt?.audience;
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
          <PlatformIcon platform="youtube" className="h-4 w-4 shrink-0 text-muted-foreground" /> YouTube du jour
        </div>
        {linked && (
          <button type="button" onClick={refresh} disabled={!!busy} title="Redemander les chiffres à YouTube" className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50">
            {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualiser
          </button>
        )}
      </div>

      {linked && yt?.ok ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {cell("Abonnés", yt.subscribers != null ? fmtCompact(yt.subscribers) : "masqués", delta ? `${delta > 0 ? "+" : "−"}${fmtCompact(Math.abs(delta))} en 30 j` : net != null ? `${net >= 0 ? "+" : "−"}${fmtCompact(Math.abs(net))} sur 30 j (Studio)` : undefined)}
            {cell("Vues moyennes", yt.avgViews != null ? fmtCompact(yt.avgViews) : yt.avgShortViews != null ? fmtCompact(yt.avgShortViews) : "—", yt.avgViews != null ? "par vidéo (hors Shorts)" : "par Short")}
            {yt.avgViews != null && yt.avgShortViews != null && cell("Vues moyennes Shorts", fmtCompact(yt.avgShortViews), "par Short")}
            {cell("Engagement", fmtEr(yt.er), "sur les vues")}
            {a?.views != null && cell("Vues sur 30 j", fmtCompact(a.views), shortsShare != null ? `dont ${shortsShare} % en Shorts` : "YouTube Studio")}
            {a?.minutes != null && cell("Heures regardées", fmtCompact(Math.round(a.minutes / 60)), "30 j")}
            {a?.avgDuration != null && cell("Durée moyenne regardée", fmtDuration(a.avgDuration), a.avgPct != null ? `${Math.round(a.avgPct)} % de la vidéo` : undefined)}
            {cell("Rythme", fmtPerWeek(yt.perWeek), yt.videos != null ? `${fmtCompact(yt.videos)} vidéos en tout` : undefined)}
          </div>

          {aud && (aud.gender || aud.age?.length || aud.countries?.length) ? (
            <div className="mt-3 rounded-xl bg-panel px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">Audience (90 j)</div>
              {aud.gender && <div>Femmes {pct(aud.gender.female)} · Hommes {pct(aud.gender.male)}</div>}
              {!!aud.age?.length && <div>Âge : {aud.age.filter((x) => x.pct >= 1).map((x) => `${x.k.replace(/-$/, "+")}\u00a0ans\u00a0${pct(x.pct)}`).join(" · ")}</div>}
              {!!aud.countries?.length && <div>Pays : {aud.countries.slice(0, 4).map((x) => `${countryName(x.k)}\u00a0${pct(x.pct)}`).join(" · ")}</div>}
            </div>
          ) : null}

          {!!yt.recent?.length && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
              {yt.recent.slice(0, 8).map((v) => (
                <a key={v.id} href={v.url} target="_blank" rel="noreferrer" title={v.title} className={cn("relative shrink-0 overflow-hidden rounded-lg bg-panel", v.short ? "h-[92px] w-[52px]" : "h-[92px] w-[120px]")}>
                  {v.cover && <img src={v.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                  {v.paid && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-semibold text-white">Sponso</span>}
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-gradient-to-t from-black/75 to-transparent pb-1 pt-3 text-[10px] font-semibold text-white">
                    <Eye className="h-2.5 w-2.5" />{v.views != null ? fmtCompact(v.views) : "—"}
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="mt-2 text-[10px] text-faint">
            Donné par YouTube {fmtAgo(yt.ok)}{yt.handle ? ` · @${yt.handle}` : yt.title ? ` · ${yt.title}` : ""}{yt.why ? ` · dernier essai : ${ytWhyText(yt.why)}` : ""}
          </div>
        </>
      ) : linked ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
          {yt?.why ? `Pas de chiffres : ${ytWhyText(yt.why)}.` : "Ses chiffres arrivent dans quelques instants (ou touche « Actualiser »)."}
        </div>
      ) : yt?.why === "jeton" ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] leading-snug text-muted-foreground">
          L'accès à sa chaîne a été retiré ou a expiré : ses données YouTube ont été effacées. Il doit reconnecter sa chaîne.
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] leading-snug text-muted-foreground">
          En connectant sa chaîne, le créateur nous donne ses stats YouTube Studio (lecture seule) : vues sur 30 jours, heures regardées, abonnés gagnés, âge, sexe et pays de son audience, et les vues de chacune de ses vidéos (collabs comprises).
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        {linked ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-signaltext">
              <Link2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Chaîne connectée{yt?.link?.title ? ` (${yt.link.title})` : ""}</span>
            </span>
            <button type="button" onClick={disconnect} disabled={!!busy} className="flex shrink-0 items-center gap-1 text-[11px] text-faint transition-colors hover:text-dangertext disabled:opacity-50">
              <Unlink className="h-3 w-3" /> Déconnecter
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] leading-snug text-muted-foreground">Il connecte sa chaîne depuis son espace (« Envoyer mes stats »), ou ici avec lui.</span>
            <button type="button" onClick={connect} disabled={!!busy} className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
              {busy === "link" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Connecter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

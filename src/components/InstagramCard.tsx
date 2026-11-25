import { EMPTY, fmtAgoSince } from "@/lib/dates";
import { useState } from "react";
import { Spin } from "@/components/ui/loader";
import { Copy, ExternalLink, Link2, RefreshCw, Unlink } from "@/components/icons";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { fmtCompact } from "@/lib/timeSeries";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { essaisRates, etatConnexion, fmtAgo, fmtEr, fmtPerWeek, followersDelta, igConnect, igDisconnect, igLien, igRefresh, igWhyText, lireRaison, RAISON_AGENCE, useIgConnexions, type IgCreator, type IgSplit } from "@/lib/instagram";
import { useIsFounder } from "@/lib/useFounder";

const jour = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * Fiche créatrice (agence) : ses chiffres Instagram du jour, donnés par Meta et
 * mis à jour chaque nuit (ig-sync). Si elle a connecté son compte : couverture,
 * vues et audience en plus (statistiques privées, avec son accord).
 */
export function InstagramCard({ creatorId, name, ig, onChange, className }: {
  creatorId: string;
  name: string;
  ig: IgCreator | null | undefined;
  onChange: (ig: IgCreator) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<"" | "sync" | "link" | "lien">("");
  const founder = useIsFounder();
  const essais = useIgConnexions(creatorId);
  const dernier = essais?.[0] ?? null;
  const { etat, joursRestants } = etatConnexion({ link: ig?.link ?? null, jetonInvalide: ig?.insightsWhy === "jeton", dernier });
  const rates = essaisRates(essais ?? []);
  const [lien, setLien] = useState<string | null>(null);
  // Lien de connexion à envoyer par WhatsApp (7 jours, cette créatrice seulement).
  const copierLien = async () => {
    setBusy("lien");
    const r = await igLien(name);
    setBusy("");
    if ("error" in r) return toast(r.error, { variant: "error" });
    setLien(r.url);
    // Safari peut refuser la copie après l'attente : le lien reste affiché, sélectionnable.
    const copie = await navigator.clipboard?.writeText(r.url).then(() => true, () => false);
    toast(copie ? "Lien copié ✓ Valable 7 jours, à envoyer par WhatsApp" : "Lien prêt : copie-le ci-dessous");
  };
  const refresh = async () => {
    setBusy("sync");
    const r = await igRefresh<IgCreator>("creator", creatorId);
    setBusy("");
    if (r.ig) {
      onChange(r.ig);
      toast(r.ig.why ? `Instagram : ${igWhyText(r.ig.why)}` : "Chiffres Instagram à jour ✓");
    } else toast(r.error === "meta_non_configure" ? "Instagram n'est pas encore relié à Meta" : "Mise à jour impossible, réessaie");
  };
  const connect = async () => {
    setBusy("link");
    const err = await igConnect(name);
    setBusy("");
    if (err) toast(err);
  };
  const disconnect = async () => {
    setBusy("link");
    const ok = await igDisconnect(name);
    setBusy("");
    if (ok && ig) onChange({ ...ig, link: null, insights: null, insightsWhy: null });
    toast(ok ? "Instagram déconnecté" : "Erreur, réessaie");
  };

  const delta = followersDelta(ig?.history, 30);
  const ins = ig?.insights;
  const topOf = (s?: IgSplit, n = 2) => (s ?? []).slice(0, n).map((x) => `${x.label.split(",")[0]} ${String(x.pct).replace(".", ",")} %`).join(" · ");
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
          <PlatformIcon platform="instagram" className="h-4 w-4 shrink-0 text-muted-foreground" /> Instagram du jour
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!!busy}
          title="Redemander les chiffres à Meta"
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
        >
          {busy === "sync" ? <Spin size={14} /> : <RefreshCw className="h-3.5 w-3.5" />} Actualiser
        </button>
      </div>

      {ig?.followers ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {cell("Abonnés", fmtCompact(ig.followers), delta ? `${delta > 0 ? "+" : "−"}${fmtCompact(Math.abs(delta))} en 30 j` : undefined)}
            {cell("Engagement (sur les abonnés)", fmtEr(ig.er), "Meta · 12 derniers posts")}
            {cell("Rythme", fmtPerWeek(ig.perWeek))}
            {cell("Dernier post", fmtAgoSince(ig.lastPost) || EMPTY)}
          </div>
          <div className="mt-2 text-[10px] text-faint">
            Donné par Meta {fmtAgo(ig.ok)}{ig.username ? ` · @${ig.username}` : ""}{ig.why ? ` · dernier essai : ${igWhyText(ig.why)}` : ""}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
          {ig?.why ? `Pas de chiffres : ${igWhyText(ig.why)}.` : "Les chiffres arrivent avec le prochain passage (chaque nuit), ou touche « Actualiser »."}
        </div>
      )}

      {/* Statistiques privées : seulement si la créatrice a connecté son compte */}
      <div className="mt-4 border-t border-border pt-3">
        {ig?.link ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className={cn("flex items-center gap-1.5 text-[12px] font-medium", etat === "connecte" ? "text-signaltext" : "text-dangertext")}>
                <Link2 className="h-3.5 w-3.5" /> {etat === "expire" ? "Connexion expirée" : "Compte connecté"}{ig.link.username ? ` (@${ig.link.username})` : ""}
              </span>
              <button type="button" onClick={disconnect} disabled={!!busy} className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-dangertext disabled:opacity-50">
                <Unlink className="h-3 w-3" /> Déconnecter
              </button>
            </div>
            <div className="mt-1 text-[10px] text-faint">
              Connecté le {jour(ig.link.at)}
              {ig.link.expires ? ` · jeton valable jusqu'au ${jour(ig.link.expires)}` : ""}
              {etat === "bientot_expire" ? ` · expire dans ${joursRestants} j sans avoir pu être prolongé : envoyer le lien` : ""}
              {etat === "expire" ? " · à reconnecter : envoyer le lien" : ""}
            </div>
            {ins ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {cell("Couverture 28 j", ins.reach != null ? fmtCompact(ins.reach) : "—")}
                {cell("Vues 28 j", ins.views != null ? fmtCompact(ins.views) : "—")}
                {ins.reelViews ? cell("Vues par reel", fmtCompact(ins.reelViews), "moyenne des derniers reels") : null}
                {ins.age?.length ? cell("Âge", topOf(ins.age, 1) || "—", "tranche principale") : null}
                {ins.city?.length ? cell("Ville", topOf(ins.city, 1) || "—", "ville principale") : null}
              </div>
            ) : (
              <div className="mt-1.5 text-[11px] text-faint">
                {ig.insightsWhy === "jeton" ? "Le lien a expiré : il doit reconnecter son Instagram." : "Ses statistiques privées arrivent au prochain passage."}
              </div>
            )}
            {ins && <div className="mt-2 text-[10px] text-faint">Reportées dans son media kit (vues, âge, villes, pays) · {fmtAgo(ins.at)}</div>}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] leading-snug text-muted-foreground">
                {etat === "echec" && dernier
                  ? <>
                      <span className="font-medium text-dangertext">Connexion ratée</span> le {jour(dernier.at)}
                      {rates > 1 ? ` (${rates} essais)` : ""} : {RAISON_AGENCE[lireRaison(dernier.raison)]}.
                    </>
                  : "Jamais connecté. Couverture, vues et audience : il connecte son Instagram (depuis son espace, ou ici avec lui)."}
              </span>
              <button
                type="button"
                onClick={connect}
                disabled={!!busy}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
              >
                {busy === "link" ? <Spin size={14} /> : <ExternalLink className="h-3.5 w-3.5" />} Connecter
              </button>
            </div>
            {etat === "echec" && dernier?.message && (
              <div className="mt-1.5 break-words rounded-lg bg-panel px-2.5 py-1.5 font-mono text-[10px] leading-snug text-faint">Meta : {dernier.message}</div>
            )}
          </>
        )}
        {founder && (
          <div className="mt-3">
            <button
              type="button"
              onClick={copierLien}
              disabled={!!busy}
              title="Lien signé, valable 7 jours, pour cette créatrice seulement : elle l'ouvre sans se connecter à TTP Suite"
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
            >
              {busy === "lien" ? <Spin size={14} /> : <Copy className="h-3.5 w-3.5" />} Copier le lien de connexion
            </button>
            {lien && (
              <input
                readOnly
                value={lien}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Lien de connexion Instagram"
                className="mt-2 w-full rounded-lg border border-border bg-panel px-2.5 py-1.5 font-mono text-[10px] text-foreground"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Spin } from "@/components/ui/loader";
import { ExternalLink, RefreshCw } from "@/components/icons";
import { toast } from "@/components/ui/toast";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, fmtEr, fmtPerWeek, igRefresh, igWhyText, type IgBrand } from "@/lib/instagram";

/** Ligne courte (Pipeline, liste des contacts) : abonnés · rythme · dernier post. */
export function BrandIgInline({ ig, className }: { ig?: IgBrand | null; className?: string }) {
  if (!ig?.followers) return null;
  return (
    <span className={className} title={`Instagram @${ig.username ?? ""} · donné par Meta ${fmtAgo(ig.ok)}`}>
      <PlatformIcon platform="instagram" className="mr-1 inline h-3 w-3 align-[-2px]" />
      {fmtCompact(ig.followers)}
      {ig.perWeek != null && ` · ${fmtPerWeek(ig.perWeek)}`}
      {ig.lastPost && ` · dernier post ${fmtAgo(ig.lastPost.at)}`}
    </span>
  );
}

/** Fiche contact : chiffres Instagram de la marque (ig-sync, chaque semaine). */
export function BrandIgPanel({ contactId, ig, onChange }: { contactId: string; ig?: IgBrand | null; onChange: (ig: IgBrand) => void }) {
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    const r = await igRefresh<IgBrand>("contact", contactId);
    setBusy(false);
    if (!r.ig) return toast(r.error === "meta_non_configure" ? "Instagram n'est pas encore relié à Meta" : "Mise à jour impossible, réessaie");
    onChange(r.ig);
    toast(r.ig.why ? `Instagram : ${igWhyText(r.ig.why)}` : "Chiffres Instagram à jour ✓");
  };
  const cell = (label: string, value: string) => (
    <div className="min-w-0 rounded-lg bg-surface px-2.5 py-2">
      <div className="text-[10px] font-medium text-faint">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
  return (
    <div className="mt-4 rounded-xl border border-border bg-panel/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <PlatformIcon platform="instagram" className="h-3.5 w-3.5" /> Instagram de la marque
        </span>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50">
          {busy ? <Spin size={12} /> : <RefreshCw className="h-3 w-3" />} Actualiser
        </button>
      </div>
      {ig?.followers ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {cell("Abonnés", fmtCompact(ig.followers))}
            {cell("Rythme", fmtPerWeek(ig.perWeek))}
            {cell("Engagement", fmtEr(ig.er))}
            {cell("Dernier post", fmtAgo(ig.lastPost?.at))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-faint">
            <span>Donné par Meta {fmtAgo(ig.ok)}</span>
            {ig.lastPost?.url && (
              <a href={ig.lastPost.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                Voir le dernier post <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-faint">{ig?.why ? igWhyText(ig.why) : "Chiffres mis à jour chaque semaine, ou touche « Actualiser »."}</div>
      )}
    </div>
  );
}

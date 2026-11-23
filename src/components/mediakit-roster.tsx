import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink } from "@/components/icons";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { siteSlugFor, type MkRow } from "@/lib/mediakitSlug";
import { chiffresAnciens, derniersChiffres, kitEtat, type KitEtat } from "@/lib/mediakitRoster";
import type { CreatorLite } from "@/lib/useCreators";
import { jourCourt, type Mesure } from "../../supabase/functions/_shared/mediakitControle.ts";

type Blob = { id: string; mediakit: unknown; ig: unknown; tt: unknown; yt: unknown };

const ETAT: Record<KitEtat, { label: string; dot: string }> = {
  rempli: { label: "Kit rempli", dot: "bg-ok" },
  incomplet: { label: "À compléter", dot: "bg-wait" },
  vide: { label: "Kit vide", dot: "bg-closed" },
};

/**
 * Liste du roster dans l'onglet Media kit › Créateurs (avant de choisir un créateur) :
 * état du kit, date des derniers chiffres réels (signalée au delà de 2 mois) et lien vers
 * la page publique. Un clic ouvre le kit, comme le menu « Choisir un créateur ».
 * Réutilise la liste des créateurs, les adresses publiques et les mesures déjà chargées
 * par l'éditeur ; seuls les blobs (kit et relevés) sont lus ici.
 */
export function MediakitRoster({
  creators,
  siteRows,
  mesures,
  onOpen,
}: {
  creators: CreatorLite[];
  siteRows: MkRow[] | null;
  mesures: Mesure[];
  onOpen: (id: string) => void;
}) {
  const [blobs, setBlobs] = useState<Record<string, Blob> | null>(null);
  useEffect(() => {
    let alive = true;
    supabase
      .from("creators")
      .select("id, mediakit, ig, tt, yt")
      .then(({ data, error }) => {
        if (!alive || error) return;
        const m: Record<string, Blob> = {};
        for (const r of (data as Blob[] | null) ?? []) m[r.id] = r;
        setBlobs(m);
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    const list = creators.map((c) => {
      const b = blobs?.[c.id];
      const etat = b ? kitEtat(b.mediakit) : null;
      const date = b ? derniersChiffres({ name: c.name, mediakit: b.mediakit, ig: b.ig, tt: b.tt, yt: b.yt }, mesures) : null;
      const slugSaisi = (b?.mediakit as { slug?: string } | null)?.slug;
      const slug = siteRows ? siteSlugFor(siteRows, c.name, slugSaisi) : undefined;
      const inactif = (c.status ?? "actif") === "inactif";
      return { c, etat, date, inactif, url: slug && etat && etat !== "vide" ? `ttpcreators.pro/mediakit/${slug}` : null };
    });
    // Créateurs actifs d'abord, l'ordre du roster est gardé.
    return [...list.filter((r) => !r.inactif), ...list.filter((r) => r.inactif)];
  }, [creators, blobs, siteRows, mesures]);

  if (creators.length === 0) {
    return <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-[12px] text-muted-foreground">Choisis un créateur pour ouvrir son media kit : il se met à jour en ligne sur ttpcreators.pro.</p>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map(({ c, etat, date, inactif, url }, i) => {
          const vieux = chiffresAnciens(date);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(c.id);
                }
              }}
              className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover", i > 0 && "border-t border-border", inactif && "opacity-60")}
            >
              <CreatorAvatar name={c.name} photoUrl={c.photo_url} className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-foreground">{titleCase(c.name)}</span>
                  {inactif && <span className="shrink-0 text-[11px] text-faint">inactif</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                  {etat ? (
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ETAT[etat].dot)} />
                      {ETAT[etat].label}
                    </span>
                  ) : (
                    <span className="text-faint">…</span>
                  )}
                  {blobs && (
                    <span className={cn(vieux && "font-medium text-wait")}>
                      {date ? `Chiffres du ${jourCourt(date)}${vieux ? ", à mettre à jour" : ""}` : "Aucun chiffre relevé"}
                    </span>
                  )}
                  {url && (
                    <a
                      href={`https://${url}/`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex min-w-0 items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{url}</span>
                    </a>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

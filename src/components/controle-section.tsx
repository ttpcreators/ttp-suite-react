import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Contact, FileText, Handshake, ListChecks, Receipt, Users, Wallet, type LucideIcon } from "@/components/icons";
import { IconTile } from "@/components/ui/icon-tile";
import { toast } from "@/components/ui/toast";
import { useAppState } from "@/lib/appState";
import { useLiveKey } from "@/lib/useLive";
import { useSearch } from "@/lib/search";
import { useStickyState } from "@/lib/useStickyState";
import { requestIntent } from "@/lib/openIntent";
import { localISO } from "@/lib/aujourdhui";
import { cn } from "@/lib/utils";
import { IGNORES_KEY, controler, lireIgnores, sansDoublonAujourdhui, sansIgnores, toneOf, type ControleInput, type Probleme, type RegleId } from "@/lib/controle";
import { appliquerCorrection, chargerControle, ignorerProbleme } from "@/lib/controleDb";

/**
 * « À corriger » (page Aujourd'hui, fondateurs) : le contrôle qualité des données, repassé
 * à chaque chargement (logique : supabase/functions/_shared/controle.ts, la même qu'Alfred
 * lit par le connecteur). Une ligne par problème : « Ouvrir » l'élément, « Corriger » quand
 * la correction est sûre, « Ignorer » pour le masquer à toute l'agence (blob controleIgnores).
 * Repliée quand il n'y a rien ; le nombre de problèmes à droite du titre.
 */

const ICON: Record<RegleId, LucideIcon> = {
  brouillon_echu: Receipt,
  publiee_sans_facture: Receipt,
  facture_annulee_seule: Receipt,
  commission_a_facturer: Wallet,
  depot_sans_suite: FileText,
  kit_incomplet: Users,
  etape_paiement: Receipt,
  etape_reversement: Receipt,
  paiement_avant_publication: Receipt,
  createur_hors_roster: Users,
  prospect_ouvert: Handshake,
  cachet_illisible: Wallet,
  brief_casse: FileText,
  tache_cochee: ListChecks,
  fiche_incomplete: Users,
  etiquettes_contacts: Contact,
  droits_expirent: CalendarClock,
  droits_expires: CalendarClock,
};

const FOLD = ["ouvert", "ferme"] as const;
const go = (id: string) => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: id }));

export function ControleSection({ exclureCollabs }: { exclureCollabs: ReadonlySet<string> }) {
  const live = useLiveKey();
  const { setQuery } = useSearch();
  const { data: rawIgnores } = useAppState((s) => s[IGNORES_KEY]);
  const [data, setData] = useState<ControleInput | null>(null);
  const [reload, setReload] = useState(0);
  // Corrigés ou masqués à l'instant : cachés sans attendre la relecture.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [fold, setFold] = useStickyState("aujourdhui:corriger", FOLD, "ouvert");

  useEffect(() => {
    let alive = true;
    void chargerControle(true, localISO(new Date())).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [live, reload]);

  const list = useMemo(() => {
    if (!data) return [];
    const all = sansIgnores(controler(data), lireIgnores(rawIgnores));
    return sansDoublonAujourdhui(all, exclureCollabs).filter((p) => !gone.has(p.id));
  }, [data, rawIgnores, exclureCollabs, gone]);

  if (!data) return null;
  const open = list.length > 0 && fold === "ouvert";
  const hide = (id: string) => setGone((s) => new Set(s).add(id));

  const openItem = (p: Probleme) => {
    const l = p.lien;
    if (l.createur) return go(`creator:${l.createur}`);
    if (l.vue === "collabs" && l.item) requestIntent("collab:open", l.item);
    if (l.vue === "todo" && l.item) requestIntent("todo:open", l.item);
    if (l.recherche) setQuery(l.recherche);
    go(l.vue);
  };
  const fix = async (p: Probleme) => {
    if (!p.correction || busy) return;
    setBusy(p.id);
    const ok = await appliquerCorrection(p.correction);
    setBusy(null);
    if (!ok) return toast("Erreur, réessaie");
    hide(p.id);
    toast("Corrigé ✓");
    setReload((n) => n + 1);
  };
  const ignore = async (p: Probleme) => {
    if (busy) return;
    setBusy(p.id);
    const ok = await ignorerProbleme(p.id);
    setBusy(null);
    if (!ok) return toast("Erreur, réessaie");
    hide(p.id);
    toast("Masqué pour toute l'agence");
  };

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => list.length && setFold(fold === "ouvert" ? "ferme" : "ouvert")}
        aria-expanded={open}
        disabled={!list.length}
        className="flex w-full items-baseline justify-between gap-3 px-1 pb-1.5 text-left disabled:cursor-default"
      >
        <span className="flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground">
          {list.length > 0 && <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />}
          À corriger
        </span>
        <span className="shrink-0 text-[14px] tabular-nums text-muted-foreground">{list.length || "Aucun"}</span>
      </button>
      {open && (
        <div className="space-y-1">
          {list.map((p) => {
            const Icon = ICON[p.regle];
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-3 py-2.5 hover:bg-rowhover">
                <IconTile tone={toneOf(p.gravite)} size="sm">
                  <Icon />
                </IconTile>
                <div className="min-w-0 flex-1 basis-[60%]">
                  <div className="truncate text-[14px] font-semibold leading-snug text-foreground">{p.titre}</div>
                  <div className="line-clamp-2 text-[13px] leading-snug text-muted-foreground" title={p.detail}>{p.detail}</div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => void ignore(p)} disabled={busy === p.id} className="h-8 rounded-full px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-field hover:text-foreground disabled:opacity-60">
                    Ignorer
                  </button>
                  {p.externe && (
                    <a href={p.externe.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-full px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-field hover:text-foreground">
                      {p.externe.texte}
                    </a>
                  )}
                  <button type="button" onClick={() => openItem(p)} className="h-8 rounded-full bg-field px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover">
                    Ouvrir
                  </button>
                  {p.correction && (
                    <button type="button" onClick={() => void fix(p)} disabled={busy === p.id} title={p.correction.texte} className="h-8 rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
                      Corriger
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Users, Contact, ListChecks, Receipt, FileText, Search as SearchIcon, X, Trash2, type LucideIcon } from "lucide-react";
import { useGlobalSearch, type SearchHit } from "@/lib/useGlobalSearch";
import { titleCase } from "@/lib/utils";
import { ALL_ITEMS, type ViewId } from "@/lib/nav";

const KIND_META: Record<SearchHit["kind"], { icon: LucideIcon; label: string; view: ViewId | null }> = {
  creator: { icon: Users, label: "Créateur", view: null },
  contact: { icon: Contact, label: "Contact", view: "contacts" },
  todo: { icon: ListChecks, label: "À faire", view: "todo" },
  invoice: { icon: Receipt, label: "Facture", view: "facturation" },
  brief: { icon: FileText, label: "Brief", view: "briefs" },
  prospect: { icon: SearchIcon, label: "Prospect", view: "prospection" },
};

// Pages navigables depuis la recherche (nav agence + Corbeille).
const PAGES: { id: ViewId; label: string; icon: LucideIcon }[] = [
  ...ALL_ITEMS,
  { id: "corbeille", label: "Corbeille", icon: Trash2 },
];
// Synonymes pour retrouver une page même sans taper son nom exact.
const PAGE_ALIASES: Partial<Record<ViewId, string[]>> = {
  apercu: ["dashboard", "accueil", "tableau de bord"],
  reversements: ["paie", "paiement", "reverser", "reversement", "salaire createur"],
  relances: ["impaye", "retard", "relancer", "relance facture"],
  echeances: ["echeance", "expiration", "renouvellement contrat", "fin de contrat"],
  facturation: ["facture", "devis"],
  planning: ["agenda", "calendrier", "rendez-vous", "rdv"],
  mediakit: ["media kit", "kit"],
  contrats: ["contrat"],
  prospection: ["prospect", "deal", "pipeline"],
  roster: ["createurs", "talents"],
  objectifs: ["objectif", "goal"],
  stats: ["statistiques", "analytics"],
  debrief: ["bilan", "rapport"],
  acces: ["mot de passe", "identifiants", "login"],
  corbeille: ["poubelle", "supprime"],
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function GlobalSearch({
  query,
  setQuery,
  onOpenCreator,
  onGoto,
  hidden = [],
  inline = false,
  autoFocus = false,
  className,
}: {
  query: string;
  setQuery: (q: string) => void;
  onOpenCreator: (name: string) => void;
  onGoto: (id: ViewId) => void;
  /** Pages masquées pour ce profil (ex. Finance / Accès pour un membre). */
  hidden?: ViewId[];
  /** Résultats affichés sous le champ, dans la page (écran de recherche plein écran sur téléphone). */
  inline?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Texte d'aide court sur mobile (le long était tronqué au milieu d'un mot).
  const [narrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const { hits: rawHits, loading } = useGlobalSearch(query);
  // Résultats menant à une page masquée : retirés (jamais de page fondateur pour un membre).
  const hits = rawHits.filter((h) => { const v = KIND_META[h.kind].view; return !v || !hidden.includes(v); });
  const show = (inline || open) && query.trim().length >= 2;

  const q = norm(query.trim());
  const pageHits =
    q.length >= 2
      ? PAGES.filter((p) => !hidden.includes(p.id)).filter((p) => norm(p.label).includes(q) || (PAGE_ALIASES[p.id] ?? []).some((a) => norm(a).includes(q))).slice(0, 5)
      : [];

  const gotoPage = (id: ViewId) => {
    onGoto(id);
    setQuery("");
    setOpen(false);
  };

  const pick = (h: SearchHit) => {
    setOpen(false);
    if (h.kind === "creator") {
      onOpenCreator(h.value);
      setQuery("");
    } else {
      const v = KIND_META[h.kind].view;
      if (v) onGoto(v); // garde la requête → la vue cible filtre dessus
    }
  };

  return (
    <div className={cn("relative w-full", !inline && "max-w-[220px] sm:max-w-md md:max-w-xl", className)}>
      {/* Champ contrôlé — langage de l’Aperçu : champ clair bordé, halo discret au focus.
          Écran plein (téléphone) : champ gris façon iOS. */}
      <div className={cn(
        "flex h-10 items-center gap-2.5 rounded-xl px-3.5 text-foreground transition-shadow",
        inline ? "bg-foreground/[0.06]" : "border border-border bg-surface focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-foreground/10",
      )}>
        <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (pageHits[0]) gotoPage(pageHits[0].id);
              else if (hits[0]) pick(hits[0]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          autoFocus={autoFocus}
          enterKeyHint="search"
          placeholder={narrow && !inline ? "Rechercher…" : "Page, créatrice, contact, facture…"}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Effacer la recherche"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {show && (
        <>
          {!inline && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
          <div className={cn(
            "overflow-y-auto rounded-xl border border-border bg-surface p-1.5",
            inline ? "mt-3" : "absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[60vh] shadow-xl",
          )}>
            {loading && hits.length === 0 && pageHits.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Recherche…</div>
            ) : hits.length === 0 && pageHits.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Aucun résultat pour « {query.trim()} ».</div>
            ) : (
              <>
                {pageHits.length > 0 && (
                  <>
                    <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">Pages</div>
                    {pageHits.map((p) => (
                      <button
                        key={`pg-${p.id}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => gotoPage(p.id)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-rowhover"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel text-muted-foreground">
                          <p.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.label}</span>
                        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-primary">Page</span>
                      </button>
                    ))}
                    {hits.length > 0 && <div className="mx-2 my-1 h-px bg-border/60" />}
                  </>
                )}
                {hits.map((h, i) => {
                const M = KIND_META[h.kind];
                const label = h.kind === "creator" ? titleCase(h.label) : h.label;
                const sub = h.kind === "todo" && h.sub ? titleCase(h.sub) : h.sub;
                return (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(h)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-rowhover"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel text-muted-foreground">
                      <M.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{label}</span>
                      {sub && <span className="block truncate text-[11px] text-faint">{sub}</span>}
                    </span>
                    <span className="shrink-0 rounded-md bg-rowhover px-2 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                      {M.label}
                    </span>
                  </button>
                );
                })}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

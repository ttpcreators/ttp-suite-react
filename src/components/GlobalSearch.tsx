import { useState } from "react";
import { Users, Contact, ListChecks, Receipt, FileText, Search as SearchIcon, X, type LucideIcon } from "lucide-react";
import { useGlobalSearch, type SearchHit } from "@/lib/useGlobalSearch";
import { titleCase } from "@/lib/utils";
import type { ViewId } from "@/lib/nav";

const KIND_META: Record<SearchHit["kind"], { icon: LucideIcon; label: string; view: ViewId | null }> = {
  creator: { icon: Users, label: "Créateur", view: null },
  contact: { icon: Contact, label: "Contact", view: "contacts" },
  todo: { icon: ListChecks, label: "À faire", view: "todo" },
  invoice: { icon: Receipt, label: "Facture", view: "facturation" },
  brief: { icon: FileText, label: "Brief", view: "briefs" },
  prospect: { icon: SearchIcon, label: "Prospect", view: "prospection" },
};

export function GlobalSearch({
  query,
  setQuery,
  onOpenCreator,
  onGoto,
}: {
  query: string;
  setQuery: (q: string) => void;
  onOpenCreator: (name: string) => void;
  onGoto: (id: ViewId) => void;
}) {
  const [open, setOpen] = useState(false);
  const { hits, loading } = useGlobalSearch(query);
  const show = open && query.trim().length >= 2;

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
    <div className="relative w-full max-w-[220px] sm:max-w-md md:max-w-xl">
      {/* Champ contrôlé (pilule sombre) — 100% synchro avec la requête */}
      <div className="flex h-11 items-center gap-2.5 rounded-full bg-foreground px-4 text-background shadow-sm ring-1 ring-border/50">
        <SearchIcon className="h-4 w-4 shrink-0 opacity-80" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher…"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-background outline-none placeholder:text-background/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-background/60 transition-colors hover:text-background"
            aria-label="Effacer la recherche"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {show && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl">
            {loading && hits.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Recherche…</div>
            ) : hits.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Aucun résultat pour « {query.trim()} ».</div>
            ) : (
              hits.map((h, i) => {
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
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { FileText, Search, Star } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { mergeAppStateKey, useAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { DEFAULT_TEMPLATES, favoriteModels, fillModel, groupModels, modelKey, type ModelVars, type Template } from "@/lib/mailModels";
import { cn } from "@/lib/utils";

/**
 * « Modèles » dans la zone de réponse et la fenêtre « Nouveau mail » : les modèles de la
 * page Modèles (fournis + ceux de l'agence), rangés par catégorie, avec recherche et
 * aperçu. Les variables connues ({marque}, {créateur}, {prénom}) sont remplies ; les autres
 * restent visibles pour être complétées. Rien n'est envoyé : le texte est seulement inséré.
 */
export function ModelPicker({ vars, onPick, className }: { vars?: ModelVars; onPick: (text: string, t: Template) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<Template | null>(null);
  const { data: custom } = useAppState<Template[]>((s: AppState) => (s["customTemplates"] as Template[]) ?? []);
  // Favoris de l'équipe (étoile) : section en tête de liste. Clé du blob : mailModelFavorites.
  const { data: favData } = useAppState<Record<string, unknown>>((s: AppState) => (s["mailModelFavorites"] as Record<string, unknown>) ?? {});
  const [favLocal, setFavLocal] = useState<Record<string, unknown> | null>(null);
  const favs = favLocal ?? favData ?? {};
  const toggleFav = async (t: Template) => {
    const k = modelKey(t);
    const on = !favs[k];
    const next = { ...favs };
    if (on) next[k] = true;
    else delete next[k];
    setFavLocal(next);
    if (!(await mergeAppStateKey("mailModelFavorites", on ? { [k]: true } : {}, on ? [] : [k]))) {
      setFavLocal(favs);
      toast("Favori non enregistré, réessaie");
    }
  };
  const groups = useMemo(() => {
    const all = [...DEFAULT_TEMPLATES, ...(custom ?? [])];
    const n = q.trim().toLowerCase();
    const list = n ? all.filter((t) => `${t.title} ${t.body} ${t.category}`.toLowerCase().includes(n)) : all;
    const fav = favoriteModels(list, favs);
    return [...(fav.length ? [{ category: "Favoris", items: fav }] : []), ...groupModels(list)];
  }, [custom, q, favs]);
  const pick = (t: Template) => {
    onPick(fillModel(t.body, vars ?? {}), t);
    setOpen(false);
    setQ("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title="Insérer un modèle de mail" className={cn("flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground", className)}>
          <FileText className="h-3.5 w-3.5" /> Modèles
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(560px,calc(100vw-2rem))] p-0">
        <div className="flex max-h-[min(400px,50dvh)]">
          <div className="flex w-full min-w-0 flex-col sm:w-[240px] sm:shrink-0 sm:border-r sm:border-border">
            <label className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un modèle…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {groups.length === 0 && <p className="px-2 py-4 text-center text-[12.5px] text-muted-foreground">Aucun modèle.</p>}
              {groups.map((g) => (
                <div key={g.category} className="mb-1.5">
                  <div className="flex items-center gap-1 px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">
                    {g.category === "Favoris" && <Star className="h-3 w-3 fill-current text-primary" />}
                    {g.category}
                  </div>
                  {g.items.map((t, i) => {
                    const fav = !!favs[modelKey(t)];
                    return (
                      <div key={(t.id ?? t.title) + i} className={cn("group/m flex items-center rounded-lg transition-colors hover:bg-rowhover", hover === t && "bg-rowhover")}>
                        <button
                          type="button"
                          onMouseEnter={() => setHover(t)}
                          onFocus={() => setHover(t)}
                          onClick={() => pick(t)}
                          className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13px] text-foreground"
                        >
                          {t.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleFav(t)}
                          aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
                          className={cn("mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md transition-opacity", fav ? "text-primary" : "text-faint opacity-0 hover:text-foreground group-hover/m:opacity-100 focus-visible:opacity-100 max-sm:opacity-100")}
                        >
                          <Star className={cn("h-3.5 w-3.5", fav && "fill-current")} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "templates" }));
              }}
              className="border-t border-border px-3 py-2 text-left text-[12px] font-medium text-primary hover:underline"
            >
              Créer ou modifier des modèles
            </button>
          </div>
          {/* Aperçu (ordinateur) : le texte tel qu'il sera inséré. */}
          <div className="hidden min-w-0 flex-1 overflow-y-auto p-3.5 sm:block">
            {hover ? (
              <>
                <div className="mb-2 text-[12.5px] font-semibold text-foreground">{hover.title}</div>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">{fillModel(hover.body, vars ?? {})}</p>
              </>
            ) : (
              <p className="pt-8 text-center text-[12.5px] text-faint">Survole un modèle pour le voir ici.</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

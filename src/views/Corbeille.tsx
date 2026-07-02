import { useEffect, useState } from "react";
import { RotateCcw, Trash2, Clock } from "lucide-react";
import { useAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import {
  TABLE_LABELS,
  TRASH_TTL_DAYS,
  daysLeft,
  restoreEntry,
  purgeEntry,
  emptyTrash,
  purgeExpired,
  type TrashEntry,
} from "@/lib/trash";

export function Corbeille() {
  const { data } = useAppState<TrashEntry[]>((s: AppState) => (s["trashBin"] as TrashEntry[]) ?? []);
  const [local, setLocal] = useState<TrashEntry[] | null>(null);
  const bin = local ?? data ?? [];
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  // Purge automatique des entrées de plus de 30 jours, au chargement.
  useEffect(() => {
    if (!data) return;
    let alive = true;
    purgeExpired(data).then((cleaned) => {
      if (alive && cleaned) setLocal(cleaned);
    });
    return () => {
      alive = false;
    };
  }, [data]);

  const restore = async (e: TrashEntry) => {
    if (await restoreEntry(e)) {
      setLocal(bin.filter((x) => x.id !== e.id));
      toast(`${TABLE_LABELS[e.table] ?? "Élément"} restauré ✓`);
    } else {
      toast("Restauration impossible — réessaie");
    }
  };
  const purge = async (e: TrashEntry) => {
    await purgeEntry(e.id);
    setLocal(bin.filter((x) => x.id !== e.id));
    toast("Supprimé définitivement");
  };
  const clearAll = async () => {
    await emptyTrash();
    setLocal([]);
    setConfirmEmpty(false);
    toast("Corbeille vidée");
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {bin.length === 0 ? "Corbeille vide" : `${bin.length} élément${bin.length > 1 ? "s" : ""} supprimé${bin.length > 1 ? "s" : ""}`}
        </div>
        {bin.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmEmpty(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-rose-500 transition-colors hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Vider la corbeille
          </button>
        )}
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-panel px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
        Les éléments supprimés sont conservés ici comme sauvegarde et effacés automatiquement au bout de {TRASH_TTL_DAYS} jours. Tu peux les restaurer ou les supprimer définitivement à tout moment.
      </div>

      {bin.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-14 text-center shadow-sm">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-rowhover text-faint">
            <Trash2 className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">Rien dans la corbeille</div>
          <div className="mt-1 text-xs text-faint">Ce que tu supprimes dans l'app atterrit ici (sauf mention contraire).</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {bin.map((e, i) => {
            const left = daysLeft(e);
            return (
              <div key={e.id} className={cn("flex items-center gap-3 px-4 py-3.5", i > 0 && "border-t border-border")}>
                <span className="shrink-0 whitespace-nowrap rounded-md bg-rowhover px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {TABLE_LABELS[e.table] ?? e.table}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-foreground">{e.label || "—"}</div>
                  <div className="mt-0.5 truncate text-[11px] text-faint">
                    {[e.sub, `supprimé le ${fmtDate(e.deletedAt)}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className={cn("hidden shrink-0 whitespace-nowrap text-[10px] font-semibold sm:inline", left <= 3 ? "text-rose-500" : "text-faint")}>
                  {left} j restant{left > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => restore(e)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Restaurer</span>
                </button>
                <ActionMenu
                  items={[
                    {
                      key: "purge",
                      label: "Supprimer définitivement",
                      icon: Trash2,
                      danger: true,
                      onClick: () => purge(e),
                      confirm: { title: "Suppression définitive", message: `Supprimer définitivement « ${e.label} » ? Impossible à annuler.` },
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      {confirmEmpty && (
        <ConfirmDialog
          title="Vider la corbeille"
          message={`Supprimer définitivement les ${bin.length} élément${bin.length > 1 ? "s" : ""} de la corbeille ? Cette action est irréversible.`}
          confirmLabel="Tout supprimer"
          danger
          onCancel={() => setConfirmEmpty(false)}
          onConfirm={clearAll}
        />
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Pencil, CalendarClock } from "lucide-react";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";

/**
 * Alertes d'échéance de contrats : on enregistre les contrats actifs (créateur,
 * type, date de début, durée) et l'app calcule la date de fin + alerte à 30/60 j.
 * Stocké dans le blob agence `contractDeadlines`.
 */

type Deadline = { id: string; creator: string; type: string; start: string; months: number; note?: string };

const TYPE_OPTIONS = [
  { value: "représentation", label: "Représentation" },
  { value: "marque", label: "Marque" },
  { value: "ugc", label: "UGC" },
];

let _uid = 0;
const uid = () => `ct${Date.now().toString(36)}${(_uid += 1)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

function endDate(start: string, months: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1 + (months || 0), Number(m[3]));
}
function daysLeft(d: Date): number {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type Blank = { creator: string; type: string; start: string; months: string; note: string };
const blank = (): Blank => ({ creator: "", type: "représentation", start: todayISO(), months: "12", note: "" });

export function Echeances() {
  const { data: stored } = useAppState<Deadline[]>((s: AppState) => (s["contractDeadlines"] as Deadline[]) ?? []);
  const [local, setLocal] = useState<Deadline[] | null>(null);
  const list = local ?? stored ?? [];
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Blank>(blank());
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  const creatorOptions = creators.map((c) => ({ value: c.name, label: titleCase(c.name) }));

  const rows = useMemo(() => {
    return list
      .map((d) => {
        const end = endDate(d.start, d.months);
        return { d, end, left: end ? daysLeft(end) : null };
      })
      .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  }, [list]);

  // Mutation sûre : relit le blob FRAIS avant de fusionner (la clé contractDeadlines
  // est aussi écrite par la fiche créateur → ne jamais partir de l'état local périmé).
  const mutate = async (fn: (fresh: Deadline[]) => Deadline[]): Promise<boolean> => {
    invalidateAppState();
    const fresh = ((await getAppState())["contractDeadlines"] as Deadline[]) ?? [];
    const next = fn(fresh);
    setLocal(next);
    const ok = await saveAppStateKey("contractDeadlines", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
  };

  const openAdd = () => {
    setEditId(null);
    setDraft(blank());
    setFormOpen(true);
  };
  const openEdit = (d: Deadline) => {
    setEditId(d.id);
    setDraft({ creator: d.creator, type: d.type, start: d.start, months: String(d.months), note: d.note ?? "" });
    setFormOpen(true);
  };
  const submit = async () => {
    if (!draft.creator) {
      toast("Choisis un créateur");
      return;
    }
    const months = Math.max(1, parseInt(draft.months, 10) || 0);
    const entry: Deadline = {
      id: editId ?? uid(),
      creator: draft.creator,
      type: draft.type,
      start: draft.start || todayISO(),
      months,
      note: draft.note.trim() || undefined,
    };
    const wasEdit = !!editId;
    setFormOpen(false);
    setEditId(null);
    const ok = await mutate((fresh) =>
      wasEdit ? fresh.map((x) => (x.id === entry.id ? entry : x)) : [entry, ...fresh],
    );
    if (ok) toast(wasEdit ? "Contrat mis à jour ✓" : "Contrat ajouté ✓");
  };
  const remove = async (id: string) => {
    const ok = await mutate((fresh) => fresh.filter((x) => x.id !== id));
    if (ok) toast("Contrat supprimé");
  };

  const badgeFor = (left: number | null) => {
    if (left == null) return { cls: "bg-rowhover text-muted-foreground", label: "Date invalide" };
    if (left < 0) return { cls: "bg-rose-500/15 text-rose-500", label: `Expiré depuis ${-left} j` };
    if (left <= 30) return { cls: "bg-rose-500/15 text-rose-500", label: `Expire dans ${left} j` };
    if (left <= 60) return { cls: "bg-amber/15 text-amber", label: `Expire dans ${left} j` };
    return { cls: "bg-signal/15 text-signaltext", label: `${left} j restants` };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="h-4 w-4 text-faint" />
          <span className="font-semibold text-foreground">{list.length}</span>
          <span>{list.length > 1 ? "contrats suivis" : "contrat suivi"}</span>
        </div>
        <AddButton label="Ajouter un contrat" onClick={openAdd} />
      </div>

      <InlineForm
        open={formOpen}
        title={editId ? "Modifier le contrat" : "Nouveau contrat suivi"}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSubmit={submit}
        submitLabel={editId ? "Enregistrer" : "Ajouter"}
      >
        <SelectField label="Créateur" value={draft.creator} onChange={(v) => setDraft({ ...draft, creator: v })} options={creatorOptions} className="sm:min-w-[180px]" />
        <SelectField label="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={TYPE_OPTIONS} className="sm:min-w-[150px]" />
        <TextField label="Date de début" type="date" value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} className="sm:min-w-[150px]" />
        <TextField label="Durée (mois)" type="number" value={draft.months} onChange={(v) => setDraft({ ...draft, months: v })} className="sm:min-w-[110px]" />
        <TextField label="Note (optionnel)" value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} className="sm:min-w-[150px]" />
      </InlineForm>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-sm">
          Aucun contrat suivi. Ajoute tes contrats de représentation pour être alerté avant leur échéance.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ d, end, left }) => {
            const badge = badgeFor(left);
            return (
              <div key={d.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{titleCase(d.creator)}</span>
                    <span className="rounded-md bg-rowhover px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{d.type}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-faint">
                    {frDate(new Date(d.start.replace(/-/g, "/")))} → {end ? frDate(end) : "—"} · {d.months} mois
                    {d.note ? ` · ${d.note}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  <span className={"rounded-full px-3 py-1 text-[12px] font-bold " + badge.cls}>{badge.label}</span>
                  <button
                    type="button"
                    onClick={() => openEdit(d)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Modifier"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <DeleteButton onClick={() => setPendingDel({ message: `Supprimer le suivi du contrat de ${titleCase(d.creator)} ?`, run: () => remove(d.id) })} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingDel && (
        <ConfirmDialog
          title="Supprimer le contrat"
          message={pendingDel.message}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </div>
  );
}

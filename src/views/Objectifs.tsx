import { useState } from "react";
import { Target, Pencil } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  useAppState,
  saveAppStateKey,
  parseAmount,
  type AppState,
} from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, DeleteButton } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";

/** Un objectif du mois : intitulé, CA réalisé, cible, progression (%) et ton. */
type Objective = {
  name: string;
  ca: string;
  target: string;
  pct: number;
  tone: string;
};

/** Blob 'objByMonth' : indexé par offset de mois ("0" = mois courant). */
type ObjByMonth = Record<string, Objective[]>;

/** Valeurs de départ utiles quand le blob est vide (mois courant). */
const SEED: Objective[] = [
  { name: "CA LÉNA MARCHAND", ca: "38 000 €", target: "50 000 €", pct: 76, tone: "indigo" },
  { name: "DEALS SIGNÉS", ca: "7", target: "10", pct: 70, tone: "indigo" },
  { name: "MARGE AGENCE", ca: "9 200 €", target: "12 000 €", pct: 77, tone: "indigo" },
];

export function Objectifs() {
  const { data, loading, error } = useAppState<ObjByMonth>(
    (s: AppState) => (s["objByMonth"] as ObjByMonth) ?? {}
  );

  // Copie locale : le blob n'est chargé qu'une fois, on maintient l'état ici.
  const [local, setLocal] = useState<ObjByMonth | null>(null);
  const obj: ObjByMonth = local ?? data ?? {};
  const list: Objective[] = obj["0"] ?? (Object.keys(obj).length === 0 ? SEED : []);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [ca, setCa] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  const avgPct =
    list.length > 0
      ? Math.round(list.reduce((a, o) => a + (Number(o.pct) || 0), 0) / list.length)
      : 0;

  function openAdd() {
    setEditIndex(null);
    setName("");
    setTarget("");
    setCa("");
    setFormOpen(true);
  }
  function startEdit(index: number) {
    const o = list[index];
    setEditIndex(index);
    setName(o.name);
    setTarget(o.target);
    setCa(o.ca === "—" ? "" : o.ca);
    setFormOpen(true);
  }
  async function submit() {
    const nm = name.trim();
    const tg = target.trim();
    if (!nm) {
      toast("Renseigne l'intitulé de l'objectif");
      return;
    }
    if (!tg) {
      toast("Renseigne une cible");
      return;
    }
    const caVal = ca.trim();
    const pct = tg ? Math.round((parseAmount(caVal) / parseAmount(tg)) * 100) || 0 : 0;
    const item: Objective = {
      name: nm.toUpperCase(),
      ca: caVal || "—",
      target: tg,
      pct: Number.isFinite(pct) ? pct : 0,
      tone: "indigo",
    };
    const isEdit = editIndex != null;
    const next: Objective[] = isEdit ? list.map((o, i) => (i === editIndex ? item : o)) : [item, ...list];
    const nextObj: ObjByMonth = { ...obj, "0": next };
    setLocal(nextObj);
    setName("");
    setTarget("");
    setCa("");
    setEditIndex(null);
    setFormOpen(false);
    const ok = await saveAppStateKey("objByMonth", nextObj);
    toast(ok ? (isEdit ? "Objectif mis à jour ✓" : "Objectif ajouté ✓") : "Erreur — réessaie");
  }

  async function remove(index: number) {
    const next = list.filter((_, i) => i !== index);
    const nextObj: ObjByMonth = { ...obj, "0": next };
    setLocal(nextObj);
    const ok = await saveAppStateKey("objByMonth", nextObj);
    toast(ok ? "Supprimé" : "Erreur — réessaie");
  }

  return (
    <div className="space-y-4">
      {/* En-tête : résumé + action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {loading ? (
            <AnimatedBadge status="loading" size="sm">
              Chargement…
            </AnimatedBadge>
          ) : (
            <>
              <span className="font-semibold text-foreground">{list.length}</span>
              <span>{list.length > 1 ? "objectifs" : "objectif"}</span>
              <span className="text-faint">·</span>
              <span>Progression moyenne</span>
              <span className="font-semibold text-signaltext">{avgPct}%</span>
            </>
          )}
        </div>
        <AddButton label="Objectif" onClick={openAdd} />
      </div>

      <InlineForm
        open={formOpen}
        title={editIndex != null ? "Modifier l'objectif" : "Nouvel objectif"}
        onClose={() => {
          setFormOpen(false);
          setEditIndex(null);
        }}
        onSubmit={submit}
        submitLabel={editIndex != null ? "Enregistrer" : "Ajouter"}
      >
        <TextField
          label="Intitulé"
          value={name}
          onChange={setName}
          placeholder="Ex : CA Léna Marchand"
          className="min-w-[220px] flex-[2]"
        />
        <TextField
          label="Cible"
          value={target}
          onChange={setTarget}
          placeholder="50 000 €"
          className="min-w-[140px] flex-none"
        />
        <TextField
          label="CA réalisé (optionnel)"
          value={ca}
          onChange={setCa}
          placeholder="38 000 €"
          className="min-w-[140px] flex-none"
        />
      </InlineForm>

      {/* Contenu */}
      {loading ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <AnimatedBadge status="danger" size="sm">
            Erreur de chargement
          </AnimatedBadge>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-signalsoft text-signaltext">
            <Target className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">Aucun objectif ce mois-ci</div>
          <div className="mt-1.5 text-xs text-faint">
            Ajoute un objectif avec le bouton « + Objectif ».
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold text-foreground">Objectifs par créateur</div>
          <ul className="divide-y divide-border">
            {list.map((o, index) => {
              const pct = Math.max(0, Math.min(100, Number(o.pct) || 0));
              // Code couleur : ≥70% bleu · 50–70% orange · <50% rouge
              const tone =
                pct >= 70
                  ? { ind: "bg-primary", track: "bg-primary/15", text: "text-primary" }
                  : pct >= 50
                    ? { ind: "bg-amber", track: "bg-amber/15", text: "text-amber" }
                    : { ind: "bg-rose-500", track: "bg-rose-500/15", text: "text-rose-500" };
              return (
                <li
                  key={`${o.name}-${index}`}
                  className="flex flex-col gap-3 py-3.5 md:flex-row md:items-center md:gap-4"
                >
                  <span className="truncate text-[13px] font-semibold text-foreground md:w-44">
                    {o.name}
                  </span>
                  <Progress value={pct} className={"h-2 flex-1 " + tone.track} indicatorClassName={tone.ind} />
                  <div className="flex items-center justify-between gap-4 md:justify-end">
                    <span className={"w-12 shrink-0 text-right text-[13px] font-semibold " + tone.text}>
                      {pct}%
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-right text-[11px] text-faint">
                      {o.ca} / {o.target}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(index)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                      title="Modifier l'avancement"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <DeleteButton onClick={() => setPendingDel({ message: `Supprimer l'objectif « ${o.name} » ? Cette action est irréversible.`, run: () => remove(index) })} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {pendingDel && (
        <ConfirmDialog
          title="Supprimer l'objectif"
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

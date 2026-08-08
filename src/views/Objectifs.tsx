import { useState, lazy, Suspense } from "react";
import { Target, Pencil, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  useAppState,
  saveAppStateKey,
  getAppState,
  invalidateAppState,
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

/**
 * Blob 'objByMonth' : indexé par mois ABSOLU ("AAAA-MM"). Ancien format = clé
 * "0" (offset = mois courant) → repli/migration transparente vers le mois courant.
 */
type ObjByMonth = Record<string, Objective[]>;

const ObjectivesTrend = lazy(() => import("./charts/ObjectivesTrend"));

const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const CURRENT_KEY = monthKeyOf();
const isMonthKey = (k: string) => /^\d{4}-\d{2}$/.test(k);
function monthTitle(key: string) {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function monthShort(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  const mois = d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
  return y === new Date().getFullYear() ? mois : `${mois} ${String(y).slice(2)}`;
}
/** Progression moyenne (%) par mois, tous mois avec données (legacy "0" → mois courant si absent). */
function monthlyTrend(obj: ObjByMonth) {
  const map = new Map<string, Objective[]>();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && isMonthKey(k)) map.set(k, v);
  }
  if (!map.has(CURRENT_KEY) && Array.isArray(obj["0"]) && obj["0"].length) map.set(CURRENT_KEY, obj["0"]);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, arr]) => ({
      month: key,
      label: monthShort(key),
      pct: Math.round(arr.reduce((s, o) => s + (Number(o.pct) || 0), 0) / arr.length),
    }));
}

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

  // Mois sélectionné (clé absolue "AAAA-MM"). Par défaut : mois courant.
  const [selectedMonth, setSelectedMonth] = useState<string>(CURRENT_KEY);
  // Liste du mois choisi (repli legacy "0" pour le mois courant ; SEED si blob vide).
  const monthList: Objective[] | undefined =
    obj[selectedMonth] ?? (selectedMonth === CURRENT_KEY ? obj["0"] : undefined);
  const list: Objective[] =
    monthList ?? (Object.keys(obj).length === 0 && selectedMonth === CURRENT_KEY ? SEED : []);
  const trend = monthlyTrend(obj);

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
    // Relecture fraîche avant merge (évite d'écraser une écriture concurrente).
    invalidateAppState();
    const freshObj = ((await getAppState())["objByMonth"] as ObjByMonth) ?? {};
    const useLegacy = selectedMonth === CURRENT_KEY && freshObj[selectedMonth] === undefined && Array.isArray(freshObj["0"]);
    const freshList = freshObj[selectedMonth] ?? (useLegacy ? freshObj["0"] : []) ?? [];
    const next: Objective[] = isEdit ? freshList.map((o, i) => (i === editIndex ? item : o)) : [item, ...freshList];
    const nextObj: ObjByMonth = { ...freshObj, [selectedMonth]: next };
    if (useLegacy) delete nextObj["0"]; // migre l'ancien format vers la clé absolue
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
    invalidateAppState();
    const freshObj = ((await getAppState())["objByMonth"] as ObjByMonth) ?? {};
    const useLegacy = selectedMonth === CURRENT_KEY && freshObj[selectedMonth] === undefined && Array.isArray(freshObj["0"]);
    const freshList = freshObj[selectedMonth] ?? (useLegacy ? freshObj["0"] : []) ?? [];
    const next = freshList.filter((_, i) => i !== index);
    const nextObj: ObjByMonth = { ...freshObj, [selectedMonth]: next };
    if (useLegacy) delete nextObj["0"];
    setLocal(nextObj);
    const ok = await saveAppStateKey("objByMonth", nextObj);
    toast(ok ? "Supprimé" : "Erreur — réessaie");
  }

  return (
    <div className="space-y-4">
      {/* En-tête : résumé + sélecteur de mois + action */}
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
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={selectedMonth}
            max={CURRENT_KEY}
            onChange={(e) => setSelectedMonth(e.target.value || CURRENT_KEY)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-foreground outline-none focus:border-primary"
            title="Choisir le mois"
          />
          <AddButton label="Objectif" onClick={openAdd} />
        </div>
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
          <div className="text-sm font-medium text-foreground">Aucun objectif — {monthTitle(selectedMonth)}</div>
          <div className="mt-1.5 text-xs text-faint">
            Ajoute un objectif avec le bouton « + Objectif ».
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">Objectifs par créateur</div>
            <div className="rounded-full bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{monthTitle(selectedMonth)}</div>
          </div>
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

      {/* Suivi dans le temps — progression moyenne par mois */}
      {!loading && !error && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-primary" /> Suivi des objectifs
          </div>
          <p className="mb-2 mt-0.5 text-[11px] text-faint">Progression moyenne par mois</p>
          {trend.length === 0 ? (
            <div className="grid h-[180px] place-items-center px-4 text-center text-xs text-muted-foreground">
              Renseigne l'avancement de tes objectifs — la courbe de progression apparaîtra ici, mois après mois.
            </div>
          ) : (
            <Suspense fallback={<div className="h-[200px] animate-pulse rounded-xl bg-panel/50" />}>
              <ObjectivesTrend points={trend} />
            </Suspense>
          )}
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

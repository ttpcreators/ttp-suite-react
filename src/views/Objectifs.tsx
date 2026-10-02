import { useEffect, useState, lazy, Suspense } from "react";
import { Target, Pencil, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  useAppState,
  saveAppStateKey,
  getAppState,
  invalidateAppState,
  parseAmount,
  formatEuro,
  type AppState,
} from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, DeleteButton } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { PageHeaderRow } from "@/components/ui/page-header";
import { MonthPicker } from "@/components/ui/date-range-picker";

/** Un objectif du mois : intitulé, CA réalisé, cible, progression (%) et ton. */
type Objective = {
  /** Id stable (généré à l'écriture pour les anciens objectifs qui n'en ont pas). */
  id?: string;
  name: string;
  ca: string;
  target: string;
  pct: number;
  tone: string;
  /** Anciens formats / imports : intitulé stocké sous `label` ou `creator`. */
  label?: string;
  creator?: string;
  /** Anciens formats / démo : réalisé sous un autre nom, unité éventuelle. */
  current?: string | number;
  value?: string | number;
  actual?: string | number;
  unit?: string;
  kind?: string;
};

/** Intitulé affichable, quel que soit le champ qui le porte. */
const objLabel = (o: Objective) => o.name || o.label || o.creator || "Sans intitulé";

/**
 * Blob 'objByMonth' : indexé par mois ABSOLU ("AAAA-MM"). Ancien format = clé
 * "0" (offset = mois courant) → repli/migration transparente vers le mois courant.
 */
type ObjByMonth = Record<string, Objective[]>;

const ObjectivesTrend = lazy(() => import("./charts/ObjectivesTrend"));

const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const CURRENT_KEY = monthKeyOf();
const isMonthKey = (k: string) => /^\d{4}-\d{2}$/.test(k);
/** Valeur saisie brute ("20000") → "20 000 €" si monétaire, sinon "20 000" ; texte libre laissé tel quel. */
const fmtAmount = (v: string, money = true) =>
  /^\s*\d+(?:[.,]\d+)?\s*$/.test(v ?? "")
    ? money
      ? formatEuro(parseAmount(v))
      : parseAmount(v).toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")
    : v;
/** Objectif monétaire ? (unité explicite, intitulé CA/chiffre/€, ou valeur contenant €). */
function isMoneyObj(o: Objective): boolean {
  const unit = `${o.unit ?? ""} ${o.kind ?? ""}`.toLowerCase();
  if (unit.trim()) return /€|eur|money|ca\b|montant/.test(unit);
  if (/\bCA\b|€|chiffre|marge|revenu/i.test(objLabel(o))) return true;
  return [o.ca, o.target, o.current, o.value, o.actual].some((v) => String(v ?? "").includes("€"));
}
/** Réalisé brut (champ `ca`, ou anciens noms) ; "" si absent. */
function achievedOf(o: Objective): string {
  for (const v of [o.ca, o.current, o.actual, o.value]) {
    const t = v == null ? "" : String(v).trim();
    if (t && t !== "—") return t;
  }
  return "";
}
/** "38 000 € / 50 000 €", ou "Objectif 50 000 €" sans réalisé. */
function progressLabel(o: Objective): string {
  const money = isMoneyObj(o);
  const tg = fmtAmount(String(o.target ?? ""), money);
  const done = achievedOf(o);
  return done ? `${fmtAmount(done, money)} / ${tg}` : `Objectif ${tg}`;
}
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
      // Chaque objectif borné 0..100 comme les lignes (un dépassement ne gonfle pas la moyenne).
      pct: Math.round(arr.reduce((s, o) => s + Math.max(0, Math.min(100, Number(o.pct) || 0)), 0) / arr.length),
    }));
}

// Plus de données de démo (SEED) : éditer/supprimer une ligne fictive réécrivait
// une liste vide. Blob vide → état vide avec une indication.

let _objSeq = 0;
function newObjId(): string {
  _objSeq += 1;
  return `obj${Date.now().toString(36)}${_objSeq}`;
}
/** Même objectif : par id si les deux en ont un, sinon par contenu (anciens sans id). */
function sameObj(a: Objective, b: Objective): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.name === b.name && a.ca === b.ca && a.target === b.target;
}
function withIds(list: Objective[]): Objective[] {
  return list.map((o) => (o.id ? o : { ...o, id: newObjId() }));
}

export function Objectifs() {
  const { data, loading, error } = useAppState<ObjByMonth>(
    (s: AppState) => (s["objByMonth"] as ObjByMonth) ?? {}
  );

  // Copie locale : le blob n'est chargé qu'une fois, on maintient l'état ici.
  const [local, setLocal] = useState<ObjByMonth | null>(null);
  const obj: ObjByMonth = local ?? data ?? {};
  // Nouvelle donnée live (tick suivant l'écriture) → on lâche la copie locale.
  useEffect(() => {
    setLocal(null);
  }, [data]);

  // Mois sélectionné (clé absolue "AAAA-MM"). Par défaut : mois courant.
  const [selectedMonth, setSelectedMonth] = useState<string>(CURRENT_KEY);
  // Liste du mois choisi (repli legacy "0" pour le mois courant).
  const list: Objective[] =
    obj[selectedMonth] ?? (selectedMonth === CURRENT_KEY ? obj["0"] : undefined) ?? [];
  const trend = monthlyTrend(obj);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [ca, setCa] = useState("");
  // Objectif en cours d'édition (repéré par id, pas par index).
  const [editing, setEditing] = useState<Objective | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  const avgPct =
    list.length > 0
      ? Math.round(list.reduce((a, o) => a + Math.max(0, Math.min(100, Number(o.pct) || 0)), 0) / list.length) // borné 0..100 comme les lignes
      : 0;

  function openAdd() {
    setEditing(null);
    setName("");
    setTarget("");
    setCa("");
    setFormOpen(true);
  }
  function startEdit(o: Objective) {
    setEditing(o);
    setName(objLabel(o));
    setTarget(String(o.target ?? ""));
    setCa(achievedOf(o));
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
    const target0 = editing;
    const isEdit = target0 != null;
    if (saving) return;
    setSaving(true);
    const ok = await writeMonth((freshList) =>
      target0
        ? freshList.map((o) => (sameObj(o, target0) ? { ...item, id: o.id } : o))
        : [{ ...item, id: newObjId() }, ...freshList],
    );
    setSaving(false);
    if (!ok) {
      toast("Erreur, réessaie"); // formulaire conservé
      return;
    }
    setName("");
    setTarget("");
    setCa("");
    setEditing(null);
    setFormOpen(false);
    toast(isEdit ? "Objectif mis à jour ✓" : "Objectif ajouté ✓");
  }

  // Relecture fraîche avant merge (évite d'écraser une écriture concurrente), ids
  // générés pour les anciens objectifs, rollback si l'écriture échoue.
  async function writeMonth(mutate: (freshList: Objective[]) => Objective[]): Promise<boolean> {
    try {
      invalidateAppState();
      const freshObj = ((await getAppState())["objByMonth"] as ObjByMonth) ?? {};
      const useLegacy = selectedMonth === CURRENT_KEY && freshObj[selectedMonth] === undefined && Array.isArray(freshObj["0"]);
      const freshList = withIds(freshObj[selectedMonth] ?? (useLegacy ? freshObj["0"] : []) ?? []);
      const nextObj: ObjByMonth = { ...freshObj, [selectedMonth]: mutate(freshList) };
      if (useLegacy) delete nextObj["0"]; // migre l'ancien format vers la clé absolue
      setLocal(nextObj);
      const ok = await saveAppStateKey("objByMonth", nextObj);
      if (!ok) setLocal(null); // rollback sur les données live
      return ok;
    } catch {
      setLocal(null);
      return false;
    }
  }

  async function remove(o: Objective) {
    const ok = await writeMonth((freshList) => freshList.filter((x) => !sameObj(x, o)));
    toast(ok ? "Supprimé" : "Erreur, réessaie");
  }

  return (
    <div className="space-y-4">
      {/* En-tête : résumé + sélecteur de mois + action */}
      <PageHeaderRow>
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
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} max={CURRENT_KEY} />
          <AddButton label="Objectif" onClick={openAdd} />
        </div>
      </PageHeaderRow>

      <InlineForm
        open={formOpen}
        title={editing != null ? "Modifier l'objectif" : "Nouvel objectif"}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={submit}
        submitLabel={editing != null ? "Enregistrer" : "Ajouter"}
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
          <div className="text-sm font-medium text-foreground">Aucun objectif pour {monthTitle(selectedMonth)}</div>
          <div className="mt-1.5 text-xs text-faint">
            Ajoute un objectif avec le bouton « + Objectif » (ex : CA d'une créatrice, deals signés, marge agence).
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">Objectifs par créateur</div>
            <div className="rounded-full bg-panel px-2.5 py-1 text-[12px] font-medium text-muted-foreground">{monthTitle(selectedMonth)}</div>
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
                  key={o.id ?? `${o.name}-${index}`}
                  className="flex flex-col gap-3 py-3.5 md:flex-row md:items-center md:gap-4"
                >
                  <span className="block min-w-0 truncate text-[13px] font-semibold text-foreground md:w-44 md:shrink-0">
                    {objLabel(o)}
                  </span>
                  <div className="flex min-w-0 items-center gap-3 md:contents">
                  <Progress value={pct} className={"h-2 w-auto min-w-0 flex-1 " + tone.track} indicatorClassName={tone.ind} />
                  <div className="flex shrink-0 items-center justify-end gap-2 md:gap-4">
                    <span className={"w-10 shrink-0 text-right text-[13px] font-semibold md:w-12 " + tone.text}>
                      {pct}%
                    </span>
                    <span className="max-w-28 shrink-0 truncate whitespace-nowrap text-right text-[11px] tabular-nums text-faint md:w-36 md:max-w-none" title={progressLabel(o)}>
                      {progressLabel(o)}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(o)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                      title="Modifier l'avancement"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <DeleteButton onClick={() => setPendingDel({ message: `Supprimer l'objectif « ${objLabel(o)} » ? Cette action est irréversible.`, run: () => remove(o) })} />
                  </div>
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

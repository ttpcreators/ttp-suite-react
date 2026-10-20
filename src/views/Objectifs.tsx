import { useEffect, useState } from "react";
import { Target, Pencil, ChevronLeft, ChevronRight, Euro, Handshake, PiggyBank, PenLine, type LucideIcon } from "@/components/icons";
import {
  useAppState,
  mergeAppStateKey,
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
import { IconTile } from "@/components/ui/icon-tile";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/lib/statusTone";
import {
  averagePct,
  bestMonth,
  clampPct,
  monthlyAverages,
  objectiveStatus,
  trendBars,
  type ObjectiveStatus,
} from "@/lib/objectivesTrend";
import { cn } from "@/lib/utils";
import ObjectivesTrend from "./charts/ObjectivesTrend";

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

const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const CURRENT_KEY = monthKeyOf();
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
/** « octobre », ou « octobre 2025 » hors de l'année en cours (texte courant, en minuscules). */
function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  const mois = new Date(y, (m || 1) - 1, 1).toLocaleDateString("fr-FR", { month: "long" });
  return y === new Date().getFullYear() ? mois : `${mois} ${y}`;
}
/** « d'octobre », « de septembre » : élision devant une voyelle. */
const ofMonth = (key: string) => {
  const n = monthName(key);
  return /^[aeiouyâàéèêh]/i.test(n) ? `d'${n}` : `de ${n}`;
};

/**
 * Modèles proposés quand le mois est vide. Les objectifs n'ont PAS de type en
 * base : un objectif = intitulé libre + cible + réalisé (le caractère monétaire
 * est déduit de l'intitulé par `isMoneyObj`). Un modèle pré-remplit donc
 * simplement le formulaire existant : intitulé + exemples adaptés.
 */
type Template = {
  key: string;
  title: string;
  descr: string;
  icon: LucideIcon;
  tone: StatusTone;
  /** Intitulé pré-rempli (vide pour l'objectif libre). */
  name: string;
  namePh: string;
  targetPh: string;
  caPh: string;
};
const TEMPLATES: Template[] = [
  {
    key: "ca",
    title: "CA d'un créateur",
    descr: "Le chiffre d'affaires d'un créateur sur le mois.",
    icon: Euro,
    tone: "ok",
    name: "CA ",
    namePh: "Ex : CA Léna Marchand",
    targetPh: "20 000 €",
    caPh: "12 000 €",
  },
  {
    key: "deals",
    title: "Deals signés",
    descr: "Le nombre de collabs signées ce mois-ci.",
    icon: Handshake,
    tone: "progress",
    name: "Deals signés",
    namePh: "Ex : Deals signés",
    targetPh: "8",
    caPh: "3",
  },
  {
    key: "marge",
    title: "Marge agence",
    descr: "Ta commission totale, hors TVA.",
    icon: PiggyBank,
    tone: "info",
    name: "Marge agence",
    namePh: "Ex : Marge agence",
    targetPh: "6 000 €",
    caPh: "2 500 €",
  },
  {
    key: "libre",
    title: "Objectif libre",
    descr: "Contacts, posts, nouveaux créateurs… ce que tu veux.",
    icon: PenLine,
    tone: "wait",
    name: "",
    namePh: "Ex : Nouveaux créateurs signés",
    targetPh: "5",
    caPh: "2",
  },
];

/** Pastille d'un objectif : vert atteint, orange en retard / non atteint. */
const STATUS_PILL: Record<ObjectiveStatus, { tone: StatusTone; label: string }> = {
  reached: { tone: "ok", label: "Atteint" },
  onTrack: { tone: "progress", label: "En bonne voie" },
  behind: { tone: "wait", label: "En retard" },
  missed: { tone: "wait", label: "Non atteint" },
};

/** Anneau de progression (jetons : piste `text-field`, arc `text-primary` ou `text-ok` si atteint). */
function ProgressRing({ pct, reached }: { pct: number; reached: boolean }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-[56px] w-[56px] shrink-0 place-items-center" aria-hidden>
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" stroke="currentColor" className="text-field" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className={cn("transition-[stroke-dashoffset] duration-500 ease-out", reached ? "text-ok" : "text-primary")}
        />
      </svg>
      <span className="text-[11px] font-bold tabular-nums text-foreground">{pct}&nbsp;%</span>
    </span>
  );
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
  // Réussite mois par mois (calcul pur dans lib/objectivesTrend).
  const points = monthlyAverages(obj, CURRENT_KEY);
  const best = bestMonth(points);
  const bars = trendBars(points, CURRENT_KEY).map((b) => ({ ...b, label: monthShort(b.month), title: monthTitle(b.month) }));

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [ca, setCa] = useState("");
  // Objectif en cours d'édition (repéré par id, pas par index).
  const [editing, setEditing] = useState<Objective | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);
  // Modèle choisi dans l'état vide (adapte les exemples du formulaire), null sinon.
  const [tpl, setTpl] = useState<Template | null>(null);

  const avgPct = averagePct(list); // chaque objectif borné 0..100 comme les lignes

  function openAdd() {
    setEditing(null);
    setTpl(null);
    setName("");
    setTarget("");
    setCa("");
    setFormOpen(true);
  }
  /** « Utiliser ce modèle » : ouvre le formulaire d'ajout habituel, intitulé pré-rempli. */
  function applyTemplate(t: Template) {
    setEditing(null);
    setTpl(t);
    setName(t.name);
    setTarget("");
    setCa("");
    setFormOpen(true);
  }
  function startEdit(o: Objective) {
    setEditing(o);
    setTpl(null);
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
      name: nm,
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
    setTpl(null);
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
      const monthList = mutate(freshList);
      const nextObj: ObjByMonth = { ...freshObj, [selectedMonth]: monthList };
      if (useLegacy) delete nextObj["0"]; // migre l'ancien format vers la clé absolue
      setLocal(nextObj);
      // N'envoie QUE le mois modifié (et retire l'ancienne clé "0" migrée), fusion côté base.
      const ok = await mergeAppStateKey("objByMonth", { [selectedMonth]: monthList }, useLegacy ? ["0"] : []);
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

  // Sélecteur de mois (‹ Octobre 2026 ›) : jamais au-delà du mois courant.
  const shiftMonth = (n: number) => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const next = monthKeyOf(new Date(y, m - 1 + n, 1));
    if (next <= CURRENT_KEY) setSelectedMonth(next);
  };
  const stepBtn =
    "grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";
  const card = "rounded-[22px] bg-surface p-5";
  const today = new Date();

  return (
    <div className="space-y-4">
      {/* En-tête : sélecteur de mois + action */}
      <PageHeaderRow>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center rounded-full bg-surface px-1">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mois précédent" className={stepBtn}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[116px] px-1 text-center text-[13px] font-semibold tabular-nums text-foreground">
              {monthTitle(selectedMonth)}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              disabled={selectedMonth >= CURRENT_KEY}
              aria-label="Mois suivant"
              className={stepBtn}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <AddButton label="Objectif" onClick={openAdd} />
        </div>
      </PageHeaderRow>

      <InlineForm
        open={formOpen}
        title={editing != null ? "Modifier l'objectif" : tpl ? `Nouvel objectif : ${tpl.title}` : "Nouvel objectif"}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setTpl(null);
        }}
        onSubmit={submit}
        submitLabel={editing != null ? "Enregistrer" : "Ajouter"}
      >
        <TextField
          label="Intitulé"
          value={name}
          onChange={setName}
          placeholder={tpl?.namePh ?? "Ex : CA Léna Marchand"}
          className="min-w-[220px] flex-[2]"
        />
        <TextField
          label="Cible"
          value={target}
          onChange={setTarget}
          placeholder={tpl?.targetPh ?? "50 000 €"}
          className="min-w-[140px] flex-none"
        />
        <TextField
          label="Réalisé (optionnel)"
          value={ca}
          onChange={setCa}
          placeholder={tpl?.caPh ?? "38 000 €"}
          className="min-w-[140px] flex-none"
        />
      </InlineForm>

      {/* Contenu */}
      {loading ? (
        <div className={card}>
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className={card}>
          <AnimatedBadge status="danger" size="sm">
            Erreur de chargement
          </AnimatedBadge>
        </div>
      ) : list.length === 0 ? (
        /* Mois vide : 4 modèles qui pré-remplissent le formulaire d'ajout */
        <section className={card}>
          <div className="flex items-start gap-3.5">
            <IconTile tone="ok">
              <Target />
            </IconTile>
            <div className="min-w-0">
              <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground">
                Pas encore d'objectif pour {monthName(selectedMonth)}
              </h2>
              <p className="mt-1 text-[14px] text-muted-foreground">Choisis un modèle : tu n'as plus qu'à mettre le chiffre.</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.key} className="flex min-w-0 flex-col rounded-[18px] border border-border p-4">
                  <IconTile tone={t.tone} size="sm">
                    <Icon />
                  </IconTile>
                  <div className="mt-3 text-[17px] font-bold leading-snug text-foreground">{t.title}</div>
                  <p className="mt-1 flex-1 text-[13px] leading-snug text-muted-foreground">{t.descr}</p>
                  <button
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="mt-4 h-9 w-full rounded-full bg-field text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover"
                  >
                    Utiliser ce modèle
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className={card}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[17px] font-bold text-foreground">Objectifs {ofMonth(selectedMonth)}</h2>
            <div className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{list.length}</span> {list.length > 1 ? "objectifs" : "objectif"}
              <span className="px-1.5 text-faint">·</span>
              <span className="font-semibold text-foreground">{avgPct}&nbsp;%</span> atteint en moyenne
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {list.map((o, index) => {
              const pct = clampPct(o.pct);
              const st = STATUS_PILL[objectiveStatus(pct, selectedMonth, today)];
              return (
                <li key={o.id ?? `${o.name}-${index}`} className="flex min-w-0 flex-col rounded-[18px] border border-border p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProgressRing pct={pct} reached={pct >= 100} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-foreground" title={objLabel(o)}>
                        {objLabel(o)}
                      </div>
                      <div className="mt-0.5 truncate text-[13px] tabular-nums text-muted-foreground" title={progressLabel(o)}>
                        {progressLabel(o)}
                      </div>
                    </div>
                    <StatusPill tone={st.tone} size="xs" className="self-start">
                      {st.label}
                    </StatusPill>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => startEdit(o)}
                      className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                      title="Modifier l'avancement"
                    >
                      <Pencil className="h-4 w-4" /> Mettre à jour
                    </button>
                    <DeleteButton onClick={() => setPendingDel({ message: `Supprimer l'objectif « ${objLabel(o)} » ? Cette action est irréversible.`, run: () => remove(o) })} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Réussite mois par mois : part moyenne atteinte, une barre par mois */}
      {!loading && !error && (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold text-foreground">Réussite mois par mois</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Part moyenne de tes objectifs atteinte chaque mois.</p>
            </div>
            {best && (
              <div className="text-[13px] text-muted-foreground">
                Meilleur mois : <span className="font-semibold text-foreground">{monthName(best.month)}, {best.pct}&nbsp;%</span>
              </div>
            )}
          </div>
          {bars.length === 0 ? (
            <div className="grid h-[180px] place-items-center px-4 text-center text-[13px] text-muted-foreground">
              Ajoute tes premiers objectifs : ta réussite mois par mois s'affichera ici.
            </div>
          ) : (
            <ObjectivesTrend bars={bars} selected={selectedMonth} onSelect={setSelectedMonth} />
          )}
        </section>
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

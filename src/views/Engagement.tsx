import { useEffect, useState } from "react";
import { Activity, Check, Save, Pencil, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCreators, invalidateCreators } from "@/lib/useCreators";
import { dbUpdate } from "@/lib/db";
import { useAppState, saveAppStateKey } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { SelectField } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { cn, titleCase } from "@/lib/utils";

/**
 * Calculateur de taux d'engagement — la formule ET les métriques DIFFÈRENT selon
 * la plateforme (Instagram = par reach, TikTok/YouTube = par vues, X = par
 * impressions ; métriques et seuils propres à chacune).
 *
 * Connecté au profil : quand un créateur est sélectionné, le résultat peut être
 * enregistré sur sa fiche (`creators.er` + `creators.stats`) → visible partout
 * (roster, media kit, portail).
 */

type PlatformKey = "instagram" | "tiktok" | "youtube" | "x";
type Field = { key: string; label: string };
type Platform = {
  key: PlatformKey;
  label: string;
  metrics: Field[]; // numérateur (interactions) — seulement ce qui est visible sans le reach
  formula: string;
  bon: number; // seuil "Bon" (%)
  excellent: number; // seuil "Excellent" (%)
};

// Taux d'engagement 30 jours : interactions 30 j ÷ VUES 30 j × 100.
// Les Insights (tableau de bord pro Instagram/TikTok) donnent les vues sur 30 j →
// c'est le standard actuel, précis quelle que soit la taille du compte.
// Les abonnés ne rentrent PAS dans le calcul (simple donnée de suivi).
const PLATFORMS: Platform[] = [
  {
    key: "instagram",
    label: "Instagram",
    metrics: [
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Commentaires" },
      { key: "saves", label: "Enregistrements" },
      { key: "shares", label: "Partages" },
    ],
    formula: "(likes + commentaires + enreg. + partages) sur 30 j ÷ vues × 100",
    bon: 3,
    excellent: 6,
  },
  {
    key: "tiktok",
    label: "TikTok",
    metrics: [
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Commentaires" },
      { key: "saves", label: "Enregistrements" },
    ],
    formula: "(likes + commentaires + enreg.) sur 30 j ÷ vues × 100",
    bon: 4.5,
    excellent: 9,
  },
  {
    key: "youtube",
    label: "YouTube",
    metrics: [
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Commentaires" },
    ],
    formula: "(likes + commentaires) sur 30 j ÷ vues × 100",
    bon: 2,
    excellent: 5,
  },
  {
    key: "x",
    label: "X",
    metrics: [
      { key: "likes", label: "Likes" },
      { key: "reposts", label: "Reposts" },
      { key: "replies", label: "Réponses" },
    ],
    formula: "(likes + reposts + réponses) sur 30 j ÷ vues × 100",
    bon: 0.5,
    excellent: 1.5,
  },
];

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

type HistEntry = {
  id: string;
  date: string;
  creator: string;
  creatorId?: string;
  platform: PlatformKey;
  platformLabel: string;
  er: string;
  verdict: string;
  detail: string;
  vals: Record<string, string>;
  followers: string;
};

function verdict(er: number, p: Platform): { label: string; hint: string; tone: "signal" | "amber" } {
  if (er >= p.excellent)
    return { label: "Excellent", hint: "Communauté très engagée — un argument fort en négociation.", tone: "signal" };
  if (er >= p.bon)
    return { label: "Bon", hint: "Engagement solide, dans les standards de la plateforme.", tone: "signal" };
  return { label: "Moyen", hint: "Sous la moyenne de la plateforme — à valoriser autrement (niche, régularité).", tone: "amber" };
}

export function Engagement() {
  const creators = useCreators();

  const [platformKey, setPlatformKey] = useState<PlatformKey>("instagram");
  const [creatorId, setCreatorId] = useState<string>("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [followers, setFollowers] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewEntry, setViewEntry] = useState<HistEntry | null>(null);

  const { data: histData } = useAppState<HistEntry[]>(
    (s) => ((s as Record<string, unknown>).engagementHistory as HistEntry[]) ?? [],
  );
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);
  useEffect(() => {
    if (histData) setHistory(histData);
  }, [histData]);

  const p = PLATFORMS.find((x) => x.key === platformKey) ?? PLATFORMS[0];
  const set = (k: string, v: string) => {
    setVals((s) => ({ ...s, [k]: v }));
    setSavedOk(false);
  };

  // Quand on choisit un créateur, on pré-remplit ses abonnés (suivi).
  useEffect(() => {
    if (!creatorId) return;
    let alive = true;
    supabase
      .from("creators")
      .select("followers")
      .eq("id", creatorId)
      .limit(1)
      .then(({ data }) => {
        if (!alive) return;
        const f = data?.[0]?.followers as string | undefined;
        if (f && /\d/.test(f) && !/[a-zA-Z]/.test(f)) setFollowers(String(f).replace(/[^\d]/g, ""));
      });
    return () => {
      alive = false;
    };
  }, [creatorId]);

  // Interactions 30 j ÷ vues 30 j (les abonnés ne comptent pas dans le taux).
  const interactions = p.metrics.reduce((a, m) => a + num(vals[m.key]), 0);
  const baseN = num(vals["views"]);
  const hasInputs = baseN > 0 && interactions > 0;
  const er = hasInputs ? Math.round((interactions / baseN) * 100 * 100) / 100 : 0;
  const erLabel = er.toFixed(2).replace(".", ",") + " %";
  const v = verdict(er, p);
  const detail = `(${p.metrics.map((m) => fmtInt(num(vals[m.key]))).join(" + ")}) sur 30 j ÷ ${fmtInt(baseN)} vues × 100`;

  const selectedCreator = creators.find((c) => c.id === creatorId) ?? null;

  /** Reconstruit l'objet `stats` de la fiche créateur à partir d'une entrée d'historique. */
  const statsFromEntry = (h: HistEntry) => {
    const pl = PLATFORMS.find((x) => x.key === h.platform) ?? PLATFORMS[0];
    return {
      er: h.er,
      base: num(h.vals?.["views"] ?? ""),
      baseLabel: "Vues (30 j)",
      platform: pl.key,
      platformLabel: pl.label,
      formula: pl.formula,
      detail: h.detail,
      metrics: pl.metrics.map((m) => ({ label: m.label, value: num(h.vals?.[m.key] ?? "") })),
      verdict: h.verdict,
      savedAt: h.date,
    };
  };

  const save = async () => {
    if (!hasInputs || saving) return;
    setSaving(true);
    // 1) Si un créateur est sélectionné → met à jour sa fiche (er + stats + followers).
    if (creatorId) {
      const stats = {
        er: erLabel,
        base: baseN,
        baseLabel: "Vues (30 j)",
        platform: p.key,
        platformLabel: p.label,
        formula: p.formula,
        detail,
        metrics: p.metrics.map((m) => ({ label: m.label, value: num(vals[m.key]) })),
        verdict: v.label,
        savedAt: new Date().toLocaleDateString("fr-FR"),
      };
      const patch: Record<string, unknown> = { er: erLabel, stats };
      if (num(followers) > 0) patch.followers = fmtInt(num(followers));
      const ok = await dbUpdate("creators", creatorId, patch);
      if (!ok) {
        setSaving(false);
        toast("Erreur — réessaie");
        return;
      }
      invalidateCreators();
    }
    // 2) Historique — met à jour l'entrée en cours d'édition, sinon crée une nouvelle.
    const entry: HistEntry = {
      id: editingId ?? uid(),
      date: new Date().toLocaleDateString("fr-FR"),
      creator: selectedCreator ? titleCase(selectedCreator.name) : "Calcul libre",
      creatorId: creatorId || undefined,
      platform: p.key,
      platformLabel: p.label,
      er: erLabel,
      verdict: v.label,
      detail,
      vals: { ...vals },
      followers,
    };
    const nextHist = editingId
      ? history.map((h) => (h.id === editingId ? entry : h))
      : [entry, ...history].slice(0, 100);
    setHistory(nextHist);
    await saveAppStateKey("engagementHistory", nextHist);
    setSaving(false);
    setSavedOk(true);
    setEditingId(null);
    toast(editingId ? "Mesure mise à jour ✓" : creatorId ? "Enregistré (fiche + historique) ✓" : "Ajouté à l'historique ✓");
  };

  const delHist = async (id: string) => {
    const target = history.find((h) => h.id === id);
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    if (editingId === id) setEditingId(null);
    await saveAppStateKey("engagementHistory", next);
    // Propage sur la fiche du créateur : réapplique la mesure restante la plus récente, sinon efface.
    if (target?.creatorId) {
      const latest = next.find((h) => h.creatorId === target.creatorId);
      if (latest) {
        const patch: Record<string, unknown> = { er: latest.er, stats: statsFromEntry(latest) };
        if (num(latest.followers) > 0) patch.followers = fmtInt(num(latest.followers));
        await dbUpdate("creators", target.creatorId, patch);
      } else {
        await dbUpdate("creators", target.creatorId, { er: null, stats: null });
      }
      invalidateCreators();
    }
    toast("Mesure supprimée");
  };
  const loadHist = (h: HistEntry) => {
    setPlatformKey(h.platform);
    setVals(h.vals ?? {});
    setFollowers(h.followers ?? "");
    setCreatorId(h.creatorId ?? "");
    setEditingId(h.id);
    setSavedOk(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setVals({});
    setFollowers("");
    setSavedOk(false);
  };

  return (
    <div className="space-y-4">
      {/* Plateforme + formule */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((pl) => {
            const active = pl.key === platformKey;
            return (
              <button
                key={pl.key}
                type="button"
                onClick={() => {
                  setPlatformKey(pl.key);
                  setSavedOk(false);
                }}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-[11px] font-semibold transition-colors",
                  active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-rowhover",
                )}
              >
                {pl.label}
              </button>
            );
          })}
        </div>
        <span className="rounded-full bg-signalsoft px-3 py-1.5 text-[10px] font-medium text-signaltext">{p.formula}</span>
      </div>

      {/* Créateur + champs */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="md:max-w-xs">
          <SelectField
            label="Créateur (optionnel)"
            value={creatorId}
            onChange={(v) => {
              setCreatorId(v);
              setSavedOk(false);
            }}
            options={[
              { value: "", label: "— Aucun (calcul libre)" },
              ...creators.map((c) => ({ value: c.id, label: titleCase(c.name) })),
            ]}
          />
        </div>

        {/* Interactions (visibles sans le reach) */}
        <div className="mt-4 flex flex-wrap gap-3">
          {p.metrics.map((m) => (
            <NumField key={m.key} label={m.label} value={vals[m.key] ?? ""} onChange={(x) => set(m.key, x)} className="min-w-[130px] flex-1" />
          ))}
        </div>

        {/* Base du calcul : vues 30 j — abonnés = simple suivi (hors calcul) */}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <NumField
            label="Vues (30 j)"
            value={vals["views"] ?? ""}
            onChange={(x) => set("views", x)}
            className="min-w-[130px] flex-1"
          />
          <NumField
            label="Abonnés (suivi)"
            value={followers}
            onChange={(x) => {
              setFollowers(x);
              setSavedOk(false);
            }}
            className="min-w-[130px] flex-1"
          />
          <p className="flex-[2] pb-2.5 text-[11px] leading-snug text-faint">
            Stats <span className="font-medium text-foreground">cumulées des 30 derniers jours</span> (Insights).
            Taux = interactions ÷ vues × 100. Les abonnés ne comptent pas dans le calcul — ils suivent l'évolution du créateur (mis à jour sur sa fiche).
          </p>
        </div>
      </div>

      {/* Résultat */}
      <div className="rounded-2xl border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Taux d'engagement · {p.label} · 30 jours</div>
            {hasInputs ? (
              <>
                <div className="mt-1 text-5xl font-bold tracking-tight text-foreground">{erLabel}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">{detail}</div>
              </>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="size-4 text-faint" />
                Renseigne les interactions et les vues (30 j) pour calculer le taux.
              </div>
            )}
          </div>

          {hasInputs && (
            <div className="flex flex-col items-start gap-2 md:items-end">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-semibold",
                  v.tone === "signal" ? "bg-signalsoft text-signaltext" : "bg-amber/15 text-amber",
                )}
              >
                {v.label}
              </span>
              <p className="max-w-[240px] text-[11px] leading-snug text-muted-foreground md:text-right">{v.hint}</p>
            </div>
          )}
        </div>

        {/* Barème propre à la plateforme */}
        <div className="mt-5 grid grid-cols-1 gap-2 border-t border-border pt-4 min-[380px]:grid-cols-3">
          {[
            { k: "Moyen", r: `< ${p.bon} %`, tone: "amber" as const },
            { k: "Bon", r: `${p.bon} – ${p.excellent} %`, tone: "signal" as const },
            { k: "Excellent", r: `> ${p.excellent} %`, tone: "signal" as const },
          ].map((b) => (
            <div key={b.k} className="text-center">
              <div className={cn("text-[11px] font-semibold", b.tone === "signal" ? "text-signaltext" : "text-amber")}>{b.k}</div>
              <div className="text-[10px] text-faint">{b.r}</div>
            </div>
          ))}
        </div>

        {/* Enregistrer — bouton TOUJOURS visible (désactivé tant que le calcul n'est pas complet). */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="text-[11px] text-muted-foreground">
            {editingId ? (
              <><span className="font-semibold text-primary">Modification en cours</span> — ajuste les valeurs puis « Mettre à jour ». </>
            ) : !hasInputs ? (
              <>Renseigne les interactions <span className="font-medium text-foreground">et</span> les vues (30 j) pour pouvoir enregistrer.</>
            ) : creatorId ? (
              <>Met à jour la fiche de <span className="font-semibold text-foreground">{titleCase(selectedCreator?.name ?? "")}</span> (roster · media kit · portail) + l'historique.</>
            ) : (
              <>Astuce : sélectionne un <span className="font-medium text-foreground">créateur</span> ci-dessus pour l'enregistrer sur sa fiche. Sinon, ajouté à l'historique seul.</>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                Annuler
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !hasInputs}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savedOk ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {savedOk ? "Enregistré" : saving ? "Enregistrement…" : editingId ? "Mettre à jour" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* Historique des calculs */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Historique des calculs</div>
            <span className="text-[11px] text-faint">{history.length} calcul{history.length > 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-col gap-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setViewEntry(h)}
                  title="Voir le détail du calcul"
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left transition-colors hover:opacity-80"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{h.creator}</span>
                      <span className="shrink-0 rounded-md bg-rowhover px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{h.platformLabel}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-faint">
                      <span className="font-semibold text-muted-foreground">Calculé le {h.date}</span> · {h.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-foreground">{h.er}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold", h.verdict === "Moyen" ? "bg-amber/15 text-amber" : "bg-signalsoft text-signaltext")}>
                    {h.verdict}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => loadHist(h)}
                  title="Modifier ce calcul"
                  className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-rowhover", editingId === h.id ? "text-primary" : "text-faint hover:text-foreground")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDel({ message: "Supprimer cette mesure de l'historique ? Cette action est irréversible.", run: () => delHist(h.id) })}
                  title="Supprimer"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {viewEntry && (
        <DetailModal
          entry={viewEntry}
          onClose={() => setViewEntry(null)}
          onEdit={() => {
            loadHist(viewEntry);
            setViewEntry(null);
          }}
          onDelete={() => {
            const id = viewEntry.id;
            setViewEntry(null);
            setPendingDel({ message: "Supprimer cette mesure de l'historique ? Cette action est irréversible.", run: () => delHist(id) });
          }}
        />
      )}
      {pendingDel && (
        <ConfirmDialog
          title="Supprimer la mesure"
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

/** Détail complet d'une mesure enregistrée (lecture) + accès à la modification / suppression. */
function DetailModal({
  entry,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: HistEntry;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pl = PLATFORMS.find((x) => x.key === entry.platform) ?? PLATFORMS[0];
  const cells = [
    ...pl.metrics.map((m) => ({ label: m.label, value: fmtInt(num(entry.vals?.[m.key] ?? "")) })),
    { label: "Vues (30 j)", value: fmtInt(num(entry.vals?.["views"] ?? "")) },
    { label: "Abonnés (suivi)", value: fmtInt(num(entry.followers ?? "")) },
  ];
  const isMoyen = entry.verdict === "Moyen";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{entry.creator}</span>
              <span className="shrink-0 rounded-md bg-rowhover px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{entry.platformLabel}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-faint">Calculé le {entry.date}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="text-4xl font-bold tracking-tight text-foreground">{entry.er}</div>
          <span className={cn("mb-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold", isMoyen ? "bg-amber/15 text-amber" : "bg-signalsoft text-signaltext")}>
            {entry.verdict}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">{entry.detail}</div>
        <div className="mt-3 rounded-lg bg-panel px-3 py-2 text-[10px] text-muted-foreground">{pl.formula}</div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {cells.map((c) => (
            <div key={c.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{c.label}</div>
              <div className="text-sm font-semibold text-foreground">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#E5484D] transition-colors hover:bg-rowhover"
          >
            <X className="h-3.5 w-3.5" /> Supprimer
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );
}

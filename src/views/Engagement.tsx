import { useEffect, useState } from "react";
import { Activity, Check, Save, RotateCcw, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCreators, invalidateCreators } from "@/lib/useCreators";
import { dbUpdate } from "@/lib/db";
import { useAppState, saveAppStateKey } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { SelectField } from "@/components/ui/form";
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
  metrics: Field[]; // numérateur (interactions)
  base: Field; // dénominateur
  formula: string;
  bon: number; // seuil "Bon" (%)
  excellent: number; // seuil "Excellent" (%)
};

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
    base: { key: "reach", label: "Reach (portée)" },
    formula: "(likes + commentaires + enreg. + partages) ÷ reach × 100",
    bon: 3,
    excellent: 6,
  },
  {
    key: "tiktok",
    label: "TikTok",
    metrics: [
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Commentaires" },
      { key: "shares", label: "Partages" },
      { key: "saves", label: "Enregistrements" },
    ],
    base: { key: "views", label: "Vues" },
    formula: "(likes + commentaires + partages + enreg.) ÷ vues × 100",
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
    base: { key: "views", label: "Vues" },
    formula: "(likes + commentaires) ÷ vues × 100",
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
    base: { key: "impressions", label: "Impressions" },
    formula: "(likes + reposts + réponses) ÷ impressions × 100",
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
  return { label: "Moyen", hint: "Sous la moyenne de la plateforme — à valoriser autrement (reach, niche).", tone: "amber" };
}

export function Engagement() {
  const creators = useCreators();

  const [platformKey, setPlatformKey] = useState<PlatformKey>("instagram");
  const [creatorId, setCreatorId] = useState<string>("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [followers, setFollowers] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const { data: histData } = useAppState<HistEntry[]>(
    (s) => ((s as Record<string, unknown>).engagementHistory as HistEntry[]) ?? [],
  );
  const [history, setHistory] = useState<HistEntry[]>([]);
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

  const interactions = p.metrics.reduce((a, m) => a + num(vals[m.key]), 0);
  const baseN = num(vals[p.base.key]);
  const hasInputs = baseN > 0 && interactions > 0;
  const er = hasInputs ? Math.round((interactions / baseN) * 100 * 100) / 100 : 0;
  const erLabel = er.toFixed(2).replace(".", ",") + " %";
  const v = verdict(er, p);
  const detail = `(${p.metrics.map((m) => fmtInt(num(vals[m.key]))).join(" + ")}) ÷ ${fmtInt(baseN)} × 100`;

  const selectedCreator = creators.find((c) => c.id === creatorId) ?? null;

  const save = async () => {
    if (!hasInputs || saving) return;
    setSaving(true);
    // 1) Si un créateur est sélectionné → met à jour sa fiche (er + stats).
    if (creatorId) {
      const stats = {
        er: erLabel,
        base: baseN,
        baseLabel: p.base.label,
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
    // 2) Historique (dans tous les cas).
    const entry: HistEntry = {
      id: uid(),
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
    const nextHist = [entry, ...history].slice(0, 100);
    setHistory(nextHist);
    await saveAppStateKey("engagementHistory", nextHist);
    setSaving(false);
    setSavedOk(true);
    toast(creatorId ? "Enregistré (fiche + historique) ✓" : "Ajouté à l'historique ✓");
  };

  const delHist = async (id: string) => {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    await saveAppStateKey("engagementHistory", next);
  };
  const loadHist = (h: HistEntry) => {
    setPlatformKey(h.platform);
    setVals(h.vals ?? {});
    setFollowers(h.followers ?? "");
    if (h.creatorId) setCreatorId(h.creatorId);
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

        {/* Métriques (dynamiques selon la plateforme) + base */}
        <div className="mt-4 flex flex-wrap gap-3">
          {p.metrics.map((m) => (
            <NumField key={m.key} label={m.label} value={vals[m.key] ?? ""} onChange={(x) => set(m.key, x)} className="min-w-[130px] flex-1" />
          ))}
          <NumField label={p.base.label} value={vals[p.base.key] ?? ""} onChange={(x) => set(p.base.key, x)} className="min-w-[130px] flex-1" />
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <NumField label="Abonnés (suivi)" value={followers} onChange={setFollowers} className="min-w-[130px] flex-1" />
          <p className="flex-[2] pb-2.5 text-[11px] text-faint">Donnée de suivi — n'entre pas dans le calcul du taux.</p>
        </div>
      </div>

      {/* Résultat */}
      <div className="rounded-2xl border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Taux d'engagement · {p.label}</div>
            {hasInputs ? (
              <>
                <div className="mt-1 text-5xl font-bold tracking-tight text-foreground">{erLabel}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">{detail}</div>
              </>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="size-4 text-faint" />
                Renseigne les interactions et {p.base.label.toLowerCase()} pour calculer le taux.
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
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
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

        {/* Enregistrer (fiche si créateur sélectionné + toujours dans l'historique) */}
        {hasInputs && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-[11px] text-muted-foreground">
              {creatorId ? (
                <>Enregistrer sur la fiche de <span className="font-semibold text-foreground">{titleCase(selectedCreator?.name ?? "")}</span> (roster · media kit · portail) + dans l'historique.</>
              ) : (
                "Enregistrer ce calcul dans l'historique (aucun créateur sélectionné)."
              )}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {savedOk ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {savedOk ? "Enregistré" : saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        )}
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
              <div key={h.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{h.creator}</span>
                    <span className="shrink-0 rounded-md bg-rowhover px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{h.platformLabel}</span>
                  </div>
                  <div className="truncate text-[10px] text-faint">{h.date} · {h.detail}</div>
                </div>
                <span className="shrink-0 text-sm font-bold text-foreground">{h.er}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold", h.verdict === "Moyen" ? "bg-amber/15 text-amber" : "bg-signalsoft text-signaltext")}>
                  {h.verdict}
                </span>
                <button
                  type="button"
                  onClick={() => loadHist(h)}
                  title="Recharger dans le calculateur"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => delHist(h.id)}
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

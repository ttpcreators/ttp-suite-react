import { useState } from "react";
import { Activity } from "lucide-react";
import { useCreators } from "@/lib/useCreators";
import { cn } from "@/lib/utils";

/**
 * Calculateur de taux d'engagement (onglet du Roster).
 *
 * ER = ((likes + commentaires) / reach) × 100, arrondi à 2 décimales.
 * Le champ « Abonnés (suivi) » est purement informatif : il N'entre PAS
 * dans le calcul (c'est une donnée de suivi, pas une base de reach).
 *
 * Tout est local : rien n'est persisté, l'outil sert à estimer un ER à la volée.
 */

type PlatformKey = "instagram" | "tiktok" | "youtube" | "x";

type Platform = {
  key: PlatformKey;
  label: string;
  /** Libellé de la base (reach) selon la plateforme. */
  base: string;
  /** Formule affichée en chip. */
  formula: string;
};

const PLATFORMS: Platform[] = [
  {
    key: "instagram",
    label: "Instagram",
    base: "Reach (portée)",
    formula: "(likes + commentaires) ÷ reach × 100",
  },
  {
    key: "tiktok",
    label: "TikTok",
    base: "Vues",
    formula: "(likes + commentaires) ÷ vues × 100",
  },
  {
    key: "youtube",
    label: "YouTube",
    base: "Vues",
    formula: "(likes + commentaires) ÷ vues × 100",
  },
  {
    key: "x",
    label: "X",
    base: "Impressions",
    formula: "(likes + commentaires) ÷ impressions × 100",
  },
];

/** Parse un champ numérique saisi (« 12 500 », « 1 200,5 ») en nombre. */
function num(v: string): number {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Formate un entier avec séparateurs d'espaces (« 12 500 »). */
function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Verdict + ton selon le seuil : excellent > 6 %, bon 3-6 %, moyen < 3 %. */
function verdict(er: number): { label: string; hint: string; tone: "signal" | "amber" } {
  if (er > 6)
    return {
      label: "Excellent",
      hint: "Communauté très engagée — un argument fort en négociation.",
      tone: "signal",
    };
  if (er >= 3)
    return {
      label: "Bon",
      hint: "Engagement solide, dans les standards attendus par les marques.",
      tone: "signal",
    };
  return {
    label: "Moyen",
    hint: "Engagement sous la moyenne — à valoriser autrement (reach, niche).",
    tone: "amber",
  };
}

export function Engagement() {
  const creators = useCreators();

  const [platform, setPlatform] = useState<PlatformKey>("instagram");
  const [creatorId, setCreatorId] = useState<string>("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");
  const [reach, setReach] = useState("");
  const [followers, setFollowers] = useState("");

  const cfg = PLATFORMS.find((p) => p.key === platform) ?? PLATFORMS[0];

  const likesN = num(likes);
  const commentsN = num(comments);
  const reachN = num(reach);
  const interactions = likesN + commentsN;

  // ER = round(((likes + commentaires) / reach) × 100, 2)
  const hasInputs = reachN > 0 && interactions > 0;
  const er = hasInputs ? Math.round((interactions / reachN) * 100 * 100) / 100 : 0;
  const erLabel = er.toFixed(2).replace(".", ",") + " %";

  const v = verdict(er);

  return (
    <div className="space-y-4">
      {/* Sélecteur PLATEFORME (pills) + formule en chip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const active = p.key === platform;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPlatform(p.key)}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-[11px] font-semibold transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-rowhover"
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="rounded-full bg-signalsoft px-3 py-1.5 text-[10px] font-medium text-signaltext">
          {cfg.formula}
        </span>
      </div>

      {/* Sélecteur CRÉATEUR (optionnel) */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">
            Créateur (optionnel)
          </span>
          <select
            value={creatorId}
            onChange={(e) => setCreatorId(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15 md:max-w-xs"
          >
            <option value="">— Aucun (calcul libre)</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Champs numériques */}
        <div className="mt-4 flex flex-wrap gap-3">
          <NumField
            label="Likes"
            value={likes}
            onChange={setLikes}
            placeholder="12 500"
            className="min-w-[130px] flex-1"
          />
          <NumField
            label="Commentaires"
            value={comments}
            onChange={setComments}
            placeholder="340"
            className="min-w-[130px] flex-1"
          />
          <NumField
            label={cfg.base}
            value={reach}
            onChange={setReach}
            placeholder="210 000"
            className="min-w-[130px] flex-1"
          />
        </div>

        {/* Abonnés (suivi) — n'entre PAS dans le calcul */}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <NumField
            label="Abonnés (suivi)"
            value={followers}
            onChange={setFollowers}
            placeholder="180 000"
            className="min-w-[130px] flex-1"
          />
          <p className="flex-[2] pb-2.5 text-[11px] text-faint">
            Donnée de suivi — n'entre pas dans le calcul du taux d'engagement.
          </p>
        </div>
      </div>

      {/* Résultat en GROS */}
      <div className="rounded-2xl border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">
              Taux d'engagement · {cfg.label}
            </div>
            {hasInputs ? (
              <>
                <div className="mt-1 text-5xl font-bold tracking-tight text-foreground">
                  {erLabel}
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  ({fmtInt(likesN)} + {fmtInt(commentsN)}) ÷ {fmtInt(reachN)} × 100
                </div>
              </>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="size-4 text-faint" />
                Renseigne likes, commentaires et {cfg.base.toLowerCase()} pour calculer le taux.
              </div>
            )}
          </div>

          {hasInputs && (
            <div className="flex flex-col items-start gap-2 md:items-end">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-semibold",
                  v.tone === "signal"
                    ? "bg-signalsoft text-signaltext"
                    : "bg-amber/15 text-amber"
                )}
              >
                {v.label}
              </span>
              <p className="max-w-[240px] text-[11px] leading-snug text-muted-foreground md:text-right">
                {v.hint}
              </p>
            </div>
          )}
        </div>

        {/* Barème d'interprétation */}
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
          {[
            { k: "Moyen", r: "< 3 %", tone: "amber" as const },
            { k: "Bon", r: "3 – 6 %", tone: "signal" as const },
            { k: "Excellent", r: "> 6 %", tone: "signal" as const },
          ].map((b) => (
            <div key={b.k} className="text-center">
              <div
                className={cn(
                  "text-[11px] font-semibold",
                  b.tone === "signal" ? "text-signaltext" : "text-amber"
                )}
              >
                {b.k}
              </div>
              <div className="text-[10px] text-faint">{b.r}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Petit champ numérique local (label + input) réutilisé dans l'outil. */
function NumField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );
}

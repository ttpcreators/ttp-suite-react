import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCreators } from "@/lib/useCreators";
import { formatEuro } from "@/lib/appState";
import { cn, titleCase } from "@/lib/utils";

/**
 * Calculateur de tarif influence — basé sur la méthode standard du marché 2026
 * (pas de chiffres aléatoires) :
 *   Prix = (abonnés / 1000) × CPM plateforme/format × multiplicateur de niche
 *          × multiplicateur d'engagement, puis options (exclusivité, droits).
 *
 * CPM (€/1000 abonnés), multiplicateurs de niche (0,7→1,5) et d'engagement
 * (0,7 <1% → 1,35 >8%) issus des barèmes 2026 (Influencer Marketing Hub,
 * InfluenceFlow, Shopify, Meltwater). Le résultat est une FOURCHETTE pour ne
 * pas sous-vendre. Auto-rempli depuis la fiche pour un créateur de l'agence ;
 * saisie manuelle pour un profil externe / autre agence.
 */

type Fmt = { key: string; label: string; cpm: [number, number] };
type Plat = { key: PlatKey; label: string; formats: Fmt[] };
type PlatKey = "instagram" | "tiktok" | "youtube" | "x";

const PLATFORMS: Plat[] = [
  {
    key: "instagram",
    label: "Instagram",
    formats: [
      { key: "reel", label: "Reel", cpm: [16, 32] },
      { key: "post", label: "Post feed", cpm: [9, 18] },
      { key: "carrousel", label: "Carrousel", cpm: [10, 20] },
      { key: "story", label: "Story (×3)", cpm: [7, 14] },
      { key: "pack", label: "Pack (reel + post + 3 stories)", cpm: [30, 58] },
    ],
  },
  {
    key: "tiktok",
    label: "TikTok",
    formats: [
      { key: "video", label: "Vidéo", cpm: [11, 23] },
      { key: "pack", label: "Pack (3 vidéos)", cpm: [30, 63] },
    ],
  },
  {
    key: "youtube",
    label: "YouTube",
    formats: [
      { key: "integration", label: "Intégration", cpm: [18, 37] },
      { key: "dedicated", label: "Vidéo dédiée", cpm: [55, 110] },
      { key: "short", label: "Short", cpm: [10, 22] },
    ],
  },
  { key: "x", label: "X", formats: [{ key: "post", label: "Post", cpm: [4, 9] }] },
];

const NICHES = [
  { value: "lifestyle", label: "Lifestyle", m: 1.0 },
  { value: "beaute", label: "Mode / Beauté", m: 1.1 },
  { value: "food", label: "Food", m: 1.0 },
  { value: "sport", label: "Sport / Fitness", m: 1.1 },
  { value: "voyage", label: "Voyage", m: 1.05 },
  { value: "tech", label: "Tech", m: 1.3 },
  { value: "finance", label: "Finance / B2B / Luxe", m: 1.5 },
  { value: "gaming", label: "Gaming", m: 0.9 },
  { value: "divertissement", label: "Divertissement / Meme", m: 0.7 },
];

function parseFollowers(s: string): number {
  const str = String(s ?? "").trim().replace(/\s/g, "").replace(",", ".").toLowerCase();
  const m = /^([\d.]+)\s*([km])?/.exec(str);
  if (!m) return 0;
  let n = parseFloat(m[1]) || 0;
  if (m[2] === "k") n *= 1000;
  else if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}
function parseEr(s: string): number {
  const m = /([\d.,]+)/.exec(String(s ?? ""));
  return m ? parseFloat(m[1].replace(",", ".")) || 0 : 0;
}
function engMult(er: number): number {
  if (er < 1) return 0.7;
  if (er < 2) return 0.85;
  if (er < 3.5) return 1.0;
  if (er < 6) return 1.15;
  if (er < 8) return 1.25;
  return 1.35;
}
function tier(f: number): string {
  if (f < 10_000) return "Nano";
  if (f < 100_000) return "Micro";
  if (f < 500_000) return "Mid-tier";
  if (f < 1_000_000) return "Macro";
  return "Méga";
}
function roundNice(n: number): number {
  if (n <= 0) return 0;
  const step = n < 1000 ? 10 : n < 10_000 ? 50 : 100;
  return Math.round(n / step) * step;
}

const EXTERNAL = "__external__";

export function Pricing() {
  const creators = useCreators();

  const [creatorId, setCreatorId] = useState<string>(EXTERNAL);
  const [platKey, setPlatKey] = useState<PlatKey>("instagram");
  const [fmtKey, setFmtKey] = useState<string>("reel");
  const [niche, setNiche] = useState<string>("lifestyle");
  const [followers, setFollowers] = useState<string>("");
  const [engagement, setEngagement] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [excl, setExcl] = useState(false);
  const [usage, setUsage] = useState(false);

  const plat = PLATFORMS.find((p) => p.key === platKey) ?? PLATFORMS[0];
  const fmt = plat.formats.find((f) => f.key === fmtKey) ?? plat.formats[0];

  // Auto-remplissage depuis la fiche d'un créateur de l'agence.
  useEffect(() => {
    if (creatorId === EXTERNAL) return;
    let alive = true;
    supabase
      .from("creators")
      .select("followers,er,niche")
      .eq("id", creatorId)
      .limit(1)
      .then(({ data }) => {
        if (!alive) return;
        const row = data?.[0] as { followers?: string; er?: string; niche?: string } | undefined;
        if (!row) return;
        if (row.followers) setFollowers(String(row.followers));
        if (row.er) setEngagement(String(row.er));
        if (row.niche) {
          const n = row.niche.toLowerCase();
          const match = NICHES.find((x) => x.label.toLowerCase().includes(n) || n.includes(x.value));
          if (match) setNiche(match.value);
        }
      });
    return () => {
      alive = false;
    };
  }, [creatorId]);

  const calc = useMemo(() => {
    const f = parseFollowers(followers);
    const er = parseEr(engagement);
    const nm = NICHES.find((x) => x.value === niche)?.m ?? 1;
    const em = engMult(er);
    const addon = 1 + (excl ? 0.25 : 0) + (usage ? 0.3 : 0);
    const q = Math.max(1, qty || 1);
    const unit = (cpm: number) => (f / 1000) * cpm * nm * em * addon;
    const min = roundNice(unit(fmt.cpm[0]) * q);
    const max = roundNice(unit(fmt.cpm[1]) * q);
    const mid = roundNice((min + max) / 2);
    return { f, er, nm, em, addon, q, min, max, mid };
  }, [followers, engagement, niche, excl, usage, qty, fmt]);

  const has = calc.f > 0;
  const selName = creators.find((c) => c.id === creatorId)?.name;

  const Num = ({ label, value, onChange, ph }: { label: string; value: string; onChange: (v: string) => void; ph?: string }) => (
    <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 130 }}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.25fr_1fr]">
      {/* ENTRÉES */}
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Créateur</span>
            <select
              value={creatorId}
              onChange={(e) => setCreatorId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value={EXTERNAL}>— Externe / autre agence (saisie manuelle)</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {titleCase(c.name)} (auto)
                </option>
              ))}
            </select>
            {creatorId !== EXTERNAL && (
              <span className="text-[11px] text-faint">Abonnés & engagement pré-remplis depuis la fiche — modifiables.</span>
            )}
          </div>

          {/* Plateforme */}
          <div className="mt-4 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPlatKey(p.key);
                  setFmtKey(p.formats[0].key);
                }}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-[11px] font-semibold transition-colors",
                  p.key === platKey ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-rowhover",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Format + niche */}
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 150 }}>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Format</span>
              <select
                value={fmtKey}
                onChange={(e) => setFmtKey(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                {plat.formats.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 150 }}>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Niche</span>
              <select
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                {NICHES.map((n) => (
                  <option key={n.value} value={n.value}>{n.label} (×{n.m})</option>
                ))}
              </select>
            </label>
          </div>

          {/* Abonnés + engagement + quantité */}
          <div className="mt-3 flex flex-wrap gap-3">
            <Num label="Abonnés" value={followers} onChange={setFollowers} ph="ex 45 000 ou 45K" />
            <Num label="Taux d'engagement (%)" value={engagement} onChange={setEngagement} ph="ex 3,5" />
            <label className="flex flex-col gap-1.5" style={{ minWidth: 90 }}>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Quantité</span>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
          </div>

          {/* Options */}
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 select-none text-[12px] font-medium text-foreground">
              <input type="checkbox" checked={excl} onChange={(e) => setExcl(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Exclusivité <span className="text-faint">(+25 %)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 select-none text-[12px] font-medium text-foreground">
              <input type="checkbox" checked={usage} onChange={(e) => setUsage(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Droits d'usage / ads <span className="text-faint">(+30 %)</span>
            </label>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-2xl border border-border bg-surface p-4 text-[11px] leading-snug text-muted-foreground shadow-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
          <span>
            Méthode 2026 : <b>(abonnés / 1000) × CPM plateforme × niche × engagement</b>. CPM & multiplicateurs issus des barèmes marché
            2026 (Influencer Marketing Hub, InfluenceFlow, Shopify, Meltwater). Fourchette indicative HT — la valeur exacte dépend de la marque, des droits et de la durée.
          </span>
        </div>
      </div>

      {/* RÉSULTAT */}
      <div className="flex flex-col rounded-2xl bg-foreground p-6 text-background">
        <div className="text-xs font-semibold uppercase tracking-wide text-signal">Tarif conseillé</div>
        <div className="mt-1 text-[11px] text-faint">
          {plat.label} · {fmt.label}
          {creatorId !== EXTERNAL && selName ? ` · ${titleCase(selName)}` : ""}
        </div>

        {has ? (
          <>
            <div className="mt-4">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Fourchette conseillée</div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-background sm:text-3xl">
                {formatEuro(calc.min)} <span className="text-faint">–</span> {formatEuro(calc.max)}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-[11px] text-faint">Prix cible</span>
                <span className="text-lg font-bold text-signal">{formatEuro(calc.mid)}</span>
                {calc.q > 1 && <span className="text-[10px] text-faint">pour {calc.q} contenus</span>}
              </div>
            </div>

            {/* Détail du calcul */}
            <div className="mt-4 flex flex-col gap-1.5 border-t border-white/10 pt-3 text-[11px]">
              <Line l="Palier" v={`${tier(calc.f)} · ${calc.f.toLocaleString("fr-FR")} abonnés`} />
              <Line l="CPM (€/1000)" v={`${fmt.cpm[0]} – ${fmt.cpm[1]} €`} />
              <Line l="× Niche" v={`×${calc.nm}`} />
              <Line l="× Engagement" v={`×${calc.em} (${calc.er || 0}%)`} />
              {(excl || usage) && <Line l="× Options" v={`×${calc.addon.toFixed(2)}`} />}
            </div>

            <div className="mt-4 rounded-xl bg-white/[0.06] p-3 text-[11px] leading-snug text-faint">
              💡 Ne descends pas sous <span className="font-semibold text-background">{formatEuro(calc.min)}</span> sans contrepartie
              (visibilité, série de collabs). Le juste prix se défend avec l'engagement ({calc.er || 0}%) et le palier {tier(calc.f)}.
            </div>
          </>
        ) : (
          <div className="mt-6 text-sm text-faint">
            Choisis un créateur (ou « Externe ») et renseigne les <b>abonnés</b> pour obtenir une fourchette de prix.
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-faint">{l}</span>
      <span className="font-medium text-background">{v}</span>
    </div>
  );
}

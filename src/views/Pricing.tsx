import { useEffect, useMemo, useState } from "react";
import { Info, Plus, Trash2, Copy, Users, Sparkles, Calculator, Tag, Lightbulb } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCreators } from "@/lib/useCreators";
import { formatEuro } from "@/lib/appState";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { PlatformIcon } from "@/components/ui/platform-icon";
import {
  INF_PLATFORMS, NICHES, nicheMult, infFormat, tier, computeInfluence, parseFollowers, parseEr,
  UGC_TYPES, UGC_LEVELS, UGC_USAGE, ugcLevelMult, computeUgc,
  type PlatKey, type InfItem, type UgcItem,
} from "@/lib/pricing";

const EXTERNAL = "__external__";
let _rid = 0;
const rid = () => `p${Date.now().toString(36)}${(_rid += 1)}`;

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";
const SEL = IN;
const LBL = "text-[12px] font-medium text-muted-foreground";

type Mode = "influence" | "ugc";
type InfRow = { id: string; platform: PlatKey; format: string; qty: number; followers: string; er: string };
type UgcRow = { id: string; type: string; qty: number };

export function Pricing() {
  const creators = useCreators();
  const [mode, setMode] = useState<Mode>("influence");
  const [creatorId, setCreatorId] = useState<string>(EXTERNAL);
  const [niche, setNiche] = useState<string>("lifestyle");
  const [level, setLevel] = useState<string>("confirme");

  // Audience PAR PLATEFORME, pré-remplie depuis le media kit de la créatrice.
  const [platMap, setPlatMap] = useState<Record<string, { followers: string; er: string }>>({});
  const [fallback, setFallback] = useState<{ followers: string; er: string }>({ followers: "", er: "" });

  const [infRows, setInfRows] = useState<InfRow[]>([
    { id: rid(), platform: "instagram", format: "reel", qty: 1, followers: "", er: "" },
  ]);
  const [infOpts, setInfOpts] = useState({ exclusivite: false, droitsUsage: false, remisePct: 0 });

  const [ugcRows, setUgcRows] = useState<UgcRow[]>([{ id: rid(), type: "video_court", qty: 2 }]);
  const [ugcOpts, setUgcOpts] = useState({ usage: "none", exclusivite: false, rushes: false, montage: false, express: false });

  // Charge le media kit du créateur → audience par plateforme + niche.
  useEffect(() => {
    if (creatorId === EXTERNAL) {
      setPlatMap({});
      setFallback({ followers: "", er: "" });
      return;
    }
    let alive = true;
    supabase.from("creators").select("followers,er,niche,mediakit").eq("id", creatorId).limit(1).then(({ data }) => {
      if (!alive) return;
      const row = data?.[0] as { followers?: string; er?: string; niche?: string; mediakit?: { platforms?: { key?: string; followers?: string; er?: string }[] } } | undefined;
      if (!row) return;
      const map: Record<string, { followers: string; er: string }> = {};
      for (const p of row.mediakit?.platforms ?? []) {
        if (p.key) map[p.key] = { followers: String(p.followers ?? ""), er: String(p.er ?? "") };
      }
      setPlatMap(map);
      setFallback({ followers: String(row.followers ?? ""), er: String(row.er ?? "") });
      if (row.niche) {
        const n = row.niche.toLowerCase();
        const match = NICHES.find((x) => x.label.toLowerCase().includes(n) || n.includes(x.value));
        if (match) setNiche(match.value);
      }
      // Re-remplit les lignes influence vides avec l'audience de leur plateforme.
      setInfRows((rows) => rows.map((r) => audienceFor(r, map, { followers: String(row.followers ?? ""), er: String(row.er ?? "") })));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);

  /** Renseigne followers/er d'une ligne depuis l'audience de sa plateforme (média kit → sinon fiche). */
  function audienceFor(r: InfRow, map: Record<string, { followers: string; er: string }>, fb: { followers: string; er: string }): InfRow {
    const a = map[r.platform] || fb;
    return { ...r, followers: r.followers || a.followers || "", er: r.er || a.er || "" };
  }

  const infItems: InfItem[] = infRows.map((r) => ({ platform: r.platform, format: r.format, qty: r.qty, followers: parseFollowers(r.followers), er: parseEr(r.er) }));
  const inf = useMemo(() => computeInfluence(infItems, nicheMult(niche), infOpts), [infItems, niche, infOpts]);
  const ugcItems: UgcItem[] = ugcRows.map((r) => ({ type: r.type, qty: r.qty }));
  const ugc = useMemo(() => computeUgc(ugcItems, ugcLevelMult(level), ugcOpts), [ugcItems, level, ugcOpts]);

  const result = mode === "influence" ? inf : ugc;
  const hasResult = result.max > 0;
  const selName = creators.find((c) => c.id === creatorId)?.name;

  // ── Modif de lignes influence ──
  const setInf = (id: string, patch: Partial<InfRow>) =>
    setInfRows((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      // Changement de plateforme → format valide + ré-auto-remplissage audience.
      if (patch.platform && patch.platform !== r.platform) {
        next.format = INF_PLATFORMS.find((p) => p.key === patch.platform)!.formats[0].key;
        const a = platMap[patch.platform] || fallback;
        next.followers = a.followers || "";
        next.er = a.er || "";
      }
      return next;
    }));
  const addInf = () => setInfRows((rows) => [...rows, audienceFor({ id: rid(), platform: "instagram", format: "reel", qty: 1, followers: "", er: "" }, platMap, fallback)]);

  const copyQuote = () => {
    const who = creatorId !== EXTERNAL && selName ? titleCase(selName) : "Créateur";
    let txt = "";
    if (mode === "influence") {
      txt = `Proposition tarifaire : ${who}\n\n`;
      inf.itemsPriced.forEach(({ item, min, max }) => {
        const fmt = infFormat(item.platform, item.format);
        txt += `• ${INF_PLATFORMS.find((p) => p.key === item.platform)?.label}, ${fmt?.label} ×${item.qty} : ${formatEuro(min)}–${formatEuro(max)}\n`;
      });
      if (infOpts.exclusivite) txt += "• Exclusivité incluse\n";
      if (infOpts.droitsUsage) txt += "• Droits d'usage / ads inclus\n";
      txt += `\nTotal : ${formatEuro(inf.min)} – ${formatEuro(inf.max)} HT (cible ${formatEuro(inf.mid)}).`;
    } else {
      txt = `Proposition UGC : ${who}\n\n`;
      ugc.itemsPriced.forEach(({ item, min, max }) => {
        txt += `• ${UGC_TYPES.find((t) => t.key === item.type)?.label} ×${item.qty} : ${formatEuro(min)}–${formatEuro(max)}\n`;
      });
      const u = UGC_USAGE.find((x) => x.value === ugcOpts.usage);
      if (u && u.value !== "none") txt += `• Droits : ${u.label}\n`;
      txt += `\nTotal : ${formatEuro(ugc.min)} – ${formatEuro(ugc.max)} HT (cible ${formatEuro(ugc.mid)}).`;
    }
    navigator.clipboard?.writeText(txt).then(() => toast("Proposition copiée ✓")).catch(() => toast("Copie impossible"));
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* ============ ENTRÉES (un panneau façon Aperçu) ============ */}
      <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 lg:col-span-7">
        <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <Calculator className="h-4 w-4 text-muted-foreground" /> Composer le package
        </div>
        {/* Mode + créateur */}
        <div>
          <div className="flex w-fit items-center gap-1 rounded-full border border-border bg-panel p-1">
            {([["influence", "Influence", Users], ["ugc", "UGC", Sparkles]] as const).map(([m, label, Icon]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors",
                  mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            {mode === "influence"
              ? "Le créateur publie sur son propre compte : prix basé sur l'audience de chaque plateforme."
              : "Le créateur livre du contenu que la marque exploite : forfait par livrable, selon les droits."}
          </p>

          <div className="mt-4 flex flex-col gap-1.5">
            <span className={LBL}>Créateur</span>
            <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)} className={SEL}>
              <option value={EXTERNAL}>Externe (saisie manuelle)</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>{titleCase(c.name)} (auto)</option>
              ))}
            </select>
          </div>
        </div>

        {/* ---- INFLUENCE ---- */}
        {mode === "influence" ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 160 }}>
                <span className={LBL}>Niche (du créateur)</span>
                <select value={niche} onChange={(e) => setNiche(e.target.value)} className={SEL}>
                  {NICHES.map((n) => <option key={n.value} value={n.value}>{n.label} (×{n.m})</option>)}
                </select>
              </label>
            </div>

            <span className={LBL}>Livrables du package</span>
            <div className="mt-2 flex flex-col gap-2">
              {infRows.map((r) => {
                const plat = INF_PLATFORMS.find((p) => p.key === r.platform)!;
                return (
                  <div key={r.id} className="rounded-xl border border-border bg-panel p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={r.platform} onChange={(e) => setInf(r.id, { platform: e.target.value as PlatKey })} className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary">
                        {INF_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                      <select value={r.format} onChange={(e) => setInf(r.id, { format: e.target.value })} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary">
                        {plat.formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      <input type="number" min={1} value={r.qty} onChange={(e) => setInf(r.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} title="Quantité" className="w-14 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-[13px] tabular-nums outline-none focus:border-primary" />
                      {infRows.length > 1 && (
                        <button type="button" onClick={() => setInfRows((rows) => rows.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className="flex flex-1 items-center gap-1.5" style={{ minWidth: 130 }}>
                        <PlatformIcon platform={r.platform} className="h-3.5 w-3.5 shrink-0 text-faint" />
                        <input value={r.followers} onChange={(e) => setInf(r.id, { followers: e.target.value })} placeholder="abonnés (cette plateforme)" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                      </label>
                      <input value={r.er} onChange={(e) => setInf(r.id, { er: e.target.value })} placeholder="engagement %" className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addInf} className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Ajouter un livrable
            </button>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <input type="checkbox" checked={infOpts.exclusivite} onChange={(e) => setInfOpts((o) => ({ ...o, exclusivite: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                Exclusivité <span className="text-faint">+25 %</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <input type="checkbox" checked={infOpts.droitsUsage} onChange={(e) => setInfOpts((o) => ({ ...o, droitsUsage: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                Droits d'usage / ads <span className="text-faint">+30 %</span>
              </label>
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                Remise pack
                <input type="number" min={0} max={50} value={infOpts.remisePct} onChange={(e) => setInfOpts((o) => ({ ...o, remisePct: Math.min(50, Math.max(0, parseInt(e.target.value, 10) || 0)) }))} className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-center text-[13px] tabular-nums outline-none focus:border-primary" />
                <span className="text-faint">%</span>
              </label>
            </div>
          </div>
        ) : (
          /* ---- UGC ---- */
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 160 }}>
                <span className={LBL}>Niveau du créateur UGC</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)} className={SEL}>
                  {UGC_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label} (×{l.m})</option>)}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 160 }}>
                <span className={LBL}>Droits d'exploitation</span>
                <select value={ugcOpts.usage} onChange={(e) => setUgcOpts((o) => ({ ...o, usage: e.target.value }))} className={SEL}>
                  {UGC_USAGE.map((u) => <option key={u.value} value={u.value}>{u.label}{u.m ? ` (+${Math.round(u.m * 100)} %)` : ""}</option>)}
                </select>
              </label>
            </div>

            <span className={LBL}>Livrables UGC</span>
            <div className="mt-2 flex flex-col gap-2">
              {ugcRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-xl border border-border bg-panel p-2.5">
                  <select value={r.type} onChange={(e) => setUgcRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, type: e.target.value } : x)))} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary">
                    {UGC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <input type="number" min={1} value={r.qty} onChange={(e) => setUgcRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : x)))} title="Quantité" className="w-14 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-[13px] tabular-nums outline-none focus:border-primary" />
                  {ugcRows.length > 1 && (
                    <button type="button" onClick={() => setUgcRows((rows) => rows.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setUgcRows((rows) => [...rows, { id: rid(), type: "video_court", qty: 1 }])} className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Ajouter un livrable
            </button>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              {([["exclusivite", "Exclusivité", "+25 %"], ["rushes", "Rushes / fichiers bruts", "+15 %"], ["montage", "Montage avancé", "+20 %"], ["express", "Livraison express", "+20 %"]] as const).map(([k, label, pct]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                  <input type="checkbox" checked={ugcOpts[k]} onChange={(e) => setUgcOpts((o) => ({ ...o, [k]: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                  {label} <span className="text-faint">{pct}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-[12px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          <span>
            {mode === "influence"
              ? "Somme des livrables, chacun à (abonnés/1000) × CPM × niche × engagement, puis options et remise. Fourchette HT indicative, barèmes marché 2026."
              : "Le prix UGC ne dépend PAS de l'audience : forfait de production × niveau, dont les DROITS d'exploitation sont le vrai levier. Fourchette HT indicative, barèmes marché 2026."}
          </span>
        </div>
      </section>

      {/* ============ RÉSULTAT ============ */}
      <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-4 lg:col-span-5 lg:self-start">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Tag className="h-4 w-4 text-muted-foreground" /> Résultat
          </div>
          {hasResult && (
            <button type="button" onClick={copyQuote} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
              <Copy className="h-3.5 w-3.5" /> Copier
            </button>
          )}
        </div>
        <div className="mt-3 text-[13px] text-muted-foreground">
          {mode === "influence" ? "Package influence" : "Package UGC"}
          {creatorId !== EXTERNAL && selName ? ` · ${titleCase(selName)}` : ""}
        </div>

        {hasResult ? (
          <>
            <div className="mt-4">
              <div className="text-[12px] text-muted-foreground">Fourchette conseillée (HT)</div>
              <div className="mt-2 text-[28px] font-semibold leading-tight tracking-tight tabular-nums text-foreground xl:text-[34px]">
                {formatEuro(result.min)} <span className="text-faint">–</span> {formatEuro(result.max)}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-[13px] text-muted-foreground">Prix cible</span>
                <span className="text-[18px] font-semibold tabular-nums text-foreground">{formatEuro(result.mid)}</span>
              </div>
            </div>

            {/* Détail par livrable */}
            <div className="mt-5 divide-y divide-border border-t border-border text-[13px]">
              {(mode === "influence" ? inf.itemsPriced : ugc.itemsPriced).map((r, i) => {
                const label =
                  mode === "influence"
                    ? `${INF_PLATFORMS.find((p) => p.key === (r.item as InfItem).platform)?.label} · ${infFormat((r.item as InfItem).platform, (r.item as InfItem).format)?.label} ×${r.item.qty}`
                    : `${UGC_TYPES.find((t) => t.key === (r.item as UgcItem).type)?.label} ×${r.item.qty}`;
                return <Line key={i} l={label} v={r.max > 0 ? `${formatEuro(r.min)}–${formatEuro(r.max)}` : "—"} />;
              })}
              {result.addon > 1 && <Line l="× Options" v={`×${result.addon.toFixed(2)}`} />}
              {mode === "influence" && inf.itemsPriced[0] && (
                <Line l="Palier (1re plateforme)" v={tier(parseFollowers(infRows[0]?.followers))} />
              )}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted p-3 text-[12px] leading-snug text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {mode === "influence"
                  ? <>Ne descends pas sous <span className="font-semibold text-foreground">{formatEuro(result.min)}</span> sans contrepartie. Le juste prix se défend avec l'engagement et le palier de chaque plateforme.</>
                  : <>Le prix monte surtout avec les <span className="font-semibold text-foreground">droits d'exploitation</span> : un contenu diffusé en ads pendant 6 mois vaut bien plus qu'un post organique.</>}
              </span>
            </div>
          </>
        ) : (
          <div className="mt-6 text-[13px] text-muted-foreground">
            {mode === "influence"
              ? "Ajoute des livrables et renseigne les abonnés de chaque plateforme pour obtenir une fourchette."
              : "Ajoute des livrables UGC pour obtenir une fourchette."}
          </div>
        )}
      </section>
    </div>
  );
}

function Line({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-2">
      <span className="min-w-0 truncate text-muted-foreground">{l}</span>
      <span className="shrink-0 font-medium tabular-nums text-foreground">{v}</span>
    </div>
  );
}

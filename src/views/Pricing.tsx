import { useEffect, useMemo, useState } from "react";
import { Info, Plus, Trash2, Copy, Users, Sparkles, Calculator, Tag, Lightbulb, SlidersHorizontal, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCreators } from "@/lib/useCreators";
import { formatEuro, saveAppStateKey, useAppState } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { PlatformIcon } from "@/components/ui/platform-icon";
import {
  INF_PLATFORMS, NICHES, nicheMult, infFormat, tier, computeInfluence, parseFollowers, parseEr, cpmViews, EXCLUSIVITY, USAGE_RIGHTS,
  UGC_TYPES, UGC_LEVELS, UGC_USAGE, ugcLevelMult, computeUgc,
  type PlatKey, type InfItem, type UgcItem, type RateOverrides,
} from "@/lib/pricing";
import { fmtCompact } from "@/lib/timeSeries";

const EXTERNAL = "__external__";
let _rid = 0;
const rid = () => `p${Date.now().toString(36)}${(_rid += 1)}`;

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";
const SEL = IN;
const LBL = "text-[12px] font-medium text-muted-foreground";

type Mode = "influence" | "ugc";
/** views = vues attendues par contenu (vide = estimées) ; src = d'où viennent vues et engagement. */
type InfRow = { id: string; platform: PlatKey; format: string; qty: number; followers: string; er: string; views: string; src: string; erBase: "views" | "followers" };
/** Audience d'une plateforme pour la créatrice choisie (données réelles quand on les a). */
type Aud = { followers: string; er: string; views: string; storyViews: string; shortViews?: string; src: string; erBase: "views" | "followers" };
const NO_AUD: Aud = { followers: "", er: "", views: "", storyViews: "", src: "", erBase: "followers" };
const SRC_LABEL: Record<string, string> = {
  tiktok: "vues mesurées sur TikTok (12 dernières vidéos)",
  youtube: "vues mesurées sur YouTube (dernières vidéos, Shorts à part)",
  instagram: "chiffres Instagram du jour",
  igreels: "vues mesurées sur Instagram (derniers reels)",
  kit: "vues du media kit",
  fiche: "chiffres de la fiche",
};
type UgcRow = { id: string; type: string; qty: number };

export function Pricing() {
  const creators = useCreators();
  const [mode, setMode] = useState<Mode>("influence");
  const [creatorId, setCreatorId] = useState<string>(EXTERNAL);
  const [niche, setNiche] = useState<string>("lifestyle");
  const [level, setLevel] = useState<string>("confirme");

  // Audience PAR PLATEFORME, pré-remplie depuis les vraies données de la créatrice
  // (TikTok connecté, Instagram du jour, media kit), sinon depuis sa fiche.
  const [platMap, setPlatMap] = useState<Record<string, Aud>>({});
  const [fallback, setFallback] = useState<Aud>(NO_AUD);

  const [infRows, setInfRows] = useState<InfRow[]>([
    { id: rid(), platform: "instagram", format: "reel", qty: 1, followers: "", er: "", views: "", src: "", erBase: "followers" },
  ]);
  const [infOpts, setInfOpts] = useState<{ exclusivite: string; droitsUsage: string; whitelisting: boolean; remisePct: number }>({ exclusivite: "none", droitsUsage: "none", whitelisting: false, remisePct: 0 });
  // Barème de l'agence (partagé par l'équipe) : remplace celui par défaut format par format.
  const { data: rates } = useAppState((st) => (st.pricingRates as RateOverrides | undefined) ?? {});
  const [ratesOpen, setRatesOpen] = useState(false);

  const [ugcRows, setUgcRows] = useState<UgcRow[]>([{ id: rid(), type: "video_court", qty: 2 }]);
  const [ugcOpts, setUgcOpts] = useState({ usage: "none", exclusivite: false, rushes: false, montage: false, express: false });

  // Charge la créatrice → audience par plateforme (vraies données d'abord) + niche.
  useEffect(() => {
    if (creatorId === EXTERNAL) {
      setPlatMap({});
      setFallback(NO_AUD);
      // Créateur externe : on vide l'audience héritée du créateur précédent.
      setInfRows((rows) => rows.map((r) => ({ ...r, followers: "", er: "", views: "", src: "", erBase: "followers" })));
      return;
    }
    let alive = true;
    supabase.from("creators").select("*").eq("id", creatorId).limit(1).then(({ data }) => {
      if (!alive) return;
      type Kit = { key?: string; followers?: string; er?: string; avgViews?: string; avgStoryViews?: string };
      const row = data?.[0] as {
        followers?: string; er?: string; niche?: string; mediakit?: { platforms?: Kit[] };
        ig?: { followers?: number; er?: number | null; link?: unknown; insights?: { reelViews?: number | null } | null } | null;
        tt?: { followers?: number | null; avgViews?: number | null; er?: number | null; link?: unknown } | null;
        yt?: { subscribers?: number | null; avgViews?: number | null; avgShortViews?: number | null; er?: number | null; link?: unknown } | null;
      } | undefined;
      if (!row) return;
      const map: Record<string, Aud> = {};
      for (const p of row.mediakit?.platforms ?? []) {
        if (!p.key) continue;
        // ER des media kits = calculateur d'engagement (sur les vues des 30 derniers jours).
        map[p.key] = { followers: String(p.followers ?? ""), er: String(p.er ?? ""), views: String(p.avgViews ?? ""), storyViews: String(p.avgStoryViews ?? ""), src: p.avgViews ? "kit" : "fiche", erBase: "views" };
      }
      // Instagram du jour (Meta) : abonnés et engagement public (sur les abonnés).
      if (row.ig?.followers) {
        const k = map.instagram ?? NO_AUD;
        const rv = row.ig.link ? row.ig.insights?.reelViews : null;
        map.instagram = {
          ...k, followers: String(row.ig.followers), er: row.ig.er != null ? String(row.ig.er) : k.er, erBase: row.ig.er != null ? "followers" : k.erBase,
          views: rv ? String(rv) : k.views, src: rv ? "igreels" : k.views ? "kit" : "instagram",
        };
      }
      // TikTok connecté : vraies vues moyennes et engagement sur les vues.
      if (row.tt?.link && row.tt.followers) {
        map.tiktok = { ...(map.tiktok ?? NO_AUD), followers: String(row.tt.followers), views: row.tt.avgViews ? String(row.tt.avgViews) : "", er: row.tt.er != null ? String(row.tt.er) : "", erBase: "views", src: row.tt.avgViews ? "tiktok" : "fiche" };
      }
      // YouTube connecté : vraies vues moyennes (vidéos longues pour les intégrations, Shorts à part).
      if (row.yt?.link && (row.yt.subscribers || row.yt.avgViews || row.yt.avgShortViews)) {
        const k = map.youtube ?? NO_AUD;
        const real = !!(row.yt.avgViews || row.yt.avgShortViews);
        map.youtube = {
          ...k, followers: row.yt.subscribers ? String(row.yt.subscribers) : k.followers,
          views: row.yt.avgViews ? String(row.yt.avgViews) : k.views, shortViews: row.yt.avgShortViews ? String(row.yt.avgShortViews) : "",
          er: row.yt.er != null ? String(row.yt.er) : k.er, erBase: "views", src: real ? "youtube" : k.src || "fiche",
        };
      }
      setPlatMap(map);
      const fb: Aud = { ...NO_AUD, followers: String(row.followers ?? ""), er: String(row.er ?? ""), src: "fiche", erBase: "views" };
      setFallback(fb);
      if (row.niche) {
        const n = row.niche.toLowerCase();
        const match = NICHES.find((x) => x.label.toLowerCase().includes(n) || n.includes(x.value));
        if (match) setNiche(match.value);
      }
      // Changement de créateur : ÉCRASE l'audience de chaque ligne par celle du nouveau créateur.
      setInfRows((rows) => rows.map((r) => fill({ ...r, followers: "", er: "", views: "", src: "" }, map, fb, true)));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);

  /**
   * Renseigne une ligne depuis l'audience de sa plateforme. Les vues ne sont reprises que
   * pour le format qu'elles mesurent (moyenne des vidéos / reels ; story à part) ;
   * sinon elles restent vides et sont estimées depuis les abonnés.
   */
  function fill(r: InfRow, map: Record<string, Aud>, fb: Aud, force = false): InfRow {
    const a = map[r.platform] || fb;
    const isStory = r.format === "story";
    const v = isStory ? a.storyViews : r.format === "short" ? a.shortViews ?? a.views : ["reel", "video", "integration", "dedicated"].includes(r.format) ? a.views : "";
    return {
      ...r,
      followers: force ? a.followers : r.followers || a.followers || "",
      er: force ? a.er : r.er || a.er || "",
      views: force ? v : r.views || v || "",
      src: a.src,
      erBase: a.erBase,
    };
  }

  const infItems: InfItem[] = infRows.map((r) => ({ platform: r.platform, format: r.format, qty: r.qty, followers: parseFollowers(r.followers), er: parseEr(r.er), views: parseFollowers(r.views), erBase: r.erBase }));
  const inf = useMemo(() => computeInfluence(infItems, nicheMult(niche), infOpts, rates ?? {}), [infItems, niche, infOpts, rates]);
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
      // Changement de plateforme ou de format → format valide + ré-auto-remplissage audience.
      if (patch.platform && patch.platform !== r.platform) {
        next.format = INF_PLATFORMS.find((p) => p.key === patch.platform)!.formats[0].key;
        return fill({ ...next, followers: "", er: "", views: "" }, platMap, fallback);
      }
      if (patch.format && patch.format !== r.format) return fill({ ...next, views: "" }, platMap, fallback);
      return next;
    }));
  const addInf = () => setInfRows((rows) => [...rows, fill({ id: rid(), platform: "instagram", format: "reel", qty: 1, followers: "", er: "", views: "", src: "", erBase: "followers" }, platMap, fallback)]);

  const copyQuote = () => {
    const who = creatorId !== EXTERNAL && selName ? titleCase(selName) : "Créateur";
    let txt = "";
    if (mode === "influence") {
      txt = `Proposition tarifaire : ${who}\n\n`;
      inf.itemsPriced.forEach(({ item, min, max, views, estimated }) => {
        const fmt = infFormat(item.platform, item.format);
        const v = views > 0 ? ` (${estimated ? "≈ " : ""}${fmtCompact(views)} vues par contenu)` : "";
        txt += `• ${INF_PLATFORMS.find((p) => p.key === item.platform)?.label}, ${fmt?.label} ×${item.qty}${v} : ${formatEuro(min)}–${formatEuro(max)}\n`;
      });
      const ex = EXCLUSIVITY.find((x) => x.value === infOpts.exclusivite);
      if (ex && ex.value !== "none") txt += `• Exclusivité ${ex.label}\n`;
      const us = USAGE_RIGHTS.find((x) => x.value === infOpts.droitsUsage);
      if (us && us.value !== "none") txt += `• Droits d'usage : ${us.label}\n`;
      if (infOpts.whitelisting) txt += "• Diffusion en pub depuis le compte de la créatrice\n";
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
          <Tabs
            size="sm"
            label="Type de package"
            items={[
              { value: "influence", label: "Influence", icon: <Users className="h-3.5 w-3.5" /> },
              { value: "ugc", label: "UGC", icon: <Sparkles className="h-3.5 w-3.5" /> },
            ]}
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
          />
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            {mode === "influence"
              ? "Le créateur publie sur son propre compte : prix basé sur l'audience de chaque plateforme."
              : "Le créateur livre du contenu que la marque exploite : forfait par livrable, selon les droits."}
          </p>

          <div className="mt-4 flex flex-col gap-1.5">
            <span className={LBL}>Créateur</span>
            <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)} className={SEL}>
              <option value={EXTERNAL}>Autre créatrice (saisie libre)</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>{titleCase(c.name)}</option>
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
                  {NICHES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              </label>
            </div>

            <span className={LBL}>Livrables du package</span>
            <div className="mt-2 flex flex-col gap-2">
              {infRows.map((r) => {
                const plat = INF_PLATFORMS.find((p) => p.key === r.platform)!;
                const fmtOf = infFormat(r.platform, r.format, rates ?? {});
                const estimate = fmtOf ? Math.round(parseFollowers(r.followers) * fmtOf.rate) : 0;
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
                        <button type="button" onClick={() => setInfRows((rows) => rows.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className="flex flex-1 items-center gap-1.5" style={{ minWidth: 120 }}>
                        <PlatformIcon platform={r.platform} className="h-3.5 w-3.5 shrink-0 text-faint" />
                        <input value={r.followers} onChange={(e) => setInf(r.id, { followers: e.target.value })} placeholder="abonnés" title="Abonnés sur cette plateforme" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                      </label>
                      <input
                        value={r.views}
                        onChange={(e) => setInf(r.id, { views: e.target.value, src: e.target.value ? "saisie" : r.src })}
                        placeholder={estimate ? `vues ≈ ${fmtCompact(estimate)}` : "vues / contenu"}
                        title="Vues attendues par contenu : vraies vues moyennes si tu les as, sinon laisse vide (estimées depuis les abonnés)"
                        className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                      />
                      <input value={r.er} onChange={(e) => setInf(r.id, { er: e.target.value })} placeholder="engagement %" title={r.erBase === "views" ? "Engagement calculé sur les vues" : "Engagement calculé sur les abonnés"} className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                    </div>
                    <div className="mt-1.5 text-[11px] leading-snug text-faint">
                      {r.views ? (r.src === "saisie" ? "Vues saisies à la main" : `Vues : ${SRC_LABEL[r.src] ?? "données de la créatrice"}`) : estimate ? `Vues estimées : ${Math.round((fmtOf?.rate ?? 0) * 100)} % des abonnés (habituel pour ce format)` : "Renseigne les abonnés ou les vues"}
                      {" · engagement sur les "}{r.erBase === "views" ? "vues" : "abonnés"}
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addInf} className="mt-2 flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Ajouter un livrable
            </button>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={LBL}>Exclusivité (pas de marque concurrente)</span>
                <select value={infOpts.exclusivite} onChange={(e) => setInfOpts((o) => ({ ...o, exclusivite: e.target.value }))} className={SEL}>
                  {EXCLUSIVITY.map((x) => <option key={x.value} value={x.value}>{x.label}{x.m ? ` (+${Math.round(x.m * 100)} %)` : ""}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LBL}>Droits d'usage par la marque</span>
                <select value={infOpts.droitsUsage} onChange={(e) => setInfOpts((o) => ({ ...o, droitsUsage: e.target.value }))} className={SEL}>
                  {USAGE_RIGHTS.map((x) => <option key={x.value} value={x.value}>{x.label}{x.m ? ` (+${Math.round(x.m * 100)} %)` : ""}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground" title="La marque diffuse le contenu en publicité depuis le compte de la créatrice (Spark Ads TikTok, pubs partenaires Instagram)">
                <input type="checkbox" checked={infOpts.whitelisting} onChange={(e) => setInfOpts((o) => ({ ...o, whitelisting: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                La marque en fait une pub depuis son compte <span className="text-faint">+20 %</span>
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
                    <button type="button" onClick={() => setUgcRows((rows) => rows.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setUgcRows((rows) => [...rows, { id: rid(), type: "video_court", qty: 1 }])} className="mt-2 flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Ajouter un livrable
            </button>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              {([["exclusivite", "Exclusivité", "+25 %"], ["rushes", "Fichiers bruts", "+15 %"], ["montage", "Montage avancé", "+20 %"], ["express", "Livraison express", "+20 %"]] as const).map(([k, label, pct]) => (
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
              ? "Prix basé sur les vues attendues, la niche et l'engagement. Fourchette HT indicative."
              : "Prix fixe par contenu ; les droits d'utilisation font le plus varier le prix. Fourchette HT indicative."}
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
            <button type="button" onClick={copyQuote} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
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
              {mode === "influence"
                ? inf.itemsPriced.map((r, i) => (
                    <div key={i} className="py-2">
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 truncate text-muted-foreground">{`${INF_PLATFORMS.find((p) => p.key === r.item.platform)?.label} · ${infFormat(r.item.platform, r.item.format)?.label} ×${r.item.qty}`}</span>
                        <span className="shrink-0 font-medium tabular-nums text-foreground">{r.max > 0 ? `${formatEuro(r.min)}–${formatEuro(r.max)}` : "—"}</span>
                      </div>
                      {r.explain && <div className="mt-0.5 text-[11px] leading-snug text-faint">{r.explain}</div>}
                    </div>
                  ))
                : ugc.itemsPriced.map((r, i) => (
                    <Line key={i} l={`${UGC_TYPES.find((t) => t.key === r.item.type)?.label} ×${r.item.qty}`} v={r.max > 0 ? `${formatEuro(r.min)}–${formatEuro(r.max)}` : "—"} />
                  ))}
              {result.addon > 1 && <Line l="× Options" v={`×${result.addon.toFixed(2)}`} />}
              {mode === "influence" && inf.itemsPriced[0] && (
                <Line l="Palier (1re plateforme)" v={tier(parseFollowers(infRows[0]?.followers))} />
              )}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted p-3 text-[12px] leading-snug text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {mode === "influence"
                  ? <>Ne descends pas sous <span className="font-semibold text-foreground">{formatEuro(result.min)}</span> sans contrepartie. Le prix se défend avec les vues : montre à la marque le coût pour 1000 vues, c'est la façon dont elle compare avec la pub.</>
                  : <>Le prix monte surtout avec les <span className="font-semibold text-foreground">droits d'exploitation</span> : un contenu diffusé en ads pendant 6 mois vaut bien plus qu'un post organique.</>}
              </span>
            </div>
          </>
        ) : (
          <div className="mt-6 text-[13px] text-muted-foreground">
            {mode === "influence"
              ? "Ajoute des livrables et renseigne les abonnés (ou les vues) de chaque plateforme pour obtenir une fourchette."
              : "Ajoute des livrables UGC pour obtenir une fourchette."}
          </div>
        )}
        {mode === "influence" && (
          ratesOpen ? (
            <RatesEditor rates={rates ?? {}} onClose={() => setRatesOpen(false)} />
          ) : (
            <button type="button" onClick={() => setRatesOpen(true)} className="mt-4 flex items-center gap-1.5 self-start rounded-full border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Barème de l'agence{rates && Object.keys(rates).length ? " · personnalisé" : ""}
            </button>
          )
        )}
      </section>
    </div>
  );
}

/**
 * Barème de l'agence (partagé, blob `pricingRates`) : € pour 1000 abonnés et taux de vue
 * habituel par format ; le CPM vues affiché s'en déduit. Vide = barème par défaut.
 */
function RatesEditor({ rates, onClose }: { rates: RateOverrides; onClose: () => void }) {
  const [draft, setDraft] = useState<RateOverrides>(rates);
  const [saving, setSaving] = useState(false);
  const set = (key: string, patch: { cpm?: [number, number]; rate?: number }) => setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? {}), ...patch } }));
  const save = async (next: RateOverrides) => {
    setSaving(true);
    const ok = await saveAppStateKey("pricingRates", next);
    setSaving(false);
    toast(ok ? "Barème enregistré pour toute l'équipe ✓" : "Erreur, réessaie");
    if (ok) onClose();
  };
  const num = (v: string) => Math.max(0, parseFloat(v.replace(",", ".")) || 0);
  return (
    <div className="mt-4 rounded-xl border border-border bg-panel/50 p-3">
      <div className="mb-2 text-[12px] font-semibold text-foreground">Barème de l'agence</div>
      <div className="mb-2 text-[11px] leading-snug text-muted-foreground">€ pour 1000 abonnés (fourchette) et part habituelle des abonnés qui voient un contenu. Le CPM en € pour 1000 vues s'en déduit.</div>
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
        {INF_PLATFORMS.flatMap((p) => p.formats.map((f) => {
          const key = `${p.key}.${f.key}`;
          const cur = infFormat(p.key, f.key, draft)!;
          const cv = cpmViews(cur);
          return (
            <div key={key} className="grid grid-cols-[minmax(0,1fr)_56px_56px_52px] items-center gap-1.5 text-[11px]">
              <span className="truncate text-foreground">{p.label} · {f.label}<span className="block text-faint">{Math.round(cv[0])}–{Math.round(cv[1])} € / 1000 vues</span></span>
              <input defaultValue={cur.cpm[0]} onBlur={(e) => set(key, { cpm: [num(e.target.value), cur.cpm[1]] })} title="€ / 1000 abonnés (min)" className="rounded-md border border-border bg-surface px-1.5 py-1 text-center tabular-nums outline-none focus:border-primary" />
              <input defaultValue={cur.cpm[1]} onBlur={(e) => set(key, { cpm: [cur.cpm[0], num(e.target.value)] })} title="€ / 1000 abonnés (max)" className="rounded-md border border-border bg-surface px-1.5 py-1 text-center tabular-nums outline-none focus:border-primary" />
              <input defaultValue={Math.round(cur.rate * 100)} onBlur={(e) => set(key, { rate: num(e.target.value) / 100 })} title="% des abonnés qui voient habituellement ce format" className="rounded-md border border-border bg-surface px-1.5 py-1 text-center tabular-nums outline-none focus:border-primary" />
            </div>
          );
        }))}
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_56px_56px_52px] gap-1.5 text-[10px] text-faint">
        <span /> <span className="text-center">€ min</span> <span className="text-center">€ max</span> <span className="text-center">% vues</span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => void save({})} disabled={saving} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover"><RotateCcw className="h-3 w-3" /> Barème par défaut</button>
        <button type="button" onClick={onClose} className="rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover">Annuler</button>
        <button type="button" onClick={() => void save(draft)} disabled={saving} className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">Enregistrer</button>
      </div>
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

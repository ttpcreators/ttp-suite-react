import { useEffect, useMemo, useState } from "react";
import { Info, Plus, Trash2, Copy, Users, Sparkles, Calculator, Tag, Lightbulb, SlidersHorizontal, RotateCcw } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { useCreators } from "@/lib/useCreators";
import { formatEuro, getAppState, invalidateAppState, saveAppStateKey, useAppState } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { Picker } from "@/components/ui/form";
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
      // Pas de niche héritée du créateur précédent : retour au neutre (Lifestyle, ×1).
      setNiche("lifestyle");
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
      // Niche du créateur, sinon Lifestyle (×1) : jamais celle du créateur précédent.
      const n = (row.niche ?? "").toLowerCase().trim();
      const match = n ? NICHES.find((x) => x.label.toLowerCase().includes(n) || n.includes(x.value)) : undefined;
      setNiche(match?.value ?? "lifestyle");
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

  /**
   * Proposition copiée pour la marque : lignes à 0 € exclues, sous-total = somme des
   * lignes, puis options et remise en euros, puis le total. Mêmes chiffres qu'à l'écran
   * (quoteTotals), à l'euro près, tout HT.
   */
  const copyQuote = () => {
    const who = creatorId !== EXTERNAL && selName ? titleCase(selName) : "Créateur";
    const rng = (r: { min: number; max: number }) => (r.min === r.max ? formatEuro(r.min) : `${formatEuro(r.min)} à ${formatEuro(r.max)}`);
    const sign = (r: { min: number; max: number }, s: string) => (r.min === r.max ? `${s}${formatEuro(r.min)}` : `${s}${formatEuro(r.min)} à ${s}${formatEuro(r.max)}`);
    const lines: string[] = [];
    let optLabels: string[] = [];
    if (mode === "influence") {
      inf.itemsPriced.filter((r) => r.max > 0).forEach(({ item, min, max, views, estimated, capped }) => {
        const fmt = infFormat(item.platform, item.format);
        // Vues plafonnées : on annonce les vues RETENUES pour le prix, pas une moyenne virale.
        const v = views > 0 ? ` (${estimated ? "≈ " : ""}${fmtCompact(views)} vues ${capped ? "retenues " : ""}par contenu)` : "";
        lines.push(`• ${INF_PLATFORMS.find((p) => p.key === item.platform)?.label}, ${fmt?.label} ×${item.qty}${v} : ${rng({ min, max })}`);
      });
      const ex = EXCLUSIVITY.find((x) => x.value === infOpts.exclusivite);
      if (ex && ex.value !== "none") optLabels.push(`exclusivité ${ex.label}`);
      const us = USAGE_RIGHTS.find((x) => x.value === infOpts.droitsUsage);
      if (us && us.value !== "none") optLabels.push(`droits d'usage : ${us.label}`);
      if (infOpts.whitelisting) optLabels.push("pub depuis le compte du créateur");
    } else {
      ugc.itemsPriced.filter((r) => r.max > 0).forEach(({ item, min, max }) => {
        lines.push(`• ${UGC_TYPES.find((t) => t.key === item.type)?.label} ×${item.qty} : ${rng({ min, max })}`);
      });
      const u = UGC_USAGE.find((x) => x.value === ugcOpts.usage);
      optLabels = [
        u && u.value !== "none" ? `droits : ${u.label}` : "",
        ugcOpts.exclusivite ? "exclusivité" : "",
        ugcOpts.rushes ? "fichiers bruts" : "",
        ugcOpts.montage ? "montage avancé" : "",
        ugcOpts.express ? "livraison express" : "",
      ].filter(Boolean);
    }
    const q = mode === "influence" ? inf : ugc;
    let txt = `${mode === "influence" ? "Proposition tarifaire" : "Proposition UGC"} : ${who} (montants HT)\n\n${lines.join("\n")}\n`;
    if (q.options.max > 0 || q.discount.max > 0) {
      txt += `\nSous-total : ${rng(q.sub)}\n`;
      if (q.options.max > 0) txt += `• Options${optLabels.length ? ` (${optLabels.join(", ")})` : ""} : +${q.optionsPct} % soit ${sign(q.options, "+")}\n`;
      if (q.discount.max > 0) txt += `• Remise pack −${q.discountPct} % : ${sign(q.discount, "−")}\n`;
    }
    txt += `\nTotal : ${rng(q)} HT (cible ${formatEuro(q.mid)} HT).`;
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
            <Picker ariaLabel="Créateur" value={creatorId} onChange={setCreatorId}
              options={[{ value: EXTERNAL, label: "Autre créateur (saisie libre)" }, ...creators.map((c) => ({ value: c.id, label: titleCase(c.name), img: c.photo_url }))]} />
          </div>
        </div>

        {/* ---- INFLUENCE ---- */}
        {mode === "influence" ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 160 }}>
                <span className={LBL}>Niche (du créateur)</span>
                <Picker ariaLabel="Niche" value={niche} onChange={setNiche} options={NICHES.map((n) => ({ value: n.value, label: n.label }))} />
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
                      <Picker size="sm" ariaLabel="Plateforme" className="w-[130px]" value={r.platform} onChange={(v) => setInf(r.id, { platform: v as PlatKey })} options={INF_PLATFORMS.map((p) => ({ value: p.key, label: p.label }))} />
                      <Picker size="sm" ariaLabel="Format" className="flex-1" value={r.format} onChange={(v) => setInf(r.id, { format: v })} options={plat.formats.map((f) => ({ value: f.key, label: f.label }))} />
                      <input type="number" min={1} value={r.qty} onChange={(e) => setInf(r.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} title="Quantité" className="w-14 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-[13px] tabular-nums outline-none focus:border-primary" />
                      {infRows.length > 1 && (
                        <button type="button" onClick={() => setInfRows((rows) => rows.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-destructive">
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
                      <input value={r.er} onChange={(e) => setInf(r.id, { er: e.target.value })} placeholder="engagement %" title={r.erBase === "views" ? "Taux d'engagement (sur les vues)" : "Taux d'engagement (sur les abonnés)"} className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                    </div>
                    <div className="mt-1.5 text-[11px] leading-snug text-faint">
                      {r.views ? (r.src === "saisie" ? "Vues saisies à la main" : `Vues : ${SRC_LABEL[r.src] ?? "données du créateur"}`) : estimate ? `Vues estimées : ${Math.round((fmtOf?.rate ?? 0) * 100)} % des abonnés (habituel pour ce format)` : "Renseigne les abonnés ou les vues"}
                      {" · taux d'engagement "}{r.erBase === "views" ? "(sur les vues)" : "(sur les abonnés)"}
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
                <Picker ariaLabel="Exclusivité" value={infOpts.exclusivite} onChange={(v) => setInfOpts((o) => ({ ...o, exclusivite: v }))}
                  options={EXCLUSIVITY.map((x) => ({ value: x.value, label: `${x.label}${x.m ? ` (+${Math.round(x.m * 100)} %)` : ""}` }))} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LBL}>Droits d'usage par la marque</span>
                <Picker ariaLabel="Droits d'usage" value={infOpts.droitsUsage} onChange={(v) => setInfOpts((o) => ({ ...o, droitsUsage: v }))}
                  options={USAGE_RIGHTS.map((x) => ({ value: x.value, label: `${x.label}${x.m ? ` (+${Math.round(x.m * 100)} %)` : ""}` }))} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground" title="La marque diffuse le contenu en publicité depuis le compte du créateur (Spark Ads TikTok, pubs partenaires Instagram)">
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
                <Picker ariaLabel="Niveau UGC" value={level} onChange={setLevel} options={UGC_LEVELS.map((l) => ({ value: l.value, label: `${l.label} (×${l.m})` }))} />
              </label>
              <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 160 }}>
                <span className={LBL}>Droits d'exploitation</span>
                <Picker ariaLabel="Droits d'exploitation" value={ugcOpts.usage} onChange={(v) => setUgcOpts((o) => ({ ...o, usage: v }))}
                  options={UGC_USAGE.map((u) => ({ value: u.value, label: `${u.label}${u.m ? ` (+${Math.round(u.m * 100)} %)` : ""}` }))} />
              </label>
            </div>

            <span className={LBL}>Livrables UGC</span>
            <div className="mt-2 flex flex-col gap-2">
              {ugcRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-xl border border-border bg-panel p-2.5">
                  <Picker size="sm" ariaLabel="Type de livrable" className="flex-1" value={r.type} onChange={(v) => setUgcRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, type: v } : x)))} options={UGC_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
                  <input type="number" min={1} value={r.qty} onChange={(e) => setUgcRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : x)))} title="Quantité" className="w-14 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-[13px] tabular-nums outline-none focus:border-primary" />
                  {ugcRows.length > 1 && (
                    <button type="button" onClick={() => setUgcRows((rows) => rows.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-destructive">
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
                {formatEuro(result.min)} <span className="text-faint">à</span> {formatEuro(result.max)}
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
                        <span className="shrink-0 font-medium tabular-nums text-foreground">{r.max > 0 ? `${formatEuro(r.min)} à ${formatEuro(r.max)}` : "—"}</span>
                      </div>
                      {r.explain && <div className="mt-0.5 text-[11px] leading-snug text-faint">{r.explain}</div>}
                    </div>
                  ))
                : ugc.itemsPriced.map((r, i) => (
                    <Line key={i} l={`${UGC_TYPES.find((t) => t.key === r.item.type)?.label} ×${r.item.qty}`} v={r.max > 0 ? `${formatEuro(r.min)} à ${formatEuro(r.max)}` : "—"} />
                  ))}
              {/* Options et remise en euros : lignes + options − remise = fourchette affichée. */}
              {result.options.max > 0 && <Line l={`Options +${result.optionsPct} %`} v={`+${formatEuro(result.options.min)} à +${formatEuro(result.options.max)}`} />}
              {result.discount.max > 0 && <Line l={`Remise pack −${result.discountPct} %`} v={`−${formatEuro(result.discount.min)} à −${formatEuro(result.discount.max)}`} />}
              {mode === "influence" && inf.itemsPriced[0] && (
                <Line l="Palier (1re plateforme)" v={tier(parseFollowers(infRows[0]?.followers))} />
              )}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted p-3 text-[12px] leading-snug text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {mode === "influence"
                  ? <>Ne descends pas sous <span className="font-semibold text-foreground">{formatEuro(result.min)}</span> sans contrepartie.</>
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
  // Formats réellement modifiés ici : à l'enregistrement, on les fusionne dans le barème
  // relu (un format changé par un collègue entre-temps n'est pas écrasé).
  const [touched, setTouched] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (key: string, patch: { cpm?: [number, number]; rate?: number }) => {
    setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? {}), ...patch } }));
    setTouched((t) => (t.includes(key) ? t : [...t, key]));
  };
  // Ligne invalide (min à 0, min > max, part des abonnés hors 1 à 300 %) : avant, elle
  // était ignorée en silence par le calcul. Maintenant : erreur sous la ligne, rien enregistré.
  const errOf = (key: string): string => {
    const o = draft[key];
    if (!o) return "";
    if (o.cpm && !(o.cpm[0] > 0 && o.cpm[1] >= o.cpm[0])) return "Fourchette invalide : le minimum doit être supérieur à 0 et ne pas dépasser le maximum.";
    if (o.rate !== undefined && !(o.rate > 0 && o.rate <= 3)) return "Part des abonnés invalide : entre 1 et 300 %.";
    return "";
  };
  const save = async (reset: boolean) => {
    if (!reset && touched.some((k) => errOf(k))) {
      toast("Corrige les lignes en erreur : rien n'a été enregistré");
      return;
    }
    setSaving(true);
    try {
      let next: RateOverrides = {};
      if (!reset) {
        invalidateAppState();
        const raw = (await getAppState())["pricingRates"];
        const fresh = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as RateOverrides) : {};
        next = { ...fresh };
        for (const k of touched) if (draft[k]) next[k] = draft[k];
      }
      const ok = await saveAppStateKey("pricingRates", next);
      toast(ok ? (reset ? "Barème par défaut rétabli ✓" : "Barème enregistré pour toute l'équipe ✓") : "Erreur, réessaie");
      if (ok) onClose();
    } catch {
      toast("Lecture impossible : rien n'a été enregistré, réessaie");
    } finally {
      setSaving(false);
    }
  };
  const num = (v: string) => Math.max(0, parseFloat(v.replace(",", ".")) || 0);
  return (
    <div className="mt-4 rounded-xl border border-border bg-panel/50 p-3">
      <div className="mb-2 text-[12px] font-semibold text-foreground">Barème de l'agence</div>
      <div className="mb-2 text-[11px] leading-snug text-muted-foreground">€ pour 1000 abonnés (fourchette) et part habituelle des abonnés qui voient un contenu. Le coût pour 1000 vues qui s'en déduit sert au calcul interne : il n'est pas comparable à un CPM publicitaire, ne pas le présenter à la marque.</div>
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
        {INF_PLATFORMS.flatMap((p) => p.formats.map((f) => {
          const key = `${p.key}.${f.key}`;
          const cur = infFormat(p.key, f.key, draft)!;
          const cv = cpmViews(cur);
          // Valeurs SAISIES (même invalides) : modifier le max ne doit pas effacer le min tapé.
          const raw = { cpm: draft[key]?.cpm ?? cur.cpm, rate: draft[key]?.rate ?? cur.rate };
          const err = errOf(key);
          const box = `rounded-md border bg-surface px-1.5 py-1 text-center tabular-nums outline-none focus:border-primary ${err ? "border-destructive" : "border-border"}`;
          return (
            <div key={key}>
              <div className="grid grid-cols-[minmax(0,1fr)_56px_56px_52px] items-center gap-1.5 text-[11px]">
                <span className="truncate text-foreground">{p.label} · {f.label}<span className="block text-faint">{Math.round(cv[0])} à {Math.round(cv[1])} € / 1000 vues (calcul interne)</span></span>
                <input defaultValue={raw.cpm[0]} onBlur={(e) => set(key, { cpm: [num(e.target.value), raw.cpm[1]] })} title="€ / 1000 abonnés (min)" className={box} />
                <input defaultValue={raw.cpm[1]} onBlur={(e) => set(key, { cpm: [raw.cpm[0], num(e.target.value)] })} title="€ / 1000 abonnés (max)" className={box} />
                <input defaultValue={Math.round(raw.rate * 100)} onBlur={(e) => set(key, { rate: num(e.target.value) / 100 })} title="% des abonnés qui voient habituellement ce format" className={box} />
              </div>
              {err && <div className="mt-0.5 text-[10px] leading-snug text-destructive">{err}</div>}
            </div>
          );
        }))}
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_56px_56px_52px] gap-1.5 text-[10px] text-faint">
        <span /> <span className="text-center">€ min</span> <span className="text-center">€ max</span> <span className="text-center">% vues</span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {confirmReset ? (
          <button type="button" onClick={() => void save(true)} disabled={saving} className="flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"><RotateCcw className="h-3 w-3" /> Confirmer : effacer le barème de l'agence</button>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} disabled={saving} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover"><RotateCcw className="h-3 w-3" /> Barème par défaut</button>
        )}
        <button type="button" onClick={onClose} className="rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover">Annuler</button>
        <button type="button" onClick={() => void save(false)} disabled={saving} className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">Enregistrer</button>
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

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Copy, Users, Sparkles, SlidersHorizontal, RotateCcw, Minus, Search, Check, FileText, Handshake, ChevronDown, PenLine, Send, X } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { useCreators, type CreatorLite } from "@/lib/useCreators";
import { formatEuro, getAppState, invalidateAppState, saveAppStateKey, useAppState } from "@/lib/appState";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { Picker } from "@/components/ui/form";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpTip } from "@/components/ui/help-tip";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { PageHeaderRow } from "@/components/ui/page-header";
import { dbUpdate } from "@/lib/db";
import {
  INF_PLATFORMS, NICHES, nicheMult, infFormat, computeInfluence, parseFollowers, parseEr, cpmViews, EXCLUSIVITY, USAGE_RIGHTS,
  UGC_TYPES, UGC_LEVELS, UGC_USAGE, ugcLevelMult, computeUgc,
  type PlatKey, type InfItem, type UgcItem, type RateOverrides,
} from "@/lib/pricing";
import { deliverablesText, missingAudienceText, priceRange, quoteInvoiceLines, ugcDeliverablesText } from "@/lib/pricingForm";
import { putInvoicePrefill } from "@/lib/invoicePrefill";
import { saveProposal } from "@/lib/prospectsDb";
import { Overlay } from "@/components/mobile/ios-sheet";
import { fmtCompact } from "@/lib/timeSeries";

/** Créateur choisi : aucun (recherche), saisie libre, ou l'id d'un créateur du roster. */
const NONE = "";
const EXTERNAL = "__external__";
let _rid = 0;
const rid = () => `p${Date.now().toString(36)}${(_rid += 1)}`;

const LBL = "text-[12px] font-medium text-muted-foreground";
const INPUT = "h-9 w-full min-w-0 rounded-[10px] border border-border bg-surface px-2.5 text-[13px] tabular-nums outline-none focus:border-primary";
const BLOCK = "rounded-2xl border border-border bg-surface p-5";
const BLOCK_TITLE = "mb-3 text-[14px] font-semibold text-foreground";

type Mode = "influence" | "ugc";
/** Un livrable d'influence : plateforme, format, quantité. L'audience vit par plateforme. */
type InfRow = { id: string; platform: PlatKey; format: string; qty: number };
/** Audience d'une plateforme (saisie une fois, ou reprise de la fiche du créateur). */
type Aud = { followers: string; er: string; views: string; storyViews: string; shortViews?: string; src: string; erBase: "views" | "followers" };
const NO_AUD: Aud = { followers: "", er: "", views: "", storyViews: "", src: "", erBase: "followers" };
const SRC_LABEL: Record<string, string> = {
  tiktok: "Vues mesurées sur TikTok (12 dernières vidéos)",
  youtube: "Vues mesurées sur YouTube (dernières vidéos, Shorts à part)",
  instagram: "Chiffres Instagram du jour",
  igreels: "Vues mesurées sur Instagram (derniers reels)",
  kit: "Vues du media kit",
  fiche: "Chiffres de la fiche",
  saisie: "Vues saisies à la main",
};
/** Formats dont les vues moyennes de la plateforme mesurent un contenu. */
const VIDEO_FORMATS = ["reel", "video", "integration", "dedicated"];
type UgcRow = { id: string; type: string; qty: number };
type CollabPick = { id: string; brand: string | null; creator: string | null; cachet: string | null; deliverables: string | null };

const platLabel = (k: PlatKey) => INF_PLATFORMS.find((p) => p.key === k)?.label ?? k;
const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Vues attendues d'un livrable : celles de la plateforme pour le format qu'elles mesurent, sinon vide (estimées). */
function viewsFor(r: InfRow, a: Aud): string {
  if (r.format === "story") return a.storyViews;
  if (r.format === "short") return a.shortViews ?? a.views;
  return VIDEO_FORMATS.includes(r.format) ? a.views : "";
}

export function Pricing() {
  const creators = useCreators();
  const [mode, setMode] = useState<Mode>("influence");
  const [creatorId, setCreatorId] = useState<string>(NONE);
  const [niche, setNiche] = useState<string>("lifestyle");
  const [level, setLevel] = useState<string>("confirme");

  // Audience PAR PLATEFORME, pré-remplie depuis les vraies données du créateur
  // (TikTok connecté, Instagram du jour, media kit), sinon depuis sa fiche.
  const [aud, setAud] = useState<Record<string, Aud>>({});

  const [infRows, setInfRows] = useState<InfRow[]>([{ id: rid(), platform: "instagram", format: "reel", qty: 1 }]);
  const [infOpts, setInfOpts] = useState<{ exclusivite: string; droitsUsage: string; whitelisting: boolean; remisePct: number }>({ exclusivite: "none", droitsUsage: "none", whitelisting: false, remisePct: 0 });
  // Barème de l'agence (partagé par l'équipe) : remplace celui par défaut format par format.
  const { data: rates } = useAppState((st) => (st.pricingRates as RateOverrides | undefined) ?? {});
  const [ratesOpen, setRatesOpen] = useState(false);

  const [ugcRows, setUgcRows] = useState<UgcRow[]>([{ id: rid(), type: "video_court", qty: 2 }]);
  const [ugcOpts, setUgcOpts] = useState({ usage: "none", exclusivite: false, rushes: false, montage: false, express: false });

  // « Ajouter à la collab » : liste des collabs en cours, puis confirmation.
  const [collabs, setCollabs] = useState<CollabPick[] | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);
  const [pendingCollab, setPendingCollab] = useState<CollabPick | null>(null);
  // « Proposer » : la proposition va sur le prospect de la marque (Prospection).
  const [proposeOpen, setProposeOpen] = useState(false);

  // Charge le créateur → audience par plateforme (vraies données d'abord) + niche.
  useEffect(() => {
    if (creatorId === NONE || creatorId === EXTERNAL) {
      // Pas d'audience ni de niche héritées du créateur précédent : retour au neutre.
      setAud({});
      setNiche("lifestyle");
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
      // Plateformes sans chiffres dédiés : ceux de la fiche (abonnés, engagement).
      const fb: Aud = { ...NO_AUD, followers: String(row.followers ?? ""), er: String(row.er ?? ""), src: "fiche", erBase: "views" };
      const full: Record<string, Aud> = {};
      for (const p of INF_PLATFORMS) full[p.key] = map[p.key] ?? fb;
      setAud(full);
      // Niche du créateur, sinon Lifestyle (×1) : jamais celle du créateur précédent.
      const n = (row.niche ?? "").toLowerCase().trim();
      const match = n ? NICHES.find((x) => x.label.toLowerCase().includes(n) || n.includes(x.value)) : undefined;
      setNiche(match?.value ?? "lifestyle");
    });
    return () => { alive = false; };
  }, [creatorId]);

  const audOf = (k: PlatKey): Aud => aud[k] ?? NO_AUD;
  const setAudOf = (k: PlatKey, patch: Partial<Aud>) => setAud((m) => ({ ...m, [k]: { ...(m[k] ?? NO_AUD), ...patch } }));

  const infItems: InfItem[] = infRows.map((r) => {
    const a = audOf(r.platform);
    return { platform: r.platform, format: r.format, qty: r.qty, followers: parseFollowers(a.followers), er: parseEr(a.er), views: parseFollowers(viewsFor(r, a)), erBase: a.erBase };
  });
  const inf = useMemo(() => computeInfluence(infItems, nicheMult(niche), infOpts, rates ?? {}), [infItems, niche, infOpts, rates]);
  const ugcItems: UgcItem[] = ugcRows.map((r) => ({ type: r.type, qty: r.qty }));
  const ugc = useMemo(() => computeUgc(ugcItems, ugcLevelMult(level), ugcOpts), [ugcItems, level, ugcOpts]);

  const result = mode === "influence" ? inf : ugc;
  const hasResult = result.max > 0;
  const selName = creatorId !== NONE && creatorId !== EXTERNAL ? creators.find((c) => c.id === creatorId)?.name : undefined;
  const who = selName ? titleCase(selName) : "";
  const usedPlatforms = [...new Set(infRows.map((r) => r.platform))];

  // Ce qui manque pour chiffrer (remplace un texte d'explication).
  const missing =
    mode === "influence"
      ? infRows.length === 0
        ? "Ajoute un livrable"
        : missingAudienceText(inf.itemsPriced.filter((r) => r.max <= 0).map((r) => platLabel(r.item.platform)))
      : ugcRows.length === 0
        ? "Ajoute un livrable"
        : null;

  // ── Livrables ──
  const setInf = (id: string, patch: Partial<InfRow>) =>
    setInfRows((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      // Changement de plateforme : premier format valide de la nouvelle plateforme.
      if (patch.platform && patch.platform !== r.platform) next.format = INF_PLATFORMS.find((p) => p.key === patch.platform)!.formats[0].key;
      return next;
    }));
  // Nouveau livrable : même plateforme que le dernier, son premier format.
  const addInf = () =>
    setInfRows((rows) => {
      const platform = rows[rows.length - 1]?.platform ?? "instagram";
      return [...rows, { id: rid(), platform, format: INF_PLATFORMS.find((p) => p.key === platform)!.formats[0].key, qty: 1 }];
    });

  const infLineLabel = (item: InfItem) => `${platLabel(item.platform)} · ${infFormat(item.platform, item.format)?.label} × ${item.qty}`;
  const ugcLineLabel = (item: UgcItem) => `${UGC_TYPES.find((t) => t.key === item.type)?.label} × ${item.qty}`;

  // Majorations affichées une par une (leur somme = « Options » du calcul).
  const ex = EXCLUSIVITY.find((x) => x.value === infOpts.exclusivite);
  const us = USAGE_RIGHTS.find((x) => x.value === infOpts.droitsUsage);
  const ugcUs = UGC_USAGE.find((x) => x.value === ugcOpts.usage);
  const majorations: { label: string; pct: number }[] =
    mode === "influence"
      ? [
          ...(ex && ex.m ? [{ label: `Exclusivité ${ex.label}`, pct: Math.round(ex.m * 100) }] : []),
          ...(us && us.m ? [{ label: `Droits · ${us.label}`, pct: Math.round(us.m * 100) }] : []),
          ...(infOpts.whitelisting ? [{ label: "Pub depuis le compte du créateur", pct: 20 }] : []),
        ]
      : [
          ...(ugcUs && ugcUs.m ? [{ label: `Droits · ${ugcUs.label}`, pct: Math.round(ugcUs.m * 100) }] : []),
          ...(ugcOpts.exclusivite ? [{ label: "Exclusivité", pct: 25 }] : []),
          ...(ugcOpts.rushes ? [{ label: "Fichiers bruts", pct: 15 }] : []),
          ...(ugcOpts.montage ? [{ label: "Montage avancé", pct: 20 }] : []),
          ...(ugcOpts.express ? [{ label: "Livraison express", pct: 20 }] : []),
        ];

  /**
   * Proposition copiée pour la marque : lignes à 0 € exclues, sous-total = somme des
   * lignes, puis majorations et remise en euros, puis le total. Mêmes chiffres qu'à l'écran
   * (quoteTotals), à l'euro près, tout HT.
   */
  const copyQuote = () => {
    const name = who || "Créateur";
    const rng = (r: { min: number; max: number }) => (r.min === r.max ? formatEuro(r.min) : `${formatEuro(r.min)} à ${formatEuro(r.max)}`);
    const sign = (r: { min: number; max: number }, s: string) => (r.min === r.max ? `${s}${formatEuro(r.min)}` : `${s}${formatEuro(r.min)} à ${s}${formatEuro(r.max)}`);
    const lines: string[] = [];
    if (mode === "influence") {
      inf.itemsPriced.filter((r) => r.max > 0).forEach(({ item, min, max, views, estimated, capped }) => {
        // Vues plafonnées : on annonce les vues RETENUES pour le prix, pas une moyenne virale.
        const v = views > 0 ? `, ${estimated ? "≈ " : ""}${fmtCompact(views)} vues ${capped ? "retenues " : ""}par contenu` : "";
        lines.push(`• ${infLineLabel(item)}${v} : ${rng({ min, max })}`);
      });
    } else {
      ugc.itemsPriced.filter((r) => r.max > 0).forEach(({ item, min, max }) => lines.push(`• ${ugcLineLabel(item)} : ${rng({ min, max })}`));
    }
    const q = result;
    let txt = `${mode === "influence" ? "Proposition tarifaire" : "Proposition UGC"} : ${name}, montants HT\n\n${lines.join("\n")}\n`;
    if (q.options.max > 0 || q.discount.max > 0) {
      txt += `\nSous-total : ${rng(q.sub)}\n`;
      if (q.options.max > 0) txt += `• Majorations, ${majorations.map((m) => m.label.toLowerCase()).join(", ")} : +${q.optionsPct} % soit ${sign(q.options, "+")}\n`;
      if (q.discount.max > 0) txt += `• Remise pack −${q.discountPct} % : ${sign(q.discount, "−")}\n`;
    }
    txt += `\nTotal : ${rng(q)} HT, cible ${formatEuro(q.mid)} HT.`;
    navigator.clipboard?.writeText(txt).then(() => toast("Proposition copiée ✓")).catch(() => toast("Copie impossible"));
  };

  /** « Créer le devis » : nouvelle facture en brouillon dans Facturation, lignes au prix cible. */
  const createQuote = () => {
    const lines = mode === "influence"
      ? inf.itemsPriced.map((r) => ({ label: infLineLabel(r.item), mid: r.mid }))
      : ugc.itemsPriced.map((r) => ({ label: ugcLineLabel(r.item), mid: r.mid }));
    const ok = putInvoicePrefill({
      creator: selName ?? "",
      brand: "",
      lines: quoteInvoiceLines(lines, { pct: result.optionsPct, mid: result.options.mid }, { pct: result.discountPct, mid: result.discount.mid }),
    });
    if (!ok) return toast("Impossible de préparer le devis");
    window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "facturation" }));
  };

  // Livrables et cachet écrits dans la collab (forme lue par la page Collabs).
  const collabDeliverables = mode === "influence" ? deliverablesText(infRows) : ugcDeliverablesText(ugcRows.map((r) => ({ label: UGC_TYPES.find((t) => t.key === r.type)?.label ?? r.type, qty: r.qty })));
  const collabCachet = formatEuro(result.mid);

  const loadCollabs = () => {
    setCollabs(null);
    void supabase
      .from("collabs")
      .select("id, brand, creator, cachet, deliverables")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => setCollabs(error ? [] : ((data as CollabPick[]) ?? [])));
  };
  // Collabs du créateur choisi d'abord (toutes si aucune ne correspond).
  const collabList = useMemo(() => {
    const all = collabs ?? [];
    if (!selName) return all;
    const mine = all.filter((c) => fold(c.creator) === fold(selName) || fold(c.creator).split(" ")[0] === fold(selName).split(" ")[0]);
    return mine.length ? mine : all;
  }, [collabs, selName]);
  const propose = async (brand: string, contact: string) => {
    const r = await saveProposal(
      { mode, creator: selName ?? null, deliverables: collabDeliverables, min: result.min, max: result.max, target: result.mid, at: new Date().toISOString() },
      brand,
      contact.trim() || null,
    );
    if (!r) {
      toast("Erreur, réessaie");
      return false;
    }
    toast(r.created ? `Prospect ${brand.trim()} créé ✓` : `Proposition ajoutée à ${brand.trim()} ✓`);
    return true;
  };
  const writeCollab = async (c: CollabPick) => {
    const ok = await dbUpdate("collabs", c.id, { cachet: collabCachet, deliverables: collabDeliverables || null });
    toast(ok ? "Collab mise à jour ✓" : "Erreur, réessaie");
  };

  const priceCard = (
    <>
      <div className="text-[12px] font-medium text-muted-foreground">
        {[mode === "influence" ? "Influence" : "UGC", who].filter(Boolean).join(" · ")}
      </div>
      {hasResult ? (
        <>
          <div className="mt-1 text-[30px] font-semibold leading-tight tracking-tight tabular-nums text-foreground xl:text-[36px]">
            {priceRange(result.min, result.max)}
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            Cible <span className="font-semibold tabular-nums text-foreground">{formatEuro(result.mid)} HT</span>
          </div>
          {missing && <div className="mt-2 text-[12px] font-medium text-wait">{missing}</div>}
        </>
      ) : (
        <div className="mt-1 text-[20px] font-semibold leading-snug tracking-tight text-muted-foreground">{missing ?? "Ajoute un livrable"}</div>
      )}
    </>
  );

  return (
    <div>
      {mode === "influence" && (
        <PageHeaderRow>
          <Popover open={ratesOpen} onOpenChange={setRatesOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover">
                <SlidersHorizontal className="h-4 w-4" /> Barème de l'agence{rates && Object.keys(rates).length ? " · personnalisé" : ""}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(30rem,calc(100vw-2rem))] p-0">
              <RatesEditor rates={rates ?? {}} onClose={() => setRatesOpen(false)} />
            </PopoverContent>
          </Popover>
        </PageHeaderRow>
      )}

      {/* Influence ou UGC : change tout le reste, donc tout en haut. */}
      <Tabs
        className="mb-4"
        label="Type de package"
        items={[
          { value: "influence", label: "Influence", icon: <Users className="h-3.5 w-3.5" /> },
          { value: "ugc", label: "UGC", icon: <Sparkles className="h-3.5 w-3.5" /> },
        ]}
        value={mode}
        onValueChange={(v) => setMode(v as Mode)}
      />

      {/* Téléphone : le prix reste visible en haut pendant la saisie. */}
      {/* Téléphone : collée SOUS la barre de titre iOS (collante elle aussi : 44 px + encoche). */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur max-md:top-[calc(env(safe-area-inset-top)+2.75rem)] lg:hidden">{priceCard}</div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ============ ENTRÉES : Qui, Quoi, Conditions ============ */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
          <section className={BLOCK}>
            <div className={BLOCK_TITLE}>Qui</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className={LBL}>Créateur</span>
                <CreatorSearch creators={creators} value={creatorId} onChange={setCreatorId} />
              </div>
              {mode === "influence" ? (
                <div className="flex flex-col gap-1.5">
                  <span className={LBL}>Niche</span>
                  <Picker ariaLabel="Niche" value={niche} onChange={setNiche} options={NICHES.map((n) => ({ value: n.value, label: n.label }))} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className={LBL}>Niveau</span>
                  <Picker ariaLabel="Niveau UGC" value={level} onChange={setLevel} options={UGC_LEVELS.map((l) => ({ value: l.value, label: `${l.label} ×${String(l.m).replace(".", ",")}` }))} />
                </div>
              )}
            </div>
          </section>

          <section className={BLOCK}>
            <div className={BLOCK_TITLE}>Quoi</div>
            {mode === "influence" ? (
              <>
                <span className={LBL}>Audience</span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {usedPlatforms.map((k) => {
                    const a = audOf(k);
                    const story = infRows.some((r) => r.platform === k && r.format === "story");
                    const short = k === "youtube" && infRows.some((r) => r.platform === k && r.format === "short");
                    const video = infRows.find((r) => r.platform === k && VIDEO_FORMATS.includes(r.format));
                    const fmt = video ? infFormat(k, video.format, rates ?? {}) : undefined;
                    const estimate = fmt ? Math.round(parseFollowers(a.followers) * fmt.rate) : 0;
                    return (
                      <div key={k} className="rounded-xl bg-panel p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                          <PlatformIcon platform={k} className="h-3.5 w-3.5 text-muted-foreground" /> {platLabel(k)}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-muted-foreground">Abonnés</span>
                            <input inputMode="decimal" value={a.followers} onChange={(e) => setAudOf(k, { followers: e.target.value })} placeholder="12 000" className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-muted-foreground">Engagement %</span>
                            <input inputMode="decimal" value={a.er} onChange={(e) => setAudOf(k, { er: e.target.value })} placeholder="3,5" title={a.erBase === "views" ? "Sur les vues" : "Sur les abonnés"} className={INPUT} />
                          </label>
                          {video && (
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-muted-foreground">Vues par contenu</span>
                              <input
                                inputMode="decimal"
                                value={a.views}
                                onChange={(e) => setAudOf(k, { views: e.target.value, src: e.target.value ? "saisie" : a.src })}
                                placeholder={estimate ? `≈ ${fmtCompact(estimate)}` : "estimées"}
                                title={a.views ? SRC_LABEL[a.src] : undefined}
                                className={INPUT}
                              />
                            </label>
                          )}
                          {story && (
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-muted-foreground">Vues story</span>
                              <input inputMode="decimal" value={a.storyViews} onChange={(e) => setAudOf(k, { storyViews: e.target.value })} placeholder="estimées" className={INPUT} />
                            </label>
                          )}
                          {short && (
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-muted-foreground">Vues Shorts</span>
                              <input inputMode="decimal" value={a.shortViews ?? ""} onChange={(e) => setAudOf(k, { shortViews: e.target.value })} placeholder="estimées" className={INPUT} />
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <span className={cn(LBL, "mt-4 block")}>Livrables</span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {infRows.map((r) => {
                    const plat = INF_PLATFORMS.find((p) => p.key === r.platform)!;
                    return (
                      <div key={r.id} className="flex flex-col gap-2 rounded-xl bg-panel p-3">
                        <div className="flex gap-2">
                          <Picker size="sm" ariaLabel="Plateforme" className="flex-1" value={r.platform} onChange={(v) => setInf(r.id, { platform: v as PlatKey })} options={INF_PLATFORMS.map((p) => ({ value: p.key, label: p.label }))} />
                          <Picker size="sm" ariaLabel="Format" className="flex-1" value={r.format} onChange={(v) => setInf(r.id, { format: v })} options={plat.formats.map((f) => ({ value: f.key, label: f.label }))} />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Counter value={r.qty} onChange={(qty) => setInf(r.id, { qty })} />
                          {infRows.length > 1 && <RemoveButton onClick={() => setInfRows((rows) => rows.filter((x) => x.id !== r.id))} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <AddLine onClick={addInf} />
              </>
            ) : (
              <>
                <span className={LBL}>Livrables</span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ugcRows.map((r) => (
                    <div key={r.id} className="flex flex-col gap-2 rounded-xl bg-panel p-3">
                      <Picker size="sm" ariaLabel="Type de livrable" value={r.type} onChange={(v) => setUgcRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, type: v } : x)))} options={UGC_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
                      <div className="flex items-center justify-between gap-2">
                        <Counter value={r.qty} onChange={(qty) => setUgcRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, qty } : x)))} />
                        {ugcRows.length > 1 && <RemoveButton onClick={() => setUgcRows((rows) => rows.filter((x) => x.id !== r.id))} />}
                      </div>
                    </div>
                  ))}
                </div>
                <AddLine onClick={() => setUgcRows((rows) => [...rows, { id: rid(), type: "video_court", qty: 1 }])} />
              </>
            )}
          </section>

          <section className={BLOCK}>
            <div className={BLOCK_TITLE}>Conditions</div>
            {mode === "influence" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className={LBL}>Exclusivité</span>
                  <Picker ariaLabel="Exclusivité" value={infOpts.exclusivite} onChange={(v) => setInfOpts((o) => ({ ...o, exclusivite: v }))}
                    options={EXCLUSIVITY.map((x) => ({ value: x.value, label: `${x.label}${x.m ? ` (+${Math.round(x.m * 100)} %)` : ""}` }))} />
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className={LBL}>Droits d'usage</span>
                  <UsageMenu
                    value={infOpts.droitsUsage}
                    whitelisting={infOpts.whitelisting}
                    onChange={(droitsUsage) => setInfOpts((o) => ({ ...o, droitsUsage }))}
                    onWhitelisting={(whitelisting) => setInfOpts((o) => ({ ...o, whitelisting }))}
                  />
                </div>
              </div>
            ) : (
              <>
                <label className="flex max-w-sm flex-col gap-1.5">
                  <span className={LBL}>Droits d'exploitation</span>
                  <Picker ariaLabel="Droits d'exploitation" value={ugcOpts.usage} onChange={(v) => setUgcOpts((o) => ({ ...o, usage: v }))}
                    options={UGC_USAGE.map((u) => ({ value: u.value, label: `${u.label}${u.m ? ` (+${Math.round(u.m * 100)} %)` : ""}` }))} />
                </label>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  {([["exclusivite", "Exclusivité", "+25 %"], ["rushes", "Fichiers bruts", "+15 %"], ["montage", "Montage avancé", "+20 %"], ["express", "Livraison express", "+20 %"]] as const).map(([k, label, pct]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                      <input type="checkbox" checked={ugcOpts[k]} onChange={(e) => setUgcOpts((o) => ({ ...o, [k]: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                      {label} <span className="text-faint">{pct}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ============ RÉSULTAT (collé en haut au défilement) ============ */}
        <section className="hidden min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-4 lg:col-span-5 lg:flex lg:self-start">
          {priceCard}
          <ResultDetail
            mode={mode}
            lines={
              mode === "influence"
                ? inf.itemsPriced.map((r) => ({ label: infLineLabel(r.item), min: r.min, max: r.max, explain: r.explain }))
                : ugc.itemsPriced.map((r) => ({ label: ugcLineLabel(r.item), min: r.min, max: r.max }))
            }
            majorations={majorations}
            result={result}
            remisePct={infOpts.remisePct}
            onRemise={(remisePct) => setInfOpts((o) => ({ ...o, remisePct }))}
          />
          <Actions
            disabled={!hasResult}
            onCopy={copyQuote}
            onQuote={createQuote}
            onPropose={() => setProposeOpen(true)}
            collabOpen={collabOpen}
            onCollabOpen={(v) => {
              setCollabOpen(v);
              if (v) loadCollabs();
            }}
            collabs={collabs === null ? null : collabList}
            onPickCollab={(c) => {
              setCollabOpen(false);
              setPendingCollab(c);
            }}
          />
        </section>

        {/* Téléphone : détail et actions sous le formulaire. */}
        <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 lg:hidden">
          <ResultDetail
            mode={mode}
            lines={
              mode === "influence"
                ? inf.itemsPriced.map((r) => ({ label: infLineLabel(r.item), min: r.min, max: r.max, explain: r.explain }))
                : ugc.itemsPriced.map((r) => ({ label: ugcLineLabel(r.item), min: r.min, max: r.max }))
            }
            majorations={majorations}
            result={result}
            remisePct={infOpts.remisePct}
            onRemise={(remisePct) => setInfOpts((o) => ({ ...o, remisePct }))}
          />
          <Actions
            disabled={!hasResult}
            onCopy={copyQuote}
            onQuote={createQuote}
            onPropose={() => setProposeOpen(true)}
            collabOpen={collabOpen}
            onCollabOpen={(v) => {
              setCollabOpen(v);
              if (v) loadCollabs();
            }}
            collabs={collabs === null ? null : collabList}
            onPickCollab={(c) => {
              setCollabOpen(false);
              setPendingCollab(c);
            }}
          />
        </section>
      </div>

      {proposeOpen && (
        <ProposeDialog
          price={priceRange(result.min, result.max)}
          onClose={() => setProposeOpen(false)}
          onSave={async (brand, contact) => {
            if (await propose(brand, contact)) setProposeOpen(false);
          }}
        />
      )}

      {pendingCollab && (
        <ConfirmDialog
          title="Ajouter à la collab"
          message={`Écrire le cachet « ${collabCachet} »${collabDeliverables ? ` et les livrables « ${collabDeliverables} »` : ""} dans la collab ${[pendingCollab.brand, pendingCollab.creator ? titleCase(pendingCollab.creator) : ""].filter(Boolean).join(" × ")} ?${pendingCollab.cachet || pendingCollab.deliverables ? " Le cachet et les livrables actuels seront remplacés." : ""}`}
          confirmLabel="Ajouter"
          onCancel={() => setPendingCollab(null)}
          onConfirm={() => {
            const c = pendingCollab;
            setPendingCollab(null);
            void writeCollab(c);
          }}
        />
      )}
    </div>
  );
}

/** Créateur : recherche avec les photos du roster, « Saisie libre » en dernier choix. */
function CreatorSearch({ creators, value, onChange }: { creators: CreatorLite[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const picked = creators.find((c) => c.id === value);
  const list = creators.filter((c) => !q.trim() || fold(c.name).includes(fold(q)) || fold(c.handle).includes(fold(q)));
  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  const row = "flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-rowhover focus-visible:bg-rowhover";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Créateur" className="flex h-[42px] w-full min-w-0 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring">
          {picked ? (
            <>
              <CreatorAvatar name={picked.name} photoUrl={picked.photo_url} className="h-6 w-6 shrink-0 rounded-full text-[10px]" />
              <span className="min-w-0 flex-1 truncate text-left">{titleCase(picked.name)}</span>
            </>
          ) : value === EXTERNAL ? (
            <>
              <PenLine className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">Saisie libre</span>
            </>
          ) : (
            <>
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">Chercher un créateur</span>
            </>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && list[0]) choose(list[0].id);
          }}
          placeholder="Nom ou @"
          className="mb-1 h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-primary"
        />
        <div className="max-h-72 overflow-y-auto">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => choose(c.id)} className={row}>
              <CreatorAvatar name={c.name} photoUrl={c.photo_url} className="h-7 w-7 shrink-0 rounded-full text-[10px]" />
              <span className="min-w-0 flex-1 truncate">{titleCase(c.name)}</span>
              {c.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
          {list.length === 0 && <div className="px-2.5 py-2 text-[12px] text-muted-foreground">Aucun</div>}
          <div className="my-1 border-t border-border" />
          <button type="button" onClick={() => choose(EXTERNAL)} className={row}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted"><PenLine className="h-3.5 w-3.5 text-muted-foreground" /></span>
            <span className="min-w-0 flex-1 truncate">Saisie libre</span>
            {value === EXTERNAL && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Droits d'usage : une durée au choix, et la pub depuis le compte du créateur, cumulable. */
function UsageMenu({ value, whitelisting, onChange, onWhitelisting }: {
  value: string;
  whitelisting: boolean;
  onChange: (v: string) => void;
  onWhitelisting: (v: boolean) => void;
}) {
  const cur = USAGE_RIGHTS.find((x) => x.value === value) ?? USAGE_RIGHTS[0];
  const label = [cur.value !== "none" || !whitelisting ? cur.label : "", whitelisting ? "Pub créateur" : ""].filter(Boolean).join(" + ");
  const pct = (m: number) => (m ? ` (+${Math.round(m * 100)} %)` : "");
  const row = "flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-rowhover focus-visible:bg-rowhover";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Droits d'usage" className="flex h-[42px] w-full min-w-0 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring">
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
        {USAGE_RIGHTS.map((x) => (
          <button key={x.value} type="button" onClick={() => onChange(x.value)} className={row}>
            <span className="min-w-0 flex-1 truncate">{x.label}{pct(x.m)}</span>
            {x.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        ))}
        <div className="my-1 border-t border-border" />
        <button type="button" onClick={() => onWhitelisting(!whitelisting)} className={row} aria-pressed={whitelisting}>
          <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px]", whitelisting ? "bg-primary text-primary-foreground" : "border-2 border-faint")}>
            {whitelisting && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1 truncate">Pub depuis le compte du créateur (+20 %)</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** Détail du calcul : une ligne par livrable, les majorations, la remise, le total. */
function ResultDetail({ mode, lines, majorations, result, remisePct, onRemise }: {
  mode: Mode;
  lines: { label: string; min: number; max: number; explain?: string }[];
  majorations: { label: string; pct: number }[];
  result: { min: number; max: number; sub: { min: number; max: number }; options: { min: number; max: number }; discount: { min: number; max: number } };
  remisePct: number;
  onRemise: (pct: number) => void;
}) {
  const showSub = majorations.length > 0 || result.discount.max > 0;
  return (
    <div className="mt-4 divide-y divide-border border-t border-border text-[13px]">
      {lines.map((l, i) => (
        <div key={i} className="py-2">
          <Line l={l.label} v={l.max > 0 ? priceRange(l.min, l.max, false) : "—"} />
          {l.explain && <div className="mt-0.5 text-[11px] leading-snug text-faint">{l.explain}</div>}
        </div>
      ))}
      {showSub && <Line l="Sous-total" v={priceRange(result.sub.min, result.sub.max, false)} />}
      {majorations.map((m) => (
        <Line key={m.label} l={m.label} v={`+${m.pct} %`} />
      ))}
      {result.options.max > 0 && <Line l="Majorations" v={`+${priceRange(result.options.min, result.options.max, false)}`} />}
      {/* Remise pack : juste au-dessus du total, là où elle a un sens (influence seulement). */}
      {mode === "influence" && (
        <div className="flex items-center justify-between gap-3 py-2">
          <label className="flex items-center gap-2 text-muted-foreground">
            Remise
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={remisePct}
              onChange={(e) => onRemise(Math.min(50, Math.max(0, parseInt(e.target.value, 10) || 0)))}
              aria-label="Remise pack en %"
              className="h-8 w-14 rounded-[8px] border border-border bg-surface px-1.5 text-center text-[13px] tabular-nums text-foreground outline-none focus:border-primary"
            />
            %
          </label>
          <span className="shrink-0 font-medium tabular-nums text-foreground">{result.discount.max > 0 ? `−${priceRange(result.discount.min, result.discount.max, false)}` : "—"}</span>
        </div>
      )}
      <div className="flex justify-between gap-3 py-2.5">
        <span className="font-semibold text-foreground">Total</span>
        <span className="shrink-0 font-semibold tabular-nums text-foreground">{result.max > 0 ? priceRange(result.min, result.max) : "—"}</span>
      </div>
    </div>
  );
}

/** Actions du résultat : copier la proposition, créer le devis, l'écrire dans une collab. */
function Actions({ disabled, onCopy, onQuote, onPropose, collabOpen, onCollabOpen, collabs, onPickCollab }: {
  disabled: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onPropose: () => void;
  collabOpen: boolean;
  onCollabOpen: (v: boolean) => void;
  collabs: CollabPick[] | null;
  onPickCollab: (c: CollabPick) => void;
}) {
  const btn = "flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={disabled} onClick={onCopy} className={cn(btn, "bg-field text-foreground hover:bg-rowhover")}>
        <Copy className="h-4 w-4" /> Copier
      </button>
      <button type="button" disabled={disabled} onClick={onQuote} className={cn(btn, "bg-primary text-primary-foreground hover:opacity-90")} title="Nouvelle facture en brouillon dans Facturation, lignes remplies">
        <FileText className="h-4 w-4" /> Créer le devis
      </button>
      <button type="button" disabled={disabled} onClick={onPropose} className={cn(btn, "bg-field text-foreground hover:bg-rowhover")} title="Enregistre ce prix comme proposition sur le prospect de la marque (Prospection)">
        <Send className="h-4 w-4" /> Proposer
      </button>
      <Popover open={collabOpen} onOpenChange={onCollabOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} className={cn(btn, "bg-field text-foreground hover:bg-rowhover")} title="Écrit le cachet et les livrables dans une collab en cours">
            <Handshake className="h-4 w-4" /> Ajouter à la collab
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
          {collabs === null ? (
            <div className="px-2.5 py-2 text-[12px] text-muted-foreground">Chargement…</div>
          ) : collabs.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-muted-foreground">Aucune collab en cours</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {collabs.map((c) => (
                <button key={c.id} type="button" onClick={() => onPickCollab(c)} className="flex w-full flex-col rounded-[12px] px-2.5 py-2 text-left outline-none transition-colors hover:bg-rowhover focus-visible:bg-rowhover">
                  <span className="truncate text-[13px] font-medium text-foreground">{[c.brand, c.creator ? titleCase(c.creator) : ""].filter(Boolean).join(" × ") || "Collab"}</span>
                  {(c.cachet || c.deliverables) && <span className="truncate text-[11px] text-muted-foreground">{[c.cachet, c.deliverables].filter(Boolean).join(" · ")}</span>}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Compteur « − 1 + » d'un livrable. */
function Counter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const b = "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-40";
  return (
    <div className="flex items-center gap-1 rounded-full bg-surface p-0.5" role="group" aria-label="Quantité">
      <button type="button" className={b} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} aria-label="Un de moins">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-6 text-center text-[13px] font-semibold tabular-nums text-foreground">{value}</span>
      <button type="button" className={b} onClick={() => onChange(Math.min(99, value + 1))} aria-label="Un de plus">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Retirer ce livrable" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-destructive">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function AddLine({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-2 flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
      <Plus className="h-3.5 w-3.5" /> Ajouter
    </button>
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
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
        Barème de l'agence
        <HelpTip title="Barème de l'agence">
          <p>€ pour 1000 abonnés (fourchette) et part habituelle des abonnés qui voient un contenu, format par format.</p>
          <p>Le coût pour 1000 vues qui s'en déduit sert au calcul interne : il n'est pas comparable à un CPM publicitaire, ne pas le présenter à la marque.</p>
        </HelpTip>
      </div>
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
          <button type="button" onClick={() => void save(true)} disabled={saving} className="flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"><RotateCcw className="h-3 w-3" /> Confirmer</button>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} disabled={saving} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover"><RotateCcw className="h-3 w-3" /> Rétablir</button>
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

/** « Proposer » : marque (et contact) du prospect qui reçoit la proposition. */
function ProposeDialog({ price, onClose, onSave }: { price: string; onClose: () => void; onSave: (brand: string, contact: string) => Promise<void> }) {
  const [brand, setBrand] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const field = "h-11 w-full rounded-[12px] border border-border bg-surface px-3.5 text-[16px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary sm:text-[14px]";
  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={onClose} label="Proposer">
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!brand.trim() || busy) return;
          setBusy(true);
          void onSave(brand, contact).finally(() => setBusy(false));
        }}
        className="flex w-full flex-col gap-4 rounded-t-[22px] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-[420px] sm:rounded-[22px]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-foreground">Proposer {price}</div>
            <div className="text-[13px] text-muted-foreground">Va sur le prospect de la marque.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted-foreground">Marque</span>
          <input autoFocus value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Nike" className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted-foreground">Contact</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Prénom, email…" className={field} />
        </label>
        <button type="submit" disabled={!brand.trim() || busy} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          <Send className="h-4 w-4" /> Proposer
        </button>
      </form>
    </Overlay>
  );
}

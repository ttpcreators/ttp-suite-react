import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Copy, Users, Sparkles, SlidersHorizontal, RotateCcw, Minus, Search, Check, FileText, Handshake, ChevronDown, PenLine, Send, X, Image as ImageIcon } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { useCreators, type CreatorLite } from "@/lib/useCreators";
import { formatEuro, getAppState, invalidateAppState, parseAmount, saveAppStateKey, useAppState } from "@/lib/appState";
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
import { fmtDay } from "@/lib/dates";
import { DEFAULT_COMMISSION, parseCommissionPct } from "@/lib/commission";
import {
  INF_PLATFORMS, infFormat, parseFollowers, parseEr, cpmViews,
  UGC_TYPES, UGC_LEVELS, UGC_USAGE, ugcLevelMult, computeUgc,
  type PlatKey, type UgcItem, type RateOverrides,
} from "@/lib/pricing";
import { deliverablesText, priceRange, quoteInvoiceLines, ugcDeliverablesText } from "@/lib/pricingForm";
import {
  CREDIBILITY, PROD_LEVELS, TARIF_FORMATS, creatorFloor, francePctOf, gridDiff, mainAgeOf, pastRates, preChecks, priceTarif, readTarifGrid,
  splitHT, suggestedCoef, tarifAlerts, tarifCopyText, tarifGaps, tarifQuoteLines, tarifViews,
  type Credibility, type Exclusivity, type ProdLevel,
} from "@/lib/pricingTTP";
import { loadInvoiceHistory, saveCreatorFloor, type InvoiceHistory } from "@/lib/pricingTTPDb";
import { putInvoicePrefill } from "@/lib/invoicePrefill";
import { saveProposal } from "@/lib/prospectsDb";
import { Overlay } from "@/components/mobile/ios-sheet";
import { audienceForAll, creatorAudience, NO_AUD, type Aud, type AudienceRow } from "@/lib/creatorAudience";
import { kitRatesFromPrices, mergeRates, type KitRate, type RatesMerge } from "@/lib/mediakitRates";
import { readKit, writeKitRates } from "@/lib/mediakitRatesDb";
import { KitRatesDialog } from "@/components/kit-rates-dialog";
import { CheckRow, QualityBlock, Stepper, T_INPUT, TarifDetail, TarifGridEditor, TarifPrice, TarifWarnings, type Justifs } from "./PricingTarif";

/** Créateur choisi : aucun (recherche), saisie libre, ou l'id d'un créateur du roster. */
const NONE = "";
const EXTERNAL = "__external__";
let _rid = 0;
const rid = () => `p${Date.now().toString(36)}${(_rid += 1)}`;

const LBL = "text-[12px] font-medium text-muted-foreground";
const BLOCK = "rounded-2xl border border-border bg-surface p-5";
const BLOCK_TITLE = "mb-3 text-[14px] font-semibold text-foreground";
const SMALL = "text-[11px] text-muted-foreground";

type Mode = "influence" | "ugc";
/** Un livrable d'influence : plateforme, format, quantité. L'audience vit par plateforme. */
type InfRow = { id: string; platform: PlatKey; format: string; qty: number };
const SRC_LABEL: Record<string, string> = {
  tiktok: "Moyenne mesurée sur TikTok (12 dernières vidéos)",
  youtube: "Moyenne mesurée sur YouTube (dernières vidéos, Shorts à part)",
  instagram: "Chiffres Instagram du jour",
  igreels: "Moyenne mesurée sur Instagram (derniers reels)",
  kit: "Moyenne du media kit",
  fiche: "Chiffres de la fiche",
  saisie: "Saisi à la main",
};
type UgcRow = { id: string; type: string; qty: number };
type CollabPick = { id: string; brand: string | null; creator: string | null; cachet: string | null; deliverables: string | null };

/** Données du deal (méthode TARIF). */
type Deal = {
  brand: string;
  production: ProdLevel;
  includedRetouches: number;
  extraRetouches: number;
  /** Jours entre le brief et la publication, tels que saisis ("" = inconnu). */
  delay: string;
  rightsBlocks: number;
  paidMonths: number;
  exclusivity: Exclusivity;
  exclusivityMonths: number;
  linkOrCode: boolean;
  partnership: boolean;
  volumeWritten: boolean;
};
const NEW_DEAL: Deal = {
  brand: "", production: "simple", includedRetouches: 1, extraRetouches: 0, delay: "", rightsBlocks: 0, paidMonths: 0,
  exclusivity: "none", exclusivityMonths: 0, linkOrCode: false, partnership: false, volumeWritten: false,
};
/** Audience du media kit (saisissable) et commission de la fiche. */
type Meta = { francePct: string; femalePct: string; mainAge: string; commission: number | null };
const NO_META: Meta = { francePct: "", femalePct: "", mainAge: "", commission: null };

const platLabel = (k: PlatKey) => INF_PLATFORMS.find((p) => p.key === k)?.label ?? k;
const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const pctOrNull = (s: string) => (s.trim() ? Math.max(0, Math.min(100, parseEr(s))) : null);
/** Champ de vues d'un format (pour savoir s'il a été saisi à la main). */
const viewsField = (format: string) => (format === "story" ? "storyViews" : format === "short" ? "shortViews" : format === "post" || format === "carrousel" ? "postViews" : "views");
const VIEWS_LABEL: Record<string, string> = { views: "Vues médianes", storyViews: "Vues story", shortViews: "Vues Shorts", postViews: "Vues carrousel ou post" };
const lineLabel = (platform: PlatKey, format: string) =>
  TARIF_FORMATS.find((f) => f.key === `${platform}.${format}`)?.label ?? `${infFormat(platform, format)?.label ?? format} ${platLabel(platform)}`;
const monthsLabel = (n: number) => (n ? `${n} mois` : "Aucun");

export function Pricing() {
  const creators = useCreators();
  const [mode, setMode] = useState<Mode>("influence");
  const [creatorId, setCreatorId] = useState<string>(NONE);
  const [level, setLevel] = useState<string>("confirme");

  // Audience PAR PLATEFORME, pré-remplie depuis les vraies données du créateur
  // (TikTok connecté, Instagram du jour, media kit), sinon depuis sa fiche.
  const [aud, setAud] = useState<Record<string, Aud>>({});
  // Champs de vues tapés à la main (« instagram:views ») : les autres sont des moyennes reprises.
  const [typed, setTyped] = useState<string[]>([]);
  const [meta, setMeta] = useState<Meta>(NO_META);
  const [credibility, setCredibility] = useState<Credibility>("");
  const [justifEdit, setJustifEdit] = useState<Partial<Justifs>>({});
  const [coefManual, setCoefManual] = useState<number | null>(null);
  const [deal, setDeal] = useState<Deal>(NEW_DEAL);
  const setD = (patch: Partial<Deal>) => setDeal((d) => ({ ...d, ...patch }));

  const [infRows, setInfRows] = useState<InfRow[]>([{ id: rid(), platform: "instagram", format: "reel", qty: 1 }]);
  // Barème de l'agence (partagé par l'équipe) : `ttp` = méthode TARIF, `ttpFloors` = planchers
  // par créateur ; les clés « plateforme.format » = ancien barème par abonnés (media kit).
  const { data: rates } = useAppState((st) => (st.pricingRates as Record<string, unknown> | undefined) ?? {});
  const [ratesOpen, setRatesOpen] = useState(false);
  const [floorDraft, setFloorDraft] = useState<string | null>(null);
  // Factures (fondateurs) : tarifs déjà facturés. undefined = en cours, null = pas accessible.
  const [history, setHistory] = useState<InvoiceHistory | null | undefined>(undefined);

  const [ugcRows, setUgcRows] = useState<UgcRow[]>([{ id: rid(), type: "video_court", qty: 2 }]);
  const [ugcOpts, setUgcOpts] = useState({ usage: "none", exclusivite: false, rushes: false, montage: false, express: false });

  // « Ajouter à la collab » : liste des collabs en cours, puis confirmation.
  const [collabs, setCollabs] = useState<CollabPick[] | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);
  const [pendingCollab, setPendingCollab] = useState<CollabPick | null>(null);
  // « Proposer » : la proposition va sur le prospect de la marque (Prospection).
  const [proposeOpen, setProposeOpen] = useState(false);
  // Copier / Proposer : aucun prix ne part vers une marque sans validation de Marc.
  const [pendingSend, setPendingSend] = useState<"copy" | "propose" | null>(null);
  // « Mettre au kit » : prix d'un contenu de chaque livrable → grille du media kit du créateur.
  const [kitPlan, setKitPlan] = useState<{ computed: KitRate[]; merge: RatesMerge; hideRates: boolean } | null>(null);
  const [kitBusy, setKitBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadInvoiceHistory().then((h) => alive && setHistory(h));
    return () => { alive = false; };
  }, []);

  // Charge le créateur → audience par plateforme (vraies données d'abord), audience du kit, commission.
  useEffect(() => {
    // Rien d'hérité du créateur précédent : retour au neutre.
    setAud({});
    setTyped([]);
    setMeta(NO_META);
    setCredibility("");
    setJustifEdit({});
    setCoefManual(null);
    setFloorDraft(null);
    if (creatorId === NONE || creatorId === EXTERNAL) return;
    let alive = true;
    supabase.from("creators").select("*").eq("id", creatorId).limit(1).then(({ data }) => {
      if (!alive) return;
      const row = data?.[0] as (AudienceRow & { commission?: string | null; mediakit?: { audience?: { age?: { label?: string; pct?: string }[]; gender?: { femmes?: string }; pays?: { name?: string; pct?: string }[] } } | null }) | undefined;
      if (!row) return;
      // Plateformes sans chiffres dédiés : ceux de la fiche. Logique partagée : src/lib/creatorAudience.ts.
      setAud(audienceForAll(creatorAudience(row)));
      const au = row.mediakit?.audience;
      const fr = francePctOf(au?.pays);
      const fem = String(au?.gender?.femmes ?? "").trim();
      setMeta({ francePct: fr === null ? "" : String(fr), femalePct: fem, mainAge: mainAgeOf(au?.age), commission: parseCommissionPct(row.commission) });
    });
    return () => { alive = false; };
  }, [creatorId]);

  const audOf = (k: PlatKey): Aud => aud[k] ?? NO_AUD;
  const setAudOf = (k: PlatKey, patch: Partial<Aud>) => setAud((m) => ({ ...m, [k]: { ...(m[k] ?? NO_AUD), ...patch } }));
  const typeViews = (k: PlatKey, field: string, value: string) => {
    setAudOf(k, { [field]: value });
    setTyped((t) => (t.includes(`${k}:${field}`) ? t : [...t, `${k}:${field}`]));
  };

  // ── Méthode TARIF ──
  const grid = useMemo(() => readTarifGrid(rates?.ttp), [rates]);
  const rosterId = creatorId !== NONE && creatorId !== EXTERNAL ? creatorId : null;
  const floorInfo = creatorFloor(rates?.ttpFloors, rosterId, grid);
  const commissionPct = meta.commission ?? DEFAULT_COMMISSION;
  const delayDays = deal.delay.trim() ? Math.max(0, Math.round(parseEr(deal.delay))) : null;
  const pre = preChecks({ francePct: pctOrNull(meta.francePct), femalePct: pctOrNull(meta.femalePct), credibility });
  const justifs: Justifs = { audience: justifEdit.audience ?? pre.audience, expertise: justifEdit.expertise ?? pre.expertise, engagement: justifEdit.engagement ?? false };
  const suggested = suggestedCoef([justifs.audience, justifs.expertise, justifs.engagement].filter(Boolean).length);
  const coef = coefManual ?? suggested;

  const tarifLines = infRows.map((r) => {
    const a = audOf(r.platform);
    const v = tarifViews(r.format, a);
    return { key: `${r.platform}.${r.format}`, label: lineLabel(r.platform, r.format), qty: r.qty, views: parseFollowers(v), average: !!v.trim() && !typed.includes(`${r.platform}:${viewsField(r.format)}`) };
  });
  // Calcul léger : refait à chaque rendu.
  const tarif = priceTarif({ ...deal, lines: tarifLines, delayDays, coef }, grid, floorInfo.value);
  const usedPlatforms = [...new Set(infRows.map((r) => r.platform))];
  const gaps = tarifGaps({
    lines: tarifLines,
    platforms: usedPlatforms.map((k) => {
      const a = audOf(k);
      return { label: platLabel(k), followers: parseFollowers(a.followers), erViews: a.erBase === "views" ? parseEr(a.er) : 0 };
    }),
    francePct: pctOrNull(meta.francePct),
    femalePct: pctOrNull(meta.femalePct),
    mainAge: meta.mainAge,
    credibility,
    delayDays,
  });
  const selName = rosterId ? creators.find((c) => c.id === creatorId)?.name : undefined;
  const past = useMemo(() => (history ? pastRates(history.invoices, history.items, selName ?? null, deal.brand, parseAmount) : null), [history, selName, deal.brand]);
  const alerts = tarifAlerts(tarif, past, grid, formatEuro, (d) => fmtDay(d));
  const split = splitHT(tarif.target, commissionPct);

  const ugcItems: UgcItem[] = ugcRows.map((r) => ({ type: r.type, qty: r.qty }));
  const ugc = useMemo(() => computeUgc(ugcItems, ugcLevelMult(level), ugcOpts), [ugcItems, level, ugcOpts]);

  const hasResult = mode === "influence" ? tarif.priced : ugc.max > 0;
  const who = selName ? titleCase(selName) : "";
  /** Prix enregistrés ailleurs (proposition, collab) : cible, ancrage, plancher en influence. */
  const price = mode === "influence" ? { min: tarif.floor, max: tarif.anchor, mid: tarif.target } : { min: ugc.min, max: ugc.max, mid: ugc.mid };

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

  const ugcLineLabel = (item: UgcItem) => `${UGC_TYPES.find((t) => t.key === item.type)?.label} × ${item.qty}`;

  // Majorations UGC affichées une par une (leur somme = « Options » du calcul).
  const ugcUs = UGC_USAGE.find((x) => x.value === ugcOpts.usage);
  const ugcMajorations: { label: string; pct: number }[] = [
    ...(ugcUs && ugcUs.m ? [{ label: `Droits · ${ugcUs.label}`, pct: Math.round(ugcUs.m * 100) }] : []),
    ...(ugcOpts.exclusivite ? [{ label: "Exclusivité", pct: 25 }] : []),
    ...(ugcOpts.rushes ? [{ label: "Fichiers bruts", pct: 15 }] : []),
    ...(ugcOpts.montage ? [{ label: "Montage avancé", pct: 20 }] : []),
    ...(ugcOpts.express ? [{ label: "Livraison express", pct: 20 }] : []),
  ];

  /**
   * Texte copié. Influence : calcul complet de la méthode, chaque montant « À VÉRIFIER »,
   * pour validation par Marc. UGC : proposition (lignes, majorations, total), tout HT.
   */
  const copyQuote = () => {
    let txt: string;
    if (mode === "influence") {
      txt = tarifCopyText(tarif, who, formatEuro, {
        missing: gaps.missing,
        alerts: alerts.map((a) => a.text),
        split: { ...split, pct: commissionPct },
      });
      const extra = [
        deal.brand.trim() ? `Marque : ${deal.brand.trim()}` : "",
        `Production ${PROD_LEVELS.find((p) => p.value === deal.production)?.label.toLowerCase()}, ${deal.includedRetouches} retouche${deal.includedRetouches > 1 ? "s" : ""} incluse${deal.includedRetouches > 1 ? "s" : ""}`,
      ].filter(Boolean);
      txt = txt.replace("\n", `\n${extra.join("\n")}\n`);
    } else {
      const rng = (r: { min: number; max: number }) => (r.min === r.max ? formatEuro(r.min) : `${formatEuro(r.min)} à ${formatEuro(r.max)}`);
      const sign = (r: { min: number; max: number }, s: string) => (r.min === r.max ? `${s}${formatEuro(r.min)}` : `${s}${formatEuro(r.min)} à ${s}${formatEuro(r.max)}`);
      const lines = ugc.itemsPriced.filter((r) => r.max > 0).map(({ item, min, max }) => `• ${ugcLineLabel(item)} : ${rng({ min, max })}`);
      txt = `Proposition UGC : ${who || "Créateur"}, montants HT\n\n${lines.join("\n")}\n`;
      if (ugc.options.max > 0) txt += `\nSous-total : ${rng(ugc.sub)}\n• Majorations, ${ugcMajorations.map((m) => m.label.toLowerCase()).join(", ")} : +${ugc.optionsPct} % soit ${sign(ugc.options, "+")}\n`;
      txt += `\nTotal : ${rng(ugc)} HT, cible ${formatEuro(ugc.mid)} HT.`;
    }
    navigator.clipboard?.writeText(txt).then(() => toast("Copié ✓")).catch(() => toast("Copie impossible"));
  };

  /** « Créer le devis » : nouvelle facture en brouillon dans Facturation, au prix cible. */
  const createQuote = () => {
    const lines = mode === "influence"
      ? tarifQuoteLines(tarif)
      : quoteInvoiceLines(ugc.itemsPriced.map((r) => ({ label: ugcLineLabel(r.item), mid: r.mid })), { pct: ugc.optionsPct, mid: ugc.options.mid }, { pct: ugc.discountPct, mid: ugc.discount.mid });
    const ok = putInvoicePrefill({ creator: selName ?? "", brand: mode === "influence" ? deal.brand.trim() : "", lines });
    if (!ok) return toast("Impossible de préparer le devis");
    window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "facturation" }));
  };

  // Livrables et cachet écrits dans la collab (forme lue par la page Collabs).
  const collabDeliverables = mode === "influence" ? deliverablesText(infRows) : ugcDeliverablesText(ugcRows.map((r) => ({ label: UGC_TYPES.find((t) => t.key === r.type)?.label ?? r.type, qty: r.qty })));
  const collabCachet = formatEuro(price.mid);

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
      { mode, creator: selName ?? null, deliverables: collabDeliverables, min: price.min, max: price.max, target: price.mid, at: new Date().toISOString() },
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
  // Seulement pour un créateur du roster, en influence : prix de base d'UN contenu par format.
  const kitCreatorId = mode === "influence" && selName ? creatorId : null;
  const prepareKit = async () => {
    if (!kitCreatorId || kitBusy) return;
    const computed = kitRatesFromPrices(tarif.lines.filter((l) => l.priced).map((l) => {
      const [platform, format] = l.key.split(".") as [PlatKey, string];
      return { platform, format, price: l.unitBase };
    }));
    if (!computed.length) return toast("Rien à mettre au kit : il manque les vues");
    setKitBusy(true);
    const kit = await readKit(kitCreatorId);
    setKitBusy(false);
    if (!kit) return toast("Media kit illisible, réessaie");
    const merge = mergeRates(Array.isArray(kit.rates) ? kit.rates : [], computed);
    if (!merge.added.length && !merge.replaced.length) return toast(`Le media kit de ${who} a déjà ces tarifs`);
    setKitPlan({ computed, merge, hideRates: !!kit.hideRates });
  };
  const applyKit = async () => {
    if (!kitPlan || !kitCreatorId || kitBusy) return;
    setKitBusy(true);
    const done = await writeKitRates(kitCreatorId, kitPlan.computed);
    setKitBusy(false);
    if (!done) return toast("Erreur, réessaie");
    setKitPlan(null);
    toast(`Tarifs ajoutés au media kit de ${who}. En ligne au prochain passage du site.`);
  };

  const writeCollab = async (c: CollabPick) => {
    const ok = await dbUpdate("collabs", c.id, { cachet: collabCachet, deliverables: collabDeliverables || null });
    toast(ok ? "Collab mise à jour ✓" : "Erreur, réessaie");
  };

  const saveFloor = async () => {
    if (!rosterId || floorDraft === null) return;
    const v = Math.max(0, Math.round(parseEr(floorDraft)));
    const ok = await saveCreatorFloor(rosterId, v);
    toast(ok ? `Plancher de ${who} enregistré ✓` : "Erreur, réessaie");
    if (ok) setFloorDraft(null);
  };

  const nMissing = gaps.missing.length;
  const missingFirst = mode === "influence" ? (infRows.length === 0 ? "Ajoute un livrable" : nMissing ? `${nMissing} donnée${nMissing > 1 ? "s" : ""} manquante${nMissing > 1 ? "s" : ""}` : null) : ugcRows.length === 0 ? "Ajoute un livrable" : null;

  const priceCard = (
    <>
      <div className="text-[12px] font-medium text-muted-foreground">
        {[mode === "influence" ? "Influence" : "UGC", who].filter(Boolean).join(" · ")}
      </div>
      {hasResult ? (
        mode === "influence" ? (
          <TarifPrice r={tarif} />
        ) : (
          <>
            <div className="mt-1 text-[30px] font-semibold leading-tight tracking-tight tabular-nums text-foreground xl:text-[36px]">{priceRange(ugc.min, ugc.max)}</div>
            <div className="mt-1 text-[13px] text-muted-foreground">
              Cible <span className="font-semibold tabular-nums text-foreground">{formatEuro(ugc.mid)} HT</span>
            </div>
          </>
        )
      ) : (
        <div className="mt-1 text-[20px] font-semibold leading-snug tracking-tight text-muted-foreground">{missingFirst ?? "Ajoute un livrable"}</div>
      )}
    </>
  );
  const warnings = mode === "influence" ? <TarifWarnings missing={gaps.missing} verify={gaps.verify} alerts={alerts} notes={tarif.notes} /> : null;
  const detail =
    mode === "influence" ? (
      hasResult ? <TarifDetail r={tarif} split={split} commissionPct={commissionPct} /> : null
    ) : (
      <ResultDetail lines={ugc.itemsPriced.map((r) => ({ label: ugcLineLabel(r.item), min: r.min, max: r.max }))} majorations={ugcMajorations} result={ugc} />
    );
  const actions = (
    <>
      <Actions
        disabled={!hasResult}
        onCopy={() => setPendingSend("copy")}
        onQuote={createQuote}
        onPropose={() => setPendingSend("propose")}
        onKit={kitCreatorId ? () => void prepareKit() : undefined}
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
      <div className="mt-3 text-[11px] text-faint">Aucun prix transmis à une marque sans validation de Marc.</div>
    </>
  );

  return (
    <div>
      {mode === "influence" && (
        <PageHeaderRow>
          <Popover open={ratesOpen} onOpenChange={setRatesOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover max-md:h-11">
                <SlidersHorizontal className="h-4 w-4" /> Barème de l'agence{Object.keys(gridDiff(grid)).length ? " · personnalisé" : ""}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(30rem,calc(100vw-2rem))] p-0">
              <BaremeTabs grid={grid} rates={(rates ?? {}) as RateOverrides} onClose={() => setRatesOpen(false)} />
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
        {/* ============ ENTRÉES ============ */}
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
                  <span className={LBL}>Crédibilité</span>
                  <Picker ariaLabel="Crédibilité" value={credibility} onChange={(v) => setCredibility(v as Credibility)} placeholder="À choisir" options={CREDIBILITY.map((c) => ({ value: c.value, label: c.label }))} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className={LBL}>Niveau</span>
                  <Picker ariaLabel="Niveau UGC" value={level} onChange={setLevel} options={UGC_LEVELS.map((l) => ({ value: l.value, label: `${l.label} ×${String(l.m).replace(".", ",")}` }))} />
                </div>
              )}
            </div>
            {mode === "influence" && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className={cn(LBL, "flex items-center gap-1.5")}>
                    Plancher par contenu
                    <HelpTip title="Plancher">
                      <p>Prix minimum d'un contenu pour ce créateur : la base n'est jamais en dessous.</p>
                      <p>Sans réglage, celui du barème ({formatEuro(grid.floor)}).</p>
                    </HelpTip>
                  </span>
                  <span className="flex gap-2">
                    <input
                      inputMode="decimal"
                      value={floorDraft ?? String(floorInfo.value)}
                      disabled={!rosterId}
                      onChange={(e) => setFloorDraft(e.target.value)}
                      aria-label="Plancher par contenu en euros"
                      className={T_INPUT}
                    />
                    {floorDraft !== null && (
                      <button type="button" onClick={() => void saveFloor()} className="h-9 shrink-0 rounded-full bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground max-md:h-11">Enregistrer</button>
                    )}
                  </span>
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className={LBL}>Commission de l'agence</span>
                  <span className="flex h-9 items-center text-[13px] tabular-nums text-foreground max-md:h-11">
                    {commissionPct} %<span className="ml-1.5 text-faint">{meta.commission === null ? "par défaut" : "de la fiche"}</span>
                  </span>
                </div>
              </div>
            )}
          </section>

          {mode === "influence" && (
            <section className={BLOCK}>
              <div className={cn(BLOCK_TITLE, "flex items-center gap-1.5")}>
                Données du créateur
                <HelpTip title="Données du créateur">
                  <p>Vues médianes des 10 derniers contenus, hors viraux et boostés. Les chiffres repris du media kit ou des relevés automatiques sont des moyennes : à vérifier.</p>
                  <p>Une donnée manquante est signalée dans le résultat, jamais estimée.</p>
                </HelpTip>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {usedPlatforms.map((k) => {
                  const a = audOf(k);
                  const fields = [...new Set(infRows.filter((r) => r.platform === k).map((r) => viewsField(r.format)))];
                  return (
                    <div key={k} className="rounded-xl bg-panel p-3">
                      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                        <PlatformIcon platform={k} className="h-3.5 w-3.5 text-muted-foreground" /> {platLabel(k)}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className={SMALL}>Abonnés</span>
                          <input inputMode="decimal" value={a.followers} onChange={(e) => setAudOf(k, { followers: e.target.value })} placeholder="12 000" className={T_INPUT} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={SMALL}>Engagement vues %</span>
                          <input
                            inputMode="decimal"
                            value={a.er}
                            onChange={(e) => setAudOf(k, { er: e.target.value, erBase: "views" })}
                            placeholder="3,5"
                            title={a.er && a.erBase === "followers" ? "Repris sur les abonnés : à remplacer par l'engagement sur les vues" : undefined}
                            className={cn(T_INPUT, a.er && a.erBase === "followers" && "text-faint line-through")}
                          />
                        </label>
                        {fields.map((f) => {
                          const v = (a as Record<string, string | undefined>)[f] ?? "";
                          const avg = !!v.trim() && !typed.includes(`${k}:${f}`);
                          return (
                            <label key={f} className="flex flex-col gap-1">
                              <span className={SMALL}>{VIEWS_LABEL[f]}{avg && <span className="text-wait"> · moyenne</span>}</span>
                              <input inputMode="decimal" value={v} onChange={(e) => typeViews(k, f, e.target.value)} placeholder="10 derniers" title={avg ? `${SRC_LABEL[a.src] ?? "Moyenne reprise"} : pas une médiane, à vérifier` : undefined} className={T_INPUT} />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1">
                  <span className={SMALL}>% France</span>
                  <input inputMode="decimal" value={meta.francePct} onChange={(e) => setMeta((m) => ({ ...m, francePct: e.target.value }))} placeholder="70" className={T_INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={SMALL}>% femmes</span>
                  <input inputMode="decimal" value={meta.femalePct} onChange={(e) => setMeta((m) => ({ ...m, femalePct: e.target.value }))} placeholder="75" className={T_INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={SMALL}>Âge principal</span>
                  <input value={meta.mainAge} onChange={(e) => setMeta((m) => ({ ...m, mainAge: e.target.value }))} placeholder="25-34" className={T_INPUT} />
                </label>
              </div>
              {history && (
                <PastBlock past={past} who={who} brand={deal.brand.trim()} />
              )}
            </section>
          )}

          <section className={BLOCK}>
            <div className={BLOCK_TITLE}>Livrables</div>
            {mode === "influence" ? (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <span className={cn(LBL, "flex items-center gap-1.5")}>
                      Production
                      <HelpTip title="Production">
                        {PROD_LEVELS.map((p) => (
                          <p key={p.value}><b>{p.label}</b> ({formatEuro(grid.production[p.value])} par contenu) : {p.help.toLowerCase()}.</p>
                        ))}
                      </HelpTip>
                    </span>
                    <Picker ariaLabel="Production" value={deal.production} onChange={(v) => setD({ production: v as ProdLevel })} options={PROD_LEVELS.map((p) => ({ value: p.value, label: `${p.label} · ${formatEuro(grid.production[p.value])}` }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <span className={LBL}>Retouches incluses</span>
                      <Stepper label="Retouches incluses" value={deal.includedRetouches} onChange={(n) => setD({ includedRetouches: n })} max={5} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className={LBL}>En plus</span>
                      <Stepper label="Retouches en plus" value={deal.extraRetouches} onChange={(n) => setD({ extraRetouches: n })} max={10} />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className={LBL}>Marque</span>
                    <input value={deal.brand} onChange={(e) => setD({ brand: e.target.value })} placeholder="Nom de la marque" className={T_INPUT} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={cn(LBL, "flex items-center gap-1.5")}>
                      Délai brief → publication
                      <HelpTip title="Délai">
                        <p>En jours. Sous {grid.rushDays} jours : urgence, +{grid.rushPct} %.</p>
                      </HelpTip>
                    </span>
                    <span className="flex items-center gap-2">
                      <input inputMode="numeric" value={deal.delay} onChange={(e) => setD({ delay: e.target.value })} placeholder="14" className={T_INPUT} />
                      <span className="text-[13px] text-muted-foreground">jours</span>
                    </span>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className={LBL}>Droits organiques (+{grid.rightsPct} % par 3 mois)</span>
                    <Stepper label="Droits organiques" value={deal.rightsBlocks} onChange={(n) => setD({ rightsBlocks: n })} max={8} unit={(n) => (n ? `${n * 3} mois` : "Aucun")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={cn(LBL, "flex items-center gap-1.5")}>
                      Paid media (+{grid.paidPct} % par mois)
                      <HelpTip title="Paid media">
                        <p>Pub depuis le compte du créateur : whitelisting, Spark Ads, partenariat sponsorisé. Ligne séparée du devis.</p>
                      </HelpTip>
                    </span>
                    <Stepper label="Paid media" value={deal.paidMonths} onChange={(n) => setD({ paidMonths: n })} max={12} unit={monthsLabel} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={cn(LBL, "flex items-center gap-1.5")}>
                      Exclusivité
                      <HelpTip title="Exclusivité">
                        <p>Restreinte : concurrents directs, +{grid.exclRestrictedPct} % par mois. Large : toute la catégorie, +{grid.exclWidePct} % par mois.</p>
                      </HelpTip>
                    </span>
                    <Picker
                      ariaLabel="Exclusivité"
                      value={deal.exclusivity}
                      onChange={(v) => setD({ exclusivity: v as Exclusivity, exclusivityMonths: v === "none" ? 0 : Math.max(1, deal.exclusivityMonths) })}
                      options={[{ value: "none", label: "Aucune" }, { value: "restreinte", label: "Restreinte" }, { value: "large", label: "Large" }]}
                    />
                  </div>
                  {deal.exclusivity !== "none" && (
                    <div className="flex flex-col gap-1.5">
                      <span className={LBL}>Durée de l'exclusivité</span>
                      <Stepper label="Durée de l'exclusivité" value={deal.exclusivityMonths} onChange={(n) => setD({ exclusivityMonths: n })} min={1} max={24} unit={monthsLabel} />
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-col">
                  <CheckRow checked={deal.linkOrCode} onChange={(v) => setD({ linkOrCode: v })}>
                    Lien en bio ou code promo <span className="text-faint">+{grid.linkPct} %</span>
                  </CheckRow>
                  <CheckRow checked={deal.partnership} onChange={(v) => setD({ partnership: v, volumeWritten: v ? deal.volumeWritten : false })}>
                    Partenariat de {grid.partnerMonths} mois ou plus <span className="text-faint">−{grid.partnerPct} %</span>
                  </CheckRow>
                  <div className="pl-6">
                    <CheckRow checked={deal.volumeWritten} disabled={!deal.partnership} onChange={(v) => setD({ volumeWritten: v })}>
                      Volume garanti par écrit
                    </CheckRow>
                  </div>
                </div>
              </>
            ) : (
              <>
                <label className="flex max-w-sm flex-col gap-1.5">
                  <span className={LBL}>Droits d'exploitation</span>
                  <Picker ariaLabel="Droits d'exploitation" value={ugcOpts.usage} onChange={(v) => setUgcOpts((o) => ({ ...o, usage: v }))}
                    options={UGC_USAGE.map((u) => ({ value: u.value, label: `${u.label}${u.m ? ` (+${Math.round(u.m * 100)} %)` : ""}` }))} />
                </label>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  {([["exclusivite", "Exclusivité", "+25 %"], ["rushes", "Fichiers bruts", "+15 %"], ["montage", "Montage avancé", "+20 %"], ["express", "Livraison express", "+20 %"]] as const).map(([k, label, pct]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground max-md:min-h-11">
                      <input type="checkbox" checked={ugcOpts[k]} onChange={(e) => setUgcOpts((o) => ({ ...o, [k]: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                      {label} <span className="text-faint">{pct}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          {mode === "influence" && (
            <section className={BLOCK}>
              <QualityBlock
                coef={coef}
                suggested={suggested}
                manual={coefManual !== null}
                justifs={justifs}
                onCoef={(c) => setCoefManual(c)}
                onJustif={(k, v) => setJustifEdit((j) => ({ ...j, [k]: v }))}
                onReset={() => setCoefManual(null)}
                hints={{
                  audience: meta.francePct || meta.femalePct ? `France ${meta.francePct || "?"} %, femmes ${meta.femalePct || "?"} %` : "France et femmes à 60 % ou plus",
                  expertise: credibility ? CREDIBILITY.find((c) => c.value === credibility)?.label ?? "" : "athlète, coach, en compétition",
                }}
              />
            </section>
          )}
        </div>

        {/* ============ RÉSULTAT (collé en haut au défilement) ============ */}
        <section className="hidden min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-4 lg:col-span-5 lg:flex lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          {priceCard}
          {warnings}
          {detail}
          {actions}
        </section>

        {/* Téléphone : détail et actions sous le formulaire. */}
        <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 lg:hidden">
          {warnings}
          {detail}
          {actions}
        </section>
      </div>

      {pendingSend && (
        <ConfirmDialog
          title="Prix validé par Marc ?"
          message={`Aucun prix n'est transmis à une marque sans la validation de Marc. ${mode === "influence" ? `Cible ${formatEuro(tarif.target)} HT, à vérifier.` : `Cible ${formatEuro(ugc.mid)} HT.`}`}
          confirmLabel="Validé"
          onCancel={() => setPendingSend(null)}
          onConfirm={() => {
            const what = pendingSend;
            setPendingSend(null);
            if (what === "copy") copyQuote();
            else setProposeOpen(true);
          }}
        />
      )}

      {proposeOpen && (
        <ProposeDialog
          price={mode === "influence" ? `${formatEuro(price.mid)} HT` : priceRange(price.min, price.max)}
          initialBrand={mode === "influence" ? deal.brand.trim() : ""}
          onClose={() => setProposeOpen(false)}
          onSave={async (brand, contact) => {
            if (await propose(brand, contact)) setProposeOpen(false);
          }}
        />
      )}

      {kitPlan && (
        <KitRatesDialog
          title={`Media kit de ${who}`}
          merge={kitPlan.merge}
          hideRates={kitPlan.hideRates}
          confirmLabel="Mettre au kit"
          busy={kitBusy}
          onConfirm={() => void applyKit()}
          onClose={() => setKitPlan(null)}
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

/** Tarifs déjà facturés (fondateurs) : dernier prix d'un contenu par format, dernier total à la marque. */
function PastBlock({ past, who, brand }: { past: ReturnType<typeof pastRates> | null; who: string; brand: string }) {
  if (!past || (!who && !brand)) return null;
  const rows = TARIF_FORMATS.filter((f) => past.formats[f.key]);
  return (
    <div className="mt-3 rounded-xl bg-panel p-3 text-[12px]">
      <div className="mb-1 font-semibold text-foreground">Déjà facturé</div>
      {who ? (
        rows.length ? (
          rows.map((f) => {
            const p = past.formats[f.key];
            return (
              <div key={f.key} className="flex justify-between gap-3 py-0.5">
                <span className="min-w-0 truncate text-muted-foreground">{f.label} · {p.party}{p.date ? ` · ${fmtDay(p.date)}` : ""}</span>
                <span className="shrink-0 tabular-nums text-foreground">{formatEuro(p.amount)}</span>
              </div>
            );
          })
        ) : (
          <div className="text-muted-foreground">{who} : {past.creatorInvoices ? "aucune ligne de facture par format" : "aucune facture"}</div>
        )
      ) : null}
      {brand && (
        <div className="flex justify-between gap-3 py-0.5">
          <span className="min-w-0 truncate text-muted-foreground">{past.brand ? `${past.brand.party}, dernier total${past.brand.date ? ` · ${fmtDay(past.brand.date)}` : ""}` : `${brand} : nouvelle cliente`}</span>
          {past.brand && <span className="shrink-0 tabular-nums text-foreground">{formatEuro(past.brand.amount)} {past.brand.ht ? "HT" : "TTC"}</span>}
        </div>
      )}
    </div>
  );
}

/** Barème de l'agence : méthode TARIF (page Tarifs, Claude) et ancien barème par abonnés (media kit). */
function BaremeTabs({ grid, rates, onClose }: { grid: ReturnType<typeof readTarifGrid>; rates: RateOverrides; onClose: () => void }) {
  const [tab, setTab] = useState<"tarif" | "kit">("tarif");
  const t = (on: boolean) => cn("h-9 rounded-full px-3 text-[12px] font-medium transition-colors max-md:h-11", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-rowhover");
  return (
    <div>
      <div className="flex gap-1 border-b border-border p-2">
        <button type="button" className={t(tab === "tarif")} onClick={() => setTab("tarif")}>Méthode TARIF</button>
        <button type="button" className={t(tab === "kit")} onClick={() => setTab("kit")}>Calcul du media kit</button>
      </div>
      {tab === "tarif" ? <TarifGridEditor grid={grid} onClose={onClose} /> : <RatesEditor rates={rates} onClose={onClose} />}
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

/** Détail du calcul UGC : une ligne par livrable, les majorations, le total. */
function ResultDetail({ lines, majorations, result }: {
  lines: { label: string; min: number; max: number }[];
  majorations: { label: string; pct: number }[];
  result: { min: number; max: number; sub: { min: number; max: number }; options: { min: number; max: number } };
}) {
  return (
    <div className="mt-4 divide-y divide-border border-t border-border text-[13px]">
      {lines.map((l, i) => (
        <div key={i} className="py-2">
          <Line l={l.label} v={l.max > 0 ? priceRange(l.min, l.max, false) : "—"} />
        </div>
      ))}
      {majorations.length > 0 && <Line l="Sous-total" v={priceRange(result.sub.min, result.sub.max, false)} />}
      {majorations.map((m) => (
        <Line key={m.label} l={m.label} v={`+${m.pct} %`} />
      ))}
      {result.options.max > 0 && <Line l="Majorations" v={`+${priceRange(result.options.min, result.options.max, false)}`} />}
      <div className="flex justify-between gap-3 py-2.5">
        <span className="font-semibold text-foreground">Total</span>
        <span className="shrink-0 font-semibold tabular-nums text-foreground">{result.max > 0 ? priceRange(result.min, result.max) : "—"}</span>
      </div>
    </div>
  );
}

/** Actions du résultat : copier la proposition, créer le devis, l'écrire dans une collab. */
function Actions({ disabled, onCopy, onQuote, onPropose, onKit, collabOpen, onCollabOpen, collabs, onPickCollab }: {
  disabled: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onPropose: () => void;
  /** Créateur du roster choisi : écrire les prix dans son media kit. */
  onKit?: () => void;
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
      {onKit && (
        <button type="button" disabled={disabled} onClick={onKit} className={cn(btn, "bg-field text-foreground hover:bg-rowhover")} title="Écrit le prix d'un contenu de chaque livrable dans la grille de tarifs de son media kit">
          <ImageIcon className="h-4 w-4" /> Mettre au kit
        </button>
      )}
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
  const b = "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-40 max-md:h-11 max-md:w-11";
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
    <button type="button" onClick={onClick} aria-label="Retirer ce livrable" className="grid h-8 w-8 max-md:h-11 max-md:w-11 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-destructive">
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
      invalidateAppState();
      const raw = (await getAppState())["pricingRates"];
      const fresh = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      // « Rétablir » ne vide que ce barème : la méthode TARIF (`ttp`, `ttpFloors`) reste.
      let next: Record<string, unknown> = Object.fromEntries(Object.entries(fresh).filter(([k]) => k === "ttp" || k === "ttpFloors"));
      if (!reset) {
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
function ProposeDialog({ price, initialBrand, onClose, onSave }: { price: string; initialBrand: string; onClose: () => void; onSave: (brand: string, contact: string) => Promise<void> }) {
  const [brand, setBrand] = useState(initialBrand);
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

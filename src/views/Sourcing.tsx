import { useStickyState } from "@/lib/useStickyState";
import { matchWords } from "@/lib/search";
import { PillSearch } from "@/components/ui/pill-search";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Spin } from "@/components/ui/loader";
import { Picker } from "@/components/ui/form";
import { ArrowUpRight, Binoculars, Bookmark, BookOpen, Check, ChevronDown, ChevronUp, ExternalLink, Flame, Globe, Info, Keyboard, Mail, PhoneOutgoing, Plus, Radar, Search, Send, SlidersHorizontal, Trophy, Users, Wallet, EyeOff, RotateCcw, X } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { FolderTabs } from "@/components/ui/folder-tabs";
import { useVisitedTabs } from "@/lib/useVisitedTabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { PhoneMenu } from "@/components/ui/phone-bar";
import { useNavActionSlot } from "@/lib/navAction";
import { createPortal } from "react-dom";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { HelpTip } from "@/components/ui/help-tip";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusPill } from "@/components/ui/status-pill";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { Kbd } from "@/components/ui/kbd";
import { dbInsert, dbUpdate } from "@/lib/db";
import { useAppState, mergeAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { guessSport } from "@/lib/niche";
import { TONE_DOT, TONE_SOFT, TONE_TEXT } from "@/lib/statusTone";
import { PEPITE, scoreBreakdown, scoreOf, scoreTone, type ScoreBreakdown } from "@/lib/sourcingScore";
import { Overlay } from "@/components/mobile/ios-sheet";
import { fmtCompact } from "@/lib/timeSeries";
import { EMPTY, fmtDay } from "@/lib/dates";
import { fmtEr, igWhyText, noteQuota } from "@/lib/instagram";
import { MetaQuotaBadge } from "@/components/MetaQuotaBadge";
import { OutreachComposer } from "@/components/OutreachComposer";
import { SourcingGuide, type GuideTool } from "@/components/SourcingGuide";
import { RivalWatch } from "@/components/RivalWatch";
import { RadarFrame } from "@/components/RadarFrame";
import { TikTokRadar } from "@/components/TikTokRadar";
import { YouTubeRadar } from "@/components/YouTubeRadar";

/**
 * SOURCING (agence) : trois outils, toujours via l'outil officiel de Meta (comptes pro) :
 *  • « Trouver des créateurs » : les @ cités par une marque dans ses derniers posts
 *    (= les créateurs avec qui elle travaille), ou une liste de @ collée ; chiffres,
 *    filtres en pastilles, score « Potentiel », puis tri (Scouting, À contacter, Écartés).
 *    Sur grand écran, le panneau « Profil sélectionné » dit pourquoi un compte a sa note,
 *    et le clavier trie vite (J / K pour parcourir, S, C, X pour agir).
 *  • « Radar à marques » : chaque nuit (fonction ig-sourcing), les marques citées par
 *    les créateurs du roster et du Scouting. Partenariats payés = clients potentiels ;
 *    citées gratuitement par tes créateurs = contacts chauds. → Pipeline / mail.
 *  • « Agences concurrentes » : croissance, créateurs mis en avant et marques des
 *    agences suivies (components/RivalWatch.tsx).
 */

type Prof = {
  name?: string; followers?: number; following?: number; posts?: number; er?: number | null; perWeek?: number | null;
  lastPost?: string | null; bio?: string; website?: string; email?: string; emailFrom?: "bio" | "lien" | "";
  agency?: string | null; deals?: string[]; cites?: string[]; picture?: string; brandScore?: number; isBrand?: boolean;
  // YouTube (yt-sourcing)
  platform?: "youtube"; handle?: string; url?: string; avgViews?: number | null; views?: number; videos?: number; sponsored?: number; sample?: number; country?: string;
};
type Candidate = { username: string; count?: number; via?: string[]; lastAt?: string; url?: string; data: Prof | null; why: string | null };
type RadarPost = { c: string; roster: boolean; url: string; at: string; paid: boolean; likes: number | null; comments: number; cap: string };
type RadarRow = { brand: string; posts: RadarPost[]; status: "nouveau" | "ignore" | "pipeline"; first_seen: string; last_seen: string };

const IN = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const igLink = (u: string) => `https://www.instagram.com/${u}/`;
const cleanUser = (h: string) =>
  h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
/** « 10k », « 10 000 », « 1,2M » → nombre (0 si vide). */
function parseCount(v: string): number {
  const s = v.trim().toLowerCase().replace(/\s/g, "").replace(",", ".");
  const m = /^([\d.]+)(k|m)?$/.exec(s);
  if (!m) return 0;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
}
const domainOf = (url?: string) => (url ?? "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "");
const safeHref = (url?: string) => (!url ? "" : /^https?:\/\//i.test(url) ? url : `https://${url}`);
/** Saisie en cours (champ, zone de texte, menu, texte éditable) : les raccourcis clavier se taisent. */
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};
/** Grand écran (≥ 1024 px) : colonne « Profil sélectionné » et raccourcis clavier. */
const WIDE = "(min-width: 1024px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

async function invokeSourcing<T>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await supabase.functions.invoke("ig-sourcing", { body });
  if (error) return { error: "reseau" } as T & { error?: string };
  noteQuota(data);
  return (data ?? { error: "reseau" }) as T & { error?: string };
}
const errorText = (e?: string) =>
  e === "migration_manquante" ? "Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic)."
    : e === "meta_non_configure" ? "Instagram n'est pas encore relié à Meta."
      : e === "reseau" ? "Le Sourcing n'est pas encore en ligne, ou Meta n'a pas répondu. Réessaie."
        : igWhyText(e) || "Erreur, réessaie.";

/** Photo de profil Instagram (lien Meta temporaire), initiales teintées en dessous. */
function Pic({ src, name, size = 40, square }: { src?: string; name: string; size?: number; square?: boolean }) {
  const [ok, setOk] = useState(true);
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center overflow-hidden font-bold", square ? "rounded-xl bg-panel text-foreground" : "rounded-full bg-primary/10 text-primary")}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.3)) }}
    >
      {initials(name || "?")}
      {src && ok && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} className="absolute inset-0 h-full w-full bg-panel object-cover" />}
    </div>
  );
}

/** Anneau de score « Potentiel » : vert dès 70, orange de 40 à 69, gris en dessous. */
function ScoreRing({ score, size = 36 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const len = 2 * Math.PI * r;
  return (
    <span title={`Potentiel ${score} / 100`} className={cn("relative grid shrink-0 place-items-center", TONE_TEXT[scoreTone(score)])} style={{ width: size, height: size }}>
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - Math.max(0, Math.min(100, score)) / 100)} />
      </svg>
      <span className="relative text-[12px] font-bold tabular-nums text-foreground">{score}</span>
    </span>
  );
}

/** Rythme court pour les colonnes chiffrées : « 1,2 » + « /sem ». */
const perWeekParts = (n?: number | null) => (n == null ? null : String(n).replace(".", ","));

/** Colonne chiffrée d'une ligne : petit libellé au-dessus, valeur en dessous (« — » si inconnue). */
function Metric({ label, value, unit, title }: { label: string; value: string | null; unit?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate whitespace-nowrap text-[14px] font-semibold tabular-nums text-foreground @2xl:text-[16px]">
        {value ?? EMPTY}
        {value != null && unit ? <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

/** Champ de filtre : petit titre (+ « ? » d'explication) au-dessus du champ. */
function Field({ label, help, className, children }: { label: string; help?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="flex items-center gap-1 text-[10px] font-medium text-faint">
        {label}
        {help && <HelpTip title={label}>{help}</HelpTip>}
      </span>
      {children}
    </div>
  );
}
/** Case à cocher avec son « ? ». */
function Check2({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      {help && <HelpTip title={label}>{help}</HelpTip>}
    </span>
  );
}

type Opt = { value: string; label: string; hint?: string; icon?: ReactNode };
/** Liste de choix d'un menu (pilule de la barre de recherche, pastille de filtre). */
function OptionList({ options, value, onPick }: { options: Opt[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onPick(o.value)} className={cn("flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-rowhover", on && "bg-field")}>
            {o.icon && <span className="mt-0.5 shrink-0">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{o.hint}</span>}
            </span>
            {on && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
/** Pilule à menu de la barre de recherche (réseau, point de départ, pays). */
function MenuPill({ label, icon, value, options, onChange, ariaLabel, disabled }: { label: string; icon?: ReactNode; value: string; options: Opt[]; onChange: (v: string) => void; ariaLabel: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} disabled={disabled} className="flex h-10 min-w-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
          {icon}
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1.5">
        <OptionList options={options} value={value} onPick={(v) => { onChange(v); setOpen(false); }} />
      </PopoverContent>
    </Popover>
  );
}
/**
 * Pastille de filtre : active = fond doux de l'accent et « × » pour l'enlever ;
 * inactive = simple contour. Un clic ouvre son réglage (`children`), ou bascule (`onToggle`).
 */
function FilterChip({ label, title, active, onClear, onToggle, children }: { label: string; title?: string; active: boolean; onClear?: () => void; onToggle?: () => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pill = cn("flex h-8 max-w-full items-center rounded-full border text-[12px] font-medium transition-colors", active ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-border text-foreground hover:bg-rowhover");
  const body = (
    <button type="button" onClick={onToggle} aria-pressed={onToggle ? active : undefined} className={cn("flex h-full min-w-0 items-center gap-1 pl-3", active && onClear ? "pr-1" : "pr-3")}>
      <span className="truncate">{label}</span>
      {children && !active && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
    </button>
  );
  return (
    <span className={pill} title={title}>
      {children ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{body}</PopoverTrigger>
          <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-3">
            {children}
          </PopoverContent>
        </Popover>
      ) : (
        body
      )}
      {active && onClear && (
        <button type="button" onClick={onClear} aria-label={`Enlever le filtre ${label}`} className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-primary/10">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

const TOOLS = [
  {
    v: "createurs" as const, icon: Users, title: "Trouver des créateurs", short: "Créateurs", goal: "Pour recruter",
  },
  {
    v: "radar" as const, icon: Radar, title: "Radar à marques", short: "Marques", goal: "Pour trouver des clients",
  },
  {
    v: "concurrents" as const, icon: Binoculars, title: "Agences concurrentes", short: "Agences", goal: "Pour garder une longueur d'avance",
  },
];
type ToolId = (typeof TOOLS)[number]["v"];
const toolOf = (v: string | null): ToolId => (v === "radar" || v === "concurrents" ? v : "createurs");

export function Sourcing() {
  const [tab, setTab] = useState<ToolId>(() => {
    try {
      return toolOf(localStorage.getItem("ttp:sourcing-tab"));
    } catch {
      return "createurs";
    }
  });
  // Mode d'emploi : seulement à la demande (bouton « Mode d'emploi » ou touche « ? »),
  // jamais tout seul : il cachait la page à la première visite.
  const [guide, setGuide] = useState(false);
  const barSlot = useNavActionSlot(true);
  const closeGuide = () => setGuide(false);
  // « ? » rouvre le mode d'emploi (sauf pendant une saisie, ou quand la liste de « Trouver des créateurs » s'en sert pour ses raccourcis).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      e.preventDefault();
      setGuide(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pick = (v: string) => {
    const t = toolOf(v);
    setTab(t);
    try {
      localStorage.setItem("ttp:sourcing-tab", t);
    } catch {
      /* stockage indisponible */
    }
  };
  // Un outil ouvert une fois reste monté (masqué) : recherche et saisies gardées au retour.
  const visited = useVisitedTabs(tab);
  return (
    <>
      <PageHeaderRow>
        {/* Téléphone : « Mode d'emploi » dans le « ⋯ », la jauge Meta dans la barre de titre. */}
        <PhoneMenu items={[{ key: "guide", label: "Mode d'emploi", icon: BookOpen, onClick: () => setGuide(true) }]} />
        {barSlot && createPortal(<MetaQuotaBadge compact />, barSlot)}
        <div className="ios-phone-hide flex items-center gap-2">
          <button type="button" onClick={() => setGuide(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-field px-3.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            <BookOpen className="h-3.5 w-3.5" /> Mode d'emploi
          </button>
          <MetaQuotaBadge className="border-transparent bg-field" />
        </div>
      </PageHeaderRow>
      {guide && <SourcingGuide initial={tab as GuideTool} onClose={closeGuide} />}
      {/* Les trois outils en onglets « dossier » (comme Agents) ; libellés courts sur téléphone. */}
      <FolderTabs
        label="Outil de sourcing"
        orderKey="sourcing"
        items={TOOLS.map((t) => ({ value: t.v, label: t.title, short: t.short }))}
        value={tab}
        onValueChange={pick}
        maxTabWidth={232}
      >
        {visited.includes("createurs") && (
          <div hidden={tab !== "createurs"}>
            {/* Raccourcis clavier (j, k, s, c, x) coupés quand l'outil est masqué. */}
            <CreatorFinder paused={guide || tab !== "createurs"} />
          </div>
        )}
        {visited.includes("radar") && (
          <div hidden={tab !== "radar"}>
            <RadarTool />
          </div>
        )}
        {visited.includes("concurrents") && (
          <div hidden={tab !== "concurrents"}>
            <RivalWatch />
          </div>
        )}
      </FolderTabs>
    </>
  );
}

// ═════════════════════════ Trouver des créateurs ═════════════════════════
type LastSearch = {
  label: string; at: string; mode: "marque" | "similaire" | "liste" | "yt-search" | "yt-brand" | "yt-list"; platform?: "instagram" | "youtube";
  brand?: Prof & { username: string }; creator?: Prof & { username: string }; brands?: string[]; results: Candidate[];
};
const LAST_KEY = "ttp:sourcing-last";
/** Les deux scoutings de l'agence : créateurs (creator_pool) et sportifs (athlete_pool). */
type PoolKind = "createur" | "sportif";
type PoolInfo = { id: string; last_contacted: string | null; kind: PoolKind };
const POOL_TABLE: Record<PoolKind, string> = { createur: "creator_pool", sportif: "athlete_pool" };
/** Clé d'état des statuts, la même que la page Scouting (onglets Créateurs / Sportifs). */
const TRACK_KEY: Record<PoolKind, string> = { createur: "poolTracking", sportif: "athleteTracking" };
const KIND_ONE: Record<PoolKind, string> = { createur: "Créateur", sportif: "Sportif" };
const KIND_LIST: Record<PoolKind, string> = { createur: "scouting créateurs", sportif: "scouting sportifs" };
/**
 * Liste suggérée pour un compte trouvé : sportif si sa bio, son nom ou son @ désignent un
 * sportif (guessSport : un seul mot de métier ou de compétition suffit), sinon créateur.
 * Le sport deviné sert de tag.
 */
function suggestKind(c: Candidate): { kind: PoolKind; sport: string | null } {
  const sport = guessSport([c.data?.name, c.data?.bio, c.username].filter(Boolean).join(" \n "));
  return { kind: sport ? "sportif" : "createur", sport };
}

// ── Tri des comptes trouvés ──────────────────────────────────────────────────
// Chaque compte trouvé se range dans une section : « À trier » (pas encore vu), « Scouting »
// (gardé pour plus tard), « À contacter », « Pas intéressés ». Scouting et À contacter =
// une fiche d'un des deux scoutings, créateurs (creator_pool, clé d'état `poolTracking`) ou
// sportifs (athlete_pool, clé `athleteTracking`), les mêmes que la page Scouting. Un nouveau
// compte : on demande la liste, la suggestion vient de sa bio (sport repéré = sportif). « Pas intéressé » sur un compte hors Scouting = clé `sourcingRejects`
// (il ne revient plus dans « À trier » aux recherches suivantes, on peut le remettre).
type ScoutStatus = "observation" | "contacter" | "discussion" | "signe" | "ecarte";
type PoolTracking = Record<string, { status?: ScoutStatus } & Record<string, unknown>>;
type Rejects = Record<string, { at: string; name?: string }>;
type Section = "trier" | "scouting" | "contacter" | "pas" | "roster";
const SCOUT_LABEL: Record<ScoutStatus, string> = { observation: "En observation", contacter: "À contacter", discussion: "En discussion", signe: "Signé", ecarte: "Écarté" };

const firstName = (d: Prof | null, user: string) => (d?.name?.trim().split(/\s+/)[0] ?? "") || user;
const REGIONS = [["FR", "France"], ["BE", "Belgique"], ["CH", "Suisse"], ["CA", "Canada"], ["GB", "Royaume-Uni"], ["US", "États-Unis"]] as const;
const ytErr = (e?: string) =>
  e === "youtube_non_configure" ? "YouTube n'est pas encore relié (clé YouTube à ajouter)."
    : e === "migration_manquante" ? "Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic)."
      : e === "recherche_vide" ? "Tape un thème ou une marque."
        : e === "quota_youtube" ? "Quota YouTube du jour atteint : ça repart demain."
          : "YouTube n'a pas répondu, réessaie.";
/** Clé d'un créateur dans le Scouting : @ Instagram, ou « yt:<handle> » pour une chaîne YouTube. */
const poolKey = (handle: string) => (/youtube\.com|youtu\.be/i.test(handle) ? `yt:${(/@([\w.-]+)/.exec(handle)?.[1] ?? handle).toLowerCase()}` : cleanUser(handle));

/** Trouver des créateurs : colonne principale (recherche, filtres, liste) + panneau « Profil sélectionné ». */
function CreatorFinder({ paused }: { paused: boolean }) {
  const [source, setSource] = useStickyState("sourcing:depart", ["marque", "similaire", "liste"] as const, "marque");
  const [brandIn, setBrandIn] = useState("");
  const [creatorIn, setCreatorIn] = useState("");
  const [listIn, setListIn] = useState("");
  const [busy, setBusy] = useState("");
  // Réseau : Instagram ou YouTube (dernière recherche gardée pour chacun, sur cet appareil).
  const [platform, setPlatformState] = useState<"instagram" | "youtube">(() => {
    try {
      return localStorage.getItem("ttp:sourcing-platform") === "youtube" ? "youtube" : "instagram";
    } catch {
      return "instagram";
    }
  });
  const setPlatform = (p: "instagram" | "youtube") => {
    setPlatformState(p);
    try {
      localStorage.setItem("ttp:sourcing-platform", p);
    } catch {
      /* stockage indisponible */
    }
  };
  const lastKey = (p: string) => (p === "youtube" ? `${LAST_KEY}-yt` : LAST_KEY);
  const readLast = (p: string): LastSearch | null => {
    try {
      const v = JSON.parse(localStorage.getItem(lastKey(p)) ?? "null") as LastSearch | null;
      return v?.mode ? v : null;
    } catch {
      return null;
    }
  };
  const [lastBy, setLastBy] = useState<Record<"instagram" | "youtube", LastSearch | null>>(() => ({ instagram: readLast("instagram"), youtube: readLast("youtube") }));
  const last = lastBy[platform];
  const isYt = platform === "youtube";
  // Parcours en 3 temps : chercher, lire les résultats, trier. Une fois des résultats affichés,
  // la recherche se replie en une ligne (« Nouvelle recherche » la rouvre) et les filtres
  // attendent derrière « Filtrer ».
  const [searchOpen, setSearchOpen] = useState(() => !lastBy[platform]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const keep = (s: LastSearch) => {
    const p = s.platform === "youtube" ? "youtube" : "instagram";
    setLastBy((m) => ({ ...m, [p]: s }));
    setSection("trier"); // nouvelle recherche : on repart des comptes à trier
    setSearchOpen(false);
    setSelKey(null);
    try {
      localStorage.setItem(lastKey(p), JSON.stringify(s));
    } catch {
      /* stockage plein ou indisponible */
    }
  };
  // YouTube : thème, marque ou liste de chaînes ; pays ; quota du jour.
  const [ytSource, setYtSource] = useStickyState("sourcing:depart-youtube", ["search", "brand", "list"] as const, "search");
  const [ytQ, setYtQ] = useState("");
  const [ytRegion, setYtRegion] = useState("FR");
  const [ytList, setYtList] = useState("");
  const [ytQuota, setYtQuota] = useState<{ used: number; limit: number } | null>(null);
  useEffect(() => {
    void supabase.from("yt_quota").select("units").eq("day", new Date().toISOString().slice(0, 10)).maybeSingle()
      .then(({ data, error }) => { if (!error) setYtQuota({ used: (data as { units?: number } | null)?.units ?? 0, limit: 10000 }); });
  }, []);

  // Filtres
  const [minF, setMinF] = useState("");
  const [maxF, setMaxF] = useState("");
  const [minEr, setMinEr] = useState("");
  const [bioWord, setBioWord] = useState("");
  const [emailF, setEmailF] = useState<"tous" | "avec" | "sans">("tous");
  const [agencyF, setAgencyF] = useState<"toutes" | "sans" | "avec">("toutes");
  const [showOthers, setShowOthers] = useState(false);
  const [sort, setSort] = useState<"score" | "followers" | "er" | "count">("score");

  // Déjà connus : les deux scoutings, créateurs et sportifs (avec date de contact) + roster.
  const [pool, setPool] = useState<Map<string, PoolInfo>>(new Map());
  const [roster, setRoster] = useState<{ user: string; name: string }[]>([]);
  const [maxOrder, setMaxOrder] = useState<Record<PoolKind, number>>({ createur: 0, sportif: 0 });
  // Scouting sportifs pas encore activé (table absente) : tout va au scouting créateurs, sans question.
  const [athletesOn, setAthletesOn] = useState(true);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      supabase.from("creator_pool").select("id, handle, sort_order, last_contacted"),
      supabase.from("athlete_pool").select("id, handle, sort_order, last_contacted"),
      supabase.from("creators").select("name, handle, platform, instagram, status"),
    ]).then(([p, a, c]) => {
      if (!alive) return;
      type PoolRow = { id: string; handle: string | null; sort_order: number | null; last_contacted: string | null };
      const pr = (p.data as PoolRow[] | null) ?? [];
      const ar = (a.data as PoolRow[] | null) ?? [];
      const cr = (c.data as { name: string; handle: string | null; platform: string | null; instagram: string | null; status: string | null }[] | null) ?? [];
      setAthletesOn(!(a.error && (a.error.code === "42P01" || a.error.code === "PGRST205")));
      const m = new Map<string, PoolInfo>();
      // Un même @ dans les deux listes : le scouting créateurs l'emporte (comme avant).
      for (const [kind, rows] of [["sportif", ar], ["createur", pr]] as const)
        for (const r of rows) {
          const k = poolKey(r.handle ?? "");
          if (k) m.set(k, { id: r.id, last_contacted: r.last_contacted, kind });
        }
      setPool(m);
      const top = (rows: PoolRow[]) => rows.reduce((n, r) => Math.max(n, r.sort_order ?? 0), 0);
      setMaxOrder({ createur: top(pr), sportif: top(ar) });
      setRoster(
        cr
          .filter((r) => (r.status ?? "actif").toLowerCase() !== "inactif")
          .map((r) => ({ user: cleanUser(r.instagram || ((r.platform ?? "").toLowerCase().includes("insta") ? r.handle ?? "" : "")), name: r.name }))
          .filter((r) => r.user),
      );
    });
    return () => {
      alive = false;
    };
  }, []);
  const rosterUsers = useMemo(() => new Set(roster.map((r) => r.user)), [roster]);
  /** Clé de comparaison d'un résultat avec le Scouting et le roster. */
  const keyOf = (c: Candidate) => (c.data?.platform === "youtube" ? `yt:${(c.data.handle || c.username).toLowerCase()}` : c.username);

  const finish = (r: { stopped?: string }) => {
    if (r.stopped) toast(`Meta a freiné : ${igWhyText(r.stopped)}. Le compteur en haut dit quand reprendre.`);
  };
  const runBrand = async () => {
    const b = cleanUser(brandIn);
    if (!b) return toast("Tape le @ d'une marque");
    setBusy("Lecture des posts de la marque, puis des profils cités (environ 30 s)…");
    const r = await invokeSourcing<{ brand?: Prof & { username: string }; candidates?: Candidate[]; stopped?: string }>({ mode: "brand", brand: b });
    setBusy("");
    if (r.error || !r.candidates) return toast(errorText(r.error));
    keep({ mode: "marque", label: `Créateurs cités par @${b}`, at: new Date().toISOString(), brand: r.brand, results: r.candidates });
    if (!r.candidates.length) toast(`@${b} ne cite personne dans ses derniers posts`);
    finish(r);
  };
  const runSimilar = async (who?: string) => {
    const c = cleanUser(who ?? creatorIn);
    if (!c) return toast("Tape le @ d'un créateur, ou choisis-en un de ton roster");
    setCreatorIn(c);
    setBusy(`Marques de @${c}, puis les créateurs qui travaillent avec elles (30 à 60 s)…`);
    const r = await invokeSourcing<{ creator?: Prof & { username: string }; brands?: string[]; candidates?: Candidate[]; stopped?: string }>({ mode: "similar", creator: c });
    setBusy("");
    if (r.error || !r.candidates) return toast(errorText(r.error));
    keep({ mode: "similaire", label: `Créateurs proches de @${c}`, at: new Date().toISOString(), creator: r.creator, brands: r.brands, results: r.candidates.filter((x) => !rosterUsers.has(x.username)) });
    if (!r.brands?.length) toast(`@${c} ne cite aucune marque dans ses derniers posts : impossible de trouver des profils proches`);
    finish(r);
  };
  const runList = async () => {
    const users = [...new Set(listIn.split(/[\s,;]+/).map(cleanUser).filter((u) => /^[a-z0-9._]{1,30}$/.test(u)))];
    if (!users.length) return toast("Colle des @ (un par ligne, ou séparés par des espaces)");
    const results: Candidate[] = [];
    for (let i = 0; i < users.length; i += 30) {
      setBusy(`Lecture des profils… ${Math.min(i + 30, users.length)} / ${users.length}`);
      const r = await invokeSourcing<{ candidates?: Candidate[]; stopped?: string }>({ mode: "list", handles: users.slice(i, i + 30) });
      if (r.error || !r.candidates) {
        toast(errorText(r.error));
        break;
      }
      results.push(...r.candidates);
      if (r.stopped) {
        finish(r);
        break;
      }
    }
    setBusy("");
    if (results.length) keep({ mode: "liste", label: `Liste de ${users.length} @`, at: new Date().toISOString(), results });
  };

  const runYt = async () => {
    const q = ytQ.trim();
    const list = ytList.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (ytSource !== "list" && !q) return toast(ytSource === "search" ? "Tape un thème (ex : fitness lyon)" : "Tape le nom d'une marque");
    if (ytSource === "list" && !list.length) return toast("Colle des @ ou des liens de chaînes YouTube");
    setBusy(ytSource === "list" ? "Lecture des chaînes…" : "Recherche sur YouTube, puis lecture des chaînes (environ 20 s)…");
    const { data, error } = await supabase.functions.invoke("yt-sourcing", {
      body: ytSource === "list" ? { mode: "list", channels: list } : { mode: ytSource, q, region: ytRegion },
    });
    setBusy("");
    const r = (data ?? {}) as { candidates?: Candidate[]; stopped?: string; error?: string; quota?: { used: number; limit: number } };
    if (r.quota) setYtQuota(r.quota);
    if (error || r.error || !r.candidates) return toast(ytErr(r.error ?? undefined));
    const label = ytSource === "search" ? `Chaînes YouTube · « ${q} »` : ytSource === "brand" ? `Vidéos sur « ${q} »` : `Liste de ${list.length} chaîne${list.length > 1 ? "s" : ""}`;
    keep({ platform: "youtube", mode: ytSource === "search" ? "yt-search" : ytSource === "brand" ? "yt-brand" : "yt-list", label, at: new Date().toISOString(), results: r.candidates });
    if (!r.candidates.length) toast("Aucune chaîne trouvée : essaie d'autres mots");
    if (r.stopped) toast(ytErr(r.stopped));
  };

  // Scouting : ajout (et date de contact quand on vient d'écrire).
  const [adding, setAdding] = useState<string | null>(null);
  /**
   * Fiche Scouting du compte, créée au besoin dans la liste `kind` (sinon la liste
   * suggérée) : son id, sa liste, et `created` si elle vient d'être créée ; null en cas d'erreur.
   * Un compte déjà dans une liste y reste.
   */
  const ensurePool = async (c: Candidate, contacted?: boolean, kind?: PoolKind): Promise<{ id: string; kind: PoolKind; created: boolean } | null> => {
    const now = new Date().toISOString();
    const yt = c.data?.platform === "youtube";
    const known = pool.get(keyOf(c));
    if (known) {
      const res = { id: known.id, kind: known.kind, created: false };
      if (!contacted) return res;
      const ok = await dbUpdate(POOL_TABLE[known.kind], known.id, { last_contacted: now });
      if (ok) setPool((m) => new Map(m).set(keyOf(c), { ...known, last_contacted: now }));
      return ok ? res : null;
    }
    const guess = suggestKind(c);
    const k: PoolKind = athletesOn ? kind ?? guess.kind : "createur";
    const origin = last?.mode === "marque" && last.brand ? ` (cité par @${last.brand.username})` : last?.mode === "similaire" && last.creator ? ` (proche de @${last.creator.username})` : "";
    const created = await dbInsert(POOL_TABLE[k], {
      name: c.data?.name?.trim() || `@${c.username}`,
      handle: yt ? c.data?.url ?? `https://www.youtube.com/@${c.username}` : `@${c.username}`,
      email: c.data?.email || null,
      // Sportif : le sport deviné ; créateur YouTube : « YouTube ».
      tag: k === "sportif" ? guess.sport : yt ? "YouTube" : null,
      note: yt ? `Trouvé via le Sourcing YouTube (${last?.label ?? ""})` : `Trouvé via le Sourcing${origin}`,
      sort_order: maxOrder[k] + 1,
      ...(contacted ? { last_contacted: now } : {}),
    });
    if (!created) return null;
    const id = String(created.id);
    setMaxOrder((o) => ({ ...o, [k]: o[k] + 1 }));
    setPool((m) => new Map(m).set(keyOf(c), { id, last_contacted: contacted ? now : null, kind: k }));
    return { id, kind: k, created: true };
  };
  const [contact, setContact] = useState<Candidate | null>(null);

  // Tri : statuts des deux scoutings + comptes écartés (partagés par l'équipe, état de l'app).
  const { data: trackC } = useAppState<PoolTracking>((st: AppState) => (st[TRACK_KEY.createur] as PoolTracking) ?? {});
  const { data: trackS } = useAppState<PoolTracking>((st: AppState) => (st[TRACK_KEY.sportif] as PoolTracking) ?? {});
  // Copies locales (optimistes) : elles cèdent dès que la donnée partagée change (tick suivant, qui inclut l'écriture).
  const [trackLocal, setTrackLocal] = useState<Partial<Record<PoolKind, PoolTracking>>>({});
  useEffect(() => setTrackLocal((l) => (l.createur ? { ...l, createur: undefined } : l)), [trackC]);
  useEffect(() => setTrackLocal((l) => (l.sportif ? { ...l, sportif: undefined } : l)), [trackS]);
  const tracking: Record<PoolKind, PoolTracking> = { createur: trackLocal.createur ?? trackC ?? {}, sportif: trackLocal.sportif ?? trackS ?? {} };
  const { data: rejData } = useAppState<Rejects>((st: AppState) => (st["sourcingRejects"] as Rejects) ?? {});
  const [rejLocal, setRejLocal] = useState<Rejects | null>(null);
  useEffect(() => setRejLocal(null), [rejData]);
  const rejects = rejLocal ?? rejData ?? {};
  /** Statut d'une fiche, dans la clé de SA liste : n'envoie que cette fiche (écriture partielle). */
  const saveStatus = async (kind: PoolKind, id: string, status: ScoutStatus): Promise<boolean> => {
    try {
      invalidateAppState();
      const fresh = ((await getAppState())[TRACK_KEY[kind]] as PoolTracking | undefined) ?? {};
      const entry = { ...(fresh[id] ?? {}), status };
      setTrackLocal((l) => ({ ...l, [kind]: { ...fresh, [id]: entry } }));
      if (await mergeAppStateKey(TRACK_KEY[kind], { [id]: entry })) return true;
    } catch {
      /* traité ci-dessous */
    }
    setTrackLocal((l) => ({ ...l, [kind]: undefined }));
    return false;
  };
  /** Pose (entry) ou retire (null) un compte écarté hors Scouting : seule cette entrée est envoyée. */
  const saveReject = async (k: string, entry: Rejects[string] | null): Promise<boolean> => {
    const next = { ...rejects };
    if (entry) next[k] = entry;
    else delete next[k];
    setRejLocal(next);
    let ok = false;
    try {
      ok = entry ? await mergeAppStateKey("sourcingRejects", { [k]: entry }) : await mergeAppStateKey("sourcingRejects", {}, [k]);
    } catch {
      ok = false;
    }
    if (!ok) setRejLocal(null);
    return ok;
  };
  /** Statut d'un compte déjà au Scouting (dans sa liste). */
  const statusIn = (info: PoolInfo): ScoutStatus => tracking[info.kind][info.id]?.status ?? "observation";
  const sectionOf = (c: Candidate): Section => {
    const k = keyOf(c);
    if (rosterUsers.has(k)) return "roster";
    const inPool = pool.get(k);
    if (inPool) {
      const st = statusIn(inPool);
      return st === "contacter" ? "contacter" : st === "ecarte" ? "pas" : "scouting";
    }
    return rejects[k] ? "pas" : "trier";
  };
  const [section, setSection] = useStickyState<Section>("sourcing:tri", ["trier", "scouting", "contacter", "pas", "roster"], "trier");
  // Compte pas encore au Scouting : on demande dans quelle liste (créateurs ou sportifs) le ranger.
  const [askKind, setAskKind] = useState<{ c: Candidate; to: "scouting" | "contacter"; kind: PoolKind; sport: string | null } | null>(null);
  /** Range un compte : Scouting (en observation), À contacter, ou Pas intéressé. */
  const triage = async (c: Candidate, to: "scouting" | "contacter" | "pas", kind?: PoolKind) => {
    const k = keyOf(c);
    const inPool = pool.get(k);
    if (to !== "pas" && !inPool && !kind && athletesOn) {
      setAskKind({ c, to, ...suggestKind(c) });
      return;
    }
    const who = c.data?.platform === "youtube" ? c.data?.name || `@${c.username}` : `@${c.username}`;
    setAdding(c.username);
    let ok: boolean;
    let added: PoolKind | null = null;
    if (to === "pas" && !inPool) {
      ok = await saveReject(k, { at: new Date().toISOString(), name: who });
    } else {
      const r = await ensurePool(c, false, kind);
      ok = !!r;
      if (r) {
        if (r.created) added = r.kind;
        const status: ScoutStatus = to === "contacter" ? "contacter" : to === "pas" ? "ecarte" : "observation";
        ok = await saveStatus(r.kind, r.id, status);
        if (ok && rejects[k]) await saveReject(k, null);
      }
    }
    setAdding(null);
    const dest = to === "scouting" ? "Scouting" : to === "contacter" ? "À contacter" : "Écartés";
    toast(ok ? `${who} → ${dest}${added ? `, ajouté au ${KIND_LIST[added]}` : ""} ✓` : "Erreur, réessaie");
  };
  /** Remet un compte écarté (hors Scouting) dans « À trier ». */
  const untriage = async (c: Candidate) => {
    const ok = await saveReject(keyOf(c), null);
    toast(ok ? "Remis dans « À trier »" : "Erreur, réessaie");
  };

  const [pageQ, setPageQ] = useState("");
  const scored = useMemo(() => (last?.results ?? []).map((c) => ({ c, p: c.data ? scoreOf(c.data) : { score: 0, flags: [] as string[] } })), [last]);
  const shown = useMemo(() => {
    const lo = parseCount(minF);
    const hi = parseCount(maxF);
    const er = Number(minEr.replace(",", ".")) || 0;
    const word = norm(bioWord.trim());
    const list = scored.filter(({ c }) => {
      const d = c.data;
      if (!matchWords(pageQ, c.username, d?.name, d?.handle, d?.bio, d?.email, c.via?.join(" "))) return false;
      if (!d || c.why || d.isBrand) return showOthers;
      const f = d.followers ?? 0;
      if (lo && f < lo) return false;
      if (hi && f > hi) return false;
      if (er && (d.er ?? 0) < er) return false;
      if (word && !norm(`${d.bio ?? ""} ${d.name ?? ""}`).includes(word)) return false;
      if (emailF === "avec" && !d.email) return false;
      if (emailF === "sans" && d.email) return false;
      if (agencyF === "sans" && d.agency) return false;
      if (agencyF === "avec" && !d.agency) return false;
      return true;
    });
    const key = ({ c, p }: (typeof scored)[number]) =>
      sort === "er" ? c.data?.er ?? -1 : sort === "count" ? c.count ?? 0 : sort === "followers" ? c.data?.followers ?? -1 : p.score;
    return list.sort((a, b) => key(b) - key(a));
  }, [scored, minF, maxF, minEr, bioWord, emailF, agencyF, showOthers, sort, pageQ]);
  const hidden = (last?.results.length ?? 0) - shown.length;
  const activeFilters = [minF.trim() || maxF.trim(), minEr.trim(), bioWord.trim(), emailF !== "tous", agencyF !== "toutes", showOthers].filter(Boolean).length;
  /** Montre tout : plus aucun filtre, ni recherche dans les résultats, et les comptes cachés d'office. */
  const showAll = () => {
    setMinF(""); setMaxF(""); setMinEr(""); setBioWord(""); setEmailF("tous"); setAgencyF("toutes"); setPageQ(""); setShowOthers(true);
  };
  const bySection = { trier: 0, scouting: 0, contacter: 0, pas: 0, roster: 0 } as Record<Section, number>;
  for (const x of shown) bySection[sectionOf(x.c)]++;
  const visible = shown.filter((x) => sectionOf(x.c) === section);


  // ── Sélection (panneau « Profil sélectionné ») et raccourcis clavier ─────────
  const wide = useWide();
  const reduced = useReducedMotion();
  const [selKey, setSelKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false); // téléphone / tablette : fiche en feuille du bas
  const selIdx = useRef(0);
  const rowEls = useRef(new Map<string, HTMLElement>());
  // Grand écran : un compte est toujours sélectionné ; s'il quitte la section (trié), on passe au suivant.
  const selected = visible.find((x) => x.c.username === selKey) ?? (wide && selKey && visible.length ? visible[Math.min(selIdx.current, visible.length - 1)] : null);
  const selPos = selected ? visible.indexOf(selected) : -1;
  useEffect(() => {
    if (selPos >= 0) selIdx.current = selPos;
  }, [selPos]);
  const select = (key: string, open = true) => {
    setSelKey(key);
    if (!wide && open) setSheet(true);
  };
  const move = (dir: 1 | -1) => {
    if (!visible.length) return;
    const next = visible[Math.max(0, Math.min(visible.length - 1, (selPos < 0 ? -1 : selPos) + dir))];
    setSelKey(next.c.username);
    rowEls.current.get(next.c.username)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  };
  // Les actions de tri, les mêmes que les boutons (rien de nouveau côté données).
  const canScout = (s: Section) => s !== "scouting" && s !== "roster";
  const canWrite = (s: Section) => s !== "roster" && s !== "pas";
  const canPass = (s: Section) => s !== "pas" && s !== "roster";
  const act = (x: { c: Candidate }, what: "scouting" | "contacter" | "pas" | "ecrire") => {
    const s = sectionOf(x.c);
    if (adding === x.c.username) return;
    if (what === "ecrire") {
      if (!canWrite(s)) return;
      setSheet(false);
      setContact(x.c);
      return;
    }
    if (what === "scouting" && !canScout(s)) return;
    if (what === "pas" && !canPass(s)) return;
    if (what === "contacter" && (s === "contacter" || s === "roster")) return;
    setSheet(false);
    void triage(x.c, what);
  };
  // Barre des raccourcis : cachée, « ? » l'affiche ou la cache, Échap la ferme.
  const [keysOpen, setKeysOpen] = useState(false);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (paused || contact || askKind || !wide || !last) return;
    const k = e.key.toLowerCase();
    if (e.key === "?") setKeysOpen((o) => !o);
    else if (e.key === "Escape" && keysOpen) setKeysOpen(false);
    else if (k === "j") move(1);
    else if (k === "k") move(-1);
    else if (selected && k === "s") act(selected, "scouting");
    else if (selected && k === "c") act(selected, "ecrire");
    else if (selected && k === "x") act(selected, "pas");
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if ((e.target as HTMLElement | null)?.closest?.("[role='dialog']")) return;
      keyRef.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const SOURCES: Opt[] = [
    { value: "marque", label: "Depuis une marque", hint: "L'app lit les 50 derniers posts de la marque et liste les @ qu'elle cite : souvent les créateurs avec qui elle a travaillé." },
    { value: "similaire", label: "Comme un créateur", hint: "Les marques avec qui il travaille, puis les autres créateurs de ces marques. Plus ils en partagent, plus ils lui ressemblent." },
    { value: "liste", label: "Liste de @", hint: "Colle des @ trouvés ailleurs pour voir tous leurs chiffres d'un coup." },
  ];
  const YT_SOURCES: Opt[] = [
    { value: "search", label: "Par thème", hint: "Un sujet (« fitness lyon », « maman bébé ») et un pays : les chaînes qui en parlent. Impossible sur Instagram, possible ici." },
    { value: "brand", label: "Depuis une marque", hint: "Les chaînes qui ont fait des vidéos sur cette marque (tests, sponsors, avis)." },
    { value: "list", label: "Liste de chaînes", hint: "Colle des @ ou des liens YouTube pour voir leurs chiffres." },
  ];
  /** Les façons de chercher, en cartes : un titre qui dit ce qu'on obtient, une phrase qui dit comment. */
  const CARDS: { value: string; title: string; short: string; button: string }[] = isYt
    ? [
        { value: "search", title: "Par thème", short: "Les chaînes qui parlent d'un sujet, dans un pays", button: "Trouver des chaînes" },
        { value: "brand", title: "Les chaînes d'une marque", short: "Celles qui ont parlé de la marque en vidéo", button: "Trouver ses chaînes" },
        { value: "list", title: "Mes chaînes à analyser", short: "Les chiffres d'une liste que tu as déjà", button: "Analyser ces chaînes" },
      ]
    : [
        { value: "marque", title: "Les créateurs d'une marque", short: "Ceux qu'elle a cités ou payés dans ses derniers posts", button: "Trouver ses créateurs" },
        { value: "similaire", title: "Des profils comme…", short: "Qui ressemblent à un créateur que tu aimes", button: "Trouver des profils proches" },
        { value: "liste", title: "Mes @ à analyser", short: "Tous les chiffres d'une liste que tu as déjà", button: "Analyser ces @" },
      ];
  const isList = isYt ? ytSource === "list" : source === "liste";
  const run = () => void (isYt ? runYt() : source === "marque" ? runBrand() : source === "similaire" ? runSimilar() : runList());
  const startOpts = isYt ? YT_SOURCES : SOURCES;
  const startVal = isYt ? ytSource : source;
  const inputVal = isYt ? ytQ : source === "marque" ? brandIn : creatorIn;
  const setInput = (v: string) => (isYt ? setYtQ(v) : source === "marque" ? setBrandIn(v) : setCreatorIn(v));
  const inputHint = isYt ? (ytSource === "search" ? "fitness lyon, maman bébé, recettes healthy…" : "nom de la marque (ex : gymshark)") : source === "marque" ? "gymshark" : "un créateur que tu aimes";
  const regionLabel = REGIONS.find(([v]) => v === ytRegion)?.[1] ?? ytRegion;

  // Pastilles de filtre : uniquement les filtres qui existent (abonnés, engagement, bio, email, agence, tri, comptes masqués).
  const sortOpts: Opt[] = [
    { value: "score", label: "Potentiel" },
    { value: "followers", label: "Abonnés" },
    { value: "er", label: "Engagement" },
    ...(last && last.mode !== "liste" && last.mode !== "yt-list"
      ? [{ value: "count", label: last.mode === "similaire" ? "Marques en commun" : last.mode === "yt-brand" ? "Vidéos sur la marque" : last.mode === "yt-search" ? "Pertinence" : "Citations" }]
      : []),
  ];
  const followersLabel = minF.trim() && maxF.trim() ? `${minF.trim()} à ${maxF.trim()} abonnés` : minF.trim() ? `${minF.trim()} abonnés et plus` : maxF.trim() ? `Jusqu'à ${maxF.trim()} abonnés` : "Abonnés";
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

  /** Menu ⋯ d'un compte : toutes les actions existantes (ouvrir, écrire, ranger, copier l'email). */
  const menuFor = (c: Candidate): ActionItem[] => {
    const sec = sectionOf(c);
    const inPool = pool.get(keyOf(c));
    const yt = c.data?.platform === "youtube";
    const href = yt ? c.data?.url : igLink(c.username);
    return [
      ...(href ? [{ key: "open", label: "Ouvrir le profil", icon: ExternalLink, onClick: () => window.open(href, "_blank", "noopener,noreferrer") }] : []),
      ...(canWrite(sec) ? [{ key: "write", label: "Écrire", icon: Send, onClick: () => setContact(c) }] : []),
      ...(canScout(sec) ? [{ key: "scout", label: "Ajouter au Scouting", icon: Bookmark, onClick: () => act({ c }, "scouting") }] : []),
      ...(sec !== "contacter" && sec !== "roster" ? [{ key: "tocontact", label: "Ranger « À contacter »", icon: PhoneOutgoing, onClick: () => act({ c }, "contacter") }] : []),
      ...(canPass(sec) ? [{ key: "pass", label: "Écarter", icon: X, onClick: () => act({ c }, "pas") }] : []),
      ...(sec === "pas" && !inPool ? [{ key: "back", label: "Remettre à trier", icon: RotateCcw, onClick: () => void untriage(c) }] : []),
      ...(c.data?.email ? [{ key: "mail", label: "Copier l'email", icon: Mail, onClick: () => { void navigator.clipboard?.writeText(c.data?.email ?? ""); toast("Email copié ✓"); } }] : []),
    ];
  };

  /** Ce que l'app a déjà repéré et qui mérite un coup d'œil avant d'écrire. */
  const caveats = (c: Candidate, b: ScoreBreakdown | null): string[] => {
    const d = c.data;
    const out: string[] = [];
    if (c.why) out.push(igWhyText(c.why));
    if (!d) return out;
    if (b) out.push(...b.flags.map((f) => `${f}.`));
    if (d.agency) out.push(`Sa bio ou son lien parle peut-être d'une agence (« ${d.agency} ») : vérifie avant d'écrire.`);
    if (!d.email && !c.why) out.push(d.platform === "youtube" ? "Pas d'email trouvé sur la chaîne." : "Pas d'email trouvé : écris-lui plutôt en message Instagram.");
    return out;
  };

  /** Le panneau « Profil sélectionné » (colonne de droite, ou feuille du bas sur téléphone). */
  const renderInspector = (x: { c: Candidate; p: { score: number; flags: string[] } }) => {
    const { c } = x;
    const d = c.data;
    const yt = d?.platform === "youtube";
    const ok = !!d && !c.why;
    const b = ok && d ? scoreBreakdown(d) : null;
    const sec = sectionOf(c);
    const inPool = pool.get(keyOf(c));
    const scoutSt: ScoutStatus | null = inPool ? statusIn(inPool) : null;
    const href = yt ? d?.url : igLink(c.username);
    const busyRow = adding === c.username;
    const notes = caveats(c, b);
    const handle = yt ? `@${d?.handle || c.username}` : `@${c.username}`;
    const btn2 = "flex h-10 items-center justify-center gap-1.5 rounded-full bg-field px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">Profil sélectionné</span>
          <div className="flex items-center gap-1">
            {wide && (
              <button type="button" onClick={() => setSelKey(null)} title="Fermer" aria-label="Fermer la fiche" className="grid h-8 w-8 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover">
                <X className="h-4 w-4" />
              </button>
            )}
            <ActionMenu items={menuFor(c)} buttonClassName="h-8 w-8 bg-field text-foreground" />
            {href && (
              <a href={href} target="_blank" rel="noreferrer" title="Ouvrir le profil" aria-label="Ouvrir le profil" className="grid h-8 w-8 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover">
                <ArrowUpRight className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col items-center text-center">
            <Pic src={d?.picture} name={d?.name || c.username} size={72} />
            <a href={href} target="_blank" rel="noreferrer" className="mt-3 max-w-full truncate text-[22px] font-bold tracking-tight text-foreground hover:underline">
              {yt ? d?.name || handle : handle}
            </a>
            {d?.name && <div className="max-w-full truncate text-[13px] text-muted-foreground">{yt ? handle : d.name}</div>}
            {d?.bio && <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-muted-foreground">{d.bio}</p>}
            <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
              {ok && x.p.score >= PEPITE && <StatusPill tone="ok" size="xs">Pépite</StatusPill>}
              {sec !== "trier" && (
                <StatusPill tone={sec === "pas" ? "closed" : sec === "contacter" ? "progress" : sec === "roster" ? "info" : "ok"} size="xs">
                  {sec === "roster" ? "Au roster" : scoutSt ? SCOUT_LABEL[scoutSt] : "Écarté"}
                </StatusPill>
              )}
              {inPool && <span className="inline-flex h-5 items-center rounded-full bg-field px-2 text-[11px] font-medium text-muted-foreground" title={`Dans le ${KIND_LIST[inPool.kind]}`}>{KIND_ONE[inPool.kind]}</span>}
              {inPool?.last_contacted && <span className="inline-flex h-5 items-center rounded-full bg-field px-2 text-[11px] font-medium text-muted-foreground">Contacté le {fmtDay(inPool.last_contacted)}</span>}
            </div>
            {d?.email && (
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(d.email ?? ""); toast("Email copié ✓"); }} title={d.emailFrom === "lien" ? "Trouvé sur son lien en bio · copier" : "Trouvé dans sa bio · copier"} className="mt-2 flex max-w-full items-center gap-1.5 rounded-full bg-field px-3 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
                <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{d.email}</span>{d.emailFrom === "lien" ? <span className="text-muted-foreground">(lien)</span> : null}
              </button>
            )}
          </div>

          {ok && d && (
            <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-[16px] bg-panel py-3 text-center">
              {[
                ["abonnés", d.followers != null ? fmtCompact(d.followers) : null, yt && d.followers == null ? "Abonnés masqués par la chaîne" : undefined],
                ...(yt ? [["vues / vidéo", d.avgViews != null ? fmtCompact(d.avgViews) : null, undefined]] : [["engagement", d.er != null ? fmtEr(d.er) : null, undefined]]),
                [yt ? "vidéos / sem." : "posts / sem.", perWeekParts(d.perWeek), undefined],
              ].map(([label, value, title]) => (
                <div key={label} className="min-w-0 px-2" title={title ?? undefined}>
                  <div className="truncate text-[18px] font-semibold tabular-nums text-foreground">{value ?? EMPTY}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          )}

          {b && (
            <div className="mt-5">
              <div className="mb-2.5 flex items-center gap-1.5">
                <span className="text-[15px] font-bold text-foreground">Potentiel {b.score}/100</span>
                <span className="flex items-center text-muted-foreground">
                  <HelpTip title="Le score « Potentiel »" align="end">
                    {yt ? (
                      <p>Une note sur 100 pour trier vite : vues moyennes par rapport aux abonnés (30), engagement des vidéos (10), rythme (15), déjà sponsorisé (15), email (10), pas d'agence (10), actif ce mois-ci (10).</p>
                    ) : (
                      <p>Une note sur 100 pour trier vite : engagement par rapport à sa taille (40), rythme de publication (15), déjà payé par des marques (15), email trouvé (10), pas d'agence (10), actif ces 2 dernières semaines (10).</p>
                    )}
                    <p>Chaque signal d'alerte retire 15 points. 70 et plus : pépite. C'est une aide, pas un verdict.</p>
                  </HelpTip>
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {b.factors.map((f) => (
                  <div key={f.key} className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3" title={`${Math.round(f.points)} / ${f.max} points`}>
                    <span className="truncate text-[13px] text-foreground">{f.label}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-field">
                      <span className={cn("block h-full rounded-full", TONE_DOT[f.tone])} style={{ width: `${Math.round((f.points / f.max) * 100)}%` }} />
                    </span>
                    <span className={cn("text-right text-[12px] font-semibold", TONE_TEXT[f.tone])}>{f.verdict}</span>
                  </div>
                ))}
                {b.penalty > 0 && (
                  <div className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3">
                    <span className="truncate text-[13px] text-foreground">Alertes</span>
                    <span className="truncate text-[12px] text-muted-foreground">{plural(b.flags.length, "signal")}</span>
                    <span className={cn("text-right text-[12px] font-semibold", TONE_TEXT.wait)}>−{b.penalty}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {notes.length > 0 && (
            <div className="mt-4 flex gap-2.5 rounded-[14px] bg-wait-soft px-3.5 py-3 text-[13px] leading-snug text-foreground">
              <Info className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_TEXT.wait)} />
              <div className="flex min-w-0 flex-col gap-1">{notes.map((n) => <p key={n}>{n}</p>)}</div>
            </div>
          )}

          {!!d?.deals?.length && (
            <div className="mt-4 text-[12px] text-muted-foreground">
              <div className="mb-1.5 font-medium text-foreground">{yt ? "Déjà sponsorisé par" : "A déjà bossé avec"}</div>
              <div className="flex flex-wrap gap-1.5">
                {d.deals.slice(0, 8).map((m) => yt
                  ? <span key={m} className="rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-foreground">{m}</span>
                  : <a key={m} href={igLink(m)} target="_blank" rel="noreferrer" className="rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-rowhover">@{m}</a>)}
              </div>
            </div>
          )}
          {!!c.via?.length && <div className="mt-3 text-[12px] text-muted-foreground">Marques en commun : {c.via.map((m) => `@${m}`).join(", ")}</div>}
        </div>

        {/* Actions, toujours en bas du panneau */}
        {sec !== "roster" && (
          <div className="mt-4 flex shrink-0 flex-col gap-2 border-t border-border pt-4">
            {canScout(sec) ? (
              <button type="button" onClick={() => act(x, "scouting")} disabled={busyRow} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {busyRow ? <Spin size={14} /> : <Plus className="h-4 w-4" />} Ajouter au Scouting
              </button>
            ) : (
              <button type="button" onClick={() => act(x, "contacter")} disabled={busyRow} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {busyRow ? <Spin size={14} /> : <PhoneOutgoing className="h-4 w-4" />} Ranger « À contacter »
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {canWrite(sec) ? (
                <button type="button" onClick={() => act(x, "ecrire")} title="Écrire par mail ou sur Instagram" className={btn2}><Send className="h-3.5 w-3.5" /> Écrire</button>
              ) : !inPool ? (
                <button type="button" onClick={() => void untriage(c)} title="Remettre dans « À trier »" className={btn2}><RotateCcw className="h-3.5 w-3.5" /> Remettre</button>
              ) : (
                <button type="button" onClick={() => act(x, "contacter")} disabled={busyRow} title="Ranger dans « À contacter »" className={btn2}><PhoneOutgoing className="h-3.5 w-3.5" /> Ranger</button>
              )}
              {canPass(sec) ? (
                <button type="button" onClick={() => act(x, "pas")} disabled={busyRow} className={btn2}><X className="h-3.5 w-3.5" /> Écarter</button>
              ) : (
                <button type="button" disabled className={btn2}><Check className="h-3.5 w-3.5" /> Écarté</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Le détail d'un profil ne s'ouvre qu'au clic (plus de colonne vide « Choisis un profil »).
  const hasInspector = wide && !!last && !!selected;
  const card = CARDS.find((x) => x.value === startVal) ?? CARDS[0];
  const startHint = startOpts.find((o) => o.value === startVal)?.hint;
  return (
    <div className={cn("grid items-start gap-5", hasInspector && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="@container min-w-0">
        {searchOpen || !last ? (
          /* 1. Chercher : le réseau, la façon de chercher (en cartes), un seul champ, un bouton qui dit ce qu'il fait */
          <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex flex-col gap-3 rounded-[20px] bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[15px] font-semibold text-foreground">Comment chercher ?</span>
              <div className="flex items-center gap-2">
                {last && (
                  <button type="button" onClick={() => setSearchOpen(false)} className="h-8 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    Revenir aux résultats
                  </button>
                )}
                <Tabs
                  size="sm"
                  label="Réseau"
                  value={platform}
                  onValueChange={(v) => setPlatform(v === "youtube" ? "youtube" : "instagram")}
                  items={[
                    { value: "instagram", label: "Instagram", icon: <PlatformIcon platform="instagram" className="h-3.5 w-3.5" /> },
                    { value: "youtube", label: "YouTube", icon: <PlatformIcon platform="youtube" className="h-3.5 w-3.5" /> },
                  ]}
                />
              </div>
            </div>
            <div role="radiogroup" aria-label="Façon de chercher" className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
              {CARDS.map((o) => {
                const on = o.value === startVal;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => (isYt ? setYtSource(o.value as typeof ytSource) : setSource(o.value as typeof source))}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-[16px] px-4 py-3 text-left transition-colors",
                      on ? "bg-primary/[0.06] ring-2 ring-primary" : "bg-panel ring-1 ring-border hover:bg-rowhover",
                    )}
                  >
                    <span className="text-[14px] font-semibold text-foreground">{o.title}</span>
                    <span className="text-[12px] leading-snug text-muted-foreground">{o.short}</span>
                  </button>
                );
              })}
            </div>
            {isList ? (
              isYt ? (
                <textarea aria-label="Liste de chaînes" value={ytList} onChange={(e) => setYtList(e.target.value)} rows={4} placeholder={"@lea.fit\nyoutube.com/@camilleyoga\nyoutube.com/channel/UC…"} className="w-full resize-y rounded-[14px] bg-field px-3 py-2.5 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-faint" />
              ) : (
                <textarea aria-label="Liste de @" value={listIn} onChange={(e) => setListIn(e.target.value)} rows={4} placeholder={"@lea.fit\n@ines.run\ninstagram.com/camille.yoga"} className="w-full resize-y rounded-[14px] bg-field px-3 py-2.5 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-faint" />
              )
            ) : (
              <label className="flex h-11 min-w-0 items-center gap-1.5 rounded-full bg-field px-4">
                {isYt && ytSource === "search" ? <Search className="h-4 w-4 shrink-0 text-faint" /> : !isYt ? <span aria-hidden className="text-[15px] font-medium text-faint">@</span> : null}
                <input
                  aria-label={isYt ? (ytSource === "search" ? "Thème" : "Marque") : source === "marque" ? "@ de la marque" : "@ du créateur"}
                  value={inputVal}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={inputHint}
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint"
                />
                {isYt && <MenuPill ariaLabel="Pays" label={regionLabel} value={ytRegion} onChange={setYtRegion} options={REGIONS.map(([v, l]) => ({ value: v, label: l }))} />}
              </label>
            )}
            <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center @xl:justify-between">
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
                {isList ? (isYt ? "Un @ ou un lien par ligne. Environ 3 unités YouTube par chaîne." : "Un @ par ligne (ou des liens Instagram). 1 demande Meta par @.") : startHint}
              </p>
              <button type="submit" disabled={!!busy} className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {busy ? <Spin size={14} /> : <Search className="h-4 w-4" />} {card.button}
              </button>
            </div>
            {!isYt && source === "similaire" && roster.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                Ou pars d'un de tes créateurs :
                {roster.slice(0, 12).map((r) => (
                  <button key={r.user} type="button" disabled={!!busy} onClick={() => void runSimilar(r.user)} className="rounded-full bg-field px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                    {titleCase(r.name)}
                  </button>
                ))}
              </div>
            )}
          </form>
        ) : null}

        {/* Avancement et quota YouTube, sous la recherche */}
        {(busy || (isYt && ytQuota)) && (
          <div className="mt-2 flex flex-col gap-2 px-1 text-[12px] text-muted-foreground">
            {busy && <div>{busy}</div>}
            {isYt && ytQuota && (
              <span title="Google offre 10 000 unités par jour : une recherche par thème ou par marque en coûte environ 150, une chaîne de la liste environ 3">
                Quota YouTube du jour : <span className={cn("font-semibold", ytQuota.used / ytQuota.limit > 0.85 ? TONE_TEXT.wait : "text-foreground")}>{ytQuota.used.toLocaleString("fr-FR")}</span> / {ytQuota.limit.toLocaleString("fr-FR")}
              </span>
            )}
          </div>
        )}

        {last && (
          <>
            {/* 2. Les résultats, en clair : d'où ils viennent, combien, et de quoi les filtrer */}
            <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[20px] font-bold leading-tight tracking-tight text-foreground">{last.label.replace(/^Créatrices citées/, "Créateurs cités")}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[13px] text-muted-foreground">
                  <span title={last.mode === "similaire" && last.brands?.length ? `Via ${last.brands.slice(0, 4).map((m) => `@${m}`).join(", ")}` : undefined}>
                    {plural(shown.length, "profil")} · recherche du {fmtDay(last.at)}
                  </span>
                  <HelpTip title="Le score « Potentiel »">
                    <p>Une note sur 100 pour trier vite : engagement par rapport à sa taille (40), rythme de publication (15), déjà payé par des marques (15), email trouvé (10), pas d'agence (10), actif ces 2 dernières semaines (10).</p>
                    <p>Chaque signal d'alerte retire 15 points : engagement très bas pour sa taille, compte qui suit plus de monde qu'il n'a d'abonnés, rien publié depuis 2 mois.</p>
                    <p>70 et plus : pépite. C'est une aide, pas un verdict.</p>
                  </HelpTip>
                </p>
              </div>
              {!searchOpen && (
                <button type="button" onClick={() => setSearchOpen(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-field px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover">
                  <Search className="h-3.5 w-3.5" /> Nouvelle recherche
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <PillSearch value={pageQ} onChange={setPageQ} placeholder="Chercher dans les résultats…" />
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((o) => !o)}
                className={cn("flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors", activeFilters ? "bg-primary/[0.08] text-primary" : "bg-field text-foreground hover:bg-rowhover")}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Filtrer{activeFilters ? ` · ${activeFilters}` : ""}
              </button>
              <FilterChip label={`Trier : ${sortOpts.find((o) => o.value === sort)?.label ?? "Potentiel"}`} active onClear={sort !== "score" ? () => setSort("score") : undefined}>
                <OptionList value={sort} onPick={(v) => setSort(v as typeof sort)} options={sortOpts} />
              </FilterChip>
              {hidden > 0 && (
                <span className="px-1 text-[12px] text-muted-foreground">
                  {hidden} caché{hidden > 1 ? "s" : ""}{" "}
                  <span title="Par tes filtres, ou d'office : comptes perso (Meta ne donne pas leurs chiffres), marques citées, @ introuvables">par tes filtres ou d'office</span>{" "}·{" "}
                  <button type="button" onClick={showAll} className="font-semibold text-primary hover:underline">tout afficher</button>
                </span>
              )}
            </div>
            {filtersOpen && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-[16px] bg-panel p-2">
              <FilterChip label={followersLabel} active={!!(minF.trim() || maxF.trim())} onClear={() => { setMinF(""); setMaxF(""); }}>
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold text-foreground">Abonnés</div>
                  <div className="flex items-center gap-2">
                    <input aria-label="Abonnés minimum" value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="10k" className={cn(IN, "w-full")} />
                    <span className="text-[12px] text-muted-foreground">à</span>
                    <input aria-label="Abonnés maximum" value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="50k" className={cn(IN, "w-full")} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Tu peux écrire 10k, 10 000 ou 1,2M.</p>
                </div>
              </FilterChip>
              <FilterChip label={minEr.trim() ? `Engagement ${minEr.trim()} % et plus` : "Engagement"} active={!!minEr.trim()} onClear={() => setMinEr("")}>
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold text-foreground">Engagement minimum (%)</div>
                  <input aria-label="Engagement minimum" value={minEr} onChange={(e) => setMinEr(e.target.value)} placeholder="2" inputMode="decimal" className={cn(IN, "w-full")} />
                  <p className="text-[11px] leading-snug text-muted-foreground">Likes et commentaires moyens de ses 12 derniers posts, divisés par ses abonnés. De 1 à 3 % c'est la moyenne, au-dessus de 3 % c'est bon.</p>
                </div>
              </FilterChip>
              <FilterChip label={bioWord.trim() ? `Bio : ${bioWord.trim()}` : "Mot dans la bio"} active={!!bioWord.trim()} onClear={() => setBioWord("")}>
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold text-foreground">Mot dans la bio</div>
                  <input aria-label="Mot dans la bio" value={bioWord} onChange={(e) => setBioWord(e.target.value)} placeholder="Lyon, running, maman…" className={cn(IN, "w-full")} />
                  <p className="text-[11px] leading-snug text-muted-foreground">Une ville, une niche ou une langue : l'app cherche le mot dans la bio et le nom.</p>
                </div>
              </FilterChip>
              <FilterChip label={emailF === "avec" ? "Avec email" : emailF === "sans" ? "Sans email" : "Email"} active={emailF !== "tous"} onClear={() => setEmailF("tous")}>
                <OptionList value={emailF} onPick={(v) => setEmailF(v as typeof emailF)} options={[{ value: "tous", label: "Tous" }, { value: "avec", label: "Avec email", hint: "Tu peux lui écrire tout de suite depuis l'app." }, { value: "sans", label: "Sans email" }]} />
              </FilterChip>
              <FilterChip label={agencyF === "sans" ? "Sans agence" : agencyF === "avec" ? "Déjà en agence" : "Agence"} active={agencyF !== "toutes"} onClear={() => setAgencyF("toutes")}>
                <OptionList value={agencyF} onPick={(v) => setAgencyF(v as typeof agencyF)} options={[{ value: "toutes", label: "Toutes" }, { value: "sans", label: "Sans agence" }, { value: "avec", label: "Déjà en agence", hint: "Un indice dans la bio ou le lien (management, booking…), pas une certitude." }]} />
              </FilterChip>
              <FilterChip
                  label="Voir aussi les comptes perso, marques, @ introuvables"
                  title="Cachés d'office : les comptes perso (Meta ne donne pas leurs chiffres), les marques citées et les @ introuvables."
                  active={showOthers}
                  onToggle={() => setShowOthers(!showOthers)}
                  onClear={() => setShowOthers(false)}
                />
              </div>
            )}

            {/* 3. Trier : les sections au-dessus de la liste */}
            {shown.length > 0 && (
              <div className="mb-3 mt-5 flex flex-wrap items-center justify-between gap-2">
                <Tabs
                  size="sm"
                  label="Sections du tri"
                  value={section}
                  onValueChange={(v) => setSection(v as Section)}
                  items={[
                    { value: "trier", label: "À trier", count: bySection.trier },
                    { value: "scouting", label: "Scouting", count: bySection.scouting },
                    { value: "contacter", label: "À contacter", count: bySection.contacter },
                    { value: "pas", label: "Écartés", count: bySection.pas },
                    ...(bySection.roster ? [{ value: "roster", label: "Au roster", count: bySection.roster }] : []),
                  ]}
                />
                {wide && (
                  <button
                    type="button"
                    onClick={() => setKeysOpen((o) => !o)}
                    aria-pressed={keysOpen}
                    title="Raccourcis clavier (touche ?)"
                    aria-label="Raccourcis clavier"
                    className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors", keysOpen ? "bg-primary/[0.08] text-primary" : "text-faint hover:bg-rowhover hover:text-foreground")}
                  >
                    <Keyboard className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {shown.length === 0 ? (
              <div className="mt-4 rounded-[16px] bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
                Aucun profil ne passe tes filtres.{" "}
                {hidden > 0 && <button type="button" onClick={showAll} className="font-semibold text-primary hover:underline">Tout afficher ({hidden})</button>}
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-[16px] bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
                {section === "trier"
                  ? "Tout est trié ✓ Retrouve chaque compte dans sa section."
                  : section === "scouting"
                    ? "Aucun compte gardé dans le Scouting pour cette recherche."
                    : section === "contacter"
                      ? "Aucun compte à contacter pour cette recherche."
                      : section === "pas"
                        ? "Aucun compte écarté pour cette recherche."
                        : "Aucun compte déjà au roster."}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {visible.map((x) => {
                  const { c, p } = x;
                  const d = c.data;
                  const yt = d?.platform === "youtube";
                  const inPool = pool.get(keyOf(c));
                  const sec = sectionOf(c);
                  const scoutSt: ScoutStatus | null = inPool ? statusIn(inPool) : null;
                  const ok = !!d && !c.why;
                  const on = selected?.c.username === c.username;
                  const busyRow = adding === c.username;
                  return (
                    <div
                      key={c.username}
                      ref={(el) => {
                        if (el) rowEls.current.set(c.username, el);
                        else rowEls.current.delete(c.username);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      onClick={() => select(c.username)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                          e.preventDefault();
                          select(c.username);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[16px] px-3 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 @2xl:flex-nowrap",
                        on ? "bg-primary/[0.06] ring-[1.5px] ring-primary" : "hover:bg-rowhover",
                        !ok && "opacity-70",
                      )}
                    >
                      <div className="order-1 @2xl:order-none"><Pic src={d?.picture} name={d?.name || c.username} /></div>
                      <div className="order-1 min-w-0 flex-1 @2xl:order-none">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="flex min-w-0 items-center gap-1 truncate text-[14px] font-bold text-foreground">
                            {yt && <PlatformIcon platform="youtube" className="h-3.5 w-3.5 shrink-0" />}
                            <span className="max-w-[45ch] truncate" title={yt ? d?.name || `@${c.username}` : `@${c.username}`}>{yt ? d?.name || `@${c.username}` : `@${c.username}`}</span>
                          </span>
                          {d?.name && <span className="min-w-0 truncate text-[13px] text-muted-foreground">{yt ? `@${d.handle || c.username}` : d.name}</span>}
                        </div>
                        {/* Trois infos au plus sous le nom, par ordre d'importance ; le reste au survol de « +N ». */}
                        {(() => {
                          const chip = "inline-flex h-5 items-center rounded-full bg-field px-2 text-[11px] font-medium text-muted-foreground";
                          const metas: { key: string; text: string; node: ReactNode }[] = [];
                          if (c.why) metas.push({ key: "why", text: igWhyText(c.why), node: <span className="text-[11px] text-muted-foreground">{igWhyText(c.why)}</span> });
                          if (sec !== "trier" && sec !== "roster") {
                            const st = scoutSt ? SCOUT_LABEL[scoutSt] : "Écarté";
                            metas.push({ key: "st", text: st, node: <StatusPill tone={sec === "pas" ? "closed" : sec === "contacter" ? "progress" : "ok"} size="xs">{st}</StatusPill> });
                          }
                          if (p.flags.length) {
                            const t = p.flags.length === 1 ? p.flags[0] : `${p.flags.length} alertes`;
                            metas.push({ key: "flags", text: p.flags.join(", "), node: <StatusPill tone="wait" size="xs" title={p.flags.join(" · ")}>{t}</StatusPill> });
                          }
                          if (ok && p.score >= PEPITE) metas.push({ key: "pep", text: "Pépite", node: <StatusPill tone="ok" size="xs">Pépite</StatusPill> });
                          if (d?.agency) metas.push({ key: "ag", text: "En agence ?", node: <StatusPill tone="wait" size="xs" title={`Indice : « ${d.agency} »`}>En agence ?</StatusPill> });
                          if (c.count && last.mode !== "yt-search") {
                            const t = last.mode === "similaire" ? `${c.count} marque${c.count > 1 ? "s" : ""} en commun` : last.mode === "yt-brand" ? `${c.count} vidéo${c.count > 1 ? "s" : ""} sur la marque` : `cité ${c.count}×`;
                            metas.push({ key: "count", text: t, node: <span className={chip}>{t}</span> });
                          }
                          if (d?.email) metas.push({ key: "mail", text: d.email, node: <span title={d.email} className={chip}><Mail className="mr-1 h-3 w-3" /> Email</span> });
                          if (inPool) metas.push({ key: "pool", text: KIND_ONE[inPool.kind], node: <span title={`Dans le ${KIND_LIST[inPool.kind]}`} className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[11px] font-medium text-muted-foreground">{KIND_ONE[inPool.kind]}</span> });
                          if (inPool?.last_contacted) {
                            const t = `Contacté le ${fmtDay(inPool.last_contacted)}`;
                            metas.push({ key: "contact", text: t, node: <span className="text-[11px] text-muted-foreground">{t}</span> });
                          }
                          if (!metas.length) return null;
                          const rest = metas.slice(3);
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {metas.slice(0, 3).map((m) => <span key={m.key} className="contents">{m.node}</span>)}
                              {rest.length > 0 && <span title={rest.map((m) => m.text).join(" · ")} className="text-[11px] text-faint">+{rest.length}</span>}
                            </div>
                          );
                        })()}
                      </div>
                      {/* Téléphone : chiffres et actions passent sur une 2e ligne */}
                      <div className="order-3 grid min-w-0 flex-1 grid-cols-3 gap-2 @2xl:order-none @2xl:w-[228px] @2xl:flex-none">
                        {ok && d ? (
                          <>
                            <Metric label="Abonnés" value={d.followers != null ? fmtCompact(d.followers) : null} title={yt && d.followers == null ? "Abonnés masqués par la chaîne" : undefined} />
                            {yt ? <Metric label="Vues / vidéo" value={d.avgViews != null ? fmtCompact(d.avgViews) : null} /> : <Metric label="Engagement" value={d.er != null ? fmtEr(d.er) : null} />}
                            <Metric label="Rythme" value={perWeekParts(d.perWeek)} unit="/sem" />
                          </>
                        ) : null}
                      </div>
                      <div className="order-2 @2xl:order-none">{ok ? <ScoreRing score={p.score} /> : <span className="block w-9" />}</div>
                      <div className="order-4 flex shrink-0 items-center gap-1 @2xl:order-none">
                        {sec === "roster" ? (
                          <span className="inline-flex h-8 items-center rounded-full bg-field px-3 text-[12px] font-medium text-muted-foreground">Au roster</span>
                        ) : sec === "trier" ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); act(x, "scouting"); }}
                              disabled={busyRow}
                              className={cn("flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50", on ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover")}
                            >
                              {busyRow ? <Spin size={14} /> : <Plus className="h-3.5 w-3.5" />} Scouting
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); act(x, "contacter"); }}
                              disabled={busyRow}
                              className="hidden h-8 items-center gap-1 rounded-full bg-field px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover disabled:opacity-50 @2xl:flex"
                            >
                              <PhoneOutgoing className="h-3.5 w-3.5" /> À contacter
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); act(x, "pas"); }}
                              disabled={busyRow}
                              title="Écarter"
                              aria-label="Écarter"
                              className="hidden h-8 w-8 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover disabled:opacity-50 @2xl:grid"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : null}
                        <ActionMenu items={menuFor(c)} buttonClassName="h-8 w-8" />
                      </div>
                      <div aria-hidden className="order-2 h-0 basis-full @2xl:hidden" />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Raccourcis clavier (grand écran) : seulement après « ? », pour ne pas couvrir la liste. */}
            {wide && keysOpen && visible.length > 0 && (
              <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-background/90 px-1 py-3 text-[12px] text-muted-foreground backdrop-blur md:-bottom-7 md:pb-10">
                <span className="flex items-center gap-1.5"><Kbd>J</Kbd> Suivant</span>
                <span className="flex items-center gap-1.5"><Kbd>K</Kbd> Précédent</span>
                <span className="flex items-center gap-1.5"><Kbd>S</Kbd> Scouting</span>
                <span className="flex items-center gap-1.5"><Kbd>C</Kbd> Écrire</span>
                <span className="flex items-center gap-1.5"><Kbd>X</Kbd> Écarter</span>
                <button type="button" onClick={() => setKeysOpen(false)} className="ml-auto flex items-center gap-1.5 hover:text-foreground"><Kbd>Échap</Kbd> Fermer</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Colonne de droite : le profil sélectionné (grand écran) */}
      {hasInspector && (
        <aside aria-label="Profil sélectionné" className="sticky top-0 flex max-h-[calc(100dvh-8rem)] flex-col rounded-[22px] bg-surface p-5">
          {selected && renderInspector(selected)}
        </aside>
      )}

      {/* Téléphone et tablette : la même fiche, en feuille du bas */}
      {!wide && sheet && selected && (
        <Overlay className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4" onClose={() => setSheet(false)} label="Profil sélectionné">
          <div role="dialog" aria-label="Profil sélectionné" className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-[22px] bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {renderInspector(selected)}
          </div>
        </Overlay>
      )}

      {contact && (
        <OutreachComposer
          title={`Contacter @${contact.username}`}
          to={contact.data?.email}
          box="talent"
          instagram={contact.data?.platform === "youtube" ? undefined : contact.username}
          contactName={contact.data?.name || `@${contact.username}`}
          subject={`TTP Creators × ${firstName(contact.data, contact.username)}`}
          body={`Bonjour ${firstName(contact.data, contact.username)},\n\nJe te contacte de la part de TTP Creators, une agence qui accompagne des créateurs de contenu dans leurs partenariats avec les marques.\n\nJ'aime beaucoup ton contenu${contact.data?.deals?.length ? ` et tes collaborations (${contact.data.deals.slice(0, 2).map((b) => `@${b}`).join(", ")})` : ""} : je pense qu'on pourrait faire de belles choses ensemble.\n\nÇa te dirait qu'on en parle ?\n\nBelle journée,`}
          onSent={() =>
            // Pas de question ici : un nouveau compte va dans la liste suggérée, dite dans le toast.
            void ensurePool(contact, true).then((r) => r && toast(r.created ? `Ajouté au ${KIND_LIST[r.kind]}, noté « contacté » ✓` : "Noté « contacté » dans le Scouting ✓"))}
          onClose={() => setContact(null)}
        />
      )}
      {askKind && (
        <KindChoice
          who={askKind.c.data?.platform === "youtube" ? askKind.c.data?.name || `@${askKind.c.username}` : `@${askKind.c.username}`}
          suggested={askKind.kind}
          sport={askKind.sport}
          onPick={(kind) => {
            const { c, to } = askKind;
            setAskKind(null);
            void triage(c, to, kind);
          }}
          onClose={() => setAskKind(null)}
        />
      )}
    </div>
  );
}

/** Petit choix « Ajouter @x au scouting : Créateur / Sportif », la liste suggérée mise en avant. */
function KindChoice({ who, suggested, sport, onPick, onClose }: { who: string; suggested: PoolKind; sport: string | null; onPick: (k: PoolKind) => void; onClose: () => void }) {
  const opts = [
    { v: "createur" as const, icon: Users, hint: "Scouting créateurs" },
    { v: "sportif" as const, icon: Trophy, hint: sport ? `Scouting sportifs · ${sport}` : "Scouting sportifs" },
  ];
  return (
    <Overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClose={onClose} label={`Ajouter ${who} au scouting`}>
      <div role="dialog" aria-label={`Ajouter ${who} au scouting`} className="w-full max-w-sm rounded-[22px] bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm font-bold text-foreground">
            Ajouter <span className="break-all">{who}</span> au scouting
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="shrink-0 text-faint transition-colors hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-[12px] text-muted-foreground">
          {sport ? `Sa bio parle de ${sport.toLocaleLowerCase("fr")} : plutôt un sportif ?` : "Dans quelle liste le ranger ?"}
        </p>
        <div className="flex flex-col gap-2">
          {opts.map((o) => {
            const on = o.v === suggested;
            const Icon = o.icon;
            return (
              <button
                key={o.v}
                type="button"
                onClick={() => onPick(o.v)}
                className={cn(
                  "flex items-center gap-3 rounded-full border px-4 py-2.5 text-left transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground hover:opacity-90" : "border-border text-foreground hover:bg-rowhover",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{KIND_ONE[o.v]}</span>
                  <span className={cn("block truncate text-[11px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{o.hint}</span>
                </span>
                {on && <span className="shrink-0 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px] font-semibold">suggéré</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Overlay>
  );
}

// ═════════════════════════════ Radar à marques ═════════════════════════════
type PostType = "paye" | "offert" | "spontane";
// Le type d'un post, lu dans son texte (les anciens relevés n'ont que « payé : oui/non »).
const RX_PAID = /#(ad|ads|pub|publicit[ée]|sponsor\w*|partenariat\w*|partnership|collab|collaboration|ambassad\w*)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}])publicit[ée](?![\p{L}\p{N}])|collaboration commerciale|partenariat (commercial|r[ée]mun[ée]r[ée])|paid partnership|sponsoris[ée] par|en partenariat/iu;
const RX_GIFT = /#gifted|produits?\s+offerts?|\(offert\)|offert par|cadeau de|envoy[ée]s? par|code promo|avec le code|code\s*:|\d{1,2}\s?%\s?(de\s)?(r[ée]duction|remise|off)|-\s?\d{1,2}\s?%|affili/iu;
const RX_CODE = /\b(code|avec|with)\s+[A-Z][A-Z0-9]{3,}\b/u;
function postType(p: RadarPost): PostType {
  if (RX_PAID.test(p.cap)) return "paye";
  if (p.paid || RX_GIFT.test(p.cap) || RX_CODE.test(p.cap)) return "offert";
  return "spontane";
}
const TYPE_META: Record<PostType, { label: string; cls: string; tip: string }> = {
  paye: { label: "Payé", cls: "bg-ok-soft text-ok", tip: "Le post dit #ad, publicité, collaboration commerciale, sponsorisé…" },
  offert: { label: "Offert / code", cls: "bg-info-soft text-info", tip: "Produit offert, code promo ou réduction : la marque envoie des produits ou rémunère à la vente" },
  spontane: { label: "Spontané", cls: "bg-closed-soft text-closed", tip: "Aucun signe de partenariat dans le texte" },
};
/** Extrait du texte centré sur la marque, avec la marque en évidence. */
function Excerpt({ text, brand, name }: { text: string; brand: string; name?: string }) {
  const lower = text.toLowerCase();
  let i = lower.indexOf(brand.toLowerCase());
  let len = brand.length;
  if (i === -1 && name) {
    i = lower.indexOf(name.toLowerCase());
    len = name.length;
  }
  if (i === -1) return <>{text.length > 140 ? `${text.slice(0, 140)}…` : text}</>;
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + len + 90);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, i)}
      <span className="rounded bg-primary/10 px-0.5 font-semibold text-foreground">{text.slice(i, i + len)}</span>
      {text.slice(i + len, end)}
      {end < text.length && "…"}
    </>
  );
}
/** Un même texte posté plusieurs fois par le même créateur : une seule ligne. */
function dedupe(posts: RadarPost[]): (RadarPost & { n: number })[] {
  const out = new Map<string, RadarPost & { n: number }>();
  for (const p of [...posts].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = `${p.c}|${norm(p.cap).replace(/\s+/g, " ").slice(0, 60)}`;
    const cur = out.get(k);
    if (cur) cur.n++;
    else out.set(k, { ...p, n: 1 });
  }
  return [...out.values()];
}

const PERIODS = [
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "all", label: "Tout" },
];

/** Radar à marques : Instagram (posts des créateurs), TikTok (partenariats payés déclarés en France) ou YouTube (vidéos sponsorisées). */
function RadarTool() {
  const [pf, setPf] = useState<"instagram" | "tiktok" | "youtube">(() => {
    try {
      const v = localStorage.getItem("ttp:radar-platform");
      return v === "tiktok" || v === "youtube" ? v : "instagram";
    } catch {
      return "instagram";
    }
  });
  const pick = (v: string) => {
    const next = v === "tiktok" || v === "youtube" ? v : "instagram";
    setPf(next);
    try {
      localStorage.setItem("ttp:radar-platform", next);
    } catch {
      /* stockage indisponible */
    }
  };
  const tabs = (
        <Tabs
          size="sm"
          label="Réseau du radar"
          value={pf}
          onValueChange={pick}
          items={[
            { value: "instagram", label: "Instagram", icon: <PlatformIcon platform="instagram" className="h-3.5 w-3.5" /> },
            { value: "tiktok", label: "TikTok", icon: <PlatformIcon platform="tiktok" className="h-3.5 w-3.5" /> },
            { value: "youtube", label: "YouTube", icon: <PlatformIcon platform="youtube" className="h-3.5 w-3.5" /> },
          ]}
        />
  );
  return pf === "tiktok" ? <TikTokRadar platformTabs={tabs} /> : pf === "youtube" ? <YouTubeRadar platformTabs={tabs} /> : <BrandRadar platformTabs={tabs} />;
}

function BrandRadar({ platformTabs }: { platformTabs?: ReactNode } = {}) {
  const [rows, setRows] = useState<RadarRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, Prof & { why?: string | null }>>({});
  const [knownBrands, setKnownBrands] = useState<{ handles: Set<string>; names: Set<string> }>({ handles: new Set(), names: new Set() });
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [poolUsers, setPoolUsers] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [scanning, setScanning] = useState(false);

  // Filtres
  const [kind, setKind] = useStickyState("sourcing:radar-marques", ["clients", "chauds", "tous"] as const, "clients");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [period, setPeriod] = useState("90");
  const [words, setWords] = useState("");
  const [minF, setMinF] = useState("");
  const [maxF, setMaxF] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState<"nouveau" | "ignore" | "pipeline">("nouveau");
  const [srcF, setSrcF] = useStickyState("sourcing:radar-createurs", ["toutes", "miennes", "scouting", "hors"] as const, "toutes");
  const [q, setQ] = useState("");
  // Créatrices hors agence : en file (citées par une marque vérifiée) et déjà lues.
  const [queue, setQueue] = useState<{ waiting: number; read: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [showUnsure, setShowUnsure] = useState(false);
  const [showKnown, setShowKnown] = useState(false);
  const [dmHandles, setDmHandles] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await supabase.from("ig_radar").select("brand, posts, status, first_seen, last_seen").order("last_seen", { ascending: false }).limit(1000);
      if (!alive) return;
      if (r.error) {
        setMissing(true);
        setRows([]);
        return;
      }
      const list = (r.data as RadarRow[] | null) ?? [];
      setRows(list);
      // Profils des marques et des créateurs cités (abonnés, bio, « est-ce une marque ? »).
      const users = [...new Set(list.flatMap((x) => [x.brand, ...x.posts.map((p) => p.c)]))];
      const prof: Record<string, Prof & { why?: string | null }> = {};
      for (let i = 0; i < users.length; i += 150) {
        const { data } = await supabase.from("ig_profiles").select("username, data, why").in("username", users.slice(i, i + 150));
        for (const p of (data as { username: string; data: Prof | null; why: string | null }[] | null) ?? []) prof[p.username] = { ...(p.data ?? {}), why: p.why };
      }
      const [ct, cr, pl, dm] = await Promise.all([
        supabase.from("contacts").select("brand, instagram"),
        supabase.from("creators").select("name, handle, instagram"),
        supabase.from("creator_pool").select("handle"),
        supabase.from("ig_threads").select("username").not("username", "is", null),
      ]);
      // Déjà en conversation privée avec TTP (page DM Instagram) : mise de côté aussi.
      setDmHandles(new Set(((dm.data as { username: string }[] | null) ?? []).map((x) => x.username)));
      setPoolUsers(new Set(((pl.data as { handle: string | null }[] | null) ?? []).map((x) => cleanUser(x.handle ?? "")).filter(Boolean)));
      const [qw, qr] = await Promise.all([
        supabase.from("ig_profiles").select("username", { count: "exact", head: true }).eq("data->>pending", "true"),
        supabase.from("ig_profiles").select("username", { count: "exact", head: true }).eq("data->>isBrand", "false").not("scanned_at", "is", null),
      ]);
      if (alive) setQueue({ waiting: qw.count ?? 0, read: qr.count ?? 0 });
      if (!alive) return;
      const cts = (ct.data as { brand: string | null; instagram: string | null }[] | null) ?? [];
      setKnownBrands({
        handles: new Set(cts.map((c) => cleanUser(c.instagram ?? "")).filter(Boolean)),
        names: new Set(cts.map((c) => norm(c.brand ?? "").trim()).filter(Boolean)),
      });
      const names: Record<string, string> = {};
      for (const c of (cr.data as { name: string; handle: string | null; instagram: string | null }[] | null) ?? []) {
        for (const h of [c.instagram, c.handle]) if (h && cleanUser(h)) names[cleanUser(h)] = c.name;
      }
      setRosterNames(names);
      setProfiles(prof);
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const runScan = async () => {
    setScanning(true);
    const r = await invokeSourcing<{ creators?: number; discovered?: number; brands?: number; stopped?: string; diag?: { posts: number; withText: number; withAt: number; withName?: number } }>({ mode: "scan" });
    setScanning(false);
    if (r.error) return toast(errorText(r.error));
    const d = r.diag;
    toast(
      `${r.creators ?? 0} créateurs lus${r.discovered ? ` (dont ${r.discovered} hors agence)` : ""} · ${r.brands ?? 0} marques citées` +
        (d && !r.brands ? ` · ${d.posts} posts reçus, ${d.withName ?? 0} citent un compte` : "") +
        (r.stopped ? ` · ${igWhyText(r.stopped)}` : ""),
    );
    setReload((n) => n + 1);
  };

  const setRowStatus = async (brand: string, s: RadarRow["status"]) => {
    const { error } = await supabase.from("ig_radar").update({ status: s }).eq("brand", brand);
    if (error) return toast("Erreur, réessaie");
    setRows((prev) => (prev ? prev.map((r) => (r.brand === brand ? { ...r, status: s } : r)) : prev));
  };
  /** Ajoute la marque au Pipeline (une seule fois, même à plusieurs) et la sort des « à traiter ». */
  const toPipeline = async (r: RadarRow, opts: { stage?: string; silent?: boolean } = {}): Promise<boolean> => {
    const p = profiles[r.brand];
    const name = p?.name?.trim() || `@${r.brand}`;
    const { data: same } = await supabase.from("prospects").select("id").or(`contact.eq."@${r.brand}",brand.ilike."${name.replace(/["\\,()%]/g, " ")}"`).limit(1);
    if (!(same as unknown[] | null)?.length) {
      const { data: top } = await supabase.from("prospects").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
      const created = await dbInsert("prospects", { brand: name, contact: `@${r.brand}`, value: "—", stage: opts.stage ?? "Prospection", tone: "neutral", sort_order: order });
      if (!created) {
        toast("Erreur, réessaie");
        return false;
      }
    }
    await setRowStatus(r.brand, "pipeline");
    if (!opts.silent) toast((same as unknown[] | null)?.length ? "Déjà au Pipeline : retirée des marques à traiter" : "Ajoutée au Pipeline ✓ (page Pipeline)");
    return true;
  };

  const [mailFor, setMailFor] = useState<{ row: RadarRow; post: RadarPost } | null>(null);

  const srcOf = (p: RadarPost): "miennes" | "scouting" | "hors" => (rosterNames[p.c] || p.roster ? "miennes" : poolUsers.has(p.c) ? "scouting" : "hors");
  type Item = { row: RadarRow; posts: RadarPost[]; types: Record<PostType, number>; warm: number; creators: string[]; lastAt: string; known: boolean; prof?: Prof & { why?: string | null } };
  const { list: view, hid, counts, prog } = useMemo(() => {
    const hid = { pending: 0, notBrand: 0, known: 0, filters: 0 };
    const counts = { clients: 0, chauds: 0, tous: 0 };
    const prog = { total: 0, verified: 0 };
    if (!rows) return { list: [] as Item[], hid, counts, prog };
    const since = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
    const tokens = norm(words).split(/[\s,]+/).filter(Boolean);
    const lo = parseCount(minF);
    const hi = parseCount(maxF);
    const town = norm(city.trim());
    const qn = norm(q.trim()).replace(/^@/, "");
    const out: Item[] = [];
    for (const row of rows) {
      if (row.status !== status) continue;
      const prof = profiles[row.brand];
      if (qn && !(row.brand.includes(qn) || norm(prof?.name ?? "").includes(qn))) continue;
      prog.total++;
      if (prof && (prof.why || prof.followers != null)) prog.verified++;
      // « Incertain » : profil pas encore vérifié auprès de Meta, ou compte qui ne ressemble pas à une marque.
      if (!showUnsure && !prof?.isBrand) {
        if (!prof || (!prof.why && prof.followers == null)) hid.pending++;
        else hid.notBrand++;
        continue;
      }
      const known = knownBrands.handles.has(row.brand) || dmHandles.has(row.brand) || (!!prof?.name && knownBrands.names.has(norm(prof.name).trim()));
      if (known && !showKnown) {
        hid.known++;
        continue;
      }
      const base = row.posts.filter((p) => {
        if (srcF !== "toutes" && srcOf(p) !== srcF) return false;
        if (since && Date.parse(p.at) < since) return false;
        const cap = norm(p.cap);
        if (tokens.some((t) => !cap.includes(t))) return false;
        const cp = profiles[p.c];
        const f = cp?.followers ?? 0;
        if ((lo || hi) && !cp) return false;
        if (lo && f < lo) return false;
        if (hi && f > hi) return false;
        if (town && !norm(`${cp?.bio ?? ""}`).includes(town)) return false;
        return true;
      });
      if (!base.length) {
        hid.filters++;
        continue;
      }
      const commercial = base.filter((p) => postType(p) !== "spontane");
      const warmPosts = base.filter((p) => postType(p) === "spontane" && p.roster);
      counts.tous++;
      if (commercial.length) counts.clients++;
      if (warmPosts.length) counts.chauds++;
      const posts = kind === "clients" ? commercial : kind === "chauds" ? warmPosts : base;
      if (!posts.length) continue;
      const types: Record<PostType, number> = { paye: 0, offert: 0, spontane: 0 };
      for (const p of base) types[postType(p)]++;
      out.push({
        row, posts, types, known, prof,
        warm: warmPosts.length,
        creators: [...new Set(posts.map((p) => p.c))],
        lastAt: posts.reduce((m, p) => (p.at > m ? p.at : m), ""),
      });
    }
    const rank = (x: Item) => (x.types.paye * 3 + x.types.offert * 2 + x.warm * 2) * 10 + x.creators.length;
    return { list: out.sort((a, b) => rank(b) - rank(a)), hid, counts, prog };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, profiles, knownBrands, dmHandles, kind, period, words, minF, maxF, city, status, showUnsure, showKnown, srcF, rosterNames, poolUsers, q]);
  const activeFilters = [words.trim(), minF.trim(), maxF.trim(), city.trim()].filter(Boolean).length + (period !== "90" ? 1 : 0);
  const runVerify = async () => {
    setVerifying(true);
    const r = await invokeSourcing<{ verified?: number; left?: number; stopped?: string }>({ mode: "verify" });
    setVerifying(false);
    if (r.error) return toast(errorText(r.error));
    toast(`${r.verified ?? 0} comptes vérifiés${r.left ? ` · ${r.left} restants` : ""}${r.stopped ? ` · ${igWhyText(r.stopped)}` : ""}`);
    setReload((n) => n + 1);
  };
  const pendingNow = prog.total - prog.verified;
  const statusCounts = { nouveau: 0, pipeline: 0, ignore: 0 } as Record<RadarRow["status"], number>;
  for (const r of rows ?? []) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement du radar…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-[22px] bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
        Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic).
      </div>
    );
  }

  const TILES = [
    { v: "clients" as const, icon: Wallet, title: "Clients potentiels", short: "Clients", n: counts.clients, text: "Elles paient ou offrent des produits à des créateurs de ta niche.", on: "border-primary bg-primary/[0.04]", dot: "bg-primary text-primary-foreground" },
    { v: "chauds" as const, icon: Flame, title: "Contacts chauds", short: "Chauds", n: counts.chauds, text: "Tes créateurs en parlent déjà, sans être payés.", on: "border-signal bg-signal/[0.05]", dot: "bg-signal text-white" },
    { v: "tous" as const, icon: Radar, title: "Toutes les marques", short: "Toutes", n: counts.tous, text: "Tout ce que le radar a repéré.", on: "border-foreground/40 bg-panel/60", dot: "bg-foreground text-background" },
  ];
  const toggleRow = (b: string) => setOpenRows((cur) => { const n = new Set(cur); if (n.has(b)) n.delete(b); else n.add(b); return n; });
  const addCreator = async (handle: string, brand: string) => {
    setAdding(handle);
    const { data: top } = await supabase.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const pr = profiles[handle];
    const created = await dbInsert("creator_pool", {
      name: pr?.name?.trim() || `@${handle}`, handle: `@${handle}`, email: pr?.email || null, tag: null,
      note: `Trouvée via le Radar (partenariat avec @${brand})`, sort_order: order,
    });
    setAdding(null);
    if (!created) return toast("Erreur, réessaie");
    setPoolUsers((cur) => new Set([...cur, handle]));
    toast(`@${handle} ajouté au Scouting ✓`);
  };
  const srcTag = (p: RadarPost) =>
    rosterNames[p.c] || p.roster ? { t: "Roster", c: "bg-foreground/[0.07] text-foreground" } : poolUsers.has(p.c) ? { t: "Scouting", c: TONE_SOFT.info } : { t: "Hors agence", c: "bg-surface text-muted-foreground" };

  return (
    <RadarFrame
      platformTabs={platformTabs}
      runNote="Passe toutes les 2 heures"
      running={scanning}
      runLabel={scanning ? "Lecture des posts (1 à 2 min)…" : "Lancer le radar"}
      onRun={() => void runScan()}
      help={
            <HelpTip title="Comment marche le radar ?" align="end">
              <p>Toutes les 2 heures, l'app lit les derniers posts de tes créateurs, de ceux de ton Scouting, et de créateurs hors agence découverts au fil des recherches (ceux que citent les marques du radar). Elle note les marques citées.</p>
              <p>Elle vérifie ensuite chaque nom auprès de Meta pour savoir si c'est bien une marque. Chaque passage s'arrête à 60 % du quota Meta, pour te laisser de la marge.</p>
              <p>« Lancer le radar » le fait tout de suite (1 à 2 minutes).</p>
            </HelpTip>
      }
      status={status}
      onStatus={setStatus}
      counts={statusCounts}
      query={q}
      onQuery={setQ}
      placeholder="Chercher une marque (@ ou nom)"
      filters={
        <>
          <Tabs
            size="sm"
            label="Quel type de marques"
            value={kind}
            onValueChange={(v) => setKind(v as typeof kind)}
            items={TILES.map((t) => ({ value: t.v, label: t.short === "Toutes" ? "Toutes" : t.title, count: t.n }))}
          />
          <Tabs
            size="sm"
            label="Vu chez quels créateurs"
            value={srcF}
            onValueChange={(v) => setSrcF(v as typeof srcF)}
            items={[
              { value: "toutes", label: "Tous" },
              { value: "miennes", label: "Mes créateurs" },
              { value: "scouting", label: "Scouting" },
              { value: "hors", label: "Hors agence" },
            ]}
          />
          <HelpTip title="Hors agence ?">
            <p>Des créateurs que tu ne connais pas encore : ceux trouvés par le Sourcing, et ceux que citent les marques du radar. Le radar lit leurs posts petit à petit et ajoute leurs marques.</p>
            <p>Double intérêt : de nouvelles marques à démarcher, et de nouveaux créateurs à recruter (bouton « + Scouting » sur leurs posts).</p>
          </HelpTip>
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors", filtersOpen || activeFilters ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-border text-foreground hover:bg-rowhover")}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtres{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
        </>
      }
      summary={
        queue && (queue.read > 0 || queue.waiting > 0) ? (
          <span title="Créateurs hors agence : lus par le radar, et en file pour les prochains passages (toutes les 2 heures)">
            Hors agence : {queue.read} lu{queue.read > 1 ? "s" : ""}{queue.waiting > 0 ? ` · ${queue.waiting} en attente` : ""}
          </span>
        ) : undefined
      }
    >
      {filtersOpen && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-[16px] bg-surface p-3">

        <Field label="# ou mots dans le post" className="min-w-[180px] flex-1" help={<><p>Ne garde que les posts qui contiennent TOUS ces mots ou hashtags.</p><p>Exemple : « #running #ad » = les partenariats payés dans le running. « lyon » = les posts qui parlent de Lyon.</p><p>L'app lit le texte sous le post : les # mis en commentaire ne sont pas visibles.</p></>}><input aria-label="Hashtags ou mots" value={words} onChange={(e) => setWords(e.target.value)} placeholder="#running #ad" className={IN} /></Field>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Période
          <Picker size="sm" ariaLabel="Période" className="w-32" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
        </label>
        <Field label="Créateur : abonnés min" help={<p>La taille du créateur qui a fait le post. Utile pour trouver les marques qui travaillent avec des comptes de la taille des tiens.</p>}><input aria-label="Abonnés minimum du créateur" value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="10k" className={cn(IN, "w-28")} /></Field>
        <Field label="max"><input aria-label="Abonnés maximum du créateur" value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="50k" className={cn(IN, "w-24")} /></Field>
        <Field label="Ville du créateur" help={<p>Cherche le mot dans la bio du créateur qui a fait le post (par exemple Lyon).</p>}><input aria-label="Ville du créateur" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lyon" className={cn(IN, "w-28")} /></Field>
        <div className="flex flex-wrap items-center gap-3 pb-2 text-[12px] text-muted-foreground">
          <Check2 label="Déjà en contact" checked={showKnown} onChange={setShowKnown} help={<p>Les marques déjà dans tes Contacts, ou avec qui TTP a déjà une conversation en message privé Instagram, sont cachées pour ne garder que les nouvelles. Coche pour les voir aussi.</p>} />
          <Check2 label="Comptes incertains" checked={showUnsure} onChange={setShowUnsure} help={<p>L'app devine si un @ est une marque (site web, bio, abonnés). Quand elle n'est pas sûre (ami tagué, autre créateur, profil pas encore lu), le compte est caché. Coche pour le voir.</p>} />
        </div>
        </div>
      )}

      {/* Vérification en cours : une barre, une phrase, un bouton */}
      {pendingNow > 0 && (
        <div className="mb-3 flex flex-col gap-3 rounded-[22px] bg-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-1 font-semibold text-foreground">
                Vérification des marques
                <HelpTip title="Vérification des marques">
                  <p>L'app vérifie auprès de Meta que chaque nom trouvé dans les posts est bien une marque. Ça avance tout seul toutes les 2 heures (Meta limite les demandes par heure).</p>
                </HelpTip>
              </span>
              <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{prog.verified}</span> sur {prog.total}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-field">
              <div className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${Math.max(2, Math.round((prog.verified / Math.max(1, prog.total)) * 100))}%` }} />
            </div>
          </div>
          <button type="button" onClick={() => void runVerify()} disabled={verifying} className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {verifying ? <Spin size={14} /> : <Check className="h-3.5 w-3.5" />} {verifying ? "Vérification…" : "Vérifier la suite"}
          </button>
        </div>
      )}

      {view.length === 0 ? (
        <div className="rounded-[22px] bg-surface px-6 py-10 text-center text-[13px] text-muted-foreground">
          {rows.length === 0
            ? "Le radar n'a encore rien lu. Il passe toutes les 2 heures ; tu peux aussi « Lancer le radar » maintenant."
            : pendingNow > 0
              ? "Les marques apparaissent ici au fur et à mesure qu'elles sont vérifiées."
              : srcF === "hors"
                ? "Aucune marque vue chez des créateurs hors agence pour l'instant : le radar en lit de nouvelles toutes les 2 heures."
                : kind === "chauds" ? "Aucune marque citée spontanément par tes créateurs pour l'instant." : "Aucune marque avec ces réglages."}
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-[22px] bg-surface p-1.5">
          {view.map(({ row, posts, types, warm, creators, lastAt, known, prof }) => {
            const open = openRows.has(row.brand);
            const list = dedupe(posts);
            const verdict = types.paye || types.offert ? { t: "Client potentiel", c: "bg-primary/10 text-primary" } : warm ? { t: "Contact chaud", c: TONE_SOFT.ok } : { t: "Citée", c: TONE_SOFT.closed };
            const unsure = !prof?.isBrand;
            const summary = [
              types.paye ? `${types.paye} payé${types.paye > 1 ? "s" : ""}` : "",
              types.offert ? `${types.offert} offert${types.offert > 1 ? "s" : ""} / code` : "",
              warm ? `${warm} spontané${warm > 1 ? "s" : ""} chez tes créateurs` : "",
            ].filter(Boolean).join(" · ");
            return (
              <div key={row.brand} className="rounded-[16px] px-3 py-3 transition-colors hover:bg-rowhover">
                <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Pic src={prof?.picture} name={prof?.name || row.brand} size={42} square />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[14px] font-semibold text-foreground">{prof?.name || `@${row.brand}`}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", verdict.c)}>{verdict.t}</span>
                        {unsure && <span title="L'app n'est pas sûre que ce compte soit une marque : vérifie avant d'écrire" className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", TONE_SOFT.wait)}>À confirmer</span>}
                        {known && <span className="rounded-full bg-field px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{dmHandles.has(row.brand) ? "Déjà en DM" : "Déjà en contact"}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <a href={igLink(row.brand)} target="_blank" rel="noreferrer" className="text-primary hover:underline">@{row.brand}</a>
                        {prof?.followers != null && <span>· {fmtCompact(prof.followers)} abonnés</span>}
                        {prof?.website && <a href={safeHref(prof.website)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">· <Globe className="h-3 w-3" />{domainOf(prof.website)}</a>}
                        {prof?.email && <span className="flex items-center gap-1">· <Mail className="h-3 w-3" />{prof.email}</span>}
                      </div>
                      <div className="mt-1 text-[11px] text-faint">
                        {summary && <span className="font-medium text-muted-foreground">{summary}</span>}
                        {summary && " · "}vue chez {creators.slice(0, 3).map((c) => `@${c}`).join(", ")}{creators.length > 3 ? ` +${creators.length - 3}` : ""} · {fmtDay(lastAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[54px] lg:pl-0">
                    <button type="button" onClick={() => toggleRow(row.brand)} className="flex items-center gap-1 rounded-full bg-field px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover" aria-expanded={open}>
                      {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {open ? "Masquer" : `Voir ${list.length} post${list.length > 1 ? "s" : ""}`}
                    </button>
                    {row.status !== "pipeline" ? (
                      <button type="button" onClick={() => void toPipeline(row)} className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                        <Plus className="h-3.5 w-3.5" /> Pipeline
                      </button>
                    ) : (
                      <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium", TONE_SOFT.ok)}><Check className="h-3.5 w-3.5" /> Au Pipeline</span>
                    )}
                    <button type="button" onClick={() => setMailFor({ row, post: posts.find((p) => p.roster && postType(p) === "spontane") ?? posts[0] })} className="flex items-center gap-1 rounded-full bg-field px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover">
                      <Send className="h-3.5 w-3.5" /> Écrire
                    </button>
                    {row.status === "nouveau" ? (
                      <button type="button" onClick={() => void setRowStatus(row.brand, "ignore").then(() => toast("Retirée · retrouve-la dans « Pas pertinentes »"))} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                        <EyeOff className="h-3.5 w-3.5" /> Écarter
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setRowStatus(row.brand, "nouveau")} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                        <RotateCcw className="h-3.5 w-3.5" /> Remettre
                      </button>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="mt-3 flex flex-col gap-1.5 lg:pl-[54px]">
                    {list.map((p) => {
                      const tp = TYPE_META[postType(p)];
                      const src = srcTag(p);
                      return (
                        <div key={p.url || `${p.c}${p.at}`} className="rounded-[12px] bg-panel px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <a href={igLink(p.c)} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline">@{p.c}</a>
                            <span className={cn("rounded px-1.5 text-[9px] font-semibold tracking-wide", src.c)}>{src.t}</span>
                            {profiles[p.c]?.followers != null && <span className="text-faint">{fmtCompact(profiles[p.c]?.followers ?? 0)}</span>}
                            <span className="text-faint">{fmtDay(p.at)}{p.n > 1 ? ` · ${p.n} posts pareils` : ""}</span>
                            {srcOf(p) === "hors" && (
                              <button type="button" onClick={() => void addCreator(p.c, row.brand)} disabled={adding === p.c} className="flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                                {adding === p.c ? <Spin size={12} /> : <Plus className="h-3 w-3" />} Scouting
                              </button>
                            )}
                            <span title={tp.tip} className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold", tp.cls)}>{tp.label}</span>
                            {p.url && <a href={p.url} target="_blank" rel="noreferrer" title="Ouvrir le post" className="text-faint hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                          </div>
                          <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground"><Excerpt text={p.cap || "Sans légende"} brand={row.brand} name={prof?.name} /></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Le reste : masqué par choix, un seul lien discret */}
      {(hid.notBrand + hid.known > 0 || showUnsure || showKnown) && (
        <div className="mt-3 text-center text-[12px] text-faint">
          {showUnsure || showKnown ? (
            <button type="button" onClick={() => { setShowUnsure(false); setShowKnown(false); }} className="font-medium text-primary hover:underline">
              Masquer ces comptes
            </button>
          ) : (
            <button type="button" onClick={() => { setShowUnsure(true); setShowKnown(true); }} title="Pas sûres d'être des marques, ou déjà en contact" className="hover:text-foreground">
              {hid.notBrand + hid.known} autre{hid.notBrand + hid.known > 1 ? "s" : ""} masquée{hid.notBrand + hid.known > 1 ? "s" : ""} · <span className="font-medium text-primary">Afficher</span>
            </button>
          )}
          {hid.filters > 0 && <span> · {hid.filters} hors de tes filtres</span>}
        </div>
      )}

      {mailFor && (() => {
        const { row, post } = mailFor;
        const prof = profiles[row.brand];
        const brandName = prof?.name?.trim() || `@${row.brand}`;
        const rn = rosterNames[post.c];
        const who = rn ? `${titleCase(rn)} (@${post.c})` : `@${post.c}`;
        return (
          <OutreachComposer
            title={`Contacter ${brandName}`}
            to={prof?.email}
            box="partnerships"
            instagram={row.brand}
            contactName={brandName}
            subject={`TTP Creators × ${brandName}`}
            body={post.roster && !post.paid
              ? `Bonjour,\n\n${who}, que nous représentons chez TTP Creators, parle déjà de ${brandName} spontanément : ${post.url}\n\nUne collaboration officielle aurait du sens : sa communauté connaît et apprécie déjà votre marque.\n\nJe vous envoie son media kit ?\n\nBelle journée,`
              : `Bonjour,\n\nJ'ai vu votre collaboration avec @${post.c} : ${post.url}\n\nChez TTP Creators, nous représentons des créateurs qui correspondent à votre univers et pourraient porter vos prochaines campagnes.\n\nJe vous envoie notre sélection ?\n\nBelle journée,`}
            onSent={() => void toPipeline(row, { stage: "Contact", silent: true }).then((ok) => ok && toast("La marque passe au Pipeline (étape Contact) : personne ne la recontactera"))}
            onClose={() => setMailFor(null)}
          />
        );
      })()}
    </RadarFrame>
  );
}

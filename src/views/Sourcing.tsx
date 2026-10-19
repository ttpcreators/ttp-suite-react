import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Picker } from "@/components/ui/form";
import {
  AtSign, Binoculars, Bookmark, BookOpen, Check, ChevronDown, ChevronUp, ExternalLink, Flame, Globe, Loader2, Mail, PhoneOutgoing, Plus, Radar, Search, Send, SlidersHorizontal, Users, Wallet, EyeOff, RotateCcw, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { HelpTip } from "@/components/ui/help-tip";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { dbInsert, dbUpdate } from "@/lib/db";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, fmtEr, fmtPerWeek, igWhyText, noteQuota } from "@/lib/instagram";
import { MetaQuotaBadge } from "@/components/MetaQuotaBadge";
import { OutreachComposer } from "@/components/OutreachComposer";
import { SourcingGuide } from "@/components/SourcingGuide";
import { RivalWatch } from "@/components/RivalWatch";
import { RadarFrame } from "@/components/RadarFrame";
import { TikTokRadar } from "@/components/TikTokRadar";
import { YouTubeRadar } from "@/components/YouTubeRadar";

/**
 * SOURCING (agence) — deux outils, toujours via l'outil officiel de Meta (comptes pro) :
 *  • « Trouver des créatrices » : les @ cités par une marque dans ses derniers posts
 *    (= les créatrices avec qui elle travaille), ou une liste de @ collée ; chiffres,
 *    filtres, puis « Ajouter au Scouting ».
 *  • « Radar à marques » : chaque nuit (fonction ig-sourcing), les marques citées par
 *    les créatrices du roster et du Scouting. Partenariats payés = clients potentiels ;
 *    citées gratuitement par tes créatrices = contacts chauds. → Pipeline / mail.
 *  • « Agences concurrentes » : croissance, créatrices mises en avant et marques des
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

/** Photo de profil Instagram (lien Meta temporaire), initiales en dessous. */
function Pic({ src, name, size = 40, square }: { src?: string; name: string; size?: number; square?: boolean }) {
  const [ok, setOk] = useState(true);
  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-panel text-[11px] font-bold text-foreground", square ? "rounded-xl" : "rounded-full")} style={{ width: size, height: size }}>
      {initials(name || "?")}
      {src && ok && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} className="absolute inset-0 h-full w-full bg-panel object-cover" />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 lg:min-w-[64px]">
      <div className="truncate text-[10px] text-faint">{label}</div>
      <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">{value}</div>
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

const TOOLS = [
  {
    v: "createurs" as const, icon: Users, title: "Trouver des créateurs", goal: "Pour recruter",
    text: "Des profils à recruter, avec chiffres et email.",
  },
  {
    v: "radar" as const, icon: Radar, title: "Radar à marques", goal: "Pour trouver des clients",
    text: "Les marques qui paient des créateurs : tes futurs clients.",
  },
  {
    v: "concurrents" as const, icon: Binoculars, title: "Agences concurrentes", goal: "Pour garder une longueur d'avance",
    text: "Leur croissance, leurs créateurs, leurs marques.",
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
  // Mode d'emploi : ouvert tout seul à la première visite (sur cet appareil).
  const [guide, setGuide] = useState(() => {
    try {
      return !localStorage.getItem("ttp:sourcing-guide-v1");
    } catch {
      return false;
    }
  });
  const closeGuide = () => {
    setGuide(false);
    try {
      localStorage.setItem("ttp:sourcing-guide-v1", "1");
    } catch {
      /* stockage indisponible */
    }
  };
  const pick = (v: string) => {
    const t = toolOf(v);
    setTab(t);
    try {
      localStorage.setItem("ttp:sourcing-tab", t);
    } catch {
      /* stockage indisponible */
    }
  };
  return (
    <>
      <PageHeaderRow>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setGuide(true)} className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            <BookOpen className="h-3.5 w-3.5 text-primary" /> Mode d'emploi
          </button>
          <MetaQuotaBadge />
        </div>
      </PageHeaderRow>
      {guide && <SourcingGuide onClose={closeGuide} />}
      <div role="tablist" aria-label="Outil de sourcing" className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {TOOLS.map((t) => {
          const on = tab === t.v;
          const Icon = t.icon;
          return (
            <button
              key={t.v}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => pick(t.v)}
              className={cn("flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors", on ? "border-primary bg-primary/[0.04]" : "border-border bg-surface hover:bg-rowhover")}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", on ? "bg-primary text-primary-foreground" : "bg-panel text-muted-foreground")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14px] font-semibold text-foreground">{t.title}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", on ? "bg-primary/10 text-primary" : "bg-panel text-muted-foreground")}>{t.goal}</span>
                </span>
                <span className={cn("mt-1 text-[12px] leading-snug text-muted-foreground", on ? "block" : "hidden sm:block")}>{t.text}</span>
              </span>
            </button>
          );
        })}
      </div>
      {tab === "createurs" ? <CreatorFinder /> : tab === "radar" ? <RadarTool /> : <RivalWatch />}
    </>
  );
}

// ═════════════════════════ Trouver des créatrices ═════════════════════════
type LastSearch = {
  label: string; at: string; mode: "marque" | "similaire" | "liste" | "yt-search" | "yt-brand" | "yt-list"; platform?: "instagram" | "youtube";
  brand?: Prof & { username: string }; creator?: Prof & { username: string }; brands?: string[]; results: Candidate[];
};
const LAST_KEY = "ttp:sourcing-last";
type PoolInfo = { id: string; last_contacted: string | null };

// ── Tri des comptes trouvés ──────────────────────────────────────────────────
// Chaque compte trouvé se range dans une section : « À trier » (pas encore vu), « Scouting »
// (gardé pour plus tard), « À contacter », « Pas intéressés ». Scouting et À contacter =
// une fiche du Scouting (creator_pool) avec son statut (clé d'état `poolTracking`, la même
// que la page Scouting). « Pas intéressé » sur un compte hors Scouting = clé `sourcingRejects`
// (il ne revient plus dans « À trier » aux recherches suivantes, on peut le remettre).
type ScoutStatus = "observation" | "contacter" | "discussion" | "signe" | "ecarte";
type PoolTracking = Record<string, { status?: ScoutStatus } & Record<string, unknown>>;
type Rejects = Record<string, { at: string; name?: string }>;
type Section = "trier" | "scouting" | "contacter" | "pas" | "roster";
const SCOUT_LABEL: Record<ScoutStatus, string> = { observation: "En observation", contacter: "À contacter", discussion: "En discussion", signe: "Signé", ecarte: "Pas intéressé" };

/** Taux d'engagement « normal » selon la taille du compte (repère public). */
const erRef = (f: number) => (f < 10_000 ? 5 : f < 50_000 ? 3.5 : f < 200_000 ? 2.5 : f < 1_000_000 ? 1.8 : 1.2);
/**
 * Score « Potentiel » sur 100 : engagement par rapport à sa taille (40), rythme (15),
 * déjà payée par des marques (15), email trouvé (10), pas d'agence (10), active (10),
 * moins 15 par signal d'alerte. Une aide au tri, pas un verdict.
 */
function potential(d: Prof): { score: number; flags: string[] } {
  const f = d.followers ?? 0;
  const ref = erRef(f);
  const flags: string[] = [];
  let s = 0;
  if (d.er != null) s += Math.min(40, (d.er / ref) * 30);
  s += Math.min(15, (d.perWeek ?? 0) * 5);
  if (d.deals?.length) s += 15;
  if (d.email) s += 10;
  if (!d.agency) s += 10;
  const quiet = d.lastPost ? (Date.now() - Date.parse(d.lastPost)) / 86400000 : 999;
  if (quiet < 14) s += 10;
  if (d.er != null && d.er < ref * 0.25) flags.push("Engagement très bas pour sa taille");
  if ((d.following ?? 0) > f && f < 50_000) flags.push("Suit plus de comptes qu'elle n'a d'abonnés");
  if (quiet > 60 && quiet < 999) flags.push("Rien publié depuis 2 mois");
  s -= flags.length * 15;
  return { score: Math.max(0, Math.min(100, Math.round(s))), flags };
}
/**
 * Score « Potentiel » d'une chaîne YouTube : vues moyennes par rapport aux abonnés (30),
 * engagement des vidéos (10), rythme (15), déjà sponsorisée (15), email (10), pas
 * d'agence (10), active ce mois-ci (10), moins 15 par signal d'alerte.
 */
function potentialYt(d: Prof): { score: number; flags: string[] } {
  const f = d.followers ?? 0;
  const flags: string[] = [];
  let s = 0;
  const vr = d.avgViews != null && f > 0 ? d.avgViews / f : null;
  if (vr != null) s += Math.min(30, (vr / 0.25) * 22);
  else if (d.avgViews) s += 15; // abonnés masqués : on juge sur les vues seules
  if (d.er != null) s += Math.min(10, (d.er / 4) * 8);
  s += Math.min(15, (d.perWeek ?? 0) * 10);
  if (d.deals?.length || d.sponsored) s += 15;
  if (d.email) s += 10;
  if (!d.agency) s += 10;
  const quiet = d.lastPost ? (Date.now() - Date.parse(d.lastPost)) / 86400000 : 999;
  if (quiet < 30) s += 10;
  if (vr != null && vr < 0.02) flags.push("Très peu de vues pour sa taille");
  if (quiet > 90 && quiet < 999) flags.push("Aucune vidéo depuis 3 mois");
  s -= flags.length * 15;
  return { score: Math.max(0, Math.min(100, Math.round(s))), flags };
}
const scoreOf = (d: Prof) => (d.platform === "youtube" ? potentialYt(d) : potential(d));
const firstName = (d: Prof | null, user: string) => (d?.name?.trim().split(/\s+/)[0] ?? "") || user;
const REGIONS = [["FR", "France"], ["BE", "Belgique"], ["CH", "Suisse"], ["CA", "Canada"], ["GB", "Royaume-Uni"], ["US", "États-Unis"]] as const;
const ytErr = (e?: string) =>
  e === "youtube_non_configure" ? "YouTube n'est pas encore relié (clé YouTube à ajouter)."
    : e === "migration_manquante" ? "Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic)."
      : e === "recherche_vide" ? "Tape un thème ou une marque."
        : e === "quota_youtube" ? "Quota YouTube du jour atteint : ça repart demain."
          : "YouTube n'a pas répondu, réessaie.";
/** Clé d'une créatrice dans le Scouting : @ Instagram, ou « yt:<handle> » pour une chaîne YouTube. */
const poolKey = (handle: string) => (/youtube\.com|youtu\.be/i.test(handle) ? `yt:${(/@([\w.-]+)/.exec(handle)?.[1] ?? handle).toLowerCase()}` : cleanUser(handle));

function CreatorFinder() {
  const [source, setSource] = useState<"marque" | "similaire" | "liste">("marque");
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
  const keep = (s: LastSearch) => {
    const p = s.platform === "youtube" ? "youtube" : "instagram";
    setLastBy((m) => ({ ...m, [p]: s }));
    setSection("trier"); // nouvelle recherche : on repart des comptes à trier
    try {
      localStorage.setItem(lastKey(p), JSON.stringify(s));
    } catch {
      /* stockage plein ou indisponible */
    }
  };
  // YouTube : thème, marque ou liste de chaînes ; pays ; quota du jour.
  const [ytSource, setYtSource] = useState<"search" | "brand" | "list">("search");
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

  // Déjà connues : Scouting (avec date de contact) + roster.
  const [pool, setPool] = useState<Map<string, PoolInfo>>(new Map());
  const [roster, setRoster] = useState<{ user: string; name: string }[]>([]);
  const [maxOrder, setMaxOrder] = useState(0);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      supabase.from("creator_pool").select("id, handle, sort_order, last_contacted"),
      supabase.from("creators").select("name, handle, platform, instagram, status"),
    ]).then(([p, c]) => {
      if (!alive) return;
      const pr = (p.data as { id: string; handle: string | null; sort_order: number | null; last_contacted: string | null }[] | null) ?? [];
      const cr = (c.data as { name: string; handle: string | null; platform: string | null; instagram: string | null; status: string | null }[] | null) ?? [];
      setPool(new Map(pr.filter((r) => poolKey(r.handle ?? "")).map((r) => [poolKey(r.handle ?? ""), { id: r.id, last_contacted: r.last_contacted }])));
      setMaxOrder(pr.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0));
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
  /** Fiche Scouting du compte (créée au besoin) : son id, ou null en cas d'erreur. */
  const ensurePool = async (c: Candidate, contacted?: boolean): Promise<string | null> => {
    const now = new Date().toISOString();
    const yt = c.data?.platform === "youtube";
    const known = pool.get(keyOf(c));
    if (known) {
      if (!contacted) return known.id;
      const ok = await dbUpdate("creator_pool", known.id, { last_contacted: now });
      if (ok) setPool((m) => new Map(m).set(keyOf(c), { ...known, last_contacted: now }));
      return ok ? known.id : null;
    }
    const origin = last?.mode === "marque" && last.brand ? ` (citée par @${last.brand.username})` : last?.mode === "similaire" && last.creator ? ` (proche de @${last.creator.username})` : "";
    const created = await dbInsert("creator_pool", {
      name: c.data?.name?.trim() || `@${c.username}`,
      handle: yt ? c.data?.url ?? `https://www.youtube.com/@${c.username}` : `@${c.username}`,
      email: c.data?.email || null,
      tag: yt ? "YouTube" : null,
      note: yt ? `Trouvée via le Sourcing YouTube (${last?.label ?? ""})` : `Trouvée via le Sourcing${origin}`,
      sort_order: maxOrder + 1,
      ...(contacted ? { last_contacted: now } : {}),
    });
    if (!created) return null;
    setMaxOrder((n) => n + 1);
    setPool((m) => new Map(m).set(keyOf(c), { id: String(created.id), last_contacted: contacted ? now : null }));
    return String(created.id);
  };
  const toScouting = async (c: Candidate, contacted?: boolean): Promise<boolean> => !!(await ensurePool(c, contacted));
  const [contact, setContact] = useState<Candidate | null>(null);

  // Tri : statuts du Scouting + comptes écartés (partagés par l'équipe, état de l'app).
  const { data: trackData } = useAppState<PoolTracking>((st: AppState) => (st["poolTracking"] as PoolTracking) ?? {});
  const [trackLocal, setTrackLocal] = useState<PoolTracking | null>(null);
  const tracking = trackLocal ?? trackData ?? {};
  const { data: rejData } = useAppState<Rejects>((st: AppState) => (st["sourcingRejects"] as Rejects) ?? {});
  const [rejLocal, setRejLocal] = useState<Rejects | null>(null);
  const rejects = rejLocal ?? rejData ?? {};
  /** Lit la valeur fraîche, applique `fn`, affiche tout de suite, puis enregistre. */
  const saveKey = async <T,>(key: string, fn: (cur: T) => T, setLocal: (v: T) => void): Promise<boolean> => {
    try {
      invalidateAppState();
      const next = fn(((await getAppState())[key] as T) ?? ({} as T));
      setLocal(next);
      return await saveAppStateKey(key, next);
    } catch {
      return false;
    }
  };
  const sectionOf = (c: Candidate): Section => {
    const k = keyOf(c);
    if (rosterUsers.has(k)) return "roster";
    const inPool = pool.get(k);
    if (inPool) {
      const st = tracking[inPool.id]?.status ?? "observation";
      return st === "contacter" ? "contacter" : st === "ecarte" ? "pas" : "scouting";
    }
    return rejects[k] ? "pas" : "trier";
  };
  const [section, setSection] = useState<Section>("trier");
  /** Range un compte : Scouting (en observation), À contacter, ou Pas intéressé. */
  const triage = async (c: Candidate, to: "scouting" | "contacter" | "pas") => {
    const k = keyOf(c);
    const who = c.data?.platform === "youtube" ? c.data?.name || `@${c.username}` : `@${c.username}`;
    setAdding(c.username);
    let ok: boolean;
    if (to === "pas" && !pool.get(k)) {
      ok = await saveKey<Rejects>("sourcingRejects", (cur) => ({ ...cur, [k]: { at: new Date().toISOString(), name: who } }), setRejLocal);
    } else {
      const id = await ensurePool(c);
      ok = !!id;
      if (id) {
        const status: ScoutStatus = to === "contacter" ? "contacter" : to === "pas" ? "ecarte" : "observation";
        ok = await saveKey<PoolTracking>("poolTracking", (cur) => ({ ...cur, [id]: { ...(cur[id] ?? {}), status } }), setTrackLocal);
        if (ok && rejects[k]) await saveKey<Rejects>("sourcingRejects", (cur) => Object.fromEntries(Object.entries(cur).filter(([x]) => x !== k)), setRejLocal);
      }
    }
    setAdding(null);
    toast(ok ? `${who} → ${to === "scouting" ? "Scouting" : to === "contacter" ? "À contacter" : "Pas intéressés"} ✓` : "Erreur, réessaie");
  };
  /** Remet un compte écarté (hors Scouting) dans « À trier ». */
  const untriage = async (c: Candidate) => {
    const k = keyOf(c);
    const ok = await saveKey<Rejects>("sourcingRejects", (cur) => Object.fromEntries(Object.entries(cur).filter(([x]) => x !== k)), setRejLocal);
    toast(ok ? "Remis dans « À trier »" : "Erreur, réessaie");
  };

  const scored = useMemo(() => (last?.results ?? []).map((c) => ({ c, p: c.data ? scoreOf(c.data) : { score: 0, flags: [] as string[] } })), [last]);
  const shown = useMemo(() => {
    const lo = parseCount(minF);
    const hi = parseCount(maxF);
    const er = Number(minEr.replace(",", ".")) || 0;
    const word = norm(bioWord.trim());
    const list = scored.filter(({ c }) => {
      const d = c.data;
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
  }, [scored, minF, maxF, minEr, bioWord, emailF, agencyF, showOthers, sort]);
  const hidden = (last?.results.length ?? 0) - shown.length;
  const bySection = { trier: 0, scouting: 0, contacter: 0, pas: 0, roster: 0 } as Record<Section, number>;
  for (const x of shown) bySection[sectionOf(x.c)]++;
  const visible = shown.filter((x) => sectionOf(x.c) === section);

  const SOURCES = [
    { value: "marque", label: "Depuis une marque" },
    { value: "similaire", label: "Comme un créateur" },
    { value: "liste", label: "Liste de @" },
  ];
  const runBtn = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} {label}
    </button>
  );

  return (
    <div>
      {/* Point de départ */}
      <div className="mb-3 rounded-2xl border border-border bg-surface p-4">
        {/* Réseau */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
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
          {isYt && ytQuota && (
            <span className="text-[11px] text-faint" title="Google offre 10 000 unités par jour : une recherche par thème ou par marque en coûte environ 150, une chaîne de la liste environ 3">
              Quota YouTube du jour : <span className={cn("font-semibold", ytQuota.used / ytQuota.limit > 0.85 ? "text-dangertext" : "text-foreground")}>{ytQuota.used.toLocaleString("fr-FR")}</span> / {ytQuota.limit.toLocaleString("fr-FR")}
            </span>
          )}
        </div>
        {isYt ? (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Tabs
                size="sm"
                wrap
                label="Point de départ YouTube"
                value={ytSource}
                onValueChange={(v) => setYtSource(v as typeof ytSource)}
                items={[
                  { value: "search", label: "Par thème" },
                  { value: "brand", label: "Depuis une marque" },
                  { value: "list", label: "Liste de chaînes" },
                ]}
              />
              <HelpTip title="Quelle différence ?">
                <p><span className="font-medium text-foreground">Par thème</span> : tu tapes un sujet (« fitness lyon », « maman bébé », « recettes healthy ») et un pays : YouTube te donne les chaînes qui en parlent. Impossible sur Instagram, possible ici.</p>
                <p><span className="font-medium text-foreground">Depuis une marque</span> : les chaînes qui ont fait des vidéos sur cette marque (tests, sponsors, avis).</p>
                <p><span className="font-medium text-foreground">Liste de chaînes</span> : tu colles des @ ou des liens YouTube pour voir leurs chiffres.</p>
              </HelpTip>
            </div>
            {ytSource === "list" ? (
              <div className="flex flex-col gap-2">
                <textarea aria-label="Liste de chaînes" value={ytList} onChange={(e) => setYtList(e.target.value)} rows={4} placeholder={"@lea.fit\nyoutube.com/@camilleyoga\nyoutube.com/channel/UC…"} className={cn(IN, "resize-y text-[13px]")} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-faint">Un @ ou un lien par ligne. Environ 3 unités YouTube par chaîne.</span>
                  {runBtn("Analyser", () => void runYt())}
                </div>
              </div>
            ) : (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void runYt(); }}>
                <input aria-label={ytSource === "search" ? "Thème" : "Marque"} value={ytQ} onChange={(e) => setYtQ(e.target.value)} placeholder={ytSource === "search" ? "fitness lyon, maman bébé, recettes healthy…" : "nom de la marque (ex : gymshark)"} className={cn(IN, "min-w-[200px] flex-1 py-2 text-[13px]")} />
                <Picker size="sm" ariaLabel="Pays" className="w-36" value={ytRegion} onChange={setYtRegion} options={REGIONS.map(([v, l]) => ({ value: v, label: l }))} />
                {runBtn(ytSource === "search" ? "Trouver des chaînes" : "Trouver ses créateurs", () => void runYt())}
              </form>
            )}
          </div>
        ) : (
        <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs size="sm" wrap label="Point de départ" value={source} onValueChange={(v) => setSource(v as typeof source)} items={SOURCES} />
          <HelpTip title="Quelle différence ?">
            <p><span className="font-medium text-foreground">Depuis une marque</span> : l'app lit les 50 derniers posts de la marque et liste les @ qu'elle cite. Ce sont souvent les créateurs avec qui elle a travaillé.</p>
            <p><span className="font-medium text-foreground">Comme un créateur</span> : tu choisis un créateur (un des tiens, par exemple). L'app regarde avec quelles marques il travaille, puis quels autres créateurs travaillent avec ces mêmes marques. Plus ils en partagent, plus ils lui ressemblent.</p>
            <p><span className="font-medium text-foreground">Liste de @</span> : tu colles des @ trouvés ailleurs pour voir tous leurs chiffres d'un coup.</p>
          </HelpTip>
        </div>
        {source === "marque" && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void runBrand(); }}>
            <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary">
              <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
              <input aria-label="@ de la marque" value={brandIn} onChange={(e) => setBrandIn(e.target.value)} placeholder="gymshark" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
            </div>
            {runBtn("Trouver ses créateurs", () => void runBrand())}
          </form>
        )}
        {source === "similaire" && (
          <div className="flex flex-col gap-2.5">
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void runSimilar(); }}>
              <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary">
                <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
                <input aria-label="@ du créateur" value={creatorIn} onChange={(e) => setCreatorIn(e.target.value)} placeholder="un créateur que tu aimes" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
              </div>
              {runBtn("Trouver des profils proches", () => void runSimilar())}
            </form>
            {roster.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                Tes créateurs :
                {roster.slice(0, 12).map((r) => (
                  <button key={r.user} type="button" disabled={!!busy} onClick={() => void runSimilar(r.user)} className="rounded-full border border-border px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                    {titleCase(r.name)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {source === "liste" && (
          <div className="flex flex-col gap-2">
            <textarea aria-label="Liste de @" value={listIn} onChange={(e) => setListIn(e.target.value)} rows={4} placeholder={"@lea.fit\n@ines.run\ninstagram.com/camille.yoga"} className={cn(IN, "resize-y text-[13px]")} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-faint">Un @ par ligne (ou des liens Instagram). 1 demande Meta par @.</span>
              {runBtn("Analyser", () => void runList())}
            </div>
          </div>
        )}
        </>
        )}
        {busy && <div className="mt-2 text-[12px] text-muted-foreground">{busy}</div>}
      </div>

      {last && (
        <>
          {/* Filtres */}
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">
            <Field label="Abonnés min" help={<p>Tu peux écrire 10k, 10 000 ou 1,2M.</p>}><input aria-label="Abonnés minimum" value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="10k" className={cn(IN, "w-24")} /></Field>
            <Field label="Abonnés max"><input aria-label="Abonnés maximum" value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="50k" className={cn(IN, "w-24")} /></Field>
            <Field label="Engagement min (%)" help={<><p>Likes + commentaires moyens de ses 12 derniers posts, divisés par ses abonnés.</p><p>Repère : de 1 à 3 % c'est la moyenne, au-dessus de 3 % c'est bon. Les petits comptes ont souvent un taux plus haut.</p></>}><input aria-label="Engagement minimum" value={minEr} onChange={(e) => setMinEr(e.target.value)} placeholder="2" inputMode="decimal" className={cn(IN, "w-24")} /></Field>
            <Field label="Mot dans la bio" className="min-w-[140px] flex-1" help={<p>Pour cibler une ville (Lyon), une niche (running, maman, vegan) ou une langue. L'app cherche le mot dans la bio et le nom.</p>}><input aria-label="Mot dans la bio" value={bioWord} onChange={(e) => setBioWord(e.target.value)} placeholder="Lyon, running, maman…" className={IN} /></Field>
            <Field label="Email" help={<p>L'app cherche un email dans la bio, puis sur le lien du créateur (Linktree, son site). « Avec email » : tu peux lui écrire tout de suite depuis l'app.</p>}>
              <Picker size="sm" ariaLabel="Email" className="w-36" value={emailF} onChange={(v) => setEmailF(v as typeof emailF)}
                options={[{ value: "tous", label: "Tous" }, { value: "avec", label: "Avec email" }, { value: "sans", label: "Sans email" }]} />
            </Field>
            <Field label="Agence" help={<><p>L'app cherche dans la bio et sur le lien des indices comme « management », « agence », « représentée par », « booking », ou un email d'agence.</p><p>C'est un indice, pas une certitude : vérifie avant d'écrire.</p></>}>
              <Picker size="sm" ariaLabel="Agence" className="w-40" value={agencyF} onChange={(v) => setAgencyF(v as typeof agencyF)}
                options={[{ value: "toutes", label: "Toutes" }, { value: "sans", label: "Sans agence" }, { value: "avec", label: "Déjà en agence" }]} />
            </Field>
            <Field label="Trier par">
              <Picker size="sm" ariaLabel="Trier par" className="w-44" value={sort} onChange={(v) => setSort(v as typeof sort)}
                options={[{ value: "score", label: "Potentiel" }, { value: "followers", label: "Abonnés" }, { value: "er", label: "Engagement" },
                  ...(last.mode !== "liste" && last.mode !== "yt-list" ? [{ value: "count", label: last.mode === "similaire" ? "Marques en commun" : last.mode === "yt-brand" ? "Vidéos sur la marque" : last.mode === "yt-search" ? "Pertinence" : "Citations" }] : [])]} />
            </Field>
            <div className="pb-2 text-[12px] text-muted-foreground">
              <Check2 label="Comptes perso, marques, introuvables" checked={showOthers} onChange={setShowOthers} help={<p>Cachés par défaut : les comptes perso (Meta ne donne pas leurs chiffres), les marques citées, et les @ introuvables. Coche pour les voir.</p>} />
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-muted-foreground">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground">{last.label.replace(/^Créatrices citées/, "Créateurs cités")}</span> · {shown.length} profil{shown.length > 1 ? "s" : ""}
              {shown.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}· {shown.filter((x) => x.p.score >= 70).length} pépite{shown.filter((x) => x.p.score >= 70).length > 1 ? "s" : ""} · {shown.filter((x) => x.c.data?.email).length} avec email · {shown.filter((x) => !x.c.data?.agency).length} sans agence
                </span>
              )}
              {hidden > 0 && <span className="text-faint">({hidden} masqué{hidden > 1 ? "s" : ""})</span>}
              {last.mode === "similaire" && !!last.brands?.length && <span className="text-faint">· via {last.brands.slice(0, 4).map((b) => `@${b}`).join(", ")}</span>}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-faint">
              {fmtAgo(last.at)}
              <HelpTip title="Le score « Potentiel »" align="end">
                <p>Une note sur 100 pour trier vite : engagement par rapport à sa taille (40), rythme de publication (15), déjà payée par des marques (15), email trouvé (10), pas d'agence (10), active ces 2 dernières semaines (10).</p>
                <p>Chaque signal d'alerte retire 15 points : engagement très bas pour sa taille, compte qui suit plus de monde qu'il n'a d'abonnés, rien publié depuis 2 mois.</p>
                <p>70 et plus : pépite. C'est une aide, pas un verdict.</p>
              </HelpTip>
            </span>
          </div>

          {/* Sections du tri : chaque compte trouvé passe de « À trier » à sa section. */}
          {shown.length > 0 && (
            <Tabs
              className="mb-3"
              size="sm"
              label="Sections du tri"
              value={section}
              onValueChange={(v) => setSection(v as Section)}
              items={[
                { value: "trier", label: "À trier", count: bySection.trier },
                { value: "scouting", label: "Scouting", count: bySection.scouting },
                { value: "contacter", label: "À contacter", count: bySection.contacter },
                { value: "pas", label: "Pas intéressés", count: bySection.pas },
                ...(bySection.roster ? [{ value: "roster", label: "Déjà au roster", count: bySection.roster }] : []),
              ]}
            />
          )}

          {shown.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">Aucun profil pour ces filtres.</div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
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
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {visible.map(({ c, p }) => {
                const d = c.data;
                const yt = d?.platform === "youtube";
                const inPool = pool.get(keyOf(c));
                const sec = sectionOf(c);
                const scoutSt: ScoutStatus | null = inPool ? tracking[inPool.id]?.status ?? "observation" : null;
                const ok = !!d && !c.why;
                return (
                  <div key={c.username} className={cn("flex flex-col gap-2.5 px-4 py-3.5 lg:flex-row lg:items-center lg:gap-4", !ok && "opacity-60")}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="relative">
                        <Pic src={d?.picture} name={d?.name || c.username} />
                        {ok && (
                          <span title={`Potentiel ${p.score} / 100`} className={cn("absolute -bottom-1 -right-1.5 rounded-full border-2 border-surface px-1 text-[9px] font-bold tabular-nums leading-[14px]", p.score >= 70 ? "bg-signal text-white" : p.score >= 45 ? "bg-primary text-primary-foreground" : "bg-panel text-muted-foreground")}>
                            {p.score}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <a href={yt ? d?.url : igLink(c.username)} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[13px] font-semibold text-foreground hover:underline">
                            {yt && <PlatformIcon platform="youtube" className="h-3.5 w-3.5 shrink-0" />}{yt ? d?.name || `@${c.username}` : `@${c.username}`}
                          </a>
                          {d?.name && <span className="truncate text-[12px] text-muted-foreground">{yt ? `@${d.handle || c.username}` : d.name}</span>}
                          {ok && p.score >= 70 && <span className="rounded-full bg-signal/10 px-2 py-0.5 text-[10px] font-semibold text-signaltext">Pépite</span>}
                          {c.count && last.mode !== "yt-search" ? (
                            <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {last.mode === "similaire" ? `${c.count} marque${c.count > 1 ? "s" : ""} en commun` : last.mode === "yt-brand" ? `${c.count} vidéo${c.count > 1 ? "s" : ""} sur la marque` : `cité ${c.count}×`}
                            </span>
                          ) : null}
                          {d?.agency && <span title={`Indice : « ${d.agency} »`} className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] font-medium text-amber">En agence ?</span>}
                          {d?.email && (
                            <button type="button" onClick={() => { void navigator.clipboard?.writeText(d.email ?? ""); toast("Email copié ✓"); }} className="flex items-center gap-1 rounded-full bg-signalsoft px-2 py-0.5 text-[10px] font-medium text-signaltext" title={d.emailFrom === "lien" ? "Trouvé sur son lien en bio · copier" : "Trouvé dans sa bio · copier"}>
                              <Mail className="h-3 w-3" /> {d.email}{d.emailFrom === "lien" ? " (lien)" : ""}
                            </button>
                          )}
                        </div>
                        {d?.bio ? <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{d.bio}</div> : null}
                        {!!d?.deals?.length && (
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-faint">
                            A déjà bossé avec
                            {d.deals.slice(0, 5).map((b) => yt
                              ? <span key={b} className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{b}</span>
                              : <a key={b} href={igLink(b)} target="_blank" rel="noreferrer" className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary hover:underline">@{b}</a>)}
                          </div>
                        )}
                        {!!c.via?.length && (
                          <div className="mt-1 text-[10px] text-faint">Marques en commun : {c.via.map((b) => `@${b}`).join(", ")}</div>
                        )}
                        {p.flags.length > 0 && <div className="mt-1 text-[10px] font-medium text-dangertext">⚠︎ {p.flags.join(" · ")}</div>}
                        {c.why && <div className="mt-0.5 text-[11px] text-faint">{igWhyText(c.why)}</div>}
                      </div>
                    </div>
                    {ok && (
                      <div className={cn("grid shrink-0 gap-2 lg:flex lg:items-center lg:gap-4", yt ? "grid-cols-4" : "grid-cols-3 sm:pl-[52px] lg:pl-0")}>
                        <Stat label="Abonnés" value={d.followers != null ? fmtCompact(d.followers) : yt ? "masqués" : "—"} />
                        {yt && <Stat label="Vues / vidéo" value={d.avgViews != null ? fmtCompact(d.avgViews) : "—"} />}
                        <Stat label="Engagement" value={fmtEr(d.er)} />
                        <Stat label="Rythme" value={fmtPerWeek(d.perWeek)} />
                      </div>
                    )}
                    <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[52px] lg:pl-0">
                      {inPool?.last_contacted && <span className="text-[10px] text-faint">Contacté {fmtAgo(inPool.last_contacted)}</span>}
                      {sec === "roster" ? (
                        <span className="rounded-full bg-panel px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Au roster</span>
                      ) : sec === "trier" ? (
                        /* Tri en un clic : garder, à contacter, ou pas intéressé. */
                        <>
                          <button type="button" onClick={() => void triage(c, "scouting")} disabled={adding === c.username} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                            {adding === c.username ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />} Scouting
                          </button>
                          <button type="button" onClick={() => void triage(c, "contacter")} disabled={adding === c.username} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                            <PhoneOutgoing className="h-3.5 w-3.5" /> À contacter
                          </button>
                          <button type="button" onClick={() => void triage(c, "pas")} disabled={adding === c.username} className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50">
                            <X className="h-3.5 w-3.5" /> Pas intéressé
                          </button>
                        </>
                      ) : (
                        /* Déjà trié : son statut, et de quoi le changer de section. */
                        <>
                          <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium", sec === "pas" ? "bg-panel text-muted-foreground" : sec === "contacter" ? "bg-primary/10 text-primary" : "bg-signal/10 text-signaltext")}>
                            {sec === "pas" ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                            {scoutSt ? SCOUT_LABEL[scoutSt] : "Pas intéressé"}
                          </span>
                          <Picker size="xs" ariaLabel={`Changer de section ${c.username}`} className="w-[130px]" pill placeholder="Déplacer…" value="" disabled={adding === c.username}
                            onChange={(v) => {
                              if (v === "trier") void untriage(c);
                              else if (v === "scouting" || v === "contacter" || v === "pas") void triage(c, v);
                            }}
                            options={[
                              ...(sec !== "scouting" ? [{ value: "scouting", label: "Scouting" }] : []),
                              ...(sec !== "contacter" ? [{ value: "contacter", label: "À contacter" }] : []),
                              ...(sec !== "pas" ? [{ value: "pas", label: "Pas intéressé" }] : []),
                              ...(sec === "pas" && !inPool ? [{ value: "trier", label: "Remettre à trier" }] : []),
                            ]} />
                        </>
                      )}
                      {sec !== "roster" && sec !== "pas" && (
                        <button type="button" onClick={() => setContact(c)} title="Écrire un mail ou un message Instagram" className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                          <Send className="h-3.5 w-3.5" /> Écrire
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {!last && !busy && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {[
            ["1", "Choisis un point de départ", "Une marque de ta niche, un créateur que tu aimes, ou une liste de @."],
            ["2", "Filtre", "Abonnés, engagement, ville dans la bio, avec email, sans agence. Tri par score « Potentiel »."],
            ["3", "Trie et contacte", "Range chaque compte : Scouting, À contacter ou Pas intéressé. Écris-lui depuis ta boîte Gmail ou Instagram."],
          ].map(([n, t, dsc]) => (
            <div key={n} className="rounded-2xl border border-dashed border-border px-4 py-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{n}</span>
                {t}
              </div>
              <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{dsc}</div>
            </div>
          ))}
        </div>
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
          onSent={() => void toScouting(contact, true).then((ok) => ok && toast("Noté « contacté » dans le Scouting ✓"))}
          onClose={() => setContact(null)}
        />
      )}
    </div>
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
  paye: { label: "Payé", cls: "bg-primary/10 text-primary", tip: "Le post dit #ad, publicité, collaboration commerciale, sponsorisé…" },
  offert: { label: "Offert / code", cls: "bg-amber/15 text-amber", tip: "Produit offert, code promo ou réduction : la marque envoie des produits ou rémunère à la vente" },
  spontane: { label: "Spontané", cls: "bg-signal/10 text-signaltext", tip: "Aucun signe de partenariat dans le texte" },
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
/** Un même texte posté plusieurs fois par la même créatrice : une seule ligne. */
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

/** Radar à marques : Instagram (posts des créatrices), TikTok (partenariats payés déclarés en France) ou YouTube (vidéos sponsorisées). */
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
  const [kind, setKind] = useState<"clients" | "chauds" | "tous">("clients");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [period, setPeriod] = useState("90");
  const [words, setWords] = useState("");
  const [minF, setMinF] = useState("");
  const [maxF, setMaxF] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState<"nouveau" | "ignore" | "pipeline">("nouveau");
  const [srcF, setSrcF] = useState<"toutes" | "miennes" | "scouting" | "hors">("toutes");
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
      // Profils des marques et des créatrices citées (abonnés, bio, « est-ce une marque ? »).
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
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center text-sm text-muted-foreground">
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
    rosterNames[p.c] || p.roster ? { t: "Roster", c: "bg-foreground/[0.07] text-foreground" } : poolUsers.has(p.c) ? { t: "Scouting", c: "bg-indigo/10 text-indigo" } : { t: "Hors agence", c: "bg-panel text-faint" };

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
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors", filtersOpen || activeFilters ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Plus de filtres{activeFilters ? ` · ${activeFilters}` : ""}
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
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">

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
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold text-foreground">Vérification des marques</span>
              <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{prog.verified}</span> sur {prog.total}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, Math.round((prog.verified / Math.max(1, prog.total)) * 100))}%` }} />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
              L'app vérifie auprès de Meta que chaque nom trouvé dans les posts est bien une marque. Ça avance tout seul toutes les 2 heures (Meta limite les demandes par heure).
            </p>
          </div>
          <button type="button" onClick={() => void runVerify()} disabled={verifying} className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {verifying ? "Vérification…" : "Vérifier la suite"}
          </button>
        </div>
      )}

      {view.length === 0 ? (
        <div className="rounded-2xl bg-surface px-6 py-10 text-center text-[13px] text-muted-foreground">
          {rows.length === 0
            ? "Le radar n'a encore rien lu. Il passe toutes les 2 heures ; tu peux aussi « Lancer le radar » maintenant."
            : pendingNow > 0
              ? "Les marques apparaissent ici au fur et à mesure qu'elles sont vérifiées."
              : srcF === "hors"
                ? "Aucune marque vue chez des créateurs hors agence pour l'instant : le radar en lit de nouvelles toutes les 2 heures."
                : kind === "chauds" ? "Aucune marque citée spontanément par tes créateurs pour l'instant." : "Aucune marque avec ces réglages."}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {view.map(({ row, posts, types, warm, creators, lastAt, known, prof }) => {
            const open = openRows.has(row.brand);
            const list = dedupe(posts);
            const verdict = types.paye || types.offert ? { t: "Client potentiel", c: "bg-primary/10 text-primary" } : warm ? { t: "Contact chaud", c: "bg-signal/10 text-signaltext" } : { t: "Citée", c: "bg-panel text-muted-foreground" };
            const unsure = !prof?.isBrand;
            const summary = [
              types.paye ? `${types.paye} payé${types.paye > 1 ? "s" : ""}` : "",
              types.offert ? `${types.offert} offert${types.offert > 1 ? "s" : ""} / code` : "",
              warm ? `${warm} spontané${warm > 1 ? "s" : ""} chez tes créateurs` : "",
            ].filter(Boolean).join(" · ");
            return (
              <div key={row.brand} className="px-4 py-3.5">
                <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Pic src={prof?.picture} name={prof?.name || row.brand} size={42} square />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[14px] font-semibold text-foreground">{prof?.name || `@${row.brand}`}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", verdict.c)}>{verdict.t}</span>
                        {unsure && <span title="L'app n'est pas sûre que ce compte soit une marque : vérifie avant d'écrire" className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] font-semibold text-amber">À confirmer</span>}
                        {known && <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{dmHandles.has(row.brand) ? "Déjà en DM" : "Déjà en contact"}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <a href={igLink(row.brand)} target="_blank" rel="noreferrer" className="text-primary hover:underline">@{row.brand}</a>
                        {prof?.followers != null && <span>· {fmtCompact(prof.followers)} abonnés</span>}
                        {prof?.website && <a href={safeHref(prof.website)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">· <Globe className="h-3 w-3" />{domainOf(prof.website)}</a>}
                        {prof?.email && <span className="flex items-center gap-1">· <Mail className="h-3 w-3" />{prof.email}</span>}
                      </div>
                      <div className="mt-1 text-[11px] text-faint">
                        {summary && <span className="font-medium text-muted-foreground">{summary}</span>}
                        {summary && " · "}vue chez {creators.slice(0, 3).map((c) => `@${c}`).join(", ")}{creators.length > 3 ? ` +${creators.length - 3}` : ""} · {fmtAgo(lastAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[54px] lg:pl-0">
                    <button type="button" onClick={() => toggleRow(row.brand)} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground" aria-expanded={open}>
                      {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {open ? "Masquer les preuves" : `Voir les preuves (${list.length})`}
                    </button>
                    {row.status !== "pipeline" ? (
                      <button type="button" onClick={() => void toPipeline(row)} className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                        <Plus className="h-3.5 w-3.5" /> Pipeline
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 rounded-lg bg-signal/10 px-2.5 py-1.5 text-[11px] font-medium text-signaltext"><Check className="h-3.5 w-3.5" /> Au Pipeline</span>
                    )}
                    <button type="button" onClick={() => setMailFor({ row, post: posts.find((p) => p.roster && postType(p) === "spontane") ?? posts[0] })} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover">
                      <Send className="h-3.5 w-3.5" /> Contacter
                    </button>
                    {row.status === "nouveau" ? (
                      <button type="button" onClick={() => void setRowStatus(row.brand, "ignore").then(() => toast("Retirée · retrouve-la dans « Pas pertinentes »"))} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                        <EyeOff className="h-3.5 w-3.5" /> Pas pertinent
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setRowStatus(row.brand, "nouveau")} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                        <RotateCcw className="h-3.5 w-3.5" /> Remettre à traiter
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
                        <div key={p.url || `${p.c}${p.at}`} className="rounded-lg bg-panel/60 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <a href={igLink(p.c)} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline">@{p.c}</a>
                            <span className={cn("rounded px-1.5 text-[9px] font-semibold tracking-wide", src.c)}>{src.t}</span>
                            {profiles[p.c]?.followers != null && <span className="text-faint">{fmtCompact(profiles[p.c]?.followers ?? 0)}</span>}
                            <span className="text-faint">{fmtAgo(p.at)}{p.n > 1 ? ` · ${p.n} posts pareils` : ""}</span>
                            {srcOf(p) === "hors" && (
                              <button type="button" onClick={() => void addCreator(p.c, row.brand)} disabled={adding === p.c} className="flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                                {adding === p.c ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Scouting
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
              Masquer les comptes douteux et les marques déjà en contact
            </button>
          ) : (
            <button type="button" onClick={() => { setShowUnsure(true); setShowKnown(true); }} className="hover:text-foreground">
              {hid.notBrand + hid.known} autre{hid.notBrand + hid.known > 1 ? "s" : ""} masquée{hid.notBrand + hid.known > 1 ? "s" : ""} (pas sûres d'être des marques, ou déjà en contact) · <span className="font-medium text-primary">Afficher</span>
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

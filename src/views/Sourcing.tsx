import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AtSign, Check, Globe, Loader2, Mail, Plus, Radar, RefreshCw, Search, Send, Users, EyeOff, RotateCcw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { HelpTip } from "@/components/ui/help-tip";
import { dbInsert, dbUpdate } from "@/lib/db";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, fmtEr, fmtPerWeek, igWhyText, noteQuota } from "@/lib/instagram";
import { MetaQuotaBadge } from "@/components/MetaQuotaBadge";
import { OutreachComposer } from "@/components/OutreachComposer";

/**
 * SOURCING (agence) — deux outils, toujours via l'outil officiel de Meta (comptes pro) :
 *  • « Trouver des créatrices » : les @ cités par une marque dans ses derniers posts
 *    (= les créatrices avec qui elle travaille), ou une liste de @ collée ; chiffres,
 *    filtres, puis « Ajouter au Scouting ».
 *  • « Radar à marques » : chaque nuit (fonction ig-sourcing), les marques citées par
 *    les créatrices du roster et du Scouting. Partenariats payés = clients potentiels ;
 *    citées gratuitement par tes créatrices = contacts chauds. → Pipeline / mail.
 */

type Prof = {
  name?: string; followers?: number; following?: number; posts?: number; er?: number | null; perWeek?: number | null;
  lastPost?: string | null; bio?: string; website?: string; email?: string; emailFrom?: "bio" | "lien" | "";
  agency?: string | null; deals?: string[]; cites?: string[]; picture?: string; brandScore?: number; isBrand?: boolean;
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
  e === "migration_manquante" ? "Le Sourcing sera actif après la mise à jour (SQL à lancer)."
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
    <div className="min-w-[64px]">
      <div className="text-[10px] text-faint">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums text-foreground">{value}</div>
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
    v: "createurs" as const, icon: Users, title: "Trouver des créatrices", goal: "Pour recruter",
    text: "Pars d'une marque, d'une créatrice que tu aimes ou d'une liste de @ : l'app trouve des profils avec leurs chiffres, un score, leur email, et te dit si elles ont déjà une agence.",
  },
  {
    v: "radar" as const, icon: Radar, title: "Radar à marques", goal: "Pour trouver des clients",
    text: "Chaque nuit, l'app lit les posts de tes créatrices et te montre les marques qui paient des créatrices, ou que tes créatrices citent déjà.",
  },
];

export function Sourcing() {
  const [tab, setTab] = useState<"createurs" | "radar">(() => {
    try {
      return localStorage.getItem("ttp:sourcing-tab") === "radar" ? "radar" : "createurs";
    } catch {
      return "createurs";
    }
  });
  const pick = (v: string) => {
    const t = v === "radar" ? "radar" : "createurs";
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
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Deux outils, à partir d'Instagram
          <HelpTip title="D'où viennent les chiffres ?" align="end">
            <p>De l'outil officiel de Meta (Instagram), le même que pour le Roster et le Scouting.</p>
            <p>Seuls les comptes <span className="font-medium text-foreground">pro ou créateur</span> sont visibles. Les comptes perso apparaissent grisés.</p>
            <p>Meta limite le nombre de demandes par heure : si l'app dit « Meta a freiné », réessaie un peu plus tard.</p>
          </HelpTip>
        </div>
        <MetaQuotaBadge />
      </PageHeaderRow>
      <div role="tablist" aria-label="Outil de sourcing" className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", on ? "bg-primary text-primary-foreground" : "bg-panel text-muted-foreground")}>
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
      {tab === "createurs" ? <CreatorFinder /> : <BrandRadar />}
    </>
  );
}

// ═════════════════════════ Trouver des créatrices ═════════════════════════
type LastSearch = {
  label: string; at: string; mode: "marque" | "similaire" | "liste";
  brand?: Prof & { username: string }; creator?: Prof & { username: string }; brands?: string[]; results: Candidate[];
};
const LAST_KEY = "ttp:sourcing-last";
type PoolInfo = { id: string; last_contacted: string | null };

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
const firstName = (d: Prof | null, user: string) => (d?.name?.trim().split(/\s+/)[0] ?? "") || user;

function CreatorFinder() {
  const [source, setSource] = useState<"marque" | "similaire" | "liste">("marque");
  const [brandIn, setBrandIn] = useState("");
  const [creatorIn, setCreatorIn] = useState("");
  const [listIn, setListIn] = useState("");
  const [busy, setBusy] = useState("");
  const [last, setLast] = useState<LastSearch | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as LastSearch | null;
      return v?.mode ? v : null;
    } catch {
      return null;
    }
  });
  const keep = (s: LastSearch) => {
    setLast(s);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(s));
    } catch {
      /* stockage plein ou indisponible */
    }
  };

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
      setPool(new Map(pr.filter((r) => cleanUser(r.handle ?? "")).map((r) => [cleanUser(r.handle ?? ""), { id: r.id, last_contacted: r.last_contacted }])));
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
    keep({ mode: "marque", label: `Créatrices citées par @${b}`, at: new Date().toISOString(), brand: r.brand, results: r.candidates });
    if (!r.candidates.length) toast(`@${b} ne cite personne dans ses derniers posts`);
    finish(r);
  };
  const runSimilar = async (who?: string) => {
    const c = cleanUser(who ?? creatorIn);
    if (!c) return toast("Tape le @ d'une créatrice, ou choisis-en une de ton roster");
    setCreatorIn(c);
    setBusy(`Marques de @${c}, puis les créatrices qui travaillent avec elles (30 à 60 s)…`);
    const r = await invokeSourcing<{ creator?: Prof & { username: string }; brands?: string[]; candidates?: Candidate[]; stopped?: string }>({ mode: "similar", creator: c });
    setBusy("");
    if (r.error || !r.candidates) return toast(errorText(r.error));
    keep({ mode: "similaire", label: `Créatrices proches de @${c}`, at: new Date().toISOString(), creator: r.creator, brands: r.brands, results: r.candidates.filter((x) => !rosterUsers.has(x.username)) });
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

  // Scouting : ajout (et date de contact quand on vient d'écrire).
  const [adding, setAdding] = useState<string | null>(null);
  const toScouting = async (c: Candidate, contacted?: boolean): Promise<boolean> => {
    const now = new Date().toISOString();
    const known = pool.get(c.username);
    if (known) {
      if (!contacted) return true;
      const ok = await dbUpdate("creator_pool", known.id, { last_contacted: now });
      if (ok) setPool((m) => new Map(m).set(c.username, { ...known, last_contacted: now }));
      return ok;
    }
    const origin = last?.mode === "marque" && last.brand ? ` (citée par @${last.brand.username})` : last?.mode === "similaire" && last.creator ? ` (proche de @${last.creator.username})` : "";
    const created = await dbInsert("creator_pool", {
      name: c.data?.name?.trim() || `@${c.username}`,
      handle: `@${c.username}`,
      email: c.data?.email || null,
      tag: null,
      note: `Trouvée via le Sourcing${origin}`,
      sort_order: maxOrder + 1,
      ...(contacted ? { last_contacted: now } : {}),
    });
    if (!created) return false;
    setMaxOrder((n) => n + 1);
    setPool((m) => new Map(m).set(c.username, { id: String(created.id), last_contacted: contacted ? now : null }));
    return true;
  };
  const addToScouting = async (c: Candidate) => {
    setAdding(c.username);
    const ok = await toScouting(c);
    setAdding(null);
    toast(ok ? `@${c.username} ajoutée au Scouting ✓` : "Erreur, réessaie");
  };
  const [contact, setContact] = useState<Candidate | null>(null);

  const scored = useMemo(() => (last?.results ?? []).map((c) => ({ c, p: c.data ? potential(c.data) : { score: 0, flags: [] as string[] } })), [last]);
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

  const SOURCES = [
    { value: "marque", label: "Depuis une marque" },
    { value: "similaire", label: "Comme une créatrice" },
    { value: "liste", label: "Liste de @" },
  ];
  const runBtn = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} {label}
    </button>
  );

  return (
    <div>
      {/* Point de départ */}
      <div className="mb-3 rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs size="sm" wrap label="Point de départ" value={source} onValueChange={(v) => setSource(v as typeof source)} items={SOURCES} />
          <HelpTip title="Quelle différence ?">
            <p><span className="font-medium text-foreground">Depuis une marque</span> : l'app lit les 50 derniers posts de la marque et liste les @ qu'elle cite. Ce sont souvent les créatrices avec qui elle a travaillé.</p>
            <p><span className="font-medium text-foreground">Comme une créatrice</span> : tu choisis une créatrice (une des tiennes, par exemple). L'app regarde avec quelles marques elle travaille, puis quelles autres créatrices travaillent avec ces mêmes marques. Plus elles en partagent, plus elles lui ressemblent.</p>
            <p><span className="font-medium text-foreground">Liste de @</span> : tu colles des @ trouvés ailleurs pour voir tous leurs chiffres d'un coup.</p>
          </HelpTip>
        </div>
        {source === "marque" && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void runBrand(); }}>
            <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary">
              <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
              <input aria-label="@ de la marque" value={brandIn} onChange={(e) => setBrandIn(e.target.value)} placeholder="gymshark" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
            </div>
            {runBtn("Trouver ses créatrices", () => void runBrand())}
          </form>
        )}
        {source === "similaire" && (
          <div className="flex flex-col gap-2.5">
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void runSimilar(); }}>
              <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary">
                <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
                <input aria-label="@ de la créatrice" value={creatorIn} onChange={(e) => setCreatorIn(e.target.value)} placeholder="une créatrice que tu aimes" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
              </div>
              {runBtn("Trouver des profils proches", () => void runSimilar())}
            </form>
            {roster.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                Tes créatrices :
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
            <Field label="Email" help={<p>L'app cherche un email dans la bio, puis sur le lien de la créatrice (Linktree, son site). « Avec email » : tu peux lui écrire tout de suite depuis l'app.</p>}>
              <select aria-label="Email" value={emailF} onChange={(e) => setEmailF(e.target.value as typeof emailF)} className={cn(IN, "w-28")}>
                <option value="tous">Tous</option><option value="avec">Avec email</option><option value="sans">Sans email</option>
              </select>
            </Field>
            <Field label="Agence" help={<><p>L'app cherche dans la bio et sur le lien des indices comme « management », « agence », « représentée par », « booking », ou un email d'agence.</p><p>C'est un indice, pas une certitude : vérifie avant d'écrire.</p></>}>
              <select aria-label="Agence" value={agencyF} onChange={(e) => setAgencyF(e.target.value as typeof agencyF)} className={cn(IN, "w-32")}>
                <option value="toutes">Toutes</option><option value="sans">Sans agence</option><option value="avec">Déjà en agence</option>
              </select>
            </Field>
            <Field label="Trier par">
              <select aria-label="Trier par" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={cn(IN, "w-36")}>
                <option value="score">Potentiel</option>
                <option value="followers">Abonnés</option>
                <option value="er">Engagement</option>
                {last.mode !== "liste" && <option value="count">{last.mode === "similaire" ? "Marques en commun" : "Citations"}</option>}
              </select>
            </Field>
            <div className="pb-2 text-[12px] text-muted-foreground">
              <Check2 label="Comptes perso, marques, introuvables" checked={showOthers} onChange={setShowOthers} help={<p>Cachés par défaut : les comptes perso (Meta ne donne pas leurs chiffres), les marques citées, et les @ introuvables. Coche pour les voir.</p>} />
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-muted-foreground">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground">{last.label}</span> · {shown.length} profil{shown.length > 1 ? "s" : ""}
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

          {shown.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">Aucun profil pour ces filtres.</div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {shown.map(({ c, p }) => {
                const d = c.data;
                const inPool = pool.get(c.username);
                const inRoster = rosterUsers.has(c.username);
                const ok = !!d && !c.why;
                return (
                  <div key={c.username} className={cn("flex flex-col gap-2.5 px-4 py-3.5 lg:flex-row lg:items-center lg:gap-4", !ok && "opacity-60")}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="relative">
                        <Pic src={d?.picture} name={d?.name || c.username} />
                        {ok && (
                          <span title={`Potentiel ${p.score} / 100`} className={cn("absolute -bottom-1 -right-1.5 rounded-full border-2 border-surface px-1 text-[9px] font-bold tabular-nums leading-[14px]", p.score >= 70 ? "bg-emerald-500 text-white" : p.score >= 45 ? "bg-primary text-primary-foreground" : "bg-panel text-muted-foreground")}>
                            {p.score}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <a href={igLink(c.username)} target="_blank" rel="noreferrer" className="truncate text-[13px] font-semibold text-foreground hover:underline">@{c.username}</a>
                          {d?.name && <span className="truncate text-[12px] text-muted-foreground">{d.name}</span>}
                          {ok && p.score >= 70 && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Pépite</span>}
                          {c.count ? <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{last.mode === "similaire" ? `${c.count} marque${c.count > 1 ? "s" : ""} en commun` : `citée ${c.count}×`}</span> : null}
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
                            {d.deals.slice(0, 5).map((b) => <a key={b} href={igLink(b)} target="_blank" rel="noreferrer" className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary hover:underline">@{b}</a>)}
                          </div>
                        )}
                        {!!c.via?.length && (
                          <div className="mt-1 text-[10px] text-faint">Marques en commun : {c.via.map((b) => `@${b}`).join(", ")}</div>
                        )}
                        {p.flags.length > 0 && <div className="mt-1 text-[10px] font-medium text-rose-500">⚠︎ {p.flags.join(" · ")}</div>}
                        {c.why && <div className="mt-0.5 text-[11px] text-faint">{igWhyText(c.why)}</div>}
                      </div>
                    </div>
                    {ok && (
                      <div className="flex shrink-0 items-center gap-4 pl-[52px] lg:pl-0">
                        <Stat label="Abonnés" value={d.followers != null ? fmtCompact(d.followers) : "—"} />
                        <Stat label="Engagement" value={fmtEr(d.er)} />
                        <Stat label="Rythme" value={fmtPerWeek(d.perWeek)} />
                      </div>
                    )}
                    <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[52px] lg:pl-0">
                      {inPool?.last_contacted && <span className="text-[10px] text-faint">Contactée {fmtAgo(inPool.last_contacted)}</span>}
                      {!inRoster && (
                        <button type="button" onClick={() => setContact(c)} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                          <Send className="h-3.5 w-3.5" /> Contacter
                        </button>
                      )}
                      {inRoster ? (
                        <span className="rounded-full bg-panel px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Au roster</span>
                      ) : inPool ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"><Check className="h-3 w-3" /> Scouting</span>
                      ) : (
                        <button type="button" onClick={() => void addToScouting(c)} disabled={adding === c.username} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                          {adding === c.username ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Scouting
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
            ["1", "Choisis un point de départ", "Une marque de ta niche, une créatrice que tu aimes, ou une liste de @."],
            ["2", "Filtre", "Abonnés, engagement, ville dans la bio, avec email, sans agence. Tri par score « Potentiel »."],
            ["3", "Contacte ou garde", "Un mail depuis ta boîte Gmail ou un message Instagram, ou « + Scouting » pour plus tard."],
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
          instagram={contact.username}
          contactName={contact.data?.name || `@${contact.username}`}
          subject={`TTP Creators × ${firstName(contact.data, contact.username)}`}
          body={`Bonjour ${firstName(contact.data, contact.username)},\n\nJe te contacte de la part de TTP Creators, une agence qui accompagne des créatrices de contenu dans leurs partenariats avec les marques.\n\nJ'aime beaucoup ton contenu${contact.data?.deals?.length ? ` et tes collaborations (${contact.data.deals.slice(0, 2).map((b) => `@${b}`).join(", ")})` : ""} : je pense qu'on pourrait faire de belles choses ensemble.\n\nTu serais partante pour qu'on en parle ?\n\nBelle journée,`}
          onSent={() => void toScouting(contact, true).then((ok) => ok && toast("Notée « contactée » dans le Scouting ✓"))}
          onClose={() => setContact(null)}
        />
      )}
    </div>
  );
}

// ═════════════════════════════ Radar à marques ═════════════════════════════
const PERIODS = [
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "all", label: "Tout" },
];

function BrandRadar() {
  const [rows, setRows] = useState<RadarRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, Prof & { why?: string | null }>>({});
  const [knownBrands, setKnownBrands] = useState<{ handles: Set<string>; names: Set<string> }>({ handles: new Set(), names: new Set() });
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [scanning, setScanning] = useState(false);

  // Filtres
  const [kind, setKind] = useState<"payes" | "gratuits" | "tous">("payes");
  const [period, setPeriod] = useState("90");
  const [words, setWords] = useState("");
  const [minF, setMinF] = useState("");
  const [maxF, setMaxF] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState<"nouveau" | "ignore" | "pipeline">("nouveau");
  const [showUnsure, setShowUnsure] = useState(false);
  const [showKnown, setShowKnown] = useState(false);

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
      const [ct, cr] = await Promise.all([
        supabase.from("contacts").select("brand, instagram"),
        supabase.from("creators").select("name, handle, instagram"),
      ]);
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
    const r = await invokeSourcing<{ creators?: number; brands?: number; stopped?: string; diag?: { posts: number; withText: number; withAt: number } }>({ mode: "scan" });
    setScanning(false);
    if (r.error) return toast(errorText(r.error));
    const d = r.diag;
    toast(
      `${r.creators ?? 0} créatrices lues · ${r.brands ?? 0} marques citées` +
        (d && !r.brands ? ` · ${d.posts} posts reçus, ${d.withText} avec texte, ${d.withAt} avec un @` : "") +
        (r.stopped ? " · Meta a freiné, la suite passera plus tard" : ""),
    );
    setReload((n) => n + 1);
  };

  const setRowStatus = async (brand: string, s: RadarRow["status"]) => {
    const { error } = await supabase.from("ig_radar").update({ status: s }).eq("brand", brand);
    if (error) return toast("Erreur, réessaie");
    setRows((prev) => (prev ? prev.map((r) => (r.brand === brand ? { ...r, status: s } : r)) : prev));
  };
  const toPipeline = async (r: RadarRow) => {
    const p = profiles[r.brand];
    const { data: top } = await supabase.from("prospects").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const created = await dbInsert("prospects", { brand: p?.name?.trim() || `@${r.brand}`, contact: `@${r.brand}`, value: "—", stage: "Prospection", tone: "neutral", sort_order: order });
    if (!created) return toast("Erreur, réessaie");
    await setRowStatus(r.brand, "pipeline");
    toast("Ajoutée au Pipeline ✓");
  };

  const [mailFor, setMailFor] = useState<{ row: RadarRow; post: RadarPost } | null>(null);

  const view = useMemo(() => {
    if (!rows) return [];
    const since = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
    const tokens = norm(words).split(/[\s,]+/).filter(Boolean);
    const lo = parseCount(minF);
    const hi = parseCount(maxF);
    const town = norm(city.trim());
    const out: { row: RadarRow; posts: RadarPost[]; paid: number; organic: number; creators: string[]; known: boolean; prof?: Prof & { why?: string | null } }[] = [];
    for (const row of rows) {
      if (row.status !== status) continue;
      const prof = profiles[row.brand];
      if (!showUnsure && !prof?.isBrand) continue; // profil pas encore lu, compte perso ou personne : « incertain »
      const known = knownBrands.handles.has(row.brand) || (!!prof?.name && knownBrands.names.has(norm(prof.name).trim()));
      if (known && !showKnown) continue;
      const posts = row.posts.filter((p) => {
        if (since && Date.parse(p.at) < since) return false;
        if (kind === "payes" && !p.paid) return false;
        if (kind === "gratuits" && (p.paid || !p.roster)) return false;
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
      if (!posts.length) continue;
      out.push({
        row, posts, known, prof,
        paid: posts.filter((p) => p.paid).length,
        organic: posts.filter((p) => !p.paid && p.roster).length,
        creators: [...new Set(posts.map((p) => p.c))],
      });
    }
    return out.sort((a, b) => b.paid - a.paid || b.creators.length - a.creators.length || b.posts.length - a.posts.length);
  }, [rows, profiles, knownBrands, kind, period, words, minF, maxF, city, status, showUnsure, showKnown]);

  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement du radar…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center text-sm text-muted-foreground">
        Le radar sera actif après la mise à jour de la base (SQL <span className="font-mono text-[12px] text-foreground">2026-10-13-instagram-sourcing.sql</span>).
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            size="sm"
            wrap
            label="Quelles marques"
            value={kind}
            onValueChange={(v) => setKind(v as typeof kind)}
            items={[
              { value: "payes", label: "Partenariats payés" },
              { value: "gratuits", label: "Citées gratuitement" },
              { value: "tous", label: "Toutes" },
            ]}
          />
          <HelpTip title="Quelle différence ?">
            <p><span className="font-medium text-foreground">Partenariats payés</span> : des créatrices de ta niche ont fait un post payé pour la marque (#ad, #sponsorisé, #partenariat, code promo…). Elle a un budget influence : c'est un <span className="font-medium text-foreground">client potentiel</span>.</p>
            <p><span className="font-medium text-foreground">Citées gratuitement</span> : une de TES créatrices parle de la marque sans être payée. C'est un <span className="font-medium text-foreground">contact chaud</span> : tu as la preuve qu'elle aime la marque, à mettre dans ton mail.</p>
            <p><span className="font-medium text-foreground">Toutes</span> : tout ce que le radar a vu.</p>
          </HelpTip>
        </div>
        <div className="flex items-center gap-2">
        <button type="button" onClick={() => void runScan()} disabled={scanning} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50" title="Le radar passe tout seul chaque nuit">
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {scanning ? "Lecture des posts (1 à 2 min)…" : "Lancer le radar"}
        </button>
          <HelpTip title="Comment marche le radar ?" align="end">
            <p>Chaque nuit, l'app lit les 25 derniers posts des créatrices de ton roster et de 20 créatrices de ton Scouting, et note les marques qu'elles citent avec un @.</p>
            <p>Elle regarde ensuite le profil de chaque @ pour deviner si c'est une marque (site web, bio, abonnés).</p>
            <p>« Lancer le radar » le fait tout de suite (1 à 2 minutes).</p>
          </HelpTip>
        </div>
      </div>

      {/* Filtres */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">
        <Field label="# ou mots dans le post" className="min-w-[180px] flex-1" help={<><p>Ne garde que les posts qui contiennent TOUS ces mots ou hashtags.</p><p>Exemple : « #running #ad » = les partenariats payés dans le running. « lyon » = les posts qui parlent de Lyon.</p><p>L'app lit le texte sous le post : les # mis en commentaire ne sont pas visibles.</p></>}><input aria-label="Hashtags ou mots" value={words} onChange={(e) => setWords(e.target.value)} placeholder="#running #ad" className={IN} /></Field>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Période
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={cn(IN, "w-28")}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <Field label="Créatrice : abonnés min" help={<p>La taille de la créatrice qui a fait le post. Utile pour trouver les marques qui travaillent avec des comptes de la taille des tiens.</p>}><input aria-label="Abonnés minimum de la créatrice" value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="10k" className={cn(IN, "w-28")} /></Field>
        <Field label="max"><input aria-label="Abonnés maximum de la créatrice" value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="50k" className={cn(IN, "w-24")} /></Field>
        <Field label="Ville de la créatrice" help={<p>Cherche le mot dans la bio de la créatrice qui a fait le post (par exemple Lyon).</p>}><input aria-label="Ville de la créatrice" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lyon" className={cn(IN, "w-28")} /></Field>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint" title="À traiter = pas encore triées ; Au Pipeline = déjà ajoutées ; Ignorées = mises de côté">Statut
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={cn(IN, "w-32")}>
            <option value="nouveau">À traiter</option>
            <option value="pipeline">Au Pipeline</option>
            <option value="ignore">Ignorées</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 pb-2 text-[12px] text-muted-foreground">
          <Check2 label="Déjà dans mes contacts" checked={showKnown} onChange={setShowKnown} help={<p>Les marques déjà dans tes Contacts sont cachées, pour ne garder que les nouvelles. Coche pour les voir aussi.</p>} />
          <Check2 label="Comptes incertains" checked={showUnsure} onChange={setShowUnsure} help={<p>L'app devine si un @ est une marque (site web, bio, abonnés). Quand elle n'est pas sûre (ami tagué, autre créatrice, profil pas encore lu), le compte est caché. Coche pour le voir.</p>} />
        </div>
      </div>

      <div className="mb-2 px-1 text-[12px] text-muted-foreground">
        {view.length} marque{view.length > 1 ? "s" : ""}
        {kind === "payes" ? " qui paient des créatrices" : kind === "gratuits" ? " dont tes créatrices parlent déjà" : ""}
        <span className="text-faint"> · l'app devine à partir du texte des posts : vérifie avant d'écrire</span>
      </div>

      {view.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted-foreground">
          {rows.length === 0
            ? "Le radar n'a encore rien lu. Il passe chaque nuit ; tu peux aussi « Lancer le radar » maintenant."
            : "Aucune marque pour ces filtres."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {view.map(({ row, posts, paid, organic, creators, known, prof }) => (
            <div key={row.brand} className="flex flex-col rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <Pic src={prof?.picture} name={prof?.name || row.brand} size={44} square />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="truncate text-[14px] font-semibold text-foreground">{prof?.name || `@${row.brand}`}</span>
                    <a href={igLink(row.brand)} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">@{row.brand}</a>
                    {known && <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Déjà en contact</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                    {prof?.followers != null && <span>{fmtCompact(prof.followers)} abonnés</span>}
                    {prof?.website && (
                      <a href={safeHref(prof.website)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground"><Globe className="h-3 w-3" />{domainOf(prof.website)}</a>
                    )}
                    {prof?.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{prof.email}</span>}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {paid > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{paid} partenariat{paid > 1 ? "s" : ""} payé{paid > 1 ? "s" : ""}</span>}
                {organic > 0 && <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600 dark:text-emerald-400">citée gratuitement {organic}×</span>}
                <span className="rounded-full bg-panel px-2.5 py-1 text-muted-foreground">{creators.length} créatrice{creators.length > 1 ? "s" : ""}</span>
              </div>

              <div className="mt-2.5 flex flex-col gap-1.5">
                {posts.slice(0, 3).map((p) => (
                  <a key={p.url || `${p.c}${p.at}`} href={p.url} target="_blank" rel="noreferrer" className="rounded-lg bg-panel/60 px-2.5 py-2 transition-colors hover:bg-rowhover">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={cn("font-semibold", p.roster ? "text-foreground" : "text-muted-foreground")}>@{p.c}</span>
                      {rosterNames[p.c] && <span className="rounded bg-foreground/[0.06] px-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">roster</span>}
                      {profiles[p.c]?.followers != null && <span className="text-faint">{fmtCompact(profiles[p.c]?.followers ?? 0)}</span>}
                      <span className="text-faint">{fmtAgo(p.at)}</span>
                      <span title={p.paid ? "Le post contient #ad, #sponsorisé, #partenariat, un code promo…" : "Aucun signe de partenariat payé dans le texte du post"} className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold", p.paid ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>{p.paid ? "PAYÉ" : "GRATUIT"}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{p.cap || "Sans légende"}</div>
                  </a>
                ))}
                {posts.length > 3 && <div className="px-1 text-[10px] text-faint">+ {posts.length - 3} autre{posts.length - 3 > 1 ? "s" : ""} post{posts.length - 3 > 1 ? "s" : ""}</div>}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
                {row.status !== "pipeline" && (
                  <button type="button" onClick={() => void toPipeline(row)} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                    <Plus className="h-3.5 w-3.5" /> Pipeline
                  </button>
                )}
                <button type="button" onClick={() => setMailFor({ row, post: posts.find((p) => p.roster && !p.paid) ?? posts[0] })} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover">
                  <Mail className="h-3.5 w-3.5" /> Préparer le mail
                </button>
                <div className="flex-1" />
                {row.status === "nouveau" ? (
                  <button type="button" onClick={() => void setRowStatus(row.brand, "ignore")} className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-foreground">
                    <EyeOff className="h-3.5 w-3.5" /> Ignorer
                  </button>
                ) : (
                  <button type="button" onClick={() => void setRowStatus(row.brand, "nouveau")} className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-foreground">
                    <RotateCcw className="h-3.5 w-3.5" /> Remettre à traiter
                  </button>
                )}
              </div>
            </div>
          ))}
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
              : `Bonjour,\n\nJ'ai vu votre collaboration avec @${post.c} : ${post.url}\n\nChez TTP Creators, nous représentons des créatrices qui correspondent à votre univers et pourraient porter vos prochaines campagnes.\n\nJe vous envoie notre sélection ?\n\nBelle journée,`}
            onClose={() => setMailFor(null)}
          />
        );
      })()}
    </div>
  );
}

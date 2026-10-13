import { useEffect, useMemo, useState } from "react";
import {
  AtSign, Check, Copy, ExternalLink, Globe, Loader2, Mail, Plus, Radar, RefreshCw, Search, Users, X, EyeOff, RotateCcw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { Overlay } from "@/components/mobile/ios-sheet";
import { dbInsert } from "@/lib/db";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, fmtEr, fmtPerWeek, igWhyText } from "@/lib/instagram";

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
  lastPost?: string | null; bio?: string; website?: string; email?: string; picture?: string; brandScore?: number; isBrand?: boolean;
};
type Candidate = { username: string; count?: number; lastAt?: string; url?: string; data: Prof | null; why: string | null };
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
        <div className="text-sm text-muted-foreground">Trouve des créatrices à recruter et des marques à démarcher, depuis Instagram.</div>
      </PageHeaderRow>
      <Tabs
        className="mb-4"
        label="Outil de sourcing"
        value={tab}
        onValueChange={pick}
        items={[
          { value: "createurs", label: "Créatrices", icon: <Users className="h-3.5 w-3.5" /> },
          { value: "radar", label: "Radar à marques", icon: <Radar className="h-3.5 w-3.5" /> },
        ]}
      />
      {tab === "createurs" ? <CreatorFinder /> : <BrandRadar />}
    </>
  );
}

// ═════════════════════════ Trouver des créatrices ═════════════════════════
type LastSearch = { label: string; at: string; brand?: Prof & { username: string }; results: Candidate[] };
const LAST_KEY = "ttp:sourcing-last";

function CreatorFinder() {
  const [source, setSource] = useState<"marque" | "liste">("marque");
  const [brandIn, setBrandIn] = useState("");
  const [listIn, setListIn] = useState("");
  const [busy, setBusy] = useState("");
  const [last, setLast] = useState<LastSearch | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as LastSearch | null;
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
  const [withEmail, setWithEmail] = useState(false);
  const [showPerso, setShowPerso] = useState(false);
  const [sort, setSort] = useState<"followers" | "er" | "count">("followers");

  // Déjà connues : Scouting + roster (pour ne pas les ajouter deux fois).
  const [known, setKnown] = useState<{ pool: Set<string>; roster: Set<string>; maxOrder: number }>({ pool: new Set(), roster: new Set(), maxOrder: 0 });
  useEffect(() => {
    let alive = true;
    void Promise.all([
      supabase.from("creator_pool").select("handle, sort_order"),
      supabase.from("creators").select("handle, instagram"),
    ]).then(([p, c]) => {
      if (!alive) return;
      const pr = (p.data as { handle: string | null; sort_order: number | null }[] | null) ?? [];
      const cr = (c.data as { handle: string | null; instagram: string | null }[] | null) ?? [];
      setKnown({
        pool: new Set(pr.map((r) => cleanUser(r.handle ?? "")).filter(Boolean)),
        roster: new Set(cr.flatMap((r) => [cleanUser(r.instagram ?? ""), cleanUser(r.handle ?? "")]).filter(Boolean)),
        maxOrder: pr.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0),
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const runBrand = async () => {
    const b = cleanUser(brandIn);
    if (!b) return toast("Tape le @ d'une marque");
    setBusy("Lecture des posts de la marque…");
    const r = await invokeSourcing<{ brand?: Prof & { username: string }; candidates?: Candidate[]; stopped?: string }>({ mode: "brand", brand: b });
    setBusy("");
    if (r.error || !r.candidates) return toast(errorText(r.error));
    keep({ label: `Créatrices citées par @${b}`, at: new Date().toISOString(), brand: r.brand, results: r.candidates });
    setSort("count");
    if (!r.candidates.length) toast(`@${b} ne cite personne dans ses derniers posts`);
    else if (r.stopped) toast(`Meta a freiné : ${igWhyText(r.stopped)}`);
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
        toast(`Meta a freiné : ${igWhyText(r.stopped)}`);
        break;
      }
    }
    setBusy("");
    if (results.length) {
      keep({ label: `Liste de ${users.length} @`, at: new Date().toISOString(), results });
      setSort("followers");
    }
  };

  const [adding, setAdding] = useState<string | null>(null);
  const addToScouting = async (c: Candidate) => {
    setAdding(c.username);
    const created = await dbInsert("creator_pool", {
      name: c.data?.name?.trim() || `@${c.username}`,
      handle: `@${c.username}`,
      email: c.data?.email || null,
      tag: null,
      note: last?.brand ? `Trouvée via le Sourcing (citée par @${last.brand.username})` : "Trouvée via le Sourcing",
      sort_order: known.maxOrder + 1,
    });
    setAdding(null);
    if (!created) return toast("Erreur, réessaie");
    setKnown((k) => ({ ...k, pool: new Set([...k.pool, c.username]), maxOrder: k.maxOrder + 1 }));
    toast(`@${c.username} ajoutée au Scouting ✓`);
  };

  const shown = useMemo(() => {
    const lo = parseCount(minF);
    const hi = parseCount(maxF);
    const er = Number(minEr.replace(",", ".")) || 0;
    const word = norm(bioWord.trim());
    const list = (last?.results ?? []).filter((c) => {
      const d = c.data;
      if (!d || c.why) return showPerso;
      const f = d.followers ?? 0;
      if (lo && f < lo) return false;
      if (hi && f > hi) return false;
      if (er && (d.er ?? 0) < er) return false;
      if (word && !norm(`${d.bio ?? ""} ${d.name ?? ""}`).includes(word)) return false;
      if (withEmail && !d.email) return false;
      return true;
    });
    const key = (c: Candidate) => (sort === "er" ? c.data?.er ?? -1 : sort === "count" ? c.count ?? 0 : c.data?.followers ?? -1);
    return list.sort((a, b) => key(b) - key(a));
  }, [last, minF, maxF, minEr, bioWord, withEmail, showPerso, sort]);
  const hidden = (last?.results.length ?? 0) - shown.length;

  return (
    <div>
      {/* Point de départ */}
      <div className="mb-3 rounded-2xl border border-border bg-surface p-4">
        <Tabs
          size="sm"
          className="mb-3"
          label="Point de départ"
          value={source}
          onValueChange={(v) => setSource(v === "liste" ? "liste" : "marque")}
          items={[
            { value: "marque", label: "Depuis une marque" },
            { value: "liste", label: "Liste de @" },
          ]}
        />
        {source === "marque" ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void runBrand(); }}>
            <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary">
              <AtSign className="h-3.5 w-3.5 shrink-0 text-faint" />
              <input value={brandIn} onChange={(e) => setBrandIn(e.target.value)} placeholder="gymshark" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
            </div>
            <button type="submit" disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Trouver ses créatrices
            </button>
            <p className="w-full text-[11px] text-faint">L'app lit les 50 derniers posts de la marque et récupère toutes les personnes citées : souvent les créatrices avec qui elle travaille.</p>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea value={listIn} onChange={(e) => setListIn(e.target.value)} rows={4} placeholder={"@lea.fit\n@ines.run\ninstagram.com/camille.yoga"} className={cn(IN, "resize-y text-[13px]")} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-faint">Un @ par ligne (ou des liens Instagram). 30 profils prennent environ 20 secondes.</span>
              <button type="button" onClick={() => void runList()} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Analyser
              </button>
            </div>
          </div>
        )}
        {busy && <div className="mt-2 text-[12px] text-muted-foreground">{busy}</div>}
      </div>

      {last && (
        <>
          {/* Filtres */}
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">
            <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Abonnés min<input value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="10k" className={cn(IN, "w-24")} /></label>
            <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Abonnés max<input value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="50k" className={cn(IN, "w-24")} /></label>
            <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Engagement min (%)<input value={minEr} onChange={(e) => setMinEr(e.target.value)} placeholder="2" inputMode="decimal" className={cn(IN, "w-28")} /></label>
            <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[10px] font-medium text-faint">Mot dans la bio<input value={bioWord} onChange={(e) => setBioWord(e.target.value)} placeholder="Lyon, running, maman…" className={IN} /></label>
            <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Trier par
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={cn(IN, "w-36")}>
                <option value="followers">Abonnés</option>
                <option value="er">Engagement</option>
                {last.brand && <option value="count">Nombre de citations</option>}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-3 pb-2 text-[12px] text-muted-foreground">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={withEmail} onChange={(e) => setWithEmail(e.target.checked)} /> Avec email</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showPerso} onChange={(e) => setShowPerso(e.target.checked)} /> Comptes perso / introuvables</label>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{last.label}</span> · {shown.length} profil{shown.length > 1 ? "s" : ""}
              {hidden > 0 && <span className="text-faint"> ({hidden} masqué{hidden > 1 ? "s" : ""} par les filtres)</span>}
            </span>
            <span className="text-[11px] text-faint">{fmtAgo(last.at)}</span>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">Aucun profil pour ces filtres.</div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {shown.map((c) => {
                const d = c.data;
                const inPool = known.pool.has(c.username);
                const inRoster = known.roster.has(c.username);
                return (
                  <div key={c.username} className={cn("flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4", (!d || c.why) && "opacity-60")}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Pic src={d?.picture} name={d?.name || c.username} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <a href={igLink(c.username)} target="_blank" rel="noreferrer" className="truncate text-[13px] font-semibold text-foreground hover:underline">@{c.username}</a>
                          {d?.name && <span className="truncate text-[12px] text-muted-foreground">{d.name}</span>}
                          {c.count ? <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">citée {c.count}×</span> : null}
                          {d?.email && (
                            <button type="button" onClick={() => { void navigator.clipboard?.writeText(d.email ?? ""); toast("Email copié ✓"); }} className="flex items-center gap-1 rounded-full bg-signalsoft px-2 py-0.5 text-[10px] font-medium text-signaltext" title="Copier l'email">
                              <Mail className="h-3 w-3" /> {d.email}
                            </button>
                          )}
                        </div>
                        {d?.bio ? <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{d.bio}</div> : null}
                        {c.why && <div className="mt-0.5 text-[11px] text-faint">{igWhyText(c.why)}</div>}
                      </div>
                    </div>
                    {d && !c.why && (
                      <div className="flex shrink-0 items-center gap-4 pl-[52px] sm:pl-0">
                        <Stat label="Abonnés" value={d.followers != null ? fmtCompact(d.followers) : "—"} />
                        <Stat label="Engagement" value={fmtEr(d.er)} />
                        <Stat label="Rythme" value={fmtPerWeek(d.perWeek)} />
                      </div>
                    )}
                    <div className="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
                      {inRoster ? (
                        <span className="rounded-full bg-panel px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Au roster</span>
                      ) : inPool ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"><Check className="h-3 w-3" /> Au Scouting</span>
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
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted-foreground">
          Tape le @ d'une marque de ta niche : l'app te montre les créatrices avec qui elle travaille, avec leurs abonnés et leur engagement.
        </div>
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
    const r = await invokeSourcing<{ creators?: number; brands?: number; stopped?: string }>({ mode: "scan" });
    setScanning(false);
    if (r.error) return toast(errorText(r.error));
    toast(`${r.creators ?? 0} créatrices lues · ${r.brands ?? 0} marques citées${r.stopped ? ` · Meta a freiné` : ""}`);
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
        <button type="button" onClick={() => void runScan()} disabled={scanning} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50" title="Le radar passe tout seul chaque nuit">
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {scanning ? "Lecture des posts (1 à 2 min)…" : "Lancer le radar"}
        </button>
      </div>

      {/* Filtres */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[10px] font-medium text-faint"># ou mots dans le post<input value={words} onChange={(e) => setWords(e.target.value)} placeholder="#running #ad" className={IN} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Période
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={cn(IN, "w-28")}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Créatrice : abonnés min<input value={minF} onChange={(e) => setMinF(e.target.value)} placeholder="10k" className={cn(IN, "w-28")} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">max<input value={maxF} onChange={(e) => setMaxF(e.target.value)} placeholder="50k" className={cn(IN, "w-24")} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Ville de la créatrice<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lyon" className={cn(IN, "w-28")} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-faint">Statut
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={cn(IN, "w-32")}>
            <option value="nouveau">À traiter</option>
            <option value="pipeline">Au Pipeline</option>
            <option value="ignore">Ignorées</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 pb-2 text-[12px] text-muted-foreground">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showKnown} onChange={(e) => setShowKnown(e.target.checked)} /> Déjà dans mes contacts</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={showUnsure} onChange={(e) => setShowUnsure(e.target.checked)} /> Comptes incertains</label>
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
                      <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold", p.paid ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>{p.paid ? "PAYÉ" : "GRATUIT"}</span>
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

      {mailFor && <MailDraft row={mailFor.row} post={mailFor.post} prof={profiles[mailFor.row.brand]} rosterName={rosterNames[mailFor.post.c]} onClose={() => setMailFor(null)} />}
    </div>
  );
}

/** Mail d'approche prêt à envoyer : modifiable, copiable, ouvrable dans la messagerie. */
function MailDraft({ row, post, prof, rosterName, onClose }: { row: RadarRow; post: RadarPost; prof?: Prof; rosterName?: string; onClose: () => void }) {
  const brandName = prof?.name?.trim() || `@${row.brand}`;
  const [to, setTo] = useState(prof?.email ?? "");
  const [subject, setSubject] = useState(`TTP Creators × ${brandName}`);
  const [body, setBody] = useState(() =>
    post.roster && !post.paid
      ? `Bonjour,\n\n${rosterName ? `${titleCase(rosterName)} (@${post.c})` : `@${post.c}`}, que nous représentons chez TTP Creators, parle déjà de ${brandName} spontanément : ${post.url}\n\nUne collaboration officielle aurait du sens : sa communauté connaît et apprécie déjà votre marque.\n\nJe vous envoie son media kit ?\n\nBelle journée,\nTTP Creators`
      : `Bonjour,\n\nJ'ai vu votre collaboration avec @${post.c} : ${post.url}\n\nChez TTP Creators, nous représentons des créatrices qui correspondent à votre univers et pourraient porter vos prochaines campagnes.\n\nJe vous envoie notre sélection ?\n\nBelle journée,\nTTP Creators`,
  );
  const mailto = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClose={onClose} label="Mail d'approche">
      <div className="my-auto w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[15px] font-semibold text-foreground">Mail pour {brandName}</div>
          <button type="button" onClick={onClose} className="text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-col gap-2">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Email de la marque (absent de sa bio : à trouver)" className={IN} />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={IN} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={11} className={cn(IN, "resize-y text-[13px] leading-relaxed")} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`); toast("Mail copié ✓"); }} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            <Copy className="h-3.5 w-3.5" /> Copier
          </button>
          <a href={mailto} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <ExternalLink className="h-3.5 w-3.5" /> Ouvrir dans ma messagerie
          </a>
        </div>
      </div>
    </Overlay>
  );
}

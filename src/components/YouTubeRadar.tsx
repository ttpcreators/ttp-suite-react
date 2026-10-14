import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Plus, RefreshCw, RotateCcw, Search, Tv, Users, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { Tabs } from "@/components/ui/animated-tabs";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert } from "@/lib/db";
import { fmtAgo } from "@/lib/instagram";
import { fmtCompact } from "@/lib/timeSeries";

/**
 * SOURCING → RADAR À MARQUES → YOUTUBE : vidéos sponsorisées (case « communication
 * commerciale » cochée sur YouTube, ou #ad / code promo dans la description) des
 * chaînes du roster, du Scouting et de chaînes françaises trouvées par recherche
 * (fonction yt-radar, chaque matin), regroupées par marque (table yt_radar).
 */

type Status = "nouveau" | "ignore" | "pipeline";
type Post = { v: string; url: string; at: string; title: string; thumb: string; views: number | null; likes: number | null; flag: boolean; ch: string; c: string; h: string; subs: number | null; src: "roster" | "scouting" | "hors" };
type Row = { brand: string; name: string; posts: Post[]; status: Status; first_seen: string; last_seen: string };
type State = { ok?: boolean; brands?: number; sponsored?: number; searched?: number; quota?: { used: number; limit: number } };

const PERIODS = [
  { value: "30", label: "30 jours" },
  { value: "90", label: "3 mois" },
  { value: "365", label: "1 an" },
];
const SRC = [
  { value: "toutes", label: "Toutes" },
  { value: "roster", label: "Mes créateurs" },
  { value: "scouting", label: "Scouting" },
  { value: "hors", label: "Hors agence" },
];
const chUrl = (p: Post) => (p.h ? `https://www.youtube.com/@${p.h}` : `https://www.youtube.com/channel/${p.ch}`);
const frDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");

export function YouTubeRadar() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<{ data: State; at: string } | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [pool, setPool] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState("90");
  const [src, setSrc] = useState("toutes");
  const [view, setView] = useState<Status>("nouveau");
  const [q, setQ] = useState("");
  const [onlyFlag, setOnlyFlag] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [r, st, ct, pl] = await Promise.all([
        supabase.from("yt_radar").select("brand, name, posts, status, first_seen, last_seen").order("last_seen", { ascending: false }).limit(2000),
        supabase.from("ig_sync_state").select("data, at").eq("key", "yt_radar").maybeSingle(),
        supabase.from("contacts").select("brand"),
        supabase.from("creator_pool").select("handle"),
      ]);
      if (!alive) return;
      if (r.error) {
        setMissing(true);
        setRows([]);
        return;
      }
      setRows(((r.data as Row[] | null) ?? []).map((x) => ({ ...x, posts: Array.isArray(x.posts) ? x.posts : [] })));
      setState((st.data as { data: State; at: string } | null) ?? null);
      const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      setKnown(new Set(((ct.data as { brand: string | null }[] | null) ?? []).map((x) => flat(x.brand ?? "")).filter(Boolean)));
      setPool(new Set(((pl.data as { handle: string | null }[] | null) ?? []).map((x) => (x.handle ?? "").toLowerCase()).filter((h) => /youtube/.test(h))));
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const since = new Date(Date.now() - Number(period) * 86400000).toISOString();
  const brands = useMemo(() => {
    return (rows ?? [])
      .map((r) => {
        const posts = r.posts.filter((p) => p.at >= since && (src === "toutes" || p.src === src) && (!onlyFlag || p.flag));
        const channels = [...new Map(posts.map((p) => [p.ch, p])).values()];
        return { ...r, posts, channels, last: posts.reduce((m, p) => (p.at > m ? p.at : m), "") };
      })
      .filter((b) => b.posts.length > 0)
      .sort((a, b) => b.channels.length - a.channels.length || b.posts.length - a.posts.length || b.last.localeCompare(a.last));
  }, [rows, since, src, onlyFlag]);
  const counts = useMemo(() => {
    const c = { nouveau: 0, ignore: 0, pipeline: 0, channels: new Set<string>(), mine: 0 };
    for (const b of brands) {
      c[b.status ?? "nouveau"]++;
      b.channels.forEach((p) => c.channels.add(p.ch));
      if (b.posts.some((p) => p.src === "roster")) c.mine++;
    }
    return c;
  }, [brands]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brands.filter((b) => (b.status ?? "nouveau") === view && (!needle || b.name.toLowerCase().includes(needle) || b.channels.some((p) => p.c.toLowerCase().includes(needle))));
  }, [brands, view, q]);

  const run = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("yt-radar", { body: {} });
    setRunning(false);
    setReload((n) => n + 1);
    const r = (data ?? {}) as State & { error?: string };
    if (error || r.error) return toast(r.error === "migration_manquante" ? "Radar YouTube pas encore activé (mise à jour en attente)." : r.error === "youtube_non_configure" ? "YouTube n'est pas relié" : "Le radar n'a pas pu tourner, réessaie");
    toast(`${r.sponsored ?? 0} vidéo${(r.sponsored ?? 0) > 1 ? "s" : ""} sponsorisée${(r.sponsored ?? 0) > 1 ? "s" : ""} · ${r.brands ?? 0} marque${(r.brands ?? 0) > 1 ? "s" : ""}${r.quota ? ` · quota YouTube ${r.quota.used}/${r.quota.limit}` : ""}`);
  };
  const setStatus = async (b: Row, s: Status) => {
    const { error } = await supabase.from("yt_radar").update({ status: s }).eq("brand", b.brand);
    if (error) return toast("Erreur, réessaie");
    setRows((cur) => (cur ?? []).map((r) => (r.brand === b.brand ? { ...r, status: s } : r)));
  };
  const toPipeline = async (b: Row) => {
    const name = b.name.replace(/^@/, "");
    const { data: same } = await supabase.from("prospects").select("id").ilike("brand", name.replace(/[%_\\]/g, " ")).limit(1);
    if (!(same as unknown[] | null)?.length) {
      const { data: top } = await supabase.from("prospects").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
      const ok = await dbInsert("prospects", { brand: name, contact: b.name.startsWith("@") ? b.name : null, value: "—", stage: "Prospection", tone: "neutral", sort_order: order });
      if (!ok) return toast("Erreur, réessaie");
    }
    await setStatus(b, "pipeline");
    toast((same as unknown[] | null)?.length ? "Déjà au Pipeline : retirée des marques à traiter" : "Ajoutée au Pipeline ✓");
  };
  const toScouting = async (p: Post, brand: string) => {
    const url = chUrl(p);
    const { data: top } = await supabase.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const ok = await dbInsert("creator_pool", { name: p.c || url, handle: url, email: null, tag: "YouTube", note: `Repéré via le Radar YouTube (vidéo sponsorisée par ${brand})`, sort_order: order });
    if (!ok) return toast("Erreur, réessaie");
    setPool((cur) => new Set([...cur, url.toLowerCase()]));
    toast(`${p.c} ajouté au Scouting ✓`);
  };

  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement du radar YouTube…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center text-sm text-muted-foreground">
        Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic).
      </div>
    );
  }
  const TILES = [
    { icon: Wallet, n: brands.length, title: "Marques qui paient" },
    { icon: Tv, n: counts.channels.size, title: "Chaînes sponsorisées" },
    { icon: Users, n: counts.mine, title: "Chez tes créateurs" },
  ];

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-2.5">
        {TILES.map((t) => (
          <div key={t.title} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 sm:p-3.5">
            <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-panel text-muted-foreground sm:grid"><t.icon className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-[20px] font-bold leading-none tabular-nums text-foreground">{t.n}</span>
              <span className="mt-1 block text-[12px] font-semibold text-foreground">{t.title}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs size="sm" label="Période" value={period} onValueChange={setPeriod} items={PERIODS} />
        <Tabs size="sm" label="Chez quelles chaînes" value={src} onValueChange={setSrc} items={SRC} />
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher une marque ou une chaîne" className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-[12px] outline-none focus:border-primary" />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-foreground" title="Seulement les vidéos où le créateur a coché « communication commerciale » sur YouTube">
          <input type="checkbox" checked={onlyFlag} onChange={(e) => setOnlyFlag(e.target.checked)} /> Placement déclaré
        </label>
        <button type="button" onClick={() => void run()} disabled={running} className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Lancer le radar
        </button>
        <HelpTip title="Comment le radar YouTube trouve les collabs ?" align="end">
          <p>Chaque matin, il lit les dernières vidéos de tes créateurs YouTube et du Scouting, et cherche des vidéos récentes en France (« code promo », « partenariat », « sponsorisé »…).</p>
          <p>Une vidéo compte si le créateur a coché « communication commerciale » sur YouTube (<span className="font-medium text-foreground">placement déclaré</span>), ou si sa description le dit (#ad, code promo…). La marque vient des liens et des noms de la description.</p>
          <p>{state?.at ? `Dernier passage ${fmtAgo(state.at)}` : "Pas encore lancé"}{state?.data.quota ? ` · quota YouTube du jour ${state.data.quota.used} / ${state.data.quota.limit}` : ""}.</p>
        </HelpTip>
      </div>

      <div className="mb-3">
        <Tabs
          size="sm"
          label="Quelles marques"
          value={view}
          onValueChange={(v) => setView(v as Status)}
          items={[
            { value: "nouveau", label: "À traiter", count: counts.nouveau },
            { value: "pipeline", label: "Au Pipeline", count: counts.pipeline },
            { value: "ignore", label: "Pas pertinentes", count: counts.ignore },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {list.length ? (
          <div className="divide-y divide-border">
            {list.slice(0, 200).map((b) => {
              const isOpen = open.has(b.brand);
              const flagged = b.posts.filter((p) => p.flag).length;
              const mine = new Set(b.posts.filter((p) => p.src === "roster").map((p) => p.ch)).size;
              return (
                <div key={b.brand} className="px-4 py-3.5">
                  <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[14px] font-semibold text-foreground">{b.name}</span>
                        {flagged > 0 ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" title="Le créateur a coché « communication commerciale » sur YouTube"><BadgeCheck className="h-3 w-3" />Placement déclaré</span>
                        ) : (
                          <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] font-semibold text-amber" title="Code promo, #ad ou partenariat dans la description">Code / #ad</span>
                        )}
                        {mine > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Chez {mine} de tes créateurs</span>}
                        {known.has(b.brand) && <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Déjà en contact</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {b.channels.length} chaîne{b.channels.length > 1 ? "s" : ""} · {b.posts.length} vidéo{b.posts.length > 1 ? "s" : ""} · dernière le {frDay(b.last)} ·{" "}
                        {b.channels.slice(0, 3).map((p, i) => (
                          <span key={p.ch}>{i > 0 && ", "}<a href={chUrl(p)} target="_blank" rel="noreferrer" className="text-primary hover:underline">{p.c}</a></span>
                        ))}
                        {b.channels.length > 3 && "…"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => setOpen((cur) => { const n = new Set(cur); if (n.has(b.brand)) n.delete(b.brand); else n.add(b.brand); return n; })} className={BTN}>
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Voir les vidéos
                      </button>
                      {view === "nouveau" ? (
                        <>
                          <button type="button" onClick={() => void toPipeline(b)} className={cn(BTN, "border-primary/40 text-primary")}><Plus className="h-3.5 w-3.5" /> Pipeline</button>
                          <button type="button" onClick={() => void setStatus(b, "ignore")} className={cn(BTN, "text-muted-foreground")} title="Pas pertinent"><EyeOff className="h-3.5 w-3.5" /></button>
                        </>
                      ) : (
                        <button type="button" onClick={() => void setStatus(b, "nouveau")} className={BTN}><RotateCcw className="h-3.5 w-3.5" /> Remettre à traiter</button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {b.posts.slice(0, 20).map((p) => (
                        <div key={p.v} className="w-[190px] shrink-0">
                          <a href={p.url} target="_blank" rel="noreferrer" title={p.title} className="relative block aspect-video overflow-hidden rounded-xl bg-panel">
                            {p.thumb && <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-semibold text-white">
                              <span>{frDay(p.at)}</span>
                              {p.views != null && <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{fmtCompact(p.views)}</span>}
                            </span>
                          </a>
                          <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{p.title}</div>
                          <div className="flex items-center justify-between gap-1">
                            <a href={chUrl(p)} target="_blank" rel="noreferrer" className="truncate text-[11px] font-medium text-foreground hover:text-primary">
                              {p.c}{p.subs != null ? <span className="font-normal text-faint"> · {fmtCompact(p.subs)}</span> : null}
                            </a>
                            {p.src === "roster" ? (
                              <span className="shrink-0 text-[9px] font-semibold text-foreground">Roster</span>
                            ) : p.src === "scouting" || pool.has(chUrl(p).toLowerCase()) ? (
                              <span className="shrink-0 text-[9px] font-semibold text-indigo">Scouting</span>
                            ) : (
                              <button type="button" onClick={() => void toScouting(p, b.name)} className="shrink-0 text-[10px] font-medium text-primary">+ Scouting</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-[13px] text-muted-foreground">
            {rows.length ? "Aucune marque ne correspond à ces filtres." : "Rien pour l'instant : clique « Lancer le radar » (il tourne aussi tout seul chaque matin)."}
          </div>
        )}
      </div>
    </div>
  );
}
const BTN = "inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, EyeOff, ExternalLink, Hourglass, Loader2, Plus, RefreshCw, RotateCcw, Search, Users, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { Tabs } from "@/components/ui/animated-tabs";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert } from "@/lib/db";
import { fmtAgo } from "@/lib/instagram";
import { brandKey, groupByBrand, tiktokUser, type TtBrand, type TtContent } from "@/lib/ttRadar";

/**
 * SOURCING → RADAR À MARQUES → TIKTOK : les vidéos marquées « partenariat rémunéré »
 * par des créatrices en France (API Commercial Content de TikTok, fonction tt-radar,
 * chaque matin), regroupées par marque. Une marque qui paie plusieurs créatrices =
 * une cliente avec un budget influence ; ses créatrices = des profils à sourcer.
 */

type Status = "nouveau" | "ignore" | "pipeline";
type State = { ok?: boolean; why?: string | null; saved?: number; detail?: string };
const PERIODS = [
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "90", label: "3 mois" },
  { value: "365", label: "1 an" },
];
const ttLink = (u: string) => `https://www.tiktok.com/@${u}`;
const frDay = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");

function stateText(s: State | null): string {
  if (!s) return "";
  if (s.why === "non_configure") return "En attente de l'accord de TikTok pour l'API des contenus commerciaux. Dès qu'il arrive, on y met les clés et le radar s'allume.";
  if (s.why === "jeton") return "TikTok a refusé les clés de l'API des contenus commerciaux : à vérifier.";
  if (s.why) return `TikTok a répondu : ${s.why}`;
  return "";
}

export function TikTokRadar() {
  const [rows, setRows] = useState<TtContent[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<{ data: State; at: string } | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<Set<string>>(new Set());
  const [pool, setPool] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState("30");
  const [view, setView] = useState<Status>("nouveau");
  const [q, setQ] = useState("");
  const [onlyMany, setOnlyMany] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      const [r, st, bs, ct, cr, pl] = await Promise.all([
        supabase.from("tt_commercial").select("id, created, label, brands, creator, video_url, cover").gte("created", since).order("created", { ascending: false }).limit(10000),
        supabase.from("ig_sync_state").select("data, at").eq("key", "tt_radar").maybeSingle(),
        supabase.from("tt_brand_status").select("brand, status"),
        supabase.from("contacts").select("brand"),
        supabase.from("creators").select("tiktok, handle, platform"),
        supabase.from("creator_pool").select("handle"),
      ]);
      if (!alive) return;
      if (r.error) {
        setMissing(true);
        setRows([]);
        return;
      }
      setRows(((r.data as TtContent[] | null) ?? []).map((x) => ({ ...x, brands: x.brands ?? [] })));
      setState((st.data as { data: State; at: string } | null) ?? null);
      setStatus(Object.fromEntries(((bs.data as { brand: string; status: Status }[] | null) ?? []).map((x) => [x.brand, x.status])));
      setKnown(new Set(((ct.data as { brand: string | null }[] | null) ?? []).map((x) => brandKey(x.brand ?? "")).filter(Boolean)));
      setRoster(new Set(((cr.data as { tiktok: string | null; handle: string | null; platform: string | null }[] | null) ?? [])
        .map((x) => tiktokUser(x.tiktok) || ((x.platform ?? "").toLowerCase().includes("tiktok") ? tiktokUser(x.handle) : "")).filter(Boolean)));
      setPool(new Set(((pl.data as { handle: string | null }[] | null) ?? []).filter((x) => /tiktok\.com/i.test(x.handle ?? "")).map((x) => tiktokUser(x.handle)).filter(Boolean)));
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const since = new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10);
  const brands = useMemo(() => (rows ? groupByBrand(rows, since) : []), [rows, since]);
  const counts = useMemo(() => {
    const out = { nouveau: 0, ignore: 0, pipeline: 0, creators: new Set<string>(), mine: 0 };
    for (const b of brands) {
      out[status[b.key] ?? "nouveau"]++;
      b.creators.forEach((c) => out.creators.add(c));
      if (b.creators.some((c) => roster.has(c))) out.mine++;
    }
    return out;
  }, [brands, status, roster]);
  const view_ = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brands.filter((b) => {
      if ((status[b.key] ?? "nouveau") !== view) return false;
      if (onlyMany && b.creators.length < 2) return false;
      if (needle && !b.name.toLowerCase().includes(needle) && !b.creators.some((c) => c.includes(needle))) return false;
      return true;
    });
  }, [brands, status, view, q, onlyMany]);

  const run = async (mode?: "creators") => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("tt-radar", { body: mode ? { mode } : { days: 30 } });
    setRunning(false);
    const r = (data ?? {}) as State & { error?: string };
    setReload((n) => n + 1); // relit l'état (message « en attente de l'accord » compris)
    if (error || r.error) return toast(r.error === "non_configure" ? "Le radar TikTok attend l'accord de TikTok" : r.error === "migration_manquante" ? "Le radar TikTok sera actif après le SQL" : "TikTok n'a pas répondu, réessaie");
    toast(`${r.saved ?? 0} contenu${(r.saved ?? 0) > 1 ? "s" : ""} sponsorisé${(r.saved ?? 0) > 1 ? "s" : ""} lu${(r.saved ?? 0) > 1 ? "s" : ""}${r.why ? ` · ${r.why}` : ""}`);
  };
  const setBrandStatus = async (b: TtBrand, s: Status) => {
    const { error } = await supabase.from("tt_brand_status").upsert({ brand: b.key, status: s, at: new Date().toISOString() });
    if (error) return toast("Erreur, réessaie");
    setStatus((cur) => ({ ...cur, [b.key]: s }));
  };
  const toPipeline = async (b: TtBrand) => {
    const { data: same } = await supabase.from("prospects").select("id").ilike("brand", b.name.replace(/[%_\\]/g, " ")).limit(1);
    if (!(same as unknown[] | null)?.length) {
      const { data: top } = await supabase.from("prospects").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
      const ok = await dbInsert("prospects", { brand: b.name, contact: null, value: "—", stage: "Prospection", tone: "neutral", sort_order: order });
      if (!ok) return toast("Erreur, réessaie");
    }
    await setBrandStatus(b, "pipeline");
    toast((same as unknown[] | null)?.length ? "Déjà au Pipeline : retirée des marques à traiter" : "Ajoutée au Pipeline ✓");
  };
  const toScouting = async (u: string, brand: string) => {
    const { data: top } = await supabase.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const ok = await dbInsert("creator_pool", { name: `@${u}`, handle: ttLink(u), email: null, tag: "TikTok", note: `Repérée via le Radar TikTok (partenariat payé avec ${brand})`, sort_order: order });
    if (!ok) return toast("Erreur, réessaie");
    setPool((cur) => new Set([...cur, u]));
    toast(`@${u} ajoutée au Scouting ✓`);
  };

  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement du radar TikTok…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center text-sm text-muted-foreground">
        Le radar TikTok sera actif après la mise à jour de la base (SQL <span className="font-mono text-[12px] text-foreground">2026-10-14-tiktok-radar.sql</span>).
      </div>
    );
  }
  const problem = state?.data && !state.data.ok ? stateText(state.data) : "";
  const TILES = [
    { icon: Wallet, n: brands.length, title: "Marques qui paient", text: "Marques qui ont payé au moins une créatrice en France sur la période." },
    { icon: Users, n: counts.creators.size, title: "Créatrices payées", text: "Créatrices en France qui ont publié un partenariat rémunéré." },
    { icon: Plus, n: counts.mine, title: "Chez tes créatrices", text: "Marques qui ont déjà payé une créatrice de ton roster sur TikTok." },
  ];

  return (
    <div>
      {problem ? (
        <div className="mb-3 flex items-start gap-3 rounded-2xl border border-amber/40 bg-amber/[0.06] p-3.5 text-[12px] leading-relaxed text-muted-foreground">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
          <div>
            <p className="font-semibold text-foreground">Radar TikTok pas encore allumé</p>
            <p>{problem}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-2.5">
        {TILES.map((t) => (
          <div key={t.title} title={t.text} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 sm:p-3.5">
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
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher une marque ou une @créatrice" className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-[12px] outline-none focus:border-primary" />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-foreground">
          <input type="checkbox" checked={onlyMany} onChange={(e) => setOnlyMany(e.target.checked)} /> 2 créatrices et plus
        </label>
        <button type="button" onClick={() => void run()} disabled={running} className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Lancer le radar
        </button>
        <HelpTip title="D'où viennent ces données ?" align="end">
          <p>De la bibliothèque officielle de TikTok sur les contenus commerciaux en Europe : chaque vidéo marquée « partenariat rémunéré » par une créatrice en France, avec la marque qui paie.</p>
          <p>Mis à jour chaque matin. {state?.at ? `Dernier passage ${fmtAgo(state.at)}.` : ""}</p>
          <p>« Contenus de mes créatrices » lit les partenariats TikTok des créatrices du roster et du Scouting qui ont un @ TikTok.</p>
          <button type="button" onClick={() => void run("creators")} disabled={running} className="mt-1 text-[12px] font-medium text-primary">Lire les contenus de mes créatrices</button>
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
        {view_.length ? (
          <div className="divide-y divide-border">
            {view_.slice(0, 200).map((b) => {
              const isOpen = open.has(b.key);
              const isKnown = known.has(b.key);
              const mine = b.creators.filter((c) => roster.has(c));
              return (
                <div key={b.key} className="px-4 py-3.5">
                  <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[14px] font-semibold text-foreground">{b.name}</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">PAYÉ</span>
                        {mine.length > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Chez {mine.length} de tes créatrices</span>}
                        {isKnown && <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Déjà en contact</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {b.creators.length} créatrice{b.creators.length > 1 ? "s" : ""} · {b.contents.length} vidéo{b.contents.length > 1 ? "s" : ""} · dernière le {frDay(b.last)}
                        {" · "}
                        {b.creators.slice(0, 3).map((c, i) => (
                          <span key={c}>{i > 0 && ", "}<a href={ttLink(c)} target="_blank" rel="noreferrer" className="text-primary hover:underline">@{c}</a></span>
                        ))}
                        {b.creators.length > 3 && "…"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => setOpen((cur) => { const n = new Set(cur); if (n.has(b.key)) n.delete(b.key); else n.add(b.key); return n; })} className={BTN}>
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Voir les vidéos
                      </button>
                      {view === "nouveau" ? (
                        <>
                          <button type="button" onClick={() => void toPipeline(b)} className={cn(BTN, "border-primary/40 text-primary")}><Plus className="h-3.5 w-3.5" /> Pipeline</button>
                          <button type="button" onClick={() => void setBrandStatus(b, "ignore")} className={cn(BTN, "text-muted-foreground")} title="Pas pertinent"><EyeOff className="h-3.5 w-3.5" /></button>
                        </>
                      ) : (
                        <button type="button" onClick={() => void setBrandStatus(b, "nouveau")} className={BTN}><RotateCcw className="h-3.5 w-3.5" /> Remettre à traiter</button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {b.contents.slice(0, 20).map((v) => (
                        <div key={v.id} className="w-[112px] shrink-0">
                          <a href={v.video_url ?? (v.creator ? ttLink(v.creator) : "#")} target="_blank" rel="noreferrer" className="relative block h-[150px] overflow-hidden rounded-xl bg-panel">
                            {v.cover && <img src={v.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                            <ExternalLink className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" />
                            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-semibold text-white">{frDay(v.created ?? "")}</span>
                          </a>
                          {v.creator && (
                            <div className="mt-1 flex items-center justify-between gap-1">
                              <a href={ttLink(v.creator)} target="_blank" rel="noreferrer" className="truncate text-[11px] font-medium text-foreground hover:text-primary">@{v.creator}</a>
                              {roster.has(v.creator) ? (
                                <span className="shrink-0 text-[9px] font-semibold text-foreground">ROSTER</span>
                              ) : pool.has(v.creator) ? (
                                <span className="shrink-0 text-[9px] font-semibold text-indigo">SCOUTING</span>
                              ) : (
                                <button type="button" onClick={() => void toScouting(v.creator!, b.name)} className="shrink-0 text-[10px] font-medium text-primary" title="Ajouter au Scouting">+ Scouting</button>
                              )}
                            </div>
                          )}
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
            {rows.length ? "Aucune marque ne correspond à ces filtres." : problem ? "Les marques apparaîtront ici dès que TikTok aura ouvert l'accès." : "Rien pour l'instant : clique « Lancer le radar »."}
          </div>
        )}
      </div>
    </div>
  );
}
const BTN = "inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover";

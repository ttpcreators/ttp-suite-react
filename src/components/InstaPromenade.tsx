import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { dbInsert } from "@/lib/db";
import { fmtAgo, fmtEr, igWhyText, noteQuota } from "@/lib/instagram";
import { fmtCompact } from "@/lib/timeSeries";
import { toast } from "@/components/ui/toast";
import { Spin } from "@/components/ui/loader";
import { MetaQuotaBadge } from "@/components/MetaQuotaBadge";
import { SpiderScan } from "@/components/SpiderScan";
import { SPIDER_COLORS as K, SpiderEngine, type Pt, type SpiderPose } from "@/lib/spiderEngine";

/**
 * La promenade Instagram de l'araignée (page Araignée) : depuis un créateur (« comme @x »), une
 * marque (« qui bosse avec @marque ») ou une liste de @, elle lit les comptes par l'accès
 * officiel de Meta (fonction ig-sourcing), puis passe de compte en compte : chaque ligne arrive
 * avec ses vrais chiffres, triée selon les critères de l'agence (rose = gardé, violet = écarté
 * avec la raison), et peut partir au Scouting d'un clic. « Continuer la toile » relance « comme »
 * sur les meilleurs comptes gardés : l'araignée tisse plus loin.
 */

type Prof = {
  name?: string; followers?: number; er?: number | null; perWeek?: number | null; lastPost?: string | null;
  email?: string; agency?: string | null; deals?: string[]; picture?: string; isBrand?: boolean;
};
type Cand = { username: string; count?: number; via?: string[]; data: Prof | null; why: string | null };
type Mode = "comme" | "marque" | "liste";
type Row = Cand & { keep: boolean; reason: string; from: string };
type Crit = { min: number; max: number; er: number; days: number };

const CRIT_KEY = "araignee:criteres";
const DEFAULT_CRIT: Crit = { min: 5000, max: 500000, er: 1.5, days: 30 };
const clean = (h: string) => h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
const sq = (p: Pt, s: number, fill: string, key: string) => <rect key={key} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} fill={fill} />;

function loadCrit(): Crit {
  try {
    return { ...DEFAULT_CRIT, ...(JSON.parse(localStorage.getItem(CRIT_KEY) ?? "{}") as Partial<Crit>) };
  } catch {
    return DEFAULT_CRIT;
  }
}

/** Le tri : gardé si le compte colle aux critères, sinon la raison (toujours une vraie donnée). */
function judge(c: Cand, crit: Crit, roster: Set<string>, pool: Set<string>): { keep: boolean; reason: string } {
  const d = c.data;
  if (!d) return { keep: false, reason: igWhyText(c.why) || "illisible" };
  if (d.isBrand) return { keep: false, reason: "c'est une marque" };
  if (roster.has(c.username)) return { keep: false, reason: "déjà au roster" };
  if (pool.has(c.username)) return { keep: false, reason: "déjà en scouting" };
  if (d.agency) return { keep: false, reason: `déjà en agence (${d.agency})` };
  const f = d.followers ?? 0;
  if (f < crit.min) return { keep: false, reason: `trop petit (${fmtCompact(f)})` };
  if (f > crit.max) return { keep: false, reason: `trop gros (${fmtCompact(f)})` };
  if (d.er != null && d.er < crit.er) return { keep: false, reason: `engagement faible (${fmtEr(d.er)})` };
  if (d.lastPost && Date.now() - new Date(d.lastPost).getTime() > crit.days * 86400000) return { keep: false, reason: `inactif depuis ${fmtAgo(d.lastPost)}` };
  const deals = d.deals?.length ?? 0;
  return { keep: true, reason: deals ? `${deals} marque${deals > 1 ? "s" : ""} payée${deals > 1 ? "s" : ""}` : "dans tes critères" };
}

export function InstaPromenade() {
  const reduce = useReducedMotion() ?? false;
  const [mode, setMode] = useState<Mode>("comme");
  const [input, setInput] = useState("");
  const [toile, setToile] = useState(false);
  const [crit, setCrit] = useState<Crit>(loadCrit);
  const [busy, setBusy] = useState<string | null>(null); // ce que l'araignée cherche côté serveur
  const [rows, setRows] = useState<Row[]>([]);
  const [shown, setShown] = useState(0); // lignes déjà parcourues à l'écran
  const [pending, setPending] = useState<Row[]>([]);
  const [roster, setRoster] = useState<Set<string>>(new Set());
  const [pool, setPool] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(CRIT_KEY, JSON.stringify(crit));
    } catch {
      /* stockage indisponible : sans gravité */
    }
  }, [crit]);

  useEffect(() => {
    void (async () => {
      const [cr, pl] = await Promise.all([supabase.from("creators").select("instagram"), supabase.from("creator_pool").select("handle")]);
      setRoster(new Set(((cr.data as { instagram: string | null }[] | null) ?? []).map((x) => clean(x.instagram ?? "")).filter(Boolean)));
      setPool(new Set(((pl.data as { handle: string | null }[] | null) ?? []).map((x) => clean(x.handle ?? "")).filter(Boolean)));
    })();
  }, []);

  // L'araignée passe d'une ligne à l'autre : une nouvelle ligne toutes les 0,4 s.
  useEffect(() => {
    if (shown >= rows.length) return;
    const id = window.setTimeout(() => setShown((s) => s + 1), reduce ? 0 : 420);
    return () => window.clearTimeout(id);
  }, [shown, rows.length, reduce]);

  const call = async (body: Record<string, unknown>, from: string, seen: Set<string>) => {
    setBusy(from);
    const { data, error } = await supabase.functions.invoke("ig-sourcing", { body });
    noteQuota(data);
    setBusy(null);
    const r = (data ?? {}) as { candidates?: Cand[]; error?: string; stopped?: string };
    if (error || r.error) {
      setProblem(igWhyText(r.error ?? "reseau") || "Instagram n'a pas répondu, réessaie");
      return [] as Row[];
    }
    if (r.stopped) setProblem(igWhyText(r.stopped));
    const out = (r.candidates ?? [])
      .filter((c) => !seen.has(c.username))
      .map((c) => ({ ...c, ...judge(c, crit, roster, pool), from }));
    out.forEach((c) => seen.add(c.username));
    // Les gardés d'abord, les mieux reliés (marques en commun) en tête.
    out.sort((a, b) => Number(b.keep) - Number(a.keep) || (b.count ?? 0) - (a.count ?? 0) || (b.data?.followers ?? 0) - (a.data?.followers ?? 0));
    setRows((cur) => [...cur, ...out]);
    return out;
  };

  const start = async () => {
    const handles = input.split(/[\s,;]+/).map(clean).filter(Boolean);
    if (!handles.length || busy) return;
    setRows([]);
    setShown(0);
    setProblem("");
    setPending([]);
    const seen = new Set<string>(handles);
    let first: Row[] = [];
    if (mode === "comme") first = await call({ mode: "similar", creator: handles[0] }, `comme @${handles[0]}`, seen);
    else if (mode === "marque") first = await call({ mode: "brand", brand: handles[0] }, `avec @${handles[0]}`, seen);
    else first = await call({ mode: "list", handles: handles.slice(0, 30) }, "ta liste", seen);
    // La toile : « comme » sur les 3 meilleurs gardés.
    if (toile && mode !== "liste") {
      const next = first.filter((r) => r.keep).slice(0, 3);
      setPending(next);
      for (const n of next) {
        await call({ mode: "similar", creator: n.username }, `comme @${n.username}`, seen);
        setPending((p) => p.filter((x) => x.username !== n.username));
      }
    }
  };

  const addToScouting = async (r: Row) => {
    const { data: top } = await supabase.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const ok = await dbInsert("creator_pool", {
      name: r.data?.name?.trim() || `@${r.username}`,
      handle: `@${r.username}`,
      email: r.data?.email || null,
      tag: null,
      note: `Trouvé par l'araignée (${r.from})`,
      sort_order: order,
    });
    if (!ok) return false;
    setAdded((s) => new Set([...s, r.username]));
    setPool((s) => new Set([...s, r.username]));
    return true;
  };
  const addAll = async () => {
    const todo = rows.slice(0, shown).filter((r) => r.keep && !added.has(r.username));
    let n = 0;
    for (const r of todo) if (await addToScouting(r)) n++;
    toast(`${n} créateur${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} au Scouting ✓`);
  };

  const visible = rows.slice(0, shown);
  const kept = visible.filter((r) => r.keep);
  const set = visible.length - kept.length;
  const lastKept = kept[kept.length - 1];
  const lastSet = [...visible].reverse().find((r) => !r.keep);
  const walking = shown < rows.length;

  return (
    <div className="rounded-[22px] bg-surface p-3 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold text-foreground">Promenade Instagram</div>
          <div className="text-[12px] text-muted-foreground">L'araignée part d'un compte et se promène de créateur en créateur, par l'accès officiel d'Instagram.</div>
        </div>
        <MetaQuotaBadge />
      </div>

      {/* Le départ */}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {([
            ["comme", "Comme un créateur"],
            ["marque", "Qui bosse avec une marque"],
            ["liste", "Une liste de @"],
          ] as [Mode, string][]).map(([m, l]) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors", mode === m ? "bg-foreground text-background" : "bg-panel text-muted-foreground hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === "comme" ? "@ d'un créateur que tu aimes" : mode === "marque" ? "@ d'une marque (ex : @gymshark)" : "@lea, @nina, @sam… (30 max)"}
            aria-label="Point de départ"
            className="h-10 min-w-0 flex-1 rounded-[12px] border border-border bg-surface px-3 text-[14px] outline-none focus:border-primary max-md:text-[16px]"
          />
          <button type="submit" disabled={!!busy || !input.trim()} className="flex h-10 items-center gap-1.5 rounded-[12px] px-4 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: K.ink }}>
            {busy ? <Spin size={14} /> : null} Lâcher l'araignée
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
          {mode !== "liste" && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={toile} onChange={(e) => setToile(e.target.checked)} />
              Continuer la toile (relance sur les 3 meilleurs : plus de lectures Instagram)
            </label>
          )}
          <span className="flex items-center gap-1">
            Abonnés
            <input type="number" min={0} value={crit.min} onChange={(e) => setCrit({ ...crit, min: Number(e.target.value) || 0 })} className="w-20 rounded border border-border bg-surface px-1.5 py-0.5" aria-label="Abonnés minimum" />
            à
            <input type="number" min={0} value={crit.max} onChange={(e) => setCrit({ ...crit, max: Number(e.target.value) || 0 })} className="w-24 rounded border border-border bg-surface px-1.5 py-0.5" aria-label="Abonnés maximum" />
          </span>
          <span className="flex items-center gap-1">
            Engagement mini
            <input type="number" min={0} step={0.1} value={crit.er} onChange={(e) => setCrit({ ...crit, er: Number(e.target.value) || 0 })} className="w-16 rounded border border-border bg-surface px-1.5 py-0.5" aria-label="Engagement minimum" />%
          </span>
          <span className="flex items-center gap-1">
            Actif depuis
            <input type="number" min={1} value={crit.days} onChange={(e) => setCrit({ ...crit, days: Number(e.target.value) || 30 })} className="w-14 rounded border border-border bg-surface px-1.5 py-0.5" aria-label="Jours depuis le dernier post" />
            j
          </span>
        </div>
      </form>

      {/* Pendant la lecture côté Instagram : l'araignée fouille */}
      {busy && <SpiderScan className="mt-3" label={busy} items={visible.map((r) => `@${r.username} · ${fmtCompact(r.data?.followers ?? 0)} · ${r.reason}`)} height={260} />}
      {problem && <div className="mt-3 px-3 py-2 font-mono text-[12px] text-white" style={{ background: K.violet }}>{problem.toUpperCase()}</div>}

      {/* La promenade : une ligne par compte lu, l'araignée passe de l'une à l'autre */}
      {rows.length > 0 && (
        <Walk rows={visible} added={added} onAdd={addToScouting} reduce={reduce}>
          <div className="sticky bottom-0 z-10 mt-2 font-mono text-[12px] leading-none text-white">
            <div className="flex items-center justify-between gap-2 bg-[#111] px-3 py-1.5 dark:bg-white dark:text-[#111]">
              <span>
                COMPTES LUS {visible.length} / {rows.length}
                {pending.length ? ` · LA TOILE CONTINUE (${pending.length})` : ""}
              </span>
              {kept.some((r) => !added.has(r.username)) && !walking && !busy && (
                <button type="button" onClick={() => void addAll()} className="font-semibold underline underline-offset-2">
                  TOUT AJOUTER AU SCOUTING ({kept.filter((r) => !added.has(r.username)).length})
                </button>
              )}
            </div>
            <div className="grid grid-cols-2">
              <div className="truncate px-3 py-1.5" style={{ background: K.joint }}>
                GARDÉS {String(kept.length).padStart(3, "0")} {lastKept ? `@${lastKept.username}`.toUpperCase() : ""}
              </div>
              <div className="truncate px-3 py-1.5" style={{ background: K.violet }}>
                ÉCARTÉS {String(set).padStart(3, "0")} {lastSet ? lastSet.reason.toUpperCase() : ""}
              </div>
            </div>
          </div>
        </Walk>
      )}
    </div>
  );
}

/** La liste parcourue : l'araignée marche jusqu'à la dernière ligne lue et y pose son étiquette. */
function Walk({
  rows,
  added,
  onAdd,
  reduce,
  children,
}: {
  rows: Row[];
  added: Set<string>;
  onAdd: (r: Row) => Promise<boolean>;
  reduce: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<string, HTMLSpanElement>());
  const target = useRef<Pt>({ x: 200, y: 40 });
  const [pose, setPose] = useState<SpiderPose | null>(null);
  const [mark, setMark] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const last = rows[rows.length - 1];
  const lastKey = last?.username;
  const keyRef = useRef(lastKey);
  const silkRef = useRef<string[]>([]);
  const [silk, setSilk] = useState<Pt[]>([]);
  const silkKeys = useMemo(() => rows.slice(-6, -1).map((r) => r.username), [rows]);
  useEffect(() => {
    keyRef.current = lastKey;
    silkRef.current = silkKeys;
  }, [lastKey, silkKeys]);

  // On suit la dernière ligne lue.
  useEffect(() => {
    if (!lastKey) return;
    handles.current.get(lastKey)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [lastKey, reduce]);

  useEffect(() => {
    const sp = new SpiderEngine({ x: 200, y: -60 }, { scale: 0.85, maxSpeed: 650, idle: !reduce });
    let raf = 0;
    let t = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - t) / 1000);
      t = now;
      const el = keyRef.current ? handles.current.get(keyRef.current) : null;
      const root = box.current;
      if (el && root) {
        const r = el.getBoundingClientRect();
        const o = root.getBoundingClientRect();
        // Coordonnées dans le contenu qui défile (l'araignée défile avec la liste).
        const m = { x: r.left - o.left, y: r.top - o.top + root.scrollTop, w: r.width, h: r.height };
        setMark(m);
        target.current = { x: Math.min(o.width - 110, m.x + m.w + 150), y: m.y + m.h / 2 + 4 };
        setSilk(
          silkRef.current
            .map((u) => handles.current.get(u)?.getBoundingClientRect())
            .filter((q): q is DOMRect => !!q)
            .map((q) => ({ x: q.left - o.left + q.width / 2, y: q.top - o.top + root.scrollTop + q.height / 2 })),
        );
      }
      if (reduce) sp.pos = { ...target.current };
      else sp.update(dt, target.current);
      setPose(sp.pose());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const tone = last?.keep ? K.joint : K.violet;
  const b = pose?.body;
  const ink = "currentColor";

  return (
    <div ref={box} className="relative mt-3 max-h-[560px] overflow-y-auto overflow-x-hidden rounded-[18px] bg-white pt-12 text-[#111] ring-1 ring-black/5 dark:bg-[#0E0E10] dark:text-[#F2F2F4] dark:ring-white/10">
      {rows.map((r) => (
        <div key={r.username} className={cn("flex items-center gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10", !r.keep && "opacity-60")}>
          {r.data?.picture ? <img src={r.data.picture} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-full bg-black/10 dark:bg-white/15" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
              <a href={`https://www.instagram.com/${r.username}/`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                <span
                  ref={(el) => {
                    if (el) handles.current.set(r.username, el);
                  }}
                  className={cn(r.username === lastKey && "outline outline-[1.5px] outline-offset-2")}
                  style={{ scrollMarginBottom: 96, scrollMarginTop: 60, ...(r.username === lastKey ? { outlineColor: tone } : {}) }}
                >
                  @{r.username}
                </span>
              </a>
              {r.data?.name && <span className="truncate text-[12px] opacity-60">{r.data.name}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] opacity-70">
              {r.data && <span>{fmtCompact(r.data.followers ?? 0)} abonnés</span>}
              {r.data?.er != null && <span>{fmtEr(r.data.er)}</span>}
              {r.data?.lastPost && <span>post {fmtAgo(r.data.lastPost)}</span>}
              {r.data?.email && <span>email trouvé</span>}
              {r.via?.length ? <span>via {r.via.slice(0, 3).map((v) => `@${v}`).join(" ")}</span> : null}
              {r.data?.deals?.length ? <span>payé par {r.data.deals.slice(0, 3).map((v) => `@${v}`).join(" ")}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="px-1.5 py-0.5 font-mono text-[10px] text-white" style={{ background: r.keep ? K.joint : K.violet }}>
              {r.reason.toUpperCase()}
            </span>
            {r.keep &&
              (added.has(r.username) ? (
                <span className="text-[11px] opacity-60">Au Scouting ✓</span>
              ) : (
                <button type="button" onClick={() => void onAdd(r).then((ok) => (ok ? toast(`@${r.username} ajouté au Scouting ✓`) : toast("Erreur, réessaie")))} className="text-[11px] font-semibold text-primary">
                  Ajouter au Scouting
                </button>
              ))}
          </div>
        </div>
      ))}

      <div className="h-6" aria-hidden="true" />

      {/* L'araignée, sa toile et l'étiquette de la ligne lue */}
      <svg className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible" aria-hidden="true">
        {b && silk.map((p, i) => <line key={i} x1={b.x} y1={b.y} x2={p.x} y2={p.y} stroke={ink} strokeOpacity={0.16} strokeWidth={1} />)}
        {mark && last && (
          <line x1={mark.x + mark.w / 2} y1={mark.y - 3} x2={mark.x + mark.w / 2} y2={mark.y - 26} stroke={tone} strokeWidth={1.5} />
        )}
        {pose &&
          b &&
          pose.legs.map((l, i) => (
            <g key={i}>
              <polyline points={`${l.hip.x},${l.hip.y} ${l.knee.x},${l.knee.y} ${l.foot.x},${l.foot.y}`} fill="none" stroke={ink} strokeWidth={1.8} />
              {sq(l.knee, 6, K.joint, `k${i}`)}
              {sq(l.foot, l.lifting ? 5.5 : 3.5, l.lifting ? K.joint : ink, `f${i}`)}
            </g>
          ))}
        {b && (
          <>
            <rect x={b.x - 4.5} y={b.y - 19} width={9} height={7} fill={ink} />
            <rect x={b.x - 7.5} y={b.y - 11} width={15} height={12} fill={ink} />
            <rect x={b.x - 6} y={b.y + 1} width={12} height={13} fill={ink} />
            <g transform={`translate(${b.x + 18},${b.y - 26})`}>
              <rect width={86} height={24} fill={K.cyan} />
              <text x={5} y={10} fontFamily="ui-monospace, Menlo, monospace" fontSize={8.5} fill="#fff">ARAIGNÉE/01</text>
              <text x={5} y={20} fontFamily="ui-monospace, Menlo, monospace" fontSize={8.5} fill="#fff">● {rows.length} lus</text>
            </g>
          </>
        )}
      </svg>
      {mark && last && (
        <div className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center" style={{ left: mark.x + mark.w / 2, top: mark.y - 26 }}>
          <span className="whitespace-nowrap px-2 pb-0.5 font-mono text-[16px] leading-tight text-white" style={{ background: tone }}>
            {last.keep ? `@${last.username}`.toUpperCase() : last.reason.toUpperCase().slice(0, 22)}
          </span>
          <span className="mt-0.5 flex gap-0.5">
            {[0, 1, 2].map((k) => (
              <span key={k} className="block h-[6px] w-4 border-[1.5px]" style={{ borderColor: tone }} />
            ))}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

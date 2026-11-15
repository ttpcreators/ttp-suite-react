import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { fmtAgo, igWhyText, noteQuota } from "@/lib/instagram";
import { groupByBrand, type TtContent } from "@/lib/ttRadar";
import { toast } from "@/components/ui/toast";
import { Spin } from "@/components/ui/loader";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { SpiderScan } from "@/components/SpiderScan";
import { SPIDER_COLORS as K } from "@/lib/spiderEngine";
import { TtpSpider } from "@/components/icons/ttp-icons";

/**
 * La page « Araignée » : la salle où l'on voit les araignées de TTP Suite travailler, et d'où on
 * lance tous les scrapings d'un coup (radars Instagram, TikTok, YouTube, veille des agences).
 * Elles tournent l'une après l'autre (quotas des réseaux), l'araignée marche sur ce que le robot
 * en cours connaît déjà, et chaque robot affiche ce qu'il a VRAIMENT ramené (réponse du serveur).
 * En bas : les marques repérées pendant ce passage, puis le journal des derniers passages.
 */

type RobotId = "ig" | "tt" | "yt" | "rivals";
type Outcome = { ok: boolean; chips: string[]; problem?: string; ms: number };
type Robot = { id: RobotId; name: string; platform: string; what: string };

const ROBOTS: Robot[] = [
  { id: "ig", name: "Radar Instagram", platform: "instagram", what: "Lit les posts des créateurs et repère les marques qu'ils citent." },
  { id: "tt", name: "Radar TikTok", platform: "tiktok", what: "Lit les partenariats rémunérés déclarés à TikTok en France (30 jours)." },
  { id: "yt", name: "Radar YouTube", platform: "youtube", what: "Lit les vidéos sponsorisées des chaînes suivies." },
  { id: "rivals", name: "Veille des agences", platform: "instagram", what: "Relit les agences concurrentes : leurs créateurs et leurs marques." },
];

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const plural = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;

/** Lance un robot et traduit sa vraie réponse en étiquettes. */
async function runRobot(id: RobotId): Promise<Outcome> {
  const t0 = performance.now();
  const call = async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    noteQuota(data);
    return { d: (data ?? {}) as Record<string, unknown>, failed: !!error };
  };
  const done = (o: Omit<Outcome, "ms">): Outcome => ({ ...o, ms: performance.now() - t0 });
  if (id === "ig") {
    const { d, failed } = await call("ig-sourcing", { mode: "scan" });
    if (failed || d.error) return done({ ok: false, chips: [], problem: igWhyText(String(d.error ?? "reseau")) || "Instagram n'a pas répondu" });
    return done({
      ok: true,
      chips: [plural(n(d.creators), "créateur lu", "créateurs lus"), plural(n(d.brands), "marque citée", "marques citées"), ...(n(d.discovered) ? [`${n(d.discovered)} hors agence`] : [])],
      problem: d.stopped ? igWhyText(String(d.stopped)) : undefined,
    });
  }
  if (id === "tt") {
    const { d, failed } = await call("tt-radar", { days: 30 });
    if (failed || d.error) return done({ ok: false, chips: [], problem: d.error === "non_configure" ? "Le radar TikTok attend l'accord de TikTok" : "TikTok n'a pas répondu" });
    return done({ ok: true, chips: [plural(n(d.saved), "contenu sponsorisé lu", "contenus sponsorisés lus")], problem: d.why ? String(d.why) : undefined });
  }
  if (id === "yt") {
    const { d, failed } = await call("yt-radar", {});
    if (failed || d.error) return done({ ok: false, chips: [], problem: d.error === "youtube_non_configure" ? "YouTube n'est pas encore relié" : "YouTube n'a pas répondu" });
    return done({ ok: true, chips: [plural(n(d.videos), "vidéo lue", "vidéos lues"), plural(n(d.sponsored), "sponsorisée", "sponsorisées"), plural(n(d.brands), "marque", "marques")] });
  }
  const { d, failed } = await call("ig-sourcing", { mode: "rivals" });
  if (failed || d.error) return done({ ok: false, chips: [], problem: igWhyText(String(d.error ?? "reseau")) || "Instagram n'a pas répondu" });
  return done({
    ok: true,
    chips: [plural(n(d.read), "agence relue", "agences relues"), ...(n(d.left) ? [`${n(d.left)} au prochain passage`] : [])],
    problem: d.stopped ? igWhyText(String(d.stopped)) : undefined,
  });
}

const STATE_NAMES: Record<string, string> = {
  tt_radar: "Radar TikTok",
  yt_radar: "Radar YouTube",
  inbox: "Messages Instagram",
  inbox_direct: "Messages Instagram (direct)",
  webhook: "Réception Instagram",
  publish: "Publication Instagram",
};

type Find = { key: string; name: string; source: RobotId; at: string };

export function Araignee() {
  const [running, setRunning] = useState<RobotId | null>(null);
  const [queue, setQueue] = useState<RobotId[]>([]);
  const [outcomes, setOutcomes] = useState<Partial<Record<RobotId, Outcome>>>({});
  const [known, setKnown] = useState<Record<RobotId, string[]>>({ ig: [], tt: [], yt: [], rivals: [] });
  const [last, setLast] = useState<Partial<Record<RobotId, string | null>>>({});
  const [journal, setJournal] = useState<{ key: string; at: string; ok: boolean; why?: string }[]>([]);
  const [finds, setFinds] = useState<Find[] | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Ce que chaque araignée connaît déjà (ce qu'elle lit à l'écran) et ses derniers passages.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [ig, yt, tt, rv, st] = await Promise.all([
        supabase.from("ig_radar").select("brand, last_seen").order("last_seen", { ascending: false }).limit(40),
        supabase.from("yt_radar").select("name, last_seen").order("last_seen", { ascending: false }).limit(40),
        supabase.from("tt_commercial").select("id, created, label, brands, creator, video_url, cover").order("created", { ascending: false }).limit(300),
        supabase.from("ig_rivals").select("username, read_at").eq("self", false).order("read_at", { ascending: false, nullsFirst: false }).limit(40),
        supabase.from("ig_sync_state").select("key, data, at").order("at", { ascending: false }),
      ]);
      if (!alive) return;
      const igRows = (ig.data ?? []) as { brand: string; last_seen: string | null }[];
      const ytRows = (yt.data ?? []) as { name: string; last_seen: string | null }[];
      const ttRows = (tt.data ?? []) as TtContent[];
      const rvRows = (rv.data ?? []) as { username: string; read_at: string | null }[];
      const ttBrands = groupByBrand(ttRows);
      setKnown({
        ig: igRows.map((r) => `@${r.brand} · repérée sur Instagram`),
        tt: ttBrands.slice(0, 40).map((b) => `${b.name} · ${b.creators.slice(0, 3).map((c) => `@${c}`).join(" ")}`),
        yt: ytRows.map((r) => `${r.name} · vidéo sponsorisée`),
        rivals: rvRows.map((r) => `@${r.username} · agence suivie`),
      });
      const stRows = (st.data ?? []) as { key: string; data: { ok?: boolean; why?: string } | null; at: string }[];
      const at = (k: string) => stRows.find((r) => r.key === k)?.at ?? null;
      setLast({ ig: igRows[0]?.last_seen ?? null, tt: at("tt_radar"), yt: at("yt_radar"), rivals: rvRows[0]?.read_at ?? null });
      setJournal(stRows.map((r) => ({ key: r.key, at: r.at, ok: r.data?.ok !== false, why: r.data?.why ?? undefined })));
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  // Les marques repérées depuis le début du passage (vraies lignes de la base).
  const loadFinds = useCallback(async (from: string) => {
    const [ig, yt, tt] = await Promise.all([
      supabase.from("ig_radar").select("brand, first_seen").gte("first_seen", from).order("first_seen", { ascending: false }).limit(60),
      supabase.from("yt_radar").select("brand, name, first_seen").gte("first_seen", from).order("first_seen", { ascending: false }).limit(60),
      supabase.from("tt_commercial").select("id, created, label, brands, creator, video_url, cover, fetched_at").gte("fetched_at", from).limit(500),
    ]);
    const out: Find[] = [
      ...((ig.data ?? []) as { brand: string; first_seen: string }[]).map((r) => ({ key: `ig:${r.brand}`, name: `@${r.brand}`, source: "ig" as const, at: r.first_seen })),
      ...((yt.data ?? []) as { brand: string; name: string; first_seen: string }[]).map((r) => ({ key: `yt:${r.brand}`, name: r.name, source: "yt" as const, at: r.first_seen })),
      ...groupByBrand((tt.data ?? []) as TtContent[]).map((b) => ({ key: `tt:${b.key}`, name: b.name, source: "tt" as const, at: from })),
    ];
    setFinds(out);
  }, []);

  const launch = async (ids: RobotId[]) => {
    if (running) return;
    const from = new Date().toISOString();
    setSince(from);
    setFinds(null);
    setOutcomes((o) => {
      const next = { ...o };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setQueue(ids);
    for (const id of ids) {
      setRunning(id);
      const res = await runRobot(id);
      setOutcomes((o) => ({ ...o, [id]: res }));
      setQueue((q) => q.filter((x) => x !== id));
      await loadFinds(from);
    }
    setRunning(null);
    setReload((r) => r + 1);
    toast(ids.length > 1 ? "Les araignées ont fini leur tournée" : "L'araignée a fini");
  };

  const current = ROBOTS.find((r) => r.id === running);
  const total = useMemo(() => Object.values(outcomes).filter(Boolean).length, [outcomes]);
  const lastAny = Object.values(last).filter(Boolean).sort().reverse()[0];

  return (
    <div className="flex flex-col gap-4">
      {/* L'arène */}
      <div className="rounded-[22px] bg-surface p-3 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-foreground">{current ? `${current.name} au travail` : "Les araignées attendent"}</div>
            <div className="text-[12px] text-muted-foreground">
              {current ? current.what : lastAny ? `Dernier passage ${fmtAgo(lastAny)}` : "Pas encore de passage enregistré"}
              {queue.length > 1 && ` · ensuite : ${queue.filter((q) => q !== running).map((q) => ROBOTS.find((r) => r.id === q)?.name).join(", ")}`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void launch(ROBOTS.map((r) => r.id))}
            disabled={!!running}
            className="flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: K.ink }}
          >
            {running ? <Spin size={14} /> : <TtpSpider className="h-4 w-4" />} Lancer les 4 araignées
          </button>
        </div>
        <SpiderScan
          key={running ?? "repos"}
          label={current?.name ?? "la toile"}
          items={current ? known[current.id] : [...known.ig.slice(0, 4), ...known.tt.slice(0, 4), ...known.yt.slice(0, 4)]}
          idle={!current}
          note={!current ? (total ? `Tournée finie · ${total} robot${total > 1 ? "s" : ""} passé${total > 1 ? "s" : ""}` : "L'araignée attend sur sa toile") : undefined}
          height={340}
        />
      </div>

      {/* Les quatre robots */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROBOTS.map((r) => {
          const o = outcomes[r.id];
          const busy = running === r.id;
          const waiting = !busy && queue.includes(r.id);
          return (
            <div key={r.id} className={cn("flex flex-col gap-2 rounded-[18px] bg-surface p-4 ring-1 ring-transparent transition-shadow", busy && "ring-[#F23DD3]")}>
              <div className="flex items-center gap-2">
                <PlatformIcon platform={r.platform} className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{r.name}</div>
                <span
                  className="shrink-0 px-1.5 py-0.5 font-mono text-[10px] text-white"
                  style={{ background: busy ? K.joint : o && !o.ok ? K.violet : o ? "#111" : "#8A8A8E" }}
                >
                  {busy ? "AU TRAVAIL" : waiting ? "EN FILE" : o ? (o.ok ? "FINI" : "PROBLÈME") : "AU REPOS"}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground">{r.what}</div>
              <div className="flex min-h-[26px] flex-wrap gap-1.5">
                {o?.chips.map((c) => (
                  <span key={c} className="px-1.5 py-0.5 font-mono text-[11px] text-white" style={{ background: K.joint }}>
                    {c.toUpperCase()}
                  </span>
                ))}
                {o?.problem && (
                  <span className="px-1.5 py-0.5 font-mono text-[11px] text-white" style={{ background: K.violet }}>
                    {o.problem.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-faint">
                <span>{o ? `En ${Math.round(o.ms / 1000)} s` : last[r.id] ? `Dernier passage ${fmtAgo(last[r.id] as string)}` : "Jamais lancé d'ici"}</span>
                <button type="button" onClick={() => void launch([r.id])} disabled={!!running} className="font-medium text-primary disabled:opacity-40">
                  Lancer
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Les trouvailles du passage */}
      {since && (
        <div className="rounded-[18px] bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[14px] font-semibold text-foreground">Repéré pendant ce passage</div>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "sourcing" }))} className="text-[12px] font-medium text-primary">
              Trier dans le Sourcing
            </button>
          </div>
          {finds === null ? (
            <div className="text-[12px] text-faint">L'araignée cherche…</div>
          ) : finds.length === 0 ? (
            <div className="text-[12px] text-faint">Rien de nouveau pour l'instant.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {finds.map((f) => (
                <span key={f.key} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-foreground">
                  <PlatformIcon platform={ROBOTS.find((r) => r.id === f.source)?.platform ?? "instagram"} className="h-3 w-3 text-faint" />
                  {f.name}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-faint">Instagram et YouTube : marques vues pour la première fois. TikTok : marques des contenus lus pendant ce passage.</p>
        </div>
      )}

      {/* Journal des robots de l'app */}
      <div className="rounded-[18px] bg-surface p-4">
        <div className="mb-2 text-[14px] font-semibold text-foreground">Derniers passages des robots</div>
        {journal.length === 0 ? (
          <div className="text-[12px] text-faint">Aucun passage enregistré.</div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {journal.map((j) => (
              <div key={j.key} className="flex items-center gap-2 py-1.5 text-[12px]">
                <span className="h-2 w-2 shrink-0" style={{ background: j.ok ? K.joint : K.violet }} />
                <span className="min-w-0 flex-1 truncate text-foreground">{STATE_NAMES[j.key] ?? j.key}</span>
                {!j.ok && j.why && <span className="truncate text-muted-foreground">{igWhyText(j.why) || j.why}</span>}
                <span className="shrink-0 text-faint">{fmtAgo(j.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

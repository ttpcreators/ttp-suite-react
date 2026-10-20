import { useEffect, useMemo, useState } from "react";
import { Spin } from "@/components/ui/loader";
import { Binoculars, Check, ExternalLink, Plus, RefreshCw, Trash2, TrendingDown, TrendingUp, Minus, Wallet, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { dbInsert } from "@/lib/db";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, fmtEr, fmtPerWeek, igWhyText, noteQuota } from "@/lib/instagram";
import { agencyCandidates, growth, sparkPoints, type Rival, type RivalBrand, type RivalCreator } from "@/lib/igRivals";

/**
 * SOURCING → AGENCES CONCURRENTES : les agences que TTP surveille (table ig_rivals,
 * relue chaque jour par ig-sourcing). Pour chacune : croissance des abonnés,
 * créatrices qu'elle met en avant (citées dans ses posts, ou qui la nomment dans
 * leur bio), marques avec qui elle travaille (citées par l'agence, ou payées par
 * ses créatrices). Le compte TTP sert de point de comparaison.
 */

const IN = "rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const clean = (h: string) => h.trim().replace(/^@/, "").replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
const igLink = (u: string) => `https://www.instagram.com/${u}/`;

async function invokeRivals(body: Record<string, unknown>): Promise<{ read?: number; error?: string; stopped?: string }> {
  const { data, error } = await supabase.functions.invoke("ig-sourcing", { body: { mode: "rivals", ...body } });
  if (error) return { error: "reseau" };
  noteQuota(data);
  return (data ?? { error: "reseau" }) as { read?: number; error?: string; stopped?: string };
}

function Pic({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-panel text-[10px] font-bold text-foreground" style={{ width: size, height: size }}>
      {initials(name || "?")}
      {src && ok && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

function Growth({ r, days }: { r: Rival; days: number }) {
  const g = growth(r.history ?? [], days);
  if (!g) return <span className="text-faint">—</span>;
  const Icon = g.abs > 0 ? TrendingUp : g.abs < 0 ? TrendingDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", g.abs > 0 ? "text-signaltext" : g.abs < 0 ? "text-dangertext" : "text-muted-foreground")}>
      <Icon className="h-3 w-3" />
      {g.abs > 0 ? "+" : ""}{fmtCompact(g.abs)} ({g.pct > 0 ? "+" : ""}{String(g.pct).replace(".", ",")} %)
    </span>
  );
}

function Spark({ r }: { r: Rival }) {
  const pts = sparkPoints(r.history ?? [], 96, 28);
  if (!pts) return <div className="h-7 w-24 rounded bg-panel/60" title="La courbe se dessine au fil des jours" />;
  return (
    <svg viewBox="0 0 96 28" className="h-7 w-24 overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" className="text-primary" />
    </svg>
  );
}

export function RivalWatch() {
  const [rows, setRows] = useState<Rival[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [remove, setRemove] = useState<Rival | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [pool, setPool] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<Set<string>>(new Set());
  const [known, setKnown] = useState<{ handles: Set<string>; names: Set<string> }>({ handles: new Set(), names: new Set() });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await supabase.from("ig_rivals").select("username, self, data, history, creators, brands, why, added_at, read_at").order("added_at");
      if (!alive) return;
      if (r.error) {
        setMissing(true);
        setRows([]);
        return;
      }
      setRows((r.data as Rival[] | null) ?? []);
      const [pr, pl, cr, ct] = await Promise.all([
        supabase.from("ig_profiles").select("agency:data->>agency").not("data->>agency", "is", null).limit(2000),
        supabase.from("creator_pool").select("handle"),
        supabase.from("creators").select("handle, instagram"),
        supabase.from("contacts").select("brand, instagram"),
      ]);
      if (!alive) return;
      setHints(((pr.data as { agency: string | null }[] | null) ?? []).map((x) => x.agency ?? "").filter(Boolean));
      setPool(new Set(((pl.data as { handle: string | null }[] | null) ?? []).map((x) => clean(x.handle ?? "")).filter(Boolean)));
      setRoster(new Set(((cr.data as { handle: string | null; instagram: string | null }[] | null) ?? []).flatMap((x) => [clean(x.instagram ?? ""), clean(x.handle ?? "")]).filter(Boolean)));
      const cts = (ct.data as { brand: string | null; instagram: string | null }[] | null) ?? [];
      setKnown({ handles: new Set(cts.map((c) => clean(c.instagram ?? "")).filter(Boolean)), names: new Set(cts.map((c) => norm(c.brand ?? "")).filter(Boolean)) });
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const self = (rows ?? []).find((r) => r.self) ?? null;
  const rivals = (rows ?? []).filter((r) => !r.self);
  const suggestions = useMemo(() => agencyCandidates(hints, new Set((rows ?? []).map((r) => r.username))).filter((x) => x.n >= 1).slice(0, 8), [hints, rows]);

  const follow = async (raw: string) => {
    const u = clean(raw);
    if (!/^[a-z0-9._]{1,30}$/.test(u)) return toast("@ invalide");
    if ((rows ?? []).some((r) => r.username === u)) return toast("Déjà suivie");
    setAdding(true);
    const { error } = await supabase.from("ig_rivals").insert({ username: u });
    if (error) {
      setAdding(false);
      return toast("Erreur, réessaie");
    }
    setInput("");
    setReload((n) => n + 1);
    toast(`@${u} ajoutée : lecture de son compte…`);
    const res = await invokeRivals({ handle: u });
    setAdding(false);
    if (res.error) toast(res.error === "reseau" ? "Lecture pas encore faite : elle se fera au prochain passage" : igWhyText(res.error));
    else if (res.stopped) toast(igWhyText(res.stopped));
    setReload((n) => n + 1);
  };
  const refresh = async (u: string) => {
    setRefreshing(u);
    const res = await invokeRivals({ handle: u });
    setRefreshing(null);
    if (res.error || res.stopped) toast(igWhyText(res.error ?? res.stopped) || "Erreur, réessaie");
    setReload((n) => n + 1);
  };
  const doRemove = async (r: Rival) => {
    const { error } = await supabase.from("ig_rivals").delete().eq("username", r.username);
    if (error) return toast("Erreur, réessaie");
    setRows((cur) => (cur ?? []).filter((x) => x.username !== r.username));
    toast(`@${r.username} n'est plus suivie`);
  };
  const toScouting = async (c: RivalCreator, agency: string) => {
    const { data: top } = await supabase.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const ok = await dbInsert("creator_pool", { name: c.name?.trim() || `@${c.u}`, handle: `@${c.u}`, email: null, tag: null, note: `Repéré chez l'agence @${agency} (Sourcing → Concurrents)`, sort_order: order });
    if (!ok) return toast("Erreur, réessaie");
    setPool((cur) => new Set([...cur, c.u]));
    toast(`@${c.u} ajouté au Scouting ✓`);
  };
  const toPipeline = async (b: RivalBrand, agency: string) => {
    const name = b.name?.trim() || `@${b.u}`;
    const { data: same } = await supabase.from("prospects").select("id").or(`contact.eq."@${b.u}",brand.ilike."${name.replace(/["\\,()%]/g, " ")}"`).limit(1);
    if ((same as unknown[] | null)?.length) return toast("Déjà au Pipeline");
    const { data: top } = await supabase.from("prospects").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const ok = await dbInsert("prospects", { brand: name, contact: `@${b.u}`, value: "—", stage: "Prospection", tone: "neutral", sort_order: order });
    toast(ok ? `Ajoutée au Pipeline ✓ (travaille avec @${agency})` : "Erreur, réessaie");
  };

  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement des agences…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-[22px] bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
        Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Ajouter une agence */}
      <div className="rounded-[22px] bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && input.trim() && void follow(input)}
            placeholder="@ d'une agence concurrente (ou lien Instagram)"
            className={cn(IN, "min-w-0 flex-1")}
          />
          <button type="button" disabled={adding || !input.trim()} onClick={() => void follow(input)} className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {adding ? <Spin size={16} /> : <Plus className="h-4 w-4" />} Suivre
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              Agences repérées chez les créateurs du Sourcing
              <HelpTip title="D'où viennent ces agences ?">
                <p>Quand l'app lit un profil de créateur, elle note si sa bio ou son site cite une agence (« mgmt @… », « géré par… »). Voici les plus citées.</p>
              </HelpTip>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s.u} type="button" disabled={adding} onClick={() => void follow(s.u)} className="inline-flex items-center gap-1 rounded-full bg-field px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
                  <Plus className="h-3 w-3" /> @{s.u}<span className="text-faint">· {s.n} créateur{s.n > 1 ? "s" : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Point de comparaison : le compte TTP */}
      {self?.data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] bg-primary/[0.06] px-4 py-3 text-[12px]">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">TOI</span>
          <span className="font-semibold text-foreground">@{self.username}</span>
          <span className="text-muted-foreground"><span className="font-semibold text-foreground">{fmtCompact(self.data.followers ?? 0)}</span> abonnés</span>
          <span className="text-muted-foreground">7 j : <Growth r={self} days={7} /></span>
          <span className="text-muted-foreground">30 j : <Growth r={self} days={30} /></span>
          <span className="text-muted-foreground">{fmtPerWeek(self.data.perWeek)}</span>
          <span className="text-muted-foreground">Engagement {fmtEr(self.data.er)}</span>
        </div>
      )}

      {rivals.length === 0 ? (
        <div className="rounded-[22px] bg-surface px-6 py-10 text-center">
          <Binoculars className="mx-auto h-8 w-8 text-faint" />
          <p className="mt-2 text-[14px] font-semibold text-foreground">Aucune agence suivie pour l'instant</p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">Ajoute le @ Instagram d'une agence concurrente : l'app suit sa croissance chaque jour, repère les créateurs qu'elle met en avant et les marques avec qui elle travaille.</p>
        </div>
      ) : (
        rivals.map((r) => (
          <RivalCard
            key={r.username}
            r={r}
            busy={refreshing === r.username}
            pool={pool}
            roster={roster}
            known={known}
            onRefresh={() => void refresh(r.username)}
            onRemove={() => setRemove(r)}
            onScouting={(c) => void toScouting(c, r.username)}
            onPipeline={(b) => void toPipeline(b, r.username)}
          />
        ))
      )}
      {remove && (
        <ConfirmDialog
          title="Ne plus suivre cette agence ?"
          message={`@${remove.username} et son historique d'abonnés seront retirés.`}
          confirmLabel="Retirer"
          danger
          onCancel={() => setRemove(null)}
          onConfirm={() => {
            const r = remove;
            setRemove(null);
            void doRemove(r);
          }}
        />
      )}
    </div>
  );
}

function RivalCard({ r, busy, pool, roster, known, onRefresh, onRemove, onScouting, onPipeline }: {
  r: Rival; busy: boolean; pool: Set<string>; roster: Set<string>; known: { handles: Set<string>; names: Set<string> };
  onRefresh: () => void; onRemove: () => void; onScouting: (c: RivalCreator) => void; onPipeline: (b: RivalBrand) => void;
}) {
  const [allC, setAllC] = useState(false);
  const [allB, setAllB] = useState(false);
  const d = r.data;
  const creators = r.creators ?? [];
  const brands = r.brands ?? [];
  const shownC = allC ? creators : creators.slice(0, 6);
  const shownB = allB ? brands : brands.slice(0, 6);
  return (
    <div className="rounded-[22px] bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Pic src={d?.picture} name={d?.name || r.username} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[15px] font-semibold text-foreground">{d?.name || `@${r.username}`}</span>
            <a href={igLink(r.username)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-primary">@{r.username}<ExternalLink className="h-3 w-3" /></a>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            {d ? (
              <>
                <span><span className="font-semibold text-foreground">{fmtCompact(d.followers ?? 0)}</span> abonnés</span>
                <span>7 j : <Growth r={r} days={7} /></span>
                <span>30 j : <Growth r={r} days={30} /></span>
                <span>{fmtPerWeek(d.perWeek)}</span>
                <span>Engagement {fmtEr(d.er)}</span>
              </>
            ) : r.why ? (
              <span className="text-wait">{igWhyText(r.why)}</span>
            ) : (
              <span>Lecture au prochain passage du radar (ou clique Actualiser).</span>
            )}
          </div>
        </div>
        <Spark r={r} />
        <div className="flex items-center gap-1.5">
          <span className="hidden text-[11px] text-faint sm:inline">{r.read_at ? `Lu ${fmtAgo(r.read_at)}` : "Pas encore lu"}</span>
          <button type="button" onClick={onRefresh} disabled={busy} className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50" aria-label="Actualiser">
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
          </button>
          <button type="button" onClick={onRemove} className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-dangertext" aria-label="Ne plus suivre">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {d && (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Users className="h-3.5 w-3.5 text-primary" /> Créateurs mis en avant <span className="text-faint">{creators.length}</span>
              <HelpTip title="Créateurs mis en avant">
                <p>Les créateurs cités dans les derniers posts de l'agence, et ceux qui la nomment dans leur bio (« géré par… »).</p>
                <p>Ajoute-les au Scouting pour les suivre : certains cherchent peut-être une autre agence.</p>
              </HelpTip>
            </div>
            {creators.length ? (
              <div className="space-y-1">
                {shownC.map((c) => {
                  const ours = roster.has(c.u);
                  const inPool = pool.has(c.u);
                  return (
                    <div key={c.u} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-rowhover">
                      <Pic src={c.picture} name={c.name || c.u} size={32} />
                      <div className="min-w-0 flex-1">
                        <a href={c.url || igLink(c.u)} target="_blank" rel="noreferrer" className="block truncate text-[12px] font-semibold text-foreground hover:text-primary">{c.name || `@${c.u}`}</a>
                        <div className="truncate text-[11px] text-muted-foreground">
                          @{c.u}{c.followers != null ? ` · ${fmtCompact(c.followers)}` : ""}{c.er != null ? ` · ${fmtEr(c.er)}` : ""} · {c.src === "bio" ? "la nomme dans sa bio" : `cité ${c.n}×`}
                        </div>
                      </div>
                      {ours ? (
                        <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[10px] font-semibold text-foreground">Roster</span>
                      ) : inPool ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-indigo"><Check className="h-2.5 w-2.5" />Scouting</span>
                      ) : (
                        <button type="button" onClick={() => onScouting(c)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover"><Plus className="h-3 w-3" /> Scouting</button>
                      )}
                    </div>
                  );
                })}
                {creators.length > 6 && <button type="button" onClick={() => setAllC(!allC)} className="px-2 text-[11px] font-medium text-primary">{allC ? "Voir moins" : `Voir les ${creators.length}`}</button>}
              </div>
            ) : (
              <p className="rounded-xl bg-panel/60 px-3 py-3 text-[12px] text-muted-foreground">Aucun créateur repéré dans ses derniers posts.</p>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Wallet className="h-3.5 w-3.5 text-primary" /> Marques avec qui elle travaille <span className="text-faint">{brands.length}</span>
              <HelpTip title="Marques de l'agence">
                <p>Les marques citées dans les posts de l'agence, et celles qui paient ou offrent des produits à ses créateurs (#ad, code promo…).</p>
                <p>Ce sont des clientes qui ont déjà un budget influence : à démarcher.</p>
              </HelpTip>
            </div>
            {brands.length ? (
              <div className="space-y-1">
                {shownB.map((b) => {
                  const isKnown = known.handles.has(b.u) || (!!b.name && known.names.has(norm(b.name)));
                  return (
                    <div key={b.u} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-rowhover">
                      <Pic src={b.picture} name={b.name || b.u} size={32} />
                      <div className="min-w-0 flex-1">
                        <a href={b.url || igLink(b.u)} target="_blank" rel="noreferrer" className="block truncate text-[12px] font-semibold text-foreground hover:text-primary">{b.name || `@${b.u}`}</a>
                        <div className="truncate text-[11px] text-muted-foreground">
                          @{b.u}{b.followers != null ? ` · ${fmtCompact(b.followers)}` : ""} · {b.n ? `citée ${b.n}× par l'agence` : ""}{b.n && b.via.length ? " · " : ""}{b.via.length ? `payée par ${b.via.slice(0, 2).map((v) => `@${v}`).join(", ")}${b.via.length > 2 ? "…" : ""}` : ""}
                        </div>
                      </div>
                      {!b.sure && <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-faint" title="Pas encore vérifiée comme marque">À confirmer</span>}
                      {isKnown ? (
                        <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Déjà en contact</span>
                      ) : (
                        <button type="button" onClick={() => onPipeline(b)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover"><Plus className="h-3 w-3" /> Pipeline</button>
                      )}
                    </div>
                  );
                })}
                {brands.length > 6 && <button type="button" onClick={() => setAllB(!allB)} className="px-2 text-[11px] font-medium text-primary">{allB ? "Voir moins" : `Voir les ${brands.length}`}</button>}
              </div>
            ) : (
              <p className="rounded-xl bg-panel/60 px-3 py-3 text-[12px] text-muted-foreground">Aucune marque repérée pour l'instant.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

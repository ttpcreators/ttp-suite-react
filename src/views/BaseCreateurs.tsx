import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Spin } from "@/components/ui/loader";
import { dbInsert } from "@/lib/db";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, fmtEr } from "@/lib/instagram";
import { CREATOR_NICHES } from "@/lib/niche";
import { VILLES, cleanUser, construireBase, deburr, filtrerBase, type BaseCreateur, type BaseMeta, type BaseProf } from "../../supabase/functions/_shared/baseCreateurs.ts";
import { useStickyState } from "@/lib/useStickyState";
import { TtpSpider } from "@/components/icons/ttp-icons";

/**
 * La « Base créateurs » de TTP, façon Kolsquare : tous les comptes Instagram que l'agence a
 * déjà lus (radars, promenade de l'araignée, Scouting, veille des agences, extension Chrome)
 * gardés dans ig_profiles, filtrables par niche, ville, taille, engagement, activité et
 * partenariats. Niche et ville sont devinées dans la bio tant que personne ne les a corrigées
 * (creator_base_meta). On en fait des listes à montrer aux marques (creator_lists), avec une
 * page publique sur ttpcreators.pro/selection/ qui ne montre que des chiffres publics.
 * Retrait RGPD : le créateur disparaît de la base et de toutes les listes.
 * Avant le SQL 2026-11-16-base-createurs.sql, la base s'affiche quand même (sans listes).
 */

type Prof = BaseProf;
type Row = { username: string; data: Prof; at: string | null };
type Meta = BaseMeta;
type List = { id: string; slug: string; title: string; brand: string | null; intro: string | null; usernames: string[]; public: boolean; updated_at: string };
type Creator = BaseCreateur;

const SITE = "https://ttpcreators.pro/selection/?l=";
const TIERS = [
  { id: "nano", label: "Nano · < 10K", min: 0, max: 1e4 },
  { id: "micro", label: "Micro · 10–100K", min: 1e4, max: 1e5 },
  { id: "mid", label: "Moyen · 100–500K", min: 1e5, max: 5e5 },
  { id: "macro", label: "Macro · 500K +", min: 5e5, max: Infinity },
] as const;
const SORTS = ["abonnes", "engagement", "recent", "nom"] as const;
const IN = "h-9 rounded-full border border-border bg-surface px-3 text-[13px] text-foreground outline-none focus:border-primary";
const missingTable = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202");

/** Adresse publique d'une liste : le titre lisible + 4 caractères au hasard (introuvable sans le lien). */
export function slugFor(title: string): string {
  const base = deburr(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "selection";
  return `${base.length < 3 ? `${base}-ttp` : base}-${Math.random().toString(36).slice(2, 6)}`;
}

async function loadAll<T>(table: string, cols: string): Promise<{ rows: T[]; missing: boolean }> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) return { rows: out, missing: missingTable(error) };
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return { rows: out, missing: false };
}

export function BaseCreateurs() {
  const [tab, setTab] = useStickyState("base:onglet", ["base", "listes"] as const, "base");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [lists, setLists] = useState<List[]>([]);
  const [sqlMissing, setSqlMissing] = useState(false);
  const [roster, setRoster] = useState<Set<string>>(new Set());
  const [scouting, setScouting] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);

  const [q, setQ] = useState("");
  const [niche, setNiche] = useState("");
  const [ville, setVille] = useState("");
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [erMin, setErMin] = useState(0);
  const [actifs, setActifs] = useState(false);
  const [deals, setDeals] = useState(false);
  const [horsAgence, setHorsAgence] = useState(true);
  const [cacherTtp, setCacherTtp] = useState(false);
  const [retires, setRetires] = useState(false);
  const [sort, setSort] = useStickyState("base:tri", SORTS, "abonnes");
  const [shown, setShown] = useState(60);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [p, m, l, cr, pl] = await Promise.all([
        loadAll<Row>("ig_profiles", "username, data, at"),
        loadAll<Meta>("creator_base_meta", "username, niche, ville, note, excluded"),
        supabase.from("creator_lists").select("id, slug, title, brand, intro, usernames, public, updated_at").order("updated_at", { ascending: false }),
        supabase.from("creators").select("handle, instagram"),
        supabase.from("creator_pool").select("handle"),
      ]);
      if (!alive) return;
      setRows(p.rows.filter((r) => r.data && typeof r.data.followers === "number" && !r.data.isBrand && !r.data.pending && r.data.platform !== "youtube"));
      setMeta(Object.fromEntries(m.rows.map((x) => [x.username, x])));
      setSqlMissing(m.missing || missingTable(l.error));
      setLists(((l.data ?? []) as List[]).map((x) => ({ ...x, usernames: x.usernames ?? [] })));
      const rs = new Set<string>();
      for (const c of (cr.data ?? []) as { handle: string | null; instagram: string | null }[]) for (const h of [c.instagram, c.handle]) if (h && cleanUser(h)) rs.add(cleanUser(h));
      setRoster(rs);
      setScouting(new Set(((pl.data ?? []) as { handle: string | null }[]).map((x) => cleanUser(x.handle ?? "")).filter(Boolean)));
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  // Même logique que l'outil base_createurs d'Alfred (supabase/functions/_shared/baseCreateurs.ts).
  const creators: Creator[] = useMemo(() => construireBase(rows ?? [], meta, roster, scouting), [rows, meta, roster, scouting]);

  const villes = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of creators) if (c.ville && !c.excluded) n.set(c.ville, (n.get(c.ville) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  }, [creators]);

  const filtered = useMemo(
    () =>
      filtrerBase(creators, { recherche: q, niche, ville, engagementMin: erMin, actif30j: actifs, avecPartenariats: deals, sansAgence: horsAgence, horsTtp: cacherTtp, tri: sort }, Date.now(), retires)
        .filter((c) => !tiers.size || TIERS.some((t) => tiers.has(t.id) && (c.data.followers ?? 0) >= t.min && (c.data.followers ?? 0) < t.max)),
    [creators, q, niche, ville, tiers, erMin, actifs, deals, horsAgence, cacherTtp, retires, sort],
  );

  useEffect(() => setShown(60), [q, niche, ville, tiers, erMin, actifs, deals, horsAgence, cacherTtp, retires, sort]);

  const saveMeta = async (username: string, patch: Partial<Omit<Meta, "username">>) => {
    const cur = meta[username] ?? { username, niche: null, ville: null, note: null, excluded: false };
    const next = { ...cur, ...patch };
    setMeta((m) => ({ ...m, [username]: next }));
    const { error } = await supabase.from("creator_base_meta").upsert({ ...next, updated_at: new Date().toISOString() });
    if (error) {
      setMeta((m) => ({ ...m, [username]: cur }));
      toast(missingTable(error) ? "Le SQL de la base n'est pas encore lancé" : "Pas enregistré, réessaie");
      return false;
    }
    return true;
  };

  const retirer = async (c: Creator) => {
    if (!window.confirm(`Retirer @${c.username} de la base (RGPD) ?\n\nIl n'apparaîtra plus dans la base ni dans aucune liste. Tu pourras le remettre depuis « Voir les retirés ».`)) return;
    if (!(await saveMeta(c.username, { excluded: true }))) return;
    for (const l of lists.filter((x) => x.usernames.includes(c.username))) await saveList(l, { usernames: l.usernames.filter((u) => u !== c.username) }, true);
    setOpen(null);
    toast(`@${c.username} retiré de la base`);
  };

  const toScouting = async (c: Creator) => {
    const { data: top } = await supabase.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const created = await dbInsert("creator_pool", {
      name: c.data.name?.trim() || `@${c.username}`, handle: `@${c.username}`, email: c.data.email || null,
      tag: c.niche, note: "Trouvé dans la Base créateurs", sort_order: order,
    });
    if (!created) return toast("Erreur, réessaie");
    setScouting((s) => new Set([...s, c.username]));
    toast(`@${c.username} ajouté au Scouting ✓`);
  };

  const saveList = async (l: List, patch: Partial<List>, quiet = false) => {
    const next = { ...l, ...patch, updated_at: new Date().toISOString() };
    setLists((ls) => ls.map((x) => (x.id === l.id ? next : x)));
    const { id: _id, ...row } = { ...patch, updated_at: next.updated_at, id: l.id };
    const { error } = await supabase.from("creator_lists").update(row).eq("id", l.id);
    if (error) {
      setLists((ls) => ls.map((x) => (x.id === l.id ? l : x)));
      if (!quiet) toast("Pas enregistré, réessaie");
      return false;
    }
    return true;
  };

  const newList = async (title: string, usernames: string[] = []) => {
    const t = title.trim();
    if (!t) return null;
    const created = await dbInsert("creator_lists", { slug: slugFor(t), title: t, usernames, public: false });
    if (!created) {
      toast(sqlMissing ? "Le SQL de la base n'est pas encore lancé" : "Erreur, réessaie");
      return null;
    }
    const l = { ...(created as unknown as List), usernames: (created as unknown as List).usernames ?? [] };
    setLists((ls) => [l, ...ls]);
    return l;
  };

  const addPicked = async (target: List | "new") => {
    const users = [...picked];
    if (!users.length) return;
    if (target === "new") {
      const t = window.prompt("Nom de la liste (ex. « Running Lyon pour Decathlon »)");
      if (!t) return;
      const l = await newList(t, users);
      if (l) toast(`Liste « ${l.title} » créée avec ${users.length} créateur${users.length > 1 ? "s" : ""}`);
    } else {
      const merged = [...target.usernames, ...users.filter((u) => !target.usernames.includes(u))];
      if (await saveList(target, { usernames: merged })) toast(`${merged.length - target.usernames.length} ajouté${merged.length - target.usernames.length > 1 ? "s" : ""} à « ${target.title} »`);
    }
    setPicked(new Set());
  };

  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const byUser = useMemo(() => Object.fromEntries(creators.map((c) => [c.username, c])), [creators]);
  const active = !!(q || niche || ville || tiers.size || erMin || actifs || deals || cacherTtp);

  return (
    <div className="flex flex-col gap-4">
      {sqlMissing && (
        <div className="rounded-[14px] bg-surface p-3 text-[12px] text-muted-foreground">
          La base s'affiche déjà avec les profils lus. Les listes pour les marques, la niche et la ville corrigées et le retrait RGPD arrivent dès que le SQL <span className="font-mono">2026-11-16-base-createurs.sql</span> est lancé.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["base", "listes"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("h-9 rounded-full px-4 text-[13px] font-semibold transition-colors", tab === t ? "bg-foreground text-background" : "bg-surface text-muted-foreground hover:text-foreground")}
          >
            {t === "base" ? `La base${rows ? ` · ${fmtCompact(creators.filter((c) => !c.excluded).length)}` : ""}` : `Listes pour les marques${lists.length ? ` · ${lists.length}` : ""}`}
          </button>
        ))}
      </div>

      {tab === "base" ? (
        <>
          {/* Filtres */}
          <div className="flex flex-col gap-2 rounded-[18px] bg-surface p-3 sm:p-4">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher : nom, @compte, mot de la bio, marque…" className={cn(IN, "w-full bg-background")} aria-label="Chercher dans la base" />
            <div className="flex flex-wrap items-center gap-2">
              <select value={niche} onChange={(e) => setNiche(e.target.value)} className={IN} aria-label="Niche">
                <option value="">Toutes les niches</option>
                {CREATOR_NICHES.map((n) => <option key={n.label} value={n.label}>{n.label}</option>)}
              </select>
              <select value={ville} onChange={(e) => setVille(e.target.value)} className={IN} aria-label="Ville">
                <option value="">Toutes les villes</option>
                {villes.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={erMin} onChange={(e) => setErMin(Number(e.target.value))} className={IN} aria-label="Engagement minimum">
                <option value={0}>Engagement : tous</option>
                {[1, 2, 3, 5, 8].map((v) => <option key={v} value={v}>Engagement ≥ {v} %</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as (typeof SORTS)[number])} className={IN} aria-label="Trier">
                <option value="abonnes">Tri : abonnés</option>
                <option value="engagement">Tri : engagement</option>
                <option value="recent">Tri : lus récemment</option>
                <option value="nom">Tri : nom</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TIERS.map((t) => (
                <Chip key={t.id} on={tiers.has(t.id)} onClick={() => setTiers((s) => toggle(s, t.id))}>{t.label}</Chip>
              ))}
              <Chip on={actifs} onClick={() => setActifs(!actifs)}>A posté ces 30 jours</Chip>
              <Chip on={deals} onClick={() => setDeals(!deals)}>A déjà fait des partenariats</Chip>
              <Chip on={horsAgence} onClick={() => setHorsAgence(!horsAgence)}>Sans agence</Chip>
              <Chip on={cacherTtp} onClick={() => setCacherTtp(!cacherTtp)}>Cacher roster et Scouting</Chip>
              <Chip on={retires} onClick={() => setRetires(!retires)}>Voir les retirés (RGPD)</Chip>
            </div>
          </div>

          {/* Sélection */}
          {picked.size > 0 && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] text-background shadow-lg">
              <span className="font-semibold">{picked.size} sélectionné{picked.size > 1 ? "s" : ""}</span>
              <span className="opacity-60">→ ajouter à</span>
              <button type="button" onClick={() => void addPicked("new")} className="rounded-full bg-background/15 px-3 py-1 font-medium hover:bg-background/25">Nouvelle liste</button>
              {lists.slice(0, 4).map((l) => (
                <button key={l.id} type="button" onClick={() => void addPicked(l)} className="max-w-[180px] truncate rounded-full bg-background/15 px-3 py-1 font-medium hover:bg-background/25">{l.title}</button>
              ))}
              <button type="button" onClick={() => setPicked(new Set())} className="ml-auto opacity-70 hover:opacity-100">Annuler</button>
            </div>
          )}

          {/* Résultats */}
          {rows === null ? (
            <div className="flex items-center gap-2 p-6 text-[13px] text-muted-foreground"><Spin size={16} /> Chargement de la base…</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-[18px] bg-surface p-6 text-center text-[13px] text-muted-foreground">
              {creators.length === 0 ? (
                <>La base est vide pour l'instant. Elle se remplit à chaque passage des radars et de l'araignée.{" "}
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "araignee" }))} className="font-medium text-primary">Lancer l'araignée</button></>
              ) : active ? "Personne ne correspond à ces filtres." : retires ? "Personne n'a été retiré." : "Personne à montrer."}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[18px] bg-surface">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
                <span>{filtered.length.toLocaleString("fr-FR")} créateur{filtered.length > 1 ? "s" : ""}</span>
                <button type="button" onClick={() => setPicked(new Set(filtered.slice(0, shown).map((c) => c.username)))} className="font-medium text-primary">Tout sélectionner</button>
              </div>
              <ul className="divide-y divide-border">
                {filtered.slice(0, shown).map((c) => (
                  <CreatorRow
                    key={c.username}
                    c={c}
                    open={open === c.username}
                    picked={picked.has(c.username)}
                    onPick={() => setPicked((s) => toggle(s, c.username))}
                    onOpen={() => setOpen(open === c.username ? null : c.username)}
                    onMeta={(p) => saveMeta(c.username, p)}
                    onScouting={() => void toScouting(c)}
                    onRetirer={() => void retirer(c)}
                    onRemettre={() => void saveMeta(c.username, { excluded: false }).then((ok) => ok && toast(`@${c.username} remis dans la base`))}
                  />
                ))}
              </ul>
              {filtered.length > shown && (
                <button type="button" onClick={() => setShown((s) => s + 120)} className="w-full border-t border-border py-3 text-[13px] font-medium text-primary">
                  Voir plus ({(filtered.length - shown).toLocaleString("fr-FR")} restants)
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] text-faint">
            Chiffres relevés par Instagram au dernier passage. Niche et ville en gris : devinées dans la bio, à corriger dans la fiche. Les emails restent internes à l'agence et ne sont jamais montrés aux marques.
          </p>
        </>
      ) : (
        <Lists lists={lists} byUser={byUser} sqlMissing={sqlMissing} onNew={newList} onSave={saveList} onDeleted={(id) => setLists((ls) => ls.filter((l) => l.id !== id))} onReload={() => setReload((r) => r + 1)} />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("rounded-full border px-3 py-1 text-[12px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}

function Avatar({ src, name }: { src?: string; name: string }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? (
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-[12px] font-semibold text-muted-foreground">{name.slice(0, 1).toUpperCase()}</span>
  );
}

function CreatorRow(props: {
  c: Creator; open: boolean; picked: boolean; onPick: () => void; onOpen: () => void;
  onMeta: (p: Partial<Omit<Meta, "username">>) => Promise<boolean>; onScouting: () => void; onRetirer: () => void; onRemettre: () => void;
}) {
  const { c, open, picked } = props;
  const d = c.data;
  return (
    <li className={cn(picked && "bg-primary/[0.04]")}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input type="checkbox" checked={picked} onChange={props.onPick} aria-label={`Sélectionner @${c.username}`} className="h-4 w-4 shrink-0 accent-[var(--color-primary)]" />
        <button type="button" onClick={props.onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <Avatar src={d.picture} name={d.name || c.username} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold text-foreground">{d.name || `@${c.username}`}</span>
              {c.tag && <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{c.tag === "roster" ? "Roster" : "Scouting"}</span>}
              {d.agency && <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Agence</span>}
            </span>
            <span className="block truncate text-[12px] text-muted-foreground">
              @{c.username}
              {c.niche && <span className={cn(c.guessed && "text-faint")}> · {c.niche}</span>}
              {c.ville && <span> · {c.ville}</span>}
            </span>
          </span>
          <span className="hidden w-20 shrink-0 text-right sm:block">
            <span className="block font-mono text-[13px] text-foreground">{fmtCompact(d.followers ?? 0)}</span>
            <span className="block text-[11px] text-faint">abonnés</span>
          </span>
          <span className="hidden w-16 shrink-0 text-right sm:block">
            <span className="block font-mono text-[13px] text-foreground">{fmtEr(d.er)}</span>
            <span className="block text-[11px] text-faint">engag.</span>
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-[12px] text-muted-foreground sm:hidden">{fmtCompact(d.followers ?? 0)}</span>
        </button>
      </div>
      {open && <CreatorDetail {...props} />}
    </li>
  );
}

function CreatorDetail({ c, onMeta, onScouting, onRetirer, onRemettre }: Parameters<typeof CreatorRow>[0]) {
  const d = c.data;
  const [niche, setNiche] = useState(c.guessed ? "" : c.niche ?? "");
  const [ville, setVille] = useState(c.ville ?? "");
  const [note, setNote] = useState(c.note ?? "");
  const [hist, setHist] = useState<{ d: string; followers: number | null }[] | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.from("ig_profile_history").select("d, followers").eq("username", c.username).order("d").limit(120).then(({ data }) => {
      if (alive) setHist((data ?? []) as { d: string; followers: number | null }[]);
    });
    return () => {
      alive = false;
    };
  }, [c.username]);

  const pts = (hist ?? []).filter((h) => h.followers != null) as { d: string; followers: number }[];
  const delta = pts.length > 1 ? pts[pts.length - 1].followers - pts[0].followers : null;
  const save = async () => {
    const ok = await onMeta({ niche: niche.trim() || null, ville: ville.trim() || null, note: note.trim() || null });
    if (ok) toast("Fiche enregistrée ✓");
  };

  return (
    <div className="grid gap-4 border-t border-border bg-background/40 px-4 py-4 sm:grid-cols-[1fr_260px]">
      <div className="flex min-w-0 flex-col gap-3 text-[13px]">
        {d.bio && <p className="whitespace-pre-line text-foreground">{d.bio}</p>}
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-muted-foreground">Abonnés</dt>
          <dd className="font-mono text-foreground">
            {(d.followers ?? 0).toLocaleString("fr-FR")}
            {delta != null && <span className={cn("ml-2", delta >= 0 ? "text-primary" : "text-muted-foreground")}>{delta >= 0 ? "+" : ""}{fmtCompact(delta)} depuis le {new Date(pts[0].d).toLocaleDateString("fr-FR")}</span>}
          </dd>
          <dt className="text-muted-foreground">Engagement</dt><dd className="font-mono text-foreground">{fmtEr(d.er)}</dd>
          {d.perWeek != null && <><dt className="text-muted-foreground">Rythme</dt><dd className="text-foreground">{d.perWeek} post{d.perWeek > 1 ? "s" : ""} par semaine</dd></>}
          {d.lastPost && <><dt className="text-muted-foreground">Dernier post</dt><dd className="text-foreground">{fmtAgo(d.lastPost)}</dd></>}
          {d.agency && <><dt className="text-muted-foreground">Agence</dt><dd className="text-foreground">{d.agency}</dd></>}
          {d.email && <><dt className="text-muted-foreground">Email (interne)</dt><dd className="break-all text-foreground">{d.email}</dd></>}
          {d.website && <><dt className="text-muted-foreground">Site</dt><dd className="break-all text-foreground">{d.website}</dd></>}
          {!!d.deals?.length && <><dt className="text-muted-foreground">Partenariats</dt><dd className="text-foreground">{d.deals.map((b) => `@${b}`).join(" · ")}</dd></>}
          {!!d.cites?.length && <><dt className="text-muted-foreground">Marques citées</dt><dd className="text-muted-foreground">{d.cites.slice(0, 10).map((b) => `@${b}`).join(" · ")}</dd></>}
          {c.at && <><dt className="text-muted-foreground">Lu par TTP</dt><dd className="text-muted-foreground">{fmtAgo(c.at)}</dd></>}
        </dl>
        <div className="flex flex-wrap gap-2">
          <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="flex h-8 items-center rounded-full border border-border px-3 text-[12px] font-medium text-foreground hover:border-foreground/40">Ouvrir Instagram</a>
          {!c.tag && !c.excluded && <button type="button" onClick={onScouting} className="h-8 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background">Ajouter au Scouting</button>}
          {c.excluded ? (
            <button type="button" onClick={onRemettre} className="h-8 rounded-full border border-border px-3 text-[12px] font-medium text-foreground">Remettre dans la base</button>
          ) : (
            <button type="button" onClick={onRetirer} className="h-8 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground">Retirer (RGPD)</button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-[12px] font-medium text-muted-foreground" htmlFor={`n-${c.username}`}>Niche</label>
        <select id={`n-${c.username}`} value={niche} onChange={(e) => setNiche(e.target.value)} className={IN}>
          <option value="">{c.guessed && c.niche ? `Devinée : ${c.niche}` : "Pas de niche"}</option>
          {CREATOR_NICHES.map((n) => <option key={n.label} value={n.label}>{n.label}</option>)}
        </select>
        <label className="text-[12px] font-medium text-muted-foreground" htmlFor={`v-${c.username}`}>Ville</label>
        <input id={`v-${c.username}`} value={ville} onChange={(e) => setVille(e.target.value)} list="base-villes" placeholder="Ex. Lyon" className={IN} />
        <datalist id="base-villes">{VILLES.map((v) => <option key={v} value={v} />)}</datalist>
        <label className="text-[12px] font-medium text-muted-foreground" htmlFor={`o-${c.username}`}>Note de l'agence</label>
        <textarea id={`o-${c.username}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Jamais montrée aux marques" className="rounded-[14px] border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary" />
        <button type="button" onClick={() => void save()} className="h-9 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">Enregistrer</button>
      </div>
    </div>
  );
}

function Lists(props: {
  lists: List[]; byUser: Record<string, Creator>; sqlMissing: boolean;
  onNew: (title: string) => Promise<List | null>; onSave: (l: List, p: Partial<List>) => Promise<boolean>; onDeleted: (id: string) => void; onReload: () => void;
}) {
  const { lists, byUser, sqlMissing } = props;
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(lists[0]?.id ?? null);

  const create = async () => {
    setBusy(true);
    const l = await props.onNew(title);
    setBusy(false);
    if (l) {
      setTitle("");
      setOpen(l.id);
      toast("Liste créée. Ajoute des créateurs depuis « La base » (cases à cocher).");
    }
  };

  const remove = async (l: List) => {
    if (!window.confirm(`Supprimer la liste « ${l.title} » ?${l.public ? "\n\nSon lien public ne marchera plus." : ""}`)) return;
    const { error } = await supabase.from("creator_lists").delete().eq("id", l.id);
    if (error) return toast("Erreur, réessaie");
    props.onDeleted(l.id);
    toast("Liste supprimée");
  };

  const copy = async (l: List) => {
    try {
      await navigator.clipboard.writeText(SITE + l.slug);
      toast("Lien copié ✓");
    } catch {
      window.prompt("Copie le lien :", SITE + l.slug);
    }
  };

  if (sqlMissing) {
    return <div className="rounded-[18px] bg-surface p-6 text-[13px] text-muted-foreground">Les listes arrivent dès que le SQL <span className="font-mono">2026-11-16-base-createurs.sql</span> est lancé.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex flex-wrap gap-2 rounded-[18px] bg-surface p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle liste : « Running Lyon pour Decathlon »" className={cn(IN, "min-w-0 flex-1 bg-background")} aria-label="Nom de la nouvelle liste" />
        <button type="submit" disabled={!title.trim() || busy} className="h-9 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40">Créer</button>
      </form>

      {lists.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[18px] bg-surface p-8 text-center text-[13px] text-muted-foreground">
          <TtpSpider className="h-6 w-6 text-faint" />
          Pas encore de liste. Crée-en une ici, ou coche des créateurs dans « La base » puis « Nouvelle liste ».
        </div>
      ) : (
        lists.map((l) => (
          <ListCard key={l.id} l={l} byUser={byUser} open={open === l.id} onOpen={() => setOpen(open === l.id ? null : l.id)} onSave={(p) => props.onSave(l, p)} onCopy={() => void copy(l)} onRemove={() => void remove(l)} />
        ))
      )}
      <p className="text-[11px] text-faint">
        Une liste publique se lit sans compte sur ttpcreators.pro/selection/, à qui a le lien (la page n'est pas référencée sur Google). Elle montre la photo, le nom, le compte, la niche, la ville, les abonnés, l'engagement et le rythme. Jamais d'email, de bio ni de note.
      </p>
    </div>
  );
}

function ListCard({ l, byUser, open, onOpen, onSave, onCopy, onRemove }: {
  l: List; byUser: Record<string, Creator>; open: boolean; onOpen: () => void; onSave: (p: Partial<List>) => Promise<boolean>; onCopy: () => void; onRemove: () => void;
}) {
  const [brand, setBrand] = useState(l.brand ?? "");
  const [intro, setIntro] = useState(l.intro ?? "");
  const [title, setTitle] = useState(l.title);
  const people = l.usernames.map((u) => byUser[u]).filter((c): c is Creator => !!c && !c.excluded);
  const reach = people.reduce((s, c) => s + (c.data.followers ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-[18px] bg-surface">
      <button type="button" onClick={onOpen} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-foreground">{l.title}</span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {people.length} créateur{people.length > 1 ? "s" : ""} · {fmtCompact(reach)} abonnés cumulés{l.brand ? ` · pour ${l.brand}` : ""}
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", l.public ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}>{l.public ? "Lien actif" : "Privée"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== l.title && void onSave({ title: title.trim() })} className={cn(IN, "bg-background")} aria-label="Titre de la liste" />
            <input value={brand} onChange={(e) => setBrand(e.target.value)} onBlur={() => brand !== (l.brand ?? "") && void onSave({ brand: brand.trim() || null })} placeholder="Pour quelle marque ?" className={cn(IN, "bg-background")} aria-label="Marque" />
          </div>
          <textarea value={intro} onChange={(e) => setIntro(e.target.value)} onBlur={() => intro !== (l.intro ?? "") && void onSave({ intro: intro.trim() || null })} rows={2} placeholder="Un mot pour la marque, en haut de la page (facultatif)" className="rounded-[14px] border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary" aria-label="Introduction" />
          {people.length === 0 ? (
            <div className="text-[12px] text-faint">Liste vide. Va dans « La base », coche des créateurs, puis choisis cette liste.</div>
          ) : (
            <ul className="divide-y divide-border rounded-[14px] bg-background/50">
              {people.map((c) => (
                <li key={c.username} className="flex items-center gap-3 px-3 py-2">
                  <Avatar src={c.data.picture} name={c.data.name || c.username} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{c.data.name || `@${c.username}`}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">@{c.username}{c.niche ? ` · ${c.niche}` : ""}{c.ville ? ` · ${c.ville}` : ""}</span>
                  </span>
                  <span className="font-mono text-[12px] text-foreground">{fmtCompact(c.data.followers ?? 0)}</span>
                  <span className="hidden w-14 text-right font-mono text-[12px] text-muted-foreground sm:block">{fmtEr(c.data.er)}</span>
                  <button type="button" onClick={() => void onSave({ usernames: l.usernames.filter((u) => u !== c.username) })} className="text-[12px] text-muted-foreground hover:text-foreground" aria-label={`Retirer @${c.username} de la liste`}>Retirer</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onSave({ public: !l.public }).then((ok) => ok && toast(l.public ? "Lien désactivé" : "Lien activé : la marque peut ouvrir la liste"))}
              className={cn("h-9 rounded-full px-4 text-[13px] font-semibold", l.public ? "border border-border text-foreground" : "bg-foreground text-background")}
            >
              {l.public ? "Désactiver le lien" : "Activer le lien pour la marque"}
            </button>
            {l.public && (
              <>
                <button type="button" onClick={onCopy} className="h-9 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground">Copier le lien</button>
                <a href={SITE + l.slug} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-primary">Voir la page</a>
              </>
            )}
            <button type="button" onClick={onRemove} className="ml-auto text-[12px] text-muted-foreground hover:text-foreground">Supprimer la liste</button>
          </div>
        </div>
      )}
    </div>
  );
}

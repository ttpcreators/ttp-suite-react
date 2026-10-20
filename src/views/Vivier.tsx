import { useStickyState } from "@/lib/useStickyState";
import { fmtCompact } from "@/lib/timeSeries";
import { Spin } from "@/components/ui/loader";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, TextField, AutoGrowTextField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { useAppState, mergeAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import GlassStatChart from "@/components/ui/glass-stat-chart";
import { Mail, Pencil, Trash2, X, Send, Sparkles, ArrowUpRight, Plus, Camera, Hash, Globe, Search, Check, ChevronDown, Copy } from "lucide-react";
import { igWhyText, fmtEr, fmtPerWeek, noteQuota } from "@/lib/instagram";
import { MetaQuotaBadge } from "@/components/MetaQuotaBadge";
import { HashtagSearch } from "@/components/HashtagSearch";
import { FEATURES } from "@/lib/features";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusPill } from "@/components/ui/status-pill";
import { IconTile } from "@/components/ui/icon-tile";
import { TONE_DOT, TONE_SOFT } from "@/lib/statusTone";
import { SCOUT_SORTS, SCOUT_STEPS, SCOUT_TONE, engagementBarPct, engagementTone, nextScoutStep, sortScouting, stepState, type ScoutSort, type ScoutStatus } from "@/lib/scouting";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { DateInput } from "@/components/ui/date-range-picker";
import { todayISO } from "@/lib/dates";
import { Overlay } from "@/components/mobile/ios-sheet";
import { useNavSub, useSetNavSub } from "@/lib/navSub";
import { CREATOR_NICHES, SPORTS, guessNiche } from "@/lib/niche";

/**
 * VIVIER créateurs (hors roster) : répertoire de créateurs à SOLLICITER pour des
 * campagnes / recrutement. Réservé à l'agence (RLS is_agency()). Champs : nom,
 * @handle, email, niche (tag), note. Filtre par niche + « déjà contactés »
 * (suivi last_contacted), et bouton « Solliciter » qui envoie un email (Resend)
 * et marque le contact.
 */

type Row = {
  id: string;
  name: string;
  handle: string | null;
  email: string | null;
  tag: string | null; // créateurs : catégorie ; sportifs : sport
  note: string | null;
  last_contacted: string | null;
  sort_order: number;
  club?: string | null; // sportifs seulement
  level?: string | null; // sportifs seulement (Pro, Espoir…)
};

/**
 * Deux scoutings séparés : les créateurs (table creator_pool, utilisée aussi par le
 * Sourcing et les radars) et les sportifs (table athlete_pool : sport, club, niveau).
 * Même page, mêmes outils (statut, photo et chiffres Instagram, relevés d'abonnés, mail).
 */
type Kind = "createurs" | "sportifs";
const KIND = {
  createurs: {
    table: "creator_pool", cache: "vivier", track: "poolTracking",
    one: "créateur", many: "créateurs", add: "Créateur",
    catLabel: "Catégorie", catPh: "Ex : Mode, Sport, Beauté", allCats: "Toutes les catégories",
    namePh: "Ex : Léna Marchand", handlePh: "@lena.mrchd", emailPh: "lena@email.com",
    newTitle: "Nouveau créateur à suivre", editTitle: "Modifier le créateur",
    empty: "Ton scouting est vide. Ajoute des créateurs à repérer / solliciter le jour où tu en as besoin ✨",
  },
  sportifs: {
    table: "athlete_pool", cache: "vivier-sportifs", track: "athleteTracking",
    one: "sportif", many: "sportifs", add: "Sportif",
    catLabel: "Sport", catPh: "Ex : Football, Tennis, Boxe", allCats: "Tous les sports",
    namePh: "Ex : Yanis Benali", handlePh: "@yanis.bnl", emailPh: "yanis@email.com",
    newTitle: "Nouveau sportif à suivre", editTitle: "Modifier le sportif",
    empty: "Aucun sportif pour l'instant. Ajoute ceux que tu repères : sport, club, niveau, Instagram.",
  },
} as const;
const LEVELS = ["Pro", "Semi-pro", "Espoir", "Amateur"];

const ALL = "__all__";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

/** Chaîne YouTube (ajoutée depuis le Sourcing YouTube) plutôt qu'un @ Instagram. */
const isYtHandle = (handle?: string | null) => /youtube\.com|youtu\.be/i.test(handle ?? "");
/** @handle → nom d'utilisateur nettoyé (sans @, sans URL). YouTube : le @ de la chaîne. */
const igName = (handle?: string | null) =>
  isYtHandle(handle)
    ? /@([\w.-]+)/.exec(handle ?? "")?.[1] ?? "chaîne YouTube"
    : (handle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?].*$/, "").replace(/\s/g, "");
/** Clé de catégorie : sans espaces ni majuscules (« Mode » = « mode »). */
const tagKey = (t: string) => t.trim().toLocaleLowerCase("fr");
/** URL du profil Instagram (ou de la chaîne YouTube), ou "" si pas de handle. */
const igUrl = (handle?: string | null) => {
  if (isYtHandle(handle)) {
    const h = (handle ?? "").trim();
    return /^https?:\/\//i.test(h) ? h : `https://${h.replace(/^\/+/, "")}`;
  }
  const h = igName(handle);
  return h ? `https://www.instagram.com/${h}/` : "";
};

/**
 * Photo du créateur : celle ajoutée à la main (clic sur le rond dans sa fiche),
 * sinon sa photo Instagram, sinon ses initiales. Une image qui ne charge pas
 * passe à la suivante.
 */
function ScoutAvatar({ name, photos, size, className, tint = "bg-panel text-foreground" }: { name: string; photos: (string | null | undefined)[]; size: number; className?: string; /** Fond + texte des initiales (teinte du statut). */ tint?: string }) {
  const list = photos.filter(Boolean) as string[];
  const [failed, setFailed] = useState(0);
  const sig = list.join("|");
  useEffect(() => setFailed(0), [sig]);
  const src = list[failed];
  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden font-bold", tint, className)} style={{ width: size, height: size }}>
      {initials(name)}
      {src && (
        <img src={src} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} className="absolute inset-0 h-full w-full bg-panel object-cover" />
      )}
    </div>
  );
}

/** Raisons « pas maintenant » : on retente à la visite suivante. */
const IG_RETRY_NOW = new Set(["page_429", "pause", "meta_non_configure", "meta_limite", "meta_jeton", "erreur"]);
/** Une photo trouvée (ou un compte perso) est revérifiée après 30 jours, une introuvable le lendemain. */
const igStale = (t: Track | undefined, handle: string) => {
  if (!t?.igAt || t.igFor !== handle) return true;
  if (!t.igPhoto && t.igV !== IG_V) return true;
  if (t.igV !== IG_V && t.igEr === undefined) return true; // chiffres (engagement, rythme…) jamais demandés
  if (t.igV !== IG_V && t.igNiche === undefined) return true; // niche jamais devinée
  if (!t.igPhoto && IG_RETRY_NOW.has(t.igWhy ?? "")) return true;
  const days = (Date.now() - new Date(t.igAt + "T00:00:00").getTime()) / 86400000;
  return days > (t.igPhoto || t.igWhy === "compte_perso" ? 30 : 1);
};
/** @ déjà demandés pendant cette visite (évite de redemander en boucle). */
const igAsked = new Set<string>();

// ── Scouting : statut de pipeline + suivi d'abonnés dans le temps ──
// Couleurs : lib/scouting.ts (SCOUT_TONE). short = filtre du haut, label = pastille, step = « Où on en est ».
const STATUSES: { v: ScoutStatus; short: string; label: string; step: string }[] = [
  { v: "observation", short: "Observation", label: "En observation", step: "Observation" },
  { v: "contacter", short: "À contacter", label: "À contacter", step: "À contacter" },
  { v: "discussion", short: "Discussion", label: "En discussion", step: "En discussion" },
  { v: "signe", short: "Signé", label: "Signé", step: "Signé" },
  { v: "ecarte", short: "Écarté", label: "Écarté", step: "Écarté" },
];
const statusMeta = (v: ScoutStatus) => STATUSES.find((s) => s.v === v) ?? STATUSES[0];

/** Libellés du tri et du filtre « Contact ». */
const SORT_LABEL: Record<ScoutSort, string> = { abonnes: "abonnés", engagement: "engagement", evolution: "évolution", nom: "nom", ajout: "ordre d'ajout" };
const CONTACT_LABEL = { all: "tous", contacted: "déjà contactés", never: "jamais contactés" } as const;
type ContactFilter = keyof typeof CONTACT_LABEL;

/** Grand écran (≥ 1024 px) : la fiche s'affiche dans la colonne de droite. */
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

type PillOpt = { value: string; label: string; count?: number };
/** Pilule de filtre à menu (« Toutes les catégories ⌄ », « Trier : abonnés ⌄ »). Active = teinte de l'accent. */
function PillMenu({ label, value, options, onChange, active, ariaLabel }: { label: string; value: string; options: PillOpt[]; onChange: (v: string) => void; active?: boolean; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-8 min-w-0 max-w-full items-center gap-1 rounded-full border px-3 text-[12px] font-medium transition-colors",
            active ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-border text-foreground hover:bg-rowhover",
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(24rem,70dvh)] w-[min(16rem,calc(100vw-2rem))] overflow-y-auto p-1.5">
        <div className="flex flex-col gap-0.5">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }} className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover", on && "bg-field")}>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="shrink-0 tabular-nums text-muted-foreground">{o.count}</span>}
                <Check className={cn("h-4 w-4 shrink-0 text-primary", !on && "invisible")} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Snap = { date: string; value: number }; // date = ISO « AAAA-MM-JJ »
/** photo = ajoutée à la main ; igPhoto = photo Instagram copiée par la fonction ig-avatar
 *  (igFor = le @ pour lequel elle a été cherchée, igAt = quand ; null = introuvable).
 *  igEr / igPw / igBio / igSite / igPosts = chiffres publics donnés par Meta au même moment. */
type Track = {
  status?: ScoutStatus; snaps?: Snap[]; photo?: string;
  igPhoto?: string | null; igFor?: string; igAt?: string; igWhy?: string; igV?: number;
  igEr?: number | null; igPw?: number | null; igBio?: string; igSite?: string; igPosts?: number;
  /** Niche devinée par l'app (bio, nom, légendes) quand aucune catégorie n'est saisie ; null = rien de clair. */
  igNiche?: string | null;
};
type IgStats = { er: number | null; perWeek: number | null; posts: number; bio: string; website: string; name?: string; captions?: string };
/** Version de la recherche Instagram : la monter refait les recherches ratées (et sans chiffres). */
const IG_V = 5; // 5 : légendes des posts lues pour deviner la niche
type Tracking = Record<string, Track>;

/** ISO « 2026-08-12 » → « 12 août ». */
const frShort = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
/** Lit un nombre d'abonnés saisi à la main : « 225 909 », « 226K », « 1,2M ». */
const parseFol = (s: string) => {
  const t = s.trim().toLowerCase().replace(/\s/g, "").replace(",", ".");
  const m = /^([0-9.]+)([km]?)$/.exec(t);
  if (!m) return 0;
  let n = parseFloat(m[1]) || 0;
  if (m[2] === "k") n *= 1e3;
  else if (m[2] === "m") n *= 1e6;
  return Math.round(n);
};

/** Ouvre la page Sourcing sur « Trouver des créateurs » (pour y repérer des sportifs). */
const goSourcing = () => {
  try {
    localStorage.setItem("ttp:sourcing-tab", "createurs");
  } catch {
    /* stockage indisponible */
  }
  window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "sourcing" }));
};
/** Lien discret vers le Sourcing, sur l'onglet Sportifs. */
function SourcingLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={goSourcing} className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline", className)}>
      <Search className="h-3.5 w-3.5" /> Trouver des sportifs avec le Sourcing
    </button>
  );
}

/** Scouting : sous-pages Créateurs / Sportifs (choix remonté à la sidebar). */
export function Vivier() {
  const sub = useNavSub();
  const setNavSub = useSetNavSub();
  const [kind, setKind] = useState<Kind>(sub === "sportifs" ? "sportifs" : "createurs");
  useEffect(() => {
    if (sub === "createurs" || sub === "sportifs") setKind(sub);
  }, [sub]);
  // Créateurs / Sportifs : contrôle segmenté de l'en-tête (rendu par la liste, qui tient l'en-tête).
  const switcher = (
    <Tabs
      label="Sous-pages Scouting"
      value={kind}
      onValueChange={(v) => {
        setKind(v as Kind);
        setNavSub(v);
      }}
      items={[{ value: "createurs", label: "Créateurs" }, { value: "sportifs", label: "Sportifs" }]}
    />
  );
  return <ScoutingList key={kind} kind={kind} switcher={switcher} />;
}

function ScoutingList({ kind, switcher }: { kind: Kind; switcher: ReactNode }) {
  const K = KIND[kind];
  const athletes = kind === "sportifs";
  const NICHES = athletes ? SPORTS : CREATOR_NICHES;
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>(K.cache));
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(false); // table pas encore créée (mise à jour SQL en attente)
  const { query } = useSearch();
  const live = useLiveKey();

  const [tagFilter, setTagFilter] = useState(ALL);
  const [contactFilter, setContactFilter] = useStickyState<ContactFilter>("scouting:contact", ["all", "contacted", "never"], "all");
  const [sortBy, setSortBy] = useStickyState<ScoutSort>("scouting:tri", SCOUT_SORTS, "abonnes");

  // Formulaire (ajout / édition)
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fName, setFName] = useState("");
  const [fHandle, setFHandle] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fTag, setFTag] = useState("");
  const [fNote, setFNote] = useState("");
  const [fClub, setFClub] = useState("");
  const [otherCat, setOtherCat] = useState(false); // champ libre « Autre » ouvert
  const [fLevel, setFLevel] = useState("");

  // Fiche (détail au clic sur une ligne) : colonne de droite sur grand écran, feuille du bas sinon.
  const wide = useWide();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  // Sollicitation email
  const [mailRow, setMailRow] = useState<Row | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Scouting : statut + historique d'abonnés (blob app_state — pas de SQL).
  const { data: trackData } = useAppState<Tracking>((s: AppState) => (s[K.track] as Tracking) ?? {});
  const [localTrack, setLocalTrack] = useState<Tracking | null>(null);
  // La copie locale (optimiste) cède dès que la donnée live change (tick suivant, qui
  // inclut l'écriture) : sinon les changements faits ailleurs resteraient masqués.
  useEffect(() => { setLocalTrack(null); }, [trackData]);
  const tracking = localTrack ?? trackData ?? {};
  const [statusFilter, setStatusFilter] = useStickyState<ScoutStatus | "__all__">("scouting:statut", ["__all__", "observation", "contacter", "discussion", "signe", "ecarte"], "__all__");
  const [snapDate, setSnapDate] = useState(() => todayISO()); // date locale (pas UTC)
  const [snapVal, setSnapVal] = useState("");

  const statusOf = (id: string): ScoutStatus => tracking[id]?.status ?? "observation";
  const photosOf = (id: string) => [tracking[id]?.photo, tracking[id]?.igPhoto];

  // Photos Instagram : demandées à la fonction ig-avatar pour les @ sans photo à jour,
  // puis gardées avec le suivi du scouting. Si la fonction n'est pas en ligne : initiales.
  useEffect(() => {
    if (!rows || trackData === null) return;
    const want = rows
      .filter((r) => !isYtHandle(r.handle)) // une chaîne YouTube n'a pas de profil Instagram à lire
      .map((r) => ({ id: r.id, h: igName(r.handle) }))
      .filter((x) => x.h && !igAsked.has(x.h) && igStale(tracking[x.id], x.h))
      .slice(0, 20);
    if (!want.length) return;
    want.forEach((x) => igAsked.add(x.h));
    void supabase.functions.invoke("ig-avatar", { body: { handles: want.map((x) => x.h) } }).then(async ({ data, error: fnErr }) => {
      noteQuota(data);
      const res = data as { photos?: Record<string, string | null>; followers?: Record<string, number>; stats?: Record<string, IgStats>; why?: Record<string, string> } | null;
      const photos = res?.photos;
      if (fnErr || !photos) return;
      try {
        invalidateAppState();
        const fresh = ((await getAppState())[K.track] as Tracking) ?? {};
        const next = { ...fresh };
        const set: Tracking = {}; // seules les fiches relues ici sont envoyées
        const at = todayISO();
        for (const x of want) {
          if (!(x.h in photos)) continue;
          const cur = fresh[x.id] ?? {};
          // Abonnés donnés par Meta : relevé du jour ajouté, sans écraser un relevé saisi à la main.
          const n = res?.followers?.[x.h];
          const snaps = typeof n === "number" && !(cur.snaps ?? []).some((sn) => sn.date === at) ? [...(cur.snaps ?? []), { date: at, value: n }] : cur.snaps;
          const st = res?.stats?.[x.h];
          const figures = st
            ? { igEr: st.er, igPw: st.perWeek, igBio: st.bio, igSite: st.website, igPosts: st.posts, igNiche: guessNiche([st.name, st.bio, st.captions].filter(Boolean).join(" \n "), NICHES) }
            : {};
          next[x.id] = set[x.id] = { ...cur, ...figures, snaps, igPhoto: photos[x.h], igFor: x.h, igAt: at, igWhy: res?.why?.[x.h], igV: IG_V };
        }
        setLocalTrack(next);
        await mergeAppStateKey(K.track, set);
      } catch {
        /* les initiales restent */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, trackData]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [hashOpen, setHashOpen] = useState(false);
  // Photo ajoutée à la main (bucket public « avatars »), gardée avec le suivi du scouting.
  const uploadPhoto = async (r: Row, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choisis une image");
    if (file.size > 5 * 1024 * 1024) return toast("Image trop lourde (max 5 Mo)");
    setPhotoBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `scouting/${r.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: false, cacheControl: "3600", contentType: file.type });
    if (upErr) {
      setPhotoBusy(false);
      return toast("Photo non envoyée, réessaie");
    }
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await mutateTracking(r.id, (t) => ({ ...t, photo: url }), "Photo enregistrée ✓");
    setPhotoBusy(false);
  };
  /** Niche devinée via Instagram (sans catégorie saisie) ; ancienne fiche : devinée sur la bio seule. */
  const autoTag = (r: Row): string | null => {
    if (r.tag?.trim()) return null;
    const t = tracking[r.id];
    if (!t) return null;
    if (t.igNiche !== undefined) return t.igNiche;
    return t.igBio ? guessNiche(t.igBio, NICHES) : null;
  };
  const effTag = (r: Row) => r.tag?.trim() || autoTag(r) || "";
  const snapsOf = (id: string): Snap[] => [...(tracking[id]?.snaps ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latestFollowers = (id: string): number | null => { const s = snapsOf(id); return s.length ? s[s.length - 1].value : null; };
  const growthOf = (id: string): number => { const s = snapsOf(id); return s.length >= 2 ? s[s.length - 1].value - s[s.length - 2].value : 0; };
  // Optimiste avec retour arrière si l'écriture échoue ; toast de succès après la sauvegarde.
  const mutateTracking = async (id: string, fn: (t: Track) => Track, okMsg?: string) => {
    const prev = localTrack;
    try {
      invalidateAppState();
      const fresh = ((await getAppState())[K.track] as Tracking) ?? {};
      const entry = fn(fresh[id] ?? {});
      const next = { ...fresh, [id]: entry };
      setLocalTrack(next);
      // N'envoie QUE la fiche de ce profil (fusion côté base).
      if (await mergeAppStateKey(K.track, { [id]: entry })) {
        if (okMsg) toast(okMsg);
        return;
      }
    } catch {
      /* traité ci-dessous */
    }
    setLocalTrack(prev);
    toast("Erreur, réessaie");
  };
  const setStatus = (id: string, status: ScoutStatus) => mutateTracking(id, (t) => ({ ...t, status }));
  const addSnap = (id: string, date: string, value: number) =>
    mutateTracking(id, (t) => ({ ...t, snaps: [...(t.snaps ?? []).filter((s) => s.date !== date), { date, value }] }), "Relevé enregistré ✓");
  const delSnap = (id: string, date: string) =>
    mutateTracking(id, (t) => ({ ...t, snaps: (t.snaps ?? []).filter((s) => s.date !== date) }));

  useEffect(() => {
    let alive = true;
    supabase.from(K.table).select("*").order("sort_order").then(({ data, error }) => {
      if (!alive) return;
      // Rafraîchissement raté : on garde la liste déjà affichée (l'erreur ne
      // s'affiche que si rien n'est encore chargé).
      if (error) {
        setError(true);
        if (error.code === "42P01" || error.code === "PGRST205") setMissing(true);
        return;
      }
      const list = (data as Row[]) ?? [];
      setError(false);
      setMissing(false);
      setCache(K.cache, list);
      setRows(list);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Catégories (niche) : « Mode » et « mode » comptent pour une seule, la plus fréquente d'abord.
  const tagList = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const r of rows ?? []) {
      const label = effTag(r);
      if (!label) continue;
      const key = tagKey(label);
      const cur = m.get(key);
      if (cur) cur.count++;
      else m.set(key, { key, label, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tracking]);

  const openAdd = () => { setEditId(null); setFName(""); setFHandle(""); setFEmail(""); setFTag(""); setFNote(""); setFClub(""); setFLevel(""); setOtherCat(false); setFormOpen(true); };
  const openEdit = (r: Row) => { setOtherCat(false); setEditId(r.id); setFName(r.name); setFHandle(r.handle ?? ""); setFEmail(r.email ?? ""); setFTag(r.tag ?? ""); setFNote(r.note ?? ""); setFClub(r.club ?? ""); setFLevel(r.level ?? ""); setFormOpen(true); };

  const submit = async () => {
    if (!fName.trim()) { toast(`Renseigne le nom du ${K.one}`); return; }
    const payload: Record<string, string | null> = { name: fName.trim(), handle: fHandle.trim() || null, email: fEmail.trim() || null, tag: fTag.trim() || null, note: fNote.trim() || null };
    if (athletes) {
      payload.club = fClub.trim() || null;
      payload.level = fLevel.trim() || null;
    }
    if (editId) {
      // Écriture d'abord : la fiche ne se ferme et la liste ne change qu'en cas de succès.
      if (!(await dbUpdate(K.table, editId, payload))) { toast("Erreur, réessaie"); return; }
      setRows((prev) => {
        const next = (prev ?? []).map((r) => (r.id === editId ? { ...r, ...payload } : r));
        setCache(K.cache, next);
        return next;
      });
      setFormOpen(false);
      toast(`${K.add} mis à jour ✓`);
      return;
    }
    const created = await dbInsert(K.table, { ...payload, sort_order: nextOrder(rows ?? []) });
    if (!created) { toast("Erreur, réessaie"); return; }
    const next = [created as unknown as Row, ...(rows ?? [])];
    setRows(next); setCache(K.cache, next); setFormOpen(false);
    toast(`${K.add} ajouté au scouting ✓`);
  };

  const remove = async (r: Row) => {
    if (await dbTrash(K.table, r.id, r.name, undefined)) {
      const next = (rows ?? []).filter((x) => x.id !== r.id);
      setRows(next); setCache(K.cache, next);
      toast("Déplacé dans la corbeille");
    } else toast("Erreur, réessaie");
  };

  const openMail = (r: Row) => {
    if (!r.email || !EMAIL_RE.test(r.email)) { toast(`Ce ${K.one} n'a pas d'email valide`); return; }
    setMailRow(r);
    setSubject("Collaboration avec TTP Creators ✨");
    setMessage(`Bonjour ${r.name.split(" ")[0] || ""},\n\n`);
  };

  const sendSolicit = async () => {
    if (!mailRow?.email || sending) return;
    if (!subject.trim() || !message.trim()) { toast("Renseigne l'objet et le message"); return; }
    setSending(true);
    try {
      const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#18181b;white-space:pre-wrap">${esc(message)}</div>`;
      const { data, error } = await supabase.functions.invoke("send-email", { body: { to: [mailRow.email], subject: subject.trim(), html } });
      const res = (data ?? null) as { ok?: boolean; detail?: string } | null;
      if (error || !res?.ok) { toast(res?.detail ? `Échec : ${res.detail}` : "Envoi échoué, réessaie"); return; }
      const when = new Date().toISOString();
      const next = (rows ?? []).map((r) => (r.id === mailRow.id ? { ...r, last_contacted: when } : r));
      setRows(next); setCache(K.cache, next);
      const saved = await dbUpdate(K.table, mailRow.id, { last_contacted: when }).catch(() => false);
      toast(saved ? `Email envoyé à ${mailRow.name} ✓` : `Email envoyé à ${mailRow.name}, mais le suivi n'a pas été enregistré`);
      setMailRow(null);
    } finally {
      setSending(false);
    }
  };

  // En-tête : Créateurs / Sportifs à gauche ; quota Meta, Hashtag et « + » à droite.
  const header = (withActions: boolean) => (
    <PageHeaderRow>
      {switcher}
      {withActions && (
        <div className="flex items-center gap-2">
          <MetaQuotaBadge compact />
          {FEATURES.hashtagSearch && (
            <button type="button" onClick={() => setHashOpen((o) => !o)} aria-pressed={hashOpen} className={cn("flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors", hashOpen ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
              <Hash className="h-3.5 w-3.5" /> Hashtag
            </button>
          )}
          <AddButton round label={K.add} onClick={openAdd} />
        </div>
      )}
    </PageHeaderRow>
  );

  if (missing && rows === null) return <>{header(false)}<div className="rounded-[22px] border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">Le scouting des {K.many} n'est pas encore activé : une mise à jour est en attente.</div></>;
  if (error && rows === null) return <>{header(false)}<div className="rounded-[22px] bg-surface px-4 py-6 text-sm text-muted-foreground">Impossible de charger le Scouting.</div></>;
  if (rows === null) return <>{header(false)}<AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge></>;

  const filtered = sortScouting(
    rows.filter((r) => {
      if (tagFilter !== ALL && tagKey(effTag(r)) !== tagFilter) return false;
      if (statusFilter !== "__all__" && statusOf(r.id) !== statusFilter) return false;
      if (contactFilter === "contacted" && !r.last_contacted) return false;
      if (contactFilter === "never" && r.last_contacted) return false;
      return matchQuery(query, r.name, r.handle, r.email, r.tag, r.note, r.club, r.level);
    }),
    sortBy,
    (r) => ({
      name: r.name,
      followers: latestFollowers(r.id),
      er: tracking[r.id]?.igEr ?? null,
      growth: snapsOf(r.id).length >= 2 ? growthOf(r.id) : null,
    }),
  );
  const filtering = tagFilter !== ALL || contactFilter !== "all" || statusFilter !== "__all__" || !!query.trim();
  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const showInspector = wide && rows.length > 0;

  /** Clic sur une ligne : la fiche (colonne de droite, ou feuille du bas sur petit écran). */
  const pick = (id: string) => {
    setSelectedId(id);
    if (!wide) setSheet(true);
  };
  /** Ouvre le mail / le formulaire : sur petit écran la feuille se ferme d'abord. */
  const fromSheet = (fn: () => void) => {
    if (!wide) setSheet(false);
    fn();
  };
  const growthText = (g: number) => `${g >= 0 ? "+" : "−"}${fmtCompact(Math.abs(g))}`;

  /** Actions d'un profil (menu ⋯ de la ligne et de la fiche). */
  const menuFor = (r: Row) => [
    { key: "edit", label: "Modifier", icon: Pencil, onClick: () => fromSheet(() => openEdit(r)) },
    ...(r.email ? [{ key: "mail", label: "Écrire", icon: Send, onClick: () => fromSheet(() => openMail(r)) }] : []),
    ...(igUrl(r.handle) ? [{ key: "open", label: isYtHandle(r.handle) ? "Ouvrir la chaîne YouTube" : "Ouvrir le profil Instagram", icon: ArrowUpRight, onClick: () => window.open(igUrl(r.handle), "_blank", "noopener,noreferrer") }] : []),
    { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => remove(r), confirm: { title: "Retirer du scouting", message: `Retirer « ${r.name} » du scouting ? Tu pourras le restaurer depuis la corbeille.` } },
  ];

  /** Pastille de catégorie : saisie (fond gris) ou devinée via Instagram (pointillés). */
  const tagPill = (r: Row) =>
    r.tag?.trim() ? (
      <span className="inline-flex h-5 max-w-[45%] shrink-0 items-center truncate rounded-full bg-field px-2 text-[11px] font-medium text-muted-foreground">{r.tag.trim()}</span>
    ) : autoTag(r) ? (
      <span title="Devinée via Instagram (bio et derniers posts). Modifie la fiche pour la fixer." className="inline-flex h-5 max-w-[45%] shrink-0 items-center gap-1 truncate rounded-full border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground">
        <Sparkles className="h-2.5 w-2.5 shrink-0" />{autoTag(r)}
      </span>
    ) : null;

  // ── Fiche du profil sélectionné (colonne de droite ou feuille du bas) ──
  const renderInspector = (r: Row, inSheet: boolean) => {
    const st = statusOf(r.id);
    const t = tracking[r.id];
    const fol = latestFollowers(r.id);
    const snaps = snapsOf(r.id);
    const g = snaps.length >= 2 ? growthOf(r.id) : null;
    const next = nextScoutStep(st);
    const url = igUrl(r.handle);
    const handleTxt = r.handle ? (url ? `@${igName(r.handle)}` : `@${r.handle.replace(/^@/, "")}`) : "";
    const cat = effTag(r);
    const site = t?.igSite?.trim() ?? "";
    const siteHref = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : "";
    const btn2 = "flex h-10 items-center justify-center gap-1.5 rounded-full bg-field px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50 disabled:hover:bg-field";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">Fiche du {K.one}</span>
          <div className="flex items-center gap-1">
            <ActionMenu items={menuFor(r)} buttonClassName="h-8 w-8 bg-field text-foreground" />
            {url && (
              <a href={url} target="_blank" rel="noreferrer" title="Ouvrir le profil" aria-label="Ouvrir le profil" className="grid h-8 w-8 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover">
                <ArrowUpRight className="h-4 w-4" />
              </a>
            )}
            {inSheet && (
              <button type="button" onClick={() => setSheet(false)} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Identité : photo (touche le rond pour en ajouter une), nom, @ · catégorie */}
          <div className="flex flex-col items-center text-center">
            <label className="group relative shrink-0 cursor-pointer" title="Changer la photo">
              <ScoutAvatar name={r.name} photos={photosOf(r.id)} size={72} tint={TONE_SOFT[SCOUT_TONE[st]]} className="rounded-full text-[22px]" />
              <span className={cn("absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity", photoBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                {photoBusy ? <Spin size={16} /> : <Camera className="h-4 w-4" />}
              </span>
              {/* Pastille appareil photo toujours visible (pas de survol sur téléphone). */}
              <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-primary text-primary-foreground"><Camera className="h-3 w-3" /></span>
              <input type="file" accept="image/*" className="hidden" disabled={photoBusy}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void uploadPhoto(r, f); }} />
            </label>
            <div className="mt-3 flex max-w-full items-center gap-1.5">
              <span className="truncate text-[22px] font-bold tracking-tight text-foreground">{r.name}</span>
              {r.last_contacted && <span className="h-2 w-2 shrink-0 rounded-full bg-signal" title="Déjà contacté" />}
            </div>
            {(handleTxt || cat) && (
              <div className="mt-0.5 flex max-w-full items-center justify-center gap-1 text-[13px] font-medium text-primary">
                {handleTxt && (url ? <a href={url} target="_blank" rel="noreferrer" className="truncate hover:underline">{handleTxt}</a> : <span className="truncate">{handleTxt}</span>)}
                {handleTxt && cat && <span aria-hidden>·</span>}
                {cat && <span className="shrink-0" title={autoTag(r) ? "Devinée via Instagram. Modifie la fiche pour la fixer." : undefined}>{cat}{autoTag(r) ? " (devinée)" : ""}</span>}
              </div>
            )}
            {athletes && (r.club?.trim() || r.level?.trim()) && (
              <div className="mt-0.5 max-w-full truncate text-[12px] text-muted-foreground">{[r.club?.trim(), r.level?.trim()].filter(Boolean).join(" · ")}</div>
            )}
            {!t?.photo && !t?.igPhoto && t?.igWhy && (
              <div className="mt-1 text-[11px] text-faint">Photo Instagram : {igWhyText(t.igWhy)}. Touche le rond pour en ajouter une.</div>
            )}
          </div>

          {/* Chiffres : abonnés, évolution depuis le relevé précédent, engagement public */}
          <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-[16px] bg-panel py-3 text-center">
            {([
              ["abonnés", fol != null ? fmtCompact(fol) : "—", ""],
              ["évolution", g != null && g !== 0 ? growthText(g) : "—", g != null && g > 0 ? "text-ok" : ""],
              ["engagement", fmtEr(t?.igEr), ""],
            ] as const).map(([label, value, cls]) => (
              <div key={label} className="min-w-0 px-2">
                <div className={cn("truncate text-[18px] font-semibold tabular-nums text-foreground", cls)}>{value}</div>
                <div className="truncate text-[11px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          {t && t.igEr !== undefined && (
            <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-faint">
              Rythme {fmtPerWeek(t.igPw)} · engagement public : likes + commentaires moyens des 12 derniers posts ÷ abonnés{t.igPosts ? ` · ${t.igPosts.toLocaleString("fr-FR")} posts au total` : ""}{t.igAt ? ` · relevé le ${frShort(t.igAt)}` : ""}.
            </p>
          )}

          {/* Où on en est : les 4 étapes, un clic pose le statut */}
          <div className="mt-5">
            <div className="mb-1.5 text-[15px] font-bold text-foreground">Où on en est</div>
            <ol className="flex flex-col">
              {SCOUT_STEPS.map((s, i) => {
                const state = stepState(s, st);
                return (
                  <li key={s} className="relative">
                    {i < SCOUT_STEPS.length - 1 && (
                      <span aria-hidden className={cn("absolute left-[16.5px] top-[calc(50%+11px)] h-[calc(100%-22px)] w-px", state === "done" ? "bg-primary" : "bg-border")} />
                    )}
                    <button
                      type="button"
                      onClick={() => { if (state !== "current") void setStatus(r.id, s); }}
                      aria-current={state === "current" ? "step" : undefined}
                      className="flex w-full items-center gap-3 rounded-[12px] px-1.5 py-1.5 text-left transition-colors hover:bg-rowhover"
                    >
                      <span
                        className={cn(
                          "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full",
                          state === "done" ? "bg-primary text-primary-foreground" : state === "current" ? "bg-surface ring-2 ring-primary" : "border border-border bg-surface",
                        )}
                      >
                        {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : state === "current" ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                      </span>
                      <span className={cn("text-[14px]", state === "current" ? "font-bold text-foreground" : state === "done" ? "text-foreground" : "text-muted-foreground")}>{statusMeta(s).step}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {st === "ecarte" && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1.5 text-[12px] text-muted-foreground">
                <StatusPill tone="closed" size="xs" dot>Écarté</StatusPill> Touche une étape pour le remettre dans le parcours.
              </div>
            )}
            {r.last_contacted && (
              <div className="mt-1.5 px-1.5 text-[12px] text-muted-foreground">Dernier contact : {new Date(r.last_contacted).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
            )}
          </div>

          {/* Email */}
          {r.email && (
            <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-panel p-3">
              <IconTile size="sm"><Mail /></IconTile>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">Email trouvé</div>
                <a href={`mailto:${r.email}`} className="block truncate text-[13px] font-medium text-foreground hover:underline">{r.email}</a>
              </div>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(r.email ?? "").then(() => toast("Email copié ✓"), () => toast("Copie impossible")); }}
                className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-field px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
              >
                <Copy className="h-3.5 w-3.5" /> Copier
              </button>
            </div>
          )}

          {/* Bio, site, note */}
          {t?.igBio?.trim() && <div className="mt-3 whitespace-pre-line rounded-[16px] bg-panel px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground">{t.igBio.trim()}</div>}
          {siteHref && (
            <a href={siteHref} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2.5 rounded-full bg-panel px-3.5 py-2.5 text-[12px] font-medium text-primary transition-colors hover:bg-rowhover">
              <Globe className="h-4 w-4 shrink-0" /><span className="truncate">{site.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
            </a>
          )}
          {r.note && (
            <div className="mt-3 rounded-[16px] bg-panel px-3.5 py-2.5">
              <div className="text-[11px] text-muted-foreground">Note</div>
              <div className="mt-0.5 whitespace-pre-line text-[12px] leading-relaxed text-foreground">{r.note}</div>
            </div>
          )}

          {/* Suivi des abonnés : courbe, ajout et liste des relevés */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[15px] font-bold text-foreground">Évolution des abonnés</span>
              {g != null && g !== 0 && (
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", g > 0 ? "bg-ok-soft text-ok" : "bg-field text-muted-foreground")} title="Depuis le relevé précédent">
                  {growthText(g)}
                </span>
              )}
            </div>
            {snaps.length >= 2 ? (
              <GlassStatChart
                title="Abonnés"
                subtitle={`${snaps.length} relevés`}
                points={snaps.map((sn) => ({ label: frShort(sn.date), value: sn.value }))}
                format={(n) => Math.round(n).toLocaleString("fr-FR")}
                height={170}
                defaultType="area"
              />
            ) : (
              <div className="rounded-[16px] border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
                {snaps.length === 1
                  ? `${snaps[0].value.toLocaleString("fr-FR")} abonnés · ajoute un 2ᵉ relevé pour voir la courbe.`
                  : "Aucun relevé. Note le nombre d'abonnés à chaque fois que tu regardes son compte."}
              </div>
            )}

            {/* Ajouter un relevé */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DateInput value={snapDate} onChange={setSnapDate} clearable={false} className="rounded-full border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary" />
              <input value={snapVal} onChange={(e) => setSnapVal(e.target.value)} inputMode="numeric" placeholder="Abonnés (ex : 225909 · 226K)" aria-label="Nombre d'abonnés" className="min-w-0 flex-1 rounded-full border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary" />
              <button type="button" onClick={() => { const v = parseFol(snapVal); if (!v) { toast("Renseigne un nombre d'abonnés"); return; } void addSnap(r.id, snapDate, v); setSnapVal(""); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90" title="Ajouter le relevé" aria-label="Ajouter le relevé">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {snaps.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {[...snaps].reverse().map((sn) => (
                  <div key={sn.date} className="group flex items-center gap-2 rounded-[10px] bg-panel px-2.5 py-1.5 text-[12px]">
                    <span className="text-muted-foreground">{frShort(sn.date)}</span>
                    <span className="ml-auto font-semibold tabular-nums text-foreground">{sn.value.toLocaleString("fr-FR")}</span>
                    <button type="button" onClick={() => delSnap(r.id, sn.date)} className="text-faint opacity-60 transition-opacity hover:text-foreground hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100" title="Supprimer ce relevé" aria-label="Supprimer ce relevé"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions, toujours en bas de la fiche */}
        <div className="mt-4 flex shrink-0 flex-col gap-2 border-t border-border pt-4">
          {next ? (
            <button type="button" onClick={() => void setStatus(r.id, next)} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              Passer à « {statusMeta(next).step} »
            </button>
          ) : (
            <button type="button" disabled className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-ok-soft px-4 text-[14px] font-semibold text-ok">
              <Check className="h-4 w-4" /> Signé
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!r.email} title={r.email ? `Écrire à ${r.name}` : "Pas d'email dans la fiche"} onClick={() => fromSheet(() => openMail(r))} className={btn2}>
              <Send className="h-3.5 w-3.5" /> Écrire
            </button>
            <button type="button" disabled={st === "ecarte"} onClick={() => void setStatus(r.id, "ecarte")} className={btn2}>
              {st === "ecarte" ? <><Check className="h-3.5 w-3.5" /> Écarté</> : <><X className="h-3.5 w-3.5" /> Pas intéressé</>}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {header(true)}
      {FEATURES.hashtagSearch && hashOpen && <HashtagSearch onClose={() => setHashOpen(false)} />}

      <div className={cn("grid items-start gap-5", showInspector && "grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="@container min-w-0">
          {/* Filtre par statut de scouting (mémorisé sur l'appareil) */}
          <Tabs
            className="mb-3"
            fullWidth
            label="Filtrer par statut de scouting"
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as ScoutStatus | "__all__")}
            items={[{ value: "__all__", label: "Tous" }, ...STATUSES.map((s) => ({ value: s.v, label: s.short, dot: TONE_DOT[SCOUT_TONE[s.v]] }))]}
          />

          {/* Catégorie, prise de contact, tri ; le compte à droite */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {tagList.length > 0 && (
              <PillMenu
                ariaLabel={`Filtrer par ${K.catLabel.toLocaleLowerCase("fr")}`}
                label={tagFilter === ALL ? K.allCats : tagList.find((t) => t.key === tagFilter)?.label ?? K.allCats}
                active={tagFilter !== ALL}
                value={tagFilter}
                onChange={setTagFilter}
                options={[{ value: ALL, label: K.allCats, count: rows.length }, ...tagList.map((t) => ({ value: t.key, label: t.label, count: t.count }))]}
              />
            )}
            <PillMenu
              ariaLabel="Filtrer par prise de contact"
              label={`Contact : ${CONTACT_LABEL[contactFilter]}`}
              active={contactFilter !== "all"}
              value={contactFilter}
              onChange={(v) => setContactFilter(v as ContactFilter)}
              options={[
                { value: "all", label: "Tous" },
                { value: "contacted", label: "Déjà contactés" },
                { value: "never", label: "Jamais contactés" },
              ]}
            />
            <PillMenu
              ariaLabel="Trier la liste"
              label={`Trier : ${SORT_LABEL[sortBy]}`}
              value={sortBy}
              onChange={(v) => setSortBy(v as ScoutSort)}
              options={SCOUT_SORTS.map((v) => ({ value: v, label: SORT_LABEL[v].charAt(0).toLocaleUpperCase("fr") + SORT_LABEL[v].slice(1) }))}
            />
            <span className="ml-auto whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">
              {filtered.length} {filtered.length > 1 ? K.many : K.one}
              {filtering && <span className="text-faint"> / {rows.length}</span>}
            </span>
          </div>

          <InlineForm open={formOpen} title={editId ? K.editTitle : K.newTitle} onClose={() => setFormOpen(false)} onSubmit={submit} submitLabel={editId ? "Enregistrer" : "Ajouter"}>
            <TextField label="Nom" value={fName} onChange={setFName} placeholder={K.namePh} className="min-w-[200px] flex-[2]" />
            <TextField label="Compte Instagram ou YouTube" value={fHandle} onChange={setFHandle} placeholder={K.handlePh} className="min-w-[150px] flex-1" />
            <TextField label="Email" value={fEmail} onChange={setFEmail} type="email" placeholder={K.emailPh} className="min-w-[180px] flex-1" />
            <div className="flex min-w-full flex-col gap-1">
              <span className="text-[12px] font-medium text-muted-foreground">{K.catLabel} <span className="font-normal text-faint">(vide : l'app la devine via Instagram)</span></span>
              <div className="flex flex-wrap gap-1.5">
                {[...NICHES.map((n) => n.label), ...tagList.map((t) => t.label).filter((l) => !NICHES.some((n) => tagKey(n.label) === tagKey(l)))].map((l) => {
                  const on = tagKey(fTag) === tagKey(l);
                  return (
                    <button key={l} type="button" aria-pressed={on} onClick={() => { setFTag(on ? "" : l); setOtherCat(false); }}
                      className={cn("h-8 rounded-full border px-3 text-[12px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
                      {l}
                    </button>
                  );
                })}
                <button type="button" aria-pressed={otherCat} onClick={() => { setOtherCat(!otherCat); if (!otherCat) setFTag(""); }}
                  className={cn("h-8 rounded-full border border-dashed px-3 text-[12px] font-medium transition-colors", otherCat ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
                  Autre…
                </button>
              </div>
              {otherCat && <TextField label="" value={fTag} onChange={setFTag} placeholder={K.catPh} className="mt-1 max-w-[320px]" />}
            </div>
            {athletes && (
              <>
                <TextField label="Club / équipe" value={fClub} onChange={setFClub} placeholder="Ex : PSG, Stade Toulousain" className="min-w-[180px] flex-1" />
                <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                  <span className="text-[12px] font-medium text-muted-foreground">Niveau</span>
                  <div className="flex flex-wrap gap-1.5">
                    {LEVELS.map((l) => (
                      <button key={l} type="button" aria-pressed={fLevel === l} onClick={() => setFLevel(fLevel === l ? "" : l)}
                        className={cn("h-9 rounded-full border px-3 text-[12px] font-medium transition-colors", fLevel === l ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <AutoGrowTextField label="Note (tarif, dispo, remarques…)" value={fNote} onChange={setFNote} className="min-w-full" />
          </InlineForm>

          {athletes && rows.length > 0 && <SourcingLink className="mb-3 px-1" />}
          {filtered.length === 0 ? (
            <div className="rounded-[22px] bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? K.empty : `Aucun ${K.one} pour ces filtres.`}
              {athletes && rows.length === 0 && <div className="mt-3"><SourcingLink /></div>}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 rounded-[22px] bg-surface p-1.5">
              {filtered.map((r) => {
                const st = statusOf(r.id);
                const tone = SCOUT_TONE[st];
                const fol = latestFollowers(r.id);
                const g = snapsOf(r.id).length >= 2 ? growthOf(r.id) : 0;
                const er = tracking[r.id]?.igEr;
                const erTone = engagementTone(er);
                const on = selectedId === r.id && (wide || sheet);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    onClick={() => pick(r.id)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                        e.preventDefault();
                        pick(r.id);
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-[16px] px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none @md:px-3",
                      on ? "bg-primary/[0.06] ring-[1.5px] ring-primary" : "hover:bg-rowhover",
                    )}
                  >
                    <ScoutAvatar name={r.name} photos={photosOf(r.id)} size={40} tint={TONE_SOFT[tone]} className="rounded-full text-[13px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[14px] font-semibold text-foreground">{r.name}</span>
                        {r.last_contacted && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" title="Déjà contacté" />}
                        {/* Petit écran : la catégorie reste dans la fiche */}
                        <span className="hidden min-w-0 @md:contents">{tagPill(r)}</span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                        {r.handle ? (
                          igUrl(r.handle) ? (
                            <a href={igUrl(r.handle)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ouvrir le profil" className="min-w-0 truncate hover:text-foreground hover:underline">@{igName(r.handle)}</a>
                          ) : (
                            <span className="min-w-0 truncate">@{r.handle.replace(/^@/, "")}</span>
                          )
                        ) : r.email ? (
                          <span className="min-w-0 truncate">{r.email}</span>
                        ) : null}
                        {athletes && (r.club?.trim() || r.level?.trim()) && (
                          <span className="min-w-0 truncate">{(r.handle || r.email ? "· " : "") + [r.club?.trim(), r.level?.trim()].filter(Boolean).join(" · ")}</span>
                        )}
                        {/* Petit écran : le statut passe sous le nom */}
                        <StatusPill tone={tone} size="xs" dot className="@xl:hidden">{statusMeta(st).label}</StatusPill>
                      </div>
                    </div>
                    {/* Abonnés + évolution depuis le relevé précédent */}
                    <div className="w-[58px] shrink-0 text-right @md:w-[72px]">
                      <div className="text-[14px] font-bold tabular-nums text-foreground">{fol != null ? fmtCompact(fol) : "—"}</div>
                      {g !== 0 && <div className={cn("text-[11px] font-semibold tabular-nums", g > 0 ? "text-ok" : "text-muted-foreground")}>{growthText(g)}</div>}
                    </div>
                    {/* Engagement public + barre (vert ≥ 3 %, orange 1 à 3 %, gris < 1 %) */}
                    <div className="hidden w-[96px] shrink-0 @2xl:block" title="Engagement public (12 derniers posts)">
                      <div className="text-[12px] text-muted-foreground">Eng. <span className="font-semibold tabular-nums text-foreground">{fmtEr(er)}</span></div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-field">
                        {erTone && <div className={cn("h-full rounded-full", TONE_DOT[erTone])} style={{ width: `${engagementBarPct(er)}%` }} />}
                      </div>
                    </div>
                    <div className="hidden w-[116px] shrink-0 @xl:flex">
                      <StatusPill tone={tone} dot>{statusMeta(st).label}</StatusPill>
                    </div>
                    {/* Rond « mail » (petit écran : « Écrire » reste dans le menu ⋯ et dans la fiche) */}
                    {r.email ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); fromSheet(() => openMail(r)); }}
                        title={`Écrire à ${r.name}`}
                        aria-label={`Écrire à ${r.name}`}
                        className={cn("hidden h-9 w-9 shrink-0 place-items-center rounded-full transition-colors @md:grid", on ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover")}
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                    ) : (
                      <span aria-hidden className="hidden w-9 shrink-0 @md:block" />
                    )}
                    <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <ActionMenu items={menuFor(r)} buttonClassName="h-8 w-8" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Colonne de droite : la fiche du profil sélectionné (grand écran) */}
        {showInspector && (
          <aside aria-label={`Fiche du ${K.one}`} className="sticky top-4 flex max-h-[calc(100dvh-10rem)] flex-col rounded-[22px] bg-surface p-5">
            {selected ? (
              renderInspector(selected, false)
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-[13px] text-muted-foreground">
                <IconTile><Search /></IconTile>
                Choisis un {K.one} dans la liste pour voir sa fiche.
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Téléphone et tablette : la même fiche, en feuille du bas */}
      {!wide && sheet && selected && (
        <Overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClose={() => setSheet(false)} label={`Fiche du ${K.one}`}>
          <div role="dialog" aria-label={`Fiche du ${K.one}`} className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-[22px] bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {renderInspector(selected, true)}
          </div>
        </Overlay>
      )}

      {/* Modale de sollicitation */}
      {mailRow && (
        <Overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClose={() => setMailRow(null)} label={`Écrire à ${mailRow.name}`}>
          <div className="w-full max-w-lg rounded-[22px] bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-[15px] font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" /> Écrire à {mailRow.name}</div>
              <button type="button" onClick={() => setMailRow(null)} aria-label="Fermer" className="shrink-0 text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mb-2 text-[12px] text-muted-foreground">À : {mailRow.email}</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" aria-label="Objet" className="mb-2 w-full rounded-[12px] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} placeholder="Ton message…" aria-label="Message" className="w-full resize-y rounded-[12px] border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setMailRow(null)} className="rounded-full bg-field px-4 py-2 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover">Annuler</button>
              <button type="button" onClick={sendSolicit} disabled={sending} className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                <Send className="h-3.5 w-3.5" /> {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

export default Vivier;

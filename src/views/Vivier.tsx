import { fmtCompact } from "@/lib/timeSeries";
import { useEffect, useMemo, useState } from "react";
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
import { AtSign, Mail, Pencil, Trash2, X, Send, Sparkles, ExternalLink, Plus, Tag, Camera, Loader2, Hash, Globe } from "lucide-react";
import { igWhyText, fmtEr, fmtPerWeek, noteQuota } from "@/lib/instagram";
import { MetaQuotaBadge } from "@/components/MetaQuotaBadge";
import { HashtagSearch } from "@/components/HashtagSearch";
import { FEATURES } from "@/lib/features";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
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
function ScoutAvatar({ name, photos, size, className }: { name: string; photos: (string | null | undefined)[]; size: number; className?: string }) {
  const list = photos.filter(Boolean) as string[];
  const [failed, setFailed] = useState(0);
  const sig = list.join("|");
  useEffect(() => setFailed(0), [sig]);
  const src = list[failed];
  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-panel font-bold text-foreground", className)} style={{ width: size, height: size }}>
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
type ScoutStatus = "observation" | "contacter" | "discussion" | "signe" | "ecarte";
const STATUSES: { v: ScoutStatus; label: string; dot: string; pill: string }[] = [
  { v: "observation", label: "En observation", dot: "bg-indigo", pill: "bg-indigo/10 text-indigo" },
  { v: "contacter", label: "À contacter", dot: "bg-amber", pill: "bg-foreground/[0.06] text-amber" },
  { v: "discussion", label: "En discussion", dot: "bg-primary", pill: "bg-primary/10 text-primary" },
  { v: "signe", label: "Signé", dot: "bg-signal", pill: "bg-signal/10 text-signaltext" },
  { v: "ecarte", label: "Pas intéressé", dot: "bg-neutral-400", pill: "bg-panel text-faint" },
];
const statusMeta = (v: ScoutStatus) => STATUSES.find((s) => s.v === v) ?? STATUSES[0];

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

/** Scouting : sous-pages Créateurs / Sportifs (choix remonté à la sidebar). */
export function Vivier() {
  const sub = useNavSub();
  const setNavSub = useSetNavSub();
  const [kind, setKind] = useState<Kind>(sub === "sportifs" ? "sportifs" : "createurs");
  useEffect(() => {
    if (sub === "createurs" || sub === "sportifs") setKind(sub);
  }, [sub]);
  return (
    <>
      <Tabs
        className="mb-4"
        label="Sous-pages Scouting"
        value={kind}
        onValueChange={(v) => {
          setKind(v as Kind);
          setNavSub(v);
        }}
        items={[{ value: "createurs", label: "Créateurs" }, { value: "sportifs", label: "Sportifs" }]}
      />
      <ScoutingList key={kind} kind={kind} />
    </>
  );
}

function ScoutingList({ kind }: { kind: Kind }) {
  const K = KIND[kind];
  const athletes = kind === "sportifs";
  const NICHES = athletes ? SPORTS : CREATOR_NICHES;
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>(K.cache));
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(false); // table pas encore créée (mise à jour SQL en attente)
  const { query } = useSearch();
  const live = useLiveKey();

  const [tagFilter, setTagFilter] = useState(ALL);
  const [contactFilter, setContactFilter] = useState<"all" | "contacted" | "never">("all");

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

  // Fiche (détail au clic sur une ligne)
  const [selected, setSelected] = useState<Row | null>(null);

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
  const [statusFilter, setStatusFilter] = useState<ScoutStatus | "__all__">("__all__");
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
    toast("Erreur — réessaie");
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
      if (!(await dbUpdate(K.table, editId, payload))) { toast("Erreur — réessaie"); return; }
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
    if (!created) { toast("Erreur — réessaie"); return; }
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
      if (error || !res?.ok) { toast(res?.detail ? `Échec : ${res.detail}` : "Envoi échoué — réessaie"); return; }
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

  if (missing && rows === null) return <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">Le scouting des {K.many} n'est pas encore activé : une mise à jour est en attente.</div>;
  if (error && rows === null) return <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">Impossible de charger le Scouting.</div>;
  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>;

  const filtered = rows.filter((r) => {
    if (tagFilter !== ALL && tagKey(effTag(r)) !== tagFilter) return false;
    if (statusFilter !== "__all__" && statusOf(r.id) !== statusFilter) return false;
    if (contactFilter === "contacted" && !r.last_contacted) return false;
    if (contactFilter === "never" && r.last_contacted) return false;
    return matchQuery(query, r.name, r.handle, r.email, r.tag, r.note, r.club, r.level);
  });

  return (
    <>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {filtered.length} {K.one}{filtered.length > 1 ? "s" : ""}
          {(tagFilter !== ALL || contactFilter !== "all" || statusFilter !== "__all__" || query.trim()) && <span className="text-faint"> / {rows.length}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <MetaQuotaBadge className="max-sm:hidden" />
          {FEATURES.hashtagSearch && (
            <button type="button" onClick={() => setHashOpen((o) => !o)} className={cn("flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors", hashOpen ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
              <Hash className="h-3.5 w-3.5" /> Hashtag
            </button>
          )}
          <AddButton label={K.add} onClick={openAdd} />
        </div>
      </PageHeaderRow>
      {FEATURES.hashtagSearch && hashOpen && <HashtagSearch onClose={() => setHashOpen(false)} />}

      {/* Filtre par catégorie (menu déroulant, avec le nombre de créateurs) */}
      {tagList.length > 0 && (
        <div className="mb-2 w-full sm:max-w-[300px]">
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger icon={Tag} className="h-10 w-auto min-w-[220px] rounded-lg bg-surface text-[12px]" placeholder={K.allCats} />
            <SelectContent>
              <SelectItem index={0} value={ALL}>{`${K.allCats} · ${rows.length}`}</SelectItem>
              {tagList.map((t, i) => (
                <SelectItem key={t.key} index={i + 1} value={t.key}>{`${t.label} · ${t.count}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {/* Filtre par statut de scouting (segmenté, cohérent avec « déjà contactés ») */}
      <Tabs
        className="mb-2"
        size="md"
        label="Filtrer par statut de scouting"
        wrap
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as ScoutStatus | "__all__")}
        items={[{ value: "__all__", label: "Tous" }, ...STATUSES.map((s) => ({ value: s.v, label: s.label, dot: s.dot }))]}
      />
      {/* Filtre « déjà contactés » */}
      <Tabs
        className="mb-4"
        size="md"
        label="Filtrer par prise de contact"
        value={contactFilter}
        onValueChange={(v) => setContactFilter(v as "all" | "contacted" | "never")}
        items={[
          { value: "all", label: "Tous" },
          { value: "contacted", label: "Déjà contactés" },
          { value: "never", label: "Jamais" },
        ]}
      />

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

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground shadow-sm">
          {rows.length === 0 ? K.empty : `Aucun ${K.one} pour ces filtres.`}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
          {filtered.map((r) => (
            <div key={r.id} onClick={() => setSelected(r)} className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-rowhover">
              <ScoutAvatar name={r.name} photos={photosOf(r.id)} size={38} className="rounded-full text-[11px]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-foreground">{r.name}</span>
                  {r.last_contacted && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" title="Déjà contacté" />}
                  {r.tag?.trim() ? (
                    <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{r.tag.trim()}</span>
                  ) : autoTag(r) ? (
                    <span title="Devinée via Instagram (bio et derniers posts). Modifie la fiche pour la fixer." className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <Sparkles className="h-2.5 w-2.5" />{autoTag(r)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  {r.handle && (igUrl(r.handle) ? (
                    <a href={igUrl(r.handle)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ouvrir le profil Instagram" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                      <AtSign className="h-3 w-3" />{igName(r.handle)}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-0.5"><AtSign className="h-3 w-3" />{r.handle.replace(/^@/, "")}</span>
                  ))}
                  {r.email && <span className="truncate">{r.email}</span>}
                </div>
                {athletes && (r.club?.trim() || r.level?.trim()) && (
                  <div className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">{[r.club?.trim(), r.level?.trim()].filter(Boolean).join(" · ")}</div>
                )}
                {r.note && <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{r.note}</div>}
              </div>
              {latestFollowers(r.id) != null && (
                <div className="hidden shrink-0 text-right sm:block">
                  <div className="text-[13px] font-bold tabular-nums text-foreground">{fmtCompact(latestFollowers(r.id)!)}</div>
                  {growthOf(r.id) !== 0 && (
                    <div className={cn("text-[10px] font-semibold", growthOf(r.id) >= 0 ? "text-signaltext" : "text-dangertext")}>
                      {growthOf(r.id) >= 0 ? "+" : "−"}{fmtCompact(Math.abs(growthOf(r.id)))}
                    </div>
                  )}
                  {tracking[r.id]?.igEr != null && <div className="text-[10px] text-faint" title="Engagement public (12 derniers posts)">Engagement {fmtEr(tracking[r.id]?.igEr)}</div>}
                </div>
              )}
              <span className={cn("hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium sm:inline-flex", statusMeta(statusOf(r.id)).pill)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta(statusOf(r.id)).dot)} />{statusMeta(statusOf(r.id)).label}
              </span>
              {r.email && (
                <button type="button" onClick={(e) => { e.stopPropagation(); openMail(r); }} title={`Écrire à ${r.name}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-primary/20">
                  <Mail className="h-4 w-4" />
                </button>
              )}
              <div onClick={(e) => e.stopPropagation()}>
                <ActionMenu
                  items={[
                    { key: "edit", label: "Modifier", icon: Pencil, onClick: () => openEdit(r) },
                    { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => remove(r), confirm: { title: "Retirer du scouting", message: `Retirer « ${r.name} » du scouting ? Tu pourras le restaurer depuis la corbeille.` } },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fiche créateur (détail) */}
      {selected && (
        <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClose={() => setSelected(null)}>
          <div className="my-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <label className="group relative shrink-0 cursor-pointer" title="Changer la photo">
                <ScoutAvatar name={selected.name} photos={photosOf(selected.id)} size={56} className="rounded-full text-sm" />
                <span className={cn("absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity", photoBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                  {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </span>
                {/* Pastille appareil photo toujours visible (pas de survol sur téléphone). */}
                <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground"><Camera className="h-2.5 w-2.5" /></span>
                <input type="file" accept="image/*" className="hidden" disabled={photoBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void uploadPhoto(selected, f); }} />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-base font-bold text-foreground">{selected.name}</span>
                  {selected.last_contacted && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" title="Déjà contacté" />}
                </div>
                {(effTag(selected) || (athletes && (selected.club || selected.level))) && (
                  <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">
                    {[effTag(selected), athletes ? selected.club?.trim() : null, athletes ? selected.level?.trim() : null].filter(Boolean).join(" · ")}
                    {autoTag(selected) && <span className="font-normal text-faint"> (devinée via Instagram)</span>}
                  </div>
                )}
                {!tracking[selected.id]?.photo && !tracking[selected.id]?.igPhoto && tracking[selected.id]?.igWhy && (
                  <div className="mt-0.5 text-[11px] text-faint">Photo Instagram : {igWhyText(tracking[selected.id]?.igWhy)}. Touche le rond pour en ajouter une.</div>
                )}
              </div>
              <button type="button" onClick={() => setSelected(null)} className="shrink-0 text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex flex-col gap-2">
              {selected.handle && (igUrl(selected.handle) ? (
                <a href={igUrl(selected.handle)} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-full border border-border bg-panel/50 px-3.5 py-2.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/5">
                  <AtSign className="h-4 w-4 shrink-0" /><span className="truncate">{igName(selected.handle)}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] font-medium text-faint">{isYtHandle(selected.handle) ? "YouTube" : "Instagram"} <ExternalLink className="h-3.5 w-3.5" /></span>
                </a>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[13px] font-medium text-foreground"><AtSign className="h-4 w-4 shrink-0 text-faint" /><span className="truncate">{selected.handle.replace(/^@/, "")}</span></div>
              ))}
              {selected.email && (
                <a href={`mailto:${selected.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2.5 rounded-full border border-border bg-panel/50 px-3.5 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover"><Mail className="h-4 w-4 shrink-0 text-faint" /><span className="truncate">{selected.email}</span></a>
              )}
              {selected.note && (
                <div className="rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground">{selected.note}</div>
              )}
              {(() => {
                // Chiffres publics donnés par Meta (comptes pro) : engagement, rythme, bio, site.
                const t = tracking[selected.id];
                if (!t || t.igEr === undefined) return null;
                const site = t.igSite?.trim() ?? "";
                const siteHref = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : "";
                const fol = latestFollowers(selected.id);
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["Abonnés", fol != null ? fmtCompact(fol) : "—"],
                        ["Engagement", fmtEr(t.igEr)],
                        ["Rythme", fmtPerWeek(t.igPw)],
                      ] as const).map(([l, v]) => (
                        <div key={l} className="rounded-xl border border-border bg-panel/50 px-3 py-2">
                          <div className="text-[10px] font-medium text-faint">{l}</div>
                          <div className="mt-0.5 truncate text-[14px] font-bold tabular-nums text-foreground">{v}</div>
                        </div>
                      ))}
                    </div>
                    {t.igBio?.trim() && <div className="whitespace-pre-line rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground">{t.igBio.trim()}</div>}
                    {siteHref && (
                      <a href={siteHref} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-full border border-border bg-panel/50 px-3.5 py-2.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/5">
                        <Globe className="h-4 w-4 shrink-0" /><span className="truncate">{site.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                      </a>
                    )}
                    <div className="px-1 text-[10px] leading-relaxed text-faint">
                      Engagement public : likes + commentaires moyens des 12 derniers posts ÷ abonnés{t.igPosts ? ` · ${t.igPosts.toLocaleString("fr-FR")} posts au total` : ""}{t.igAt ? ` · relevé le ${frShort(t.igAt)}` : ""}.
                    </div>
                  </>
                );
              })()}
              {selected.last_contacted && (
                <div className="px-1 text-[11px] text-faint">Dernier contact : {new Date(selected.last_contacted).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
              )}
            </div>

            {/* Statut de scouting */}
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-2 text-[12px] font-medium text-muted-foreground">Statut de scouting</div>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => {
                  const active = statusOf(selected.id) === s.v;
                  return (
                    <button key={s.v} type="button" onClick={() => setStatus(selected.id, s.v)} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors", active ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:bg-rowhover")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-primary-foreground" : s.dot)} />{s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Suivi des abonnés */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium text-muted-foreground">Évolution des abonnés</span>
                {growthOf(selected.id) !== 0 && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", growthOf(selected.id) >= 0 ? "bg-signal/12 text-signaltext" : "bg-danger/12 text-dangertext")}>
                    {growthOf(selected.id) >= 0 ? "+" : "−"}{fmtCompact(Math.abs(growthOf(selected.id)))} depuis le relevé précédent
                  </span>
                )}
              </div>
              {snapsOf(selected.id).length >= 2 ? (
                <GlassStatChart
                  title="Abonnés"
                  subtitle={`${snapsOf(selected.id).length} relevés`}
                  points={snapsOf(selected.id).map((s) => ({ label: frShort(s.date), value: s.value }))}
                  format={(n) => Math.round(n).toLocaleString("fr-FR")}
                  height={170}
                  defaultType="area"
                />
              ) : (
                <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12px] text-faint">
                  {snapsOf(selected.id).length === 1
                    ? `${latestFollowers(selected.id)!.toLocaleString("fr-FR")} abonnés · ajoute un 2ᵉ relevé pour voir la courbe.`
                    : "Aucun relevé. Note le nombre d'abonnés à chaque fois que tu regardes son compte."}
                </div>
              )}

              {/* Ajouter un relevé */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DateInput value={snapDate} onChange={setSnapDate} clearable={false} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[12px] outline-none focus:border-primary" />
                <input value={snapVal} onChange={(e) => setSnapVal(e.target.value)} inputMode="numeric" placeholder="Abonnés (ex : 225909 · 226K)" className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary" />
                <button type="button" onClick={() => { const v = parseFol(snapVal); if (!v) { toast("Renseigne un nombre d'abonnés"); return; } void addSnap(selected.id, snapDate, v); setSnapVal(""); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90" title="Ajouter le relevé">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {snapsOf(selected.id).length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {[...snapsOf(selected.id)].reverse().map((s) => (
                    <div key={s.date} className="group flex items-center gap-2 rounded-lg bg-panel/40 px-2.5 py-1.5 text-[12px]">
                      <span className="text-faint">{frShort(s.date)}</span>
                      <span className="ml-auto font-semibold tabular-nums text-foreground">{s.value.toLocaleString("fr-FR")}</span>
                      <button type="button" onClick={() => delSnap(selected.id, s.date)} className="text-faint opacity-0 transition-opacity hover:text-dangertext group-hover:opacity-100" title="Supprimer ce relevé"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              {selected.email && (
                <button type="button" onClick={() => { const r = selected; setSelected(null); openMail(r); }} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                  <Send className="h-3.5 w-3.5" /> Écrire à {selected.name}
                </button>
              )}
              <button type="button" onClick={() => { const r = selected; setSelected(null); openEdit(r); }} className={cn("flex items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover", !selected.email && "flex-1")}>
                <Pencil className="h-3.5 w-3.5" /> Modifier
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Modale de sollicitation */}
      {mailRow && (
        <Overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClose={() => setMailRow(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" /> Écrire à {mailRow.name}</div>
              <button type="button" onClick={() => setMailRow(null)} className="shrink-0 text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mb-2 text-[11px] text-faint">À : {mailRow.email}</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" className="mb-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} placeholder="Ton message…" className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setMailRow(null)} className="rounded-full border border-border px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover">Annuler</button>
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

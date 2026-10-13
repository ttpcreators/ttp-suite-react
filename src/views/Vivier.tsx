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
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import GlassStatChart from "@/components/ui/glass-stat-chart";
import { AtSign, Mail, Pencil, Trash2, X, Send, Sparkles, ExternalLink, Plus, Tag, Camera, Loader2, Hash, Globe } from "lucide-react";
import { igWhyText, fmtEr, fmtPerWeek } from "@/lib/instagram";
import { HashtagSearch } from "@/components/HashtagSearch";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { DateInput } from "@/components/ui/date-range-picker";
import { todayISO } from "@/lib/dates";
import { Overlay } from "@/components/mobile/ios-sheet";

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
  tag: string | null;
  note: string | null;
  last_contacted: string | null;
  sort_order: number;
};

const ALL = "__all__";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

/** @handle → nom d'utilisateur nettoyé (sans @, sans URL). */
const igName = (handle?: string | null) =>
  (handle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?].*$/, "").replace(/\s/g, "");
/** Clé de catégorie : sans espaces ni majuscules (« Mode » = « mode »). */
const tagKey = (t: string) => t.trim().toLocaleLowerCase("fr");
/** URL du profil Instagram, ou "" si pas de handle. */
const igUrl = (handle?: string | null) => {
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
  { v: "signe", label: "Signé", dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { v: "ecarte", label: "Écarté", dot: "bg-neutral-400", pill: "bg-panel text-faint" },
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
};
type IgStats = { er: number | null; perWeek: number | null; posts: number; bio: string; website: string };
/** Version de la recherche Instagram : la monter refait les recherches ratées (et sans chiffres). */
const IG_V = 4;
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

export function Vivier() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("vivier"));
  const [error, setError] = useState(false);
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

  // Fiche (détail au clic sur une ligne)
  const [selected, setSelected] = useState<Row | null>(null);

  // Sollicitation email
  const [mailRow, setMailRow] = useState<Row | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Scouting : statut + historique d'abonnés (blob app_state — pas de SQL).
  const { data: trackData } = useAppState<Tracking>((s: AppState) => (s["poolTracking"] as Tracking) ?? {});
  const [localTrack, setLocalTrack] = useState<Tracking | null>(null);
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
      .map((r) => ({ id: r.id, h: igName(r.handle) }))
      .filter((x) => x.h && !igAsked.has(x.h) && igStale(tracking[x.id], x.h))
      .slice(0, 20);
    if (!want.length) return;
    want.forEach((x) => igAsked.add(x.h));
    void supabase.functions.invoke("ig-avatar", { body: { handles: want.map((x) => x.h) } }).then(async ({ data, error: fnErr }) => {
      const res = data as { photos?: Record<string, string | null>; followers?: Record<string, number>; stats?: Record<string, IgStats>; why?: Record<string, string> } | null;
      const photos = res?.photos;
      if (fnErr || !photos) return;
      try {
        invalidateAppState();
        const fresh = ((await getAppState())["poolTracking"] as Tracking) ?? {};
        const next = { ...fresh };
        const at = todayISO();
        for (const x of want) {
          if (!(x.h in photos)) continue;
          const cur = fresh[x.id] ?? {};
          // Abonnés donnés par Meta : relevé du jour ajouté, sans écraser un relevé saisi à la main.
          const n = res?.followers?.[x.h];
          const snaps = typeof n === "number" && !(cur.snaps ?? []).some((sn) => sn.date === at) ? [...(cur.snaps ?? []), { date: at, value: n }] : cur.snaps;
          const st = res?.stats?.[x.h];
          const figures = st ? { igEr: st.er, igPw: st.perWeek, igBio: st.bio, igSite: st.website, igPosts: st.posts } : {};
          next[x.id] = { ...cur, ...figures, snaps, igPhoto: photos[x.h], igFor: x.h, igAt: at, igWhy: res?.why?.[x.h], igV: IG_V };
        }
        setLocalTrack(next);
        await saveAppStateKey("poolTracking", next);
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
  const snapsOf = (id: string): Snap[] => [...(tracking[id]?.snaps ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latestFollowers = (id: string): number | null => { const s = snapsOf(id); return s.length ? s[s.length - 1].value : null; };
  const growthOf = (id: string): number => { const s = snapsOf(id); return s.length >= 2 ? s[s.length - 1].value - s[s.length - 2].value : 0; };
  // Optimiste avec retour arrière si l'écriture échoue ; toast de succès après la sauvegarde.
  const mutateTracking = async (id: string, fn: (t: Track) => Track, okMsg?: string) => {
    const prev = localTrack;
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["poolTracking"] as Tracking) ?? {};
      const next = { ...fresh, [id]: fn(fresh[id] ?? {}) };
      setLocalTrack(next);
      if (await saveAppStateKey("poolTracking", next)) {
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
    supabase.from("creator_pool").select("*").order("sort_order").then(({ data, error }) => {
      if (!alive) return;
      if (error) { setError(true); setRows([]); return; }
      const list = (data as Row[]) ?? [];
      setCache("vivier", list);
      setRows(list);
    });
    return () => { alive = false; };
  }, [live]);

  // Catégories (niche) : « Mode » et « mode » comptent pour une seule, la plus fréquente d'abord.
  const tagList = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const r of rows ?? []) {
      const label = (r.tag ?? "").trim();
      if (!label) continue;
      const key = tagKey(label);
      const cur = m.get(key);
      if (cur) cur.count++;
      else m.set(key, { key, label, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr"));
  }, [rows]);

  const openAdd = () => { setEditId(null); setFName(""); setFHandle(""); setFEmail(""); setFTag(""); setFNote(""); setFormOpen(true); };
  const openEdit = (r: Row) => { setEditId(r.id); setFName(r.name); setFHandle(r.handle ?? ""); setFEmail(r.email ?? ""); setFTag(r.tag ?? ""); setFNote(r.note ?? ""); setFormOpen(true); };

  const submit = async () => {
    if (!fName.trim()) { toast("Renseigne le nom du créateur"); return; }
    const payload = { name: fName.trim(), handle: fHandle.trim() || null, email: fEmail.trim() || null, tag: fTag.trim() || null, note: fNote.trim() || null };
    if (editId) {
      // Écriture d'abord : la fiche ne se ferme et la liste ne change qu'en cas de succès.
      if (!(await dbUpdate("creator_pool", editId, payload))) { toast("Erreur — réessaie"); return; }
      setRows((prev) => {
        const next = (prev ?? []).map((r) => (r.id === editId ? { ...r, ...payload } : r));
        setCache("vivier", next);
        return next;
      });
      setFormOpen(false);
      toast("Créateur mis à jour ✓");
      return;
    }
    const created = await dbInsert("creator_pool", { ...payload, sort_order: nextOrder(rows ?? []) });
    if (!created) { toast("Erreur — réessaie"); return; }
    const next = [created as unknown as Row, ...(rows ?? [])];
    setRows(next); setCache("vivier", next); setFormOpen(false);
    toast("Créateur ajouté au scouting ✓");
  };

  const remove = async (r: Row) => {
    if (await dbTrash("creator_pool", r.id, r.name, undefined)) {
      const next = (rows ?? []).filter((x) => x.id !== r.id);
      setRows(next); setCache("vivier", next);
      toast("Déplacé dans la corbeille");
    } else toast("Erreur, réessaie");
  };

  const openMail = (r: Row) => {
    if (!r.email || !EMAIL_RE.test(r.email)) { toast("Ce créateur n'a pas d'email valide"); return; }
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
      setRows(next); setCache("vivier", next);
      const saved = await dbUpdate("creator_pool", mailRow.id, { last_contacted: when }).catch(() => false);
      toast(saved ? `Email envoyé à ${mailRow.name} ✓` : `Email envoyé à ${mailRow.name}, mais le suivi n'a pas été enregistré`);
      setMailRow(null);
    } finally {
      setSending(false);
    }
  };

  if (error) return <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">Impossible de charger le vivier.</div>;
  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement du vivier…</AnimatedBadge>;

  const filtered = rows.filter((r) => {
    if (tagFilter !== ALL && tagKey(r.tag ?? "") !== tagFilter) return false;
    if (statusFilter !== "__all__" && statusOf(r.id) !== statusFilter) return false;
    if (contactFilter === "contacted" && !r.last_contacted) return false;
    if (contactFilter === "never" && r.last_contacted) return false;
    return matchQuery(query, r.name, r.handle, r.email, r.tag, r.note);
  });

  return (
    <>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {filtered.length} créateur{filtered.length > 1 ? "s" : ""}
          {(tagFilter !== ALL || contactFilter !== "all" || statusFilter !== "__all__" || query.trim()) && <span className="text-faint"> / {rows.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setHashOpen((o) => !o)} className={cn("flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors", hashOpen ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <Hash className="h-3.5 w-3.5" /> Hashtag
          </button>
          <AddButton label="Créateur" onClick={openAdd} />
        </div>
      </PageHeaderRow>
      {hashOpen && <HashtagSearch onClose={() => setHashOpen(false)} />}

      {/* Filtre par catégorie (menu déroulant, avec le nombre de créateurs) */}
      {tagList.length > 0 && (
        <div className="mb-2 w-full sm:max-w-[300px]">
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger icon={Tag} className="h-10 w-auto min-w-[220px] rounded-lg bg-surface text-[12px]" placeholder="Toutes les catégories" />
            <SelectContent>
              <SelectItem index={0} value={ALL}>{`Toutes les catégories · ${rows.length}`}</SelectItem>
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

      <InlineForm open={formOpen} title={editId ? "Modifier le créateur" : "Nouveau créateur (vivier)"} onClose={() => setFormOpen(false)} onSubmit={submit} submitLabel={editId ? "Enregistrer" : "Ajouter"}>
        <TextField label="Nom" value={fName} onChange={setFName} placeholder="Ex : Léna Marchand" className="min-w-[200px] flex-[2]" />
        <TextField label="Handle / @" value={fHandle} onChange={setFHandle} placeholder="@lena.mrchd" className="min-w-[150px] flex-1" />
        <TextField label="Email" value={fEmail} onChange={setFEmail} type="email" placeholder="lena@email.com" className="min-w-[180px] flex-1" />
        <TextField label="Catégorie" value={fTag} onChange={setFTag} placeholder="Ex : Mode, Sport, Beauté" className="min-w-[150px] flex-1" />
        <AutoGrowTextField label="Note (tarif, dispo, remarques…)" value={fNote} onChange={setFNote} className="min-w-full" />
      </InlineForm>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground shadow-sm">
          {rows.length === 0 ? "Ton scouting est vide. Ajoute des créateurs à repérer / solliciter le jour où tu en as besoin ✨" : "Aucun créateur pour ces filtres."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
          {filtered.map((r) => (
            <div key={r.id} onClick={() => setSelected(r)} className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-rowhover">
              <ScoutAvatar name={r.name} photos={photosOf(r.id)} size={38} className="rounded-full text-[11px]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-foreground">{r.name}</span>
                  {r.last_contacted && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Déjà contacté" />}
                  {r.tag?.trim() && <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{r.tag.trim()}</span>}
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
                {r.note && <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{r.note}</div>}
              </div>
              {latestFollowers(r.id) != null && (
                <div className="hidden shrink-0 text-right sm:block">
                  <div className="text-[13px] font-bold tabular-nums text-foreground">{fmtCompact(latestFollowers(r.id)!)}</div>
                  {growthOf(r.id) !== 0 && (
                    <div className={cn("text-[10px] font-semibold", growthOf(r.id) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                      {growthOf(r.id) >= 0 ? "+" : "−"}{fmtCompact(Math.abs(growthOf(r.id)))}
                    </div>
                  )}
                  {tracking[r.id]?.igEr != null && <div className="text-[10px] text-faint" title="Engagement public (12 derniers posts)">ER {fmtEr(tracking[r.id]?.igEr)}</div>}
                </div>
              )}
              <span className={cn("hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium sm:inline-flex", statusMeta(statusOf(r.id)).pill)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta(statusOf(r.id)).dot)} />{statusMeta(statusOf(r.id)).label}
              </span>
              {r.email && (
                <button type="button" onClick={(e) => { e.stopPropagation(); openMail(r); }} title="Solliciter par email" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-primary/20">
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
                  {selected.last_contacted && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Déjà contacté" />}
                </div>
                {selected.tag && <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">{selected.tag}</div>}
                {!tracking[selected.id]?.photo && !tracking[selected.id]?.igPhoto && tracking[selected.id]?.igWhy && (
                  <div className="mt-0.5 text-[11px] text-faint">Photo Instagram : {igWhyText(tracking[selected.id]?.igWhy)}. Touche le rond pour en ajouter une.</div>
                )}
              </div>
              <button type="button" onClick={() => setSelected(null)} className="shrink-0 text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex flex-col gap-2">
              {selected.handle && (igUrl(selected.handle) ? (
                <a href={igUrl(selected.handle)} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/5">
                  <AtSign className="h-4 w-4 shrink-0" /><span className="truncate">{igName(selected.handle)}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] font-medium text-faint">Instagram <ExternalLink className="h-3.5 w-3.5" /></span>
                </a>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[13px] font-medium text-foreground"><AtSign className="h-4 w-4 shrink-0 text-faint" /><span className="truncate">{selected.handle.replace(/^@/, "")}</span></div>
              ))}
              {selected.email && (
                <a href={`mailto:${selected.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2.5 rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover"><Mail className="h-4 w-4 shrink-0 text-faint" /><span className="truncate">{selected.email}</span></a>
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
                      <a href={siteHref} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl border border-border bg-panel/50 px-3.5 py-2.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/5">
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
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", growthOf(selected.id) >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-500")}>
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
                <input value={snapVal} onChange={(e) => setSnapVal(e.target.value)} inputMode="numeric" placeholder="Abonnés (ex : 225909 · 226K)" className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary" />
                <button type="button" onClick={() => { const v = parseFol(snapVal); if (!v) { toast("Renseigne un nombre d'abonnés"); return; } void addSnap(selected.id, snapDate, v); setSnapVal(""); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90" title="Ajouter le relevé">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {snapsOf(selected.id).length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {[...snapsOf(selected.id)].reverse().map((s) => (
                    <div key={s.date} className="group flex items-center gap-2 rounded-lg bg-panel/40 px-2.5 py-1.5 text-[12px]">
                      <span className="text-faint">{frShort(s.date)}</span>
                      <span className="ml-auto font-semibold tabular-nums text-foreground">{s.value.toLocaleString("fr-FR")}</span>
                      <button type="button" onClick={() => delSnap(selected.id, s.date)} className="text-faint opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100" title="Supprimer ce relevé"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              {selected.email && (
                <button type="button" onClick={() => { const r = selected; setSelected(null); openMail(r); }} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                  <Send className="h-3.5 w-3.5" /> Solliciter
                </button>
              )}
              <button type="button" onClick={() => { const r = selected; setSelected(null); openEdit(r); }} className={cn("flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover", !selected.email && "flex-1")}>
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
              <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" /> Solliciter {mailRow.name}</div>
              <button type="button" onClick={() => setMailRow(null)} className="shrink-0 text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mb-2 text-[11px] text-faint">À : {mailRow.email}</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" className="mb-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} placeholder="Ton message…" className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setMailRow(null)} className="rounded-lg border border-border px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover">Annuler</button>
              <button type="button" onClick={sendSolicit} disabled={sending} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
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

import { EMPTY } from "@/lib/dates";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader, Spin } from "@/components/ui/loader";
import { ArrowLeft, AtSign, Check, Contact, Copy, EyeOff, Inbox, Mail, MessagesSquare, Plus, RefreshCw, Search, Send, Tag, X } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Overlay } from "@/components/mobile/ios-sheet";
import { mergeAppStateKey, useAppState, type AppState } from "@/lib/appState";
import { supabase } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { PageHeaderRow } from "@/components/ui/page-header";
import { PhoneMenu } from "@/components/ui/phone-bar";
import { HelpTip } from "@/components/ui/help-tip";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLiveKey } from "@/lib/useLive";
import { dbInsert } from "@/lib/db";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, igWhyText, noteQuota } from "@/lib/instagram";
import { useIntent } from "@/lib/openIntent";

/**
 * DM INSTAGRAM (agence) : les messages privés du compte Instagram de TTP, lus toutes
 * les 5 heures et à chaque DM reçu par la fonction ig-inbox (API officielle de Meta),
 * avec une notification push à l'agence pour chaque nouveau DM.
 *  • réponse depuis l'app (fonction ig-send) dans les 24 h qui suivent le dernier message
 *    de la personne (règle de Meta ; au-delà, réponse dans l'app Instagram) ;
 *  • dossiers : « Créateurs », « Marques », « Refus », « Sans réponse » et les titres créés
 *    par l'agence (réglages partagés : dmLabels = titres et ordre, dmThreadLabels =
 *    titres de chaque conversation) ;
 *  • recherche dans toutes les conversations (nom, @, texte des messages) ;
 *  • emails donnés en message → ajoutés tout seuls à la fiche contact (même @) ;
 *  • chaque échange → noté dans le suivi de prospection de la fiche (canal Instagram) ;
 *  • le Radar à marques (Sourcing) met de côté les marques déjà en conversation.
 */

type Thread = {
  id: string; username: string | null; name: string | null; picture: string | null; followers: number | null;
  updated_at: string | null; last_text: string | null; last_from_me: boolean | null; emails: string[] | null;
  contact_id: string | null; hidden: boolean;
};
/** Photo, vidéo, vocal ou partage d'un DM (lu par ig-inbox ; fichier dans le bucket privé « ig-media »). */
type Media = { kind: "image" | "video" | "audio" | "file" | "share" | "story" | "sticker"; path?: string; src?: string; link?: string; name?: string };
type Msg = { id: string; at: string; me: boolean; text: string; media?: Media[] | null };
/** Texte posé par ig-inbox sur un message sans texte (photo, vidéo, story…). */
const NO_TEXT = "(photo, vidéo ou story)";
type SyncState = { ok?: boolean; why?: string; detail?: string | null; threads?: number; left?: number; touches?: number; emails?: number; me?: string | null };
type Filter = "toutes" | "fiches" | "emails" | "sans" | "masquees" | `label:${string}`;
/** Dossiers proposés tant que l'agence n'a rien changé. */
const DEFAULT_LABELS = ["Créateurs", "Marques", "Refus", "Sans réponse"];
const toOrder = (names: string[]) => Object.fromEntries(names.map((n, i) => [n, i]));

const FILTERS: { v: Filter; label: string }[] = [
  { v: "toutes", label: "Toutes" },
  { v: "fiches", label: "Avec fiche contact" },
  { v: "emails", label: "Email trouvé" },
  { v: "sans", label: "Sans fiche" },
  { v: "masquees", label: "Masquées" },
];
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const esc = (q: string) => q.replace(/[%_\\]/g, "\\$&");
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const hour = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const display = (t: Thread) => t.name?.trim() || (t.username ? `@${t.username}` : "Compte Instagram");

/** « à l'instant », « il y a 12 min », « il y a 3 h », puis en jours. */
function since(iso?: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`;
  return fmtAgo(iso);
}

function inboxWhy(s: SyncState | null): string {
  if (!s || s.ok !== false) return "";
  // Réglage à faire côté Meta (Page Facebook non attribuée, autorisations manquantes) : détail dans Diagnostic.
  if (s.why === "page_introuvable" || s.why === "meta_autorisation")
    return "Un réglage est à faire côté Meta (Page Facebook ou autorisations). Détails dans Réglages › Diagnostic.";
  // « meta_-2 » / Timeout : ancienne réponse de la fonction pour le même blocage.
  if (s.why === "meta_validation" || s.why === "meta_-2" || /timeout/i.test(s.detail ?? ""))
    return "Meta bloque encore la lecture complète des conversations (accès avancé). Si la validation vient d'être accordée, clique « Réessayer ».";
  return igWhyText(s.why) || "Lecture des messages impossible pour l'instant.";
}

function Avatar({ t, size = 40 }: { t: Pick<Thread, "picture" | "name" | "username">; size?: number }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-panel text-[11px] font-bold text-foreground" style={{ width: size, height: size }}>
      {initials(t.name || t.username || "?")}
      {t.picture && ok && <img src={t.picture} alt="" loading="lazy" onError={() => setOk(false)} className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

/** Texte avec la recherche surlignée et les emails mis en avant. */
function Rich({ text, q }: { text: string; q: string }) {
  const parts: ReactNode[] = [];
  const needle = q.trim().toLowerCase();
  const re = new RegExp(`(${EMAIL.source})${needle ? `|(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})` : ""}`, "gi");
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      m[1] ? <span key={i} className="rounded bg-primary/15 px-0.5 font-semibold text-primary">{m[0]}</span> : <mark key={i} className="rounded bg-amber/30 px-0.5 text-inherit">{m[0]}</mark>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function Messages() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<{ data: SyncState; at: string } | null>(null);
  // Lecture en direct (un DM reçu → ig-webhook → lecture de cette conversation).
  const [direct, setDirect] = useState<{ data: SyncState; at: string } | null>(null);
  const [contacts, setContacts] = useState<Map<string, { brand: string; email: string | null }>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Map<string, string> | null>(null); // conversation → message trouvé
  const [filter, setFilter] = useState<Filter>("toutes");
  const [syncing, setSyncing] = useState(false);
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const live = useLiveKey();
  // « Écrire à @marque » ailleurs dans l'app (comptes cités d'un créateur) : ouvre ce fil.
  useIntent("dm:open", (id) => {
    if (!id) return;
    setEmailsOpen(false);
    setFilter("toutes");
    setQ("");
    setSel(id);
  });

  // Dossiers (titres) : partagés par toute l'agence, avec un affichage immédiat.
  const { data: labelOrder } = useAppState<Record<string, number> | null>((s: AppState) => (s["dmLabels"] as Record<string, number> | undefined) ?? null);
  const { data: threadLabelsData } = useAppState<Record<string, string[]>>((s: AppState) => (s["dmThreadLabels"] as Record<string, string[]> | undefined) ?? {});
  const [labelsLocal, setLabelsLocal] = useState<string[] | null>(null);
  const [tlLocal, setTlLocal] = useState<Record<string, string[]> | null>(null);
  const labels = labelsLocal ?? (labelOrder ? Object.entries(labelOrder).sort((a, b) => a[1] - b[1]).map(([n]) => n) : DEFAULT_LABELS);
  const threadLabels = tlLocal ?? threadLabelsData ?? {};
  const labelsOf = (id: string) => (threadLabels[id] ?? []).filter((l) => labels.includes(l));
  const setThreadLabels = async (id: string, list: string[]) => {
    const before = threadLabels;
    setTlLocal({ ...threadLabels, [id]: list });
    const ok = await mergeAppStateKey("dmThreadLabels", list.length ? { [id]: list } : {}, list.length ? [] : [id]);
    if (!ok) {
      setTlLocal(before);
      toast("Dossier non enregistré, réessaie");
    }
  };
  const addLabel = async (raw: string) => {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) return false;
    if (labels.some((l) => l.toLowerCase() === name.toLowerCase())) {
      toast("Ce titre existe déjà");
      return false;
    }
    const next = [...labels, name];
    setLabelsLocal(next);
    const ok = await mergeAppStateKey("dmLabels", toOrder(next));
    if (!ok) {
      setLabelsLocal(null);
      toast("Titre non enregistré, réessaie");
    }
    return ok;
  };
  const removeLabel = async (name: string) => {
    const next = labels.filter((l) => l !== name);
    setLabelsLocal(next);
    const ok = await mergeAppStateKey("dmLabels", toOrder(next), [name]);
    if (!ok) {
      setLabelsLocal(null);
      return toast("Titre non supprimé, réessaie");
    }
    if (filter === `label:${name}`) setFilter("toutes");
    // Retiré aussi des conversations qui le portaient.
    const touched = Object.entries(threadLabels).filter(([, l]) => l.includes(name));
    for (const [id, l] of touched) await setThreadLabels(id, l.filter((x) => x !== name));
    toast(`Titre « ${name} » supprimé`);
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, s] = await Promise.all([
        supabase.from("ig_threads").select("id, username, name, picture, followers, updated_at, last_text, last_from_me, emails, contact_id, hidden").order("updated_at", { ascending: false, nullsFirst: false }).limit(1000),
        supabase.from("ig_sync_state").select("key, data, at").in("key", ["inbox", "inbox_direct"]),
      ]);
      if (!alive) return;
      if (t.error) {
        setMissing(true);
        setThreads([]);
        return;
      }
      const list = (t.data as Thread[] | null) ?? [];
      setThreads(list);
      const rows = (s.data as { key: string; data: SyncState; at: string }[] | null) ?? [];
      setState(rows.find((r) => r.key === "inbox") ?? null);
      setDirect(rows.find((r) => r.key === "inbox_direct") ?? null);
      const ids = [...new Set(list.map((x) => x.contact_id).filter((x): x is string => !!x))];
      const m = new Map<string, { brand: string; email: string | null }>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("contacts").select("id, brand, email").in("id", ids.slice(i, i + 150));
        for (const c of (data as { id: string; brand: string; email: string | null }[] | null) ?? []) m.set(c.id, { brand: c.brand, email: c.email });
      }
      if (alive) setContacts(m);
    })();
    return () => {
      alive = false;
    };
  }, [reload, live]);

  // Recherche dans le texte des messages (côté base), en plus du nom et du @.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      void supabase.from("ig_messages").select("thread_id, text, at").ilike("text", `%${esc(needle)}%`).order("at", { ascending: false }).limit(300).then(({ data }) => {
        if (!alive) return;
        const m = new Map<string, string>();
        for (const r of (data as { thread_id: string; text: string }[] | null) ?? []) if (!m.has(r.thread_id)) m.set(r.thread_id, r.text);
        setHits(m);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const sync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("ig-inbox", { body: {} });
    setSyncing(false);
    noteQuota(data);
    const r = (data ?? {}) as SyncState & { error?: string; saved?: number; linked?: number };
    if (error || r.error) {
      setState({ data: { ok: false, why: r.error ?? "reseau", detail: (r as { detail?: string }).detail ?? null }, at: new Date().toISOString() });
      return toast(r.error === "migration_manquante" ? "Pas encore activé (mise à jour en attente)." : "Lecture des messages impossible : voir le message en haut");
    }
    toast(`${r.threads ?? 0} conversation${(r.threads ?? 0) > 1 ? "s" : ""} à jour${r.touches ? ` · ${r.touches} échange${r.touches > 1 ? "s" : ""} noté${r.touches > 1 ? "s" : ""} en prospection` : ""}${r.emails ? ` · ${r.emails} email${r.emails > 1 ? "s" : ""} ajouté${r.emails > 1 ? "s" : ""} aux fiches` : ""}${r.left ? ` · ${r.left} à lire au prochain passage` : ""}`);
    setReload((n) => n + 1);
  };

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (threads ?? []).filter((t) => {
      if (filter === "masquees" ? !t.hidden : t.hidden) return false;
      if (filter === "fiches" && !t.contact_id) return false;
      if (filter === "emails" && !t.emails?.length) return false;
      if (filter === "sans" && t.contact_id) return false;
      if (filter.startsWith("label:") && !(threadLabels[t.id] ?? []).includes(filter.slice(6))) return false;
      if (!needle) return true;
      return `${t.name ?? ""} ${t.username ?? ""}`.toLowerCase().includes(needle) || !!hits?.has(t.id);
    });
  }, [threads, filter, q, hits, threadLabels]);
  const labelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads ?? []) if (!t.hidden) for (const l of threadLabels[t.id] ?? []) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  }, [threads, threadLabels]);
  const counts = useMemo(() => {
    const list = (threads ?? []).filter((t) => !t.hidden);
    return { all: list.length, linked: list.filter((t) => t.contact_id).length, emails: list.filter((t) => t.emails?.length).length };
  }, [threads]);
  const current = (threads ?? []).find((t) => t.id === sel) ?? null;
  const problem = inboxWhy(state?.data ?? null);

  if (threads === null) return <AnimatedBadge status="loading" size="sm">Chargement des messages…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center text-sm text-muted-foreground">
        Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic).
      </div>
    );
  }

  return (
    <>
      <PageHeaderRow>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {state?.at ? `Mis à jour ${since(state.at)}` : EMPTY}
          <HelpTip title="Comment ça marche ?" align="end">
            <p>Chaque DM reçu arrive en direct, avec une notification. En plus, toutes les 5 heures, l'app relit les conversations du compte Instagram de TTP (les 20 derniers messages de chacune : c'est la limite de Meta).</p>
            <p><span className="font-medium text-foreground">Répondre</span> : possible depuis l'app dans les 24 h qui suivent le dernier message de la personne (règle de Meta). Au-delà, « Répondre sur Instagram ».</p>
            <p><span className="font-medium text-foreground">Dossiers</span> : range une conversation avec « Classer » ; crée tes propres titres avec « + ».</p>
            <p><span className="font-medium text-foreground">Fiches contact</span> : si le @ correspond à une fiche, l'email donné en message y est ajouté s'il manque, et chaque échange est noté dans son suivi de prospection (canal Instagram).</p>
            <p><span className="font-medium text-foreground">Radar à marques</span> : les marques avec qui tu as déjà une conversation sont mises de côté.</p>
          </HelpTip>
        </div>
        <PhoneMenu items={[{ key: "sync", label: syncing ? "Actualisation…" : "Actualiser", icon: RefreshCw, onClick: () => { if (!syncing) void sync(); } }]} />
        <button type="button" onClick={() => void sync()} disabled={syncing} className="ios-phone-hide flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} /> Actualiser
        </button>
      </PageHeaderRow>

      {/* État de la liaison avec Instagram : vert = tout marche, rouge = bloqué (avec la raison). */}
      {problem ? (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border border-danger/30 bg-danger/[0.07] px-4 py-3">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 self-start rounded-full bg-danger [margin-top:5px]" />
          <div className="min-w-[220px] flex-1">
            <p className="text-[13px] font-semibold text-dangertext">Instagram : lecture des DM bloquée</p>
            {/* Réponse brute de Meta : gardée en infobulle, pas dans le texte. */}
            <p className="text-[12.5px] leading-relaxed text-muted-foreground" title={state?.data.detail ? `Meta : ${state.data.detail}` : undefined}>
              {problem}
              {direct?.data.ok && Date.parse(direct.at) > Date.parse(state?.at ?? "") && <> Les nouveaux DM arrivent quand même en direct (dernier {since(direct.at)}).</>}
            </p>
          </div>
          <button type="button" onClick={() => void sync()} disabled={syncing} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-medium text-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} /> Réessayer
          </button>
        </div>
      ) : state?.data.ok ? (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl border border-ok/30 bg-ok/[0.08] px-4 py-3">
          <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-40 motion-reduce:hidden" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-ok" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ok">Instagram connecté{state.data.me ? ` · @${state.data.me}` : ""}</p>
            <p className="text-[12.5px] text-muted-foreground">
              DM reçus en direct, relecture complète toutes les 5 h · dernière {since(direct && Date.parse(direct.at) > Date.parse(state.at) ? direct.at : state.at)}
              {(state.data.left ?? 0) > 0 && <> · {state.data.left} conversation{(state.data.left ?? 0) > 1 ? "s" : ""} encore à lire (en cours, tout seul)</>}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Kpi icon={MessagesSquare} n={counts.all} label="conversations" onClick={() => setFilter("toutes")} />
        <Kpi icon={Contact} n={counts.linked} label="avec fiche" onClick={() => setFilter("fiches")} />
        <Kpi icon={Mail} n={counts.emails} label="emails trouvés" onClick={() => setEmailsOpen(true)} hint="Voir et copier" />
      </div>
      {emailsOpen && (
        <EmailsPanel
          threads={threads}
          contacts={contacts}
          onClose={() => setEmailsOpen(false)}
          onOpen={(id) => {
            setEmailsOpen(false);
            setFilter("toutes");
            setQ("");
            setSel(id);
          }}
        />
      )}

      <div className="grid min-h-[60vh] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface md:grid-cols-[340px_minmax(0,1fr)]">
        {/* Liste */}
        <div className={cn("flex min-h-0 min-w-0 flex-col border-border md:border-r", current && "hidden md:flex")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un nom, un @, un mot, un email…" className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-8 text-[13px] outline-none focus:border-primary" />
              {q && <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-foreground" aria-label="Effacer"><X className="h-3.5 w-3.5" /></button>}
            </div>
            {/* Téléphone : une seule rangée qui défile (pas deux lignes de pastilles). */}
            <div className="flex flex-wrap gap-1 max-md:-mx-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
              {FILTERS.map((f) => (
                <button key={f.v} type="button" onClick={() => setFilter(f.v)} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors", filter === f.v ? "bg-foreground text-background" : "bg-panel text-muted-foreground hover:text-foreground")}>
                  {f.label}
                </button>
              ))}
            </div>
            {/* Dossiers : les titres de l'agence, avec leur nombre de conversations. */}
            <div className="flex flex-wrap items-center gap-1 max-md:-mx-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
              <Tag className="mr-0.5 h-3 w-3 shrink-0 text-faint" />
              {labels.map((l) => {
                const on = filter === `label:${l}`;
                return (
                  <button key={l} type="button" onClick={() => setFilter(on ? "toutes" : `label:${l}`)} className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>
                    {l}{labelCounts.get(l) ? <span className={cn("ml-1 tabular-nums", on ? "opacity-70" : "text-faint")}>{labelCounts.get(l)}</span> : null}
                  </button>
                );
              })}
              <NewLabel onAdd={addLabel} />
            </div>
          </div>
          <div className="max-h-[70vh] min-h-0 flex-1 overflow-y-auto">
            {view.length ? view.map((t) => {
              const hit = hits?.get(t.id);
              return (
                <button key={t.id} type="button" onClick={() => setSel(t.id)} className={cn("flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-rowhover", sel === t.id && "bg-primary/[0.05]")}>
                  <Avatar t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{display(t)}</span>
                      <span className="shrink-0 text-[10px] text-faint">{t.updated_at ? fmtAgo(t.updated_at) : ""}</span>
                    </div>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {hit ? <Rich text={hit} q={q} /> : <>{t.last_from_me ? "Toi : " : ""}{t.last_text}</>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {labelsOf(t.id).map((l) => <span key={l} className="rounded-full bg-panel px-1.5 py-px text-[10px] font-medium text-muted-foreground">{l}</span>)}
                      {t.contact_id && <span className="inline-flex items-center gap-0.5 rounded-full bg-signal/10 px-1.5 py-px text-[10px] font-medium text-signaltext"><Check className="h-2.5 w-2.5" /> Fiche</span>}
                      {!!t.emails?.length && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary"><Mail className="h-2.5 w-2.5" /> Email</span>}
                    </div>
                  </div>
                </button>
              );
            }) : (
              <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                <Inbox className="mx-auto mb-2 h-6 w-6 text-faint" />
                {threads.length ? "Aucune conversation ne correspond." : "Aucune conversation pour l'instant. Clique « Actualiser » pour lire les DM."}
              </div>
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className={cn("min-h-0 min-w-0", !current && "hidden md:block")}>
          {current ? (
            <Conversation
              t={current}
              q={q}
              contact={current.contact_id ? contacts.get(current.contact_id) ?? null : null}
              onBack={() => setSel(null)}
              onChange={() => setReload((n) => n + 1)}
              labels={labels}
              mine={labelsOf(current.id)}
              onLabels={(list) => void setThreadLabels(current.id, list)}
              onAddLabel={addLabel}
              onRemoveLabel={(l) => void removeLabel(l)}
            />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-[13px] text-muted-foreground">
              <div>
                <MessagesSquare className="mx-auto mb-2 h-8 w-8 text-faint" />
                Choisis une conversation
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ icon: Icon, n, label, onClick, hint }: { icon: typeof Mail; n: number; label: string; onClick?: () => void; hint?: string }) {
  return (
    <button type="button" onClick={onClick} title={hint} className="group/k flex items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-rowhover">
      <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-panel text-muted-foreground sm:grid"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[18px] font-bold leading-none tabular-nums text-foreground">{n}</div>
        <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
      </div>
      {hint && <span className="hidden shrink-0 text-[11px] font-medium text-primary sm:inline">{hint}</span>}
    </button>
  );
}

/**
 * « Emails trouvés » : toutes les adresses données en DM, avec la personne, la fiche
 * contact et la date. Copier une adresse, tout copier, exporter pour Excel, ou ouvrir
 * la conversation.
 */
function EmailsPanel({ threads, contacts, onClose, onOpen }: {
  threads: Thread[]; contacts: Map<string, { brand: string; email: string | null }>; onClose: () => void; onOpen: (threadId: string) => void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const rows = useMemo(() => {
    const out: { email: string; t: Thread; fiche: string | null }[] = [];
    const seen = new Set<string>();
    for (const t of [...threads].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))) {
      for (const e of t.emails ?? []) {
        const k = e.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ email: k, t, fiche: t.contact_id ? contacts.get(t.contact_id)?.brand ?? null : null });
      }
    }
    return out;
  }, [threads, contacts]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.email} ${r.t.name ?? ""} ${r.t.username ?? ""} ${r.fiche ?? ""}`.toLowerCase().includes(needle)) : rows;
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast("Copie impossible");
    }
  };
  const exportCsv = () => {
    const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [["Email", "Nom", "Instagram", "Fiche contact", "Dernier échange"], ...shown.map((r) => [
      r.email, r.t.name ?? "", r.t.username ? `@${r.t.username}` : "", r.fiche ?? "", r.t.updated_at ? new Date(r.t.updated_at).toLocaleDateString("fr-FR") : "",
    ])].map((l) => l.map(cell).join(";"));
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `emails-dm-instagram-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={onClose} label="Emails trouvés">
      <div className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-foreground">Emails trouvés dans les DM</div>
            <div className="text-[12px] text-muted-foreground">{rows.length} adresse{rows.length > 1 ? "s" : ""} donnée{rows.length > 1 ? "s" : ""} en message</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un email, un nom, une marque…" className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-[13px] outline-none focus:border-primary max-md:text-[16px]" />
          </div>
          <button type="button" onClick={() => void copy(shown.map((r) => r.email).join(", "), `${shown.length} adresse${shown.length > 1 ? "s" : ""} copiée${shown.length > 1 ? "s" : ""}`)} disabled={!shown.length} className={BTN}><Copy className="h-3 w-3" /> Tout copier</button>
          <button type="button" onClick={exportCsv} disabled={!shown.length} className={BTN}>Exporter (Excel)</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length ? shown.map((r) => (
            <div key={r.email} className="flex items-center gap-3 border-b border-border/60 px-5 py-2.5">
              <Avatar t={r.t} size={34} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => void copy(r.email, "Adresse copiée")} title="Copier l'adresse" className="flex max-w-full items-center gap-1.5 text-left text-[13.5px] font-semibold text-primary hover:underline">
                  <span className="truncate">{r.email}</span><Copy className="h-3 w-3 shrink-0" />
                </button>
                <div className="truncate text-[12px] text-muted-foreground">
                  {display(r.t)}{r.t.username && r.t.name ? ` · @${r.t.username}` : ""}{r.t.updated_at ? ` · ${fmtAgo(r.t.updated_at)}` : ""}
                </div>
              </div>
              {r.fiche ? (
                <span className="hidden shrink-0 items-center gap-1 rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signaltext sm:inline-flex"><Check className="h-3 w-3" /> {r.fiche}</span>
              ) : (
                <span className="hidden shrink-0 text-[11px] text-faint sm:inline">Sans fiche</span>
              )}
              <button type="button" onClick={() => onOpen(r.t.id)} className={BTN}>Conversation</button>
            </div>
          )) : (
            <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">{rows.length ? "Aucun email ne correspond." : "Aucun email trouvé pour l'instant : dès qu'une personne donne son adresse en DM, elle apparaît ici."}</p>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/** « + » : crée un titre de dossier (champ en ligne). */
function NewLabel({ onAdd }: { onAdd: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Créer un titre" aria-label="Créer un titre" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" />
      </button>
    );
  }
  const done = async () => {
    if (v.trim() && !(await onAdd(v))) return;
    setV("");
    setOpen(false);
  };
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void done();
        if (e.key === "Escape") {
          setV("");
          setOpen(false);
        }
      }}
      onBlur={() => void done()}
      placeholder="Nouveau titre"
      maxLength={40}
      className="h-6 w-32 shrink-0 rounded-full border border-primary bg-surface px-2.5 text-[11px] outline-none"
    />
  );
}

/** « Classer » : coche les dossiers de la conversation, crée ou supprime un titre. */
function LabelPicker({ labels, mine, onChange, onAdd, onRemove }: {
  labels: string[]; mine: string[]; onChange: (l: string[]) => void; onAdd: (name: string) => Promise<boolean>; onRemove: (l: string) => void;
}) {
  const [ask, setAsk] = useState<string | null>(null);
  const [v, setV] = useState("");
  const add = async () => {
    const name = v.replace(/\s+/g, " ").trim();
    if (!name) return;
    if (await onAdd(name)) {
      onChange([...mine, name]);
      setV("");
    }
  };
  return (
    <Popover onOpenChange={() => setAsk(null)}>
      <PopoverTrigger asChild>
        <button type="button" className={BTN}><Tag className="h-3 w-3" /> {mine.length ? mine.join(", ") : "Classer"}</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        {labels.map((l) => {
          const on = mine.includes(l);
          return (
            <div key={l} className="group/l flex items-center rounded-lg hover:bg-rowhover">
              <button type="button" onClick={() => onChange(on ? mine.filter((x) => x !== l) : [...mine, l])} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px] text-foreground">
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{on && <Check className="h-3 w-3" />}</span>
                <span className="truncate">{l}</span>
              </button>
              {ask === l ? (
                <button type="button" onClick={() => { setAsk(null); onRemove(l); }} className="mr-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-dangertext hover:underline">Supprimer ?</button>
              ) : (
                <button type="button" onClick={() => setAsk(l)} aria-label={`Supprimer le titre ${l}`} title="Supprimer ce titre" className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-faint opacity-0 hover:text-foreground group-hover/l:opacity-100 focus-visible:opacity-100 max-sm:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
        <div className="mt-1 flex items-center gap-1 border-t border-border px-1 pt-1.5">
          <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} maxLength={40} placeholder="Nouveau titre…" className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[13px] outline-none placeholder:text-faint" />
          <button type="button" onClick={() => void add()} disabled={!v.trim()} className="h-7 shrink-0 rounded-md px-2 text-[12px] font-medium text-primary disabled:opacity-40">Créer</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Message d'erreur d'envoi (fonction ig-send). */
const SEND_ERRORS: Record<string, string> = {
  hors_fenetre: "Plus de 24 h depuis son dernier message : Instagram oblige à répondre depuis l'app Instagram.",
  indisponible: "Ce compte n'accepte pas ce message (bloqué ou réglages de confidentialité).",
  texte_invalide: "Message vide ou trop long (1 000 caractères max).",
  destinataire_inconnu: "Conversation pas encore synchronisée : clique « Actualiser » puis réessaie.",
  meta_autorisation: "Meta refuse l'envoi : une autorisation manque (voir Réglages › Diagnostic).",
  meta_jeton: "Connexion à Meta expirée (voir Réglages › Diagnostic).",
  meta_limite: "Trop d'envois d'un coup : réessaie dans un moment.",
};

function Conversation({ t, q, contact, onBack, onChange, labels, mine, onLabels, onAddLabel, onRemoveLabel }: {
  t: Thread; q: string; contact: { brand: string; email: string | null } | null; onBack: () => void; onChange: () => void;
  labels: string[]; mine: string[]; onLabels: (l: string[]) => void; onAddLabel: (name: string) => Promise<boolean>; onRemoveLabel: (l: string) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setMsgs(null);
    // « * » : marche avant et après l'ajout de la colonne `media` (photos, vidéos).
    void supabase.from("ig_messages").select("*").eq("thread_id", t.id).order("at").then(({ data }) => {
      if (alive) setMsgs((data as Msg[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, [t.id, t.updated_at]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);
  useEffect(() => setDraft(""), [t.id]);
  // Fichiers des photos / vidéos : liens signés d'une heure (bucket privé).
  const [signed, setSigned] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const paths = [...new Set((msgs ?? []).flatMap((m) => (m.media ?? []).map((x) => x.path).filter((p): p is string => !!p)))];
    if (!paths.length) return;
    let alive = true;
    void supabase.storage.from("ig-media").createSignedUrls(paths, 3600).then(({ data }) => {
      if (!alive || !data) return;
      setSigned(new Map(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string])));
    });
    return () => {
      alive = false;
    };
  }, [msgs]);

  // Règle de Meta : réponse depuis l'app dans les 24 h qui suivent son dernier message.
  const lastIn = useMemo(() => [...(msgs ?? [])].reverse().find((m) => !m.me)?.at ?? null, [msgs]);
  const [now] = useState(() => Date.now());
  const replyOpen = !!lastIn && now - Date.parse(lastIn) < 24 * 3600e3;
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("ig-send", { body: { threadId: t.id, text } });
    let r = (data ?? null) as { ok?: boolean; id?: string; at?: string; error?: string } | null;
    if (error && !r) {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      r = ctx?.json ? ((await ctx.json().catch(() => null)) as typeof r) : null;
    }
    setSending(false);
    if (!r?.ok || !r.id) {
      if (!r?.error && error) return toast("Envoi pas encore disponible (fonction à déployer) ou réseau coupé");
      return toast(SEND_ERRORS[r?.error ?? ""] ?? "Envoi impossible, réessaie");
    }
    setMsgs((cur) => [...(cur ?? []), { id: r!.id!, at: r!.at ?? new Date().toISOString(), me: true, text }]);
    setDraft("");
    toast("DM envoyé ✓");
    onChange();
  };

  const createContact = async () => {
    setBusy("contact");
    try {
      // Une fiche existe déjà avec ce @ ? On la relie au lieu d'en créer une deuxième.
      const handle = t.username ? `@${t.username}` : null;
      let id: string | null = null;
      if (handle) {
        const { data: same } = await supabase.from("contacts").select("id").ilike("instagram", esc(handle)).limit(1);
        id = ((same as { id: string }[] | null) ?? [])[0]?.id ?? null;
      }
      if (!id) {
        const created = await dbInsert("contacts", {
          brand: t.name?.trim() || handle || "Instagram", instagram: handle, email: t.emails?.[0] ?? null, tone: "cyan",
        });
        if (!created) return toast("Erreur, réessaie");
        id = created.id;
      }
      const { error } = await supabase.from("ig_threads").update({ contact_id: id }).eq("id", t.id);
      if (error) return toast("Fiche prête, mais pas reliée à la conversation : réessaie");
      toast("Fiche contact reliée ✓ : les échanges y sont notés");
      onChange();
      // Le journal de prospection se remplit au passage suivant : on le lance tout de suite.
      void supabase.functions.invoke("ig-inbox", { body: {} }).then(() => onChange());
    } finally {
      setBusy(null);
    }
  };
  const toPipeline = async () => {
    setBusy("pipeline");
    const name = t.name?.trim() || `@${t.username}`;
    const { data: same } = await supabase.from("prospects").select("id").or(`contact.eq."@${t.username ?? ""}",brand.ilike."${name.replace(/["\\,()%]/g, " ")}"`).limit(1);
    if ((same as unknown[] | null)?.length) {
      setBusy(null);
      return toast("Déjà au Pipeline");
    }
    const { data: top } = await supabase.from("prospects").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = (((top as { sort_order: number | null }[] | null) ?? [])[0]?.sort_order ?? 0) + 1;
    const ok = await dbInsert("prospects", { brand: name, contact: t.username ? `@${t.username}` : null, value: "—", stage: "Contact", tone: "neutral", sort_order: order });
    setBusy(null);
    toast(ok ? "Ajoutée au Pipeline ✓ (étape Contact)" : "Erreur, réessaie");
  };
  // Valeur VOULUE envoyée telle quelle (jamais « l'inverse de ce qu'on croit ») : un double
  // clic ne peut plus masquer une conversation qu'on voulait garder.
  const setHidden = async (hide: boolean) => {
    setBusy("hide");
    const { error } = await supabase.from("ig_threads").update({ hidden: hide }).eq("id", t.id);
    setBusy(null);
    if (error) return toast("Erreur, réessaie");
    toast(hide ? "Conversation masquée : elle reste dans le filtre « Masquées »" : "Conversation réaffichée ✓");
    onChange();
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast("Copié");
    } catch {
      toast("Copie impossible");
    }
  };

  // Messages groupés par jour.
  const days = useMemo(() => {
    const out: { day: string; list: Msg[] }[] = [];
    for (const m of msgs ?? []) {
      const d = m.at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === d) last.list.push(m);
      else out.push({ day: d, list: [m] });
    }
    return out;
  }, [msgs]);

  return (
    <div className="flex h-full max-h-[78vh] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-rowhover md:hidden" aria-label="Retour"><ArrowLeft className="h-4 w-4" /></button>
        <Avatar t={t} size={42} />
        {/* Nom lisible : les boutons passent à la ligne plutôt que d'écraser le nom. */}
        <div className="min-w-[180px] flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">{display(t)}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {t.username ? `@${t.username}` : ""}
            {t.followers != null ? ` · ${fmtCompact(t.followers)} abonnés` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <LabelPicker labels={labels} mine={mine} onChange={onLabels} onAdd={onAddLabel} onRemove={onRemoveLabel} />
          {t.username && (
            <a href={`https://ig.me/m/${encodeURIComponent(t.username)}`} target="_blank" rel="noreferrer" className={BTN}><Send className="h-3 w-3" /> Répondre sur Instagram</a>
          )}
          {contact ? (
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "contacts" }))} className={cn(BTN, "border-signal/40 text-signaltext")}><Check className="h-3 w-3" /> Fiche : {contact.brand}</button>
          ) : (
            <button type="button" onClick={() => void createContact()} disabled={!!busy} className={BTN}>{busy === "contact" ? <Spin size={12} /> : <Contact className="h-3 w-3" />} Créer la fiche contact</button>
          )}
          <button type="button" onClick={() => void toPipeline()} disabled={!!busy} className={BTN}>{busy === "pipeline" ? <Spin size={12} /> : <AtSign className="h-3 w-3" />} Pipeline</button>
          {!t.hidden && (
            <button type="button" onClick={() => void setHidden(true)} disabled={!!busy} className={cn(BTN, "text-muted-foreground")} title="Masquer (spam, conversation sans intérêt)">
              {busy === "hide" ? <Spin size={12} /> : <EyeOff className="h-3 w-3" />} Masquer
            </button>
          )}
        </div>
      </div>
      {t.hidden && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-4 py-2 text-[12px] text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          <span>Conversation masquée : elle n'apparaît plus dans « Toutes ».</span>
          <button type="button" onClick={() => void setHidden(false)} disabled={!!busy} className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50">
            Réafficher
          </button>
        </div>
      )}
      {!!t.emails?.length && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/[0.04] px-4 py-2 text-[12px]">
          <Mail className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Email{t.emails.length > 1 ? "s" : ""} donné{t.emails.length > 1 ? "s" : ""} :</span>
          {t.emails.map((e) => (
            <button key={e} type="button" onClick={() => void copy(e)} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">{e}<Copy className="h-3 w-3" /></button>
          ))}
          {contact && (contact.email?.toLowerCase() === t.emails[0].toLowerCase() ? <span className="text-signaltext">· sur la fiche ✓</span> : contact.email ? <span className="text-faint">· la fiche a déjà {contact.email}</span> : null)}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/40 px-4 py-4">
        {msgs === null ? (
          <div className="grid place-items-center py-10"><Loader variant="dots" size={18} className="text-faint" /></div>
        ) : (
          <>
            {msgs.length >= 20 && <p className="text-center text-[11px] text-faint">Meta ne donne que les 20 derniers messages de chaque conversation (plus anciens : dans l'app Instagram).</p>}
            {days.map((g) => (
              <div key={g.day} className="space-y-1.5">
                <div className="text-center text-[10px] font-medium uppercase tracking-wide text-faint">{dayLabel(g.list[0].at)}</div>
                {g.list.map((m) => (
                  <div key={m.id} className={cn("flex", m.me ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug", m.me ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-panel text-foreground")}>
                      {m.media?.length ? (
                        <MediaList media={m.media} signed={signed} me={m.me} />
                      ) : m.text === NO_TEXT ? (
                        <span>
                          {m.media ? "Contenu non disponible (supprimé ou expiré)" : "Photo, vidéo ou story : chargement au prochain passage"}
                          {t.username && <> · <a href={`https://ig.me/m/${encodeURIComponent(t.username)}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">voir dans Instagram</a></>}
                        </span>
                      ) : null}
                      {m.text !== NO_TEXT && (m.me ? m.text : <Rich text={m.text} q={q} />)}
                      <div className={cn("mt-0.5 text-right text-[10px]", m.me ? "text-primary-foreground/70" : "text-faint")}>{hour(m.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <div ref={endRef} />
          </>
        )}
      </div>
      {/* Répondre depuis l'app (dans les 24 h qui suivent son dernier message, règle de Meta). */}
      {msgs !== null && (
        replyOpen ? (
          <div className="flex items-end gap-2 border-t border-border bg-surface px-3 py-2.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              }}
              rows={1}
              aria-label="Répondre en DM"
              placeholder={`Répondre à ${display(t)}…`}
              className="max-h-40 min-h-10 min-w-0 flex-1 resize-none rounded-[20px] border border-border bg-surface px-4 py-2 text-[14px] leading-snug text-foreground outline-none [field-sizing:content] placeholder:text-faint focus:border-primary max-md:text-[16px]"
            />
            <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Envoyer le DM" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-35">
              {sending ? <Spin size={14} /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border bg-muted/50 px-4 py-2.5 text-[12px] text-muted-foreground">
            <span className="min-w-0 flex-1">
              {lastIn ? "Plus de 24 h depuis son dernier message : Instagram n'autorise la réponse que depuis son app." : "Instagram n'autorise à écrire depuis l'app qu'après un message de la personne."}
            </span>
            {t.username && <a href={`https://ig.me/m/${encodeURIComponent(t.username)}`} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline">Répondre sur Instagram</a>}
          </div>
        )
      )}
    </div>
  );
}
/** Photos, vidéos, vocaux et partages d'un message. */
function MediaList({ media, signed, me }: { media: Media[]; signed: Map<string, string>; me: boolean }) {
  const link = cn("underline underline-offset-2", me ? "text-primary-foreground" : "text-primary");
  return (
    <div className="flex flex-col gap-1.5">
      {media.map((x, i) => {
        const url = x.path ? signed.get(x.path) : x.src;
        if ((x.kind === "image" || x.kind === "sticker") && url) {
          return (
            <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
              <img src={url} alt="" loading="lazy" className={cn("max-h-72 w-auto max-w-full rounded-xl object-contain", x.kind === "sticker" && "max-h-24")} />
            </a>
          );
        }
        if (x.kind === "video" && url) return <video key={i} src={url} controls preload="metadata" playsInline className="max-h-80 w-full max-w-sm rounded-xl bg-black" />;
        if (x.kind === "audio" && url) return <audio key={i} src={url} controls preload="metadata" className="w-64 max-w-full" />;
        if (x.kind === "share" && x.link) {
          return <a key={i} href={x.link} target="_blank" rel="noreferrer" className={link}>{x.name ? `Publication partagée : ${x.name}` : "Publication partagée"} ↗</a>;
        }
        if (x.kind === "story" && x.link) return <a key={i} href={x.link} target="_blank" rel="noreferrer" className={link}>{x.name ?? "Story"} ↗</a>;
        if (x.kind === "file" && url) return <a key={i} href={url} target="_blank" rel="noreferrer" className={link}>{x.name ?? "Fichier"} ↗</a>;
        return <span key={i} className="opacity-80">{x.kind === "video" ? "Vidéo" : x.kind === "audio" ? "Message vocal" : "Photo"} (chargement…)</span>;
      })}
    </div>
  );
}

const BTN = "inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50";

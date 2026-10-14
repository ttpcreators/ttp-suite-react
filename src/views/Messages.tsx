import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, AtSign, Check, Contact, Copy, EyeOff, Inbox, Loader2, Mail, MessagesSquare, RefreshCw, Search, Send, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { PageHeaderRow } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLiveKey } from "@/lib/useLive";
import { dbInsert } from "@/lib/db";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, igWhyText, noteQuota } from "@/lib/instagram";

/**
 * DM INSTAGRAM (agence) : les messages privés du compte Instagram de TTP, lus toutes
 * les heures par la fonction ig-inbox (API officielle de Meta).
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
type Msg = { id: string; at: string; me: boolean; text: string };
type SyncState = { ok?: boolean; why?: string; detail?: string | null; threads?: number; left?: number; touches?: number; emails?: number; me?: string | null };
type Filter = "toutes" | "fiches" | "emails" | "sans" | "masquees";

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

function inboxWhy(s: SyncState | null): string {
  if (!s || s.ok !== false) return "";
  // Réglage à faire côté Meta (Page Facebook non attribuée, autorisations manquantes) : détail dans Diagnostic.
  if (s.why === "page_introuvable" || s.why === "meta_autorisation")
    return "Un réglage est à faire côté Meta (Page Facebook ou autorisations). Détails dans Réglages › Diagnostic.";
  // « meta_-2 » / Timeout : ancienne réponse de la fonction pour le même blocage.
  if (s.why === "meta_validation" || s.why === "meta_-2" || /timeout/i.test(s.detail ?? ""))
    return "Meta n'a pas encore autorisé TTP Suite à lire les DM. Rien à faire de ton côté : la page se remplira dès que l'accès sera validé.";
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
  const [contacts, setContacts] = useState<Map<string, { brand: string; email: string | null }>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Map<string, string> | null>(null); // conversation → message trouvé
  const [filter, setFilter] = useState<Filter>("toutes");
  const [syncing, setSyncing] = useState(false);
  const [reload, setReload] = useState(0);
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, s] = await Promise.all([
        supabase.from("ig_threads").select("id, username, name, picture, followers, updated_at, last_text, last_from_me, emails, contact_id, hidden").order("updated_at", { ascending: false, nullsFirst: false }).limit(1000),
        supabase.from("ig_sync_state").select("data, at").eq("key", "inbox").maybeSingle(),
      ]);
      if (!alive) return;
      if (t.error) {
        setMissing(true);
        setThreads([]);
        return;
      }
      const list = (t.data as Thread[] | null) ?? [];
      setThreads(list);
      setState((s.data as { data: SyncState; at: string } | null) ?? null);
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
      if (!needle) return true;
      return `${t.name ?? ""} ${t.username ?? ""}`.toLowerCase().includes(needle) || !!hits?.has(t.id);
    });
  }, [threads, filter, q, hits]);
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
          {state?.at ? `Mis à jour ${fmtAgo(state.at)}` : "Jamais actualisé"}
          <HelpTip title="Comment ça marche ?" align="end">
            <p>Toutes les heures, l'app lit les conversations du compte Instagram de TTP (les 20 derniers messages de chacune : c'est la limite de Meta).</p>
            <p><span className="font-medium text-foreground">Fiches contact</span> : si le @ correspond à une fiche, l'email donné en message y est ajouté s'il manque, et chaque échange est noté dans son suivi de prospection (canal Instagram).</p>
            <p><span className="font-medium text-foreground">Radar à marques</span> : les marques avec qui tu as déjà une conversation sont mises de côté.</p>
          </HelpTip>
        </div>
        <button type="button" onClick={() => void sync()} disabled={syncing} className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} /> Actualiser
        </button>
      </PageHeaderRow>

      {problem && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber/40 bg-amber/[0.06] p-3.5 text-[12px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
          <div>
            <p className="font-semibold text-foreground">Messages pas encore lisibles</p>
            {/* Réponse brute de Meta : gardée en infobulle, pas dans le texte. */}
            <p title={state?.data.detail ? `Meta : ${state.data.detail}` : undefined}>{problem}</p>
          </div>
        </div>
      )}

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Kpi icon={MessagesSquare} n={counts.all} label="conversations" />
        <Kpi icon={Contact} n={counts.linked} label="avec fiche" />
        <Kpi icon={Mail} n={counts.emails} label="emails trouvés" />
      </div>

      <div className="grid min-h-[60vh] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface md:grid-cols-[340px_minmax(0,1fr)]">
        {/* Liste */}
        <div className={cn("flex min-h-0 min-w-0 flex-col border-border md:border-r", current && "hidden md:flex")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un nom, un @, un mot, un email…" className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-8 text-[13px] outline-none focus:border-primary" />
              {q && <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-foreground" aria-label="Effacer"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button key={f.v} type="button" onClick={() => setFilter(f.v)} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors", filter === f.v ? "bg-foreground text-background" : "bg-panel text-muted-foreground hover:text-foreground")}>
                  {f.label}
                </button>
              ))}
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
                      {t.contact_id && <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600"><Check className="h-2.5 w-2.5" /> Fiche</span>}
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

function Kpi({ icon: Icon, n, label }: { icon: typeof Mail; n: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-2.5">
      <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-panel text-muted-foreground sm:grid"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <div className="text-[18px] font-bold leading-none tabular-nums text-foreground">{n}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Conversation({ t, q, contact, onBack, onChange }: { t: Thread; q: string; contact: { brand: string; email: string | null } | null; onBack: () => void; onChange: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setMsgs(null);
    void supabase.from("ig_messages").select("id, at, me, text").eq("thread_id", t.id).order("at").then(({ data }) => {
      if (alive) setMsgs((data as Msg[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, [t.id, t.updated_at]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  const createContact = async () => {
    setBusy("contact");
    const created = await dbInsert("contacts", {
      brand: t.name?.trim() || `@${t.username}`, instagram: t.username ? `@${t.username}` : null, email: t.emails?.[0] ?? null, tone: "cyan",
    });
    if (!created) {
      setBusy(null);
      return toast("Erreur, réessaie");
    }
    await supabase.from("ig_threads").update({ contact_id: created.id }).eq("id", t.id);
    // Le journal de prospection se remplit au passage suivant : on le lance tout de suite.
    void supabase.functions.invoke("ig-inbox", { body: {} }).then(() => onChange());
    setBusy(null);
    toast("Fiche contact créée ✓ : les échanges y sont notés");
    onChange();
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
  const toggleHidden = async () => {
    const { error } = await supabase.from("ig_threads").update({ hidden: !t.hidden }).eq("id", t.id);
    if (error) return toast("Erreur, réessaie");
    toast(t.hidden ? "Conversation affichée" : "Conversation masquée (filtre « Masquées »)");
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
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">{display(t)}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {t.username ? `@${t.username}` : ""}
            {t.followers != null ? ` · ${fmtCompact(t.followers)} abonnés` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {t.username && (
            <a href={`https://ig.me/m/${encodeURIComponent(t.username)}`} target="_blank" rel="noreferrer" className={BTN}><Send className="h-3 w-3" /> Répondre sur Instagram</a>
          )}
          {contact ? (
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "contacts" }))} className={cn(BTN, "border-emerald-500/40 text-emerald-600")}><Check className="h-3 w-3" /> Fiche : {contact.brand}</button>
          ) : (
            <button type="button" onClick={() => void createContact()} disabled={!!busy} className={BTN}>{busy === "contact" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Contact className="h-3 w-3" />} Créer la fiche contact</button>
          )}
          <button type="button" onClick={() => void toPipeline()} disabled={!!busy} className={BTN}>{busy === "pipeline" ? <Loader2 className="h-3 w-3 animate-spin" /> : <AtSign className="h-3 w-3" />} Pipeline</button>
          <button type="button" onClick={() => void toggleHidden()} className={cn(BTN, "text-muted-foreground")} title={t.hidden ? "Afficher" : "Masquer (spam, conversation sans intérêt)"}><EyeOff className="h-3 w-3" /></button>
        </div>
      </div>
      {!!t.emails?.length && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/[0.04] px-4 py-2 text-[12px]">
          <Mail className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Email{t.emails.length > 1 ? "s" : ""} donné{t.emails.length > 1 ? "s" : ""} :</span>
          {t.emails.map((e) => (
            <button key={e} type="button" onClick={() => void copy(e)} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">{e}<Copy className="h-3 w-3" /></button>
          ))}
          {contact && (contact.email?.toLowerCase() === t.emails[0].toLowerCase() ? <span className="text-emerald-600">· sur la fiche ✓</span> : contact.email ? <span className="text-faint">· la fiche a déjà {contact.email}</span> : null)}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/40 px-4 py-4">
        {msgs === null ? (
          <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-faint" /></div>
        ) : (
          <>
            {msgs.length >= 20 && <p className="text-center text-[11px] text-faint">Meta ne donne que les 20 derniers messages de chaque conversation (plus anciens : dans l'app Instagram).</p>}
            {days.map((g) => (
              <div key={g.day} className="space-y-1.5">
                <div className="text-center text-[10px] font-medium uppercase tracking-wide text-faint">{dayLabel(g.list[0].at)}</div>
                {g.list.map((m) => (
                  <div key={m.id} className={cn("flex", m.me ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug", m.me ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-panel text-foreground")}>
                      {m.me ? m.text : <Rich text={m.text} q={q} />}
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
    </div>
  );
}
const BTN = "inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50";

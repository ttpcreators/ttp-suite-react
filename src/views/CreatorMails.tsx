import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, AtSign, Inbox, Loader2, Mail, MessageSquare, Paperclip, RefreshCw, Send, Settings2, Tag,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { DashPanel, DashSectionTitle } from "@/components/ui/dash";
import { StatusSelect } from "@/components/ui/status-select";
import { notifyAgency } from "@/lib/push";
import {
  MAIL_STATUS, statusMeta, listMails, getMailThread, sendManagerNote, downloadAttachment, listGmailLabels,
  mailDocument, hasQuote, mailSnippet, fmtSize,
  type MailStatus, type MailThread, type MailThreadLite, type MailMessage, type MailSettings,
} from "@/lib/creatorMail";

/*
 * Section « Mails » (lecture seule) : les échanges de la boîte agence où apparaît
 * l'alias de la créatrice. Trois usages :
 *   - "creator" : la créatrice (lecture + « Écrire à mon manager ») ;
 *   - "agency"  : fiche créatrice côté agence (statuts + lecture des notes) ;
 *   - "preview" : l'agence regarde l'espace créateur (lecture seule).
 * Le filtrage est fait par le serveur (fonction creator-mail) : ce composant ne
 * reçoit jamais un mail qui ne concerne pas la créatrice.
 */
type Mode = "creator" | "agency" | "preview";

const STATUS_OPTIONS = MAIL_STATUS.map((s) => ({ value: s.value, label: s.label, dot: s.dot }));

const fmtWhen = (ts: number) => {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
};
const fmtFull = (ts: number) =>
  ts ? new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", m.badge)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Statut discret (pastille + texte) pour les lignes de la liste. */
function StatusDot({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Pastille d'initiale (marque ou expéditeur). L'agence = pastille pleine. */
function Initial({ name, agency, size = "md" }: { name: string; agency?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold uppercase",
        size === "md" ? "h-9 w-9 text-[13px]" : "h-8 w-8 text-[12px]",
        agency ? "bg-foreground text-background" : "bg-foreground/[0.07] text-foreground",
      )}
    >
      {agency ? "T" : (name.trim().charAt(0) || "?")}
    </span>
  );
}

/** Corps d'un mail : iframe isolée (aucun script), hauteur suivie en continu. */
function MailBody({ m, showQuoted }: { m: MailMessage; showQuoted: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(80);
  const doc = useMemo(() => mailDocument(m.html, m.text, showQuoted), [m.html, m.text, showQuoted]);
  const obs = useRef<ResizeObserver | null>(null);
  const onLoad = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (!d?.documentElement) return;
    const fit = () => setH(Math.min(6000, Math.max(24, d.documentElement.scrollHeight)));
    fit();
    // Les images (logos, signatures) arrivent après coup : on suit la hauteur.
    obs.current?.disconnect();
    obs.current = new ResizeObserver(fit);
    obs.current.observe(d.body);
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return (
    <iframe
      ref={ref}
      title={`Message de ${m.from}`}
      srcDoc={doc}
      // Pas de allow-scripts : aucun code du mail ne peut s'exécuter. allow-same-origin
      // sert uniquement à mesurer la hauteur ; les liens s'ouvrent dans un nouvel onglet.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={onLoad}
      style={{ height: h }}
      className="block w-full border-0 bg-white"
    />
  );
}

/** Un message du fil : replié (une ligne) ou déplié (corps + pièces jointes). */
function MailItem({
  m, open, onToggle, threadId, creator,
}: { m: MailMessage; open: boolean; onToggle: () => void; threadId: string; creator?: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const snippet = useMemo(() => mailSnippet(m.html, m.text), [m.html, m.text]);
  const name = m.fromAgency ? "TTP Creators" : m.from;
  if (!open) {
    return (
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-rowhover sm:px-6">
        <Initial name={m.from} agency={m.fromAgency} size="sm" />
        {/* Mobile : nom + date, puis l'aperçu dessous ; ≥ sm : tout sur une ligne. */}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
          <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
          <span className="col-span-2 row-start-2 truncate text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">{snippet}</span>
          <span className="col-start-2 row-start-1 shrink-0 text-[11px] tabular-nums text-faint sm:col-start-3">{fmtWhen(m.ts)}</span>
        </span>
      </button>
    );
  }
  return (
    <div className="px-4 py-4 sm:px-6">
      <button type="button" onClick={onToggle} className="mb-3 flex w-full items-start gap-3 text-left">
        <Initial name={m.from} agency={m.fromAgency} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
            <span className="truncate text-[12px] text-faint">{m.fromAgency ? m.from : m.fromEmail}</span>
          </span>
          <span className="block truncate text-[12px] text-faint">à {m.to.replace(/"?([^"<,]+?)"?\s*<[^>]+>/g, "$1")}{m.cc ? ` · cc ${m.cc.replace(/"?([^"<,]+?)"?\s*<[^>]+>/g, "$1")}` : ""}</span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-faint">
          <span className="sm:hidden">{fmtWhen(m.ts)}</span>
          <span className="hidden sm:inline">{fmtFull(m.ts)}</span>
        </span>
      </button>
      <div className="overflow-hidden rounded-xl bg-white sm:ml-11 dark:p-4">
        <MailBody m={m} showQuoted={showQuoted} />
      </div>
      {hasQuote(m.html) && (
        <button
          type="button"
          onClick={() => setShowQuoted((v) => !v)}
          title={showQuoted ? "Masquer l'historique" : "Afficher l'historique"}
          className="mt-2 rounded-md bg-muted px-2 py-0.5 text-[12px] font-semibold leading-none tracking-widest text-muted-foreground transition-colors hover:text-foreground sm:ml-11"
        >
          {showQuoted ? "Masquer" : "···"}
        </button>
      )}
      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 sm:ml-11">
          {m.attachments.map((a) => (
            <button
              key={a.attachmentId}
              type="button"
              onClick={() => downloadAttachment(threadId, a, creator).catch((e) => toast((e as Error).message))}
              className="flex max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-rowhover"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-foreground">{a.filename}</span>
                <span className="block text-[11px] text-faint">{fmtSize(a.size)} · Télécharger</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FILTERS: { key: "tous" | "encours" | "valide" | "refuse"; label: string; match: (s: MailStatus) => boolean }[] = [
  { key: "tous", label: "Tous", match: () => true },
  { key: "encours", label: "En cours", match: (s) => s === "nouvelle" || s === "negociation" },
  { key: "valide", label: "Validés", match: (s) => s === "valide" },
  { key: "refuse", label: "Refusés", match: (s) => s === "refuse" },
];

export function CreatorMailbox({ creator, mode }: { creator: string; mode: Mode }) {
  const asAgency = mode !== "creator";
  const forCreator = asAgency ? creator : undefined;
  const [threads, setThreads] = useState<MailThreadLite[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("tous");
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<MailThread | null>(null);
  const [threadErr, setThreadErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await listMails(forCreator);
      setConfigured(r.configured);
      setThreads(r.threads);
    } catch (e) {
      setErr((e as Error).message);
      setThreads((t) => t ?? []);
    } finally {
      setLoading(false);
    }
  }, [forCreator]);

  useEffect(() => {
    setThreads(null);
    setOpenId(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    setThread(null);
    setThreadErr(null);
    getMailThread(openId, forCreator)
      .then((t) => {
        if (!alive) return;
        setThread(t);
        // Dernier message déplié, les précédents repliés (comme Gmail).
        setExpanded(new Set(t.messages.length ? [t.messages[t.messages.length - 1].id] : []));
        // Agence : les notes de la créatrice sont marquées lues à l'ouverture.
        if (mode === "agency" && t.notes.some((n) => !n.agency_read_at)) {
          void supabase.from("creator_mail_notes").update({ agency_read_at: new Date().toISOString() })
            .eq("creator", creator).eq("thread_id", t.id).is("agency_read_at", null);
        }
      })
      .catch((e) => alive && setThreadErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [openId, forCreator, creator, mode]);

  const setStatus = async (threadId: string, status: MailStatus) => {
    const prev = threads;
    setThreads((l) => l?.map((t) => (t.id === threadId ? { ...t, status } : t)) ?? l);
    setThread((t) => (t && t.id === threadId ? { ...t, status } : t));
    const { error } = await supabase.from("creator_mail_threads")
      .upsert({ creator, thread_id: threadId, status, updated_at: new Date().toISOString() }, { onConflict: "creator,thread_id" });
    if (error) {
      setThreads(prev);
      toast("Statut non enregistré");
    }
  };

  const submitNote = async () => {
    if (!thread || !note.trim() || sending) return;
    setSending(true);
    try {
      const n = await sendManagerNote(thread.id, note.trim());
      setThread((t) => (t ? { ...t, notes: [...t.notes, n] } : t));
      setThreads((l) => l?.map((t) => (t.id === thread.id ? { ...t, notes: t.notes + 1 } : t)) ?? l);
      notifyAgency("mail", creator, `${thread.brand || thread.subject} : ${note.trim()}`);
      setNote("");
      toast("Message envoyé à ton manager ✓");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.key] = (threads ?? []).filter((t) => f.match(t.status)).length;
    return c;
  }, [threads]);
  const cur = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const shown = (threads ?? []).filter((t) => cur.match(t.status));

  if (threads === null) {
    return <DashPanel className="flex items-center justify-center gap-2 p-10 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement des mails…</DashPanel>;
  }
  if (!configured) {
    return (
      <DashPanel className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Inbox className="h-6 w-6 text-faint" />
        <p className="text-[13px] text-muted-foreground">
          {asAgency ? "Aucun alias ni libellé n'est lié à cette créatrice." : "Ta boîte mail n'est pas encore activée. Ton agence s'en occupe."}
        </p>
      </DashPanel>
    );
  }

  const list = (
    <DashPanel className={cn("flex min-w-0 flex-col", openId && "max-lg:hidden")}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 flex-1 gap-0.5 rounded-lg bg-muted p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1.5 text-[12px] font-medium transition-colors",
                filter === f.key ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              {counts[f.key] > 0 && <span className="tabular-nums text-faint">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} title="Actualiser" aria-label="Actualiser"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>
      {err && <div className="border-b border-border px-4 py-2.5 text-[12px] text-red-600 dark:text-red-400">{err}</div>}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Mail className="h-5 w-5 text-faint" />
          <p className="text-[13px] text-muted-foreground">{filter === "tous" ? "Aucun échange pour le moment." : "Aucun échange ici."}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenId(t.id)}
                className={cn("flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-rowhover", openId === t.id && "bg-rowhover")}
              >
                <Initial name={t.brand} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{t.brand || "Marque"}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtWhen(t.ts)}</span>
                  </span>
                  <span className="truncate text-[13px] text-foreground">
                    {t.subject}
                    {t.count > 1 && <span className="ml-1 text-faint">{t.count}</span>}
                  </span>
                  <span className="line-clamp-1 text-[12px] text-muted-foreground">{t.excerpt}</span>
                  <span className="mt-1 flex items-center gap-3">
                    <StatusDot status={t.status} />
                    {t.notes > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Messages au manager">
                        <MessageSquare className="h-3 w-3" />{t.notes}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DashPanel>
  );

  const view = openId && (
    <DashPanel className="flex min-w-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-6">
        <button type="button" onClick={() => setOpenId(null)} aria-label="Retour à la liste"
          className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">{thread?.subject ?? "Chargement…"}</h2>
          {thread && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {thread.brand ? `${thread.brand} · ` : ""}{thread.messages.length} message{thread.messages.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
        {thread && (mode === "agency" ? (
          <StatusSelect value={thread.status} options={STATUS_OPTIONS} onChange={(v) => void setStatus(thread.id, v as MailStatus)} className="w-[170px] shrink-0 max-sm:w-[150px]" />
        ) : (
          <span className="mt-0.5"><StatusBadge status={thread.status} /></span>
        ))}
      </div>

      {threadErr ? (
        <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">{threadErr}</div>
      ) : !thread ? (
        <div className="flex items-center justify-center gap-2 px-5 py-10 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Ouverture…</div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {thread.messages.map((m) => (
              <MailItem
                key={m.id}
                m={m}
                open={expanded.has(m.id)}
                onToggle={() => setExpanded((s) => {
                  const n = new Set(s);
                  if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                  return n;
                })}
                threadId={thread.id}
                creator={forCreator}
              />
            ))}
          </div>

          {/* Échanges internes avec le manager (jamais envoyés à la marque) */}
          <div className="border-t border-border px-4 py-5 sm:px-6">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-[13px] font-semibold text-foreground">{asAgency ? "Messages de la créatrice" : "Échanges avec ton manager"}</span>
            </div>
            <p className="mb-3 text-[12px] text-muted-foreground">
              {asAgency ? "Ses questions sur cet échange. Jamais envoyées à la marque." : "Une question sur cet échange ? Elle reste entre toi et TTP, la marque ne la voit jamais."}
            </p>
            {thread.notes.length > 0 && (
              <ul className="mb-3 flex flex-col gap-2">
                {thread.notes.map((n) => (
                  <li key={n.id} className={cn("max-w-[85%] rounded-2xl bg-muted px-3.5 py-2.5", !asAgency && "self-end rounded-br-md", asAgency && "rounded-bl-md")}>
                    <p className="whitespace-pre-wrap text-[13px] text-foreground [overflow-wrap:anywhere]">{n.body}</p>
                    <p className="mt-1 text-[11px] text-faint">
                      {fmtFull(new Date(n.created_at).getTime())}
                      {!asAgency && (n.agency_read_at ? " · lu" : " · envoyé")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {mode === "creator" && (
              <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-1.5 pl-3.5 focus-within:border-primary">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 4000))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitNote();
                  }}
                  rows={1}
                  placeholder="Écrire à mon manager…"
                  className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={() => void submitNote()}
                  disabled={!note.trim() || sending}
                  aria-label="Envoyer à mon manager"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </DashPanel>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start">
      {list}
      {view || (
        <DashPanel className="hidden flex-col items-center justify-center gap-2 px-6 py-20 text-center lg:flex">
          <Inbox className="h-6 w-6 text-faint" />
          <p className="text-[13px] text-muted-foreground">Choisis un échange pour le lire.</p>
        </DashPanel>
      )}
    </div>
  );
}

/** Lit le réglage Mails d'une créatrice (RLS : agence = tous, créatrice = le sien). */
function useMailSettings(creator: string) {
  // undefined = chargement ou table absente (SQL pas encore appliqué) → rien n'est affiché.
  const [s, setS] = useState<MailSettings | null | undefined>(undefined);
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from("creator_mail_settings")
      .select("creator, alias, label_id, label_name, enabled").eq("creator", creator).maybeSingle<MailSettings>();
    setS(error ? undefined : data ?? null);
  }, [creator]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { settings: s, reload };
}

/** Fiche créatrice (agence) : lien alias / libellé + activation, puis la boîte. */
export function CreatorMailsAgency({ creator, suggestedAlias }: { creator: string; suggestedAlias?: string | null }) {
  const { settings, reload } = useMailSettings(creator);
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState("");
  const [labelId, setLabelId] = useState("");
  const [labels, setLabels] = useState<{ id: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  const openEdit = () => {
    setAlias(settings?.alias ?? suggestedAlias ?? "");
    setLabelId(settings?.label_id ?? "");
    setEditing(true);
    if (!labels) listGmailLabels().then(setLabels).catch(() => setLabels([]));
  };

  const save = async (patch: Partial<MailSettings>) => {
    setSaving(true);
    const row = {
      creator,
      alias: settings?.alias ?? null,
      label_id: settings?.label_id ?? null,
      label_name: settings?.label_name ?? null,
      enabled: settings?.enabled ?? false,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("creator_mail_settings").upsert(row, { onConflict: "creator" });
    setSaving(false);
    if (error) {
      toast("Réglage non enregistré");
      return false;
    }
    await reload();
    return true;
  };

  const submit = async () => {
    const a = alias.trim().toLowerCase();
    if (a && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) {
      toast("Alias invalide : il faut une adresse e-mail complète");
      return;
    }
    const lbl = labels?.find((l) => l.id === labelId);
    if (await save({ alias: a || null, label_id: labelId || null, label_name: lbl?.name ?? null })) {
      setEditing(false);
      toast("Boîte mail liée ✓");
    }
  };

  if (settings === undefined) return null;
  const linked = !!(settings?.alias || settings?.label_id);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <DashPanel className="p-5">
        <DashSectionTitle
          icon={Mail}
          right={!editing && (
            <button type="button" onClick={openEdit}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Settings2 className="h-3.5 w-3.5" /> {linked ? "Modifier" : "Lier"}
            </button>
          )}
        >
          Mails de {titleCase(creator)}
        </DashSectionTitle>

        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Alias (adresse utilisée avec les marques)</span>
                <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="prenom@ttpcreators.pro" inputMode="email"
                  className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Libellé Gmail (facultatif, en plus de l'alias)</span>
                <select value={labelId} onChange={(e) => setLabelId(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-foreground outline-none focus:border-primary">
                  <option value="">Aucun</option>
                  {labels === null && labelId && <option value={labelId}>{settings?.label_name ?? labelId}</option>}
                  {(labels ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Elle verra uniquement les échanges où cet alias apparaît (expéditeur, destinataire ou copie) et ceux qui portent ce libellé. Lecture seule : elle ne peut ni répondre ni supprimer.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
              <button type="button" onClick={() => void submit()} disabled={saving}
                className="h-9 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                Enregistrer
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{settings?.alias || <span className="text-faint">Aucun alias</span>}</span>
              </span>
              {settings?.label_name && (
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{settings.label_name}</span>
                </span>
              )}
            </div>
            <label className={cn("flex shrink-0 items-center gap-2.5 text-[13px]", !linked && "opacity-50")}>
              <span className="text-muted-foreground">Visible dans son espace</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!settings?.enabled}
                disabled={!linked || saving}
                onClick={() => void save({ enabled: !settings?.enabled }).then((ok) => ok && toast(settings?.enabled ? "Section Mails masquée" : "Section Mails activée ✓"))}
                className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", settings?.enabled ? "bg-primary" : "bg-faint/40")}
              >
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition-all", settings?.enabled ? "left-[18px] bg-primary-foreground" : "left-0.5 bg-white")} />
              </button>
            </label>
          </div>
        )}
      </DashPanel>

      {linked && !editing && <CreatorMailbox creator={creator} mode="agency" />}
    </div>
  );
}

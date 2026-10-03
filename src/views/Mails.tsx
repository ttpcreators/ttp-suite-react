import { useEffect, useMemo, useState } from "react";
import { Mail, ArrowDownLeft, ArrowUpRight, ArrowLeft, Inbox, Search, Loader2, PenLine, Reply, Forward, Settings2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { DashPanel } from "@/components/ui/dash";
import { Initial, MailItem } from "@/components/mail-reader";
import { saveBase64, type MailAttachment, type MailMessage } from "@/lib/creatorMail";
import { toast } from "@/components/ui/toast";
import { parseTouches, nextKind, touchId, type Touch } from "@/lib/touches";
import { updateTouches } from "@/lib/touchesDb";
import { MailComposer, type ComposerContact } from "@/components/mail-composer";
import { BoxChip } from "@/components/mail-box-chip";
import { BOX_LABEL, BOX_STYLE, sendErrorText, sendGmail, type MailBox, type OutAttachment } from "@/lib/mailSend";
import { ForwardDialog, MailSettingsDialog, NewMailDialog, ReplyBox } from "@/components/mail-tools";
import { Tabs } from "@/components/ui/animated-tabs";

/**
 * Page « Mails » : historique des échanges Gmail par contact + lecture d'un fil
 * complet. Lecture seule (scope gmail.readonly via les fonctions gmail-history /
 * gmail-thread). Réservé à l'agence (les fonctions vérifient le rôle).
 */
type Contact = {
  id: string;
  email: string;
  label: string;
  tag?: string;
  lastContacted?: string | null;
  brand?: string | null;
  person?: string | null;
  first_name?: string | null;
  touches?: unknown;
};
type MailMsg = { id: string; threadId: string; from: string; to?: string; subject: string; date: string; snippet: string; direction: "in" | "out"; source?: string; box?: MailBox };
type ThreadMsg = {
  id: string; from: string; to?: string; cc?: string; subject: string; date: string; html: string; text: string;
  direction: "in" | "out"; ts: number; attachments?: MailAttachment[];
};

type InboxThread = {
  threadId: string; subject: string; name: string; email: string; snippet: string;
  ts: number; count: number; direction: "in" | "out"; unread: boolean; box: MailBox;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fmtDate(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
}
/** Nom affiché depuis un entête "Nom <email>" ou "email". */
function displayName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return (m ? m[1] : from.replace(/[<>]/g, "")).trim();
}
/** « CLARA FRECHIN » → « Clara Frechin » (noms d'expéditeur tout en majuscules). */
function prettyName(n: string): string {
  if (!n || n !== n.toUpperCase() || !/[A-Z]/.test(n)) return n;
  return n.toLowerCase().replace(/\p{L}[\p{L}'’-]*/gu, (w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
}
/** Décode les entités HTML des extraits Gmail (« l&#39;ensemble » → « l'ensemble »). */
function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

/** supabase-js met le corps JSON des réponses non-2xx dans error.context. */
async function invokeJson<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
    return (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as T | null;
  return (data as T) ?? null;
}

export function Mails() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("__all__"); // filtre par niche/tag
  const [contactFilter, setContactFilter] = useState<"all" | "contacted" | "never">("all"); // déjà échangé ?
  const [selected, setSelected] = useState<Contact | null>(null);
  // Boîte affichée : les deux (défaut), partnerships@ (prospection) ou talent@ (créatrices).
  const [box, setBoxState] = useState<"all" | MailBox>(() => {
    try {
      const v = localStorage.getItem("ttp:mails-box");
      return v === "partnerships" || v === "talent" ? v : "all";
    } catch {
      return "all";
    }
  });
  // Choisir une boîte = afficher SA boîte de réception (le contact sélectionné est fermé).
  const setBox = (v: "all" | MailBox) => {
    setBoxState(v);
    setThread(null);
    setSelected(null);
    setMobileInbox(true);
    try {
      localStorage.setItem("ttp:mails-box", v);
    } catch {
      /* stockage indisponible */
    }
  };

  const [history, setHistory] = useState<MailMsg[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyErr, setHistoryErr] = useState("");
  const [historyPartial, setHistoryPartial] = useState(false); // une des deux boîtes n'a pas répondu

  const [composerOpen, setComposerOpen] = useState(false);
  const [thread, setThread] = useState<{ contact: string; name: string; subject: string; threadId: string; box: MailBox } | null>(null);
  // Boîte de réception de la boîte choisie (quand aucun contact n'est sélectionné).
  const [inbox, setInbox] = useState<InboxThread[] | null>(null);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxErr, setInboxErr] = useState("");
  const [inboxPartial, setInboxPartial] = useState(false);
  const [inboxTick, setInboxTick] = useState(0); // « Actualiser »
  const [mobileInbox, setMobileInbox] = useState(false); // mobile : boîte de réception au lieu des contacts
  const [threadMsgs, setThreadMsgs] = useState<ThreadMsg[] | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [replyFocus, setReplyFocus] = useState(0); // « Répondre » sur une carte → focus de la réponse
  const [forwardMsg, setForwardMsg] = useState<MailMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newMailOpen, setNewMailOpen] = useState(false); // mail libre, n'importe quelle adresse
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // messages dépliés du fil

  // Contacts avec un email valide.
  useEffect(() => {
    supabase
      .from("contacts")
      .select("*")
      .order("sort_order")
      .then(({ data }) => {
        const rows = (data as Record<string, unknown>[]) ?? [];
        setContacts(
          rows
            .map((r) => {
              const person = [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.person ?? "");
              const label = [String(r.brand ?? ""), person].filter((x) => x && x !== "—").join(" · ") || String(r.email ?? "");
              return {
                id: String(r.id ?? ""),
                email: String(r.email ?? "").trim(),
                label,
                tag: String(r.tag ?? "").trim(),
                lastContacted: r.last_contacted ? String(r.last_contacted) : null,
                brand: r.brand ? String(r.brand) : null,
                person: person || null,
                first_name: r.first_name ? String(r.first_name) : null,
                touches: r.touches,
              };
            })
            .filter((c) => EMAIL_RE.test(c.email)),
        );
      });
  }, []);

  // Historique du contact sélectionné.
  useEffect(() => {
    setHistory(null);
    setHistoryErr("");
    const email = selected?.email?.toLowerCase();
    if (!email) return;
    let alive = true;
    setHistoryBusy(true);
    (async () => {
      // Gmail (fils réels) + email_activity (envois Resend / media kit non présents dans Gmail).
      const [res, act] = await Promise.all([
        // Toujours les DEUX boîtes : le choix de boîte filtre ensuite l'affichage (bascule instantanée).
        invokeJson<{ ok?: boolean; messages?: MailMsg[]; error?: string; partial?: boolean }>("gmail-history", { contact: email, box: "all" }),
        supabase
          .from("email_activity")
          .select("subject,snippet,direction,source,created_at,thread_id,gmail_message_id")
          .eq("contact_email", email)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (!alive) return;
      if (res?.error === "google_non_connecte" || res?.error === "gmail_scope_manquant")
        setHistoryErr("Reconnecte Google (droits Gmail) dans l'app pour lire tes mails.");
      else if (res?.error === "talent_non_configure") setHistoryErr("La boîte talent@ n'est pas encore reliée à l'app.");
      setHistoryPartial(!!res?.partial);
      const gmail = res?.ok ? res.messages ?? [] : [];
      const gmailIds = new Set(gmail.map((m) => m.id));
      const extra: MailMsg[] = ((act.data as { subject: string | null; snippet: string | null; direction: string | null; source: string | null; created_at: string | null; thread_id: string | null; gmail_message_id: string | null }[]) ?? [])
        .filter((a) => a.source && a.source !== "manual" && (!a.gmail_message_id || !gmailIds.has(a.gmail_message_id)))
        .map((a) => ({
          id: `act-${a.created_at}-${a.subject ?? ""}`.slice(0, 60),
          threadId: a.thread_id ?? "",
          from: "",
          subject: a.subject ?? "",
          date: a.created_at ?? "",
          snippet: a.snippet ?? "",
          direction: a.direction === "in" ? "in" : "out",
          source: a.source ?? undefined,
          box: "partnerships" as const, // envois automatiques : partent de partnerships@
        }));
      const merged = [...gmail, ...extra].sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
      setHistory(merged);
      setHistoryBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  // Boîte de réception : dernières conversations de la boîte choisie (les deux = fusion).
  useEffect(() => {
    let alive = true;
    setInboxBusy(true);
    setInboxErr("");
    (async () => {
      const res = await invokeJson<{ ok?: boolean; threads?: InboxThread[]; error?: string; partial?: boolean }>("gmail-history", { inbox: true, box });
      if (!alive) return;
      if (res?.ok) {
        setInbox(res.threads ?? []);
        setInboxPartial(!!res.partial);
      } else {
        setInbox([]);
        setInboxErr(
          res?.error === "google_non_connecte" || res?.error === "gmail_scope_manquant" ? "Reconnecte Google (droits Gmail) dans l'app pour lire tes mails."
            : res?.error === "talent_non_configure" ? "La boîte talent@ n'est pas encore reliée à l'app."
            : "Impossible de charger la boîte de réception.",
        );
      }
      setInboxBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [box, inboxTick]);

  const openThread = async (m: { threadId: string; subject: string; box?: MailBox; contact?: string; name?: string }) => {
    const mBox: MailBox = m.box ?? (box === "talent" ? "talent" : "partnerships");
    const contact = (m.contact ?? selected?.email ?? "").toLowerCase();
    setThread({ contact, name: m.name ?? selected?.person ?? "", subject: m.subject, threadId: m.threadId, box: mBox });
    setThreadMsgs(null);
    setThreadBusy(true);
    const res = await invokeJson<{ ok?: boolean; messages?: ThreadMsg[] }>("gmail-thread", {
      threadId: m.threadId,
      contact,
      box: mBox,
    });
    const msgs = res?.ok ? res.messages ?? [] : [];
    setThreadMsgs(msgs);
    // Dernier message déplié, les précédents repliés (comme Gmail).
    setExpanded(new Set(msgs.length ? [msgs[msgs.length - 1].id] : []));
    setThreadBusy(false);
  };

  // Répondre : envoie via Gmail dans le MÊME fil (threadId) → apparaît chez le contact.
  // Répondre : envoie via Gmail dans le MÊME fil (threadId), depuis la boîte du fil.
  // Appelé à l'envoi réel (après le délai d'annulation de ReplyBox).
  const sendReply = async ({ cc, bcc, html, attachments }: { cc: string[]; bcc: string[]; html: string; attachments: OutAttachment[] }): Promise<boolean> => {
    if (!thread) return false;
    const t = thread;
    const subject = t.subject.replace(/^\s*re\s*:\s*/i, "");
    const res = await sendGmail({ to: t.contact, cc, subject: `Re: ${subject}`, html, threadId: t.threadId, source: "manual", box: t.box, bcc, attachments });
    if (!res.ok) {
      toast(sendErrorText(res.error));
      return false;
    }
    toast("Réponse envoyée ✓");
    // Recharge le fil pour afficher la réponse.
    const fresh = await invokeJson<{ ok?: boolean; messages?: ThreadMsg[] }>("gmail-thread", { threadId: t.threadId, contact: t.contact, box: t.box });
    if (fresh?.ok) {
      const msgs = fresh.messages ?? [];
      setThreadMsgs(msgs);
      if (msgs.length) setExpanded((e) => new Set([...e, msgs[msgs.length - 1].id]));
    }
    return true;
  };

  // Tags/niches réellement présents (pour le filtre) — hors « perso » (défaut créateurs).
  const tagList = useMemo(
    () => [...new Set(contacts.map((c) => (c.tag ?? "").trim()).filter((t) => t && t.toLowerCase() !== "perso"))],
    [contacts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (tagFilter !== "__all__" && (c.tag ?? "").trim() !== tagFilter) return false;
      // Même règle qu'ailleurs : échangé = dernier mail suivi OU touche manuelle.
      const contacted = !!c.lastContacted || parseTouches(c.touches).length > 0;
      if (contactFilter === "contacted" && !contacted) return false;
      if (contactFilter === "never" && contacted) return false;
      if (q && !(c.label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.tag ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [contacts, query, tagFilter, contactFilter]);

  // Historique filtré par la boîte choisie (le serveur renvoie les deux).
  const boxOf = (m: MailMsg): MailBox => m.box ?? "partnerships";
  const visibleHistory = history ?? [];

  const contacted = (c: Contact) => !!c.lastContacted || parseTouches(c.touches).length > 0;
  // Fil → format du lecteur partagé (messages envoyés = agence).
  const readerMsgs: MailMessage[] = (threadMsgs ?? []).map((m) => ({
    id: m.id,
    from: displayName(m.from),
    fromEmail: (m.from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase(),
    fromAgency: m.direction === "out",
    to: m.to ?? "",
    cc: m.cc ?? "",
    ts: m.ts || new Date(m.date).getTime(),
    html: m.html,
    text: m.html ? "" : m.text,
    attachments: m.attachments ?? [],
  }));

  // Pièce jointe d'un fil agence : lue côté serveur dans la boîte du fil.
  const downloadAgencyAttachment = async (a: MailAttachment) => {
    if (!thread) return;
    const r = await invokeJson<{ ok?: boolean; data?: string; error?: string }>("gmail-thread", {
      action: "attachment", messageId: a.messageId, attachmentId: a.attachmentId, box: thread.box,
    });
    if (!r?.ok || !r.data) return toast(r?.error === "piece_trop_lourde" ? "Pièce jointe trop lourde (20 Mo max)." : "Téléchargement impossible");
    saveBase64(r.data, a.filename);
  };

  return (
    <>
      {/* Boîte affichée */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5">
          {([["all", "Les deux boîtes"], ["partnerships", BOX_LABEL.partnerships], ["talent", BOX_LABEL.talent]] as const).map(([v, label]) => {
            const on = box === v;
            const n = !selected && inbox && !inboxBusy && box === v ? inbox.length : null;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setBox(v)}
                aria-pressed={on}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors",
                  on ? (v === "all" ? "bg-surface text-foreground shadow-sm" : BOX_STYLE[v].chip + " shadow-sm") : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v !== "all" && !on && <span className={cn("h-2 w-2 rounded-full", BOX_STYLE[v].dot)} />}
                {label}
                {n !== null && <span className={cn("tabular-nums", on ? "opacity-75" : "text-faint")}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="order-last ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setNewMailOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <PenLine className="h-3.5 w-3.5" /> Nouveau mail
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Signature et délai</span><span className="sm:hidden">Réglages</span>
        </button>
        </div>
        <span className="text-[12px] text-muted-foreground">
          {selected ? "Échanges avec ce contact, dans les deux boîtes." : box === "partnerships" ? "Boîte de prospection et contacts agence." : box === "talent" ? "Boîte des échanges créatrices (leurs alias)." : "Les deux boîtes réunies."}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start">
        {/* Colonne : contacts */}
        <DashPanel className={cn("flex min-w-0 flex-col", (selected || thread || mobileInbox) && "max-lg:hidden")}>
          <div className="flex flex-col gap-2.5 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un contact…"
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] outline-none placeholder:text-faint focus:border-primary"
              />
            </div>
            {/* Filtre « déjà échangé » (basé sur le suivi de contact) */}
            <Tabs
              size="sm"
              fullWidth
              label="Filtrer par échange"
              items={[
                { value: "all", label: "Tous" },
                { value: "contacted", label: "Déjà échangé" },
                { value: "never", label: "Jamais" },
              ]}
              value={contactFilter}
              onValueChange={(v) => setContactFilter(v as "all" | "contacted" | "never")}
            />
            {/* Filtre par type (marque, agence…) */}
            {tagList.length > 0 && (
              <Tabs
                size="sm"
                label="Filtrer par type"
                wrap
                items={[{ value: "__all__", label: "Tous types" }, ...tagList.map((t) => ({ value: t, label: t }))]}
                value={tagFilter}
                onValueChange={setTagFilter}
              />
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                {query.trim() || tagFilter !== "__all__" || contactFilter !== "all" ? "Aucun contact pour ce filtre." : "Aucun contact avec email."}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected(c); setThread(null); setMobileInbox(false); }}
                      className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-rowhover", selected?.id === c.id && "bg-rowhover")}
                    >
                      <Initial name={c.brand || c.label} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-foreground" title={c.label}>{c.brand || c.label}</span>
                          {contacted(c) && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" title="Déjà échangé" />}
                        </span>
                        <span className="block truncate text-[12px] text-muted-foreground">{c.person || c.email}</span>
                      </span>
                      {c.tag && c.tag.toLowerCase() !== "perso" && (
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">{c.tag}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DashPanel>

        {/* Colonne : fil ouvert, sinon échanges du contact, sinon boîte de réception */}
        {thread ? (
          <DashPanel className="flex min-w-0 flex-col">
            <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-6">
              <button type="button" onClick={() => setThread(null)} aria-label="Retour aux échanges"
                className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">{thread.subject || "(sans objet)"}</h2>
                <p className="mt-1 truncate text-[12px] text-muted-foreground">
                  <BoxChip box={thread.box} className="mr-1.5 align-[1px] text-[10px]" />
                  {selected?.label ?? (thread.name || thread.contact)}{threadMsgs ? ` · ${threadMsgs.length} message${threadMsgs.length > 1 ? "s" : ""}` : ""}
                </p>
              </div>
              {readerMsgs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setForwardMsg(readerMsgs[readerMsgs.length - 1])}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover"
                >
                  <Forward className="h-4 w-4" /> <span className="max-sm:hidden">Transférer</span>
                </button>
              )}
            </div>
            {threadBusy ? (
              <div className="flex items-center justify-center gap-2 px-5 py-10 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Ouverture…</div>
            ) : readerMsgs.length === 0 ? (
              <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">Impossible de charger ce fil.</div>
            ) : (
              <div className="flex flex-col gap-3 bg-panel/60 p-3 sm:p-4">
                {readerMsgs.map((m, i) => {
                  const last = i === readerMsgs.length - 1;
                  return (
                    <MailItem
                      key={m.id}
                      m={m}
                      index={i}
                      onDownload={downloadAgencyAttachment}
                      open={expanded.has(m.id)}
                      onToggle={() => setExpanded((s) => {
                        const n = new Set(s);
                        if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                        return n;
                      })}
                      actions={[
                        {
                          icon: Reply, label: "Répondre",
                          onClick: () => {
                            const lastId = readerMsgs[readerMsgs.length - 1].id;
                            setExpanded((s) => new Set([...s, lastId]));
                            setReplyFocus(Date.now());
                          },
                        },
                        { icon: Forward, label: "Transférer", onClick: () => setForwardMsg(m) },
                      ]}
                      footer={last ? (
                        <ReplyBox
                          box={thread.box}
                          focusKey={replyFocus}
                          placeholder={`Répondre à ${titleCase(selected?.person || thread.name || displayName(thread.contact))}…`}
                          onSend={sendReply}
                        />
                      ) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </DashPanel>
        ) : !selected ? (
          <DashPanel className={cn("min-w-0 flex-col", mobileInbox ? "flex" : "hidden lg:flex")}>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-6">
              <button type="button" onClick={() => setMobileInbox(false)} aria-label="Retour aux contacts"
                className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground lg:hidden">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <Inbox className="h-4 w-4 shrink-0 text-muted-foreground max-lg:hidden" />
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">Boîte de réception</h2>
              {box === "all" ? (
                <span className="flex shrink-0 gap-1"><BoxChip box="partnerships" className="text-[10px]" /><BoxChip box="talent" className="text-[10px]" /></span>
              ) : (
                <BoxChip box={box} />
              )}
              <button type="button" onClick={() => setInboxTick((n) => n + 1)} disabled={inboxBusy}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover disabled:opacity-60">
                <RefreshCw className={cn("h-3.5 w-3.5", inboxBusy && "animate-spin")} /> <span className="max-sm:hidden">Actualiser</span>
              </button>
            </div>
            {inboxBusy && !inbox?.length ? (
              <div className="flex items-center justify-center gap-2 px-5 py-12 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la boîte…
              </div>
            ) : inboxErr ? (
              <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">{inboxErr}</div>
            ) : !inbox?.length ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <Inbox className="h-5 w-5 text-faint" />
                <p className="text-[13px] text-muted-foreground">Aucun mail dans cette boîte.</p>
              </div>
            ) : (
              <ul className={cn("divide-y divide-border transition-opacity", inboxBusy && "opacity-60")}>
                {inboxPartial && (
                  <li className="px-4 py-2 text-[12px] text-amber-700 sm:px-6 dark:text-amber-400">Une des deux boîtes n'a pas répondu : la liste peut être incomplète.</li>
                )}
                {inbox.map((t) => (
                  <li key={`${t.box}-${t.threadId}`}>
                    <button
                      type="button"
                      onClick={() => openThread({ threadId: t.threadId, subject: t.subject, box: t.box, contact: t.email, name: t.name })}
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-rowhover sm:px-6"
                    >
                      <span className="relative shrink-0">
                        <Initial name={prettyName(t.name)} />
                        <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-surface", BOX_STYLE[t.box].dot)} title={BOX_LABEL[t.box]} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className={cn("min-w-0 flex-1 truncate text-[13px] text-foreground", t.unread ? "font-bold" : "font-semibold")}>
                            {prettyName(t.name) || t.email}
                            {t.count > 1 && <span className="ml-1.5 text-[11px] font-normal text-faint">{t.count}</span>}
                          </span>
                          {t.unread && <span className="size-2 shrink-0 self-center rounded-full bg-primary" title="Non lu" />}
                          <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtDate(new Date(t.ts).toISOString())}</span>
                        </span>
                        <span className={cn("block truncate text-[12.5px]", t.unread ? "font-semibold text-foreground" : "text-foreground/90")}>{t.subject || "(sans objet)"}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-2">
                          {box === "all" && <BoxChip box={t.box} className="text-[10px]" />}
                          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                            {t.direction === "out" && <span className="text-faint">Vous : </span>}
                            {decodeEntities(t.snippet)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DashPanel>
        ) : (
          <DashPanel className="flex min-w-0 flex-col">
            <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-6">
              <button type="button" onClick={() => setSelected(null)} aria-label="Retour aux contacts"
                className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground lg:hidden">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <Initial name={selected.brand || selected.label} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-foreground">{selected.label}</h2>
                <p className="truncate text-[12px] text-muted-foreground">{selected.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <PenLine className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Nouveau mail</span>
              </button>
            </div>

            {historyBusy ? (
              <div className="flex items-center justify-center gap-2 px-5 py-12 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement des échanges…
              </div>
            ) : historyErr ? (
              <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">{historyErr}</div>
            ) : visibleHistory.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <Mail className="h-5 w-5 text-faint" />
                <p className="text-[13px] text-muted-foreground">Aucun échange trouvé dans les deux boîtes avec ce contact.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {historyPartial && (
                  <li className="px-4 py-2 text-[12px] text-amber-700 sm:px-6 dark:text-amber-400">Une des deux boîtes n'a pas répondu : l'historique peut être incomplet.</li>
                )}
                {visibleHistory.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => m.threadId && openThread({ threadId: m.threadId, subject: m.subject, box: m.box })}
                      className={cn("flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors sm:px-6", m.threadId ? "hover:bg-rowhover" : "cursor-default")}
                    >
                      <span
                        className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", BOX_STYLE[boxOf(m)].soft)}
                        title={m.direction === "in" ? "Reçu" : "Envoyé"}
                      >
                        {m.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{m.subject || "(sans objet)"}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtDate(m.date)}</span>
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-[11px] text-muted-foreground">{m.direction === "in" ? "Reçu" : "Envoyé"}</span>
                          <BoxChip box={boxOf(m)} className="text-[10px]" />
                          {m.source === "mediakit" && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Media kit</span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{decodeEntities(m.snippet)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DashPanel>
        )}
      </div>

      <ForwardDialog
        message={forwardMsg}
        subject={thread?.subject ?? ""}
        defaultBox={thread?.box ?? "partnerships"}
        sourceBox={thread?.box}
        onClose={() => setForwardMsg(null)}
      />
      <MailSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewMailDialog
        open={newMailOpen}
        defaultBox={box === "talent" ? "talent" : "partnerships"}
        onClose={() => setNewMailOpen(false)}
        onSent={() => setInboxTick((n) => n + 1)}
      />

      {/* Composeur : nouveau mail depuis un modèle (prospection / relance) */}
      <MailComposer
        open={composerOpen}
        contact={
          selected
            ? ({
                email: selected.email,
                label: selected.label,
                brand: selected.brand,
                person: selected.person,
                first_name: selected.first_name,
                hasBeenContacted: parseTouches(selected.touches).length > 0 || Boolean(selected.lastContacted),
              } satisfies ComposerContact)
            : null
        }
        onClose={() => setComposerOpen(false)}
        defaultBox={box === "talent" ? "talent" : "partnerships"}
        onSent={(gmailId) => {
          // Journalise la touche (même logique que le poste de prospection)
          // puis recharge l'historique du contact.
          if (!selected?.id) return;
          const id = selected.id;
          const list = parseTouches(selected.touches);
          // Id « gm<id> » si envoyé via Gmail : le scan horaire le reconnaît (pas de doublon).
          const t: Touch = { id: gmailId ? `gm${gmailId}` : touchId(), date: new Date().toISOString(), canal: "email", kind: nextKind(list, selected.lastContacted ?? null) };
          // Relit la ligne avant d'écrire : pas d'écrasement des touches concurrentes.
          void updateTouches(id, { add: t }).then((res) => {
            if (!res) return toast("Mail envoyé, mais la touche n'a pas été notée");
            const upd = (c: Contact): Contact => (c.id === id ? { ...c, touches: res.touches, lastContacted: res.last_contacted } : c);
            setContacts((prev) => prev.map(upd));
            setSelected((prev) => (prev ? upd(prev) : prev));
          });
        }}
      />

    </>
  );
}

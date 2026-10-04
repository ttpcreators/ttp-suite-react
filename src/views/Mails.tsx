import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Mail, ArrowDownLeft, ArrowUpRight, ArrowLeft, Inbox, Search, Loader2, PenLine, Reply, Forward, Settings2, RefreshCw, Send,
  MessageSquareText, Trash2, Undo2, BookUser, UsersRound, ChevronLeft, ChevronRight, CircleAlert, type LucideIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { Initial, MailItem, fmtWhen } from "@/components/mail-reader";
import { BarButton, RailButton, SearchField, Tip, ToolButton, mailRowCls, pillCls } from "@/components/mail-shell";
import { SwipeRow } from "@/components/mobile/swipe-row";
import { saveBase64, type MailAttachment, type MailMessage } from "@/lib/creatorMail";
import { toast } from "@/components/ui/toast";
import { parseTouches, nextKind, touchId, type Touch } from "@/lib/touches";
import { updateTouches } from "@/lib/touchesDb";
import { MailComposer, type ComposerContact } from "@/components/mail-composer";
import { BoxChip } from "@/components/mail-box-chip";
import { BOX_LABEL, BOX_STYLE, sendErrorText, sendGmail, type MailBox, type OutAttachment } from "@/lib/mailSend";
import { ForwardDialog, MailSettingsDialog, NewMailDialog, ReplyBox } from "@/components/mail-tools";
import { Tabs } from "@/components/ui/animated-tabs";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useCreators } from "@/lib/useCreators";

// Espace mails d'une créatrice (statuts, remarques, suivi), chargé seulement à la demande.
const CreatorMailsAgency = lazy(() => import("@/views/CreatorMails").then((m) => ({ default: m.CreatorMailsAgency })));

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

/** Date façon Gmail : « 14:32 » aujourd'hui, « 3 oct. » cette année, « 03/10/2025 » avant. */
function fmtDate(d: string): string {
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? "" : fmtWhen(t);
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

/*
 * Mise en page façon client mail : barre d'icônes (dossiers + boîtes), liste,
 * lecture, et à droite (grand écran) les créatrices en accès direct.
 */
type Mode = "inbox" | "sent" | "contacts" | "creators";
const MODES: { id: Mode; label: string; short: string; icon: LucideIcon }[] = [
  { id: "inbox", label: "Boîte de réception", short: "Reçus", icon: Inbox },
  { id: "sent", label: "Envoyés", short: "Envoyés", icon: Send },
  { id: "contacts", label: "Contacts", short: "Contacts", icon: BookUser },
  { id: "creators", label: "Par créatrice", short: "Créatrices", icon: UsersRound },
];
const BOXES: { id: "all" | MailBox; label: string; short: string; hint: string }[] = [
  { id: "all", label: "Les deux boîtes", short: "Les deux", hint: "Les deux boîtes réunies" },
  { id: "partnerships", label: BOX_LABEL.partnerships, short: BOX_LABEL.partnerships, hint: "Prospection et contacts agence" },
  { id: "talent", label: BOX_LABEL.talent, short: BOX_LABEL.talent, hint: "Échanges créatrices (leurs alias)" },
];
function readPref<T extends string>(key: string, allowed: readonly T[], def: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : def;
  } catch {
    return def;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* stockage indisponible */
  }
}

/** Carré de couleur d'une boîte : violet = partnerships@, vert = talent@, les deux = moitié-moitié. */
function BoxSquare({ box, className }: { box: "all" | MailBox; className?: string }) {
  if (box === "all") {
    return (
      <span aria-hidden className={cn("grid size-3.5 shrink-0 grid-cols-2 overflow-hidden rounded-[4px]", className)}>
        <span className={BOX_STYLE.partnerships.dot} />
        <span className={BOX_STYLE.talent.dot} />
      </span>
    );
  }
  return <span aria-hidden className={cn("size-3.5 shrink-0 rounded-[4px]", BOX_STYLE[box].dot, className)} />;
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
  // Filtre « Par créatrice » : ses échanges (talent@, son alias) avec statuts et remarques.
  // Toutes les créatrices du Roster y sont : une créatrice pas encore reliée affiche
  // de quoi relier son adresse mail.
  const allCreators = useCreators();
  const [linked, setLinked] = useState<{ creator: string; alias: string | null; enabled: boolean }[]>([]);
  const [linkedTick, setLinkedTick] = useState(0);
  const [emailPro, setEmailPro] = useState<Map<string, string>>(new Map());
  const [creatorView, setCreatorView] = useState<{ name: string; threadId?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.from("creator_mail_settings").select("creator, alias, label_id, enabled").then(({ data }) => {
      if (!alive) return;
      const rows = (data ?? []) as { creator: string; alias: string | null; label_id: string | null; enabled: boolean }[];
      setLinked(rows.filter((r) => r.alias || r.label_id).sort((a, b) => a.creator.localeCompare(b.creator)));
    });
    return () => {
      alive = false;
    };
  }, [linkedTick]);
  useEffect(() => {
    let alive = true;
    void supabase.from("creators").select("name, email_pro").then(({ data }) => {
      if (!alive) return;
      const m = new Map<string, string>();
      for (const c of (data ?? []) as { name: string; email_pro: string | null }[]) if (c.email_pro) m.set(c.name.trim().toLowerCase(), c.email_pro);
      setEmailPro(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // Créatrices reliées d'abord, puis le reste du Roster actif.
  const creatorChoices = useMemo(() => {
    const names = linked.map((l) => l.creator);
    for (const c of allCreators) {
      if (c.status !== "inactif" && !names.some((n) => sameName(n, c.name))) names.push(c.name);
    }
    return names;
  }, [linked, allCreators]);

  // Dossier affiché dans la barre d'icônes (retenu sur cet appareil).
  const [mode, setModeState] = useState<Mode>(() => readPref("ttp:mails-mode", MODES.map((m) => m.id), "inbox"));
  const setMode = (m: Mode) => {
    setModeState(m);
    writePref("ttp:mails-mode", m);
  };
  // Dossier Gmail lu : reçus ou envoyés (Contacts et Créatrices gardent les reçus).
  const folder: "inbox" | "sent" = mode === "sent" ? "sent" : "inbox";
  const goMode = (m: Mode) => {
    if ((m === "inbox" || m === "sent") && (m === "sent") !== (folder === "sent")) setInbox(null);
    setMode(m);
    setThread(null);
    if (m !== "contacts") setSelected(null);
  };
  const openCreator = (name: string, threadId?: string) => {
    setCreatorView({ name, threadId });
    setMode("creators");
  };

  // Choisir une boîte = afficher SA boîte de réception (le contact sélectionné est fermé).
  const setBox = (v: "all" | MailBox) => {
    setBoxState(v);
    setThread(null);
    setSelected(null);
    if (mode !== "inbox" && mode !== "sent") setMode("inbox");
    writePref("ttp:mails-box", v);
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
  const [inboxQuery, setInboxQuery] = useState(""); // recherche dans la liste chargée
  const [unread, setUnread] = useState<number | null>(null); // non lus de la boîte (pastille)
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
      const res = await invokeJson<{ ok?: boolean; threads?: InboxThread[]; error?: string; partial?: boolean }>("gmail-history", { inbox: true, box, folder });
      if (!alive) return;
      if (res?.ok) {
        setInbox(res.threads ?? []);
        setInboxPartial(!!res.partial);
        if (folder === "inbox") setUnread((res.threads ?? []).filter((t) => t.unread).length);
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
  }, [box, folder, inboxTick]);

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

  // Supprimer = corbeille Gmail (récupérable 30 jours), jamais de suppression définitive.
  const [trashAsk, setTrashAsk] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashed, setTrashed] = useState<{ threadId: string; box: MailBox; subject: string } | null>(null);
  useEffect(() => {
    if (!trashed) return;
    const t = window.setTimeout(() => setTrashed(null), 10_000);
    return () => window.clearTimeout(t);
  }, [trashed]);
  const trashErrorText = (code?: string, b?: MailBox) =>
    code === "gmail_scope_manquant" || code === "talent_droit_manquant"
      ? b === "talent"
        ? "Suppression depuis talent@ pas encore autorisée (admin.google.com, droit gmail.modify)."
        : "Reconnecte Google (Planning → Google Agenda) pour autoriser la suppression."
      : code === "introuvable" ? "Mail introuvable (déjà supprimé ?)" : "Suppression impossible, réessaie";
  // Met un fil à la corbeille (fil ouvert, ou ligne glissée en mode iPhone).
  const trashTarget = async (t: { threadId: string; box: MailBox; subject: string }): Promise<boolean> => {
    const res = await invokeJson<{ ok?: boolean; error?: string }>("gmail-trash", { threadId: t.threadId, box: t.box });
    if (!res?.ok) {
      toast(trashErrorText(res?.error, t.box));
      return false;
    }
    // Retiré tout de suite des listes affichées ; « Annuler » pendant 10 s.
    setInbox((l) => l?.filter((x) => x.threadId !== t.threadId) ?? l);
    setHistory((l) => l?.filter((x) => x.threadId !== t.threadId) ?? l);
    setThread((cur) => (cur && cur.threadId === t.threadId ? null : cur));
    setTrashed({ threadId: t.threadId, box: t.box, subject: t.subject });
    return true;
  };
  const trashThread = async () => {
    if (!thread || trashBusy) return;
    setTrashBusy(true);
    await trashTarget(thread);
    setTrashBusy(false);
    setTrashAsk(false);
  };
  const untrash = async () => {
    if (!trashed) return;
    const t = trashed;
    setTrashed(null);
    const res = await invokeJson<{ ok?: boolean; error?: string }>("gmail-trash", { threadId: t.threadId, box: t.box, undo: true });
    if (!res?.ok) {
      toast(trashErrorText(res?.error, t.box));
      return;
    }
    toast("Mail restauré ✓");
    setInboxTick((n) => n + 1);
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
  // Échange de talent@ qui concerne une créatrice liée (son alias y apparaît) :
  // lien direct vers son suivi (statut, remarques).
  const threadCreator = (() => {
    if (!thread || thread.box !== "talent" || !threadMsgs?.length || !linked.length) return null;
    const addrs = new Set(threadMsgs.flatMap((m) => `${m.from} ${m.to ?? ""} ${m.cc ?? ""}`.toLowerCase().match(/[^\s<>"',;]+@[^\s<>"',;]+/g) ?? []));
    return linked.find((l) => l.alias && addrs.has(l.alias.toLowerCase())) ?? null;
  })();
  const firstName = (n: string) => titleCase(n).split(" ")[0] || titleCase(n);

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

  // Recherche dans la boîte affichée (nom, adresse, objet, extrait).
  const inboxQ = inboxQuery.trim().toLowerCase();
  const shownInbox = useMemo(
    () => (inbox ?? []).filter((t) => !inboxQ || `${t.name} ${t.email} ${t.subject} ${decodeEntities(t.snippet)}`.toLowerCase().includes(inboxQ)),
    [inbox, inboxQ],
  );
  // « 3 sur 12 » ‹ › : les fils de la liste d'où le mail a été ouvert.
  type NavRef = { threadId: string; subject: string; box: MailBox; contact?: string; name?: string };
  const navList = useMemo<NavRef[]>(() => {
    if (selected) {
      const seen = new Set<string>();
      const out: NavRef[] = [];
      for (const m of history ?? []) {
        const b = m.box ?? "partnerships";
        if (!m.threadId || seen.has(`${b}-${m.threadId}`)) continue;
        seen.add(`${b}-${m.threadId}`);
        out.push({ threadId: m.threadId, subject: m.subject, box: b });
      }
      return out;
    }
    return shownInbox.map((t) => ({ threadId: t.threadId, subject: t.subject, box: t.box, contact: t.email, name: t.name }));
  }, [selected, history, shownInbox]);
  const navIdx = thread ? navList.findIndex((n) => n.threadId === thread.threadId && n.box === thread.box) : -1;
  const focusReply = () => {
    const last = readerMsgs[readerMsgs.length - 1];
    if (last) setExpanded((s) => new Set([...s, last.id]));
    setReplyFocus(Date.now());
  };
  const photoOf = (n: string) => allCreators.find((c) => sameName(c.name, n))?.photo_url ?? null;
  const readerOpen = !!thread || (mode === "contacts" && !!selected);

  // Pièce jointe d'un fil agence : lue côté serveur dans la boîte du fil.
  const downloadAgencyAttachment = async (a: MailAttachment) => {
    if (!thread) return;
    const r = await invokeJson<{ ok?: boolean; data?: string; error?: string }>("gmail-thread", {
      action: "attachment", messageId: a.messageId, attachmentId: a.attachmentId, box: thread.box,
    });
    if (!r?.ok || !r.data) return toast(r?.error === "piece_trop_lourde" ? "Pièce jointe trop lourde (20 Mo max)." : "Téléchargement impossible");
    saveBase64(r.data, a.filename);
  };

  const boxMeta = BOXES.find((b) => b.id === box) ?? BOXES[0];
  const listCls = "flex min-h-0 min-w-0 flex-col bg-panel lg:border-r lg:border-border";
  const listHead = (title: string, meta: ReactNode, right?: ReactNode) => (
    <div className="px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight text-foreground sm:text-[22px]">{title}</h2>
        {right}
      </div>
      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">{meta}</p>
    </div>
  );
  const listNote = (text: string) => (
    <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
      <CircleAlert className="h-3.5 w-3.5 shrink-0" /> {text}
    </div>
  );
  const centerNote = (icon: ReactNode, text: string) => (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon}
      <p className="text-[13px] text-muted-foreground">{text}</p>
    </div>
  );

  // ── Barre d'icônes (ordinateur) ──────────────────────────────────────────
  const rail = (
    <nav aria-label="Dossiers et boîtes" className="hidden min-h-0 flex-col items-center gap-1.5 border-r border-border py-3 lg:flex">
      <button
        type="button"
        onClick={() => setNewMailOpen(true)}
        aria-label="Nouveau mail"
        className="group relative mb-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90"
      >
        <PenLine className="h-[17px] w-[17px]" />
        <Tip>Nouveau mail</Tip>
      </button>
      {MODES.map((m) => (
        <RailButton key={m.id} label={m.label} active={mode === m.id} badge={m.id === "inbox" ? unread : null} onClick={() => goMode(m.id)}>
          <m.icon className="h-[18px] w-[18px]" />
        </RailButton>
      ))}
      <span aria-hidden className="my-2 h-px w-6 shrink-0 bg-border" />
      {BOXES.map((b) => (
        <RailButton key={b.id} label={`${b.label} · ${b.hint}`} active={box === b.id} bar={false} onClick={() => setBox(b.id)}>
          <BoxSquare box={b.id} />
        </RailButton>
      ))}
      <span className="flex-1" />
      <RailButton label="Signature et délai" onClick={() => setSettingsOpen(true)}>
        <Settings2 className="h-[18px] w-[18px]" />
      </RailButton>
    </nav>
  );

  // ── Même barre, en ligne (téléphone, tablette) ──────────────────────────
  const mobileNav = (
    <nav aria-label="Dossiers et boîtes" className="flex gap-1.5 overflow-x-auto border-b border-border p-2 [scrollbar-width:none] lg:hidden">
      <button type="button" onClick={() => setNewMailOpen(true)} className={cn(pillCls, "bg-primary px-3 text-primary-foreground hover:opacity-90")}>
        <PenLine className="h-3.5 w-3.5" /> Nouveau
      </button>
      {MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button key={m.id} type="button" onClick={() => goMode(m.id)} aria-pressed={on}
            className={cn(pillCls, on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <m.icon className="h-3.5 w-3.5" /> {m.short}
            {m.id === "inbox" && unread ? <span className={cn("tabular-nums", on ? "opacity-70" : "text-faint")}>{unread}</span> : null}
          </button>
        );
      })}
      <span aria-hidden className="mx-0.5 my-1.5 w-px shrink-0 bg-border" />
      {BOXES.map((b) => {
        const on = box === b.id;
        return (
          <button key={b.id} type="button" onClick={() => setBox(b.id)} aria-pressed={on} title={b.hint}
            className={cn(pillCls, on ? "bg-muted text-foreground ring-1 ring-border" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <BoxSquare box={b.id} className="size-3 rounded-[3px]" /> {b.short}
          </button>
        );
      })}
      <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Signature et délai"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
        <Settings2 className="h-4 w-4" />
      </button>
    </nav>
  );

  // ── Liste : boîte de réception / envoyés ────────────────────────────────
  const nInbox = inbox?.length ?? 0;
  const inboxCol = (
    <section className={cn(listCls, readerOpen && "max-lg:hidden")}>
      {listHead(
        folder === "sent" ? "Envoyés" : "Boîte de réception",
        <>
          <BoxSquare box={box} className="size-2.5 rounded-[3px]" />
          <span className="truncate">
            {boxMeta.label}
            {inbox && !inboxBusy ? ` · ${inboxQ ? `${shownInbox.length} sur ${nInbox}` : nInbox} conversation${nInbox > 1 ? "s" : ""}` : ""}
          </span>
        </>,
        <ToolButton icon={RefreshCw} label="Actualiser" spin={inboxBusy} disabled={inboxBusy} onClick={() => setInboxTick((n) => n + 1)} />,
      )}
      <div className="px-4 pb-3 pt-3 sm:px-5"><SearchField value={inboxQuery} onChange={setInboxQuery} placeholder="Rechercher dans ces mails…" /></div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {inboxBusy && !inbox?.length ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la boîte…
          </div>
        ) : inboxErr ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">{inboxErr}</div>
        ) : !inbox?.length ? (
          centerNote(<Inbox className="h-5 w-5 text-faint" />, folder === "sent" ? "Aucun mail envoyé depuis cette boîte." : "Aucun mail dans cette boîte.")
        ) : (
          <ul className={cn("divide-y divide-border transition-opacity", inboxBusy && "opacity-60")}>
            {inboxPartial && <li>{listNote("Une des deux boîtes n'a pas répondu : la liste peut être incomplète.")}</li>}
            {shownInbox.length === 0 && <li>{centerNote(<Search className="h-5 w-5 text-faint" />, `Aucun mail ne correspond à « ${inboxQuery.trim()} ».`)}</li>}
            {shownInbox.map((t) => {
              const on = thread?.threadId === t.threadId && thread.box === t.box;
              return (
                <li key={`${t.box}-${t.threadId}`}>
                  <SwipeRow actions={[{ key: "trash", label: "Corbeille", icon: Trash2, tone: "red", onClick: () => void trashTarget(t) }]}>
                  <button
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => void openThread({ threadId: t.threadId, subject: t.subject, box: t.box, contact: t.email, name: t.name })}
                    className={cn(mailRowCls(on), "py-4")}
                  >
                    <Initial name={prettyName(t.name)} email={t.email} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        {t.unread && <span className="size-2 shrink-0 rounded-full bg-primary" title="Non lu" />}
                        <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", t.unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
                          {folder === "sent" && <span className="font-normal">À : </span>}
                          {prettyName(t.name) || t.email}
                          {t.count > 1 && <span className="ml-1.5 font-normal text-faint">{t.count}</span>}
                        </span>
                        <span className={cn("shrink-0 text-[11px] tabular-nums", t.unread ? "font-semibold text-foreground" : "text-faint")}>{fmtWhen(t.ts)}</span>
                      </span>
                      <span className={cn("mt-1 block truncate text-[13.5px] text-foreground", t.unread ? "font-bold" : "font-semibold")}>{t.subject || "(sans objet)"}</span>
                      <span className="mt-1 flex min-w-0 items-end gap-3">
                        <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-[1.45] text-muted-foreground">
                          {t.direction === "out" && folder === "inbox" && <span className="text-faint">Vous : </span>}
                          {decodeEntities(t.snippet)}
                        </span>
                        <span title={BOX_LABEL[t.box]} className="mb-0.5 shrink-0"><BoxSquare box={t.box} className="size-2.5 rounded-[3px]" /></span>
                      </span>
                    </span>
                  </button>
                  </SwipeRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );

  // ── Liste : contacts ─────────────────────────────────────────────────────
  const contactsCol = (
    <section className={cn(listCls, readerOpen && "max-lg:hidden")}>
      {listHead("Contacts", `${filtered.length} contact${filtered.length > 1 ? "s" : ""} avec e-mail`)}
      <div className="flex flex-col gap-2.5 px-4 pb-3 pt-3 sm:px-5">
        <SearchField value={query} onChange={setQuery} placeholder="Rechercher un contact…" />
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
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
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
                  aria-current={selected?.id === c.id || undefined}
                  onClick={() => { setSelected(c); setThread(null); }}
                  className={cn(mailRowCls(selected?.id === c.id), "items-center py-3.5")}
                >
                  <Initial name={c.brand || c.label} email={c.email} />
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
    </section>
  );

  // ── Lecture d'un fil ─────────────────────────────────────────────────────
  const openThreadCreator = () => {
    if (thread && threadCreator) openCreator(threadCreator.creator, thread.threadId);
  };
  const replyTo = thread ? titleCase(prettyName(selected?.person || thread.name || displayName(thread.contact))) || thread.contact : "";
  const threadReader = thread && (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-border px-2 sm:px-3">
        <ToolButton icon={ArrowLeft} label={selected ? "Retour aux échanges" : "Fermer"} onClick={() => setThread(null)} />
        {readerMsgs.length > 0 && (
          <ToolButton icon={Trash2} label="Supprimer (corbeille Gmail)" danger busy={trashBusy} disabled={trashBusy} onClick={() => setTrashAsk(true)} />
        )}
        {threadCreator && (
          <ToolButton icon={MessageSquareText} label={`Statut et remarques que ${firstName(threadCreator.creator)} voit`} onClick={openThreadCreator} />
        )}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          {navIdx >= 0 && navList.length > 1 && (
            <>
              <ToolButton icon={ChevronLeft} label="Mail précédent" className="h-8 w-8" disabled={navIdx <= 0} onClick={() => void openThread(navList[navIdx - 1])} />
              <span className="whitespace-nowrap px-1 text-[12.5px] tabular-nums text-muted-foreground">{navIdx + 1} sur {navList.length}</span>
              <ToolButton icon={ChevronRight} label="Mail suivant" className="h-8 w-8" disabled={navIdx >= navList.length - 1} onClick={() => void openThread(navList[navIdx + 1])} />
            </>
          )}
        </div>
        {readerMsgs.length > 0 && <ToolButton icon={Reply} label="Répondre" onClick={focusReply} />}
        {readerMsgs.length > 0 && <ToolButton icon={Forward} label="Transférer" onClick={() => setForwardMsg(readerMsgs[readerMsgs.length - 1])} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-6 sm:px-8">
          <h1 className="text-[20px] font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance] sm:text-[22px]">
            {thread.subject || "(sans objet)"}
          </h1>
          <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <BoxChip box={thread.box} className="text-[10px]" />
            <span className="min-w-0 truncate">
              {selected?.label ?? (prettyName(thread.name) || thread.contact)}
              {threadMsgs ? ` · ${threadMsgs.length} message${threadMsgs.length > 1 ? "s" : ""}` : ""}
            </span>
          </p>
          {threadBusy ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Ouverture…</div>
          ) : readerMsgs.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-muted-foreground">Impossible de charger ce fil.</div>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-border">
              {readerMsgs.map((m, i) => {
                const last = i === readerMsgs.length - 1;
                return (
                  <div key={m.id} className="flex flex-col">
                    <MailItem
                      variant="plain"
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
                        { icon: Reply, label: "Répondre", onClick: focusReply },
                        { icon: Forward, label: "Transférer", onClick: () => setForwardMsg(m) },
                      ]}
                      footer={last ? (
                        <ReplyBox
                          variant="card"
                          to={replyTo}
                          box={thread.box}
                          focusKey={replyFocus}
                          placeholder="Écris ta réponse…"
                          onSend={sendReply}
                        />
                      ) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {readerMsgs.length > 0 && (
        <div className="flex h-14 shrink-0 items-center gap-1 border-t border-border px-2 max-sm:hidden sm:px-3">
          <BarButton icon={Reply} label="Répondre" onClick={focusReply} />
          <BarButton icon={Forward} label="Transférer" onClick={() => setForwardMsg(readerMsgs[readerMsgs.length - 1])} />
          <span className="flex-1" />
          {threadCreator && <BarButton icon={MessageSquareText} label={`Statut et remarques · ${firstName(threadCreator.creator)}`} onClick={openThreadCreator} />}
          <BarButton icon={Trash2} label="Supprimer" danger busy={trashBusy} disabled={trashBusy} onClick={() => setTrashAsk(true)} />
        </div>
      )}
    </section>
  );

  // ── Lecture : échanges d'un contact ──────────────────────────────────────
  const contactReader = selected && (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3">
        <ToolButton icon={ArrowLeft} label="Retour aux contacts" className="lg:hidden" onClick={() => setSelected(null)} />
        <span className="min-w-0 flex-1 truncate px-2 text-[12.5px] text-muted-foreground">Échanges avec ce contact, dans les deux boîtes</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-4 px-4 py-6 sm:px-8">
          <Initial name={selected.brand || selected.label} email={selected.email} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold tracking-tight text-foreground sm:text-[22px]">{selected.brand || selected.person || selected.email}</h1>
            <p className="truncate text-[12.5px] text-muted-foreground">{[selected.brand ? selected.person : null, selected.email].filter(Boolean).join(" · ")}</p>
          </div>
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <PenLine className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Nouveau mail</span>
          </button>
        </div>

        <div className="border-t border-border">
          {historyBusy ? (
            <div className="flex items-center justify-center gap-2 px-5 py-12 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement des échanges…
            </div>
          ) : historyErr ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">{historyErr}</div>
          ) : visibleHistory.length === 0 ? (
            centerNote(<Mail className="h-5 w-5 text-faint" />, "Aucun échange trouvé dans les deux boîtes avec ce contact.")
          ) : (
            <ul className="divide-y divide-border">
              {historyPartial && <li>{listNote("Une des deux boîtes n'a pas répondu : l'historique peut être incomplet.")}</li>}
              {visibleHistory.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => m.threadId && void openThread({ threadId: m.threadId, subject: m.subject, box: m.box })}
                    className={cn("flex w-full items-start gap-3 px-4 py-4 text-left transition-colors sm:px-8", m.threadId ? "hover:bg-rowhover" : "cursor-default")}
                  >
                    <span
                      className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", BOX_STYLE[boxOf(m)].soft)}
                      title={m.direction === "in" ? "Reçu" : "Envoyé"}
                    >
                      {m.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">{m.subject || "(sans objet)"}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtDate(m.date)}</span>
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-2">
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
        </div>
      </div>
    </section>
  );

  // ── Lecture vide (ordinateur) ────────────────────────────────────────────
  const emptyReader = (
    <section className="hidden min-h-0 min-w-0 flex-col items-center justify-center gap-3 px-6 text-center lg:flex">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted"><Mail className="h-5 w-5 text-muted-foreground" /></span>
      <p className="text-[14px] font-medium text-foreground">{mode === "contacts" ? "Aucun contact ouvert" : "Aucun mail ouvert"}</p>
      <p className="max-w-[300px] text-[13px] text-muted-foreground">
        {mode === "contacts" ? "Choisis un contact pour voir tous vos échanges, dans les deux boîtes." : "Choisis un mail dans la liste pour le lire ici."}
      </p>
      <button
        type="button"
        onClick={() => setNewMailOpen(true)}
        className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover"
      >
        <PenLine className="h-3.5 w-3.5" /> Nouveau mail
      </button>
    </section>
  );

  // ── Par créatrice : ses échanges (talent@, son alias), statuts et remarques ──
  const creatorsCol = (
    <section className="min-h-0 min-w-0 overflow-y-auto">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-center gap-1">
          {creatorView && <ToolButton icon={ArrowLeft} label="Toutes les créatrices" className="-ml-2" onClick={() => setCreatorView(null)} />}
          <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight text-foreground sm:text-[22px]">Par créatrice</h2>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Ses échanges (talent@, son alias), rangés par statut, avec les remarques qu'elle voit dans son espace.
        </p>
        {creatorView && creatorChoices.length > 1 && (
          <Tabs
            className="mt-3 xl:hidden"
            size="sm"
            wrap
            label="Créatrice"
            value={creatorView.name}
            onValueChange={(v) => openCreator(v)}
            items={creatorChoices.map((n) => ({
              value: n,
              label: titleCase(n),
              icon: <CreatorAvatar name={n} photoUrl={photoOf(n)} className="h-4 w-4 rounded-full text-[7px]" />,
            }))}
          />
        )}
      </div>
      <div className="px-4 pb-6 pt-4 sm:px-6">
        {creatorView ? (
          <Suspense fallback={<div className="flex items-center justify-center gap-2 p-10 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>}>
            <CreatorMailsAgency
              key={`${creatorView.name}-${creatorView.threadId ?? ""}`}
              creator={creatorView.name}
              suggestedAlias={emailPro.get(creatorView.name.trim().toLowerCase()) ?? null}
              initialThreadId={creatorView.threadId}
              onSaved={() => setLinkedTick((n) => n + 1)}
              className="mt-0"
            />
          </Suspense>
        ) : creatorChoices.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">Aucune créatrice active dans le Roster.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
            {creatorChoices.map((n) => {
              const l = linked.find((x) => sameName(x.creator, n));
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => openCreator(n)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-rowhover"
                >
                  <CreatorAvatar name={n} photoUrl={photoOf(n)} className="h-10 w-10 shrink-0 rounded-full text-[12px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-foreground">{titleCase(n)}</span>
                    <span className={cn("block truncate text-[12px]", l ? "text-muted-foreground" : "text-faint")}>
                      {l ? l.alias ?? "Libellé Gmail" : "Pas encore reliée"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  // ── Colonne de droite (grand écran) : les créatrices en un clic ─────────
  const rightRail = (
    <aside aria-label="Créatrices" className="hidden min-h-0 flex-col items-center border-l border-border xl:flex">
      <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-border">
        <button
          type="button"
          onClick={() => { goMode("creators"); setCreatorView(null); }}
          title="Par créatrice"
          aria-label="Par créatrice"
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg transition-colors",
            mode === "creators" && !creatorView ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
          )}
        >
          <UsersRound className="h-[17px] w-[17px]" />
        </button>
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto py-3 [scrollbar-width:none]">
        {creatorChoices.map((n) => {
          const on = mode === "creators" && !!creatorView && sameName(creatorView.name, n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => openCreator(n)}
              title={`Mails de ${titleCase(n)}`}
              aria-label={`Mails de ${titleCase(n)}`}
              aria-pressed={on}
              className={cn("shrink-0 rounded-full p-0.5 ring-2 transition-shadow", on ? "ring-foreground" : "ring-transparent hover:ring-border")}
            >
              <CreatorAvatar name={n} photoUrl={photoOf(n)} className="h-8 w-8 rounded-full text-[10px]" />
            </button>
          );
        })}
      </div>
    </aside>
  );

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:grid lg:h-[calc(100dvh-204px)] lg:min-h-[560px] lg:grid-rows-[minmax(0,1fr)]",
          mode === "creators"
            ? "lg:grid-cols-[64px_minmax(0,1fr)] xl:grid-cols-[64px_minmax(0,1fr)_60px]"
            : "lg:grid-cols-[64px_minmax(280px,320px)_minmax(0,1fr)] xl:grid-cols-[64px_minmax(300px,350px)_minmax(0,1fr)_60px]",
        )}
      >
        {rail}
        {mobileNav}
        {mode === "creators" ? (
          creatorsCol
        ) : (
          <>
            {mode === "contacts" ? contactsCol : inboxCol}
            {thread ? threadReader : mode === "contacts" && selected ? contactReader : emptyReader}
          </>
        )}
        {rightRail}
      </div>
      {trashAsk && thread && (
        <ConfirmDialog
          title="Supprimer ce mail ?"
          message={`« ${thread.subject || "(sans objet)"} » part dans la corbeille de ${BOX_LABEL[thread.box]}, avec toute la conversation. Il y reste 30 jours : tu peux le récupérer dans Gmail.`}
          confirmLabel={trashBusy ? "Suppression…" : "Supprimer"}
          danger
          onConfirm={() => void trashThread()}
          onCancel={() => setTrashAsk(false)}
        />
      )}
      {trashed && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[1301] flex justify-center px-4 md:bottom-24">
          <div role="status" className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg shadow-black/5">
            <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">« {trashed.subject || "(sans objet)"} » mis à la corbeille</span>
            <button type="button" onClick={() => void untrash()}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover">
              <Undo2 className="h-3.5 w-3.5" /> Annuler
            </button>
          </div>
        </div>
      )}
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

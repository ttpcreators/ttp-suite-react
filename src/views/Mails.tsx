import { useStickyState } from "@/lib/useStickyState";
import { lazyImport } from "@/lib/appUpdate";
import { contextPrompt, threadTranscript } from "@/lib/mailThreadContext";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ExpandableActionBar } from "@/components/ui/expandable-action-bar";
import { Loader, Spin } from "@/components/ui/loader";
import { Mail, MailOpen, ArrowDownLeft, ArrowUpRight, ArrowLeft, Archive, Inbox, Search, PenLine, Reply, Forward, Settings2, RefreshCw, Send, Copy, MessageSquareText, Trash2, Undo2, BookUser, UsersRound, ChevronLeft, ChevronRight, ChevronDown, CircleAlert, Keyboard, RotateCw, X, Plus, FilePen, Smartphone, type LucideIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/ui/action-menu";
import {
  deleteGmailDraft, draftBodyText, draftDeleteErrText, gmailDraftLocalKey, isReplyDraft, parseDraftsRes, parseReplyDraftKey, seedReplyDraft,
  type GmailDraftRow, type ReplyDraft,
} from "@/lib/mailDrafts";
import { supabase } from "@/lib/supabase";
import { allAddresses } from "@/lib/mailAddresses";
import { cn, titleCase } from "@/lib/utils";
import { getCache, setCache } from "@/lib/viewCache";
import { invalidateMailUnread } from "@/lib/useMailUnread";
import { brandFromEmail } from "@/lib/mailModels";
import { Initial, MailItem, fmtWhen } from "@/components/mail-reader";
import { Kbd, RailButton, SearchField, Tip, ToolButton, mailCardBtnCls, mailCardCls, mailCardListCls, mailRowCls, pillCls, type TipSide, UnreadToggle } from "@/components/mail-shell";
import { SwipeRow, type SwipeAction } from "@/components/mobile/swipe-row";
import { STORED_STATUSES, saveBase64, statusMeta, type MailAttachment, type MailMessage } from "@/lib/creatorMail";
import { toast } from "@/components/ui/toast";
import { parseTouches, nextKind, touchId, type Touch } from "@/lib/touches";
import { updateTouches } from "@/lib/touchesDb";
import { MailComposer, type ComposerContact } from "@/components/mail-composer";
import { BoxChip, BoxDot } from "@/components/mail-box-chip";
import { BOX_LABEL, BOX_STYLE, readDraft, readDraftRaw, replyDraftKey, scheduleSend, sendFailText, sendGmail, writeDraft, type MailBox, type OutAttachment } from "@/lib/mailSend";
import { ForwardDialog, MailSettingsDialog, NewMailDialog, ReplyBox, useDeviceDraftKeys, type ForwardReopen } from "@/components/mail-tools";
import { Tabs } from "@/components/ui/animated-tabs";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useCreators } from "@/lib/useCreators";
import { useCreatorMailCounts } from "@/lib/creatorMailCounts";
import { connect as connectGoogle, consumeOAuthReturn } from "@/lib/googleCalendar";
import { useSearch } from "@/lib/search";
import { useLiveKey } from "@/lib/useLive";
import { buildBrandIndex, collabTag, creatorTone, matchCollabs, relanceDays, type BrandIndex, type CollabLite, type MailTag } from "@/lib/mailCollab";
import { LinkedCollabCard, MailTagChip } from "@/components/mail-collab";
import { MailReactions } from "@/components/mail-reactions";
import { canReact, reactionErrorText, reactionRecipients, splitReactions, type ReactionPill } from "@/lib/mailReactions";
import { myDisplayName } from "@/lib/team";
import { useIntent } from "@/lib/openIntent";

// Espace mails d'un créateur (statuts, remarques, suivi), chargé seulement à la demande.
const CreatorMailsAgency = lazy(lazyImport(() => import("@/views/CreatorMails").then((m) => ({ default: m.CreatorMailsAgency }))));

/**
 * Page « Mails » de l'agence, façon client mail : dossiers (reçus, envoyés,
 * contacts, créateurs), liste des conversations des deux boîtes (partnerships@ et
 * talent@, filtrées sans rechargement), lecture d'un fil, réponse, transfert,
 * archivage, corbeille, lu / non lu, brouillons et raccourcis clavier.
 *
 * Fiabilité : les réponses périmées sont ignorées, une erreur ne vide jamais la
 * liste affichée, les actions ne sont gardées que si le serveur les confirme
 * (une ancienne version des fonctions Gmail ne fait rien : l'app revient en arrière).
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
  /** En-têtes ajoutés par la v2 de gmail-thread (absents avec une ancienne version). */
  messageIdHeader?: string; inReplyTo?: string; references?: string; replyTo?: string;
  /** Brouillon Gmail du fil (libellé DRAFT) : pas affiché comme un message. */
  draft?: boolean;
  /** Réaction emoji (gmail-thread 2026-10-23) : pastille sous le message visé. */
  reaction?: string;
  /** Message d'une liste de diffusion : pas de réaction proposée. */
  list?: boolean;
};
type InboxThread = {
  threadId: string; subject: string; name: string; email: string; snippet: string;
  ts: number; count: number; direction: "in" | "out"; unread: boolean; box: MailBox;
  /** v2 : adresses du fil (To/Cc/Delivered-To) et fil hors boîte de réception (recherche). */
  to?: string[]; archived?: boolean;
};
type Folder = "inbox" | "sent";
type PageTokens = Partial<Record<MailBox, string>>;
type ListRes = { ok?: boolean; threads?: InboxThread[]; nextPageTokens?: PageTokens; partial?: boolean; failedBoxes?: string[]; error?: string };
type ListState = { threads: InboxThread[]; next: PageTokens | null; partial: boolean; failedBoxes: MailBox[]; pages: number; v2: boolean };
type ThreadRes = { ok?: boolean; messages?: ThreadMsg[]; error?: string };
/** Messages d'un fil à afficher : sans les brouillons (ils reviennent dans la zone de réponse). */
const shownMsgs = (r: ThreadRes) => (r.messages ?? []).filter((m) => !m.draft);
type DraftsRes = { ok?: boolean; error?: string; folder?: unknown; threads?: unknown; partial?: boolean; failedBoxes?: unknown };
type DraftsState = { rows: GmailDraftRow[]; partial: boolean; failedBoxes: MailBox[]; old: boolean };
type ActionRes = { ok?: boolean; action?: string; error?: string };
type PeekRes = { ok?: boolean; boxes?: Partial<Record<MailBox, { historyId?: string; unread?: number }>>; error?: string };
/** Fil visé par une action (archiver, corbeille, lu / non lu). */
type Target = { threadId: string; box: MailBox; subject: string };
/** Fil à ouvrir (depuis la liste, l'historique d'un contact ou les raccourcis). */
type OpenRef = { threadId: string; subject: string; box: MailBox; contact?: string; name?: string };
type OpenThread = { contact: string; name: string; subject: string; threadId: string; box: MailBox };
/** Changement affiché avant la confirmation du serveur (retiré s'il n'est pas confirmé). */
type Override = {
  unread?: boolean; hidden?: "archive" | "trash"; at: number; done?: number;
  /** Réponse envoyée depuis l'app : le fil s'affiche « Répondu » tout de suite, avant que Gmail l'ait indexée. */
  reply?: { ts: number; snippet: string };
};
type SearchState = { q: string; folder: Folder; threads: InboxThread[]; busy: boolean; err: string | null; off: boolean };
type UndoState = { kind: "trash" | "archive"; t: Target; row: InboxThread | null; folder: Folder; done: Promise<boolean>; at: number };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AGENCY_DOMAIN = "@ttpcreators.pro";
const LIST_TIMEOUT = 20_000;
const FILE_TIMEOUT = 60_000;
const THREAD_TTL = 60_000;
const OLD_RETRY_MS = 10 * 60_000;
const OLD_SERVER_TEXT = "Pas encore disponible : la mise à jour des fonctions Gmail n'est pas encore déployée.";

const tkey = (box: MailBox, threadId: string) => `${box}:${threadId}`;
const keyOf = (t: { box: MailBox; threadId: string }) => tkey(t.box, t.threadId);

// Caches de module : gardés quand on change de page (perdus au rechargement).
const threadCache = new Map<string, { at: number; msgs: ThreadMsg[] }>();
const prefetching = new Set<string>();
let actionsOldAt = 0; // gmail-thread n'a pas reconnu `action` (ancienne version déployée)
let searchOldAt = 0; // gmail-history n'a pas reconnu `q`
let draftsOldAt = 0; // gmail-history n'a pas reconnu le dossier « drafts »
const DRAFTS_OLD_TEXT = "Brouillons pas encore installés : la mise à jour des fonctions Gmail n'est pas encore déployée.";
let peekOff = false; // gmail-history n'a pas reconnu `peek` : actualisation complète toutes les 2 min
let peekSig = ""; // derniers historyId vus (coup d'œil)
// Lu / non lu, archivé, corbeille pas encore confirmés par une liste FRAÎCHE du serveur :
// gardés quand on quitte la page (sinon la liste en cache remontrait l'ancien état).
const pendingOv = new Map<string, Override>();
/** Délai après lequel une liste du serveur fait foi, même si elle contredit l'app (nouveau message…). */
const OV_TRUST_MS = 90_000;

/** Date façon Gmail : « 14:32 » aujourd'hui, sinon la date commune (« 3 oct. », « 3 oct. 2025 »). */
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
/** Extrait d'une réponse envoyée (sans signature ni citation), comme Gmail l'afficherait. */
function htmlToSnippet(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html.replace(/<(br|\/p|\/div)[^>]*>/gi, " ");
  return (d.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}
/** Décode les entités HTML des extraits Gmail (« l&#39;ensemble » → « l'ensemble »). */
const entityCache = new Map<string, string>();
function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  const hit = entityCache.get(s);
  if (hit != null) return hit;
  const t = document.createElement("textarea");
  t.innerHTML = s;
  if (entityCache.size > 500) entityCache.clear();
  entityCache.set(s, t.value);
  return t.value;
}
const ADDR_RE = /[^\s<>"',;]+@[^\s<>"',;]+/g;
const addrsOf = (v?: string | null) => (v?.match(ADDR_RE) ?? []).map((a) => a.toLowerCase());
const addrOf = (v?: string | null) => addrsOf(v)[0] ?? "";
const isAgencyAddr = (a: string) => a.endsWith(AGENCY_DOMAIN);

/**
 * Réponse à un fil : destinataire = Reply-To du dernier message reçu, sinon son
 * expéditeur ; « Répondre à tous » = ses To + Cc, sans les adresses de l'agence ni
 * le destinataire ; In-Reply-To / References = dernier message du fil.
 */
function replyPlan(msgs: ThreadMsg[], fallback: string): { to: string; cc: string[]; inReplyTo?: string; references?: string } {
  const lastIn = [...msgs].reverse().find((m) => !isAgencyAddr(addrOf(m.from)));
  const base = lastIn ?? msgs[msgs.length - 1];
  let to = lastIn ? addrOf(lastIn.replyTo) || addrOf(lastIn.from) : "";
  if (!to) to = fallback || addrsOf(base?.to).find((a) => !isAgencyAddr(a)) || "";
  const others = base ? [...addrsOf(base.from), ...addrsOf(base.to), ...addrsOf(base.cc)] : [];
  const cc = [...new Set(others.filter((a) => a !== to && !isAgencyAddr(a)))];
  const last = msgs[msgs.length - 1];
  const id = last?.messageIdHeader?.trim();
  const references = [last?.references?.trim(), id].filter(Boolean).join(" ").slice(-1900) || undefined;
  return { to, cc, inReplyTo: id || undefined, references: id ? references : undefined };
}

const needsReconnect = (code?: string | null) => code === "google_non_connecte" || code === "gmail_scope_manquant";
/** Texte d'une erreur de chargement (liste, fil, historique). */
function loadErrText(code: string | null | undefined, fallback: string): string {
  if (needsReconnect(code)) return "Google n'est plus connecté à l'app (ou les droits Gmail manquent).";
  if (code === "limite_gmail") return "Gmail limite les demandes, réessaie dans une minute.";
  if (code === "talent_non_configure") return "La boîte talent@ n'est pas encore reliée à l'app.";
  if (code === "reseau") return "Pas de réponse du serveur (connexion lente ou coupée).";
  return fallback;
}
const actionErrText = (code?: string) =>
  needsReconnect(code) ? "Reconnecte Google (droits Gmail) pour modifier tes mails."
    : code === "limite_gmail" ? "Gmail limite les demandes, réessaie dans une minute."
    : code === "talent_droit_manquant" ? "Modification depuis talent@ pas encore autorisée (admin.google.com, droit gmail.modify)."
    : code === "reseau" ? "Pas de réponse du serveur : action non faite, réessaie."
    : "Action impossible, réessaie";
const trashErrorText = (code?: string, b?: MailBox) =>
  code === "gmail_scope_manquant" || code === "talent_droit_manquant"
    ? b === "talent"
      ? "Suppression depuis talent@ pas encore autorisée (admin.google.com, droit gmail.modify)."
      : "Reconnecte Google (Planning → Google Agenda) pour autoriser la suppression."
    : code === "introuvable" ? "Mail introuvable (déjà supprimé ?)"
    : code === "limite_gmail" ? "Gmail limite les demandes, réessaie dans une minute."
    : "Suppression impossible, réessaie";

/**
 * Appel d'une fonction Gmail, avec délai max. supabase-js met le corps JSON des
 * réponses non-2xx dans error.context ; coupure réseau / délai dépassé → `{ error: "reseau" }`.
 */
async function invokeJson<T extends { error?: string }>(fn: string, body: Record<string, unknown>, timeout = LIST_TIMEOUT): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body, timeout });
    if (error) {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const parsed = ctx && typeof ctx.json === "function" ? ((await ctx.json().catch(() => null)) as T | null) : null;
      return parsed ?? ({ error: "reseau" } as T);
    }
    return ((data && typeof data === "object" ? data : {}) as T) ?? ({} as T);
  } catch {
    return { error: "reseau" } as T;
  }
}

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

/** Conteneur qui défile autour de la page (zone principale de l'app). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}
const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

/** Grand écran : le client mail remplit la hauteur visible de la zone principale. */
function useFillHeight(ref: RefObject<HTMLElement | null>): number | null {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = scrollParent(el);
    const mq = window.matchMedia("(min-width: 1024px)");
    const fit = () => {
      if (!mq.matches) return setH(null);
      if (!scroller || !el.getClientRects().length) return; // onglet masqué : on garde la hauteur
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const pb = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      setH(Math.max(560, Math.floor(scroller.clientHeight - top - pb)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (scroller) ro.observe(scroller);
    mq.addEventListener("change", fit);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", fit);
      window.removeEventListener("resize", fit);
    };
  }, [ref]);
  return h;
}

/** Fusionne une liste fraîche avec celle affichée, sans perdre les pages chargées ni une boîte muette. */
function mergeList(prev: ListState | null, res: ListRes): ListState {
  const fresh = res.threads ?? [];
  const failed = (res.failedBoxes ?? []).filter((b): b is MailBox => b === "partnerships" || b === "talent");
  const seen = new Set(fresh.map(keyOf));
  const threads = [...fresh];
  if (prev) {
    // Boîte qui n'a pas répondu : ses fils déjà affichés restent.
    for (const t of prev.threads) {
      if (failed.includes(t.box) && !seen.has(keyOf(t))) {
        threads.push(t);
        seen.add(keyOf(t));
      }
    }
    // Pages déjà chargées (« Charger plus ») : les fils plus anciens restent.
    if (prev.pages > 1) {
      const oldest: Partial<Record<MailBox, number>> = {};
      for (const t of fresh) oldest[t.box] = Math.min(oldest[t.box] ?? Infinity, t.ts);
      for (const t of prev.threads) {
        if (!seen.has(keyOf(t)) && t.ts < (oldest[t.box] ?? Infinity)) {
          threads.push(t);
          seen.add(keyOf(t));
        }
      }
    }
  }
  threads.sort((a, b) => b.ts - a.ts);
  const keep = !!prev && prev.pages > 1;
  return {
    threads,
    next: keep && prev ? prev.next : res.nextPageTokens ?? null,
    partial: !!res.partial,
    failedBoxes: failed,
    pages: keep && prev ? prev.pages : 1,
    v2: "nextPageTokens" in res || fresh.some((t) => typeof t.archived === "boolean"),
  };
}
const hasTokens = (p: PageTokens | null | undefined, box: "all" | MailBox) =>
  !!p && (box === "all" ? !!(p.partnerships || p.talent) : !!p[box]);

/*
 * Mise en page façon client mail : barre d'icônes (dossiers), liste avec son
 * en-tête (titre, boîtes, recherche), lecture.
 */
type Mode = "inbox" | "sent" | "drafts" | "contacts" | "creators";
const MODES: { id: Mode; label: string; short: string; wide: string; icon: LucideIcon; shortcut?: string }[] = [
  { id: "inbox", label: "Boîte de réception", short: "Reçus", wide: "Réception", icon: Inbox, shortcut: "g puis i" },
  { id: "sent", label: "Envoyés", short: "Envoyés", wide: "Envoyés", icon: Send, shortcut: "g puis s" },
  { id: "drafts", label: "Brouillons", short: "Brouillons", wide: "Brouillons", icon: FilePen, shortcut: "g puis d" },
  { id: "contacts", label: "Contacts", short: "Contacts", wide: "Contacts", icon: BookUser },
  { id: "creators", label: "Par créateur", short: "Créateurs", wide: "Suivi créateurs", icon: UsersRound },
];
const BOX_FILTERS: { id: "all" | MailBox; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "partnerships", label: BOX_LABEL.partnerships },
  { id: "talent", label: BOX_LABEL.talent },
];
const SHORTCUTS: [string, string][] = [
  ["j / k", "Mail suivant / précédent"],
  ["Entrée / o", "Ouvrir"],
  ["r", "Répondre"],
  ["a", "Répondre à tous"],
  ["f", "Transférer"],
  ["c", "Copier le fil pour Claude"],
  ["e", "Archiver"],
  ["#", "Corbeille"],
  ["⇧ U", "Marquer non lu"],
  ["/", "Rechercher"],
  ["c", "Nouveau mail"],
  ["Échap", "Fermer le mail"],
  ["g puis i", "Boîte de réception"],
  ["g puis s", "Envoyés"],
  ["g puis d", "Brouillons"],
  ["?", "Cette aide"],
];

/** Lignes fantômes pendant le premier chargement de la liste. */
function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul aria-hidden className={mailCardListCls}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex gap-3 rounded-xl bg-surface px-3.5 py-3 ring-1 ring-border/70 dark:bg-white/[0.05]">
          <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <span className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <span className="flex gap-2">
              <span className="h-3 w-28 animate-pulse rounded bg-muted" />
              <span className="ml-auto h-3 w-10 animate-pulse rounded bg-muted" />
            </span>
            <span className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <span className="h-3 w-3/5 animate-pulse rounded bg-muted/70" />
          </span>
        </li>
      ))}
    </ul>
  );
}
/** Corps fantôme pendant le chargement d'un fil. */
function BodySkeleton() {
  return (
    <div aria-hidden className="mt-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
        <span className="flex flex-1 flex-col gap-2">
          <span className="h-3 w-40 animate-pulse rounded bg-muted" />
          <span className="h-3 w-56 animate-pulse rounded bg-muted/70" />
        </span>
      </div>
      {[92, 100, 85, 96, 60].map((w, i) => (
        <span key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** Bandeau d'erreur dans la liste (la liste affichée reste en place). */
function ErrorBanner({ text, onRetry, onReconnect, tone = "error" }: { text: string; onRetry?: () => void; onReconnect?: () => void; tone?: "error" | "info" }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn(
      "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5 text-[12.5px] sm:px-5",
      tone === "error" ? "bg-danger/[0.06] text-foreground" : "bg-muted/50 text-muted-foreground",
    )}>
      <CircleAlert className={cn("h-3.5 w-3.5 shrink-0", tone === "error" ? "text-dangertext" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1">{text}</span>
      {onReconnect && (
        <button type="button" onClick={onReconnect} className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground hover:opacity-90">
          Reconnecter Google
        </button>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-foreground hover:bg-rowhover">
          <RotateCw className="h-3 w-3" /> Réessayer
        </button>
      )}
    </div>
  );
}
/** Carte d'erreur (fil ou liste impossible à charger). */
function ErrorCard({ text, onRetry, onReconnect }: { text: string; onRetry: () => void; onReconnect?: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 px-5 py-6 text-center">
      <CircleAlert className="h-5 w-5 text-dangertext" />
      <p className="text-[13px] text-foreground">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {onReconnect && (
          <button type="button" onClick={onReconnect} className="h-8 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90">
            Reconnecter Google
          </button>
        )}
        <button type="button" onClick={onRetry} className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-foreground hover:bg-rowhover">
          <RotateCw className="h-3.5 w-3.5" /> Réessayer
        </button>
      </div>
    </div>
  );
}

/** Bouton d'action au survol d'une ligne (ordinateur). */
function RowAction({ icon: Icon, label, shortcut, onClick, danger, side = "bottom-end" }: {
  icon: LucideIcon; label: string; shortcut?: string; onClick: () => void; danger?: boolean; side?: TipSide;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className={cn(
        "group/tip relative grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground",
        danger && "hover:text-dangertext dark:hover:text-dangertext",
      )}
    >
      <Icon className="h-[15px] w-[15px]" />
      <Tip side={side}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </Tip>
    </button>
  );
}

/** Ligne de la colonne de gauche (grand écran) : icône ou pastille de couleur, libellé, compteur. */
function FolderRow({ label, active, count, onClick, icon: Icon, swatch, title, shortcut }: {
  label: string; active?: boolean; count?: number | null; onClick: () => void; icon?: LucideIcon; swatch?: string; title?: string; shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      aria-keyshortcuts={shortcut}
      className={cn(
        "flex h-9 w-full min-w-0 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors",
        active ? "bg-muted font-semibold text-foreground dark:bg-white/[0.08]" : "font-medium text-muted-foreground hover:bg-rowhover hover:text-foreground",
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : <span aria-hidden className={cn("size-3 shrink-0 rounded-[4px]", swatch)} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className={cn("shrink-0 text-[12px] tabular-nums", active ? "text-foreground" : "text-faint")}>{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}

/** Une conversation de la liste, en carte : objet, expéditeur, heure, extrait sur deux lignes. */
function ThreadRow({ t, folder, on, cursor, showBox, draft, creator, creatorPhoto, tags, onOpen, onArchive, onTrash, onToggleRead }: {
  t: InboxThread; folder: Folder; on: boolean; cursor: boolean; showBox: boolean; draft: boolean;
  creator: string | null; creatorPhoto: string | null;
  /** Étiquettes de statut (collab liée, suivi créateur, relance), seulement si elles existent. */
  tags?: MailTag[];
  onOpen: () => void; onArchive: () => void; onTrash: () => void; onToggleRead: () => void;
}) {
  const name = prettyName(t.name) || t.email;
  const swipe: SwipeAction[] = [
    ...(folder === "inbox" ? [{ key: "archive", label: "Archiver", icon: Archive, tone: "blue" as const, onClick: onArchive }] : []),
    { key: "trash", label: "Corbeille", icon: Trash2, tone: "red", onClick: onTrash },
  ];
  return (
    <li className={mailCardCls(on, cursor)} data-key={keyOf(t)}>
      {/* Bord coloré : la boîte du fil (violet = partnerships@, vert = talent@). */}
      {showBox && <span aria-hidden title={BOX_LABEL[t.box]} className={cn("absolute right-0 top-3.5 z-[1] h-5 w-[3px] rounded-l-full", BOX_STYLE[t.box].dot)} />}
      <SwipeRow actions={swipe}>
        <button type="button" aria-current={on || undefined} onClick={onOpen} className={cn(mailCardBtnCls, "bg-surface dark:bg-transparent")}>
          <span className="flex w-full min-w-0 items-start gap-3">
            <Initial name={name} email={t.email} size="md" />
            <span className="min-w-0 flex-1 pt-px">
              <span className="flex min-w-0 items-center gap-1.5">
                {t.unread && <span className="size-2 shrink-0 rounded-full bg-primary"><span className="sr-only">Non lu</span></span>}
                <span className={cn("min-w-0 truncate text-[13px] leading-[18px] text-foreground", t.unread ? "font-bold" : "font-semibold")}>{t.subject || "(sans objet)"}</span>
                <span className="flex-1" />
                <span className={cn("shrink-0 pl-1 text-[11px] leading-4 tabular-nums lg:group-focus-within:invisible lg:group-hover:invisible", t.unread ? "font-semibold text-foreground" : "text-faint")}>
                  {fmtWhen(t.ts)}
                </span>
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <span className={cn("min-w-0 truncate text-[12.5px] leading-4", t.unread ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {folder === "sent" && <span className="font-normal">À : </span>}
                  {name}
                </span>
                {t.count > 1 && <span className="shrink-0 text-[11.5px] leading-4 text-faint">{t.count}</span>}
                {creator && (
                  <span title={`Créateur : ${titleCase(creator)}`} className="shrink-0">
                    <CreatorAvatar name={creator} photoUrl={creatorPhoto} className="h-4 w-4 rounded-full text-[7px]" />
                  </span>
                )}
                {draft && <span className="shrink-0 text-[11.5px] italic leading-4 text-dangertext">Brouillon</span>}
                {/* Dernier message = le nôtre : on a répondu, la balle est chez eux. */}
                {folder === "inbox" && t.direction === "out" && (
                  <span title="Tu as répondu en dernier" className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-px text-[10.5px] font-medium leading-4 text-muted-foreground">
                    <Reply className="h-3 w-3" /> Répondu
                  </span>
                )}
                {t.archived && <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Archivé</span>}
              </span>
            </span>
          </span>
          <span className="line-clamp-2 w-full text-[12.5px] leading-[18px] text-muted-foreground">
            {t.direction === "out" && folder === "inbox" && <span className="text-faint">Toi : </span>}
            {decodeEntities(t.snippet)}
          </span>
          {!!tags?.length && (
            <span className="flex flex-wrap gap-1">
              {tags.map((g) => <MailTagChip key={g.key} tag={g} />)}
            </span>
          )}
        </button>
      </SwipeRow>
      <div className="pointer-events-none absolute right-3 top-2 z-[2] hidden items-center gap-0.5 rounded-full bg-surface p-0.5 opacity-0 shadow-sm ring-1 ring-border transition-opacity lg:flex lg:group-focus-within:pointer-events-auto lg:group-focus-within:opacity-100 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100">
        {folder === "inbox" && !t.archived && <RowAction icon={Archive} label="Archiver" shortcut="e" onClick={onArchive} />}
        <RowAction icon={Trash2} label="Corbeille" shortcut="#" onClick={onTrash} danger />
        <RowAction icon={t.unread ? MailOpen : Mail} label={t.unread ? "Marquer comme lu" : "Marquer non lu"} shortcut={t.unread ? undefined : "⇧U"} onClick={onToggleRead} />
      </div>
    </li>
  );
}

/** Un brouillon (Gmail ou gardé sur cet appareil), en carte comme les fils de la liste. */
function DraftRow({ k, subject, to, email, snippet, ts, box, showBox, byClaude, hint, on, onOpen, onDelete }: {
  k: string; subject: string; to: string; email: string; snippet: string; ts: number; box: MailBox | null; showBox: boolean;
  byClaude?: boolean; hint?: string; on: boolean; onOpen: () => void; onDelete: () => void;
}) {
  return (
    <li className={mailCardCls(on)} data-key={k}>
      {showBox && box && <span aria-hidden title={BOX_LABEL[box]} className={cn("absolute right-0 top-3.5 z-[1] h-5 w-[3px] rounded-l-full", BOX_STYLE[box].dot)} />}
      <SwipeRow actions={[{ key: "delete", label: "Supprimer", icon: Trash2, tone: "red", onClick: onDelete }]}>
        <button type="button" aria-current={on || undefined} onClick={onOpen} className={cn(mailCardBtnCls, "bg-surface dark:bg-transparent")}>
          <span className="flex w-full min-w-0 items-start gap-3">
            <Initial name={to || email || "?"} email={email} size="md" />
            <span className="min-w-0 flex-1 pt-px">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-[13px] font-semibold leading-[18px] text-foreground">{subject || "(sans objet)"}</span>
                <span className="flex-1" />
                {ts > 0 && <span className="shrink-0 pl-1 text-[11px] leading-4 tabular-nums text-faint lg:group-focus-within:invisible lg:group-hover:invisible">{fmtWhen(ts)}</span>}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-[12.5px] leading-4 text-muted-foreground">
                  <span className="font-normal">À : </span>{to || "(aucun destinataire)"}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] font-medium leading-4 text-muted-foreground">Brouillon</span>
                {byClaude && <span title="Préparé par Claude (connecteur)" className="shrink-0 text-[11px] leading-4 text-faint">par Claude</span>}
                {hint && <span className="shrink-0 text-[11px] leading-4 text-faint">{hint}</span>}
              </span>
            </span>
          </span>
          {snippet && <span className="line-clamp-2 w-full text-[12.5px] leading-[18px] text-muted-foreground">{snippet}</span>}
        </button>
      </SwipeRow>
      <div className="pointer-events-none absolute right-3 top-2 z-[2] hidden items-center gap-0.5 rounded-full bg-surface p-0.5 opacity-0 shadow-sm ring-1 ring-border transition-opacity lg:flex lg:group-focus-within:pointer-events-auto lg:group-focus-within:opacity-100 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100">
        <RowAction icon={Trash2} label="Supprimer le brouillon" onClick={onDelete} danger />
      </div>
    </li>
  );
}
/** Brouillon proposé dans le dossier : Gmail (supprimable dans Gmail) ou gardé sur cet appareil. */
type DraftItem =
  | { kind: "gmail"; key: string; row: GmailDraftRow }
  | { kind: "reply"; key: string; box: MailBox; threadId: string; subject: string; to: string; email: string; text: string; at: number; contact?: string; name?: string }
  | { kind: "new"; key: string; subject: string; to: string; text: string; at: number };

export function Mails() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillH = useFillHeight(rootRef);
  const searchRef = useRef<HTMLInputElement>(null);
  const contactSearchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Créateurs reliés (alias talent@) ─────────────────────────────────────
  // Filtre « Par créateur » : ses échanges (talent@, son alias) avec statuts et remarques.
  // Tous les créateurs du Roster y sont : un créateur pas encore relié affiche
  // de quoi relier son adresse mail.
  const allCreators = useCreators();
  // `addresses` : toutes ses adresses (alias principal + adresses en plus), en minuscules.
  const [linked, setLinked] = useState<{ creator: string; alias: string | null; addresses: string[]; enabled: boolean }[]>([]);
  const [linkedTick, setLinkedTick] = useState(0);
  const [emailPro, setEmailPro] = useState<Map<string, string> | null>(null);
  const [creatorView, setCreatorView] = useState<{ name: string; threadId?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    // « * » : marche avant et après l'ajout de la colonne `aliases` (adresses en plus).
    void supabase.from("creator_mail_settings").select("*").then(({ data }) => {
      if (!alive) return;
      const rows = (data ?? []) as { creator: string; alias: string | null; aliases?: string[] | null; label_id: string | null; enabled: boolean }[];
      setLinked(rows
        .map((r) => ({ creator: r.creator, alias: r.alias, addresses: allAddresses(r.alias, r.aliases), label_id: r.label_id, enabled: r.enabled }))
        .filter((r) => r.addresses.length || r.label_id)
        .sort((a, b) => a.creator.localeCompare(b.creator)));
    });
    return () => {
      alive = false;
    };
  }, [linkedTick]);
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // Créateurs reliés d'abord, puis le reste du Roster actif.
  const creatorChoices = useMemo(() => {
    const names = linked.map((l) => l.creator);
    for (const c of allCreators) {
      if (c.status !== "inactif" && !names.some((n) => sameName(n, c.name))) names.push(c.name);
    }
    return names;
  }, [linked, allCreators]);
  // Pastilles : échanges à traiter par créateur relié (nouvelles demandes + messages non lus).
  // (relues seulement quand la page Mails est affichée : `rootRef`)
  const mailCount = useCreatorMailCounts(linked.map((l) => l.creator), { rootRef });
  const mailTotal = linked.reduce((sum, l) => sum + mailCount(l.creator), 0);
  // Adresse (alias ou adresse en plus) → créateur (avatar sur les lignes de talent@).
  const aliasOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of linked) for (const a of l.addresses) m.set(a, l.creator);
    return m;
  }, [linked]);
  const photoOf = (n: string) => allCreators.find((c) => sameName(c.name, n))?.photo_url ?? null;

  // ── Collabs actives, marques des contacts, suivi créateur ────────────────
  // Servent à l'encart « Collab liée » et aux étiquettes de la liste. Rien n'est
  // déduit sans ces données : sans correspondance, rien n'est affiché.
  const live = useLiveKey();
  const [collabs, setCollabs] = useState<CollabLite[]>(() => getCache<CollabLite[]>("mails:collabs") ?? []);
  const [brandIndex, setBrandIndex] = useState<BrandIndex | null>(null);
  const [cmRows, setCmRows] = useState<Map<string, { creator: string; status: string; brand: string | null }>>(() => new Map());
  const sideAsked = useRef(false);
  const sideSig = useRef({ collabs: "", cm: "" }); // pas de nouveau rendu si rien n'a changé
  useEffect(() => {
    // Relu au rythme de l'app, seulement quand la page Mails est affichée.
    if (sideAsked.current && !rootRef.current?.getClientRects().length) return;
    const first = !sideAsked.current;
    sideAsked.current = true;
    let alive = true;
    void supabase
      .from("collabs")
      .select("id, brand, creator, contact, title, deliverables, cachet, step, status, updated_at")
      .eq("status", "active")
      .then(({ data, error }) => {
        if (!alive || error) return; // table absente ou réseau : on garde ce qu'on a
        const rows = (data ?? []) as CollabLite[];
        const sig = JSON.stringify(rows);
        if (sig === sideSig.current.collabs) return;
        sideSig.current.collabs = sig;
        setCollabs(rows);
        setCache("mails:collabs", rows);
      });
    // Statut rangé à la main dans le suivi créateur (fils de talent@).
    void supabase
      .from("creator_mail_threads")
      .select("creator, thread_id, status, brand")
      .then(({ data, error }) => {
        if (!alive || error) return;
        const sig = JSON.stringify(data ?? []);
        if (sig === sideSig.current.cm) return;
        sideSig.current.cm = sig;
        const m = new Map<string, { creator: string; status: string; brand: string | null }>();
        for (const r of (data ?? []) as { creator: string; thread_id: string; status: string; brand: string | null }[]) {
          const cur = m.get(r.thread_id);
          const stored = (STORED_STATUSES as readonly string[]).includes(r.status);
          if (!cur || (stored && !(STORED_STATUSES as readonly string[]).includes(cur.status))) m.set(r.thread_id, { creator: r.creator, status: r.status, brand: r.brand });
        }
        setCmRows(m);
      });
    // Marques des contacts (adresse → marque) : une fois par visite, par pages de 1000.
    if (first) {
      void (async () => {
        const rows: { email: string | null; brand: string | null }[] = [];
        for (let from = 0; from < 10_000; from += 1000) {
          const { data, error } = await supabase.from("contacts").select("email, brand").not("brand", "is", null).order("id").range(from, from + 999);
          if (error) break; // on garde ce qui a été lu
          rows.push(...((data ?? []) as typeof rows));
          if ((data ?? []).length < 1000) break;
        }
        setBrandIndex(buildBrandIndex(rows));
      })();
    }
    return () => {
      alive = false;
    };
  }, [live]);

  // Créateur et collabs d'un fil de la liste (calculés une fois par fil).
  const rowInfo = useMemo(() => {
    const cache = new Map<string, { creator: string | null; collabs: CollabLite[] }>();
    return (t: InboxThread) => {
      const k = keyOf(t);
      const hit = cache.get(k);
      if (hit) return hit;
      const cm = t.box === "talent" ? cmRows.get(t.threadId) : undefined;
      const owner = (t.to ?? []).map((a) => aliasOwner.get(a.toLowerCase())).find(Boolean) ?? cm?.creator ?? null;
      const v = {
        creator: owner,
        collabs: matchCollabs({ emails: [t.email, ...(t.to ?? [])], creator: owner, text: `${t.subject} ${t.name}`, brands: [cm?.brand] }, brandIndex, collabs),
      };
      cache.set(k, v);
      return v;
    };
  }, [aliasOwner, cmRows, brandIndex, collabs]);
  /** Créateurs concernés par un fil : alias dans le fil, suivi créateur, ou collab unique. */
  const rowCreators = useCallback((t: InboxThread): string[] => {
    const i = rowInfo(t);
    const names = new Set<string>();
    if (i.creator) names.add(i.creator.trim().toLowerCase());
    if (i.collabs.length === 1 && i.collabs[0].creator) names.add(i.collabs[0].creator.trim().toLowerCase());
    return [...names];
  }, [rowInfo]);
  // Étiquettes d'un fil : étape de la collab liée, statut du suivi créateur, relance.
  const tagsOf = (t: InboxThread): MailTag[] => {
    const out: MailTag[] = [];
    const ct = collabTag(rowInfo(t).collabs);
    if (ct) out.push(ct);
    const cm = t.box === "talent" ? cmRows.get(t.threadId) : undefined;
    if (cm && (STORED_STATUSES as readonly string[]).includes(cm.status)) {
      const m = statusMeta(cm.status);
      out.push({ key: "suivi", label: m.label, cls: m.badge, title: `Suivi de ${titleCase(cm.creator)} : ${m.label}` });
    }
    const r = relanceDays(t);
    if (r != null) out.push({ key: "relance", label: `Relance J+${r}`, cls: "bg-wait-soft text-wait", title: `Dernier message envoyé par l'agence il y a ${r} jours, sans réponse depuis` });
    return out;
  };
  // Dossier de couleur choisi dans la colonne de gauche : filtre la liste sur un créateur.
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const creatorKey = creatorFilter?.trim().toLowerCase() ?? null;

  // ── Dossier et boîte ─────────────────────────────────────────────────────
  const [mode, setModeState] = useState<Mode>(() => readPref("ttp:mails-mode", MODES.map((m) => m.id), "inbox"));
  const folder: Folder = mode === "sent" ? "sent" : "inbox";
  // Boîte affichée : un simple filtre (les deux boîtes sont chargées ensemble).
  const [box, setBoxState] = useState<"all" | MailBox>(() => readPref("ttp:mails-box", ["all", "partnerships", "talent"] as const, "all"));
  const setBox = (v: "all" | MailBox) => {
    setBoxState(v);
    writePref("ttp:mails-box", v);
  };

  // Adresse pro des créateurs (suggestion d'alias), seulement pour le dossier Créateurs.
  useEffect(() => {
    if (mode !== "creators" || emailPro) return;
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
  }, [mode, emailPro]);

  // Retour de la reconnexion Google lancée depuis cette page.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("ttp:mails-reconnect")) return;
      sessionStorage.removeItem("ttp:mails-reconnect");
    } catch {
      return;
    }
    const r = consumeOAuthReturn();
    if (r.justConnected) toast("Google reconnecté ✓");
    else if (r.error) toast("Échec de la connexion Google, réessaie");
  }, []);
  const reconnectGoogle = async () => {
    try {
      sessionStorage.setItem("ttp:mails-reconnect", "1");
    } catch {
      /* stockage indisponible */
    }
    try {
      await connectGoogle();
    } catch {
      toast("Impossible de démarrer la connexion Google");
    }
  };

  // ── Listes (reçus / envoyés), les deux boîtes ensemble, en cache ─────────
  const [lists, setLists] = useState<Record<Folder, ListState | null>>(() => ({
    inbox: getCache<ListState>("mails:list:inbox"),
    sent: getCache<ListState>("mails:list:sent"),
  }));
  useEffect(() => {
    setCache("mails:list:inbox", lists.inbox);
    setCache("mails:list:sent", lists.sent);
  }, [lists]);
  const [listBusy, setListBusy] = useState<Record<Folder, boolean>>({ inbox: false, sent: false });
  const [listErr, setListErr] = useState<Record<Folder, string | null>>({ inbox: null, sent: null });
  const [moreBusy, setMoreBusy] = useState(false);
  const listReq = useRef<Record<Folder, number>>({ inbox: 0, sent: 0 });
  const lastLoad = useRef<Record<Folder, number>>({ inbox: 0, sent: 0 });

  // Changements affichés avant confirmation (lu / non lu, archivé, corbeille).
  const [overrides, setOverrides] = useState<Map<string, Override>>(() => new Map(pendingOv));
  useEffect(() => {
    pendingOv.clear();
    for (const [k, o] of overrides) pendingOv.set(k, o);
  }, [overrides]);
  const putOv = (key: string, o: Override) => setOverrides((m) => new Map(m).set(key, o));
  const dropOv = (key: string, at: number) =>
    setOverrides((m) => {
      if (m.get(key)?.at !== at) return m;
      const n = new Map(m);
      n.delete(key);
      return n;
    });
  const doneOv = (key: string, at: number) =>
    setOverrides((m) => {
      const o = m.get(key);
      return o && o.at === at ? new Map(m).set(key, { ...o, done: Date.now() }) : m;
    });

  const refreshList = useCallback(async (f: Folder) => {
    const id = ++listReq.current[f];
    const started = Date.now();
    setListBusy((b) => ({ ...b, [f]: true }));
    const res = await invokeJson<ListRes>("gmail-history", { inbox: true, box: "all", folder: f });
    if (id !== listReq.current[f]) return; // une actualisation plus récente est en cours
    lastLoad.current[f] = Date.now();
    setListBusy((b) => ({ ...b, [f]: false }));
    if (!res.ok) {
      // La liste affichée reste en place : bandeau d'erreur + « Réessayer ».
      setListErr((e) => ({ ...e, [f]: res.error ?? "erreur" }));
      return;
    }
    setListErr((e) => ({ ...e, [f]: null }));
    setLists((prev) => ({ ...prev, [f]: mergeList(prev[f], res) }));
    // Un changement confirmé n'est retiré que quand une liste DEMANDÉE APRÈS lui le
    // montre aussi (Gmail met quelques secondes à se mettre à jour, et une actualisation
    // partie avant le clic revient avec l'ancien état : « lu » repassait en « non lu »).
    // Au-delà de 90 s, la liste du serveur fait foi (ex. nouveau message dans le fil).
    const freshRows = new Map((res.threads ?? []).map((t) => [keyOf(t), t]));
    setOverrides((m) => {
      let n: Map<string, Override> | null = null;
      for (const [k, o] of m) {
        if (!o.done || started < o.done + 3_000) continue;
        const row = freshRows.get(k);
        if (!row && f !== "inbox") continue; // fil d'un autre dossier : jugé par sa propre liste
        const agrees = o.reply
          ? !row || row.ts > o.reply.ts || (row.direction === "out" && row.ts >= o.reply.ts - 120_000)
          : o.hidden ? !row || (f === "inbox" && o.hidden === "archive" && row.archived === true) : !row || row.unread === o.unread;
        if (agrees || started > o.done + OV_TRUST_MS) {
          n ??= new Map(m);
          n.delete(k);
        }
      }
      return n ?? m;
    });
  }, []);
  // Ouverture et changement de dossier : liste en cache tout de suite, actualisée en fond.
  useEffect(() => {
    void refreshList(folder);
  }, [folder, refreshList]);

  // Modifie les fils connus (listes + résultats de recherche).
  const [search, setSearch] = useState<SearchState | null>(null);
  const patchThreads = (fn: (t: InboxThread) => InboxThread | null) => {
    const map = (l: InboxThread[]) => l.map(fn).filter((x): x is InboxThread => !!x);
    setLists((p) => ({
      inbox: p.inbox && { ...p.inbox, threads: map(p.inbox.threads) },
      sent: p.sent && { ...p.sent, threads: map(p.sent.threads) },
    }));
    setSearch((s) => s && { ...s, threads: map(s.threads) });
  };
  const applyOv = useCallback(
    (t: InboxThread): InboxThread | null => {
      const o = overrides.get(keyOf(t));
      if (!o) return t;
      if (o.hidden) return null;
      let r = o.unread !== undefined && o.unread !== t.unread ? { ...t, unread: o.unread } : t;
      // Notre réponse est plus récente que ce que la liste connaît : elle devient le dernier message.
      // Un message reçu APRÈS notre réponse (t.ts plus récent) reprend la main.
      if (o.reply && t.ts <= o.reply.ts) r = { ...r, direction: "out", snippet: o.reply.snippet, ts: o.reply.ts, unread: false, count: t.direction === "out" && t.ts >= o.reply.ts - 5_000 ? t.count : t.count + 1 };
      return r;
    },
    [overrides],
  );
  const effList = (l: InboxThread[] | undefined) => (l ?? []).map(applyOv).filter((x): x is InboxThread => !!x);

  // Non lus par boîte (pastilles), d'après la boîte de réception chargée.
  const inboxEff = useMemo(() => effList(lists.inbox?.threads), [lists.inbox, applyOv]); // eslint-disable-line react-hooks/exhaustive-deps
  const unreadBy = useMemo(() => {
    const c = { all: 0, partnerships: 0, talent: 0 };
    for (const t of inboxEff) {
      if (!t.unread) continue;
      c.all++;
      c[t.box]++;
    }
    return c;
  }, [inboxEff]);
  const unreadShown = unreadBy[box];
  // Non lus par créateur (dossiers de couleur), d'après la boîte de réception chargée.
  const creatorUnread = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of inboxEff) {
      if (!t.unread || (box !== "all" && t.box !== box)) continue;
      for (const n of rowCreators(t)) m.set(n, (m.get(n) ?? 0) + 1);
    }
    return m;
  }, [inboxEff, box, rowCreators]);

  // ── Recherche : filtre local immédiat + recherche Gmail (350 ms, ≥ 2 caractères) ──
  const [inboxQuery, setInboxQuery] = useState("");
  const [searchTick, setSearchTick] = useState(0);
  const searchReq = useRef(0);
  const baseKeys = useRef<Record<Folder, Set<string>>>({ inbox: new Set(), sent: new Set() });
  baseKeys.current = {
    inbox: new Set((lists.inbox?.threads ?? []).map(keyOf)),
    sent: new Set((lists.sent?.threads ?? []).map(keyOf)),
  };
  useEffect(() => {
    const q = inboxQuery.trim();
    if (q.length < 2 || Date.now() - searchOldAt < OLD_RETRY_MS) {
      searchReq.current++;
      setSearch(null);
      return;
    }
    const f = folder;
    const timer = window.setTimeout(async () => {
      const id = ++searchReq.current;
      setSearch({ q, folder: f, threads: [], busy: true, err: null, off: false });
      const res = await invokeJson<ListRes>("gmail-history", { inbox: true, box: "all", folder: f, q: q.slice(0, 200) });
      if (id !== searchReq.current) return;
      if (!res.ok) return setSearch({ q, folder: f, threads: [], busy: false, err: res.error ?? "erreur", off: false });
      const threads = res.threads ?? [];
      // Ancienne version : `q` ignoré, la boîte de réception revient telle quelle.
      const noKey = !("nextPageTokens" in res);
      const noV2 = threads.length > 0 && threads.every((x) => x.archived === undefined);
      const base = baseKeys.current[f];
      const same = threads.length > 0 && threads.length >= Math.min(base.size, 20) && threads.every((x) => base.has(keyOf(x)));
      const old = noKey && (noV2 || same);
      if (old && noV2) searchOldAt = Date.now();
      setSearch({ q, folder: f, threads: old ? [] : threads, busy: false, err: null, off: old });
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, [inboxQuery, folder, searchTick]);

  // ── Contacts (chargés à la première ouverture du dossier Contacts) ───────
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("__all__"); // filtre par niche/tag
  const [contactFilter, setContactFilter] = useStickyState("mails:echange", ["all", "contacted", "never"] as const, "all"); // déjà échangé ?
  const [selected, setSelected] = useState<Contact | null>(null);
  const contactsAsked = useRef(false);
  useEffect(() => {
    if (mode !== "contacts" || contactsAsked.current) return;
    contactsAsked.current = true;
    void supabase
      .from("contacts")
      .select("id, brand, person, first_name, last_name, email, tag, last_contacted, touches")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) {
          contactsAsked.current = false;
          setContacts([]);
          return toast("Contacts indisponibles, réessaie");
        }
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
  }, [mode]);

  // Historique du contact sélectionné.
  const [history, setHistory] = useState<MailMsg[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyPartial, setHistoryPartial] = useState<{ boxes: MailBox[] } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  useEffect(() => {
    setHistory(null);
    setHistoryErr(null);
    setHistoryPartial(null);
    const email = selected?.email?.toLowerCase();
    if (!email) return;
    let alive = true;
    setHistoryBusy(true);
    (async () => {
      // Gmail (fils réels) + email_activity (envois Resend / media kit non présents dans Gmail).
      const [res, act] = await Promise.all([
        // Toujours les DEUX boîtes : le choix de boîte filtre ensuite l'affichage.
        invokeJson<{ ok?: boolean; messages?: MailMsg[]; error?: string; partial?: boolean; failedBoxes?: string[] }>("gmail-history", { contact: email, box: "all" }),
        supabase
          .from("email_activity")
          .select("subject,snippet,direction,source,created_at,thread_id,gmail_message_id")
          .eq("contact_email", email)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (!alive) return;
      // Erreur (réseau compris) : un état d'erreur, jamais « Aucun échange ».
      if (!res.ok) setHistoryErr(res.error ?? "erreur");
      if (res.partial) setHistoryPartial({ boxes: (res.failedBoxes ?? []).filter((b): b is MailBox => b === "partnerships" || b === "talent") });
      const gmail = res.ok ? res.messages ?? [] : [];
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
  }, [selected, historyTick]);

  // ── Fil ouvert ───────────────────────────────────────────────────────────
  const [thread, setThread] = useState<OpenThread | null>(null);
  const threadRef = useRef<OpenThread | null>(null);
  threadRef.current = thread;
  const [threadMsgs, setThreadMsgs] = useState<ThreadMsg[] | null>(null);
  const [threadErr, setThreadErr] = useState<string | null>(null);
  const threadReq = useRef(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // messages dépliés du fil
  const [showAllMsgs, setShowAllMsgs] = useState(false); // « N messages plus anciens »
  const [replyFocus, setReplyFocus] = useState<{ key: number; mode: "reply" | "all" }>({ key: 0, mode: "reply" });
  const [forward, setForward] = useState<{ msg: MailMessage; subject: string; box: MailBox } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newMailOpen, setNewMailOpen] = useState(false); // mail libre, n'importe quelle adresse
  const [newMailKey, setNewMailKey] = useState(0); // fenêtre flottante : ré-agrandie à chaque demande
  const openNewMail = () => {
    setNewMailDraft(null);
    setNewMailOpen(true);
    setNewMailKey((n) => n + 1);
  };
  const [composerOpen, setComposerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null); // ligne choisie au clavier (j / k)
  const draftSet = useDeviceDraftKeys(); // réponses (« reply:… ») et nouveau mail (« new ») sur cet appareil
  // Brouillon Gmail ouvert dans « Nouveau mail » (null = mail libre).
  const [newMailDraft, setNewMailDraft] = useState<GmailDraftRow | null>(null);

  // ── Brouillons Gmail (dossier « Brouillons ») ────────────────────────────
  const [drafts, setDrafts] = useState<DraftsState | null>(() => getCache<DraftsState>("mails:drafts"));
  useEffect(() => {
    setCache("mails:drafts", drafts);
  }, [drafts]);
  const [draftsBusy, setDraftsBusy] = useState(false);
  const [draftsErr, setDraftsErr] = useState<string | null>(null);
  const draftsReq = useRef(0);
  const draftsAt = useRef(0); // dernière demande de la liste
  const refreshDrafts = useCallback(async (force = false) => {
    // Ancienne version déployée : on ne redemande qu'après 10 min (ou à la demande).
    if (!force && Date.now() - draftsOldAt < OLD_RETRY_MS) return;
    const id = ++draftsReq.current;
    draftsAt.current = Date.now();
    setDraftsBusy(true);
    const p = parseDraftsRes(await invokeJson<DraftsRes>("gmail-history", { inbox: true, box: "all", folder: "drafts" }));
    if (id !== draftsReq.current) return;
    setDraftsBusy(false);
    if (p.kind === "error") return setDraftsErr(p.error);
    setDraftsErr(null);
    if (p.kind === "old") {
      draftsOldAt = Date.now();
      return setDrafts({ rows: [], partial: false, failedBoxes: [], old: true });
    }
    draftsOldAt = 0;
    // Boîte qui n'a pas répondu : ses brouillons déjà affichés restent.
    setDrafts((prev) => {
      const kept = (prev?.rows ?? []).filter((r) => p.failedBoxes.includes(r.box));
      return { rows: [...p.rows, ...kept].sort((a, b) => b.ts - a.ts), partial: p.partial, failedBoxes: p.failedBoxes, old: false };
    });
  }, []);
  // Brouillons Gmail retirés tout de suite (envoyés ou supprimés), en attendant la liste du serveur.
  const [goneDrafts, setGoneDrafts] = useState<Set<string>>(() => new Set());
  const gmailDraftRows = useMemo(() => (drafts?.rows ?? []).filter((r) => !goneDrafts.has(`${r.box}:${r.draftId}`)), [drafts, goneDrafts]);
  // Fils qui ont une réponse en brouillon dans Gmail (marque « Brouillon » dans la liste, encart dans le fil).
  const gmailReplyDrafts = useMemo(() => {
    const m = new Map<string, GmailDraftRow>();
    for (const r of gmailDraftRows) if (isReplyDraft(r) && !m.has(tkey(r.box, r.threadId))) m.set(tkey(r.box, r.threadId), r);
    return m;
  }, [gmailDraftRows]);

  const applyMsgs = (msgs: ThreadMsg[]) => {
    setThreadMsgs(msgs);
    // Dernier message déplié, les précédents repliés (comme Gmail).
    setExpanded(new Set(msgs.length ? [msgs[msgs.length - 1].id] : []));
  };
  const loadThread = async (t: OpenThread, id: number) => {
    const res = await invokeJson<ThreadRes>("gmail-thread", { threadId: t.threadId, contact: t.contact, box: t.box });
    if (id !== threadReq.current) return; // un autre fil a été ouvert entre-temps
    if (!res.ok) return setThreadErr(res.error ?? "erreur");
    const msgs = shownMsgs(res);
    threadCache.set(tkey(t.box, t.threadId), { at: Date.now(), msgs });
    applyMsgs(msgs);
    // Fil ouvert depuis une notification : l'objet n'était pas encore connu.
    if (!t.subject && msgs[0]?.subject) {
      setThread((cur) => (cur && keyOf(cur) === keyOf(t) && !cur.subject ? { ...cur, subject: msgs[0].subject } : cur));
    }
  };
  const retryThread = () => {
    if (!thread) return;
    setThreadErr(null);
    setThreadMsgs(null);
    void loadThread(thread, ++threadReq.current);
  };

  // Défilement de la liste (téléphone, tablette) : retrouvé en fermant un mail.
  const listScroll = useRef<number | null>(null);
  const closeThread = () => {
    threadReq.current++;
    setThread(null);
    setThreadMsgs(null);
    setThreadErr(null);
  };
  useLayoutEffect(() => {
    if (thread || listScroll.current == null) return;
    const sc = scrollParent(rootRef.current);
    if (sc) sc.scrollTop = listScroll.current;
    listScroll.current = null;
  }, [thread]);

  // Lu / non lu, archiver : via gmail-thread `action`, gardé seulement si le serveur renvoie `action`.
  const callAction = async (t: Target, action: "read" | "unread" | "archive" | "unarchive"): Promise<"ok" | "old" | string> => {
    const res = await invokeJson<ActionRes>("gmail-thread", { threadId: t.threadId, box: t.box, action });
    if (res.ok && res.action === action) return "ok";
    if (res.ok) {
      actionsOldAt = Date.now(); // ancienne version : elle a lu le fil sans rien modifier
      return "old";
    }
    return res.error ?? "erreur";
  };
  const allKnown = () => [...(lists.inbox?.threads ?? []), ...(lists.sent?.threads ?? []), ...(search?.threads ?? [])];
  const findRow = (key: string) => {
    const row = allKnown().find((t) => keyOf(t) === key);
    return row ? applyOv(row) : null;
  };
  const markRead = (t: Target) => {
    const key = keyOf(t);
    if (!findRow(key)?.unread || Date.now() - actionsOldAt < OLD_RETRY_MS) return;
    const at = Date.now();
    putOv(key, { unread: false, at });
    void callAction(t, "read").then((r) => {
      if (r !== "ok") return dropOv(key, at); // ancienne version ou erreur : reste non lu, sans message
      patchThreads((x) => (keyOf(x) === key ? { ...x, unread: false } : x));
      doneOv(key, at);
      invalidateMailUnread();
    });
  };
  const setRead = async (t: Target, unread: boolean) => {
    const key = keyOf(t);
    const at = Date.now();
    putOv(key, { unread, at });
    const cur = threadRef.current;
    if (unread && cur && keyOf(cur) === key) closeThread(); // comme Gmail : retour à la liste
    const r = await callAction(t, unread ? "unread" : "read");
    if (r === "ok") {
      patchThreads((x) => (keyOf(x) === key ? { ...x, unread } : x));
      invalidateMailUnread();
      return doneOv(key, at);
    }
    dropOv(key, at);
    toast(r === "old" ? OLD_SERVER_TEXT : actionErrText(r));
  };

  const openThread = (m: OpenRef) => {
    const contact = (m.contact ?? selected?.email ?? "").toLowerCase();
    const t: OpenThread = { contact, name: m.name ?? selected?.person ?? "", subject: m.subject, threadId: m.threadId, box: m.box };
    // Téléphone : on retient où on était dans la liste, et le mail s'ouvre en haut.
    if (!isWide()) {
      const sc = scrollParent(rootRef.current);
      if (sc) {
        if (!threadRef.current) listScroll.current = sc.scrollTop;
        sc.scrollTop = 0;
      }
    }
    setThread(t);
    setThreadErr(null);
    setShowAllMsgs(false);
    setReplyFocus({ key: 0, mode: "reply" }); // la zone de réponse du nouveau fil ne prend pas le focus
    setCursor(keyOf(t));
    const id = ++threadReq.current;
    const cached = threadCache.get(keyOf(t));
    if (cached && Date.now() - cached.at < THREAD_TTL) applyMsgs(cached.msgs);
    else {
      setThreadMsgs(null);
      void loadThread(t, id);
    }
    markRead({ threadId: t.threadId, box: t.box, subject: t.subject });
  };

  // ── Liste affichée (filtre de boîte + recherche) et navigation ───────────
  const folderList = useMemo(() => effList(lists[folder]?.threads), [lists, folder, applyOv]); // eslint-disable-line react-hooks/exhaustive-deps
  // « Non lus » : les fils non lus, plus ceux qui l'étaient quand on a activé le filtre
  // (un mail ouvert ne disparaît pas de la liste pendant qu'on le lit).
  const [unreadOnly, setUnreadOnly] = useState<Set<string> | null>(null);
  const boxAll = useMemo(
    () => folderList.filter((t) => (box === "all" || t.box === box) && (!creatorKey || rowCreators(t).includes(creatorKey))),
    [folderList, box, creatorKey, rowCreators],
  );
  const boxThreads = useMemo(
    () => (unreadOnly && folder === "inbox" ? boxAll.filter((t) => t.unread || unreadOnly.has(keyOf(t))) : boxAll),
    [boxAll, unreadOnly, folder],
  );
  const unreadHere = useMemo(() => boxAll.filter((t) => t.unread).length, [boxAll]);
  const toggleUnread = () => setUnreadOnly((cur) => (cur ? null : new Set(boxAll.filter((t) => t.unread).map(keyOf))));
  const inboxQ = inboxQuery.trim().toLowerCase();
  const localMatches = useMemo(
    () => (inboxQ ? boxThreads.filter((t) => `${t.name} ${t.email} ${t.subject} ${decodeEntities(t.snippet)}`.toLowerCase().includes(inboxQ)) : boxThreads),
    [boxThreads, inboxQ],
  );
  const searchLive = !!search && search.q === inboxQuery.trim() && search.folder === folder;
  const remote = useMemo(() => {
    if (!searchLive || !search) return [];
    const local = new Set(localMatches.map(keyOf));
    return effList(search.threads).filter((t) => (box === "all" || t.box === box) && (!creatorKey || rowCreators(t).includes(creatorKey)) && !local.has(keyOf(t)));
  }, [searchLive, search, localMatches, box, applyOv, creatorKey, rowCreators]); // eslint-disable-line react-hooks/exhaustive-deps

  // « 3 sur 12 » ‹ › : les fils de la liste d'où le mail a été ouvert.
  const navList = useMemo<OpenRef[]>(() => {
    if (mode === "contacts" && selected) {
      const seen = new Set<string>();
      const out: OpenRef[] = [];
      for (const m of history ?? []) {
        const b = m.box ?? "partnerships";
        if (!m.threadId || seen.has(tkey(b, m.threadId))) continue;
        seen.add(tkey(b, m.threadId));
        out.push({ threadId: m.threadId, subject: m.subject, box: b, contact: selected.email });
      }
      return out;
    }
    return [...localMatches, ...remote].map((t) => ({ threadId: t.threadId, subject: t.subject, box: t.box, contact: t.email, name: t.name }));
  }, [mode, selected, history, localMatches, remote]);
  const navIdx = thread ? navList.findIndex((n) => keyOf(n) === keyOf(thread)) : -1;

  // Fil suivant préchargé quand le navigateur est libre.
  useEffect(() => {
    if (!thread || !threadMsgs || navIdx < 0) return;
    const next = navList[navIdx + 1];
    if (!next) return;
    const key = keyOf(next);
    const c = threadCache.get(key);
    if ((c && Date.now() - c.at < THREAD_TTL) || prefetching.has(key)) return;
    const run = () => {
      prefetching.add(key);
      void invokeJson<ThreadRes>("gmail-thread", { threadId: next.threadId, contact: (next.contact ?? "").toLowerCase(), box: next.box }).then((r) => {
        prefetching.delete(key);
        if (r.ok) threadCache.set(key, { at: Date.now(), msgs: shownMsgs(r) });
      });
    };
    // requestIdleCallback absent sur Safari : petit délai à la place.
    const w = window as Window & { requestIdleCallback?: Window["requestIdleCallback"] };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(h);
    }
    const h = window.setTimeout(run, 1200);
    return () => window.clearTimeout(h);
  }, [thread, threadMsgs, navIdx, navList]);

  // ── Archiver / corbeille (optimiste, annulable 10 s) ─────────────────────
  const [undo, setUndo] = useState<UndoState | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo((u) => (u === undo ? null : u)), 10_000);
    return () => window.clearTimeout(t);
  }, [undo]);
  // Le fil retiré est ouvert : on passe au suivant (ou au précédent, sinon on ferme).
  const leave = (t: Target) => {
    const cur = threadRef.current;
    if (!cur || keyOf(cur) !== keyOf(t)) return;
    const i = navList.findIndex((n) => keyOf(n) === keyOf(t));
    const next = i >= 0 ? navList[i + 1] ?? navList[i - 1] : null;
    if (next) openThread(next);
    else closeThread();
  };
  const removeRows = (key: string) => patchThreads((x) => (keyOf(x) === key ? null : x));
  const archive = (t: Target) => {
    const key = keyOf(t);
    const at = Date.now();
    const row = allKnown().find((x) => keyOf(x) === key) ?? null;
    leave(t);
    putOv(key, { hidden: "archive", at });
    const done = callAction(t, "archive").then((r) => {
      if (r === "ok") {
        removeRows(key);
        threadCache.delete(key);
        doneOv(key, at);
        return true;
      }
      dropOv(key, at);
      setUndo((u) => (u?.at === at ? null : u));
      toast(r === "old" ? `Archiver : ${OLD_SERVER_TEXT.charAt(0).toLowerCase()}${OLD_SERVER_TEXT.slice(1)}` : actionErrText(r));
      return false;
    });
    setUndo({ kind: "archive", t, row, folder, done, at });
  };
  const trash = (t: Target) => {
    const key = keyOf(t);
    const at = Date.now();
    const row = allKnown().find((x) => keyOf(x) === key) ?? null;
    leave(t);
    putOv(key, { hidden: "trash", at });
    // Corbeille Gmail (récupérable 30 jours), jamais de suppression définitive.
    const done = invokeJson<{ ok?: boolean; error?: string }>("gmail-trash", { threadId: t.threadId, box: t.box }).then((res) => {
      if (res.ok) {
        removeRows(key);
        threadCache.delete(key);
        setHistory((l) => l?.filter((x) => x.threadId !== t.threadId) ?? l);
        doneOv(key, at);
        return true;
      }
      dropOv(key, at);
      setUndo((u) => (u?.at === at ? null : u));
      toast(trashErrorText(res.error, t.box));
      return false;
    });
    setUndo({ kind: "trash", t, row, folder, done, at });
  };
  const undoLast = async () => {
    const u = undo;
    if (!u) return;
    setUndo(null);
    if (!(await u.done)) return;
    let ok = false;
    let err: string | undefined;
    if (u.kind === "trash") {
      const res = await invokeJson<{ ok?: boolean; error?: string }>("gmail-trash", { threadId: u.t.threadId, box: u.t.box, undo: true });
      ok = !!res.ok;
      err = res.error;
    } else {
      const r = await callAction(u.t, "unarchive");
      ok = r === "ok";
      err = r === "old" ? undefined : r;
    }
    if (!ok) return toast(u.kind === "trash" ? trashErrorText(err, u.t.box) : actionErrText(err));
    // Le fil revient tout de suite dans la liste d'où il venait.
    const key = keyOf(u.t);
    setOverrides((m) => {
      if (!m.has(key)) return m;
      const n = new Map(m);
      n.delete(key);
      return n;
    });
    if (u.row) {
      const row = { ...u.row, archived: false };
      setLists((p) => {
        const l = p[u.folder];
        if (!l || l.threads.some((x) => keyOf(x) === key)) return p;
        return { ...p, [u.folder]: { ...l, threads: [...l.threads, row].sort((a, b) => b.ts - a.ts) } };
      });
    }
    toast(u.kind === "trash" ? "Mail restauré ✓" : "Mail remis dans la boîte de réception ✓");
    void refreshList(u.folder);
    if (u.kind === "trash" && selected) setHistoryTick((n) => n + 1);
  };

  // ── « Charger plus » (pages suivantes de Gmail) ──────────────────────────
  const cur = lists[folder];
  const canMore = !inboxQ && hasTokens(cur?.next, box);
  const loadMore = async () => {
    const l = lists[folder];
    if (!l?.next || moreBusy) return;
    const f = folder;
    const boxes: MailBox[] = box === "all" ? (["partnerships", "talent"] as MailBox[]).filter((b) => l.next?.[b]) : [box];
    const tokens: PageTokens = {};
    for (const b of boxes) if (l.next[b]) tokens[b] = l.next[b];
    if (!Object.keys(tokens).length) return;
    setMoreBusy(true);
    const res = await invokeJson<ListRes>("gmail-history", { inbox: true, box: boxes.length > 1 ? "all" : boxes[0], folder: f, pageTokens: tokens });
    setMoreBusy(false);
    if (!res.ok) return toast(loadErrText(res.error, "Impossible de charger la suite, réessaie"));
    setLists((p) => {
      const pl = p[f];
      if (!pl) return p;
      const seen = new Set(pl.threads.map(keyOf));
      const add = (res.threads ?? []).filter((t) => !seen.has(keyOf(t)));
      const next: PageTokens = { ...pl.next };
      for (const b of Object.keys(tokens) as MailBox[]) {
        const tok = res.nextPageTokens?.[b];
        if (tok) next[b] = tok;
        else delete next[b];
      }
      return { ...p, [f]: { ...pl, threads: [...pl.threads, ...add].sort((a, b) => b.ts - a.ts), next, pages: pl.pages + 1 } };
    });
  };

  // ── Coup d'œil toutes les 60 s (page visible) + au retour sur la fenêtre ─
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    let alive = true;
    let lastCheck = 0;
    const visible = () => document.visibilityState === "visible" && !!rootRef.current?.getClientRects().length;
    const fullIfStale = (ms: number) => {
      const f = folderRef.current;
      if (Date.now() - lastLoad.current[f] >= ms) void refreshList(f);
    };
    const check = async () => {
      if (!alive || !visible()) return;
      lastCheck = Date.now();
      // Ancienne version (coup d'œil inconnu) : liste complète toutes les 2 min.
      if (peekOff) return fullIfStale(110_000);
      const res = await invokeJson<PeekRes>("gmail-history", { peek: true, box: "all" });
      if (!alive) return;
      if (!res.ok || !res.boxes) {
        if (res.error === "contact_invalide" || (res.ok && !res.boxes)) {
          peekOff = true;
          fullIfStale(110_000);
        }
        return; // coupure réseau : on réessaiera au prochain tour
      }
      const sig = Object.entries(res.boxes).map(([b, v]) => `${b}:${v?.historyId ?? ""}`).sort().join("|");
      if (peekSig && sig !== peekSig) {
        void refreshList(folderRef.current);
        if (modeRef.current === "drafts") void refreshDrafts(); // un brouillon créé (Claude, Gmail) change aussi l'historique
      }
      peekSig = sig;
    };
    const first = window.setTimeout(() => void check(), 4000);
    const iv = window.setInterval(() => void check(), 60_000);
    const onFocus = () => {
      if (!visible()) return;
      if (peekOff) fullIfStale(30_000);
      else if (Date.now() - lastCheck > 15_000) void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshList, refreshDrafts]);

  // ── Dossiers ─────────────────────────────────────────────────────────────
  const setMode = (m: Mode) => {
    setModeState(m);
    writePref("ttp:mails-mode", m);
  };
  const goMode = (m: Mode) => {
    if (m !== mode) closeThread();
    setCreatorFilter(null); // un dossier (Réception, Envoyés…) montre tous ses mails
    setMode(m);
    if (m !== "contacts") setSelected(null);
    if (m === "creators" && mode === "creators") setCreatorView(null);
  };
  const openCreator = (name: string, threadId?: string) => {
    setCreatorView({ name, threadId });
    setMode("creators");
  };
  // Notification d'un nouveau mail (src/lib/deepLink.ts) : ouvre la Réception sur ce
  // fil, même avant que la liste soit chargée (l'objet arrive avec le fil).
  useIntent("mail:open", (data) => {
    let want: { thread?: unknown; box?: unknown } = {};
    try {
      want = JSON.parse(data ?? "{}") as typeof want;
    } catch {
      return;
    }
    if (mode !== "inbox") goMode("inbox");
    const threadId = typeof want.thread === "string" ? want.thread : "";
    if (!threadId) return;
    const box: MailBox = want.box === "talent" ? "talent" : "partnerships";
    const known = [...(lists.inbox?.threads ?? []), ...(lists.sent?.threads ?? [])].find((t) => t.threadId === threadId && t.box === box);
    openThread({ threadId, box, subject: known?.subject ?? "", contact: known?.email ?? "", name: known?.name ?? "" });
  });
  // Dossier de couleur d'un créateur : filtre la liste (reçus ou envoyés) ; second clic, tout revient.
  const pickCreator = (name: string) => {
    const on = !!creatorFilter && sameName(creatorFilter, name);
    if (mode !== "inbox" && mode !== "sent") {
      closeThread();
      setSelected(null);
      setMode("inbox");
    }
    setCreatorFilter(on ? null : name);
  };
  // « Ouvrir la collab » : page Collabs, filtrée sur la marque (recherche de l'app).
  const { setQuery: setAppQuery } = useSearch();
  const openCollab = (c: CollabLite) => {
    setAppQuery(c.brand);
    window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "collabs" }));
  };

  // ── Réponse ──────────────────────────────────────────────────────────────
  const firstName = (n: string) => titleCase(n).split(" ")[0] || titleCase(n);
  // Réactions emoji : pastilles sous le message visé, retirées du fil (comme Gmail).
  const split = useMemo(() => splitReactions(threadMsgs ?? []), [threadMsgs]);
  // Réactions envoyées depuis cet écran, en attendant que Gmail les renvoie dans le fil.
  const [myReacts, setMyReacts] = useState<Map<string, string[]>>(() => new Map());
  const threadKey = thread ? keyOf(thread) : "";
  useEffect(() => setMyReacts(new Map()), [threadKey]);
  const pillsOf = (id: string): ReactionPill[] => {
    const list = (split.pills.get(id) ?? []).map((p) => ({ ...p }));
    for (const e of myReacts.get(id) ?? []) {
      const same = list.find((p) => p.emoji === e);
      if (same?.mine) continue;
      if (same) {
        same.mine = true;
        same.count += 1;
      } else list.push({ emoji: e, who: "Toi", mine: true, count: 1 });
    }
    return list;
  };
  const sendReaction = (msgId: string, emoji: string) => {
    const t = thread;
    const m = (threadMsgs ?? []).find((x) => x.id === msgId);
    if (!t || !m) return;
    const { to, cc } = reactionRecipients(m, AGENCY_DOMAIN.slice(1));
    const mark = (on: boolean) =>
      setMyReacts((prev) => {
        const next = new Map(prev);
        const cur = (next.get(msgId) ?? []).filter((e) => e !== emoji);
        next.set(msgId, on ? [...cur, emoji] : cur);
        return next;
      });
    mark(true);
    scheduleSend(`Réaction ${emoji}`, 5, async () => {
      const name = await myDisplayName().catch(() => "");
      const res = await sendGmail({
        to, cc, subject: t.subject, html: "", threadId: t.threadId, source: "manual", box: t.box,
        inReplyTo: m.messageIdHeader, references: [m.references?.trim(), m.messageIdHeader?.trim()].filter(Boolean).join(" ").slice(-1900) || undefined,
        reaction: { emoji, name: name || "TTP Creators" },
      });
      if (!res.ok || res.reaction !== emoji) {
        mark(false);
        toast(reactionErrorText(res.ok ? "ancienne_version" : res.error));
        return;
      }
      threadCache.delete(keyOf(t));
    }, { onCancel: () => mark(false) });
  };
  // Fil → format du lecteur partagé (messages envoyés = agence).
  const readerMsgs: MailMessage[] = useMemo(
    () =>
      split.shown.map((m) => ({
        id: m.id,
        from: displayName(m.from),
        fromEmail: addrOf(m.from),
        fromAgency: m.direction === "out",
        to: m.to ?? "",
        cc: m.cc ?? "",
        ts: m.ts || new Date(m.date).getTime(),
        html: m.html,
        text: m.html ? "" : m.text,
        attachments: m.attachments ?? [],
      })),
    [split],
  );
  const plan = useMemo(() => replyPlan(split.shown, thread?.contact ?? ""), [split, thread]);
  const replyName = thread
    ? plan.to === thread.contact
      ? titleCase(prettyName(selected?.person || thread.name || displayName(thread.contact))) || plan.to
      : plan.to
    : "";
  // Échange de talent@ qui concerne un créateur relié (son alias y apparaît) :
  // lien direct vers son suivi (statut, remarques).
  const threadCreator = useMemo(() => {
    if (!thread || thread.box !== "talent" || !linked.length) return null;
    const addrs = new Set((threadMsgs ?? []).flatMap((m) => addrsOf(`${m.from} ${m.to ?? ""} ${m.cc ?? ""}`)));
    for (const a of allKnown().find((t) => keyOf(t) === keyOf(thread))?.to ?? []) addrs.add(a.toLowerCase());
    return linked.find((l) => l.addresses.some((a) => addrs.has(a))) ?? null;
  }, [thread, threadMsgs, linked, lists, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collab(s) active(s) liée(s) au fil ouvert : adresses de tous ses messages, alias, objet.
  const threadCollabs = useMemo(() => {
    if (!thread) return [];
    const row = allKnown().find((t) => keyOf(t) === keyOf(thread));
    const addrs = new Set(
      [thread.contact, ...(row?.to ?? []), ...(threadMsgs ?? []).flatMap((m) => addrsOf(`${m.from} ${m.to ?? ""} ${m.cc ?? ""}`))]
        .filter(Boolean)
        .map((a) => a.toLowerCase()),
    );
    const cm = thread.box === "talent" ? cmRows.get(thread.threadId) : undefined;
    const creator = [...addrs].map((a) => aliasOwner.get(a)).find(Boolean) ?? cm?.creator ?? null;
    const names = (threadMsgs ?? []).filter((m) => m.direction === "in").map((m) => displayName(m.from)).join(" ");
    return matchCollabs({ emails: [...addrs], creator, text: `${thread.subject} ${thread.name} ${names}`, brands: [cm?.brand] }, brandIndex, collabs);
  }, [thread, threadMsgs, aliasOwner, cmRows, brandIndex, collabs, lists, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusReply = (m: "reply" | "all" = "reply") => {
    const last = readerMsgs[readerMsgs.length - 1];
    if (last) setExpanded((s) => new Set([...s, last.id]));
    setReplyFocus({ key: Date.now(), mode: m });
  };
  /**
   * « Copier le fil » : toute la discussion (qui, quand, à qui, chaque message sans les
   * citations répétées) + la demande d'un bon suivi, prête à coller dans Claude.
   */
  const copyThread = async () => {
    if (!thread || !readerMsgs.length) return;
    const transcript = threadTranscript(thread.subject, thread.box, readerMsgs);
    const prompt = contextPrompt({ transcript, threadId: thread.threadId, box: thread.box, consigne: "fais un bon suivi de cet échange : réponds à ce qui attend une réponse et propose la prochaine étape" });
    try {
      await navigator.clipboard.writeText(prompt);
      toast(`Fil copié (${readerMsgs.length} message${readerMsgs.length > 1 ? "s" : ""}) : colle-le dans Claude (Cmd+V)`);
    } catch {
      toast("Copie impossible sur cet appareil");
    }
  };

  const forwardLast = () => {
    if (!thread || !readerMsgs.length) return;
    setForward({ msg: readerMsgs[readerMsgs.length - 1], subject: thread.subject, box: thread.box });
  };

  // Répondre : envoie via Gmail dans le MÊME fil (threadId), depuis la boîte du fil.
  // Appelé à l'envoi réel (après le délai d'annulation de ReplyBox).
  const sendReply = async ({ cc, bcc, html, attachments, draftKey }: { cc: string[]; bcc: string[]; html: string; attachments: OutAttachment[]; draftKey?: string }): Promise<boolean> => {
    if (!thread) return false;
    const t = thread;
    const p = plan;
    if (!p.to) {
      toast("Destinataire introuvable pour ce fil, utilise « Transférer ».");
      return false;
    }
    const subject = t.subject.replace(/^\s*re\s*:\s*/i, "");
    // Réponse reprise d'un brouillon Gmail : il sera retiré de Gmail une fois la réponse partie.
    const gd = draftKey ? readDraftRaw<ReplyDraft>(draftKey)?.gdraft : undefined;
    const res = await sendGmail(
      {
        to: p.to, cc, subject: `Re: ${subject}`, html, threadId: t.threadId, source: "manual", box: t.box, bcc, attachments,
        ...(p.inReplyTo ? { inReplyTo: p.inReplyTo } : {}),
        ...(p.references ? { references: p.references } : {}),
      },
      { label: `Réponse à ${p.to}`, draftKey },
    );
    if (!res.ok) {
      toast(sendFailText(res.error));
      return false;
    }
    if (gd) {
      void finishGmailDraft({ draftId: gd.id, box: gd.box }).then((ok) =>
        toast(ok ? "Réponse envoyée ✓" : "Réponse envoyée ✓ Le brouillon Gmail n'a pas pu être supprimé : retire-le depuis Brouillons."),
      );
    } else toast("Réponse envoyée ✓");
    const key = keyOf(t);
    threadCache.delete(key);
    // Le fil passe « Répondu » tout de suite (Gmail met quelques secondes à l'indexer), puis
    // les listes (reçus ET envoyés) sont relues à 0, 5 et 15 s pour se caler sur Gmail.
    const at = Date.now();
    const snippet = htmlToSnippet(html);
    setOverrides((m) => new Map(m).set(key, { ...(m.get(key) ?? {}), unread: false, reply: { ts: at, snippet }, at, done: at }));
    invalidateMailUnread();
    for (const ms of [0, 5_000, 15_000]) {
      window.setTimeout(() => {
        void refreshList("inbox");
        if (lists.sent || folderRef.current === "sent") void refreshList("sent");
      }, ms);
    }
    // Recharge le fil pour afficher la réponse, seulement s'il est encore ouvert.
    const fresh = await invokeJson<ThreadRes>("gmail-thread", { threadId: t.threadId, contact: t.contact, box: t.box });
    if (fresh.ok) {
      const msgs = shownMsgs(fresh);
      threadCache.set(key, { at: Date.now(), msgs });
      const now = threadRef.current;
      if (now && keyOf(now) === key) {
        threadReq.current++;
        setThreadMsgs(msgs);
        if (msgs.length) setExpanded((e) => new Set([...e, msgs[msgs.length - 1].id]));
      }
    }
    return true;
  };

  // Pièce jointe d'un fil agence : lue côté serveur dans la boîte du fil.
  const downloadAgencyAttachment = async (a: MailAttachment) => {
    if (!thread) return;
    const r = await invokeJson<{ ok?: boolean; data?: string; error?: string }>("gmail-thread", {
      action: "attachment", messageId: a.messageId, attachmentId: a.attachmentId, box: thread.box,
    }, FILE_TIMEOUT);
    if (!r.ok || !r.data) return toast(r.error === "piece_trop_lourde" ? "Pièce jointe trop lourde (20 Mo max)." : r.error === "reseau" ? "Téléchargement interrompu, réessaie" : "Téléchargement impossible");
    saveBase64(r.data, a.filename);
  };

  // ── Brouillons : ouvrir, envoyer, supprimer ─────────────────────────────
  const [replyNonce, setReplyNonce] = useState(0); // remonte la zone de réponse (brouillon repris)
  const pendingReplyFocus = useRef<string | null>(null);
  const [delAsk, setDelAsk] = useState<DraftItem | null>(null);
  const gkey = (r: { box: MailBox; draftId: string }) => `${r.box}:${r.draftId}`;
  const hideDraft = (r: { box: MailBox; draftId: string }, gone: boolean) =>
    setGoneDrafts((s) => {
      if (s.has(gkey(r)) === gone) return s;
      const n = new Set(s);
      if (gone) n.add(gkey(r));
      else n.delete(gkey(r));
      return n;
    });
  /** Mail parti depuis l'app : le brouillon Gmail repris est supprimé (vrai si Gmail confirme). */
  const finishGmailDraft = async (r: { box: MailBox; draftId: string }): Promise<boolean> => {
    hideDraft(r, true);
    const del = await deleteGmailDraft({ id: r.draftId, box: r.box });
    if (!del.ok) hideDraft(r, false);
    window.setTimeout(() => void refreshDrafts(), 2_000);
    return del.ok;
  };
  /** Prépare la zone de réponse du fil avec le brouillon Gmail (sans écraser une réponse commencée ici). */
  const resumeReplyDraft = (r: GmailDraftRow, subject: string) => {
    const key = replyDraftKey(r.box, r.threadId);
    const had = !!readDraft<ReplyDraft>(key)?.text?.trim();
    const res = seedReplyDraft(key, r, { subject, toLabel: prettyName(r.name) || r.email });
    if (res === "kept") {
      toast(had ? "Une réponse commencée sur cet appareil existe déjà pour ce fil : elle est gardée." : "Brouillon Gmail vide : rien à reprendre.");
    }
    setReplyNonce((n) => n + 1);
    pendingReplyFocus.current = tkey(r.box, r.threadId);
  };
  const openGmailDraft = (r: GmailDraftRow) => {
    if (isReplyDraft(r)) {
      // Réponse dans un fil : le fil s'ouvre, la zone de réponse reprend le brouillon (fil gardé groupé).
      const known = allKnown().find((t) => t.box === r.box && t.threadId === r.threadId);
      const subject = known?.subject || r.subject;
      resumeReplyDraft(r, subject);
      openThread({ threadId: r.threadId, subject, box: r.box, contact: known?.email ?? r.email, name: known?.name ?? r.name });
      return;
    }
    setNewMailDraft(r);
    setNewMailOpen(true);
    setNewMailKey((n) => n + 1);
  };
  // Fil ouvert depuis un brouillon : la zone de réponse prend le focus une fois le fil chargé.
  useEffect(() => {
    if (!thread || !threadMsgs?.length || pendingReplyFocus.current !== keyOf(thread)) return;
    pendingReplyFocus.current = null;
    focusReply("reply");
  }, [thread, threadMsgs]); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteDraftItem = async (it: DraftItem) => {
    if (it.kind !== "gmail") {
      writeDraft(it.key, null);
      if (it.kind === "reply") setReplyNonce((n) => n + 1);
      return toast("Brouillon supprimé de cet appareil ✓");
    }
    const r = it.row;
    hideDraft(r, true);
    const del = await deleteGmailDraft({ id: r.draftId, box: r.box });
    if (!del.ok) {
      hideDraft(r, false);
      return toast(draftDeleteErrText(del.error));
    }
    // Copies locales liées à ce brouillon : retirées aussi.
    writeDraft(gmailDraftLocalKey(r), null);
    if (isReplyDraft(r)) {
      const k = replyDraftKey(r.box, r.threadId);
      if (readDraftRaw<ReplyDraft>(k)?.gdraft?.id === r.draftId) {
        writeDraft(k, null);
        setReplyNonce((n) => n + 1);
      }
    }
    toast("Brouillon supprimé ✓");
    window.setTimeout(() => void refreshDrafts(), 1_500);
  };
  // Chargement : en ouvrant le dossier, et une fois en fond (compteur du dossier).
  useEffect(() => {
    if (mode === "drafts") void refreshDrafts();
  }, [mode, refreshDrafts]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || !rootRef.current?.getClientRects().length) return;
      if (Date.now() - draftsAt.current > 30_000) void refreshDrafts();
    }, 5_000);
    return () => window.clearTimeout(t);
  }, [refreshDrafts]);

  // Brouillons affichés : Gmail d'abord, puis ceux gardés sur cet appareil (filtre de boîte).
  const gmailDraftsShown = useMemo(() => gmailDraftRows.filter((r) => box === "all" || r.box === box), [gmailDraftRows, box]);
  const deviceDrafts = useMemo<DraftItem[]>(() => {
    const listed = new Set(gmailDraftRows.map(gkey));
    const out: DraftItem[] = [];
    for (const k of draftSet) {
      if (k === "new") {
        const d = readDraft<{ to?: string; subject?: string; body?: string; box?: MailBox; at: number }>(k);
        if (!d || (box !== "all" && d.box && d.box !== box)) continue;
        out.push({ kind: "new", key: k, subject: d.subject ?? "", to: d.to ?? "", text: d.body ?? "", at: d.at });
        continue;
      }
      const p = parseReplyDraftKey(k);
      const d = p ? readDraft<ReplyDraft>(k) : null;
      if (!p || !d?.text?.trim() || (box !== "all" && p.box !== box)) continue;
      if (d.gdraft && listed.has(`${d.gdraft.box}:${d.gdraft.id}`)) continue; // déjà dans la liste Gmail
      const known = allKnown().find((t) => t.box === p.box && t.threadId === p.threadId);
      out.push({
        kind: "reply", key: k, box: p.box, threadId: p.threadId,
        subject: d.subject || known?.subject || "",
        to: d.toLabel || (known ? prettyName(known.name) || known.email : ""),
        email: known?.email ?? "", text: d.text, at: d.at, contact: known?.email, name: known?.name,
      });
    }
    return out.sort((a, b) => ("at" in b ? b.at : 0) - ("at" in a ? a.at : 0));
  }, [draftSet, gmailDraftRows, box, mode, lists, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftsCount = gmailDraftsShown.length + deviceDrafts.length;

  // ── Raccourcis clavier ───────────────────────────────────────────────────
  const gAt = useRef(0);
  const curTarget = (): Target | null => {
    if (thread) return { threadId: thread.threadId, box: thread.box, subject: thread.subject };
    const n = cursor ? navList.find((x) => keyOf(x) === cursor) : null;
    return n ? { threadId: n.threadId, box: n.box, subject: n.subject } : null;
  };
  const move = (dir: 1 | -1) => {
    if (thread) {
      const n = navIdx >= 0 ? navList[navIdx + dir] : null;
      if (n) openThread(n);
      return;
    }
    if (!navList.length) return;
    const i = cursor ? navList.findIndex((x) => keyOf(x) === cursor) : -1;
    const n = navList[i < 0 ? 0 : Math.min(navList.length - 1, Math.max(0, i + dir))];
    setCursor(keyOf(n));
  };
  useEffect(() => {
    if (!cursor || thread) return;
    listRef.current?.querySelector(`[data-key="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, thread]);
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const k = e.key;
    // Fenêtre ouverte (nouveau mail, transfert, réglages…) : aucun raccourci.
    const dialog = newMailOpen || !!forward || settingsOpen || composerOpen || !!delAsk || !!document.querySelector('[role="dialog"]:not([data-mails-help]), [aria-modal="true"], [role="alertdialog"]');
    if (dialog) return;
    if (k === "?" || (k === "Escape" && helpOpen)) {
      e.preventDefault();
      setHelpOpen((v) => (k === "Escape" ? false : !v));
      return;
    }
    if (gAt.current && Date.now() - gAt.current < 1500) {
      gAt.current = 0;
      if (k === "i" || k === "s" || k === "d") {
        e.preventDefault();
        goMode(k === "i" ? "inbox" : k === "s" ? "sent" : "drafts");
        return;
      }
    }
    if (k === "g") {
      gAt.current = Date.now();
      return;
    }
    if (k === "c") {
      e.preventDefault();
      openNewMail();
      return;
    }
    if (k === "Escape") {
      if (thread) {
        e.preventDefault();
        closeThread();
      }
      return;
    }
    if (mode === "creators") return;
    if (k === "/") {
      e.preventDefault();
      (mode === "contacts" ? contactSearchRef : searchRef).current?.focus();
      return;
    }
    if ((mode === "contacts" || mode === "drafts") && !thread) return;
    switch (k) {
      case "j":
      case "k":
        e.preventDefault();
        move(k === "j" ? 1 : -1);
        return;
      case "Enter":
      case "o": {
        if (thread) return;
        const n = (cursor ? navList.find((x) => keyOf(x) === cursor) : null) ?? navList[0];
        if (n) {
          e.preventDefault();
          openThread(n);
        }
        return;
      }
      case "r":
      case "a":
        if (thread && readerMsgs.length) {
          e.preventDefault();
          focusReply(k === "a" ? "all" : "reply");
        }
        return;
      case "f":
        if (thread && readerMsgs.length) {
          e.preventDefault();
          forwardLast();
        }
        return;
      case "c":
        if (thread && readerMsgs.length) {
          e.preventDefault();
          void copyThread();
        }
        return;
      case "e": {
        const t = curTarget();
        if (t) {
          e.preventDefault();
          archive(t);
        }
        return;
      }
      case "#":
      case "Delete": {
        const t = curTarget();
        if (t) {
          e.preventDefault();
          trash(t);
        }
        return;
      }
      case "U":
        if (e.shiftKey) {
          const t = curTarget();
          if (t) {
            e.preventDefault();
            void setRead(t, true);
          }
        }
        return;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || (e.ctrlKey && !e.altKey)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "Enter" && el?.closest("button, a")) return; // Entrée sur un bouton : son action
      if (document.visibilityState !== "visible" || !rootRef.current?.getClientRects().length) return;
      keyHandler.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Contacts : filtres ───────────────────────────────────────────────────
  // Tags/niches réellement présents (pour le filtre) — hors « perso » (défaut créateurs).
  const tagList = useMemo(
    () => [...new Set((contacts ?? []).map((c) => (c.tag ?? "").trim()).filter((t) => t && t.toLowerCase() !== "perso"))],
    [contacts],
  );
  const contacted = (c: Contact) => !!c.lastContacted || parseTouches(c.touches).length > 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (contacts ?? []).filter((c) => {
      if (tagFilter !== "__all__" && (c.tag ?? "").trim() !== tagFilter) return false;
      // Même règle qu'ailleurs : échangé = dernier mail suivi OU touche manuelle.
      const done = contacted(c);
      if (contactFilter === "contacted" && !done) return false;
      if (contactFilter === "never" && done) return false;
      if (q && !(c.label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.tag ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [contacts, query, tagFilter, contactFilter]);

  const readerOpen = !!thread || (mode === "contacts" && !!selected);
  const listCls = "flex min-h-0 min-w-0 flex-col bg-panel lg:border-r lg:border-border";
  const centerNote = (icon: ReactNode, text: string) => (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon}
      <p className="text-[13px] text-muted-foreground">{text}</p>
    </div>
  );
  const boxesText = (boxes: MailBox[]) => boxes.map((b) => BOX_LABEL[b]).join(" et ");

  // ── Barre d'icônes (ordinateur moyen) : dossiers ─────────────────────────
  const creatorOn = (n: string) => !!creatorFilter && sameName(creatorFilter, n) && (mode === "inbox" || mode === "sent");
  const rail = (
    <nav aria-label="Dossiers" className="hidden min-h-0 flex-col items-center gap-1 border-r border-border py-3 lg:flex xl:hidden">
      <button
        type="button"
        onClick={openNewMail}
        aria-label="Nouveau mail"
        aria-keyshortcuts="c"
        className="group/tip relative mb-2 flex h-[54px] w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-foreground transition-colors hover:bg-rowhover"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground">
          <PenLine className="h-[15px] w-[15px]" />
        </span>
        <span className="text-[10.5px] font-medium leading-none">Nouveau</span>
        <Tip>Nouveau mail <Kbd>c</Kbd></Tip>
      </button>
      {MODES.map((m) => (
        <RailButton
          key={m.id}
          label={m.label}
          caption={m.short}
          shortcut={m.shortcut}
          active={mode === m.id}
          badge={m.id === "inbox" ? unreadShown || null : m.id === "creators" ? mailTotal || null : m.id === "drafts" ? draftsCount || null : null}
          onClick={() => goMode(m.id)}
        >
          <m.icon className="h-[18px] w-[18px]" />
        </RailButton>
      ))}
      {/* Dossiers de couleur des créateurs (filtre de la liste). */}
      {linked.length > 0 && (
        <div className="mt-1 flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-t border-border pt-2 [scrollbar-width:none]">
          {linked.map((l) => {
            const on = creatorOn(l.creator);
            const n = creatorUnread.get(l.creator.trim().toLowerCase()) ?? 0;
            return (
              <button
                key={l.creator}
                type="button"
                onClick={() => pickCreator(l.creator)}
                aria-pressed={on}
                aria-label={`Mails de ${titleCase(l.creator)}`}
                title={`Mails de ${titleCase(l.creator)}${n ? ` (${n} non lu${n > 1 ? "s" : ""})` : ""}`}
                className={cn("relative grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors", on ? "bg-muted ring-1 ring-border" : "hover:bg-rowhover")}
              >
                <span className={cn("grid size-6 place-items-center rounded-md text-[10.5px] font-bold text-black/75", creatorTone(l.creator))}>
                  {titleCase(l.creator).charAt(0)}
                </span>
                {n > 0 && <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-surface" />}
              </button>
            );
          })}
        </div>
      )}
      <span className="flex-1" />
      <RailButton label="Signature et délai d'annulation" caption="Réglages" onClick={() => setSettingsOpen(true)}>
        <Settings2 className="h-[18px] w-[18px]" />
      </RailButton>
    </nav>
  );

  // ── Colonne de gauche (grand écran) : dossiers avec libellés et créateurs ─
  const wideRail = (
    <nav aria-label="Dossiers" className="hidden min-h-0 flex-col border-r border-border xl:flex">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <button
          type="button"
          onClick={openNewMail}
          aria-keyshortcuts="c"
          title="Nouveau mail (c)"
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[13px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          <PenLine className="h-4 w-4" /> Nouveau mail
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
        <div className="flex flex-col gap-0.5">
          {MODES.map((m) => (
            <FolderRow
              key={m.id}
              icon={m.icon}
              label={m.wide}
              title={m.shortcut ? `${m.label} (${m.shortcut})` : m.label}
              active={mode === m.id}
              count={m.id === "inbox" ? unreadShown : m.id === "creators" ? mailTotal : m.id === "drafts" ? draftsCount : null}
              onClick={() => goMode(m.id)}
            />
          ))}
        </div>
        <div className="mt-5">
          <div className="flex items-center gap-1 pb-1 pl-3 pr-1">
            <span className="min-w-0 flex-1 text-[11.5px] font-semibold text-muted-foreground">Créateurs</span>
            <button
              type="button"
              onClick={() => goMode("creators")}
              aria-label="Relier un créateur"
              title="Relier un créateur (alias talent@)"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {linked.length ? (
            <div className="flex flex-col gap-0.5">
              {linked.map((l) => (
                <FolderRow
                  key={l.creator}
                  swatch={creatorTone(l.creator)}
                  label={titleCase(l.creator)}
                  title={`Mails de ${titleCase(l.creator)}${l.addresses.length ? ` (${l.addresses.join(", ")})` : ""}`}
                  active={creatorOn(l.creator)}
                  count={creatorUnread.get(l.creator.trim().toLowerCase())}
                  onClick={() => pickCreator(l.creator)}
                />
              ))}
            </div>
          ) : (
            <p className="px-3 text-[12px] leading-snug text-faint">Relie l'adresse d'un créateur pour classer ses mails ici.</p>
          )}
        </div>
        <span className="min-h-4 flex-1" />
        <div className="flex flex-col gap-0.5 border-t border-border pt-2">
          <FolderRow icon={Keyboard} label="Raccourcis" title="Raccourcis clavier (?)" onClick={() => setHelpOpen((v) => !v)} />
          <FolderRow icon={Settings2} label="Réglages" title="Signature et délai d'annulation" onClick={() => setSettingsOpen(true)} />
        </div>
      </div>
    </nav>
  );

  // ── Même barre, en ligne (téléphone, tablette) ──────────────────────────
  const mobileNav = (
    <nav aria-label="Dossiers" className={cn("flex gap-1.5 overflow-x-auto border-b border-border p-2 [scrollbar-width:none] lg:hidden", readerOpen && "max-lg:hidden")}>
      <button type="button" onClick={openNewMail} className={cn(pillCls, "bg-primary px-3 text-primary-foreground hover:opacity-90")}>
        <PenLine className="h-3.5 w-3.5" /> Nouveau
      </button>
      {MODES.map((m) => {
        const on = mode === m.id;
        const n = m.id === "inbox" ? unreadShown : m.id === "creators" ? mailTotal : m.id === "drafts" ? draftsCount : 0;
        return (
          <button key={m.id} type="button" onClick={() => goMode(m.id)} aria-pressed={on}
            className={cn(pillCls, on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <m.icon className="h-3.5 w-3.5" /> {m.short}
            {n ? <span className={cn("tabular-nums", on ? "opacity-70" : "text-faint")}>{n}</span> : null}
          </button>
        );
      })}
      {linked.length > 0 && <span aria-hidden className="my-1.5 w-px shrink-0 bg-border" />}
      {linked.map((l) => {
        const on = creatorOn(l.creator);
        const n = creatorUnread.get(l.creator.trim().toLowerCase()) ?? 0;
        return (
          <button key={l.creator} type="button" onClick={() => pickCreator(l.creator)} aria-pressed={on} aria-label={`Mails de ${titleCase(l.creator)}`}
            className={cn(pillCls, on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", creatorTone(l.creator))} /> {firstName(l.creator)}
            {n ? <span className={cn("tabular-nums", on ? "opacity-70" : "text-faint")}>{n}</span> : null}
          </button>
        );
      })}
      <span className="flex-1" />
      <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Signature et délai d'annulation"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
        <Settings2 className="h-4 w-4" />
      </button>
    </nav>
  );

  // ── Liste : boîte de réception / envoyés ────────────────────────────────
  const busyNow = listBusy[folder];
  const errNow = listErr[folder];
  const boxCount = (id: "all" | MailBox) => (mode === "inbox" ? unreadBy[id] : 0);
  const boxSelect = (
    <label className="relative flex shrink-0 items-center lg:hidden">
      <span className="sr-only">Boîte affichée</span>
      <span aria-hidden className="pointer-events-none absolute left-2.5 flex gap-0.5">
        {box === "all" ? (
          <>
            <BoxDot box="partnerships" className="size-1.5" />
            <BoxDot box="talent" className="size-1.5" />
          </>
        ) : (
          <BoxDot box={box} />
        )}
      </span>
      <select
        value={box}
        onChange={(e) => setBox(e.target.value as "all" | MailBox)}
        className="h-8 appearance-none rounded-full border border-border bg-surface pl-7 pr-7 text-[12px] font-semibold text-foreground outline-none focus:border-primary"
      >
        {BOX_FILTERS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
            {boxCount(b.id) ? ` (${boxCount(b.id)})` : ""}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-faint" />
    </label>
  );
  const metaText = inboxQ
    ? `${localMatches.length} dans la liste${searchLive && search && !search.off && !search.busy ? ` · ${remote.length} de plus dans Gmail` : ""}`
    : `${boxThreads.length} plus récente${boxThreads.length > 1 ? "s" : ""}`;
  const partialText = cur?.partial
    ? cur.failedBoxes.length
      ? `${boxesText(cur.failedBoxes)} ${cur.failedBoxes.length > 1 ? "ne répondent" : "ne répond"} pas pour l'instant : ses mails affichés peuvent dater.`
      : cur.v2
        ? "Certains mails n'ont pas pu être lus : la liste peut être incomplète."
        : "Une des deux boîtes n'a pas répondu : la liste peut être incomplète."
    : null;
  const rowFor = (t: InboxThread) => {
    const key = keyOf(t);
    const on = !!thread && keyOf(thread) === key;
    const owner = t.box === "talent" ? (t.to ?? []).map((a) => aliasOwner.get(a.toLowerCase())).find(Boolean) ?? null : null;
    const target: Target = { threadId: t.threadId, box: t.box, subject: t.subject };
    return (
      <ThreadRow
        key={key}
        t={t}
        folder={folder}
        on={on}
        cursor={cursor === key}
        showBox={box === "all"}
        draft={draftSet.has(replyDraftKey(t.box, t.threadId)) || gmailReplyDrafts.has(key)}
        creator={owner}
        creatorPhoto={owner ? photoOf(owner) : null}
        tags={tagsOf(t)}
        onOpen={() => openThread({ threadId: t.threadId, subject: t.subject, box: t.box, contact: t.email, name: t.name })}
        onArchive={() => archive(target)}
        onTrash={() => trash(target)}
        onToggleRead={() => void setRead(target, !t.unread)}
      />
    );
  };

  const inboxCol = (
    <section className={cn(listCls, readerOpen && "max-lg:hidden")} aria-label={folder === "sent" ? "Envoyés" : "Boîte de réception"}>
      <div className="shrink-0 border-b border-border px-3 pb-2.5 pt-3 sm:px-4">
        <div className="flex items-center gap-1">
          <h2 className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold tracking-tight text-foreground">{folder === "sent" ? "Envoyés" : "Boîte de réception"}</h2>
          {boxSelect}
          <ToolButton icon={RefreshCw} label="Actualiser" spin={busyNow} disabled={busyNow} onClick={() => void refreshList(folder)} className="h-8 w-8" />
          <ToolButton icon={Keyboard} label="Raccourcis clavier" shortcut="?" tipSide="bottom-end" onClick={() => setHelpOpen((v) => !v)} className="h-8 w-8 max-lg:hidden" />
        </div>
        <Tabs
          className="mt-2 max-lg:hidden"
          size="sm"
          fullWidth
          label="Boîte affichée"
          value={box}
          onValueChange={(v) => setBox(v as "all" | MailBox)}
          items={BOX_FILTERS.map((b) => ({
            value: b.id,
            label: b.label,
            dot: b.id === "all" ? undefined : BOX_STYLE[b.id].dot,
            count: boxCount(b.id) || undefined,
          }))}
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchField size="sm" inputRef={searchRef} value={inboxQuery} onChange={setInboxQuery} placeholder="Rechercher dans les mails…"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (inboxQuery) setInboxQuery("");
                  else e.currentTarget.blur();
                }
              }} />
          </div>
          {folder === "inbox" && <UnreadToggle on={!!unreadOnly} count={unreadHere} onToggle={toggleUnread} />}
        </div>
        {creatorFilter && (
          <div className="mt-2 flex min-w-0 items-center gap-2 pl-1">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-2 pr-0.5 text-[12px] font-semibold text-foreground">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", creatorTone(creatorFilter))} />
              <span className="truncate">{titleCase(creatorFilter)}</span>
              <button type="button" onClick={() => setCreatorFilter(null)} aria-label="Retirer le filtre créateur"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
            <button type="button" onClick={() => openCreator(creatorFilter)} className="shrink-0 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              Voir son suivi
            </button>
          </div>
        )}
        <p className="mt-1.5 truncate pl-1 text-[11.5px] text-muted-foreground" aria-live="polite">{cur ? metaText : busyNow ? "Chargement…" : ""}</p>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-busy={busyNow}>
        {errNow && cur && (
          <ErrorBanner
            text={loadErrText(errNow, "Actualisation impossible : la liste affichée peut dater.")}
            onRetry={() => void refreshList(folder)}
            onReconnect={needsReconnect(errNow) ? () => void reconnectGoogle() : undefined}
          />
        )}
        {partialText && <ErrorBanner tone="info" text={partialText} onRetry={() => void refreshList(folder)} />}
        {!cur ? (
          errNow ? (
            <ErrorCard
              text={loadErrText(errNow, "Impossible de charger la boîte de réception.")}
              onRetry={() => void refreshList(folder)}
              onReconnect={needsReconnect(errNow) ? () => void reconnectGoogle() : undefined}
            />
          ) : (
            <ListSkeleton />
          )
        ) : !boxThreads.length && !inboxQ ? (
          centerNote(
            <Inbox className="h-5 w-5 text-faint" />,
            unreadOnly && folder === "inbox"
              ? "Aucun mail non lu. Tout est à jour ✓"
              : creatorFilter
              ? `Aucun mail de ${titleCase(creatorFilter)} dans les mails chargés.`
              : folder === "sent" ? "Aucun mail envoyé depuis cette boîte." : "Aucun mail dans cette boîte.",
          )
        ) : (
          <>
            {inboxQ && !localMatches.length && (
              <p className="px-5 py-4 text-[12.5px] text-muted-foreground">Aucun mail de la liste ne correspond à « {inboxQuery.trim()} ».</p>
            )}
            <ul className={mailCardListCls}>{localMatches.map(rowFor)}</ul>
            {inboxQ && searchLive && search && !search.off && (
              <div className="border-t border-border">
                <div className="flex items-center gap-2 bg-muted/40 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
                  <Search className="h-3.5 w-3.5" /> Résultats dans Gmail
                  {search.busy && <Spin size={14} />}
                </div>
                {search.err ? (
                  <ErrorBanner text={loadErrText(search.err, "Recherche Gmail impossible.")} onRetry={() => setSearchTick((n) => n + 1)}
                    onReconnect={needsReconnect(search.err) ? () => void reconnectGoogle() : undefined} />
                ) : !search.busy && !remote.length ? (
                  <p className="px-5 py-3 text-[12.5px] text-muted-foreground">Rien de plus dans Gmail.</p>
                ) : (
                  <ul className={mailCardListCls}>{remote.map(rowFor)}</ul>
                )}
              </div>
            )}
            {canMore && (
              <div className="flex justify-center border-t border-border px-4 py-3">
                <button type="button" onClick={() => void loadMore()} disabled={moreBusy}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-rowhover disabled:opacity-60">
                  {moreBusy && <Spin size={14} />} Charger plus
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );

  // ── Liste : brouillons (Gmail + cet appareil) ───────────────────────────
  const draftsOld = !!drafts?.old;
  const sectionHead = (icon: ReactNode, text: string, extra?: ReactNode) => (
    <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground first:border-t-0 sm:px-5">
      {icon} {text} {extra}
    </div>
  );
  const draftOpenKey = thread ? keyOf(thread) : null;
  const gmailDraftItem = (r: GmailDraftRow) => {
    const k = `g:${gkey(r)}`;
    return (
      <DraftRow
        key={k}
        k={k}
        subject={r.subject}
        to={prettyName(r.name) || r.email || r.to[0] || ""}
        email={r.email}
        snippet={decodeEntities(r.snippet) || draftBodyText(r).slice(0, 200)}
        ts={r.ts}
        box={r.box}
        showBox={box === "all"}
        byClaude={r.byClaude}
        hint={isReplyDraft(r) ? "réponse" : undefined}
        on={isReplyDraft(r) && draftOpenKey === tkey(r.box, r.threadId)}
        onOpen={() => openGmailDraft(r)}
        onDelete={() => setDelAsk({ kind: "gmail", key: k, row: r })}
      />
    );
  };
  const deviceDraftItem = (it: DraftItem) => {
    if (it.kind === "gmail") return null;
    const reply = it.kind === "reply";
    return (
      <DraftRow
        key={it.key}
        k={it.key}
        subject={it.subject || (reply ? "(objet inconnu)" : "(sans objet)")}
        to={it.to}
        email={reply ? it.email : addrOf(it.to)}
        snippet={it.text.replace(/\s+/g, " ").trim().slice(0, 200)}
        ts={it.at}
        box={reply ? it.box : null}
        showBox={box === "all"}
        hint={reply ? "réponse" : "nouveau mail"}
        on={reply && draftOpenKey === tkey(it.box, it.threadId)}
        onOpen={() => (reply ? openThread({ threadId: it.threadId, subject: it.subject, box: it.box, contact: it.contact, name: it.name }) : openNewMail())}
        onDelete={() => setDelAsk(it)}
      />
    );
  };
  const draftsCol = (
    <section className={cn(listCls, readerOpen && "max-lg:hidden")} aria-label="Brouillons">
      <div className="shrink-0 border-b border-border px-3 pb-2.5 pt-3 sm:px-4">
        <div className="flex items-center gap-1">
          <h2 className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold tracking-tight text-foreground">Brouillons</h2>
          {boxSelect}
          <ToolButton icon={RefreshCw} label="Actualiser" spin={draftsBusy} disabled={draftsBusy} onClick={() => void refreshDrafts(true)} className="h-8 w-8" />
        </div>
        <Tabs
          className="mt-2 max-lg:hidden"
          size="sm"
          fullWidth
          label="Boîte affichée"
          value={box}
          onValueChange={(v) => setBox(v as "all" | MailBox)}
          items={BOX_FILTERS.map((b) => ({ value: b.id, label: b.label, dot: b.id === "all" ? undefined : BOX_STYLE[b.id].dot }))}
        />
        <p className="mt-1.5 truncate pl-1 text-[11.5px] text-muted-foreground" aria-live="polite">
          {drafts || draftsOld ? `${draftsCount} brouillon${draftsCount > 1 ? "s" : ""}` : draftsBusy ? "Chargement…" : ""}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={draftsBusy}>
        {draftsErr && (
          <ErrorBanner
            text={loadErrText(draftsErr, "Impossible de lire les brouillons Gmail.")}
            onRetry={() => void refreshDrafts(true)}
            onReconnect={needsReconnect(draftsErr) ? () => void reconnectGoogle() : undefined}
          />
        )}
        {draftsOld && <ErrorBanner tone="info" text={DRAFTS_OLD_TEXT} onRetry={() => void refreshDrafts(true)} />}
        {drafts?.partial && !draftsOld && (
          <ErrorBanner
            tone="info"
            text={drafts.failedBoxes.length
              ? `${boxesText(drafts.failedBoxes)} ${drafts.failedBoxes.length > 1 ? "ne répondent" : "ne répond"} pas pour l'instant : ses brouillons affichés peuvent dater.`
              : "Certains brouillons n'ont pas pu être lus : la liste peut être incomplète."}
            onRetry={() => void refreshDrafts(true)}
          />
        )}
        {!drafts && !draftsErr && draftsBusy && !deviceDrafts.length ? (
          <ListSkeleton rows={4} />
        ) : !gmailDraftsShown.length && !deviceDrafts.length ? (
          centerNote(<FilePen className="h-5 w-5 text-faint" />, "Aucun brouillon")
        ) : (
          <>
            {gmailDraftsShown.length > 0 && (
              <>
                {deviceDrafts.length > 0 && sectionHead(<Mail className="h-3.5 w-3.5" />, "Dans Gmail")}
                <ul className={mailCardListCls}>{gmailDraftsShown.map(gmailDraftItem)}</ul>
              </>
            )}
            {deviceDrafts.length > 0 && (
              <>
                {sectionHead(<Smartphone className="h-3.5 w-3.5" />, "Sur cet appareil")}
                <ul className={mailCardListCls}>{deviceDrafts.map(deviceDraftItem)}</ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );

  // ── Liste : contacts ─────────────────────────────────────────────────────
  const contactsCol = (
    <section className={cn(listCls, readerOpen && "max-lg:hidden")} aria-label="Contacts">
      <div className="shrink-0 border-b border-border px-3 pb-3 pt-3 sm:px-4">
        <h2 className="truncate pl-1 text-[17px] font-semibold tracking-tight text-foreground">Contacts</h2>
        <p className="mt-0.5 pl-1 text-[11.5px] text-muted-foreground">
          {contacts ? `${filtered.length} contact${filtered.length > 1 ? "s" : ""} avec e-mail` : "Chargement…"}
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <SearchField size="sm" inputRef={contactSearchRef} value={query} onChange={setQuery} placeholder="Rechercher un contact…" />
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
              label="Filtrer par catégorie"
              wrap
              items={[{ value: "__all__", label: "Toutes les catégories" }, ...tagList.map((t) => ({ value: t, label: t }))]}
              value={tagFilter}
              onValueChange={setTagFilter}
            />
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!contacts ? (
          <ListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
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
                  onClick={() => {
                    setSelected(c);
                    closeThread();
                  }}
                  className={cn(mailRowCls(selected?.id === c.id), "items-center py-3")}
                >
                  <Initial name={c.brand || c.label} email={c.email} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-foreground" title={c.label}>{c.brand || c.label}</span>
                      {contacted(c) && <span className="size-1.5 shrink-0 rounded-full bg-signal" title="Déjà échangé" />}
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
  const tgt: Target | null = thread ? { threadId: thread.threadId, box: thread.box, subject: thread.subject } : null;
  const loaded = !!threadMsgs && readerMsgs.length > 0;
  const draftKey = thread ? replyDraftKey(thread.box, thread.threadId) : "";
  // Réponse en brouillon dans Gmail pour ce fil, pas encore reprise dans la zone de réponse.
  const threadGmailDraft = thread ? gmailReplyDrafts.get(keyOf(thread)) : undefined;
  const gmailDraftWaiting = !!threadGmailDraft && readDraftRaw<ReplyDraft>(draftKey)?.gdraft?.id !== threadGmailDraft.draftId;
  const listName = thread ? selected?.label ?? (prettyName(thread.name) || thread.contact) : "";
  const many = readerMsgs.length > 4 && !showAllMsgs;
  const navBtns = navIdx >= 0 && navList.length > 1 && (
    <>
      <ToolButton icon={ChevronLeft} label="Mail précédent" shortcut="k" className="h-8 w-8" disabled={navIdx <= 0} onClick={() => openThread(navList[navIdx - 1])} />
      <span className="whitespace-nowrap px-1 text-[12.5px] tabular-nums text-muted-foreground">{navIdx + 1} sur {navList.length}</span>
      <ToolButton icon={ChevronRight} label="Mail suivant" shortcut="j" className="h-8 w-8" disabled={navIdx >= navList.length - 1} onClick={() => openThread(navList[navIdx + 1])} />
    </>
  );
  const threadReader = thread && tgt && (
    <section className="flex min-h-0 min-w-0 flex-col" aria-label="Lecture du mail">
      <div className="@container sticky top-0 z-20 flex h-14 shrink-0 items-center gap-0.5 border-b border-border bg-surface px-2 max-md:top-[calc(2.75rem+env(safe-area-inset-top))] sm:px-3 lg:static">
        <ToolButton icon={ArrowLeft} label={selected ? "Retour aux échanges" : "Retour à la liste"} shortcut="Échap" tipSide="bottom-start" onClick={closeThread} />
        {/* Ordinateur : barre extensible (icônes, noms au survol). Téléphone : boutons simples. */}
        <ExpandableActionBar
          size="sm"
          className="ml-1 max-md:hidden"
          classNames={{ track: "border-transparent bg-transparent shadow-none backdrop-blur-none" }}
          items={[
            { id: "archive", label: "Archiver", icon: <Archive className="h-full w-full" />, shortcut: "e", onClick: () => archive(tgt) },
            { id: "trash", label: "Corbeille", icon: <Trash2 className="h-full w-full" />, shortcut: "#", onClick: () => trash(tgt) },
            { id: "unread", label: "Non lu", icon: <Mail className="h-full w-full" />, shortcut: "⇧U", onClick: () => void setRead(tgt, true) },
            ...(threadCreator ? [{ id: "creator", label: `Ce que voit ${firstName(threadCreator.creator)}`, icon: <MessageSquareText className="h-full w-full" />, onClick: openThreadCreator }] : []),
          ]}
        />
        <span className="contents md:hidden">
          <ToolButton icon={Trash2} label="Corbeille" text="Corbeille" shortcut="#" danger onClick={() => trash(tgt)} />
          <ToolButton icon={Mail} label="Marquer non lu" text="Non lu" shortcut="⇧U" onClick={() => void setRead(tgt, true)} />
          {threadCreator && (
            <ToolButton icon={MessageSquareText} label={`Statut et remarques que ${firstName(threadCreator.creator)} voit`} tipSide="bottom" onClick={openThreadCreator} />
          )}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 max-md:invisible">{navBtns}</div>
        <ToolButton icon={Copy} label="Copier le fil pour Claude" text="Copier le fil" shortcut="c" tipSide="bottom" disabled={!loaded} onClick={() => void copyThread()} />
        <ToolButton icon={Reply} label="Répondre" text="Répondre" shortcut="r" className="max-md:hidden" disabled={!loaded} onClick={() => focusReply("reply")} />
        <ToolButton icon={Forward} label="Transférer" text="Transférer" shortcut="f" tipSide="bottom-end" disabled={!loaded} onClick={forwardLast} />
      </div>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full px-4 pb-6 pt-4 max-md:pb-40 sm:px-8", threadCollabs.length ? "max-w-[1140px]" : "max-w-[860px]")}>
          {/* Grand lecteur : encart « Collab liée » à droite ; sinon en haut du mail. */}
          <div className={cn(threadCollabs.length > 0 && "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_248px] @3xl:items-start @3xl:gap-8")}>
            <div className="min-w-0">
              <h1 className="text-[19px] font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance] sm:text-[24px]">
                {thread.subject || "(sans objet)"}
              </h1>
              <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                <BoxChip box={thread.box} className="text-[10px]" />
                <span className="min-w-0 truncate">
                  {listName}
                  {threadMsgs ? ` · ${threadMsgs.length} message${threadMsgs.length > 1 ? "s" : ""}` : ""}
                </span>
              </p>
              <LinkedCollabCard collabs={threadCollabs} photoOf={photoOf} onOpen={openCollab} className="mt-3 @3xl:hidden" />
              {threadErr ? (
                <ErrorCard
                  text={loadErrText(threadErr, "Impossible de charger ce fil.")}
                  onRetry={retryThread}
                  onReconnect={needsReconnect(threadErr) ? () => void reconnectGoogle() : undefined}
                />
              ) : !threadMsgs ? (
                <BodySkeleton />
              ) : readerMsgs.length === 0 ? (
                <ErrorCard text="Ce fil est vide (mail supprimé ?)." onRetry={retryThread} />
              ) : (
                <div className="mt-2 flex flex-col divide-y divide-border">
                  {/* Fil long (maquette) : les anciens messages repliés derrière un bouton en haut. */}
                  {many && (
                    <button type="button" onClick={() => setShowAllMsgs(true)}
                      className="mb-2 h-10 w-full rounded-xl border border-border bg-surface text-[12.5px] font-medium text-muted-foreground shadow-sm shadow-black/[0.02] transition-colors hover:bg-rowhover hover:text-foreground">
                      Charger {readerMsgs.length - 2 > 1 ? `les ${readerMsgs.length - 2} messages précédents` : "le message précédent"}
                    </button>
                  )}
                  {readerMsgs.map((m, i) => {
                    if (many && i < readerMsgs.length - 2) return null;
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
                            { icon: Reply, label: "Répondre", onClick: () => focusReply("reply") },
                            { icon: Forward, label: "Transférer", onClick: () => setForward({ msg: m, subject: thread.subject, box: thread.box }) },
                          ]}
                          extra={(() => {
                            const src = split.shown.find((x) => x.id === m.id);
                            return (
                              <MailReactions
                                pills={pillsOf(m.id)}
                                canReact={!!src && canReact(src, AGENCY_DOMAIN.slice(1))}
                                onReact={(e) => sendReaction(m.id, e)}
                              />
                            );
                          })()}
                          footer={last ? (
                            <>
                            {/* Actions rapides (maquette), sous le dernier message : ordinateur. */}
                            <div className="-mt-2 mb-4 hidden justify-end gap-2 md:flex">
                              {[
                                { icon: Copy, label: "Copier le fil pour Claude (c)", on: () => void copyThread() },
                                { icon: Forward, label: "Transférer (f)", on: forwardLast },
                                { icon: Reply, label: "Répondre (r)", on: () => focusReply("reply") },
                              ].map((b) => (
                                <button key={b.label} type="button" onClick={b.on} title={b.label} aria-label={b.label}
                                  className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground shadow-[0_4px_14px_-4px_rgba(15,23,42,0.2)] ring-1 ring-border/70 transition-colors hover:text-foreground">
                                  <b.icon className="h-4 w-4" />
                                </button>
                              ))}
                            </div>
                            {gmailDraftWaiting && threadGmailDraft && (
                              <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/50 px-3.5 py-2 text-[12.5px] text-muted-foreground">
                                <FilePen className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 flex-1">
                                  Un brouillon de réponse attend dans Gmail{threadGmailDraft.byClaude ? " (préparé par Claude)" : ""}.
                                </span>
                                <button type="button" onClick={() => resumeReplyDraft(threadGmailDraft, thread.subject)}
                                  className="h-7 shrink-0 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                                  Reprendre
                                </button>
                              </div>
                            )}
                            <ReplyBox
                              key={`${draftKey}:${replyNonce}`}
                              draftMeta={{ subject: thread.subject, to: replyName || plan.to }}
                              variant="card"
                              to={replyName}
                              toTitle={plan.to}
                              box={thread.box}
                              focusKey={replyFocus.key}
                              focusMode={replyFocus.mode}
                              draftKey={draftKey}
                              replyAllCc={plan.cc}
                              sendLabel={`Réponse à ${replyName || plan.to}`}
                              placeholder="Écris ta réponse…"
                              onSend={sendReply}
                              claude={{ threadId: thread.threadId, subject: thread.subject, messages: readerMsgs }}
                              meet={{ guests: plan.to ? [plan.to] : [], title: `TTP Creators x ${replyName || plan.to}`.trim() }}
                              modelVars={{
                                marque: brandFromEmail(plan.to),
                                createur: threadCreator ? titleCase(threadCreator.creator) : null,
                                prenom: replyName && !replyName.includes("@") ? replyName.split(" ")[0] : null,
                              }}
                            />
                            </>
                          ) : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <LinkedCollabCard collabs={threadCollabs} photoOf={photoOf} onOpen={openCollab} className="sticky top-4 hidden @3xl:block" />
          </div>
        </div>
      </div>

      {/* Téléphone : actions principales en pilule flottante, AU-DESSUS de la barre d'onglets
          (62 px + sa marge basse), comme elle (avant : glissée dessous, à moitié cachée). */}
      <div className="ios-chrome ios-bar fixed inset-x-4 bottom-[calc(62px+max(0.75rem,env(safe-area-inset-bottom))+0.5rem)] z-40 flex h-12 items-center gap-1 rounded-full px-1.5 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.35)] ring-1 ring-border/60 md:hidden">
        <button type="button" onClick={() => focusReply("reply")} disabled={!loaded}
          className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-40">
          <Reply className="h-4 w-4" /> Répondre
        </button>
        <button type="button" onClick={() => archive(tgt)}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-foreground">
          <Archive className="h-4 w-4" /> Archiver
        </button>
        <span className="flex-1" />
        {navIdx >= 0 && navList.length > 1 && (
          <>
            <button type="button" aria-label="Mail précédent" disabled={navIdx <= 0} onClick={() => openThread(navList[navIdx - 1])}
              className="grid h-9 w-9 place-items-center rounded-full text-foreground disabled:opacity-30">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-[12px] tabular-nums text-muted-foreground">{navIdx + 1}/{navList.length}</span>
            <button type="button" aria-label="Mail suivant" disabled={navIdx >= navList.length - 1} onClick={() => openThread(navList[navIdx + 1])}
              className="grid h-9 w-9 place-items-center rounded-full text-foreground disabled:opacity-30">
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </section>
  );

  // ── Lecture : échanges d'un contact ──────────────────────────────────────
  const visibleHistory = history ?? [];
  const contactReader = selected && (
    <section className="flex min-h-0 min-w-0 flex-col" aria-label="Échanges avec ce contact">
      <div className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 max-md:top-[calc(2.75rem+env(safe-area-inset-top))] sm:px-3 lg:static">
        <ToolButton icon={ArrowLeft} label="Retour aux contacts" className="lg:hidden" onClick={() => setSelected(null)} />
        <span className="min-w-0 flex-1 truncate px-2 text-[12.5px] text-muted-foreground">Échanges avec ce contact, dans les deux boîtes</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px]">
          <div className="flex items-center gap-4 px-4 py-5 sm:px-8">
            <Initial name={selected.brand || selected.label} email={selected.email} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-foreground sm:text-[20px]">{selected.brand || selected.person || selected.email}</h1>
              <p className="truncate text-[12.5px] text-muted-foreground">{[selected.brand ? selected.person : null, selected.email].filter(Boolean).join(" · ")}</p>
            </div>
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <PenLine className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Nouveau mail</span>
            </button>
          </div>

          <div className="border-t border-border">
            {historyErr && !historyBusy && (
              <ErrorBanner
                text={loadErrText(historyErr, "Impossible de lire les échanges Gmail avec ce contact.")}
                onRetry={() => setHistoryTick((n) => n + 1)}
                onReconnect={needsReconnect(historyErr) ? () => void reconnectGoogle() : undefined}
              />
            )}
            {historyPartial && !historyBusy && (
              <ErrorBanner
                tone="info"
                text={historyPartial.boxes.length
                  ? `${boxesText(historyPartial.boxes)} ${historyPartial.boxes.length > 1 ? "ne répondent" : "ne répond"} pas pour l'instant : l'historique peut être incomplet.`
                  : "Une des deux boîtes n'a pas répondu : l'historique peut être incomplet."}
                onRetry={() => setHistoryTick((n) => n + 1)}
              />
            )}
            {historyBusy ? (
              <ListSkeleton rows={4} />
            ) : visibleHistory.length === 0 ? (
              historyErr ? null : centerNote(<Mail className="h-5 w-5 text-faint" />, "Aucun échange trouvé dans les deux boîtes avec ce contact.")
            ) : (
              <ul className="divide-y divide-border">
                {visibleHistory.map((m) => {
                  const b = m.box ?? "partnerships";
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => m.threadId && openThread({ threadId: m.threadId, subject: m.subject, box: b, contact: selected.email })}
                        className={cn("flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors sm:px-8", m.threadId ? "hover:bg-rowhover" : "cursor-default")}
                      >
                        <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", BOX_STYLE[b].soft)} title={m.direction === "in" ? "Reçu" : "Envoyé"}>
                          {m.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">{m.subject || "(sans objet)"}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtDate(m.date)}</span>
                          </span>
                          <span className="mt-1 flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-[11px] text-muted-foreground">{m.direction === "in" ? "Reçu" : "Envoyé"}</span>
                            <BoxChip box={b} className="text-[10px]" />
                            {m.source === "mediakit" && (
                              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Media kit</span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{decodeEntities(m.snippet)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  // ── Lecture vide (ordinateur) ────────────────────────────────────────────
  const emptyReader = (
    <section className="hidden min-h-0 min-w-0 flex-col items-center justify-center gap-3 px-6 text-center lg:flex">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted"><Mail className="h-5 w-5 text-muted-foreground" /></span>
      <p className="text-[14px] font-medium text-foreground">{mode === "contacts" ? "Aucun contact ouvert" : mode === "drafts" ? "Aucun brouillon ouvert" : "Aucun mail ouvert"}</p>
      <p className="max-w-[320px] text-[13px] text-muted-foreground">
        {mode === "contacts"
          ? "Choisis un contact pour voir tous vos échanges, dans les deux boîtes."
          : mode === "drafts"
            ? "Choisis un brouillon pour le reprendre : une réponse s'ouvre dans son fil, un nouveau mail dans la fenêtre d'écriture. Rien ne part sans ton clic sur Envoyer."
            : "Choisis un mail dans la liste pour le lire ici."}
      </p>
      {mode !== "contacts" && mode !== "drafts" && (
        <p className="flex flex-wrap items-center justify-center gap-1.5 text-[12px] text-faint">
          <Kbd className="bg-muted text-muted-foreground">j</Kbd><Kbd className="bg-muted text-muted-foreground">k</Kbd> pour parcourir,
          <Kbd className="bg-muted text-muted-foreground">?</Kbd> pour tous les raccourcis
        </p>
      )}
      <button
        type="button"
        onClick={openNewMail}
        className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover"
      >
        <PenLine className="h-3.5 w-3.5" /> Nouveau mail
      </button>
    </section>
  );

  // ── Par créateur : ses échanges (talent@, son alias), statuts et remarques ──
  const creatorsCol = (
    <section className="min-h-0 min-w-0 overflow-y-auto" aria-label="Par créateur">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-center gap-1">
          {creatorView && <ToolButton icon={ArrowLeft} label="Tous les créateurs" className="-ml-2" onClick={() => setCreatorView(null)} />}
          <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight text-foreground sm:text-[22px]">Par créateur</h2>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Ses échanges (talent@, son alias), rangés par statut, avec les remarques qu'il voit dans son espace.
        </p>
        {creatorView && creatorChoices.length > 1 && (
          <Tabs
            className="mt-3"
            size="sm"
            wrap
            label="Créateur"
            value={creatorView.name}
            onValueChange={(v) => openCreator(v)}
            items={creatorChoices.map((n) => ({
              value: n,
              label: titleCase(n),
              count: mailCount(n) || undefined,
              icon: <CreatorAvatar name={n} photoUrl={photoOf(n)} className="h-4 w-4 rounded-full text-[7px]" />,
            }))}
          />
        )}
      </div>
      <div className="px-4 pb-6 pt-4 sm:px-6">
        {creatorView ? (
          <Suspense fallback={<div className="flex items-center justify-center gap-2 p-10 text-[13px] text-muted-foreground"><Loader variant="dots" size={16} /> Chargement…</div>}>
            <CreatorMailsAgency
              key={`${creatorView.name}-${creatorView.threadId ?? ""}`}
              creator={creatorView.name}
              suggestedAlias={emailPro?.get(creatorView.name.trim().toLowerCase()) ?? null}
              initialThreadId={creatorView.threadId}
              initialFilter={!creatorView.threadId && mailCount(creatorView.name) > 0 ? "atraiter" : undefined}
              onSaved={() => setLinkedTick((n) => n + 1)}
              className="mt-0"
            />
          </Suspense>
        ) : creatorChoices.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">Aucun créateur actif dans le Roster.</p>
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
                      {l
                        ? l.addresses.length > 1 ? `${l.addresses[0]} +${l.addresses.length - 1}` : l.addresses[0] ?? "Libellé Gmail"
                        : "Pas encore relié"}
                    </span>
                  </span>
                  {mailCount(n) > 0 && (
                    <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold tabular-nums text-background">
                      {mailCount(n)} à traiter
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <>
      <div
        ref={rootRef}
        style={fillH ? { height: fillH } : undefined}
        className={cn(
          "flex min-w-0 flex-col overflow-clip rounded-2xl border border-border bg-surface lg:grid lg:min-h-[560px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden",
          mode === "creators"
            ? "lg:grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[208px_minmax(0,1fr)]"
            : "lg:grid-cols-[72px_minmax(320px,360px)_minmax(0,1fr)] xl:grid-cols-[208px_minmax(300px,360px)_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(330px,400px)_minmax(0,1fr)]",
        )}
      >
        {rail}
        {wideRail}
        {mobileNav}
        {mode === "creators" ? (
          creatorsCol
        ) : (
          <>
            {mode === "contacts" ? contactsCol : mode === "drafts" ? draftsCol : inboxCol}
            {thread ? threadReader : mode === "contacts" && selected ? contactReader : emptyReader}
          </>
        )}
      </div>

      {/* Archivé / mis à la corbeille : « Annuler » pendant 10 s. */}
      {undo && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[1301] flex justify-center px-4 md:bottom-24">
          <div role="status" className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg shadow-black/5">
            {undo.kind === "trash" ? <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
              « {undo.t.subject || "(sans objet)"} » {undo.kind === "trash" ? "mis à la corbeille" : "archivé"}
            </span>
            <button type="button" onClick={() => void undoLast()}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover">
              <Undo2 className="h-3.5 w-3.5" /> Annuler
            </button>
          </div>
        </div>
      )}

      {/* Aide des raccourcis clavier (?) */}
      {helpOpen && (
        <>
          <div className="fixed inset-0 z-[1199]" onClick={() => setHelpOpen(false)} />
          <div role="dialog" data-mails-help aria-label="Raccourcis clavier" className="fixed bottom-6 right-6 z-[1200] w-[300px] rounded-2xl border border-border bg-surface p-4 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-[13px] font-semibold text-foreground">Raccourcis clavier</span>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label="Fermer"
                className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
              {SHORTCUTS.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt><Kbd className="bg-muted px-1.5 text-foreground">{k}</Kbd></dt>
                  <dd className="text-muted-foreground">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      <ForwardDialog
        message={forward?.msg ?? null}
        subject={forward?.subject ?? ""}
        defaultBox={forward?.box ?? "partnerships"}
        sourceBox={forward?.box}
        onClose={() => setForward(null)}
        onReopen={(p: ForwardReopen) => setForward({ msg: p.message, subject: p.subject, box: p.sourceBox ?? p.defaultBox })}
      />
      <MailSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewMailDialog
        open={newMailOpen}
        floating
        expandKey={newMailKey}
        defaultBox={box === "talent" ? "talent" : "partnerships"}
        onClose={() => setNewMailOpen(false)}
        onSent={() => void refreshList("sent")}
        onReopen={newMailDraft ? () => openGmailDraft(newMailDraft) : openNewMail}
        gmailDraft={newMailDraft}
        onGmailDraftDone={(d, deleted) => {
          if (deleted) hideDraft(d, true);
          window.setTimeout(() => void refreshDrafts(), 2_000);
        }}
      />

      {/* Supprimer un brouillon (Gmail : définitif ; appareil : copie locale). */}
      {delAsk && (
        <ConfirmDialog
          title="Supprimer ce brouillon ?"
          message={delAsk.kind === "gmail"
            ? `« ${delAsk.row.subject || "(sans objet)"} » sera supprimé de Gmail (${BOX_LABEL[delAsk.row.box]}). Un brouillon supprimé ne se récupère pas.`
            : `« ${delAsk.subject || "(sans objet)"} » sera supprimé de cet appareil.`}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setDelAsk(null)}
          onConfirm={() => {
            const it = delAsk;
            setDelAsk(null);
            void deleteDraftItem(it);
          }}
        />
      )}

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
            setContacts((prev) => prev && prev.map(upd));
            setSelected((prev) => (prev ? upd(prev) : prev));
          });
        }}
      />
    </>
  );
}

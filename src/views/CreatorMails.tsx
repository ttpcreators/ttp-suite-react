import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, AtSign, Check, CircleHelp, History, Hourglass, Inbox, Info, Loader2, Mail, MessageSquare, RefreshCw, SearchCheck, Send, Settings2, Tag, X,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { DashPanel, DashSectionTitle } from "@/components/ui/dash";
import { notifyAgency, notifyCreator } from "@/lib/push";
import { myDisplayName } from "@/lib/team";
import {
  statusMeta, listMails, getMailThread, sendManagerNote, sendDecision, listGmailLabels, getStatusHistory,
  getThreadNotes, buildFeed, choiceOf, autoStatusOf,
  type Decision, type FeedItem, type MailChoice, type MailNote, type MailStatus, type MailStatusEvent, type MailThread,
  type MailThreadLite, type MailSettings,
} from "@/lib/creatorMail";
import { Initial, MailItem, fmtWhen } from "@/components/mail-reader";

/*
 * Section « Mails » (lecture seule) : les échanges de la boîte agence où apparaît
 * l'alias de la créatrice. Trois usages :
 *   - "creator" : la créatrice (lecture, son avis, « Écrire à mon manager ») ;
 *   - "agency"  : fiche créatrice côté agence (statut + lecture du suivi) ;
 *   - "preview" : l'agence regarde l'espace créateur (un choix y est noté au nom de l'agence).
 * Le filtrage est fait par le serveur (fonction creator-mail) : ce composant ne
 * reçoit jamais un mail qui ne concerne pas la créatrice.
 */
type Mode = "creator" | "agency" | "preview";

/** Statut discret (pastille + texte) pour les lignes de la liste, avec l'auteur du choix. */
function StatusDot({ status, by }: { status: string; by?: string }) {
  const m = statusMeta(status);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", m.dot)} />
      {m.label}
      {by && <span className="truncate text-faint">· par {by}</span>}
    </span>
  );
}

const FILTERS: { key: "tous" | "encours" | "atraiter" | "valide" | "refuse"; label: string; dot?: string; match: (s: MailStatus) => boolean }[] = [
  { key: "tous", label: "Tous les échanges", match: () => true },
  { key: "encours", label: "En cours", dot: "bg-amber-500", match: (s) => s === "nouvelle" || s === "negociation" },
  { key: "atraiter", label: "À vérifier / valider", dot: "bg-orange-500", match: (s) => s === "a_verifier" || s === "a_valider" },
  { key: "valide", label: "Validés", dot: "bg-emerald-500", match: (s) => s === "valide" },
  { key: "refuse", label: "Refusés", dot: "bg-red-500", match: (s) => s === "refuse" },
];

/**
 * Cases du grand sélecteur (mêmes couleurs que les tuiles du haut). « À vérifier » et
 * « À valider » sont posés par l'agence (la créatrice les voit, sans pouvoir les choisir).
 */
const CHOICES: { value: MailChoice; label: string; hint: string; icon: LucideIcon; tile: string; disc: string; confirm: string; agencyOnly?: boolean }[] = [
  {
    value: "encours", label: "En cours", hint: "On en discute", icon: Hourglass,
    tile: "border-amber-500/70 bg-amber-500/[0.09] text-amber-800 dark:text-amber-300",
    disc: "bg-amber-500 text-zinc-950", confirm: "bg-amber-500 text-zinc-950",
  },
  {
    value: "a_verifier", label: "À vérifier", hint: "Un point à contrôler", icon: SearchCheck, agencyOnly: true,
    tile: "border-orange-500/70 bg-orange-500/[0.09] text-orange-800 dark:text-orange-300",
    disc: "bg-orange-500 text-white", confirm: "bg-orange-500 text-white",
  },
  {
    value: "a_valider", label: "À valider", hint: "Réponse attendue", icon: CircleHelp, agencyOnly: true,
    tile: "border-indigo-500/70 bg-indigo-500/[0.09] text-indigo-800 dark:text-indigo-300",
    disc: "bg-indigo-500 text-white", confirm: "bg-indigo-500 text-white",
  },
  {
    value: "valide", label: "Validé", hint: "C'est oui", icon: Check,
    tile: "border-emerald-600/70 bg-emerald-500/[0.09] text-emerald-800 dark:text-emerald-300",
    disc: "bg-emerald-600 text-white", confirm: "bg-emerald-600 text-white",
  },
  {
    value: "refuse", label: "Refusé", hint: "C'est non", icon: X,
    tile: "border-red-500/70 bg-red-500/[0.08] text-red-700 dark:text-red-300",
    disc: "bg-red-600 text-white", confirm: "bg-red-600 text-white",
  },
];
const choiceMeta = (c: MailChoice) => CHOICES.find((x) => x.value === c) ?? CHOICES[0];

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const fmtStamp = (ts: number) =>
  new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Auteur d'un choix, vu par la personne qui regarde (« toi », « ton agence », « Chloé », « l'agence »). */
const authorName = (by: "creator" | "agency", mode: Mode, creatorName: string) =>
  mode === "creator" ? (by === "creator" ? "toi" : "ton agence") : by === "creator" ? creatorName : "l'agence";
const authorSubject = (by: "creator" | "agency", mode: Mode, creatorName: string) =>
  mode === "creator" ? (by === "creator" ? "Tu as" : "Ton agence a") : by === "creator" ? `${creatorName} a` : "L'agence a";
const VERB: Record<MailChoice, string> = {
  encours: "remis l'échange en cours", valide: "validé l'échange", refuse: "refusé l'échange",
  a_verifier: "passé l'échange en « À vérifier »", a_valider: "passé l'échange en « À valider »",
};
/** Texte de la notification envoyée à l'agence quand la créatrice choisit. */
const PUSH_VERB: Record<"encours" | "valide" | "refuse", string> = { encours: "a remis en cours", valide: "a validé", refuse: "a refusé" };

/**
 * Grand sélecteur sous l'en-tête d'un échange : « En cours », « Validé », « Refusé »
 * (+ « À vérifier » et « À valider » côté agence). Un clic ouvre une confirmation avec
 * un mot facultatif, puis le choix est enregistré et noté dans le suivi.
 */
function StatusPanel({
  thread, mode, creatorName, creatorSees, busy, feedCount, onChoose, onShowFeed,
}: {
  thread: MailThread; mode: Mode; creatorName: string; creatorSees: boolean; busy: boolean; feedCount: number;
  onChoose: (choice: MailChoice, comment: string) => Promise<boolean>;
  onShowFeed: () => void;
}) {
  const real = choiceOf(thread.status);
  // Créatrice : trois cases ; un statut posé par l'agence (« À valider »…) s'affiche
  // dans un bandeau, la case « En cours » restant cochée.
  const tiles = mode === "creator" ? CHOICES.filter((c) => !c.agencyOnly) : CHOICES;
  const flagged = mode === "creator" && !!choiceMeta(real).agencyOnly ? choiceMeta(real) : null;
  const current: MailChoice = flagged ? "encours" : real;
  const [pending, setPending] = useState<MailChoice | null>(null);
  const [comment, setComment] = useState("");
  const pick = pending ? choiceMeta(pending) : null;
  const when = fmtDay(thread.decidedAt);

  const hintFor = (c: (typeof CHOICES)[number]) => {
    if (c.value !== current) return c.hint;
    // Case active : « Nouvelle demande » / « En négociation », ou qui a tranché et quand.
    if (c.value === "encours") return flagged ? `${flagged.label}, par ton agence` : statusMeta(thread.status).label;
    return thread.decidedBy ? `par ${authorName(thread.decidedBy, mode, creatorName)}${when ? `, ${when}` : ""}` : c.hint;
  };

  const confirm = async () => {
    if (!pending || busy) return;
    if (await onChoose(pending, comment)) {
      setPending(null);
      setComment("");
    }
  };

  return (
    <div className="border-b border-border px-4 py-3.5 sm:px-6">
      <div className="mb-2.5 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-foreground">
          {mode === "creator" ? "Ton avis sur cet échange" : "Où en est cet échange ?"}
        </p>
        {feedCount > 0 && (
          <button type="button" onClick={onShowFeed}
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
            <History className="h-3.5 w-3.5" /> Voir le suivi ({feedCount})
          </button>
        )}
      </div>

      {flagged && (
        <div className={cn("mb-2.5 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12px]", flagged.tile)}>
          <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", flagged.disc)}><flagged.icon className="h-3.5 w-3.5" /></span>
          <span className="min-w-0 pt-0.5">
            <b>Ton agence a passé cet échange en « {flagged.label} »{when ? ` le ${when.replace(/\.$/, "")}` : ""}.</b>{" "}
            {flagged.value === "a_valider" ? "C'est à toi de répondre : Validé ou Refusé." : "Elle vérifie un point avant d'aller plus loin."}
          </span>
        </div>
      )}
      <div role="radiogroup" aria-label="Statut de l'échange" className={cn("grid gap-2", tiles.length > 3 ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-3")}>
        {tiles.map((c) => {
          const active = c.value === current;
          const picked = c.value === pending;
          const Icon = c.icon;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => setPending(active ? null : c.value)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-60",
                // Trois cases : icône à gauche sur ordinateur ; cinq cases : empilées, plus lisibles.
                tiles.length <= 3 && "sm:flex-row sm:gap-3 sm:px-3.5 sm:py-3 sm:text-left",
                active ? cn(c.tile, "cursor-default")
                  : picked ? "border-foreground/40 bg-rowhover text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
              )}
            >
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors", active || picked ? c.disc : "bg-muted text-muted-foreground")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 max-w-full flex-col">
                <span className="text-[14px] font-semibold leading-tight">{c.label}</span>
                <span className="truncate text-[11px] opacity-80 sm:text-[12px]">{hintFor(c)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {pick && (
        <div className="mt-3 rounded-xl border border-border bg-surface p-3">
          <p className="text-[13px] font-medium text-foreground">Passer cet échange en « {pick.label} » ?</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void confirm();
              if (e.key === "Escape") setPending(null);
            }}
            maxLength={1000}
            rows={2}
            placeholder={mode === "creator" ? "Un mot pour ton manager (facultatif) : pourquoi, tes conditions…" : `Un mot pour ${creatorName} (facultatif)`}
            className="mt-2 max-h-40 min-h-[60px] w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-faint focus:border-primary"
          />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto w-full text-[11px] text-faint sm:w-auto">
              {mode === "creator" ? "Ton manager reçoit une notification." : creatorSees ? `${creatorName} reçoit une notification.` : "Sa section Mails n'est pas encore activée : pas de notification."}
            </span>
            <button type="button" onClick={() => setPending(null)} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
              Annuler
            </button>
            <button type="button" onClick={() => void confirm()} disabled={busy}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50", pick.confirm)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmer
            </button>
          </div>
        </div>
      )}

      {mode === "preview" && !pick && (
        <p className="mt-2 text-[11px] text-muted-foreground">Aperçu de ce que voit {creatorName}. Un choix fait ici est noté au nom de l'agence.</p>
      )}
    </div>
  );
}

/** Suivi d'un échange : messages de la créatrice et changements de statut, dans l'ordre. */
function Feed({ items, mode, creatorName }: { items: FeedItem[]; mode: Mode; creatorName: string }) {
  const asAgency = mode !== "creator";
  return (
    <ul className="mb-3 flex flex-col gap-2.5">
      {items.map((it) => {
        if (it.kind === "note") {
          const n = it.note;
          const byAgency = n.by_role === "agency";
          // À droite ce qui vient de soi : la créatrice voit les remarques de l'agence à gauche.
          const mine = asAgency === byAgency;
          const author = byAgency
            ? (asAgency ? n.author_name || "L'agence" : `Ton agence${n.author_name ? ` · ${n.author_name}` : ""}`)
            : asAgency ? creatorName : null;
          return (
            <li key={`n-${n.id}`} className={cn("max-w-[85%] rounded-2xl border px-3.5 py-2.5", byAgency ? "border-primary/20 bg-primary/[0.05]" : "border-border bg-surface", mine ? "self-end rounded-br-md" : "self-start rounded-bl-md")}>
              {author && <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{author}</p>}
              <p className="whitespace-pre-wrap text-[13px] text-foreground [overflow-wrap:anywhere]">{n.body}</p>
              <p className="mt-1 text-[11px] text-faint">
                {fmtStamp(it.at)}
                {!asAgency && !byAgency && (n.agency_read_at ? " · lu" : " · envoyé")}
              </p>
            </li>
          );
        }
        const e: MailStatusEvent = it.event;
        const c = choiceMeta(e.status);
        const Icon = c.icon;
        // Chacun de son côté, comme une conversation : à droite ce qui vient de soi.
        const mine = (mode === "creator") === (e.by_role === "creator");
        return (
          <li key={`e-${e.id}`} className={cn("flex max-w-[85%] flex-col gap-1", mine ? "items-end self-end" : "items-start self-start")}>
            <span className="inline-flex max-w-full items-start gap-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted-foreground">
              <span className={cn("mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full", c.disc)}><Icon className="h-2.5 w-2.5" /></span>
              <span className="min-w-0">
                <span className="font-medium text-foreground">{authorSubject(e.by_role, mode, creatorName)} {VERB[e.status]}</span>
                <span className="text-faint"> · {fmtStamp(it.at)}</span>
              </span>
            </span>
            {e.comment && (
              <p className={cn("whitespace-pre-wrap rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[13px] text-foreground [overflow-wrap:anywhere]", mine ? "rounded-br-md" : "rounded-bl-md")}>
                {e.comment}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** « TTP CREATORS » → « TTP Creators » (les mots de 3 lettres ou moins restent en capitales). */
function prettyName(n: string): string {
  if (!n || n !== n.toUpperCase() || !/[A-Z]/.test(n)) return n;
  return n.toLowerCase().replace(/\p{L}[\p{L}'’-]*/gu, (w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
}

export function CreatorMailbox({ creator, mode, creatorSees = true, initialThreadId }: {
  creator: string; mode: Mode;
  /** La créatrice a-t-elle accès à sa section Mails ? (sinon pas de notification pour elle) */
  creatorSees?: boolean;
  /** Échange à ouvrir directement (lien depuis la page Mails de l'agence). */
  initialThreadId?: string;
}) {
  const asAgency = mode !== "creator";
  const forCreator = asAgency ? creator : undefined;
  const creatorName = prettyName(titleCase(creator));
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
  const [reloadKey, setReloadKey] = useState(0);
  const [deciding, setDeciding] = useState(false);
  // Historique des statuts de l'échange ouvert (events null = SQL pas encore lancé).
  const [history, setHistory] = useState<{ id: string; events: MailStatusEvent[] | null } | null>(null);
  // Suivi écrit (messages de la créatrice + remarques de l'agence), lu directement.
  const [threadNotes, setThreadNotes] = useState<{ id: string; list: MailNote[] } | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const initialRef = useRef(initialThreadId ?? null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await listMails(forCreator);
      setConfigured(r.configured);
      setThreads(r.threads);
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      // Échange demandé par un lien (une seule fois), sinon sur ordinateur le dernier.
      const wanted = initialRef.current && r.threads.some((t) => t.id === initialRef.current) ? initialRef.current : null;
      initialRef.current = null;
      setOpenId((cur) => {
        // Échange ouvert disparu (supprimé dans Gmail…) : on le ferme.
        const still = cur && r.threads.some((t) => t.id === cur) ? cur : null;
        return wanted ?? still ?? (desktop && r.threads.length ? r.threads[0].id : null);
      });
      setReloadKey((n) => n + 1); // recharge aussi l'échange ouvert (nouvelles réponses)
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
    setThreadErr(null);
    // Même échange rechargé (« Actualiser ») : pas de clignotement.
    setThread((t) => (t && t.id === openId ? t : null));
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
    getStatusHistory(creator, openId).then((events) => alive && setHistory({ id: openId, events }));
    getThreadNotes(creator, openId).then((list) => alive && list && setThreadNotes({ id: openId, list }));
    return () => {
      alive = false;
    };
  }, [openId, forCreator, creator, mode, reloadKey]);

  const applyDecision = (threadId: string, d: Decision & { status: MailStatus }) => {
    setThreads((l) => l?.map((t) => (t.id === threadId ? { ...t, ...d } : t)) ?? l);
    setThread((t) => (t && t.id === threadId ? { ...t, ...d } : t));
  };

  /**
   * Range l'échange dans « En cours », « Validé » ou « Refusé », avec un mot facultatif.
   * Créatrice : via le serveur (vérifie que l'échange est à elle, note la trace).
   * Agence : écriture directe (RLS agence) + ligne d'historique à son nom.
   */
  const choose = async (threadId: string, choice: MailChoice, comment: string): Promise<boolean> => {
    if (deciding) return false;
    setDeciding(true);
    const word = comment.trim().slice(0, 1000);
    const open = thread && thread.id === threadId ? thread : null;
    const lite = threads?.find((x) => x.id === threadId);
    const what = prettyName(lite?.brand || open?.brand || "") || lite?.subject || open?.subject || "un échange";
    const label = choiceMeta(choice).label;
    try {
      if (mode === "creator") {
        // La créatrice ne choisit qu'entre En cours, Validé et Refusé.
        if (choice === "a_verifier" || choice === "a_valider") return false;
        const r = await sendDecision(threadId, choice, word);
        applyDecision(threadId, r);
        notifyAgency("mail", creator, `${PUSH_VERB[choice]} : ${what}${word ? ` · « ${word} »` : ""}`);
        toast(`${label} ✓ Ton manager est prévenu`);
      } else {
        const now = new Date().toISOString();
        const row: Record<string, string | null> = choice === "encours"
          ? { creator, thread_id: threadId, status: "nouvelle", decided_by: null, decided_at: null, updated_at: now }
          : { creator, thread_id: threadId, status: choice, decided_by: "agency", decided_at: now, updated_at: now };
        let { error } = await supabase.from("creator_mail_threads").upsert(row, { onConflict: "creator,thread_id" });
        // SQL « décision » pas encore lancé : on enregistre au moins le statut.
        if (error && /decided_/.test(error.message)) {
          ({ error } = await supabase.from("creator_mail_threads")
            .upsert({ creator, thread_id: threadId, status: row.status, updated_at: now }, { onConflict: "creator,thread_id" }));
        }
        if (error) {
          toast(/status_check/.test(error.message) ? "Lance d'abord le SQL « remarques » dans Supabase." : "Statut non enregistré, réessaie");
          return false;
        }
        // Trace à son nom (sans effet tant que le SQL « historique » n'est pas lancé).
        const { data: auth } = await supabase.auth.getSession();
        const uid = auth.session?.user.id;
        if (uid) {
          await supabase.from("creator_mail_status_log").insert({
            creator, thread_id: threadId, status: choice, by_role: "agency", author_user_id: uid, comment: word || null,
          });
        }
        applyDecision(threadId, choice === "encours"
          ? { status: open ? autoStatusOf(open.messages) : "nouvelle", decidedBy: null, decidedAt: null }
          : { status: choice, decidedBy: "agency", decidedAt: now });
        if (creatorSees) notifyCreator("mail", creator, `${what} : ${label} par ton agence${word ? ` · « ${word} »` : ""}`);
        toast(`Statut enregistré : ${label} ✓`);
      }
      const events = await getStatusHistory(creator, threadId);
      // Un autre échange a été ouvert entre-temps : on ne touche pas à son historique.
      setHistory((cur) => (cur && cur.id !== threadId ? cur : { id: threadId, events }));
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    } finally {
      setDeciding(false);
    }
  };

  const addNote = (threadId: string, n: MailNote) => {
    setThread((t) => (t && t.id === threadId ? { ...t, notes: [...t.notes, n] } : t));
    setThreadNotes((cur) => (cur && cur.id === threadId ? { id: threadId, list: [...cur.list, n] } : cur));
    setThreads((l) => l?.map((t) => (t.id === threadId ? { ...t, notes: t.notes + 1 } : t)) ?? l);
  };

  const submitNote = async () => {
    if (!thread || !note.trim() || sending) return;
    setSending(true);
    const body = note.trim();
    const what = prettyName(thread.brand) || thread.subject;
    try {
      if (mode === "creator") {
        const n = await sendManagerNote(thread.id, body);
        addNote(thread.id, { ...n, by_role: "creator" });
        notifyAgency("mail", creator, `${what} : ${body}`);
        toast("Message envoyé à ton manager ✓");
      } else {
        // Remarque de l'agence : visible par la créatrice dans le suivi de l'échange.
        const { data: auth } = await supabase.auth.getSession();
        const uid = auth.session?.user.id;
        if (!uid) return;
        const now = new Date().toISOString();
        const { data, error } = await supabase.from("creator_mail_notes").insert({
          creator, thread_id: thread.id, author_user_id: uid, body, by_role: "agency",
          author_name: await myDisplayName(), agency_read_at: now,
        }).select("*").single();
        if (error) {
          toast(/by_role|author_name|row-level/.test(error.message) ? "Lance d'abord le SQL « remarques » dans Supabase." : "Remarque non enregistrée, réessaie");
          return;
        }
        addNote(thread.id, data as MailNote);
        if (creatorSees) notifyCreator("mail", creator, `Remarque de ton agence · ${what} : ${body}`);
        toast(creatorSees ? `Remarque envoyée à ${creatorName} ✓` : "Remarque enregistrée ✓");
      }
      setNote("");
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

  // Suivi de l'échange ouvert. Une ancienne décision (avant l'historique) n'est ajoutée
  // qu'une fois l'historique chargé, pour éviter un clignotement.
  const events = thread && history?.id === thread.id ? history.events : undefined;
  const notesList = thread ? (threadNotes?.id === thread.id ? threadNotes.list : thread.notes) : [];
  const feed = thread
    ? buildFeed(notesList, events ?? null, events === undefined ? undefined : { status: thread.status, decidedBy: thread.decidedBy, decidedAt: thread.decidedAt })
    : [];

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

  const kpis = (
    <DashPanel className="grid grid-cols-2 gap-px bg-border lg:grid-cols-5">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => setFilter(f.key)}
          aria-pressed={filter === f.key}
          className={cn(
            "flex min-w-0 flex-col items-start bg-surface px-4 py-3.5 text-left transition-colors last:max-lg:col-span-2 sm:px-5 sm:py-4",
            filter === f.key ? "bg-rowhover" : "hover:bg-rowhover/60",
          )}
        >
          <span className={cn("flex items-center gap-1.5 text-[12px] sm:text-[13px]", filter === f.key ? "text-foreground" : "text-muted-foreground")}>
            {f.dot && <span className={cn("size-1.5 rounded-full", f.dot)} />}
            {f.label}
          </span>
          <span className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums text-foreground sm:text-[26px]">{counts[f.key]}</span>
        </button>
      ))}
    </DashPanel>
  );

  const list = (
    <section className={cn("flex min-h-0 min-w-0 flex-col lg:border-r lg:border-border", openId && "max-lg:hidden")}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex-1 text-[13px] font-semibold text-foreground">
          {cur.key === "tous" ? "Boîte de réception" : cur.label}
          <span className="ml-1.5 font-normal tabular-nums text-faint">{shown.length}</span>
        </span>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover disabled:opacity-60">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Actualiser
        </button>
      </div>
      {err && <div className="border-b border-border px-4 py-2.5 text-[12px] text-red-600 dark:text-red-400">{err}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-muted"><Mail className="h-4 w-4 text-muted-foreground" /></span>
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
                  <Initial name={prettyName(t.brand)} email={t.brandEmail} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{prettyName(t.brand) || "Marque"}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtWhen(t.ts)}</span>
                    </span>
                    <span className="truncate text-[13px] text-foreground">
                      {t.subject}
                      {t.count > 1 && <span className="ml-1 text-faint">{t.count}</span>}
                    </span>
                    <span className="line-clamp-1 text-[12px] text-muted-foreground">{t.excerpt}</span>
                    <span className="mt-1 flex min-w-0 items-center gap-3">
                      <StatusDot status={t.status} by={t.decidedBy ? authorName(t.decidedBy, mode, creatorName) : undefined} />
                      {t.notes > 0 && (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="Messages au manager">
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
      </div>
    </section>
  );

  const view = openId ? (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-6">
        <button type="button" onClick={() => setOpenId(null)} aria-label="Retour à la liste"
          className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">{thread?.subject ?? "Chargement…"}</h2>
          {thread && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {thread.brand ? `${prettyName(thread.brand)} · ` : ""}{thread.messages.length} message{thread.messages.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
      {thread && (
        <StatusPanel
          key={thread.id}
          thread={thread}
          mode={mode}
          creatorName={creatorName}
          creatorSees={creatorSees}
          busy={deciding}
          feedCount={feed.length}
          onChoose={(c, w) => choose(thread.id, c, w)}
          onShowFeed={() => feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {threadErr ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">{threadErr}</div>
        ) : !thread ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Ouverture…</div>
        ) : (
          <>
            <div className="flex flex-col gap-3 bg-panel/60 p-3 sm:p-4">
              {thread.messages.map((m, i) => (
                <MailItem
                  key={m.id}
                  m={m}
                  index={i}
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

            {/* Suivi interne avec le manager : avis, questions, changements de statut (jamais envoyés à la marque) */}
            <div ref={feedRef} className="scroll-mt-2 border-t border-border bg-muted/40 px-4 py-5 sm:px-6">
              <div className="mb-1 flex items-center gap-2">
                <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-[13px] font-semibold text-foreground">{asAgency ? `Suivi avec ${creatorName}` : "Suivi avec ton manager"}</span>
              </div>
              <p className="mb-3 pl-6 text-[12px] text-muted-foreground">
                {asAgency
                  ? `Ses avis, ses questions, tes remarques et chaque changement de statut, avec la date. ${creatorName} voit tout ce suivi ; la marque, jamais.`
                  : "Tes avis, tes questions, les remarques et les choix de ton agence. La marque ne voit jamais rien de tout ça."}
              </p>
              {feed.length > 0 ? (
                <Feed items={feed} mode={mode} creatorName={creatorName} />
              ) : null}
              <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-1.5 pl-3.5 focus-within:border-primary">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 4000))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitNote();
                  }}
                  rows={1}
                  placeholder={asAgency ? `Écrire une remarque à ${creatorName}…` : "Écrire à mon manager…"}
                  className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={() => void submitNote()}
                  disabled={!note.trim() || sending}
                  aria-label={asAgency ? "Envoyer la remarque" : "Envoyer à mon manager"}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  ) : (
    <section className="hidden min-h-0 flex-col items-center justify-center gap-3 px-6 text-center lg:flex">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted"><Inbox className="h-5 w-5 text-muted-foreground" /></span>
      <p className="text-[14px] font-medium text-foreground">Aucun échange ouvert</p>
      <p className="max-w-[280px] text-[13px] text-muted-foreground">Choisis un échange dans la liste pour lire la conversation avec la marque.</p>
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      {kpis}
      {/* Comment les statuts avancent (affiché pour éviter toute confusion). */}
      <p className="-mt-1 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {asAgency
            ? `Ouvre un échange et range-le avec le grand sélecteur : En cours, À vérifier, À valider, Validé ou Refusé. Écris-lui une remarque en bas de l'échange. ${creatorName} voit tout dans son espace et donne son avis ; chaque changement (qui, quand, son mot) est gardé dans le suivi.`
            : "Ouvre un échange et range-le dans « En cours », « Validé » ou « Refusé » pour donner ton avis, avec un mot si tu veux. Ton manager est prévenu ; ses remarques et tout l'historique sont dans le suivi de l'échange."}
        </span>
      </p>
      {/* Messagerie : liste + lecture dans un seul panneau (hauteur fixe sur ordinateur, défilement interne). */}
      <DashPanel className="flex min-w-0 flex-col lg:grid lg:h-[min(860px,calc(100dvh-260px))] lg:min-h-[560px] lg:grid-cols-[minmax(300px,370px)_minmax(0,1fr)]">
        {list}
        {view}
      </DashPanel>
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

      {linked && !editing && <CreatorMailbox creator={creator} mode="agency" creatorSees={!!settings?.enabled} />}
    </div>
  );
}

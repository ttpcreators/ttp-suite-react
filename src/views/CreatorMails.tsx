import { useStickyState } from "@/lib/useStickyState";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TONE_SOLID, TONE_TILE } from "@/lib/statusTone";
import { Loader, Spin } from "@/components/ui/loader";
import { Picker } from "@/components/ui/form";
import { ArrowLeft, AtSign, Check, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, History, Hourglass, ImageOff, Inbox, Info, Link2, Mail, MessageSquare, MessageSquarePlus, Plus, RefreshCw, SearchCheck, Send, Settings2, Tag, X, Copy, type LucideIcon, Megaphone, EyeOff } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { DashPanel, DashSectionTitle } from "@/components/ui/dash";
import { notifyAgency, notifyCreator } from "@/lib/push";
import { myDisplayName } from "@/lib/team";
import { useLive } from "@/lib/useLive";
import { creatorUnreadNoteIds, isMailTodo, markCreatorNotesRead, reportCreatorThreads, useCreatorMailCounts } from "@/lib/creatorMailCounts";
import { SHARED_BOXES, emailOf } from "@/lib/mailAvatar";
import {
  SHARED_BOX_MESSAGE, aliasesColumnMissing, allAddresses, checkNewAddress, extraAddresses, joinWith,
} from "@/lib/mailAddresses";
import {
  statusMeta, listMails, getMailThread, sendManagerNote, sendDecision, listGmailLabels, getStatusHistory,
  getThreadNotes, buildFeed, choiceOf, autoStatusOf, errorCode, getMailDb, dbStatus, MailError, CREATOR_UNAVAILABLE,
  hasRemoteImages, withoutRemoteImages, remoteImagesAllowed, allowRemoteImages,
  reportMailList, reportAgencyActivity, markThreadSeen, useUnseenMail,
  type Decision, type FeedItem, type MailChoice, type MailNote, type MailStatus, type MailStatusEvent, type MailThread,
  type MailThreadLite, type MailSettings, prospectStats } from "@/lib/creatorMail";
import { Initial, MailItem, fmtWhen } from "@/components/mail-reader";
import { BarButton, RailButton, SearchField, ToolButton, UnreadToggle, mailCardBtnCls, mailCardCls, mailCardListCls, pillCls } from "@/components/mail-shell";
import { Tabs } from "@/components/ui/animated-tabs";
import { useLocale, useT, type Vars } from "@/lib/i18n";

type T = (fr: string, vars?: Vars) => string;

/*
 * Section « Mails » (lecture seule) : les échanges de la boîte agence où apparaît
 * l'alias du créateur. Trois usages :
 *   - "creator" : le créateur (lecture, son avis, ses remarques à son manager) ;
 *   - "agency"  : fiche créateur côté agence (statut + lecture du suivi) ;
 *   - "preview" : l'agence regarde l'espace créateur (un choix y est noté au nom de l'agence).
 * Le filtrage est fait par le serveur (fonction creator-mail) : ce composant ne
 * reçoit jamais un mail qui ne concerne pas le créateur.
 *
 * Fraîcheur : la liste Gmail est relue au plus toutes les 3 min (écran visible) ;
 * entre deux, chaque rafraîchissement de l'app relit seulement la base (statuts,
 * remarques, historique de l'échange ouvert). « Actualiser » force une relecture complète.
 */
type Mode = "creator" | "agency" | "preview";

const LIST_EVERY = 3 * 60_000;
const DESKTOP = "(min-width: 1024px)";
const isNarrow = () => typeof window !== "undefined" && !window.matchMedia(DESKTOP).matches;
/** Affiché à l'écran (pas dans une page masquée gardée en mémoire) ? */
const onScreen = (el: HTMLElement | null) => !!el && el.getClientRects().length > 0;
/** Élément qui fait défiler la boîte (téléphone : la page elle-même). */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Statuts calculés depuis Gmail (avant : « demarchee » manquait, et un rafraîchissement
// transformait un démarchage en « Nouvelle demande », compté « À traiter »).
const isAuto = (s: MailStatus) => s === "nouvelle" || s === "demarchee" || s === "negociation";
/**
 * Mail envoyé par l'agence (créateur en Cc ou Cci) sans réponse de la marque : c'est du
 * démarchage, il ne va que dans « Envoyés » (ni « Reçus », ni « À traiter »). Dès que la
 * marque répond, il passe « En négociation » et arrive dans « Reçus ».
 */
const sentOnly = (t: Pick<MailThreadLite, "status">) => t.status === "demarchee";

/** Statut discret (pastille + texte) pour les lignes de la liste, avec l'auteur du choix. */
function StatusDot({ status, by }: { status: string; by?: string }) {
  const t = useT();
  const m = statusMeta(status);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", m.dot)} />
      {t(m.label)}
      {by && <span className="truncate text-faint">{t("· par {who}", { who: by })}</span>}
    </span>
  );
}

const FILTERS: { key: "tous" | "encours" | "atraiter" | "valide" | "refuse" | "demarchage" | "envoyes"; label: string; short: string; icon: LucideIcon; dot?: string; match: (t: MailThreadLite) => boolean }[] = [
  { key: "tous", label: "Tous les échanges", short: "Tous", icon: Inbox, match: (t) => !sentOnly(t) },
  { key: "encours", label: "En cours", short: "En cours", icon: Hourglass, dot: "bg-progress", match: (t) => t.status === "nouvelle" || t.status === "negociation" },
  { key: "atraiter", label: "À vérifier / valider", short: "À traiter", icon: SearchCheck, dot: "bg-wait", match: (t) => t.status === "a_verifier" || t.status === "a_valider" },
  { key: "valide", label: "Validés", short: "Validés", icon: Check, dot: "bg-ok", match: (t) => t.status === "valide" },
  { key: "refuse", label: "Refusés", short: "Refusés", icon: X, dot: "bg-closed", match: (t) => t.status === "refuse" },
  // Démarchage : fils lancés par l'agence (alias du créateur en copie), quel que soit leur statut.
  { key: "demarchage", label: "Démarchés par l'agence", short: "Démarchage", icon: Megaphone, dot: "bg-progress", match: (t) => !!t.prospect },
  // Envoyés : échanges où l'agence a écrit (démarchage, réponses aux marques).
  { key: "envoyes", label: "Envoyés par l'agence", short: "Envoyés", icon: Send, match: (t) => t.sent ?? !!t.prospect },
];

/**
 * Cases du grand sélecteur (mêmes couleurs que les tuiles du haut). « À vérifier » et
 * « À valider » sont posés par l'agence (le créateur les voit, sans pouvoir les choisir).
 */
const CHOICES: { value: MailChoice; label: string; hint: string; icon: LucideIcon; tile: string; disc: string; confirm: string; agencyOnly?: boolean }[] = [
  {
    value: "encours", label: "En cours", hint: "On en discute", icon: Hourglass,
    tile: TONE_TILE.progress, disc: TONE_SOLID.progress, confirm: TONE_SOLID.progress,
  },
  {
    value: "a_verifier", label: "À vérifier", hint: "Un point à contrôler", icon: SearchCheck, agencyOnly: true,
    tile: TONE_TILE.wait, disc: TONE_SOLID.wait, confirm: TONE_SOLID.wait,
  },
  {
    value: "a_valider", label: "À valider", hint: "Réponse attendue", icon: CircleHelp, agencyOnly: true,
    tile: TONE_TILE.wait, disc: TONE_SOLID.wait, confirm: TONE_SOLID.wait,
  },
  {
    value: "valide", label: "Validé", hint: "C'est oui", icon: Check,
    tile: TONE_TILE.ok, disc: TONE_SOLID.ok, confirm: TONE_SOLID.ok,
  },
  {
    value: "refuse", label: "Refusé", hint: "C'est non", icon: X,
    tile: TONE_TILE.closed, disc: TONE_SOLID.closed, confirm: TONE_SOLID.closed,
  },
];
const choiceMeta = (c: MailChoice) => CHOICES.find((x) => x.value === c) ?? CHOICES[0];

const fmtDay = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" }) : "";
const fmtStamp = (ts: number, locale: string) =>
  new Date(ts).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Auteur d'un choix, vu par la personne qui regarde (« toi », « ton agence », « Chloé », « l'agence »). */
const authorName = (by: "creator" | "agency", mode: Mode, creatorName: string, t: T) =>
  mode === "creator" ? (by === "creator" ? t("toi") : t("ton agence")) : by === "creator" ? creatorName : t("l'agence");
const authorSubject = (by: "creator" | "agency", mode: Mode, creatorName: string, t: T) =>
  mode === "creator" ? (by === "creator" ? t("Tu as") : t("Ton agence a")) : by === "creator" ? t("{name} a", { name: creatorName }) : t("L'agence a");
const VERB: Record<MailChoice, string> = {
  encours: "remis l'échange en cours", valide: "validé l'échange", refuse: "refusé l'échange",
  a_verifier: "passé l'échange en « À vérifier »", a_valider: "passé l'échange en « À valider »",
};
/** Texte de la notification envoyée à l'agence quand le créateur donne son avis. */
const PUSH_VERB: Record<"encours" | "valide" | "refuse", string> = { encours: "a remis en cours", valide: "a validé", refuse: "a refusé" };
/** Ce que le créateur doit comprendre d'un statut posé par son agence. */
const AGENCY_STATUS_HINT: Partial<Record<MailChoice, string>> = {
  a_valider: "C'est à toi de répondre : Validé ou Refusé.",
  a_verifier: "Ton agence vérifie un point avant d'aller plus loin.",
  valide: "Ton agence a validé cet échange. Tu peux quand même donner ton avis.",
  refuse: "Ton agence a refusé cet échange. Tu peux quand même donner ton avis.",
};

/**
 * Grand sélecteur sous l'en-tête d'un échange. Agence : « En cours », « À vérifier »,
 * « À valider », « Validé », « Refusé » (le statut de l'échange). Créateur : deux lignes
 * bien distinctes, « Statut de l'agence » (quand l'agence a posé un statut) puis
 * « Ton avis » (En cours, Validé, Refusé). Un clic ouvre une confirmation avec un mot
 * facultatif, puis le choix est enregistré et noté dans le suivi.
 */
function StatusPanel({
  thread, mode, creatorName, creatorSees, busy, feedCount, onChoose, onShowFeed, onWriteNote,
}: {
  thread: MailThread; mode: Mode; creatorName: string; creatorSees: boolean; busy: boolean; feedCount: number;
  onChoose: (choice: MailChoice, comment: string) => Promise<boolean>;
  onShowFeed: () => void;
  /** Descend jusqu'au champ « Écrire une remarque » (sous les mails) et le sélectionne. */
  onWriteNote: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const real = choiceOf(thread.status);
  const forCreator = mode === "creator";
  const tiles = forCreator ? CHOICES.filter((c) => !c.agencyOnly) : CHOICES;
  // Créateur : un statut posé par l'agence (À vérifier, À valider, ou Validé / Refusé
  // décidé par elle) s'affiche à part ; ses cases ne montrent que SON avis.
  const agencyStatus = forCreator && (!!choiceMeta(real).agencyOnly || (real !== "encours" && thread.decidedBy === "agency"))
    ? choiceMeta(real) : null;
  const current: MailChoice | null = agencyStatus ? null : real;
  const [pending, setPending] = useState<MailChoice | null>(null);
  const [comment, setComment] = useState("");
  const pick = pending ? choiceMeta(pending) : null;
  const when = fmtDay(thread.decidedAt, locale);

  const hintFor = (c: (typeof CHOICES)[number]) => {
    if (c.value !== current) return t(c.hint);
    // Case active : « Nouvelle demande » / « En négociation », ou qui a tranché et quand.
    if (c.value === "encours") return t(statusMeta(thread.status).label);
    return thread.decidedBy ? t("par {who}", { who: authorName(thread.decidedBy, mode, creatorName, t) }) + (when ? `, ${when}` : "") : t(c.hint);
  };

  const confirm = async () => {
    if (!pending || busy) return;
    if (await onChoose(pending, comment)) {
      setPending(null);
      setComment("");
    }
  };

  const activeMeta = current ? choiceMeta(current) : null;
  return (
    <div className="border-y border-border py-3">
      {agencyStatus && (
        <div className={cn("mb-2.5 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px]", agencyStatus.tile)}>
          <agencyStatus.icon className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            <b>{t("Statut de l'agence : {label}", { label: t(agencyStatus.label) })}</b>{when ? ` · ${when.replace(/\.$/, "")}` : ""}
            <span className="opacity-90"> · {t(AGENCY_STATUS_HINT[agencyStatus.value] ?? "")}</span>
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="pr-1 text-[12px] font-semibold text-muted-foreground">{forCreator ? t("Ton avis") : t("Statut")}</span>
        <div role="radiogroup" aria-label={forCreator ? t("Ton avis") : t("Statut de l'échange")} className="flex flex-wrap gap-1.5">
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
                title={hintFor(c)}
                onClick={() => setPending(active ? null : c.value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-60",
                  active ? cn(c.tile, "cursor-default")
                    : picked ? "border-foreground/40 bg-rowhover text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t(c.label)}
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        {feedCount > 0 && (
          <button type="button" onClick={onShowFeed}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <History className="h-3.5 w-3.5" /> {t("Suivi ({n})", { n: feedCount })}
          </button>
        )}
        <button type="button" onClick={onWriteNote}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
          <MessageSquarePlus className="h-3.5 w-3.5" /> {t("Remarque")}
        </button>
      </div>
      {activeMeta && !pick && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("{label} : {hint}", { label: t(activeMeta.label), hint: hintFor(activeMeta) })}</p>
      )}

      {pick && (
        <div className="mt-3 rounded-xl border border-border bg-surface p-3">
          <p className="text-[13px] font-medium text-foreground">
            {forCreator ? t("Ton avis : « {label} » ?", { label: t(pick.label) }) : t("Passer cet échange en « {label} » ?", { label: t(pick.label) })}
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void confirm();
              if (e.key === "Escape") setPending(null);
            }}
            maxLength={1000}
            rows={2}
            placeholder={forCreator ? t("Un mot pour ton manager (facultatif) : pourquoi, tes conditions…") : t("Un mot pour {name} (facultatif)", { name: creatorName })}
            className="mt-2 max-h-40 min-h-[60px] w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-faint focus:border-primary"
          />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto w-full text-[11px] text-faint sm:w-auto">
              {forCreator ? t("Ton manager reçoit une notification.") : creatorSees ? t("{name} reçoit une notification.", { name: creatorName }) : t("Sa section Mails n'est pas encore activée : pas de notification.")}
            </span>
            <button type="button" onClick={() => setPending(null)} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
              {t("Annuler")}
            </button>
            <button type="button" onClick={() => void confirm()} disabled={busy}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50", pick.confirm)}>
              {busy ? <Spin size={16} /> : <Check className="h-4 w-4" />} {t("Confirmer")}
            </button>
          </div>
        </div>
      )}

      {mode === "preview" && !pick && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t("Aperçu de ce que voit {name}. Un choix fait ici est noté au nom de l'agence.", { name: creatorName })}</p>
      )}
    </div>
  );
}

/** Suivi d'un échange : messages du créateur, remarques de l'agence et changements de statut, dans l'ordre. */
function Feed({ items, mode, creatorName }: { items: FeedItem[]; mode: Mode; creatorName: string }) {
  const t = useT();
  const locale = useLocale();
  const asAgency = mode !== "creator";
  return (
    <ul className="mb-3 flex flex-col gap-2.5">
      {items.map((it) => {
        if (it.kind === "note") {
          const n = it.note;
          // Auteur inconnu (ancienne version du serveur, sans by_role) : affiché neutre,
          // jamais présenté comme un message de la personne qui regarde.
          const known = n.by_role === "creator" || n.by_role === "agency";
          const byAgency = n.by_role === "agency";
          // À droite ce qui vient de soi : le créateur voit les remarques de l'agence à gauche.
          const mine = known && asAgency === byAgency;
          const author = !known
            ? n.author_name || null
            : byAgency
              ? (asAgency ? n.author_name || t("L'agence") : t("Ton agence") + (n.author_name ? ` · ${n.author_name}` : ""))
              : asAgency ? creatorName : null;
          return (
            <li key={`n-${n.id}`}
              className={cn(
                "max-w-[85%] rounded-2xl border px-3.5 py-2.5",
                !known ? "border-border bg-muted/40" : byAgency ? "border-primary/20 bg-primary/[0.05]" : "border-border bg-surface",
                mine ? "self-end rounded-br-md" : "self-start rounded-bl-md",
              )}>
              {author && <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{author}</p>}
              <p className="whitespace-pre-wrap text-[13px] text-foreground [overflow-wrap:anywhere]">{n.body}</p>
              <p className="mt-1 text-[11px] text-faint">
                {fmtStamp(it.at, locale)}
                {known && !asAgency && !byAgency && (n.agency_read_at ? ` · ${t("lu")}` : ` · ${t("envoyé")}`)}
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
                <span className="font-medium text-foreground">{authorSubject(e.by_role, mode, creatorName, t)} {t(VERB[e.status])}</span>
                <span className="text-faint"> · {fmtStamp(it.at, locale)}</span>
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

/** Panneau d'état (erreur, section coupée…) avec un bouton facultatif. */
function StatePanel({ icon: Icon, text, action }: { icon: LucideIcon; text: string; action?: { label: string; busy?: boolean; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-muted"><Icon className="h-4 w-4 text-muted-foreground" /></span>
      <p className="max-w-[340px] text-[13px] text-muted-foreground">{text}</p>
      {action && (
        <button type="button" onClick={action.onClick} disabled={action.busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", action.busy && "animate-spin")} /> {action.label}
        </button>
      )}
    </div>
  );
}

export function CreatorMailbox({ creator, mode, creatorSees = true, initialThreadId, initialFilter, alias, aliases }: {
  initialFilter?: "atraiter";
  creator: string; mode: Mode;
  /** Le créateur a-t-il accès à sa section Mails ? (sinon pas de notification pour lui) */
  creatorSees?: boolean;
  /** Échange à ouvrir directement (lien depuis la page Mails de l'agence). */
  initialThreadId?: string;
  /** Alias du créateur (réglage), affiché tant que la liste n'a pas répondu. */
  alias?: string | null;
  /** Ses adresses en plus (réglage), idem. */
  aliases?: string[] | null;
}) {
  const t = useT();
  const locale = useLocale();
  const asAgency = mode !== "creator";
  const forCreator = asAgency ? creator : undefined;
  const creatorName = prettyName(titleCase(creator));
  const [threads, setThreads] = useState<MailThreadLite[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [off, setOff] = useState(false); // section désactivée par l'agence pendant la lecture
  const [err, setErr] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [listAlias, setListAlias] = useState<string | null>(null);
  // Toutes ses adresses, vérifiées par le serveur (null = ancienne version du serveur).
  const [listAliases, setListAliases] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useStickyState<(typeof FILTERS)[number]["key"]>("mails-createur:filtre", FILTERS.map((f) => f.key), "tous");
  // Arrivée par une pastille « N à traiter » : on montre directement ces échanges.
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<MailThread | null>(null);
  const [threadErr, setThreadErr] = useState<string | null>(null);
  const [threadRetry, setThreadRetry] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // relit l'échange ouvert dans Gmail
  const [dbKey, setDbKey] = useState(0); // relit son suivi en base
  const [deciding, setDeciding] = useState(false);
  const [, setImagesTick] = useState(0);
  // Historique des statuts de l'échange ouvert (events null = SQL pas encore lancé).
  const [history, setHistory] = useState<{ id: string; events: MailStatusEvent[] | null } | null>(null);
  // Suivi écrit (messages du créateur + remarques de l'agence), lu directement.
  const [threadNotes, setThreadNotes] = useState<{ id: string; list: MailNote[] } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [feedEl, setFeedEl] = useState<HTMLDivElement | null>(null);
  const setFeedNode = useCallback((el: HTMLDivElement | null) => {
    feedRef.current = el;
    setFeedEl(el);
  }, []);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const initialRef = useRef(initialThreadId ?? null);
  const firstLoad = useRef(true);
  const listedAt = useRef(0);
  const loadSeq = useRef(0);
  const loadingRef = useRef(false);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const threadRef = useRef(thread);
  threadRef.current = thread;
  // Statut automatique connu de chaque échange (Nouvelle demande / En négociation).
  const autoOf = useRef(new Map<string, MailStatus>());
  // Date du dernier message (liste) quand l'échange ouvert a été lu : relu seulement s'il a bougé.
  const fetchedTs = useRef(new Map<string, number>());
  const unseen = useUnseenMail(creator, mode === "creator");
  const [query, setQuery] = useState(""); // recherche dans la liste (marque, objet, extrait)
  // « Non lus » (créateur) : échanges pas encore vus, plus ceux qui l'étaient à l'activation.
  const [unreadOnly, setUnreadOnly] = useState<Set<string> | null>(null);
  // Aide « comment ça marche » : affichée tant qu'elle n'a pas été fermée sur cet appareil.
  const [help, setHelpState] = useState(() => {
    try {
      return localStorage.getItem("ttp:cmail-help") !== "0";
    } catch {
      return true;
    }
  });
  const setHelp = (v: boolean) => {
    setHelpState(v);
    try {
      localStorage.setItem("ttp:cmail-help", v ? "1" : "0");
    } catch {
      /* stockage indisponible */
    }
  };

  /** Texte d'erreur adapté : détaillé pour l'agence, simple pour le créateur. */
  const errText = useCallback(
    (e: unknown) => (e instanceof MailError ? e.message : asAgency ? "Impossible de charger les mails." : CREATOR_UNAVAILABLE),
    [asAgency],
  );

  /** Erreur d'une action : section coupée ou alias retiré → l'écran se met à jour. */
  const handleGone = useCallback((e: unknown): boolean => {
    const code = errorCode(e);
    if (code === "section_desactivee") {
      setOpenId(null);
      setOff(true);
      return true;
    }
    if (code === "non_configure") {
      setOpenId(null);
      setConfigured(false);
      return true;
    }
    return false;
  }, []);

  const load = useCallback(async (opts: { fresh?: boolean } = {}) => {
    const seq = ++loadSeq.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const r = await listMails(forCreator, { fresh: opts.fresh });
      if (seq !== loadSeq.current) return;
      listedAt.current = Date.now();
      setErr(null);
      setConfigured(r.configured);
      setPartial(!!r.partial);
      if (typeof r.alias === "string") setListAlias(r.alias);
      if (Array.isArray(r.aliases)) setListAliases(r.aliases.filter((a): a is string => typeof a === "string"));
      for (const t of r.threads) if (isAuto(t.status)) autoOf.current.set(t.id, t.status);
      setThreads(r.threads);
      if (mode === "creator") reportMailList(creator, r.threads, !!r.partial);
      firstLoad.current = false;
      // Échange demandé par un lien (une seule fois) ; sinon rien d'ouvert d'office, comme la page Mails.
      const wanted = initialRef.current && r.threads.some((t) => t.id === initialRef.current) ? initialRef.current : null;
      initialRef.current = null;
      setOpenId((cur) => {
        if (wanted) return wanted;
        // Échange ouvert absent d'une liste COMPLÈTE (supprimé dans Gmail…) : on le ferme.
        // Liste incomplète : il a peut-être seulement échoué à se charger, on le garde.
        if (cur && (r.partial || r.threads.some((t) => t.id === cur))) return cur;
        return null;
      });
      // Échange ouvert : relu dans Gmail s'il a un nouveau message (ou sur « Actualiser »),
      // sinon seul son suivi est relu en base.
      const open = threadRef.current;
      const lite = open ? r.threads.find((t) => t.id === open.id) : undefined;
      if (open && (opts.fresh || (lite && lite.ts !== fetchedTs.current.get(open.id)))) setReloadKey((n) => n + 1);
      else setDbKey((n) => n + 1);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      // La liste déjà affichée reste là ; l'erreur s'affiche à côté (ou seule s'il n'y a rien).
      // Nouvel essai automatique dans 3 min (ou tout de suite avec « Réessayer »).
      listedAt.current = Date.now();
      setErr(errText(e));
    } finally {
      if (seq === loadSeq.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [forCreator, mode, creator, errText]);

  useEffect(() => {
    setThreads(null);
    setOpenId(null);
    setErr(null);
    setOff(false);
    firstLoad.current = true;
    listedAt.current = 0;
    void load();
  }, [load]);

  /** Relit en base (sans Gmail) les statuts, les remarques et l'activité de l'agence. */
  const refreshDb = useCallback(async () => {
    const db = await getMailDb(creator, mode === "creator");
    if (!db) return;
    if (mode === "creator") reportAgencyActivity(creator, db.agency);
    setThreads((list) => {
      if (!list) return list;
      let changed = false;
      const next = list.map((t) => {
        const d = dbStatus(db.rows.get(t.id), isAuto(t.status) ? t.status : autoOf.current.get(t.id) ?? "nouvelle");
        const notes = db.notes.get(t.id) ?? 0;
        if (d.status === t.status && d.decidedBy === t.decidedBy && d.decidedAt === t.decidedAt && notes === t.notes) return t;
        changed = true;
        return { ...t, ...d, notes };
      });
      return changed ? next : list;
    });
    setThread((t) => {
      if (!t) return t;
      const d = dbStatus(db.rows.get(t.id), isAuto(t.status) ? t.status : autoOf.current.get(t.id) ?? autoStatusOf(t.messages));
      return d.status === t.status && d.decidedBy === t.decidedBy && d.decidedAt === t.decidedAt ? t : { ...t, ...d };
    });
    setDbKey((n) => n + 1);
  }, [creator, mode]);

  // Rafraîchissement de l'app (toutes les 20 s, retour sur l'onglet…) : base à chaque
  // fois, liste Gmail au plus toutes les 3 min. Rien si l'écran n'est pas affiché.
  useLive(() => {
    if (off || document.visibilityState === "hidden" || !onScreen(rootRef.current)) return;
    if (Date.now() - listedAt.current >= LIST_EVERY) {
      if (!loadingRef.current) void load();
    } else if (configured && threadsRef.current) {
      void refreshDb();
    }
  });

  // Agence : la pastille du créateur (page Mails) suit cette liste (statuts compris).
  useEffect(() => {
    if (asAgency && threads) reportCreatorThreads(creator, threads, partial);
  }, [asAgency, creator, threads, partial]);

  // Contenu de l'échange ouvert (Gmail).
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    setThreadErr(null);
    // Même échange rechargé : pas de clignotement.
    setThread((t) => (t && t.id === openId ? t : null));
    getMailThread(openId, forCreator)
      .then((t) => {
        if (!alive) return;
        const prev = threadRef.current;
        if (prev && prev.id === t.id) {
          // Rechargé : les messages dépliés le restent, les nouveaux s'ouvrent.
          const known = new Set(prev.messages.map((m) => m.id));
          const added = t.messages.filter((m) => !known.has(m.id)).map((m) => m.id);
          if (added.length) setExpanded((s) => new Set([...s, ...added]));
        } else {
          // Dernier message déplié, les précédents repliés (comme Gmail).
          setExpanded(new Set(t.messages.length ? [t.messages[t.messages.length - 1].id] : []));
        }
        setThread(t);
        fetchedTs.current.set(t.id, threadsRef.current?.find((x) => x.id === t.id)?.ts ?? 0);
      })
      .catch((e) => {
        if (!alive || handleGone(e)) return;
        setThreadErr(errText(e));
      });
    return () => {
      alive = false;
    };
  }, [openId, forCreator, reloadKey, threadRetry, handleGone, errText]);

  // Suivi de l'échange ouvert (base) : relu à chaque rafraîchissement.
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    void getStatusHistory(creator, openId).then((events) => {
      if (alive) setHistory((cur) => (cur && cur.id === openId && same(cur.events, events) ? cur : { id: openId, events }));
    });
    void getThreadNotes(creator, openId).then((list) => {
      if (!alive || !list) return;
      // Lu en base : sans colonne by_role (SQL « remarques » pas lancé), seul le créateur a pu écrire.
      const norm = list.map((n) => (n.by_role ? n : { ...n, by_role: "creator" as const }));
      setThreadNotes((cur) => (cur && cur.id === openId && same(cur.list, norm) ? cur : { id: openId, list: norm }));
    });
    return () => {
      alive = false;
    };
  }, [openId, creator, reloadKey, dbKey]);

  // Créateur : l'échange ouvert est « vu » (sa pastille et le gras de la liste disparaissent).
  useEffect(() => {
    if (mode === "creator" && openId && thread?.id === openId && unseen.has(openId)) markThreadSeen(creator, openId);
  }, [mode, creator, openId, thread?.id, unseen]);

  // ── Téléphone : lecture plein écran, retour par le geste « précédent » ──────
  const listScroll = useRef<{ el: HTMLElement | null; top: number }>({ el: null, top: 0 });
  const prevOpen = useRef<string | null>(null);
  useLayoutEffect(() => {
    const was = prevOpen.current;
    prevOpen.current = openId;
    if (was === openId || !isNarrow()) return;
    if (openId) {
      // Échange ouvert (ou suivant / précédent) : on remonte en haut de la boîte.
      rootRef.current?.scrollIntoView({ block: "start" });
    } else if (was) {
      // Retour à la liste : là où on l'avait laissée.
      const { el, top } = listScroll.current;
      if (el) el.scrollTop = top;
    }
  }, [openId]);
  const openFromList = (id: string) => {
    if (isNarrow()) {
      const el = scrollerOf(rootRef.current);
      listScroll.current = { el, top: el?.scrollTop ?? 0 };
    }
    setOpenId(id);
  };
  // Une entrée d'historique par échange ouvert : « précédent » (geste, bouton) ferme l'échange.
  const pushed = useRef(false);
  const skipPop = useRef(false);
  useEffect(() => {
    if (openId && !pushed.current && isNarrow()) {
      try {
        window.history.pushState({ ...((window.history.state as object | null) ?? {}), ttpCreatorMail: true }, "");
        pushed.current = true;
      } catch {
        /* historique indisponible : le bouton « Retour » suffit */
      }
    } else if (!openId && pushed.current) {
      // Fermé depuis l'écran : on retire l'entrée ajoutée.
      pushed.current = false;
      skipPop.current = true;
      window.history.back();
    }
  }, [openId]);
  useEffect(() => {
    const onPop = () => {
      if (skipPop.current) {
        skipPop.current = false;
        return;
      }
      if (pushed.current) {
        pushed.current = false;
        setOpenId(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, []);

  const applyDecision = (threadId: string, d: Decision & { status: MailStatus }) => {
    setThreads((l) => l?.map((t) => (t.id === threadId ? { ...t, ...d } : t)) ?? l);
    setThread((t) => (t && t.id === threadId ? { ...t, ...d } : t));
  };

  /**
   * Range l'échange dans « En cours », « Validé » ou « Refusé », avec un mot facultatif.
   * Créateur : via le serveur (vérifie que l'échange est à lui, note la trace).
   * Agence : écriture directe (RLS agence) + ligne d'historique à son nom.
   */
  const choose = async (threadId: string, choice: MailChoice, comment: string): Promise<boolean> => {
    if (deciding) return false;
    setDeciding(true);
    const word = comment.trim().slice(0, 1000);
    const open = thread && thread.id === threadId ? thread : null;
    const lite = threads?.find((x) => x.id === threadId);
    const what = prettyName(lite?.brand || open?.brand || "") || lite?.subject || open?.subject || "un échange";
    const label = choiceMeta(choice).label; // notifications à l'agence : en français
    const shownLabel = t(label);
    try {
      if (mode === "creator") {
        // Le créateur ne choisit qu'entre En cours, Validé et Refusé.
        if (choice === "a_verifier" || choice === "a_valider") return false;
        const r = await sendDecision(threadId, choice, word);
        applyDecision(threadId, r);
        notifyAgency("mail", creator, `Avis : ${PUSH_VERB[choice]} ${what}${word ? ` · « ${word} »` : ""}`);
        toast(t("{label} ✓ Ton manager est prévenu", { label: shownLabel }));
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
          toast(/status_check/.test(error.message) ? "Lance d'abord le SQL « remarques » dans Supabase." : t("Statut non enregistré, réessaie"));
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
          ? { status: autoOf.current.get(threadId) ?? (open ? autoStatusOf(open.messages) : "nouvelle"), decidedBy: null, decidedAt: null }
          : { status: choice, decidedBy: "agency", decidedAt: now });
        if (creatorSees) notifyCreator("mail", creator, `Statut de l'agence · ${what} : ${label}${word ? ` · « ${word} »` : ""}`);
        toast(t("Statut enregistré : {label} ✓", { label: shownLabel }));
      }
      const events = await getStatusHistory(creator, threadId);
      // Un autre échange a été ouvert entre-temps : on ne touche pas à son historique.
      setHistory((cur) => (cur && cur.id !== threadId ? cur : { id: threadId, events }));
      return true;
    } catch (e) {
      if (!handleGone(e)) toast(t(errText(e)));
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
        notifyAgency("mail", creator, `Remarque sur ${what} : ${body}`);
        toast(t("Remarque envoyée à ton manager ✓"));
      } else {
        // Remarque de l'agence : visible par le créateur dans le suivi de l'échange.
        const { data: auth } = await supabase.auth.getSession();
        const uid = auth.session?.user.id;
        if (!uid) return;
        const now = new Date().toISOString();
        const { data, error } = await supabase.from("creator_mail_notes").insert({
          creator, thread_id: thread.id, author_user_id: uid, body, by_role: "agency",
          author_name: await myDisplayName(), agency_read_at: now,
        }).select("*").single();
        if (error) {
          toast(/by_role|author_name|row-level/.test(error.message) ? "Lance d'abord le SQL « remarques » dans Supabase." : t("Remarque non enregistrée, réessaie"));
          return;
        }
        addNote(thread.id, data as MailNote);
        // Texte explicite : le titre de la notification (serveur) parle d'un statut.
        if (creatorSees) notifyCreator("mail", creator, `Nouvelle remarque de ton agence · ${what} : ${body}`);
        toast(creatorSees ? t("Remarque envoyée à {name} ✓", { name: creatorName }) : t("Remarque enregistrée ✓"));
      }
      setNote("");
    } catch (e) {
      if (!handleGone(e)) toast(t(errText(e)));
    } finally {
      setSending(false);
    }
  };

  // Agence : « À traiter » = la même définition que la pastille du créateur (page Mails).
  useCreatorMailCounts([], { active: false }); // suit les messages du créateur lus / non lus
  const noteIds = asAgency ? creatorUnreadNoteIds(creator) : null;
  const matchOf = useCallback(
    (f: (typeof FILTERS)[number]) => (asAgency && f.key === "atraiter" ? (t: MailThreadLite) => isMailTodo(t) || !!noteIds?.has(t.id) : f.match),
    [asAgency, noteIds],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.key] = (threads ?? []).filter(matchOf(f)).length;
    return c;
  }, [threads, matchOf]);
  // Pastille « Reçus » (créateur) : échanges reçus pas encore vus, sans les démarchages envoyés.
  const unseenReceived = useMemo(() => (threads ?? []).filter((t) => unseen.has(t.id) && !sentOnly(t)).length, [threads, unseen]);
  const cur = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const q = query.trim().toLowerCase();
  const pitch = useMemo(() => prospectStats(threads ?? []), [threads]);
  const curMatch = matchOf(cur);
  const shown = (threads ?? []).filter((t) => curMatch(t) && (!unreadOnly || unseen.has(t.id) || unreadOnly.has(t.id)) && (!q || `${t.brand} ${t.subject} ${t.excerpt}`.toLowerCase().includes(q)));

  // Suivi de l'échange ouvert. Une ancienne décision (avant l'historique) n'est ajoutée
  // qu'une fois l'historique chargé, pour éviter un clignotement. Repli : les remarques
  // renvoyées par le serveur (by_role absent sur une ancienne version → affichage neutre).
  const events = thread && history?.id === thread.id ? history.events : undefined;
  const notesList = thread ? (threadNotes?.id === thread.id ? threadNotes.list : thread.notes) : [];
  const feed = thread
    ? buildFeed(notesList, events ?? null, events === undefined ? undefined : { status: thread.status, decidedBy: thread.decidedBy, decidedAt: thread.decidedAt })
    : [];

  // Agence : les messages du créateur ne sont marqués lus qu'une fois le suivi
  // réellement affiché à l'écran, et la pastille ne baisse que si l'écriture a réussi.
  const unreadSig = mode === "agency" && thread
    ? notesList.filter((n) => !n.agency_read_at && n.by_role !== "agency").map((n) => n.id).join(",")
    : "";
  const threadIdForRead = thread?.id ?? null;
  useEffect(() => {
    if (mode !== "agency" || !feedEl || !unreadSig || !threadIdForRead || typeof IntersectionObserver === "undefined") return;
    const threadId = threadIdForRead;
    const el = feedEl;
    let done = false;
    let cancelled = false;
    let retryTimer = 0;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (done || !e?.isIntersecting || document.visibilityState === "hidden") return;
      // Vraiment visible : au moins une bonne partie du suivi est à l'écran.
      if (e.intersectionRect.height < Math.min(64, e.boundingClientRect.height * 0.5)) return;
      done = true;
      io.disconnect();
      void (async () => {
        const now = new Date().toISOString();
        const { error } = await supabase.from("creator_mail_notes").update({ agency_read_at: now })
          .eq("creator", creator).eq("thread_id", threadId).is("agency_read_at", null);
        if (error) {
          if (cancelled) return;
          // Pastille inchangée ; nouvel essai dans 30 s si le suivi est toujours affiché.
          retryTimer = window.setTimeout(() => {
            if (cancelled) return;
            done = false;
            io.observe(el);
          }, 30_000);
          return;
        }
        markCreatorNotesRead(creator, threadId);
        const read = (n: MailNote) => (!n.agency_read_at && n.by_role !== "agency" ? { ...n, agency_read_at: now } : n);
        setThreadNotes((c) => (c && c.id === threadId ? { id: threadId, list: c.list.map(read) } : c));
        setThread((t) => (t && t.id === threadId ? { ...t, notes: t.notes.map(read) } : t));
      })();
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    io.observe(el);
    return () => {
      cancelled = true;
      done = true;
      window.clearTimeout(retryTimer);
      io.disconnect();
    };
  }, [mode, creator, feedEl, unreadSig, threadIdForRead]);

  // Images distantes masquées côté créateur (et dans l'aperçu agence) tant qu'on ne les demande pas.
  const blockImages = mode !== "agency";
  const remoteImgIds = useMemo(
    () => new Set((thread?.messages ?? []).filter((m) => hasRemoteImages(m.html)).map((m) => m.id)),
    [thread],
  );

  const retry = () => void load({ fresh: true });
  const unavailable = t(err ?? "");

  if (off) {
    return (
      <div ref={rootRef}>
        <DashPanel><StatePanel icon={Inbox} text={t("Cette section n'est plus activée.")} /></DashPanel>
      </div>
    );
  }
  if (threads === null) {
    return (
      <div ref={rootRef}>
        {err ? (
          <DashPanel><StatePanel icon={CircleAlert} text={unavailable} action={{ label: t("Réessayer"), busy: loading, onClick: retry }} /></DashPanel>
        ) : (
          <DashPanel className="flex items-center justify-center gap-2 p-10 text-[13px] text-muted-foreground"><Loader variant="dots" size={16} /> {t("Chargement des mails…")}</DashPanel>
        )}
      </div>
    );
  }
  if (!configured) {
    return (
      <div ref={rootRef}>
        <DashPanel className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Inbox className="h-6 w-6 text-faint" />
          <p className="text-[13px] text-muted-foreground">
            {asAgency ? t("Aucun alias ni libellé n'est lié à ce créateur.") : t("Ta boîte mail n'est pas encore activée. Ton agence s'en occupe.")}
          </p>
        </DashPanel>
      </div>
    );
  }

  const showFeed = () => feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const writeNote = () => {
    noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    noteRef.current?.focus({ preventScroll: true });
  };
  const navIdx = openId ? shown.findIndex((t) => t.id === openId) : -1;
  // Ses adresses : celles vérifiées par le serveur, sinon le réglage (alias + adresses en plus).
  const shownAddresses = listAliases ?? allAddresses(alias ?? listAlias, aliases);
  const several = shownAddresses.length > 1;
  const copyCls = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover";
  const copyAddress = async (a: string) => {
    try {
      await navigator.clipboard.writeText(a);
      toast(t("Adresse copiée"));
    } catch {
      toast(a);
    }
  };
  const emptyText = q
    ? t("Aucun échange ne correspond à « {q} ».", { q: query.trim() })
    : unreadOnly
      ? t("Aucun mail non lu. Tout est à jour ✓")
    : filter !== "tous"
      ? t("Aucun échange ici.")
      : asAgency
        ? t("Aucun échange pour le moment.")
        : shownAddresses.length
          ? t("Les mails envoyés à {alias} apparaîtront ici.", { alias: joinWith(shownAddresses, t("ou")) })
          : t("Les mails des marques qui t'écrivent apparaîtront ici.");

  // Comment les statuts avancent (affiché pour éviter toute confusion, refermable).
  const helpBanner = (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-[12px] leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {asAgency
          ? t("Ouvre un échange et range-le avec le grand sélecteur : En cours, À vérifier, À valider, Validé ou Refusé. « Ajouter une remarque » lui écrit un mot sur cet échange. {name} voit tout dans son espace et donne son avis ; chaque changement (qui, quand, son mot) est gardé dans le suivi.", { name: creatorName })
          : t("Ouvre un échange : le « Statut de l'agence » te dit où il en est, et « Ton avis » (En cours, Validé ou Refusé) lui donne ta réponse. Avec « Ajouter une remarque », écris à ton manager quand tu veux. Il est prévenu ; ses remarques et tout l'historique sont dans le suivi de l'échange.")}
      </span>
      <button type="button" onClick={() => setHelp(false)} aria-label={t("Masquer l'aide")}
        className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // ── Barre d'icônes (ordinateur) : les cinq rangements, avec leur nombre ──
  const rail = (
    <nav aria-label={t("Ranger les échanges")} className="hidden min-h-0 flex-col items-center gap-1 border-r border-border py-3 lg:flex">
      <RailButton label={t("Boîte de réception")} caption={t("Reçus")} active={filter !== "envoyes"} badge={(mode === "creator" ? unseenReceived : counts.atraiter) || null} onClick={() => setFilter("tous")}>
        <Inbox className="h-[18px] w-[18px]" />
      </RailButton>
      <RailButton label={t("Mails envoyés par l'agence")} caption={t("Envoyés")} active={filter === "envoyes"} onClick={() => setFilter("envoyes")}>
        <Send className="h-[18px] w-[18px]" />
      </RailButton>
      <span className="flex-1" />
      <RailButton label={help ? t("Masquer l'aide") : t("Comment ça marche")} caption={t("Aide")} active={help} bar={false} onClick={() => setHelp(!help)}>
        <Info className="h-[18px] w-[18px]" />
      </RailButton>
    </nav>
  );

  // ── Même barre, en ligne (téléphone, tablette) ; masquée pendant la lecture ──
  const pills = (
    <nav aria-label={t("Ranger les échanges")} className={cn("flex gap-1.5 overflow-x-auto border-b border-border p-2 [scrollbar-width:none] lg:hidden", openId && "max-lg:hidden")}>
      {FILTERS.map((f) => {
        const on = filter === f.key;
        return (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={on}
            className={cn(pillCls, on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
            <f.icon className="h-3.5 w-3.5" />
            {t(f.short)}
            <span className={cn("tabular-nums", on ? "opacity-70" : "text-faint")}>{counts[f.key]}</span>
          </button>
        );
      })}
      <button type="button" onClick={() => setHelp(!help)} aria-label={help ? t("Masquer l'aide") : t("Comment ça marche")} aria-pressed={help}
        className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors", help ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")}>
        <Info className="h-4 w-4" />
      </button>
    </nav>
  );

  // ── Liste ────────────────────────────────────────────────────────────────
  const listBroken = !!err && threads.length === 0; // rien à montrer : l'erreur prend la place
  const list = (
    <section className={cn("flex min-h-0 min-w-0 flex-col bg-panel lg:border-r lg:border-border", openId && "max-lg:hidden")}>
      <div className="shrink-0 px-3 pb-2.5 pt-3 sm:px-4">
        <div className="flex items-center gap-1">
          <h2 className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold tracking-tight text-foreground">
            {filter === "envoyes" ? t("Envoyés") : t("Boîte de réception")}
          </h2>
          <ToolButton icon={RefreshCw} label={t("Actualiser")} spin={loading} disabled={loading} onClick={retry} className="h-8 w-8" />
        </div>
        {/* Adresses attribuées par l'agence : le créateur les voit (et les copie) d'un coup d'œil. */}
        {shownAddresses.length === 1 && (
          <div className="mt-1.5 flex min-w-0 items-center gap-2 rounded-[10px] bg-field px-3 py-2">
            <AtSign className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-tight text-muted-foreground">{mode === "creator" ? t("Ton adresse mail") : t("Adresse de {name}", { name: creatorName })}</span>
              <span className="block truncate text-[13.5px] font-semibold text-foreground">{shownAddresses[0]}</span>
            </span>
            <button type="button" onClick={() => void copyAddress(shownAddresses[0])} className={copyCls}>
              <Copy className="h-3.5 w-3.5" /> {t("Copier")}
            </button>
          </div>
        )}
        {several && (
          <div className="mt-1.5 min-w-0 rounded-[10px] bg-field px-3 py-2">
            <span className="flex items-center gap-2 text-[11px] leading-tight text-muted-foreground">
              <AtSign className="h-4 w-4 shrink-0" />
              {mode === "creator" ? t("Tes adresses mail") : t("Adresses de {name}", { name: creatorName })}
            </span>
            <ul className="mt-1 flex flex-col gap-1">
              {shownAddresses.map((a) => (
                <li key={a} className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate pl-6 text-[13.5px] font-semibold text-foreground">{a}</span>
                  <button type="button" onClick={() => void copyAddress(a)} aria-label={t("Copier {address}", { address: a })} className={copyCls}>
                    <Copy className="h-3.5 w-3.5" /> {t("Copier")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {filter === "envoyes" ? (
          <p className="mt-1 pl-1 text-[12.5px] text-muted-foreground">
            {asAgency ? t("Les échanges où l'agence a écrit pour {name}.", { name: creatorName.split(" ")[0] }) : t("Les mails que ton agence envoie pour toi : démarchages et réponses aux marques.")}
          </p>
        ) : (
        <Tabs
          className="mt-2 max-lg:hidden"
          size="sm"
          fullWidth
          label={t("Rangement affiché")}
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
          items={FILTERS.filter((f) => f.key !== "demarchage" && f.key !== "envoyes").map((f) => ({ value: f.key, label: t(f.short) }))}
        />
        )}
        {/* Preuve du démarchage : marques contactées par l'agence ce mois-ci (alias en copie). */}
        {pitch.pitched > 0 && filter !== "envoyes" && (
          <button type="button" onClick={() => setFilter(filter === "demarchage" ? "tous" : "demarchage")} aria-pressed={filter === "demarchage"}
            className={cn("mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] transition-colors",
              filter === "demarchage" ? "bg-primary text-primary-foreground" : "bg-primary/[0.07] text-foreground hover:bg-primary/[0.12]")}>
            <Megaphone className={cn("h-4 w-4 shrink-0", filter === "demarchage" ? "" : "text-primary")} />
            <span className="min-w-0 flex-1">
              {mode === "creator"
                ? t(pitch.pitched > 1 ? "L'agence a démarché {n} marques pour toi ce mois-ci" : "L'agence a démarché {n} marque pour toi ce mois-ci", { n: pitch.pitched })
                : t(pitch.pitched > 1 ? "{n} marques démarchées ce mois-ci" : "{n} marque démarchée ce mois-ci", { n: pitch.pitched })}
              {pitch.replied > 0 && <span className={filter === "demarchage" ? "opacity-80" : "text-muted-foreground"}>{t(pitch.replied > 1 ? " · {n} ont répondu" : " · {n} a répondu", { n: pitch.replied })}</span>}
            </span>
            <span className="shrink-0 font-semibold">{filter === "demarchage" ? t("Tout voir") : t("Voir")}</span>
          </button>
        )}
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchField size="sm" value={query} onChange={setQuery} placeholder={t("Rechercher une marque, un objet…")} />
          </div>
          {mode === "creator" && (
            <UnreadToggle label={t("Non lus")} on={!!unreadOnly} count={unseen.size} onToggle={() => setUnreadOnly((cur) => (cur ? null : new Set(unseen)))} />
          )}
        </div>
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 truncate pl-1 text-[11.5px] text-muted-foreground" aria-live="polite">
          {cur.dot && <span aria-hidden className={cn("size-2 shrink-0 rounded-[3px]", cur.dot)} />}
          {q ? t("{a} sur {b}", { a: shown.length, b: counts[cur.key] }) : counts[cur.key]} {(q ? counts[cur.key] : shown.length) > 1 ? t("échanges") : t("échange")}
          {mode === "creator" && unseen.size > 0 && <span className="font-medium text-foreground">{t("· {n} à voir", { n: unseen.size })}</span>}
        </p>
      </div>
      {help && <div className="px-4 pb-3 sm:px-5 lg:hidden">{helpBanner}</div>}
      {err && !listBroken && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-[12px] text-dangertext sm:px-5">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{unavailable}</span>
          <button type="button" onClick={retry} disabled={loading} className="shrink-0 font-semibold underline-offset-2 hover:underline disabled:opacity-50">{t("Réessayer")}</button>
        </div>
      )}
      {partial && !err && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{t("Certains échanges n'ont pas pu être chargés.")}</span>
          <button type="button" onClick={retry} disabled={loading} className="shrink-0 font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-50">{t("Réessayer")}</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border" aria-busy={loading}>
        {listBroken ? (
          <StatePanel icon={CircleAlert} text={unavailable} action={{ label: t("Réessayer"), busy: loading, onClick: retry }} />
        ) : shown.length === 0 ? (
          <StatePanel icon={Mail} text={emptyText} />
        ) : (
          <ul className={mailCardListCls}>
            {shown.map((th) => {
              const on = openId === th.id;
              const fresh = unseen.has(th.id);
              return (
                <li key={th.id} className={mailCardCls(on)}>
                  <button type="button" aria-current={on || undefined} onClick={() => openFromList(th.id)} className={mailCardBtnCls}>
                    <span className="flex w-full min-w-0 items-start gap-3">
                      <Initial name={prettyName(th.brand)} email={th.brandEmail} size="md" />
                      <span className="min-w-0 flex-1 pt-px">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {fresh && <span aria-label={t("Nouveau")} className="size-2 shrink-0 rounded-full bg-primary" />}
                          <span className={cn("min-w-0 truncate text-[13px] leading-[18px] text-foreground", fresh ? "font-bold" : "font-semibold")}>{th.subject || t("(sans objet)")}</span>
                          <span className="flex-1" />
                          <span className={cn("shrink-0 pl-1 text-[11px] leading-4 tabular-nums", fresh ? "font-semibold text-foreground" : "text-faint")}>{fmtWhen(th.ts, locale)}</span>
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                          <span className={cn("min-w-0 truncate text-[12.5px] leading-4", fresh ? "font-medium text-foreground" : "text-muted-foreground")}>
                            {prettyName(th.brand) || t("Marque")}
                          </span>
                          {th.count > 1 && <span className="shrink-0 text-[11.5px] leading-4 text-faint">{th.count}</span>}
                        </span>
                      </span>
                    </span>
                    <span className="line-clamp-2 w-full text-[12.5px] leading-[18px] text-muted-foreground">{th.excerpt}</span>
                    <span className="flex min-w-0 items-center gap-3">
                      <StatusDot status={th.status} by={th.decidedBy ? authorName(th.decidedBy, mode, creatorName, t) : undefined} />
                      {th.notes > 0 && (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={t("Remarques")}>
                          <MessageSquare className="h-3 w-3" />{th.notes}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );

  // ── Lecture d'un échange ─────────────────────────────────────────────────
  const view = openId ? (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-border px-2 sm:px-3">
        <ToolButton icon={ArrowLeft} label={t("Retour à la liste")} onClick={() => setOpenId(null)} />
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          {navIdx >= 0 && shown.length > 1 && (
            <>
              <ToolButton icon={ChevronLeft} label={t("Échange précédent")} className="h-8 w-8" disabled={navIdx <= 0} onClick={() => setOpenId(shown[navIdx - 1].id)} />
              <span className="whitespace-nowrap px-1 text-[12.5px] tabular-nums text-muted-foreground">{t("{a} sur {b}", { a: navIdx + 1, b: shown.length })}</span>
              <ToolButton icon={ChevronRight} label={t("Échange suivant")} className="h-8 w-8" disabled={navIdx >= shown.length - 1} onClick={() => setOpenId(shown[navIdx + 1].id)} />
            </>
          )}
        </div>
        {thread && <ToolButton icon={History} label={t("Voir le suivi ({n})", { n: feed.length })} onClick={showFeed} />}
        {thread && <ToolButton icon={MessageSquarePlus} label={t("Ajouter une remarque")} onClick={writeNote} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {threadErr ? (
          <div className="p-4 sm:p-6">
            <div className="rounded-xl border border-border bg-panel/60">
              <StatePanel icon={CircleAlert} text={t(threadErr)} action={{ label: t("Réessayer"), onClick: () => setThreadRetry((n) => n + 1) }} />
            </div>
          </div>
        ) : !thread ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] text-muted-foreground"><Spin size={16} /> {t("Ouverture…")}</div>
        ) : (
          <div className="px-4 py-6 sm:px-8">
            {help && <div className="mb-6 max-lg:hidden">{helpBanner}</div>}
            <h1 className="text-[18px] font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance] sm:text-[20px]">{thread.subject}</h1>
            <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span>{thread.brand ? `${prettyName(thread.brand)} · ` : ""}{thread.messages.length > 1 ? t("{n} messages", { n: thread.messages.length }) : t("{n} message", { n: thread.messages.length })}</span>
              <StatusDot status={thread.status} by={thread.decidedBy ? authorName(thread.decidedBy, mode, creatorName, t) : undefined} />
            </p>

            <div className="mt-5">
              <StatusPanel
                key={thread.id}
                thread={thread}
                mode={mode}
                creatorName={creatorName}
                creatorSees={creatorSees}
                busy={deciding}
                feedCount={feed.length}
                onChoose={(c, w) => choose(thread.id, c, w)}
                onShowFeed={showFeed}
                onWriteNote={writeNote}
              />
            </div>

            <div className="mt-3 flex flex-col divide-y divide-border">
              {thread.messages.map((m, i) => {
                // Les mails de l'agence (signature, logos) s'affichent toujours en entier.
                const blocked = blockImages && !m.fromAgency && !remoteImagesAllowed(m.id);
                return (
                  <div key={m.id} className="flex flex-col">
                    {blocked && remoteImgIds.has(m.id) && expanded.has(m.id) && (
                      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
                        <ImageOff className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">{t("Images masquées pour ta confidentialité")}</span>
                        <button type="button"
                          onClick={() => {
                            allowRemoteImages(m.id);
                            setImagesTick((n) => n + 1);
                          }}
                          className="shrink-0 font-semibold text-foreground underline-offset-2 hover:underline">
                          {t("Afficher les images")}
                        </button>
                      </div>
                    )}
                    {asAgency && m.hiddenFromCreator && (
                      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <EyeOff className="h-3.5 w-3.5 shrink-0" />
                        {creatorName.split(" ")[0]} ne voit pas ce message : son adresse n'était pas en copie.
                      </p>
                    )}
                    <MailItem
                      variant="plain"
                      m={blocked ? { ...m, html: withoutRemoteImages(m.html) } : m}
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
                  </div>
                );
              })}
            </div>

            {/* Suivi interne avec le manager : avis, questions, changements de statut (jamais envoyés à la marque) */}
            <div ref={setFeedNode} className="mt-6 scroll-mt-4 rounded-xl border border-border bg-panel/60 p-4 sm:p-5">
              <div className="mb-1 flex items-center gap-2">
                <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-[13px] font-semibold text-foreground">{asAgency ? t("Suivi avec {name}", { name: creatorName }) : t("Suivi avec ton manager")}</span>
              </div>
              <p className="mb-3 pl-6 text-[12px] text-muted-foreground">
                {asAgency
                  ? t("Ses avis, ses questions, tes remarques et chaque changement de statut, avec la date. {name} voit tout ce suivi ; la marque, jamais.", { name: creatorName })
                  : t("Tes avis, tes questions, les remarques et les choix de ton agence. La marque ne voit jamais rien de tout ça.")}
              </p>
              {feed.length > 0 ? <Feed items={feed} mode={mode} creatorName={creatorName} /> : null}
              <div className="overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-primary">
                <textarea
                  ref={noteRef}
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 4000))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitNote();
                  }}
                  rows={2}
                  placeholder={asAgency ? t("Écrire une remarque à {name}…", { name: creatorName }) : t("Écrire une remarque à mon manager…")}
                  className="block max-h-60 min-h-[72px] w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-foreground outline-none [field-sizing:content] placeholder:text-faint"
                />
                <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate text-faint">
                    {mode === "preview"
                      ? t("Aperçu : envoyée à ton nom (agence), pas au nom de {name}", { name: creatorName })
                      : asAgency ? (creatorSees ? t("{name} la voit dans son espace", { name: creatorName }) : t("Sa section Mails n'est pas encore activée")) : t("Ton manager est prévenu ; la marque ne la voit jamais")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void submitNote()}
                    disabled={!note.trim() || sending}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-35"
                  >
                    {sending ? <Spin size={14} /> : <Send className="h-3.5 w-3.5" />} {t("Envoyer")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {thread && (
        <div className="flex h-14 shrink-0 items-center gap-1 border-t border-border px-2 max-sm:hidden sm:px-3">
          <BarButton icon={MessageSquarePlus} label={t("Ajouter une remarque")} onClick={writeNote} />
          <BarButton icon={History} label={t("Voir le suivi ({n})", { n: feed.length })} onClick={showFeed} />
          <span className="flex-1" />
          <span className="px-3"><StatusDot status={thread.status} by={thread.decidedBy ? authorName(thread.decidedBy, mode, creatorName, t) : undefined} /></span>
        </div>
      )}
    </section>
  ) : (
    <section className="hidden min-h-0 min-w-0 flex-col items-center justify-center gap-3 px-6 text-center lg:flex">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted"><Inbox className="h-5 w-5 text-muted-foreground" /></span>
      <p className="text-[14px] font-medium text-foreground">{t("Aucun échange ouvert")}</p>
      <p className="max-w-[300px] text-[13px] text-muted-foreground">{t("Choisis un échange dans la liste pour le lire ici.")}</p>
      {help && <div className="mt-2 w-full max-w-[460px]">{helpBanner}</div>}
    </section>
  );

  // Messagerie en un seul panneau : barre d'icônes, liste, lecture (hauteur fixe sur ordinateur).
  return (
    <div ref={rootRef} className="flex min-w-0 scroll-mt-[calc(env(safe-area-inset-top)+3.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:grid lg:h-[min(900px,calc(100dvh-150px))] lg:min-h-[560px] lg:grid-cols-[72px_minmax(300px,340px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[72px_minmax(330px,400px)_minmax(0,1fr)]">
      {rail}
      {pills}
      {list}
      {view}
    </div>
  );
}

/** Lit le réglage Mails d'une créatrice (RLS : agence = tous, créatrice = le sien). */
function useMailSettings(creator: string) {
  // undefined = chargement ou table absente (SQL pas encore appliqué) → rien n'est affiché.
  const [s, setS] = useState<MailSettings | null | undefined>(undefined);
  // Colonne `aliases` (adresses en plus) présente ? Non tant que le SQL des adresses n'est pas lancé.
  const [hasAliases, setHasAliases] = useState(true);
  const reload = useCallback(async () => {
    const cols = "creator, alias, label_id, label_name, enabled";
    const read = (c: string) => supabase.from("creator_mail_settings").select(c).eq("creator", creator).maybeSingle<MailSettings>();
    let r = await read(`${cols}, aliases`);
    const missing = aliasesColumnMissing(r.error);
    if (missing) r = await read(cols);
    setHasAliases(!missing);
    setS(r.error ? undefined : r.data ?? null);
  }, [creator]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { settings: s, reload, hasAliases };
}

/**
 * Fiche créatrice et page Mails (agence) : lien alias / libellé + activation, puis la
 * boîte (statuts, remarques).
 */
export function CreatorMailsAgency({ creator, suggestedAlias, initialThreadId, initialFilter, onSaved, className }: {
  creator: string; suggestedAlias?: string | null;
  /** Onglet ouvert d'office (« atraiter » quand on vient d'une pastille « N à traiter »). */
  initialFilter?: "atraiter";
  /** Échange à ouvrir directement (lien depuis la page Mails). */
  initialThreadId?: string;
  /** Appelé après un changement de réglage (la page Mails relit la liste des créatrices liées). */
  onSaved?: () => void;
  className?: string;
}) {
  const { settings, reload, hasAliases } = useMailSettings(creator);
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState("");
  // Adresses en plus de l'alias (ex. son adresse perso) et adresse en cours de saisie.
  const [extras, setExtras] = useState<string[]>([]);
  const [newAddress, setNewAddress] = useState("");
  const [labelId, setLabelId] = useState("");
  const [labels, setLabels] = useState<{ id: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  const openEdit = () => {
    // Une boîte commune (talent@, partnerships@…) n'est jamais proposée comme alias.
    const suggested = suggestedAlias && !SHARED_BOXES.test(emailOf(suggestedAlias)) ? emailOf(suggestedAlias) : "";
    setAlias(settings?.alias ?? suggested);
    setExtras(extraAddresses(settings?.alias, settings?.aliases));
    setNewAddress("");
    setLabelId(settings?.label_id ?? "");
    setEditing(true);
    if (!labels) listGmailLabels().then(setLabels).catch(() => setLabels([]));
  };

  /** Adresse saisie ajoutée à la liste (null si refusée : le message est affiché). */
  const takeNewAddress = (list: string[]): string[] | null => {
    if (!newAddress.trim()) return list;
    const r = checkNewAddress(newAddress, { alias, aliases: list });
    if ("error" in r) {
      toast(r.error);
      return null;
    }
    setNewAddress("");
    return [...list, r.address];
  };
  const addExtra = () => {
    const next = takeNewAddress(extras);
    if (next) setExtras(next);
  };

  /**
   * Enregistre le réglage. "pending" : enregistré SANS les adresses en plus (SQL des
   * adresses pas encore lancé) ; l'alias principal, le libellé et l'activation le sont.
   */
  const save = async (patch: Partial<MailSettings>): Promise<boolean | "pending"> => {
    setSaving(true);
    const row: Partial<MailSettings> & { creator: string; updated_at: string } = {
      creator,
      alias: settings?.alias ?? null,
      label_id: settings?.label_id ?? null,
      label_name: settings?.label_name ?? null,
      enabled: settings?.enabled ?? false,
      ...(hasAliases ? { aliases: settings?.aliases ?? [] } : {}),
      ...patch,
      updated_at: new Date().toISOString(),
    };
    // Colonne absente et rien à y mettre : on ne l'envoie pas.
    if (!hasAliases && !row.aliases?.length) delete row.aliases;
    const upsert = (r: typeof row) => supabase.from("creator_mail_settings").upsert(r, { onConflict: "creator" });
    let { error } = await upsert(row);
    let pending = false;
    if (error && "aliases" in row && aliasesColumnMissing(error)) {
      const { aliases: _skipped, ...rest } = row;
      ({ error } = await upsert(rest));
      pending = !error && !!_skipped?.length;
    }
    setSaving(false);
    if (error) {
      // Refus de la base : adresse déjà prise par un autre créateur, boîte commune…
      toast(error.code === "P0001" && error.message ? error.message
        : error.code === "23505" ? "Cette adresse est déjà utilisée par un autre créateur"
          : error.code === "23514" ? SHARED_BOX_MESSAGE
            : "Réglage non enregistré");
      return false;
    }
    if (pending) toast("Mise à jour en attente : lance le SQL des adresses");
    await reload();
    onSaved?.();
    return pending ? "pending" : true;
  };

  const submit = async () => {
    const a = alias.trim().toLowerCase();
    if (a && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) {
      toast("Alias invalide : il faut une adresse e-mail complète");
      return;
    }
    // Sinon elle verrait TOUS les mails de cette boîte, pas seulement les siens.
    if (a && SHARED_BOXES.test(a)) {
      toast(SHARED_BOX_MESSAGE);
      return;
    }
    // Adresse tapée sans cliquer sur « Ajouter » : elle compte aussi.
    const list = takeNewAddress(extras);
    if (!list) return;
    const more = extraAddresses(a, list);
    setExtras(more);
    const lbl = labels?.find((l) => l.id === labelId);
    const ok = await save({ alias: a || null, aliases: more, label_id: labelId || null, label_name: lbl?.name ?? null });
    if (ok) {
      setEditing(false);
      if (ok === true) toast("Boîte mail liée ✓");
    }
  };

  if (settings === undefined) return null;
  const savedExtras = extraAddresses(settings?.alias, settings?.aliases);
  const linked = !!(settings?.alias || settings?.label_id || savedExtras.length);

  return (
    <div className={cn("mt-4 flex flex-col gap-4", className)}>
      <DashPanel className="p-5">
        <DashSectionTitle
          icon={Mail}
          right={!editing && linked && (
            <button type="button" onClick={openEdit}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Settings2 className="h-3.5 w-3.5" /> Modifier
            </button>
          )}
        >
          Mails de {titleCase(creator)}
        </DashSectionTitle>

        {!linked && !editing && (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-[13px] text-muted-foreground">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Relie l'adresse mail de {titleCase(creator)} (son alias) pour voir ses échanges ici, les ranger (À vérifier, À valider, Validé, Refusé) et lui écrire des remarques.
            </span>
            <button type="button" onClick={openEdit}
              className="h-8 shrink-0 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              Relier
            </button>
          </div>
        )}
        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Alias (adresse utilisée avec les marques)</span>
                <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="prenom@ttpcreators.pro" inputMode="email"
                  className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Libellé Gmail (facultatif, en plus de l'alias)</span>
                <Picker size="sm" ariaLabel="Libellé Gmail" className="w-full" value={labelId} onChange={setLabelId}
                  options={[
                    { value: "", label: "Aucun" },
                    ...(labels === null && labelId ? [{ value: labelId, label: settings?.label_name ?? labelId }] : []),
                    ...(labels ?? []).map((l) => ({ value: l.id, label: l.name })),
                  ]} />
              </label>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Autres adresses (facultatif, ex. son adresse perso)</span>
              {extras.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {extras.map((x) => (
                    <li key={x} className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface pl-3 pr-1">
                      <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{x}</span>
                      <button type="button" onClick={() => setExtras(extras.filter((e) => e !== x))} aria-label={`Retirer ${x}`}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex min-w-0 gap-2">
                <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="prenom.nom@gmail.com" inputMode="email" autoComplete="off"
                  aria-label="Autre adresse"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExtra();
                    }
                  }}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary" />
                <button type="button" onClick={addExtra} disabled={!newAddress.trim()}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-40">
                  <Plus className="h-3.5 w-3.5" /> Ajouter une adresse
                </button>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Il verra uniquement les échanges où une de ses adresses apparaît (expéditeur, destinataire ou copie) et ceux qui portent ce libellé. Lecture seule : il ne peut ni répondre ni supprimer.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
              <button type="button" onClick={() => void submit()} disabled={saving}
                className="h-9 rounded-full bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                Enregistrer
              </button>
            </div>
          </div>
        ) : linked && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{settings?.alias || <span className="text-faint">Aucun alias</span>}</span>
              </span>
              {savedExtras.map((x) => (
                <span key={x} className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{x}</span>
                </span>
              ))}
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

      {linked && !editing && (
        <CreatorMailbox creator={creator} mode="agency" creatorSees={!!settings?.enabled} initialThreadId={initialThreadId} initialFilter={initialFilter}
          alias={settings?.alias} aliases={settings?.aliases} />
      )}
    </div>
  );
}

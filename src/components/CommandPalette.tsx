import { useEffect, useMemo, useRef, useState } from "react";
import { TtpCollabs, TtpInvoice, TtpMail, TtpRepeat, TtpSpark, TtpToday, TtpTodo } from "@/components/icons/ttp-icons";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Search, type LucideIcon } from "lucide-react";
import { cn, titleCase } from "@/lib/utils";
import { NAV, type ViewId } from "@/lib/nav";
import { PAGE_ALIASES } from "@/lib/pageAliases";
import { PALETTE_EVENT, rankEntries, relanceActionLabel, stepIndex } from "@/lib/commandPalette";
import { overdueInvoices, relanceEmail, relanceMailto, type Reminders } from "@/lib/relance";
import { recordReminder, useRelanceInvoices } from "@/lib/useRelanceInvoices";
import { useGlobalSearch } from "@/lib/useGlobalSearch";
import { useAppState, type AppState } from "@/lib/appState";
import { requestIntent } from "@/lib/openIntent";
import { formatEuro, parseAmount } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import type { StatusTone } from "@/lib/statusTone";
import { IconTile } from "@/components/ui/icon-tile";
import { Kbd } from "@/components/ui/kbd";
import { KIND_META } from "@/lib/searchKinds";
import { toast } from "@/components/ui/toast";

/**
 * Palette ⌘K (espace agence) : tout faire au clavier depuis n'importe quelle page.
 *   • Actions : relancer une facture en retard, relancer toutes les factures, nouvelle
 *     tâche, nouvelle collab, trier les mails ;
 *   • Aller à : les pages du menu (sans les pages rangées ni celles du profil fondateur) ;
 *   • Résultats : la recherche globale (créateurs, contacts, factures, briefs…) ;
 *   • Demander à Megan : ouvre la page Agents.
 * ↑ ↓ naviguer, ↵ ouvrir, ⌘ ↵ exécuter sans ouvrir (relance), Échap fermer, ⌘ J Megan.
 * Classement et libellés : lib/commandPalette.ts (testés).
 */

type Group = "actions" | "pages" | "results" | "megan";
type Entry = {
  key: string;
  group: Group;
  label: string;
  sub?: string;
  meta?: string;
  icon: LucideIcon;
  tone?: StatusTone;
  keywords?: string[];
  /** ↵ : ouvre la page qui fait l'action (ou la fait si c'est tout l'intérêt). */
  run: () => void;
  /** ⌘ ↵ : exécute sans changer de page (sinon même chose que ↵). */
  exec?: () => void;
};

const GROUP_LABEL: Record<Group, string> = { actions: "Actions", pages: "Aller à", results: "Résultats", megan: "Demander à Megan" };

const go = (id: string) => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: id }));

export function CommandPalette({
  hidden,
  restricted,
  onSelect,
  onGoto,
  onOpenCreator,
  setQuery,
}: {
  /** Ouvre une page du menu (comme un clic dans la barre latérale). */
  onSelect: (id: ViewId) => void;
  /** Pages hors menu pour ce profil (fondateur + rangées) : pas proposées. */
  hidden: readonly ViewId[];
  /** Pages que ce profil ne peut pas ouvrir (actions argent et Megan masquées). */
  restricted: readonly ViewId[];
  /** Ouvre la page d'un résultat de recherche (garde la requête pour filtrer). */
  onGoto: (id: ViewId) => void;
  onOpenCreator: (name: string) => void;
  /** Requête de recherche globale : la page ouverte depuis un résultat filtre dessus. */
  setQuery: (q: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const money = !restricted.includes("relances");
  const canAgent = !restricted.includes("agent");

  const close = () => {
    setOpen(false);
    setQ("");
    setIndex(0);
  };

  // ⌘K ouvre / ferme, ⌘J ouvre Megan (page Agents), partout dans l'espace agence.
  const state = useRef({ open, canAgent });
  state.current = { open, canAgent };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        if (state.current.open) close();
        else setOpen(true);
      } else if (k === "j" && state.current.canAgent) {
        e.preventDefault();
        close();
        go("agent");
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Données : lues seulement palette ouverte (cache partagé avec Relances / Aujourd'hui).
  const { invoices } = useRelanceInvoices(open && money);
  const { data: app } = useAppState<AppState>();
  const { hits: rawHits, loading } = useGlobalSearch(open ? q : "");
  const [localRem, setLocalRem] = useState<Reminders | null>(null);
  const liveRem = app?.invoiceReminders;
  useEffect(() => setLocalRem(null), [liveRem]);

  const entries = useMemo<Entry[]>(() => {
    const reminders: Reminders = localRem ?? ((liveRem as Reminders | undefined) ?? {});
    const details = (app?.invoiceDetails as Record<string, { clientEmail?: string }> | undefined) ?? {};
    const query = q.trim();
    const out: Entry[] = [];

    // ── Actions ──
    const actions: Entry[] = [];
    if (money && invoices) {
      // Déjà relancées aujourd'hui : plus rien à faire (comme « Aujourd'hui »).
      const today = todayISO();
      const late = overdueInvoices(invoices).filter((o) => reminders[o.iv.id]?.last !== today);
      for (const { iv, late: days } of late) {
        actions.push({
          key: `relance:${iv.id}`,
          group: "actions",
          label: relanceActionLabel(iv),
          meta: [formatEuro(parseAmount(iv.amount)), days ? `${days} j` : null].filter(Boolean).join(" · "),
          icon: TtpInvoice,
          tone: "late",
          keywords: ["relancer", "relance", "facture", "retard", "impaye", iv.party ?? "", iv.creator ?? "", iv.ref ?? ""],
          run: () => go("relances"),
          exec: () => {
            const { subject, body } = relanceEmail(iv, reminders[iv.id]?.count ?? 0);
            window.location.href = relanceMailto(details[iv.id]?.clientEmail ?? "", subject, body);
            void recordReminder(iv.id).then((next) => {
              if (!next) return toast("Erreur, relance non enregistrée. Réessaie");
              setLocalRem(next);
              toast("Relance enregistrée ✓");
            });
          },
        });
      }
      if (late.length > 1) {
        actions.push({
          key: "relance:all",
          group: "actions",
          label: `Relancer les ${late.length} factures en retard`,
          meta: formatEuro(late.reduce((s, o) => s + parseAmount(o.iv.amount), 0)),
          icon: TtpRepeat,
          tone: "late",
          keywords: ["relancer", "relances", "factures", "retard", "impayes", "tout"],
          run: () => go("relances"),
        });
      }
    }
    if (!hidden.includes("todo"))
      actions.push({ key: "new:todo", group: "actions", label: "Nouvelle tâche", icon: TtpTodo, keywords: ["tache", "to-do", "todo", "ajouter", "creer", "nouveau"], run: () => { requestIntent("todo:new"); go("todo"); } });
    if (!hidden.includes("collabs"))
      actions.push({ key: "new:collab", group: "actions", label: "Nouvelle collab", icon: TtpCollabs, keywords: ["collab", "collaboration", "campagne", "ajouter", "creer", "nouveau"], run: () => { requestIntent("collab:new"); go("collabs"); } });
    if (!hidden.includes("mails"))
      actions.push({ key: "mails", group: "actions", label: "Trier les mails", icon: TtpMail, keywords: ["mail", "mails", "boite", "inbox", "non lus"], run: () => go("mails") });
    if (!hidden.includes("aujourdhui"))
      actions.push({ key: "today", group: "actions", label: "Traiter ma journée", icon: TtpToday, keywords: ["aujourd'hui", "journee", "a faire", "today"], run: () => go("aujourdhui") });
    // Sans requête : les deux relances les plus urgentes, puis les créations.
    out.push(...(query ? rankEntries(actions, query, 6) : [...actions.filter((a) => a.tone === "late").slice(0, 2), ...actions.filter((a) => a.key === "relance:all" || !a.tone)].slice(0, 6)));

    // ── Aller à ──
    const pages: Entry[] = NAV.flatMap((f) =>
      f.items
        .filter((i) => !hidden.includes(i.id))
        .map((i) => ({
          key: `page:${i.id}`,
          group: "pages" as const,
          label: i.label,
          meta: f.label,
          icon: ArrowRight,
          keywords: PAGE_ALIASES[i.id] ?? [],
          run: () => onSelect(i.id),
        })),
    );
    out.push(...(query ? rankEntries(pages, query, 5) : pages.filter((p) => p.meta === "Favoris").slice(0, 6)));

    // ── Résultats de la recherche globale ──
    if (query.length >= 2) {
      for (const [i, h] of rawHits.entries()) {
        const M = KIND_META[h.kind];
        if (M.view && hidden.includes(M.view)) continue;
        out.push({
          key: `hit:${i}`,
          group: "results",
          label: h.kind === "creator" ? titleCase(h.label) : h.label,
          sub: h.kind === "todo" && h.sub ? titleCase(h.sub) : h.sub,
          meta: M.label,
          icon: M.icon,
          run: () => {
            if (h.kind === "creator") return onOpenCreator(h.value);
            if (!M.view) return;
            setQuery(query); // la page ouverte filtre sur la recherche
            onGoto(M.view);
          },
        });
      }
    }

    // ── Megan ──
    if (canAgent && query) {
      out.push({ key: "megan", group: "megan", label: `« ${query} »`, meta: "⌘ J", icon: TtpSpark, tone: "info", run: () => go("agent") });
    }
    return out;
  }, [q, invoices, money, canAgent, hidden, rawHits, app, liveRem, localRem, onSelect, onGoto, onOpenCreator, setQuery]);

  // La sélection revient en tête quand la liste change de nature (nouvelle frappe).
  useEffect(() => setIndex(0), [q]);
  const safeIndex = entries.length ? Math.min(index, entries.length - 1) : 0;
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  const choose = (e: Entry | undefined, execute: boolean) => {
    if (!e) return;
    close();
    if (execute && e.exec) e.exec();
    else e.run();
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      setIndex(stepIndex(safeIndex, ev.key === "ArrowDown" ? 1 : -1, entries.length));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      choose(entries[safeIndex], ev.metaKey || ev.ctrlKey);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };

  let lastGroup: Group | null = null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Palette de commandes"
          key="palette"
          className="fixed inset-0 z-[1250] flex items-start justify-center sm:px-4 sm:pt-[12vh]"
          onKeyDown={onKeyDown}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/30 backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15 }}
            onClick={close}
          />
          <motion.div
            className="relative flex max-h-[85dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-b-[24px] bg-surface pt-[env(safe-area-inset-top)] shadow-2xl sm:max-h-[min(72vh,640px)] sm:rounded-[24px] sm:pt-0"
            initial={reduce ? false : { opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { type: "spring", damping: 32, stiffness: 420 }}
          >
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher ou faire quelque chose…"
                aria-label="Chercher une page, une action, un créateur"
                aria-activedescendant={entries.length ? `cmd-${safeIndex}` : undefined}
                aria-controls="cmd-list"
                enterKeyHint="go"
                className="min-w-0 flex-1 bg-transparent text-[20px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={close} aria-label="Fermer" className="shrink-0">
                <Kbd className="px-2">esc</Kbd>
              </button>
            </div>

            <div id="cmd-list" ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {entries.length === 0 ? (
                <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">
                  {loading ? "Recherche…" : `Rien pour « ${q.trim()} ».`}
                </p>
              ) : (
                entries.map((e, i) => {
                  const header = e.group !== lastGroup ? GROUP_LABEL[e.group] : null;
                  lastGroup = e.group;
                  const sel = i === safeIndex;
                  return (
                    <div key={e.key}>
                      {header && <div className="px-3 pb-1.5 pt-3 text-[13px] font-semibold text-muted-foreground first:pt-1">{header}</div>}
                      <div
                        id={`cmd-${i}`}
                        role="option"
                        aria-selected={sel}
                        data-index={i}
                        onMouseMove={() => i !== safeIndex && setIndex(i)}
                        onClick={(ev) => choose(e, ev.metaKey || ev.ctrlKey)}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5", sel ? "bg-primary text-primary-foreground" : "text-foreground")}
                      >
                        <IconTile tone={sel ? undefined : e.tone} size="sm" className={sel ? "bg-primary-foreground/20 text-primary-foreground" : undefined}>
                          <e.icon />
                        </IconTile>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[16px] font-medium">{e.label}</span>
                          {e.sub && <span className={cn("block truncate text-[12.5px]", sel ? "text-primary-foreground/75" : "text-muted-foreground")}>{e.sub}</span>}
                        </span>
                        {e.meta && <span className={cn("shrink-0 text-[14px] tabular-nums", sel ? "text-primary-foreground/85" : "text-muted-foreground")}>{e.meta}</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="hidden items-center gap-4 border-t border-border px-5 py-3 text-[13px] text-muted-foreground sm:flex">
              <span>↑ ↓ naviguer</span>
              <span>↵ ouvrir</span>
              <span>⌘ ↵ exécuter sans ouvrir</span>
              {canAgent && <span className="ml-auto">Megan : ⌘ J</span>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

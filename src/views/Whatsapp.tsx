import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import {
  MessageCircle, Mail, Phone, AtSign, Check, Clock, Send, ScrollText, ChevronDown, UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { dbUpdate } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { StatsBento } from "@/components/ui/stats-bento";
import { useSearch, matchQuery } from "@/lib/search";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { useAppState, type AppState } from "@/lib/appState";
import { MailComposer, type ComposerContact } from "@/components/mail-composer";
import {
  parseTouches, sortTouches, lastTouch, needsRelance, nextKind, lastActivityMs,
  buildTouchesPatch, derivedStatus, waLink, waHref, touchId,
  CANAL_LABELS, KIND_LABELS, RELANCE_DAYS,
  type Touch, type TouchCanal, type WaMode, type ProspectSettings, type DerivedTone,
} from "@/lib/touches";

/**
 * Page « WhatsApp » — le poste de travail prospection : qui contacter
 * aujourd'hui, en un geste, avec un STATUT calculé tout seul depuis le journal
 * (Jamais contacté → Contacté → Relancé ×N → A répondu). Aucune saisie de
 * statut : chaque bouton (WhatsApp, mail, insta, tél) note la prise de contact
 * et le statut suit. Les mails envoyés depuis l'app comptent déjà tout seuls.
 */

type Row = {
  id: string;
  brand: string;
  person: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  tag: string;
  email: string;
  phone: string;
  instagram?: string | null;
  creator?: string | null;
  last_contacted?: string | null;
  touches?: unknown;
};

const TONE_CLS: Record<DerivedTone, string> = {
  never: "bg-rowhover text-muted-foreground",
  contacted: "bg-cyan/15 text-cyan",
  relanced: "bg-indigo/15 text-indigo",
  replied: "bg-signalsoft text-signaltext",
};

function daysAgoLabel(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return "hier";
  if (d < 30) return `il y a ${d} j`;
  return `il y a ${Math.round(d / 30)} mois`;
}

export function WhatsappView() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("contacts"));
  const [error, setError] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composeFor, setComposeFor] = useState<Row | null>(null);
  const { query } = useSearch();
  const live = useLiveKey();

  const { data: cfg } = useAppState<ProspectSettings>((s: AppState) => (s["prospectSettings"] as ProspectSettings) ?? {});
  const relanceDays = Math.max(1, Number(cfg?.relanceDays) || RELANCE_DAYS);
  const waMode: WaMode = cfg?.waMode === "web" ? "web" : "app";

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase.from("contacts").select("*").order("sort_order");
      if (!active) return;
      if (error) {
        setError(true);
        setRows([]);
        return;
      }
      const list = (data as Row[]) ?? [];
      setCache("contacts", list);
      setRows(list);
    })();
    return () => {
      active = false;
    };
  }, [live]);

  // ── journalisation (même logique que la page Contacts, patch partagé) ──
  const saveTouches = async (row: Row, next: Touch[]) => {
    const patch = buildTouchesPatch(next, row.last_contacted);
    setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? ({ ...r, ...patch } as Row) : r)) : prev));
    if (!(await dbUpdate("contacts", row.id, patch))) toast("Erreur, réessaie");
  };
  const logTouch = (row: Row, canal: TouchCanal, kind?: Touch["kind"]) => {
    const list = parseTouches(row.touches);
    const t: Touch = { id: touchId(), date: new Date().toISOString(), canal, kind: kind ?? nextKind(list, row.last_contacted) };
    void saveTouches(row, [t, ...list]);
    toast(`${KIND_LABELS[t.kind]} · ${CANAL_LABELS[canal]} noté ✓`);
  };
  const act = (row: Row, canal: TouchCanal) => {
    if (canal === "whatsapp") {
      const url = waHref(row.phone, waMode);
      if (!url) return toast("Pas de numéro exploitable");
      window.open(url, "_blank", "noopener");
    } else if (canal === "email") {
      // Composeur avec modèles (prospection/relance) — la touche est notée
      // seulement après un envoi réussi.
      if (!row.email) return toast("Pas d'email");
      setComposeFor(row);
      setComposerOpen(true);
      return;
    } else if (canal === "instagram" && row.instagram) {
      window.open(`https://instagram.com/${row.instagram.replace(/^@/, "")}`, "_blank", "noopener");
    } else if (canal === "tel" && row.phone) {
      window.open(`tel:${row.phone.replace(/[^\d+]/g, "")}`, "_self");
    }
    logTouch(row, canal);
  };

  if (rows === null) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">Erreur de chargement.</div>;
  }

  // Périmètre : le carnet AGENCE (les contacts perso des créatrices restent à elles).
  const pool = rows.filter((r) => !(r.creator ?? "").trim() && matchQuery(query, r.brand, r.person, r.role, r.tag));

  const enrich = (r: Row) => {
    const list = parseTouches(r.touches);
    return { r, list, status: derivedStatus(list, r.last_contacted), lastMs: lastActivityMs(list, r.last_contacted) };
  };
  const all = pool.map(enrich);

  const aRelancer = all
    .filter((x) => needsRelance(x.list, x.r.last_contacted, relanceDays))
    .sort((a, b) => a.lastMs - b.lastMs); // le plus ancien d'abord
  const jamais = all.filter((x) => x.status.tone === "never" && (waLink(x.r.phone) || x.r.email));
  const enCours = all.filter((x) => x.lastMs > 0 && !needsRelance(x.list, x.r.last_contacted, relanceDays));

  // Journal global : les 30 dernières touches, tous contacts confondus.
  const journal = all
    .flatMap((x) => sortTouches(x.list).map((t) => ({ t, r: x.r })))
    .sort((a, b) => new Date(b.t.date).getTime() - new Date(a.t.date).getTime())
    .slice(0, 30);

  const weekMs = Date.now() - 7 * 86400e3;
  const monthMs = Date.now() - 30 * 86400e3;
  const faitsSemaine = all.reduce((n, x) => n + x.list.filter((t) => new Date(t.date).getTime() >= weekMs && t.kind !== "reponse").length, 0);
  const reponsesMois = all.reduce((n, x) => n + x.list.filter((t) => t.kind === "reponse" && new Date(t.date).getTime() >= monthMs).length, 0);
  const parCanal = (["whatsapp", "instagram", "tel", "linkedin", "email"] as TouchCanal[]).map(
    (c) => all.reduce((n, x) => n + x.list.filter((t) => t.canal === c).length, 0),
  );

  // ── rangée d'actions d'un contact ──
  const Actions = ({ x }: { x: ReturnType<typeof enrich> }) => (
    <div className="flex shrink-0 items-center gap-1">
      {waLink(x.r.phone) && (
        <button
          type="button"
          onClick={() => act(x.r, "whatsapp")}
          title="Ouvrir WhatsApp et noter la prise de contact"
          className="grid h-8 w-8 place-items-center rounded-lg bg-signal text-white transition-opacity hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      )}
      {x.r.email && (
        <button type="button" onClick={() => act(x.r, "email")} title="Écrire un mail depuis un modèle (prospection / relance)"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
          <Mail className="h-4 w-4" />
        </button>
      )}
      {x.r.instagram && (
        <button type="button" onClick={() => act(x.r, "instagram")} title="Ouvrir Instagram et noter la prise de contact"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
          <AtSign className="h-4 w-4" />
        </button>
      )}
      {x.r.phone && !waLink(x.r.phone) && (
        <button type="button" onClick={() => act(x.r, "tel")} title="Appeler et noter la prise de contact"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
          <Phone className="h-4 w-4" />
        </button>
      )}
      {x.list.length > 0 && lastTouch(x.list)?.kind !== "reponse" && (
        <button
          type="button"
          onClick={() => logTouch(x.r, lastTouch(x.list)?.canal ?? "autre", "reponse")}
          title="Il ou elle a répondu"
          className="grid h-8 w-8 place-items-center rounded-lg border border-signal/30 bg-signal/[0.08] text-signal transition-colors hover:bg-signal/15"
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const ContactRow = ({ x, showAgo }: { x: ReturnType<typeof enrich>; showAgo?: boolean }) => {
    const lt = lastTouch(x.list);
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-sm transition-colors hover:bg-rowhover">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-panel text-[11px] font-bold text-foreground">
          {initials(x.r.person !== "—" ? x.r.person : x.r.brand)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{x.r.brand}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
            {x.r.person !== "—" && <span className="truncate">{x.r.person}</span>}
            {showAgo && x.lastMs > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" /> {daysAgoLabel(x.lastMs)}
                {lt && <span className="text-faint">· {CANAL_LABELS[lt.canal]}</span>}
              </span>
            )}
          </div>
        </div>
        <span className={cn("hidden shrink-0 rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide sm:inline", TONE_CLS[x.status.tone])}>
          {x.status.label}
        </span>
        <Actions x={x} />
      </div>
    );
  };

  const composerContact: ComposerContact | null = composeFor
    ? {
        email: composeFor.email,
        label:
          [composeFor.brand, composeFor.person !== "—" ? composeFor.person : ""].filter(Boolean).join(" · ") ||
          composeFor.email,
        brand: composeFor.brand,
        person: composeFor.person,
        first_name: composeFor.first_name,
        hasBeenContacted: parseTouches(composeFor.touches).length > 0 || Boolean(composeFor.last_contacted),
      }
    : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {pool.length} contact{pool.length > 1 ? "s" : ""} · statut mis à jour tout seul depuis ton journal
        </div>
        <button
          type="button"
          onClick={() => {
            setComposeFor(null);
            setComposerOpen(true);
          }}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          Modèles de mails
        </button>
      </div>

      {pool.length > 0 && (
        <StatsBento
          className="mb-5"
          primary={{ eyebrow: "À relancer", value: String(aRelancer.length), caption: `Dernier échange il y a ${relanceDays} j ou plus. Réglable dans Paramètres.` }}
          bars={{ label: "Par canal (total)", value: `${faitsSemaine} cette semaine`, series: parCanal }}
          small={{ value: String(reponsesMois), label: "Réponses (30 j)" }}
          accent={{ value: String(jamais.length), label: "Jamais contactés", icon: UserRound }}
        />
      )}

      {/* 1) À relancer aujourd'hui */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          <Send className="h-3 w-3" /> À relancer ({aRelancer.length})
        </div>
        {aRelancer.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-faint">
            Personne à relancer. Tout ton carnet a été touché il y a moins de {relanceDays} jours 🎯
          </div>
        ) : (
          <div className="flex flex-col gap-2">{aRelancer.map((x) => <ContactRow key={x.r.id} x={x} showAgo />)}</div>
        )}
      </section>

      {/* 2) Jamais contactés */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          <UserRound className="h-3 w-3" /> Jamais contactés ({jamais.length})
        </div>
        {jamais.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-faint">
            Tout le carnet a déjà été approché au moins une fois.
          </div>
        ) : (
          <div className="flex flex-col gap-2">{jamais.map((x) => <ContactRow key={x.r.id} x={x} />)}</div>
        )}
      </section>

      {/* 3) En cours (cycle pas encore écoulé) */}
      {enCours.length > 0 && (
        <section className="mb-5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
            <Clock className="h-3 w-3" /> En cours ({enCours.length})
          </div>
          <div className="flex flex-col gap-2">
            {enCours
              .sort((a, b) => b.lastMs - a.lastMs)
              .map((x) => <ContactRow key={x.r.id} x={x} showAgo />)}
          </div>
        </section>
      )}

      {/* 4) Journal d'activité (replié) */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <button type="button" onClick={() => setJournalOpen(!journalOpen)} className="flex w-full items-center gap-2 text-left">
          <span className="grid size-7 place-items-center rounded-lg bg-panel text-muted-foreground"><ScrollText className="h-4 w-4" /></span>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">Journal de prospection</span>
          <span className="rounded-full bg-rowhover px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{journal.length}</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 text-faint transition-transform", journalOpen && "rotate-180")} />
        </button>
        {journalOpen && (
          <div className="mt-3 flex flex-col gap-0.5">
            {journal.length === 0 ? (
              <div className="px-2 py-3 text-center text-[12px] text-faint">Rien pour le moment. Chaque bouton cliqué laissera une trace ici.</div>
            ) : (
              journal.map(({ t, r }) => (
                <div key={t.id} className="flex items-baseline gap-2.5 rounded-md px-2 py-1.5 text-[11px] hover:bg-rowhover">
                  <span className="shrink-0 tabular-nums text-faint">
                    {new Date(t.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                  </span>
                  <span className={cn("shrink-0 font-semibold", t.kind === "reponse" ? "text-signaltext" : "text-foreground")}>{KIND_LABELS[t.kind]}</span>
                  <span className="shrink-0 text-muted-foreground">{CANAL_LABELS[t.canal]}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{r.brand}{r.person !== "—" ? ` · ${titleCase(r.person)}` : ""}</span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <MailComposer
        open={composerOpen}
        contact={composerContact}
        onClose={() => setComposerOpen(false)}
        onSent={() => {
          if (composeFor) logTouch(composeFor, "email");
        }}
      />
    </div>
  );
}

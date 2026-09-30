import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import {
  Gauge, Send, Search, HeartHandshake, BookOpen, GraduationCap, ScrollText,
  Mail, MessageCircle, BriefcaseBusiness, AtSign, TriangleAlert, Copy, Check, X,
  ChevronDown, Trash2, Plus, AlarmClock, ExternalLink, UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import { useLiveKey } from "@/lib/useLive";
import { frDate } from "@/lib/dates";

/**
 * Page « Agent » (Espace Agence, fondateurs) — pilote l'agent IA branché sur le
 * schéma `agent` (Phase 6 de la spec). Blocs dans l'ordre : cockpit du jour,
 * file d'attente d'actions, prospection, cercle, mémoire créatrices, leçons,
 * journal (replié). Les validations de Marc écrivent dans les MÊMES tables :
 * l'agent les relit à son passage suivant.
 *
 * Textes visibles : ponctuation française propre, pas de tirets (spec).
 */

type Cockpit = { id: string; jour: string; contenu: string; cree_le: string };
type Action = {
  id: string; type: string; cible: string | null; contexte: string | null;
  contenu: string | null; lien_spark: string | null; statut: string;
  cree_le: string; traite_le: string | null;
};
type Prospect = {
  id: string; marque: string; signal: string | null; signal_date: string | null;
  contact: string | null; contact_role: string | null; canal: string | null;
  creatrice: string | null; angle: string | null; premier_message: string | null;
  statut: string; prochaine_relance: string | null; notes: string | null;
  cree_le: string; maj_le: string;
};
type Cercle = {
  id: string; contact: string; entreprise: string | null; type: string | null;
  frequence: string | null; dernier_contact: string | null;
  prochain_pretexte: string | null; statut: string; cree_le: string;
};
type Memoire = {
  id: string; creatrice: string; categorie: string; info: string;
  date: string | null; source: string | null; cree_le: string;
};
type Lecon = { id: string; module: string | null; lecon: string; cree_le: string };
type Journal = { id: string; action: string; detail: string | null; cree_le: string };

const ACTION_META: Record<string, { label: string; icon: LucideIcon }> = {
  brouillon_mail: { label: "Brouillon mail", icon: Mail },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  linkedin: { label: "LinkedIn", icon: BriefcaseBusiness },
  instagram: { label: "Instagram", icon: AtSign },
  alerte: { label: "Alerte", icon: TriangleAlert },
};

const PROSPECT_OPTS: StatusOption[] = [
  { value: "valide", label: "Validé", dot: "bg-primary" },
  { value: "contacte", label: "Contacté", dot: "bg-cyan" },
  { value: "relance_1", label: "Relance 1", dot: "bg-indigo" },
  { value: "relance_2", label: "Relance 2", dot: "bg-indigo" },
  { value: "relance_3", label: "Relance 3", dot: "bg-indigo" },
  { value: "repondu", label: "Répondu", dot: "bg-signal" },
  { value: "converti", label: "Converti", dot: "bg-signal" },
  { value: "abandonne", label: "Abandonné", dot: "bg-muted-foreground" },
];
const PROSPECT_ACTIFS = ["valide", "contacte", "relance_1", "relance_2", "relance_3", "repondu"];

const CAT_LABELS: Record<string, string> = {
  anniversaire: "Anniversaire",
  projet: "Projet",
  voyage: "Voyage",
  examen: "Examen",
  objectif: "Objectif",
  preference_tournage: "Préférence de tournage",
  disponibilite: "Disponibilité",
};

const CERCLE_TYPES: Record<string, string> = {
  marque_cliente: "Marque cliente",
  agence_partenaire: "Agence partenaire",
  prospect_chaud: "Prospect chaud",
};

function fmtDT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Carte de section : icône, titre, compteur, repliable. */
function Section({ icon: Icon, title, count, children, collapsible = false, defaultOpen = true }: {
  icon: LucideIcon; title: string; count?: number; children: ReactNode;
  collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const head = (
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-lg bg-panel text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-rowhover px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{count}</span>
      )}
      {collapsible && (
        <ChevronDown className={cn("ml-auto h-4 w-4 text-faint transition-transform", open && "rotate-180")} />
      )}
    </div>
  );
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      {collapsible ? (
        <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">{head}</button>
      ) : head}
      {(!collapsible || open) && <div className="mt-3">{children}</div>}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[12px] text-faint">{text}</div>;
}

/** Bouton de suppression en deux temps (clic 1 : armer, clic 2 : supprimer). */
function DeleteButton({ armed, onArm, onConfirm, title }: {
  armed: boolean; onArm: () => void; onConfirm: () => void; title: string;
}) {
  return armed ? (
    <button type="button" onClick={onConfirm}
      className="shrink-0 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-500 transition-colors hover:bg-red-500/20">
      Supprimer ?
    </button>
  ) : (
    <button type="button" onClick={onArm} title={title}
      className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-rowhover hover:text-red-500">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

export function AgentView() {
  const live = useLiveKey();
  const [notExposed, setNotExposed] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [cockpits, setCockpits] = useState<Cockpit[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [cercle, setCercle] = useState<Cercle[]>([]);
  const [memoire, setMemoire] = useState<Memoire[]>([]);
  const [lecons, setLecons] = useState<Lecon[]>([]);
  const [journal, setJournal] = useState<Journal[]>([]);

  const [memCreatrice, setMemCreatrice] = useState<string>("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [leconOpen, setLeconOpen] = useState(false);
  const [leconModule, setLeconModule] = useState("");
  const [leconTexte, setLeconTexte] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const db = supabase.schema("agent");
      const [ck, ac, pr, ce, me, le, jo] = await Promise.all([
        db.from("cockpits").select("*").order("jour", { ascending: false }).limit(14),
        db.from("actions").select("*").order("cree_le", { ascending: false }).limit(200),
        db.from("prospects").select("*").order("maj_le", { ascending: false }).limit(200),
        db.from("cercle").select("*").order("cree_le", { ascending: false }).limit(200),
        db.from("memoire_createurs").select("*").order("cree_le", { ascending: false }).limit(500),
        db.from("lecons").select("*").order("cree_le", { ascending: false }).limit(200),
        db.from("journal").select("*").order("cree_le", { ascending: false }).limit(120),
      ]);
      if (!active) return;
      const firstErr = [ck, ac, pr, ce, me, le, jo].find((r) => r.error)?.error;
      if (firstErr) {
        if (firstErr.code === "PGRST106") setNotExposed(true);
        else setError(true);
        setLoaded(true);
        return;
      }
      setCockpits((ck.data as Cockpit[]) ?? []);
      setActions((ac.data as Action[]) ?? []);
      setProspects((pr.data as Prospect[]) ?? []);
      setCercle((ce.data as Cercle[]) ?? []);
      setMemoire((me.data as Memoire[]) ?? []);
      setLecons((le.data as Lecon[]) ?? []);
      setJournal((jo.data as Journal[]) ?? []);
      setNotExposed(false);
      setError(false);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [live]);

  // ── mutations (schéma agent) + trace dans le journal pour l'agent ──
  const upd = async (table: string, id: string, patch: Record<string, unknown>): Promise<boolean> => {
    const { error } = await supabase.schema("agent").from(table).update(patch).eq("id", id);
    if (error) { toast("Erreur, réessaie"); return false; }
    return true;
  };
  const del = async (table: string, id: string): Promise<boolean> => {
    const { error } = await supabase.schema("agent").from(table).delete().eq("id", id);
    if (error) { toast("Erreur, réessaie"); return false; }
    return true;
  };
  const log = (action: string, detail: string) => {
    // .then() obligatoire : le builder Supabase est paresseux, la requête ne
    // part qu'à la souscription (un simple `void` ne l'enverrait jamais).
    supabase.schema("agent").from("journal").insert({ action, detail }).then(() => {}, () => {});
  };

  // ── état de l'agent : actif si trace dans le journal depuis 26 h ──
  const lastAct = journal.find((j) => !j.action.startsWith("marc_"))?.cree_le ?? journal[0]?.cree_le;
  const agentActif = !!lastAct && Date.now() - new Date(lastAct).getTime() < 26 * 3600e3;

  const cockpitJour = cockpits.find((c) => c.jour === todayISO()) ?? null;
  const dernierCockpit = cockpitJour ?? cockpits[0] ?? null;

  const queue = actions.filter((a) => a.statut === "a_valider");
  const traiteesSemaine = actions.filter(
    (a) => a.statut !== "a_valider" && a.traite_le && Date.now() - new Date(a.traite_le).getTime() < 7 * 86400e3,
  ).length;

  const proposes = prospects.filter((p) => p.statut === "propose");
  const suivis = prospects.filter((p) => PROSPECT_ACTIFS.includes(p.statut));

  const cercleProposes = cercle.filter((c) => c.statut === "propose");
  const cercleValides = cercle.filter((c) => c.statut === "valide");

  const creatricesMem = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of memoire) m.set(e.creatrice, (m.get(e.creatrice) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [memoire]);
  // Sélection périmée (créatrice disparue de la mémoire) → retombe sur la première.
  const memSel = creatricesMem.some(([n]) => n === memCreatrice) ? memCreatrice : (creatricesMem[0]?.[0] ?? "");
  const memEntries = memoire.filter((e) => e.creatrice === memSel);

  // ── actions de Marc ──
  const copier = async (a: Action) => {
    try {
      await navigator.clipboard.writeText(a.contenu ?? "");
      setCopied(a.id);
      setTimeout(() => setCopied((c) => (c === a.id ? null : c)), 1600);
      toast("Message copié ✓");
    } catch {
      toast("Copie impossible, sélectionne le texte à la main");
    }
  };
  const traiter = async (a: Action, statut: "envoye" | "ecarte") => {
    const patch = { statut, traite_le: new Date().toISOString() };
    setActions((xs) => xs.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
    if (!(await upd("actions", a.id, patch))) {
      setActions((xs) => xs.map((x) => (x.id === a.id ? a : x)));
      return;
    }
    log(statut === "envoye" ? "marc_envoye" : "marc_ecarte", `${ACTION_META[a.type]?.label ?? a.type} · ${a.cible ?? ""}`);
    toast(statut === "envoye" ? "Marqué envoyé ✓" : "Écarté ✓");
  };
  const deciderProspect = async (p: Prospect, statut: "valide" | "ecarte") => {
    setProspects((xs) => xs.map((x) => (x.id === p.id ? { ...x, statut } : x)));
    if (!(await upd("prospects", p.id, { statut }))) {
      setProspects((xs) => xs.map((x) => (x.id === p.id ? p : x)));
      return;
    }
    log(statut === "valide" ? "marc_prospect_valide" : "marc_prospect_ecarte", p.marque);
    toast(statut === "valide" ? "Prospection validée ✓" : "Écartée ✓");
  };
  const changerStatutProspect = async (p: Prospect, statut: string) => {
    setProspects((xs) => xs.map((x) => (x.id === p.id ? { ...x, statut } : x)));
    if (!(await upd("prospects", p.id, { statut }))) {
      setProspects((xs) => xs.map((x) => (x.id === p.id ? p : x)));
      return;
    }
    log("marc_prospect_statut", `${p.marque} : ${statut}`);
  };
  const deciderCercle = async (c: Cercle, garder: boolean) => {
    if (garder) {
      setCercle((xs) => xs.map((x) => (x.id === c.id ? { ...x, statut: "valide" } : x)));
      if (!(await upd("cercle", c.id, { statut: "valide" }))) {
        setCercle((xs) => xs.map((x) => (x.id === c.id ? c : x)));
        return;
      }
      log("marc_cercle_valide", c.contact);
      toast("Ajouté au cercle ✓");
    } else {
      setCercle((xs) => xs.filter((x) => x.id !== c.id));
      if (!(await del("cercle", c.id))) {
        setCercle((xs) => [c, ...xs]);
        return;
      }
      log("marc_cercle_retire", c.contact);
      toast("Retiré ✓");
    }
  };
  const supprimerMemoire = async (e: Memoire) => {
    setConfirmDel(null);
    setMemoire((xs) => xs.filter((x) => x.id !== e.id));
    if (!(await del("memoire_createurs", e.id))) {
      setMemoire((xs) => [e, ...xs]);
      return;
    }
    log("marc_memoire_suppr", `${e.creatrice} · ${CAT_LABELS[e.categorie] ?? e.categorie}`);
    toast("Info supprimée ✓");
  };
  const ajouterLecon = async () => {
    if (!leconTexte.trim()) return toast("Écris la leçon d'abord");
    const row = { module: leconModule.trim() || null, lecon: leconTexte.trim() };
    const { data, error } = await supabase.schema("agent").from("lecons").insert(row).select();
    if (error || !data?.[0]) return toast("Erreur, réessaie");
    setLecons((xs) => [data[0] as Lecon, ...xs]);
    log("marc_lecon", row.lecon.slice(0, 80));
    setLeconModule(""); setLeconTexte(""); setLeconOpen(false);
    toast("Leçon enregistrée ✓");
  };
  const supprimerLecon = async (l: Lecon) => {
    setConfirmDel(null);
    setLecons((xs) => xs.filter((x) => x.id !== l.id));
    if (!(await del("lecons", l.id))) setLecons((xs) => [l, ...xs]);
  };

  // ── rendus ──
  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  }
  if (notExposed) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
        <div className="text-[15px] font-semibold text-foreground">Le schéma agent n'est pas encore exposé à l'app.</div>
        <div className="mt-2">
          Dashboard Supabase → Settings → API → « Exposed schemas » : ajouter <span className="font-mono text-[12px] text-foreground">agent</span> à la liste, puis recharge cette page.
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">Erreur de chargement.</div>;
  }

  const relanceDepassee = (d: string | null) => !!d && d < todayISO();

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête : état de l'agent */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <span className="relative flex h-2.5 w-2.5">
          {agentActif && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60 motion-reduce:hidden" />}
          <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", agentActif ? "bg-signal" : "bg-muted-foreground/50")} />
        </span>
        <span className="text-[13px] font-semibold text-foreground">{agentActif ? "Agent actif" : "Agent en veille"}</span>
        {lastAct && <span className="text-[11px] text-muted-foreground">Dernière activité : {fmtDT(lastAct)}</span>}
        <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
          <span>{queue.length} à valider</span>
          <span>{proposes.length + suivis.length} prospects</span>
        </span>
      </div>

      {/* 1) Le cockpit du jour */}
      <Section icon={Gauge} title="Cockpit du jour">
        {dernierCockpit ? (
          <div>
            {!cockpitJour && (
              <div className="mb-2 text-[11px] text-amber">Pas encore de cockpit aujourd'hui, voici le dernier ({frDate(dernierCockpit.jour)}).</div>
            )}
            <div className="whitespace-pre-wrap rounded-xl bg-panel px-4 py-3 text-[13px] leading-relaxed text-foreground">{dernierCockpit.contenu}</div>
          </div>
        ) : (
          <Empty text="L'agent n'a pas encore déposé de cockpit. Il apparaîtra ici à son premier passage." />
        )}
      </Section>

      {/* 2) La file d'attente */}
      <Section icon={Send} title="File d'attente" count={queue.length}>
        {queue.length === 0 ? (
          <Empty text={traiteesSemaine > 0 ? `Rien à valider. ${traiteesSemaine} action${traiteesSemaine > 1 ? "s" : ""} traitée${traiteesSemaine > 1 ? "s" : ""} ces 7 derniers jours.` : "Rien à valider pour le moment."} />
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((a) => {
              const meta = ACTION_META[a.type] ?? { label: a.type, icon: Send };
              const MIcon = meta.icon;
              return (
                <div key={a.id} className={cn("rounded-xl border border-border bg-surface p-3", a.type === "alerte" && "border-amber/40")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold", a.type === "alerte" ? "bg-amber/15 text-amber" : "bg-primary/10 text-primary")}>
                      <MIcon className="h-3 w-3" /> {meta.label}
                    </span>
                    {a.cible && <span className="text-[12px] font-semibold uppercase tracking-wide text-foreground">{a.cible}</span>}
                    <span className="ml-auto text-[10px] text-faint">{fmtDT(a.cree_le)}</span>
                  </div>
                  {a.contexte && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{a.contexte}</p>}
                  {a.contenu && (
                    <div className="mt-2 whitespace-pre-wrap rounded-lg bg-panel px-3 py-2.5 text-[12px] leading-relaxed text-foreground">{a.contenu}</div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {a.contenu && (
                      <button type="button" onClick={() => copier(a)}
                        className="flex h-[34px] items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                        {copied === a.id ? <Check className="h-3.5 w-3.5 text-signal" /> : <Copy className="h-3.5 w-3.5" />} Copier le message
                      </button>
                    )}
                    {a.lien_spark && (
                      <a href={a.lien_spark} target="_blank" rel="noreferrer"
                        className="flex h-[34px] items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                        <ExternalLink className="h-3.5 w-3.5" /> Brouillon Spark
                      </a>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <button type="button" onClick={() => traiter(a, "ecarte")}
                        className="flex h-[34px] items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                        <X className="h-3.5 w-3.5" /> Écarté
                      </button>
                      <button type="button" onClick={() => traiter(a, "envoye")}
                        className="flex h-[34px] items-center gap-1.5 rounded-lg bg-primary px-4 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90">
                        <Check className="h-3.5 w-3.5" /> Envoyé
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 3) La prospection */}
      <Section icon={Search} title="Prospection de la semaine" count={proposes.length}>
        {proposes.length === 0 ? (
          <Empty text="Aucune nouvelle proposition. L'agent en déposera après son analyse." />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {proposes.map((p) => (
              <div key={p.id} className="flex flex-col rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{p.marque}</span>
                  {p.canal && <span className="rounded-full bg-rowhover px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{p.canal}</span>}
                  {p.signal_date && <span className="ml-auto text-[10px] text-faint">{frDate(p.signal_date)}</span>}
                </div>
                {p.signal && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{p.signal}</p>}
                <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
                  {p.contact && (
                    <span className="flex items-center gap-1.5"><UserRound className="h-3 w-3 text-faint" /> {p.contact}{p.contact_role ? `, ${p.contact_role}` : ""}</span>
                  )}
                  {p.creatrice && (
                    <span>Créatrice : <span className="font-semibold uppercase tracking-wide text-foreground">{p.creatrice}</span></span>
                  )}
                  {p.angle && <span>Angle : {p.angle}</span>}
                </div>
                {p.premier_message && (
                  <div className="mt-2 whitespace-pre-wrap rounded-lg bg-panel px-3 py-2 text-[11px] leading-relaxed text-foreground">{p.premier_message}</div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" onClick={() => deciderProspect(p, "ecarte")}
                    className="flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <X className="h-3.5 w-3.5" /> Écarter
                  </button>
                  <button type="button" onClick={() => deciderProspect(p, "valide")}
                    className="flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90">
                    <Check className="h-3.5 w-3.5" /> Valider
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Suivi des prospects en cours */}
        <div className="mt-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Suivi en cours</div>
          {suivis.length === 0 ? (
            <Empty text="Aucun prospect en cours de suivi." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {suivis.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-panel px-3 py-2">
                  <span className="text-[12px] font-semibold text-foreground">{p.marque}</span>
                  {p.creatrice && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.creatrice}</span>}
                  {p.prochaine_relance && (
                    <span className={cn("flex items-center gap-1 text-[10px]", relanceDepassee(p.prochaine_relance) ? "font-semibold text-amber" : "text-faint")}>
                      <AlarmClock className="h-3 w-3" /> Relance {frDate(p.prochaine_relance)}
                    </span>
                  )}
                  <div className="ml-auto">
                    <StatusSelect value={p.statut} options={PROSPECT_OPTS} onChange={(v) => changerStatutProspect(p, v)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* 4) Le cercle */}
      <Section icon={HeartHandshake} title="Cercle" count={cercleValides.length + cercleProposes.length}>
        {cercleProposes.length + cercleValides.length === 0 ? (
          <Empty text="Aucune relation suivie pour le moment. L'agent proposera des contacts à entretenir." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {cercleProposes.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2">
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">Proposé</span>
                <span className="text-[12px] font-semibold text-foreground">{c.contact}</span>
                {c.entreprise && <span className="text-[11px] text-muted-foreground">{c.entreprise}</span>}
                {c.type && <span className="rounded-full bg-rowhover px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{CERCLE_TYPES[c.type] ?? c.type}</span>}
                {c.prochain_pretexte && <span className="text-[11px] text-muted-foreground">Prétexte : {c.prochain_pretexte}</span>}
                <div className="ml-auto flex items-center gap-1.5">
                  <button type="button" onClick={() => deciderCercle(c, false)}
                    className="rounded-md border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover">Retirer</button>
                  <button type="button" onClick={() => deciderCercle(c, true)}
                    className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">Valider</button>
                </div>
              </div>
            ))}
            {cercleValides.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-panel px-3 py-2">
                <span className="text-[12px] font-semibold text-foreground">{c.contact}</span>
                {c.entreprise && <span className="text-[11px] text-muted-foreground">{c.entreprise}</span>}
                {c.type && <span className="rounded-full bg-rowhover px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{CERCLE_TYPES[c.type] ?? c.type}</span>}
                {c.frequence && <span className="text-[10px] text-faint">Fréquence : {c.frequence}</span>}
                {c.dernier_contact && <span className="text-[10px] text-faint">Dernier contact : {frDate(c.dernier_contact)}</span>}
                {c.prochain_pretexte && <span className="text-[11px] text-muted-foreground">Prétexte : {c.prochain_pretexte}</span>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5) La mémoire créatrices */}
      <Section icon={BookOpen} title="Mémoire créatrices" count={memoire.length}>
        {memoire.length === 0 ? (
          <Empty text="Rien en mémoire pour le moment. L'agent y notera ce que les créatrices partagent (jamais de santé ni de vie privée)." />
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {creatricesMem.map(([name, count]) => (
                <button key={name} type="button" onClick={() => setMemCreatrice(name)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                    memSel === name ? "bg-primary text-primary-foreground" : "bg-panel text-muted-foreground hover:text-foreground",
                  )}>
                  {name} · {count}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {memEntries.map((e) => (
                <div key={e.id} className="flex items-start gap-2.5 rounded-lg bg-panel px-3 py-2">
                  <span className="mt-0.5 shrink-0 rounded-full bg-rowhover px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                    {CAT_LABELS[e.categorie] ?? e.categorie}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] leading-relaxed text-foreground">{e.info}</div>
                    <div className="mt-0.5 text-[10px] text-faint">
                      {e.date ? frDate(e.date) : frDate(e.cree_le)}{e.source ? ` · ${e.source}` : ""}
                    </div>
                  </div>
                  <DeleteButton
                    armed={confirmDel === e.id}
                    onArm={() => setConfirmDel(e.id)}
                    onConfirm={() => supprimerMemoire(e)}
                    title="Supprimer cette info"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* 6) Les leçons apprises */}
      <Section icon={GraduationCap} title="Leçons apprises" count={lecons.length}>
        <div className="mb-3">
          {leconOpen ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 sm:w-40">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Module</span>
                <input value={leconModule} onChange={(e) => setLeconModule(e.target.value)} placeholder="ex Prospection"
                  className="h-[36px] rounded-lg border border-border bg-panel px-3 text-[12px] text-foreground outline-none focus:border-primary" />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">La leçon</span>
                <input value={leconTexte} onChange={(e) => setLeconTexte(e.target.value)} placeholder="Ce que l'agent doit retenir…"
                  onKeyDown={(e) => { if (e.key === "Enter") ajouterLecon(); }}
                  className="h-[36px] rounded-lg border border-border bg-panel px-3 text-[12px] text-foreground outline-none focus:border-primary" />
              </label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setLeconOpen(false)}
                  className="h-[36px] rounded-lg border border-border px-3 text-[11px] font-medium text-muted-foreground hover:bg-rowhover">Annuler</button>
                <button type="button" onClick={ajouterLecon}
                  className="h-[36px] rounded-lg bg-primary px-4 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90">Ajouter</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setLeconOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Corriger l'agent (nouvelle leçon)
            </button>
          )}
        </div>
        {lecons.length === 0 ? (
          <Empty text="Aucune leçon pour le moment. Chaque correction que tu enregistres ici guide l'agent." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {lecons.map((l) => (
              <div key={l.id} className="flex items-start gap-2.5 rounded-lg bg-panel px-3 py-2">
                {l.module && <span className="mt-0.5 shrink-0 rounded-full bg-rowhover px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{titleCase(l.module)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] leading-relaxed text-foreground">{l.lecon}</div>
                  <div className="mt-0.5 text-[10px] text-faint">{fmtDT(l.cree_le)}</div>
                </div>
                <DeleteButton
                  armed={confirmDel === l.id}
                  onArm={() => setConfirmDel(l.id)}
                  onConfirm={() => supprimerLecon(l)}
                  title="Supprimer cette leçon"
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 7) Le journal d'activité (replié par défaut) */}
      <Section icon={ScrollText} title="Journal d'activité" count={journal.length} collapsible defaultOpen={false}>
        {journal.length === 0 ? (
          <Empty text="Le journal est vide. Chaque action de l'agent y laissera une trace." />
        ) : (
          <div className="flex flex-col gap-0.5">
            {journal.map((j) => (
              <div key={j.id} className="flex items-baseline gap-2.5 rounded-md px-2 py-1.5 text-[11px] hover:bg-rowhover">
                <span className="shrink-0 tabular-nums text-faint">{fmtDT(j.cree_le)}</span>
                <span className="shrink-0 font-semibold text-foreground">{j.action}</span>
                {j.detail && <span className="min-w-0 truncate text-muted-foreground">{j.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

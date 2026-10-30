import type { LucideIcon } from "@/components/icons";
import {
  TtpBell, TtpBrief, TtpChecklist, TtpCollabs, TtpContacts, TtpContract, TtpDeadline, TtpExclu, TtpDm, TtpEngagement, TtpEvolution,
  TtpFiles, TtpFolder, TtpHistory, TtpIdea, TtpInvoice, TtpLock, TtpMail, TtpMediakit, TtpPerson, TtpPipeline,
  TtpPlanning, TtpPulse, TtpReport, TtpScouting, TtpSend, TtpSliders, TtpSourcing, TtpSpark, TtpStar, TtpStats, TtpTag,
  TtpTarget, TtpTemplate, TtpToday, TtpTodo, TtpTransfer, TtpGains,
} from "@/components/icons/ttp-icons";

export type ViewId =
  | "aujourdhui"
  | "activite"
  | "agent"
  | "stats"
  | "objectifs"
  | "facturation"
  | "reversements"
  | "compta"
  | "relances"
  | "echeances"
  | "exclusivites"
  | "roster"
  | "engagement"
  | "pricing"
  | "vivier"
  | "sourcing"
  | "collabs"
  | "mediakit"
  | "briefs"
  | "gifting"
  | "ideas"
  | "todo"
  | "planning"
  | "documents"
  | "contacts"
  | "whatsapp"
  | "messages"
  | "mails"
  | "prospection"
  | "contrats"
  | "debrief"
  | "templates"
  | "checklist"
  | "acces"
  | "parametres"
  | "diagnostique"
  | "suivi"
  | "corbeille";

/** Sous-page d'une page (3e niveau de nav) : `id` = onglet ciblé dans la vue parente. */
/** Sous-page. `pinnable` : c'est aussi une vraie page, épinglable aux raccourcis (avec son icône). */
export type NavChild = { id: string; label: string; icon?: LucideIcon; pinnable?: boolean };
export type NavItem = { id: ViewId; label: string; icon: LucideIcon; children?: NavChild[] };
export type NavFamily = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Section toujours dépliée (Favoris), hors accordéon. */
  fixed?: boolean;
  items: NavItem[];
};

// Organisation (refaite le 2026-10-30, refonte « Studio ») : en tête les FAVORIS, les pages
// ouvertes tous les jours (toujours dépliés) ; puis une section par métier.
//   • Favoris : la journée ;                 • Talents : le roster et ses chiffres ;
//   • Prospection : trouver les marques ;    • Collaborations : livrer une campagne ;
//   • Finance : l'argent et le pilotage ;    • Agence : les agents et les ressources ;
//   • Réglages.
// Les pages qui faisaient doublon sont devenues des onglets de leur page hôte (src/lib/pageMerges.ts) :
// leur `id` reste valable et ouvre la page hôte sur le bon onglet.
// Les `id` ne changent JAMAIS (raccourcis, droits, onglets enregistrés) : seuls l'ordre,
// le rangement et les libellés bougent.
export const NAV: NavFamily[] = [
  {
    id: "favoris",
    label: "Favoris",
    icon: TtpStar,
    fixed: true,
    items: [
      { id: "aujourdhui", label: "Aujourd'hui", icon: TtpToday },
      { id: "todo", label: "To-do", icon: TtpTodo },
      {
        id: "mails",
        label: "Messages",
        icon: TtpMail,
        children: [
          { id: "boite", label: "Mails" },
          { id: "messages", label: "DM Instagram", icon: TtpDm, pinnable: true },
        ],
      },
      { id: "collabs", label: "Collabs", icon: TtpCollabs },
      {
        id: "planning",
        label: "Planning",
        icon: TtpPlanning,
        children: [
          { id: "agenda", label: "Agenda" },
          { id: "instagram", label: "Posts Instagram" },
        ],
      },
    ],
  },
  {
    id: "talents",
    label: "Talents",
    icon: TtpPerson,
    items: [
      {
        id: "roster",
        label: "Roster",
        icon: TtpPerson,
        children: [
          { id: "liste", label: "Liste" },
          { id: "accompagnement", label: "Accompagnement" },
          { id: "suivi", label: "Évolution", icon: TtpEvolution, pinnable: true },
          { id: "engagement", label: "Engagement", icon: TtpEngagement, pinnable: true },
        ],
      },
      {
        id: "vivier",
        label: "Scouting",
        icon: TtpScouting,
        children: [
          { id: "createurs", label: "Créateurs" },
          { id: "sportifs", label: "Sportifs" },
        ],
      },
      {
        id: "mediakit",
        label: "Media kit",
        icon: TtpMediakit,
        children: [
          { id: "creatrices", label: "Créateurs" },
          { id: "agence", label: "Agence" },
          { id: "files", label: "Fichiers" },
        ],
      },
      { id: "pricing", label: "Tarifs", icon: TtpTag },
    ],
  },
  {
    id: "relations",
    label: "Prospection",
    icon: TtpContacts,
    items: [
      {
        id: "contacts",
        label: "Contacts",
        icon: TtpContacts,
        children: [
          { id: "repertoire", label: "Répertoire" },
          { id: "whatsapp", label: "À contacter", icon: TtpSend, pinnable: true },
        ],
      },
      { id: "prospection", label: "Pipeline", icon: TtpPipeline },
      { id: "sourcing", label: "Sourcing", icon: TtpSourcing },
    ],
  },
  {
    id: "travail",
    label: "Collaborations",
    icon: TtpCollabs,
    items: [
      { id: "briefs", label: "Briefs", icon: TtpBrief },
      {
        id: "contrats",
        label: "Contrats",
        icon: TtpContract,
        children: [
          { id: "marque", label: "Marque × Créateur" },
          { id: "repr", label: "Représentation" },
          { id: "ugc", label: "Contrat UGC" },
          { id: "echeances", label: "Fins de contrat", icon: TtpDeadline, pinnable: true },
          { id: "exclusivites", label: "Exclusivités", icon: TtpExclu, pinnable: true },
        ],
      },
      { id: "debrief", label: "Debrief", icon: TtpReport },
      { id: "ideas", label: "Idées", icon: TtpIdea },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: TtpInvoice,
    items: [
      {
        id: "facturation",
        label: "Facturation",
        icon: TtpInvoice,
        children: [
          { id: "factures", label: "Factures" },
          { id: "relances", label: "Relances", icon: TtpBell, pinnable: true },
        ],
      },
      { id: "reversements", label: "Reversements", icon: TtpTransfer },
      { id: "compta", label: "Compta", icon: TtpGains },
      {
        id: "stats",
        label: "Stats",
        icon: TtpStats,
        children: [
          { id: "chiffres", label: "Chiffres" },
          { id: "objectifs", label: "Objectifs", icon: TtpTarget, pinnable: true },
        ],
      },
    ],
  },
  {
    id: "agence",
    label: "Agence",
    icon: TtpFolder,
    items: [
      { id: "agent", label: "Agents", icon: TtpSpark },
      { id: "documents", label: "Documents", icon: TtpFiles },
      { id: "templates", label: "Modèles", icon: TtpTemplate },
      { id: "checklist", label: "Checklist", icon: TtpChecklist },
    ],
  },
  {
    id: "reglages",
    label: "Réglages",
    icon: TtpSliders,
    items: [
      {
        id: "acces",
        label: "Accès",
        icon: TtpLock,
        children: [
          { id: "comptes", label: "Comptes app" },
          { id: "emails", label: "E-mails créateurs" },
        ],
      },
      { id: "parametres", label: "Paramètres", icon: TtpSliders },
      { id: "activite", label: "Activité", icon: TtpHistory },
      { id: "diagnostique", label: "Diagnostic", icon: TtpPulse },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((f) => f.items);

/** Section Favoris : UNE seule, ses pages fixes + les pages ajoutées à l'étoile. */
export const FAVORIS_ID = "favoris";
/** Pages toujours dans Favoris (pas d'étoile : on ne peut pas les en retirer). */
export const FAVORIS_BASE: ReadonlySet<string> = new Set(NAV.find((f) => f.id === FAVORIS_ID)?.items.map((i) => i.id) ?? []);

/** Étoiles au plus (pages ajoutées à Favoris) : au-delà, les étoiles ne veulent plus rien dire. */
export const MAX_PINS = 5;

/**
 * Ajoute les pages mises en favoris (étoile) au bout de la section Favoris, sans
 * doublon : une page en favori quitte sa famille (Talents, Prospection…), et une famille
 * vidée disparaît. Sans section Favoris visible (pages rangées), `make` en crée une en tête.
 */
export function withFavorites<I extends { id: string }, G extends { id: string; items: I[] }>(groups: G[], extras: I[], make: (items: I[]) => G): G[] {
  const fav = groups.find((g) => g.id === FAVORIS_ID);
  const add = extras.filter((e, i) => extras.findIndex((x) => x.id === e.id) === i && !fav?.items.some((it) => it.id === e.id));
  if (!add.length) return groups;
  const moved = new Set(add.map((a) => a.id));
  const strip = (items: I[]) =>
    items
      .filter((it) => !moved.has(it.id))
      .map((it) => {
        const kids = (it as { children?: { id: string }[] }).children;
        return kids?.some((c) => moved.has(c.id)) ? { ...it, children: kids.filter((c) => !moved.has(c.id)) } : it;
      });
  const rest = groups
    .map((g) => (g === fav ? g : { ...g, items: strip(g.items) }))
    .filter((g) => g === fav || g.items.length > 0);
  if (fav) return rest.map((g) => (g === fav ? { ...g, items: [...g.items, ...add] } : g));
  return [make(add), ...rest];
}

/**
 * Ordre choisi pour la section Favoris (glisser-déposer) : les pages rangées d'abord,
 * dans cet ordre ; les autres (nouvelle étoile…) gardent leur place relative, à la suite.
 */
export function orderByIds<T extends { id: string }>(items: T[], order: readonly string[] | null | undefined): T[] {
  if (!order?.length) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((it, i) => ({ it, i, r: rank.get(it.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.it);
}

export function findItem(id: ViewId): NavItem | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}

/** Page épinglable : une entrée de nav, ou une sous-page qui est aussi une page (Mails). */
export function findPinnable(id: ViewId): NavItem | undefined {
  const it = findItem(id);
  if (it) return it;
  for (const i of ALL_ITEMS) {
    const c = (i.children ?? []).find((x) => x.id === id && x.pinnable);
    if (c) return { id: c.id as ViewId, label: c.label, icon: c.icon ?? i.icon };
  }
  return undefined;
}

/** Titre affiché d'une vue : entrée de nav, sinon SOUS-PAGE portant le même id
 *  (ex. Mails, sous-page de Prospection), sinon libellés fixes. Sans ce repli, une
 *  vue devenue sous-page s'affichait avec le titre de l'accueil. */
export function viewTitle(id: string): string {
  const it = ALL_ITEMS.find((i) => i.id === id);
  if (it) return it.label;
  for (const i of ALL_ITEMS) for (const c of i.children ?? []) if (c.id === id) return c.label;
  return id === "corbeille" ? "Corbeille" : "Aujourd'hui";
}

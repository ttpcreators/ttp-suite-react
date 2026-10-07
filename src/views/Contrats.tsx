import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Check, Plus, Trash2, Save, FileText, Eye, X, History, UserRound, Bookmark, PenLine, SlidersHorizontal, ListPlus, type LucideIcon } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

/** Titre de section façon Aperçu : icône grise + intitulé 14 px. */
function SecTitle({ icon: Icon, children, right }: { icon: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-[14px] font-semibold text-foreground">{children}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
import { cn, titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { printHtml } from "@/lib/printPdf";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, parseAmount, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { TextField } from "@/components/ui/form";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { Tabs } from "@/components/ui/animated-tabs";
import { RepresentationContract } from "@/views/RepresentationContract";
import { useNavSub, useSetNavSub } from "@/lib/navSub";
import { CONTRACT_CSS, docHead, docMast, docTitleLastWord, docToday } from "@/lib/pdfDoc";
import { nbspFr } from "@/lib/representationContract";
import { Overlay } from "@/components/mobile/ios-sheet";

type CtType = "marque" | "repr" | "ugc";

const TYPE_META: Record<CtType, { chip: string; label: string; title: string }> = {
  marque: { chip: "Marque × Créateur", label: "MARQUE × CRÉATEUR", title: "Contrat de partenariat commercial" },
  repr: { chip: "Représentation", label: "AGENCE × CRÉATEUR", title: "Contrat de représentation" },
  ugc: { chip: "Contrat UGC", label: "CONTRAT UGC", title: "Cession de droits UGC" },
};

type Term = { l: string; v: string };

// ══════════════════════════════════════════════════════════════════════════════
// Socle de clauses — rédigé au droit français, vérifié sur Légifrance.
//
// Choix structurants (ne pas « simplifier » sans revérifier) :
//  • Le DROIT D'AUTEUR (CPI) et le DROIT À L'IMAGE (art. 9 C. civ.) sont DEUX régimes
//    distincts → deux clauses séparées. La Cour de cassation (Civ. 1re, 11 déc. 2008,
//    n° 07-19.494 ; 9 juil. 2009, n° 07-19.758) juge que l'art. 9 est « seul applicable
//    en matière de cession de droit à l'image, à l'exclusion notamment du CPI », et que
//    détenir les droits sur l'ŒUVRE ne donne PAS le droit d'utiliser l'IMAGE de la
//    personne pour la promouvoir : autorisation distincte requise.
//  • Le droit moral (art. L121-1 CPI) est perpétuel, inaliénable et imprescriptible →
//    on ne le « rachète » jamais, on le rappelle.
//  • Cession per-livrable : la cession globale des œuvres FUTURES est nulle (L131-1).
//    Chaque droit cédé fait l'objet d'une mention distincte et le domaine d'exploitation
//    est délimité quant à l'étendue, la destination, le lieu et la durée (L131-3).
//  • INDÉPENDANCE : une clause « ceci n'est pas un contrat de travail » ne vaut rien
//    face à la présomption de salariat du mannequin (L7123-3/-4, non renversée par la
//    qualification des parties ni par l'autonomie ni par le statut). Ce qui protège,
//    c'est la RÉALITÉ : liberté éditoriale du créateur + redevance d'exploitation
//    proportionnelle (L7123-6), jamais un forfait « droits image » déguisé.
// ══════════════════════════════════════════════════════════════════════════════
const CLAUSES: Term[] = [
  { l: "Art. 1 — Objet", v: "Le présent contrat définit les conditions de la prestation et les engagements réciproques des parties." },
  { l: "Art. 2 — Rémunération & paiement", v: "Les sommes sont versées par virement à 30 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.)." },
  { l: "Art. 3 — Droits d'auteur sur les contenus", v: "Le créateur conserve la propriété de ses contenus. La cession éventuelle de droits d'exploitation porte sur des contenus déterminés (jamais sur ses œuvres futures — art. L131-1 CPI) : chaque droit cédé fait l'objet d'une mention distincte, le domaine d'exploitation étant délimité quant à son étendue, sa destination, son lieu et sa durée (art. L131-3 CPI). Toute réutilisation hors périmètre fait l'objet d'un avenant." },
  { l: "Art. 4 — Droit à l'image", v: "L'autorisation d'utiliser l'image de la personne du créateur est distincte de la cession des droits d'auteur (art. 9 C. civ.) et limitée aux supports, au territoire, à la durée et aux contextes expressément stipulés. Elle exclut tout usage de nature à porter atteinte à sa réputation. Aucun usage hors de ce cadre sans accord écrit." },
  { l: "Art. 5 — Droit moral", v: "Le droit moral du créateur sur ses œuvres est inaliénable, perpétuel et imprescriptible (art. L121-1 CPI) : respect de son nom, de sa qualité et de l'intégrité de l'œuvre. Toute modification substantielle d'un contenu requiert son accord." },
  { l: "Art. 6 — Indépendance des parties", v: "Le créateur agit en prestataire indépendant : il conserve sa liberté éditoriale et de réalisation, n'est soumis à aucun lien de subordination et assume ses propres cotisations sociales. Aucune stipulation du contrat ne saurait caractériser un contrat de travail." },
  { l: "Art. 7 — Transparence publicitaire", v: "Tout contenu à visée commerciale est identifié de façon claire et lisible (« Publicité » ou « Collaboration commerciale »), conformément à la loi n° 2023-451 du 9 juin 2023 encadrant l'influence commerciale (modifiée par l'ord. n° 2024-978 du 6 nov. 2024), au droit de la consommation et aux recommandations de l'ARPP. Le cas échéant, les images retouchées (« Images retouchées ») et générées par IA (« Images virtuelles ») sont signalées." },
  { l: "Art. 8 — Données personnelles (RGPD)", v: "Les parties traitent les données conformément au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés. Finalité limitée à l'exécution du contrat." },
  { l: "Art. 9 — Confidentialité & résiliation", v: "Obligation de confidentialité réciproque. Résiliation possible pour manquement grave après mise en demeure restée infructueuse sous 15 jours." },
  { l: "Art. 10 — Force majeure", v: "Aucune partie n'est responsable d'un manquement dû à un cas de force majeure au sens de l'art. 1218 C. civ. ; les obligations sont suspendues le temps de l'empêchement." },
  { l: "Art. 11 — Droit applicable & litiges", v: "Contrat régi par le droit français. À défaut d'accord amiable (médiation préalable), compétence des tribunaux de Lyon (art. 42 CPC — sous réserve des règles impératives protégeant le for du défendeur non-commerçant)." },
];

// ══════════════════════════════════════════════════════════════════
// Cas de figure — sélecteurs qui adaptent AUTOMATIQUEMENT le contrat
// (termes + clauses) pour que le template colle à la réalité du deal.
// ══════════════════════════════════════════════════════════════════
type Opt = { v: string; label: string };

const COLLAB_OPTS: Opt[] = [
  { v: "sponso", label: "Post sponsorisé" },
  { v: "ugc", label: "UGC (sans diffusion)" },
  { v: "gifting", label: "Placement / gifting" },
  { v: "ambassador", label: "Ambassadeur (long terme)" },
  { v: "event", label: "Prestation événementielle" },
];
const RIGHTS_OPTS: Opt[] = [
  { v: "organic", label: "Organique, compte créateur seul" },
  { v: "repost", label: "Repost organique par la marque" },
  { v: "paid", label: "Paid media / whitelisting (ads)" },
  { v: "buyout", label: "Cession totale (buyout)" },
];
const DUR_OPTS: Opt[] = [
  { v: "3 mois", label: "3 mois" },
  { v: "6 mois", label: "6 mois" },
  { v: "12 mois", label: "12 mois" },
  { v: "illimitée", label: "Illimitée" },
];
const TERRITORY_OPTS: Opt[] = [
  { v: "France", label: "France" },
  { v: "France + DOM-TOM", label: "France + DOM-TOM" },
  { v: "Europe", label: "Europe" },
  { v: "Monde", label: "Monde entier" },
];
const PAYMENT_OPTS: Opt[] = [
  { v: "30j", label: "Virement · 30 j fin de mois" },
  { v: "livraison", label: "À la livraison" },
  { v: "acompte", label: "50 % acompte · 50 % livraison" },
  { v: "45j", label: "Virement · 45 j" },
];
const TVA_OPTS: Opt[] = [
  { v: "non", label: "Non assujetti (art. 293 B CGI)" },
  { v: "20", label: "TVA 20 %" },
];
const EXCL_OPTS: Opt[] = [
  { v: "non", label: "Aucune" },
  { v: "cat30", label: "Catégorie · 30 jours" },
  { v: "cat90", label: "Catégorie · 90 jours" },
  { v: "total", label: "Secteur complet · durée du contrat" },
];

const labelOf = (opts: Opt[], v: string) => opts.find((o) => o.v === v)?.label ?? v;

type Scenario = {
  collab: string;
  rights: string;
  rightsDuration: string;
  territory: string;
  payment: string;
  tva: string;
  exclScope: string;
  defraiement: boolean;
};

const SCENARIO_DEFAULT: Scenario = {
  collab: "sponso",
  rights: "organic",
  rightsDuration: "6 mois",
  territory: "France",
  payment: "30j",
  tva: "non",
  exclScope: "cat30",
  defraiement: false,
};

function objetOf(collab: string, brand: string): string {
  const b = brand || "—";
  switch (collab) {
    case "ugc": return `Production de contenus UGC pour ${b}`;
    case "gifting": return `Placement de produit — ${b}`;
    case "ambassador": return `Programme ambassadeur — ${b}`;
    case "event": return `Prestation événementielle — ${b}`;
    default: return `Campagne ${b}`;
  }
}

function rightsValue(s: Scenario): string {
  switch (s.rights) {
    case "repost": return `Repost organique — ${s.rightsDuration}`;
    case "paid": return `Paid media / whitelisting — ${s.rightsDuration}`;
    case "buyout": return `Cession totale (buyout) — ${s.rightsDuration}`;
    default: return "Organique, compte du créateur uniquement";
  }
}

function payClause(payment: string): string {
  switch (payment) {
    case "livraison": return "Les sommes sont versées par virement à la livraison et à la validation des contenus. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
    case "acompte": return "50 % du montant sont versés à la signature (acompte), le solde à la livraison et à la validation des contenus. Tout retard entraîne les pénalités légales (art. L441-10 C. com.).";
    case "45j": return "Les sommes sont versées par virement à 45 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
    default: return "Les sommes sont versées par virement à 30 jours fin de mois. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
  }
}

function rightsClause(s: Scenario): string {
  const terr = s.territory;
  const dur = s.rightsDuration;
  switch (s.rights) {
    case "repost": return `Le créateur conserve la propriété de ses contenus et autorise l'Annonceur à les reposter sur ses propres canaux organiques (sans achat média), pour une durée de ${dur}, sur le territoire : ${terr}. Toute diffusion payante fait l'objet d'un avenant.`;
    case "paid": return `Le créateur cède à l'Annonceur les droits d'exploitation des contenus en publicité payante (whitelisting / paid media), pour une durée de ${dur}, sur le territoire : ${terr}. Cession limitée aux supports et à la durée stipulés.`;
    case "buyout": return `Cession totale (buyout) : le créateur cède l'ensemble des droits d'exploitation des contenus, tous supports, sur le territoire : ${terr}, pour une durée de ${dur}. Rémunération incluse dans le montant.`;
    default: return "Le créateur conserve la pleine propriété de ses contenus, publiés sur son seul compte. Aucune réutilisation par l'Annonceur hors de son compte n'est autorisée sans avenant.";
  }
}

/** Seuil (HT) au-delà duquel la vérification de vigilance URSSAF est obligatoire (art. R8222-1). */
const VIGILANCE_SEUIL_EUR = 5000;

/**
 * Clauses adaptées au cas de figure : Art. 2/3 réécrits + clauses optionnelles.
 * `htValue` sert à insérer la clause de vigilance sociale quand elle devient obligatoire.
 */
function buildClauses(s: Scenario, htValue = 0): Term[] {
  const base: Term[] = [
    CLAUSES[0], // Art. 1 — Objet
    { l: "Art. 2 — Rémunération & paiement", v: payClause(s.payment) },
    { l: "Art. 3 — Droits d'auteur & droits d'usage", v: rightsClause(s) },
    ...CLAUSES.slice(3), // Art. 4 (droit à l'image) → Art. 11 (litiges)
  ];
  let n = base.length + 1;
  const opt: Term[] = [];
  if (s.exclScope !== "non") {
    const detail =
      s.exclScope === "total"
        ? "opérant dans le même secteur d'activité, pour toute la durée du contrat"
        : `de la même catégorie de produits, pendant ${s.exclScope === "cat90" ? "90" : "30"} jours à compter de la publication`;
    opt.push({ l: `Art. ${n++} — Exclusivité`, v: `Pendant la période d'exclusivité, le créateur s'interdit toute collaboration rémunérée avec une marque concurrente ${detail}.` });
  }
  if (s.defraiement) {
    opt.push({ l: `Art. ${n++} — Frais & défraiement`, v: "L'Annonceur prend en charge les produits nécessaires à la prestation ainsi que les frais de déplacement et d'hébergement engagés à sa demande, sur présentation de justificatifs." });
  }
  // Prestation ≥ 5 000 € HT → le donneur d'ordre DOIT vérifier la vigilance URSSAF, à la
  // signature et tous les 6 mois (art. L8222-1, R8222-1, D8222-5 C. trav.), sous peine de
  // solidarité financière (L8222-2). On matérialise l'obligation dans le contrat.
  if (htValue >= VIGILANCE_SEUIL_EUR) {
    opt.push({ l: `Art. ${n++} — Vigilance sociale`, v: "La prestation étant d'un montant au moins égal à 5 000 € HT, le créateur remet à la signature, puis tous les six mois jusqu'au terme, une attestation de vigilance URSSAF de moins de six mois (art. L8222-1, R8222-1 et D8222-5 C. trav.), dont l'authenticité est vérifiée auprès de l'organisme de recouvrement." });
  }
  return [...base, ...opt];
}

type Clause = { id: string; l: string; v: string };

/** Un « cas » de configuration réutilisable, enregistré par créateur. */
type ContractCase = {
  id: string;
  name: string;
  ctType: CtType;
  brand: string;
  value: string;
  commission: string;
  duration: string;
  deliverables: string;
  excl: boolean;
  extra: Clause[];
  // Cas de figure (optionnels → compat descendante avec les cas déjà enregistrés).
  collab?: string;
  rights?: string;
  rightsDuration?: string;
  territory?: string;
  payment?: string;
  tva?: string;
  exclScope?: string;
  defraiement?: boolean;
};
type ContractConfigs = Record<string, ContractCase[]>;

let _uid = 0;
const uid = () => `c${Date.now().toString(36)}${(_uid += 1)}`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

function refFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 900;
  return `TTP-${new Date().getFullYear()}-${String(90 + h).padStart(3, "0")}`;
}

const primaryBtn = "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const ghostBtn = "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Overlay className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClose={onClose}>
      <div className={cn("my-2 w-full rounded-2xl border border-border bg-card shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </Overlay>
  );
}

function contractHTML(o: {
  ref: string;
  meta: { label: string; title: string };
  ctName: string;
  brand: string;
  parties: string;
  terms: Term[];
  clauses: Term[];
}): string {
  const { ref, meta, ctName, brand, parties, terms, clauses } = o;
  const termRows = terms
    .map((t) => `<div class="row"><dt>${esc(t.l)}</dt><span class="lead"></span><dd>${esc(t.v)}</dd></div>`)
    .join("");
  const clauseBlocks = clauses
    .map(
      (c, i) =>
        // « Art. 3 — Droits d'auteur » → « Droits d'auteur » : le numéro est déjà affiché à gauche.
        `<section class="art"><h3><span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(c.l.replace(/^Art(?:icle)?\.?\s*\d+\s*[—–-]\s*/i, ""))}</h3><p>${esc(c.v)}</p></section>`,
    )
    .join("");
  const kind = meta.label.charAt(0) + meta.label.slice(1).toLowerCase().replace("× créateur", "× Créateur").replace("ugc", "UGC");
  return `${docHead(`Contrat ${ref}`, CONTRACT_CSS)}<body><div class="wrap">
${docMast([`<b>${esc(kind)}</b>`, `Réf. ${esc(ref)}`, esc(docToday()), "Confidentiel"])}
<p class="kicker">${esc(kind)}</p>
<h1>${docTitleLastWord(meta.title)}</h1>
<div class="parties"><div class="p1">TTP Creators &amp; ${esc(ctName)} <i>×</i> ${esc(brand || "[Marque]")}</div>${esc(parties)}</div>
<dl class="meta">${termRows}</dl>
<div class="arts">${clauseBlocks}</div>
<div class="sign">
  <div><div class="who">Pour TTP Creators</div><div class="line"></div><div class="cap">Date et signature, précédées de « Lu et approuvé »</div></div>
  <div><div class="who">Pour ${esc(ctName)}</div><div class="line"></div><div class="cap">Date et signature, précédées de « Lu et approuvé »</div></div>
</div>
<div class="legal">Contrat régi par le droit français · Conforme RGPD (UE 2016/679) · Directive 2011/83/UE · Fait à Lyon. Document généré par TTP Suite.</div>
</div></body></html>`;
}

function SelectField({ label, value, onChange, opts, className }: { label: string; value: string; onChange: (v: string) => void; opts: Opt[]; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full rounded-lg bg-surface" placeholder={label} />
        <SelectContent>
          {opts.map((o, i) => (
            <SelectItem key={o.v} index={i} value={o.v}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Un contrat archivé (généré depuis cette page) — stocké dans le blob app_state
 *  `brandContractHistory` pour consultation rapide. On garde le HTML rendu → ré-ouverture
 *  et export PDF à l'identique, sans dépendre de la config du moment. */
type ContractHistoryEntry = {
  id: string;
  ts: number;
  ctType: CtType;
  ctName: string;
  brand: string;
  ref: string;
  title: string;
  html: string;
};

export function Contrats() {
  const creators = useCreators();
  const { data: cfgData } = useAppState<ContractConfigs>((s: AppState) => (s["contractConfigs"] as ContractConfigs) ?? {});
  const [localCfg, setLocalCfg] = useState<ContractConfigs | null>(null);
  const configs = localCfg ?? cfgData ?? {};
  // Historique des contrats générés (blob app_state).
  const { data: histData } = useAppState<ContractHistoryEntry[]>((s: AppState) => (s["brandContractHistory"] as ContractHistoryEntry[]) ?? []);
  const [localHist, setLocalHist] = useState<ContractHistoryEntry[] | null>(null);
  const history = localHist ?? histData ?? [];

  const [ctType, setCtType] = useState<CtType>("marque");
  // Sous-page demandée depuis la sidebar (Contrats → Marque × Créateur / Représentation / UGC).
  const navSub = useNavSub();
  const setNavSub = useSetNavSub();
  useEffect(() => {
    if (navSub === "marque" || navSub === "repr" || navSub === "ugc") setCtType(navSub);
  }, [navSub]);
  const [creatorName, setCreatorName] = useState("");
  const [brand, setBrand] = useState("Sephora");
  const [value, setValue] = useState("32 000 €");
  const [commission, setCommission] = useState("20");
  const [duration, setDuration] = useState("12 mois");
  const [deliverables, setDeliverables] = useState("3 posts · 1 reel");
  const [extra, setExtra] = useState<Clause[]>([]);
  // Cas de figure
  const [collab, setCollab] = useState(SCENARIO_DEFAULT.collab);
  const [rights, setRights] = useState(SCENARIO_DEFAULT.rights);
  const [rightsDuration, setRightsDuration] = useState(SCENARIO_DEFAULT.rightsDuration);
  const [territory, setTerritory] = useState(SCENARIO_DEFAULT.territory);
  const [payment, setPayment] = useState(SCENARIO_DEFAULT.payment);
  const [tva, setTva] = useState(SCENARIO_DEFAULT.tva);
  const [exclScope, setExclScope] = useState(SCENARIO_DEFAULT.exclScope);
  const [defraiement, setDefraiement] = useState(SCENARIO_DEFAULT.defraiement);
  const scenario: Scenario = { collab, rights, rightsDuration, territory, payment, tva, exclScope, defraiement };
  const [copied, setCopied] = useState(false);
  // `hist` : aperçu d'un contrat de l'historique (ne doit rien ré-archiver)
  const [preview, setPreview] = useState<{ html: string; hist: boolean } | null>(null);
  const [caseName, setCaseName] = useState("Standard");
  const [pendingDel, setPendingDel] = useState<null | { title?: string; message: string; run: () => void }>(null);

  const ctName = creatorName || creators[0]?.name || "[Créateur]";
  // Affichage seulement (contrat / aperçu) : la clé stockée reste ctName.
  const ctDisplay = ctName === "[Créateur]" ? ctName : titleCase(ctName);
  const cases: ContractCase[] = configs[ctName] ?? [];

  // Charge un cas dans le formulaire.
  const applyCase = (cs: ContractCase) => {
    setCtType(cs.ctType);
    if (navSub) setNavSub(cs.ctType); // garde la sidebar alignée sur le type chargé
    setBrand(cs.brand);
    setValue(cs.value);
    setCommission(cs.commission);
    setDuration(cs.duration);
    setDeliverables(cs.deliverables);
    setExtra(cs.extra ?? []);
    setCaseName(cs.name);
    // Cas de figure — replis pour les cas enregistrés avant cette fonctionnalité.
    setCollab(cs.collab ?? SCENARIO_DEFAULT.collab);
    setRights(cs.rights ?? SCENARIO_DEFAULT.rights);
    setRightsDuration(cs.rightsDuration ?? SCENARIO_DEFAULT.rightsDuration);
    setTerritory(cs.territory ?? SCENARIO_DEFAULT.territory);
    setPayment(cs.payment ?? SCENARIO_DEFAULT.payment);
    setTva(cs.tva ?? SCENARIO_DEFAULT.tva);
    setExclScope(cs.exclScope ?? (cs.excl ? "cat30" : "non"));
    setDefraiement(cs.defraiement ?? SCENARIO_DEFAULT.defraiement);
  };

  // Au changement de créateur (ou à l'arrivée des configs), charge son 1er cas s'il en a un,
  // une seule fois par créateur. Sans cas enregistré : on remet les valeurs par défaut.
  const appliedFor = useRef<string | null>(null);
  const lastCt = useRef<string | null>(null);
  useEffect(() => {
    const switched = lastCt.current !== ctName;
    lastCt.current = ctName;
    if (switched) appliedFor.current = null;
    if (appliedFor.current === ctName) return;
    // Sous-page choisie dans la sidebar : on ne charge qu'un cas du MÊME type,
    // sinon le type repasserait sur celui du 1er cas (rebond vers « marque »).
    const list = configs[ctName] ?? [];
    const cs = navSub ? list.find((c) => c.ctType === ctType) : list[0];
    if (cs) {
      applyCase(cs);
      appliedFor.current = ctName;
    } else if (switched) {
      setBrand("Sephora");
      setValue("32 000 €");
      setCommission("20");
      setCaseName("Standard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctName, configs]);

  const meta = TYPE_META[ctType];
  const exclLabel = labelOf(EXCL_OPTS, exclScope);
  const payLabel = labelOf(PAYMENT_OPTS, payment);
  const tvaLabel = labelOf(TVA_OPTS, tva);
  const commClean = String(commission).replace(/[^0-9.]/g, "") || "20";
  const ref = refFor(ctName);

  const { parties, terms } = useMemo<{ parties: string; terms: Term[] }>(() => {
    const payTerms: Term[] = [
      { l: "Modalités", v: payLabel },
      { l: "TVA", v: tvaLabel },
    ];
    if (ctType === "marque") {
      return {
        parties: `ENTRE ${brand || "[Annonceur]"} (l'Annonceur) ET ${ctDisplay}, représenté(e) par TTP Creators (l'Agent).`,
        terms: [
          { l: "Objet", v: objetOf(collab, brand) },
          { l: "Nature", v: labelOf(COLLAB_OPTS, collab) },
          { l: "Livrables", v: deliverables || "—" },
          { l: "Montant", v: nbspFr(value || "—") },
          { l: "Cession de droits", v: rightsValue(scenario) },
          { l: "Territoire", v: territory },
          { l: "Exclusivité", v: exclLabel },
          { l: "Durée", v: duration || "—" },
          { l: "Commission TTP", v: `${commClean}% du montant` },
          ...(defraiement ? [{ l: "Frais & produits", v: "Pris en charge par l'Annonceur" }] : []),
          ...payTerms,
        ],
      };
    }
    if (ctType === "repr") {
      return {
        parties: `ENTRE ${ctDisplay} (le Créateur) ET TTP Creators (l'Agent), pour la gestion de sa carrière.`,
        terms: [
          { l: "Objet", v: "Représentation exclusive" },
          { l: "Commission", v: `${commClean}%` },
          { l: "Exclusivité", v: exclLabel },
          { l: "Durée", v: duration || "—" },
          { l: "Périmètre", v: "Négo · contrats · facturation" },
          ...payTerms,
        ],
      };
    }
    return {
      parties: `ENTRE ${brand || "[Client]"} (le Client) ET ${ctDisplay} (Créateur UGC), via TTP Creators.`,
      terms: [
        { l: "Objet", v: `Contenus UGC pour ${brand || "—"}` },
        { l: "Livrables", v: deliverables || "—" },
        { l: "Montant", v: nbspFr(value || "—") },
        { l: "Cession de droits", v: rightsValue(scenario) },
        { l: "Territoire", v: territory },
        { l: "Exclusivité", v: exclLabel },
        { l: "Durée", v: duration || "—" },
        ...(defraiement ? [{ l: "Frais & produits", v: "Pris en charge par l'Annonceur" }] : []),
        ...payTerms,
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctType, brand, ctDisplay, deliverables, value, exclLabel, duration, commClean, collab, rights, rightsDuration, territory, payLabel, tvaLabel, defraiement]);

  // Valeur HT (approx : en franchise 293 B, HT ≈ montant affiché) → déclenche la clause
  // de vigilance URSSAF au-delà de 5 000 € HT.
  const htNum = parseAmount(value);
  const allClauses: Term[] = [...buildClauses(scenario, htNum), ...extra.map((e) => ({ l: e.l, v: e.v }))].map((c) => ({ ...c, v: nbspFr(c.v) }));
  const nextClauseNo = buildClauses(scenario, htNum).length + 1 + extra.length;
  const isBrand = ctType !== "repr";

  const contractText = useMemo(() => {
    return [
      "CONTRAT DE COLLABORATION",
      meta.title.toUpperCase(),
      `Réf. ${ref}`,
      "",
      `Parties : TTP Creators & ${ctDisplay} × ${brand || "[Marque]"}`,
      "",
      parties,
      "",
      ...terms.map((t) => `• ${t.l} : ${t.v}`),
      "",
      "CLAUSES",
      ...allClauses.map((c) => `${c.l}\n${c.v}`),
      "",
      "Fait à Lyon — Pour TTP Creators / Pour " + ctDisplay,
    ].join("\n");
  }, [meta.title, ref, ctDisplay, brand, parties, terms, allClauses]);

  const buildHTML = () => contractHTML({ ref, meta, ctName: ctDisplay, brand, parties, terms, clauses: allClauses });

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(contractText);
      setCopied(true);
      toast("Contrat copié ✓");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Impossible de copier — presse-papier bloqué");
    }
  };

  const downloadPDF = () => {
    // Ouvre la boîte d'impression → « Enregistrer au format PDF » (vrai PDF, texte net).
    const html = buildHTML();
    void archiveContract(html);
    printHtml(html);
    toast("Contrat archivé · choisis « Enregistrer au format PDF »");
  };

  // ── Cas de configuration (par créateur) ──
  // Relecture fraîche avant merge : ne pas écraser les cas d'autres créateurs.
  const mutateConfigs = async (fn: (fresh: ContractConfigs) => ContractConfigs) => {
    invalidateAppState();
    const fresh = ((await getAppState())["contractConfigs"] as ContractConfigs) ?? {};
    const next = fn(fresh);
    setLocalCfg(next);
    const ok = await saveAppStateKey("contractConfigs", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
  };

  const saveCase = async () => {
    const name = caseName.trim() || "Cas";
    const cs: ContractCase = { id: uid(), name, ctType, brand, value, commission, duration, deliverables, excl: exclScope !== "non", extra, collab, rights, rightsDuration, territory, payment, tva, exclScope, defraiement };
    let existed = false;
    const ok = await mutateConfigs((fresh) => {
      const list = fresh[ctName] ?? [];
      const idx = list.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
      existed = idx >= 0;
      const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? { ...cs, id: c.id } : c)) : [...list, cs];
      return { ...fresh, [ctName]: nextList };
    });
    if (ok) toast(existed ? `Cas « ${name} » mis à jour ✓` : `Cas « ${name} » enregistré ✓`);
  };

  const deleteCase = async (id: string) => {
    const ok = await mutateConfigs((fresh) => ({
      ...fresh,
      [ctName]: (fresh[ctName] ?? []).filter((c) => c.id !== id),
    }));
    if (ok) toast("Cas supprimé");
  };

  // ── Historique des contrats (blob) — relecture fraîche avant merge ──
  const mutateHistory = async (fn: (fresh: ContractHistoryEntry[]) => ContractHistoryEntry[]) => {
    invalidateAppState();
    const fresh = ((await getAppState())["brandContractHistory"] as ContractHistoryEntry[]) ?? [];
    const next = fn(fresh);
    setLocalHist(next);
    const ok = await saveAppStateKey("brandContractHistory", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
  };
  /** Archive le contrat courant. Dédoublonne (même HTML que le dernier archivé) et
   *  plafonne à 100 entrées pour borner la taille du blob. */
  const archiveContract = async (html: string) => {
    let entry: ContractHistoryEntry | null = null;
    const ok = await mutateHistory((fresh) => {
      if (fresh.some((h) => h.html === html)) return fresh; // déjà archivé à l'identique
      entry = { id: uid(), ts: Date.now(), ctType, ctName, brand, ref, title: meta.title, html };
      return [entry, ...fresh].slice(0, 100);
    });
    const added = entry as ContractHistoryEntry | null;
    // Réimpression d'un contrat déjà archivé : on ne touche pas à son échéance.
    if (!ok || !added) return;
    // Auto-échéance de FIN de contrat : renseigne la page Échéances sans saisie manuelle.
    // Début = date de génération (locale), durée = champ « Durée » du contrat.
    const months = parseInt(String(duration).replace(/[^0-9]/g, ""), 10);
    if (ctName && ctName !== "[Créateur]" && months > 0) {
      type Dl = { id: string; creator: string; type: string; start: string; months: number; note?: string; brand?: string; contractId?: string };
      const dlBrand = ctType === "repr" ? "" : brand.trim();
      const sameContract = (d: Dl) =>
        d.contractId === added.id ||
        (d.type === ctType &&
          d.creator.trim().toLowerCase() === ctName.trim().toLowerCase() &&
          // Même marque ; les échéances auto anciennes (sans marque) sont remplacées aussi
          (d.brand != null ? d.brand.trim().toLowerCase() === dlBrand.toLowerCase() : !!d.note?.startsWith("Auto")));
      try {
        invalidateAppState();
        const fresh = ((await getAppState())["contractDeadlines"] as Dl[]) ?? [];
        const kept = fresh.filter((d) => !sameContract(d));
        const now = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const start = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
        const dl: Dl = { id: uid(), creator: ctName, type: ctType, start, months, note: `Auto · ${meta.label.toLowerCase()}${dlBrand ? ` · ${dlBrand}` : ""}`, brand: dlBrand, contractId: added.id };
        if (!(await saveAppStateKey("contractDeadlines", [dl, ...kept]))) toast("Contrat archivé, mais échéance non enregistrée. Réessaie");
      } catch {
        toast("Contrat archivé, mais échéance non enregistrée. Réessaie");
      }
    }
  };
  const deleteHistory = (id: string) => mutateHistory((fresh) => fresh.filter((h) => h.id !== id));

  const typeToggle = (
    <>
      <SecTitle icon={FileText}>Type de contrat</SecTitle>
      <Tabs
        label="Type de contrat"
        items={(Object.keys(TYPE_META) as CtType[]).map((k) => ({ value: k, label: TYPE_META[k].chip }))}
        value={ctType}
        onValueChange={(v) => { setCtType(v as CtType); setNavSub(v as CtType); }}
      />
    </>
  );

  if (ctType === "repr") {
    return (
      <div className="flex flex-col gap-4">
        <div>{typeToggle}</div>
        <RepresentationContract />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.15fr]">
      {/* ============ FORMULAIRE ============ */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        {typeToggle}

        {/* Créateur */}
        <div className="mt-5 border-t border-border pt-5">
        <SecTitle icon={UserRound}>Créateur</SecTitle>
        {creators.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">Aucun créateur dans le roster : le contrat utilisera « [Créateur] ».</div>
        ) : (
          <Select value={ctName} onValueChange={setCreatorName}>
            <SelectTrigger className="h-[42px] w-full rounded-lg bg-surface sm:w-auto sm:min-w-[240px]" placeholder="Choisir un créateur" />
            <SelectContent>
              {creators.map((c, i) => (
                <SelectItem key={c.id} index={i} value={c.name} img={c.photo_url}>{titleCase(c.name)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        </div>

        {/* Cas de configuration */}
        <div className="mt-5 border-t border-border pt-5">
          <SecTitle icon={Bookmark}>Cas enregistrés</SecTitle>
          {cases.length > 0 ? (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {cases.map((cs) => (
                <span key={cs.id} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium", cs.name === caseName ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground")}>
                  <button type="button" onClick={() => applyCase(cs)} className="transition-colors hover:text-foreground">{cs.name}</button>
                  <button type="button" onClick={() => setPendingDel({ message: `Supprimer le cas « ${cs.name} » ? Cette action est irréversible.`, run: () => deleteCase(cs.id) })} className="text-faint transition-colors hover:text-rose-500" title="Supprimer le cas"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : (
            <div className="mb-3 text-[12px] text-muted-foreground">Aucun cas enregistré pour ce créateur. Configure le contrat puis enregistre-le comme cas.</div>
          )}
          <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <TextField label="Nom du cas" value={caseName} onChange={setCaseName} placeholder="ex : Standard, Exclusif, UGC…" />
            </div>
            <button type="button" onClick={saveCase} className={cn(primaryBtn, "flex h-[42px] shrink-0 items-center gap-1.5")}>
              <Save className="h-3.5 w-3.5" /> Enregistrer
            </button>
          </div>
        </div>

        {/* Champs */}
        <div className="mt-5 border-t border-border pt-5">
        <SecTitle icon={PenLine}>Conditions</SecTitle>
        {isBrand && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TextField label="Marque" value={brand} onChange={setBrand} placeholder="ex Sephora" />
              <TextField label="Valeur" value={value} onChange={setValue} placeholder="ex 32 000 €" />
            </div>
            <div className="mt-3">
              <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
            </div>
          </>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField label="Commission (%)" value={commission} onChange={setCommission} type="number" placeholder="ex 20" />
          <TextField label="Durée" value={duration} onChange={setDuration} placeholder="ex 12 mois" />
        </div>
        </div>

        {/* ── Cas de figure : sélecteurs qui adaptent le contrat ── */}
        <div className="mt-5 border-t border-border pt-5">
          <SecTitle icon={SlidersHorizontal} right={<span className="text-[12px] text-muted-foreground">le contrat s'adapte tout seul</span>}>Cas de figure</SecTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ctType === "marque" && <SelectField label="Type de collab" value={collab} onChange={setCollab} opts={COLLAB_OPTS} />}
            <SelectField label="Cession de droits" value={rights} onChange={setRights} opts={RIGHTS_OPTS} className="sm:col-span-2" />
            {rights !== "organic" && <SelectField label="Durée de cession" value={rightsDuration} onChange={setRightsDuration} opts={DUR_OPTS} />}
            <SelectField label="Territoire" value={territory} onChange={setTerritory} opts={TERRITORY_OPTS} />
            <SelectField label="Exclusivité" value={exclScope} onChange={setExclScope} opts={EXCL_OPTS} />
            <SelectField label="Paiement" value={payment} onChange={setPayment} opts={PAYMENT_OPTS} />
            <SelectField label="TVA" value={tva} onChange={setTva} opts={TVA_OPTS} />
          </div>
          <button
            type="button"
            onClick={() => setDefraiement((v) => !v)}
            className={cn("mt-3 flex w-full items-start gap-2 rounded-lg border border-border px-3.5 py-2.5 text-left text-[13px] transition-colors sm:items-center", defraiement ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-rowhover")}
          >
            <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded sm:mt-0", defraiement ? "bg-foreground text-background" : "border border-border")}>{defraiement && <Check className="h-3 w-3" />}</span>
            <span className="min-w-0">Frais &amp; produits pris en charge (défraiement)</span>
          </button>
        </div>

        {/* Clauses additionnelles */}
        <div className="mt-5 border-t border-border pt-5">
          <SecTitle
            icon={ListPlus}
            right={
              <button type="button" onClick={() => setExtra([...extra, { id: uid(), l: `Art. ${nextClauseNo} — Clause`, v: "" }])} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </button>
            }
          >
            Clauses additionnelles
          </SecTitle>
          {extra.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Ajoute des clauses spécifiques pour un contrat sur mesure.</div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {extra.map((e) => (
                <div key={e.id} className="p-3">
                  <div className="flex items-center gap-2">
                    <input value={e.l} onChange={(ev) => setExtra(extra.map((x) => (x.id === e.id ? { ...x, l: ev.target.value } : x)))} placeholder="Titre de la clause" className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium outline-none focus:border-primary" />
                    <button type="button" onClick={() => setExtra(extra.filter((x) => x.id !== e.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500" title="Supprimer"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <textarea value={e.v} onChange={(ev) => setExtra(extra.map((x) => (x.id === e.id ? { ...x, v: ev.target.value } : x)))} rows={2} placeholder="Contenu de la clause…" className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ APERÇU ============ */}
      <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 md:p-7">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 overflow-hidden rounded-lg bg-[#14181E]"><img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" /></div>
            <div>
              <div className="text-[13px] font-semibold text-foreground">TTP Creators</div>
              <div className="text-[11px] text-muted-foreground">Lyon · France</div>
            </div>
          </div>
          <div className="text-[11px] tabular-nums text-muted-foreground">Réf. {ref}</div>
        </div>

        <div className="mt-5 text-[12px] text-muted-foreground">{meta.chip} · contrat de collaboration</div>
        <div className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight text-foreground">{meta.title}</div>

        <div className="mt-3 text-[13px] leading-relaxed text-muted-foreground">Parties : TTP Creators &amp; {ctDisplay} × {brand || "[Marque]"}</div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{parties}</div>

        <div className="my-4 h-px bg-border" />

        <div>
          {terms.map((t, i) => (
            <div key={i} className="flex justify-between gap-4 border-b border-border py-2.5 last:border-0">
              <span className="text-[13px] text-muted-foreground">{t.l}</span>
              <span className="text-right text-[13px] font-medium text-foreground">{t.v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 self-start">
          <AnimatedBadge status="info" size="sm">Conforme RGPD · Dir. 2011/83/UE · Droit FR</AnimatedBadge>
        </div>

        <div className="mt-4 space-y-2.5">
          {allClauses.map((c, i) => (
            <div key={i}>
              <div className="text-[12px] font-semibold text-foreground">{c.l}</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{c.v || "—"}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-4">
          <div className="flex-1"><div className="h-8 border-b border-border" /><div className="mt-1.5 text-[11px] text-muted-foreground">Pour TTP Creators</div></div>
          <div className="flex-1"><div className="h-8 border-b border-border" /><div className="mt-1.5 text-[11px] text-muted-foreground">Pour {ctDisplay}</div></div>
        </div>

        {/* Actions */}
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" onClick={copyContract} className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copié ✓" : "Copier"}
          </button>
          <button type="button" onClick={() => setPreview({ html: buildHTML(), hist: false })} className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            <Eye className="h-3.5 w-3.5" /> Aperçu
          </button>
          <button type="button" onClick={downloadPDF} className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>

      {/* ============ HISTORIQUE ============ */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
          <SecTitle icon={History} right={<span className="text-[12px] tabular-nums text-muted-foreground">{history.length} contrat{history.length > 1 ? "s" : ""}</span>}>Historique des contrats</SecTitle>
          <div className="max-h-[380px] divide-y divide-border overflow-y-auto border-t border-border">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 py-3 transition-colors hover:bg-rowhover/50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{h.title}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{TYPE_META[h.ctType]?.label ?? h.ctType}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {titleCase(h.ctName)}{h.brand ? ` × ${h.brand}` : ""} · {h.ref} · {new Date(h.ts).toLocaleDateString("fr-FR")}
                  </div>
                </div>
                <button type="button" onClick={() => setPreview({ html: h.html, hist: true })} title="Aperçu" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                  <Eye className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => printHtml(h.html)} title="Enregistrer en PDF" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-primary">
                  <FileText className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setPendingDel({ title: "Retirer de l'historique", message: `Retirer « ${h.title} » (${h.ref}) de l'historique ? Cette action est irréversible.`, run: () => deleteHistory(h.id) })} title="Supprimer" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-rose-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <Modal
          title={`Aperçu · ${ref}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
              <button
                type="button"
                className={cn(ghostBtn, "flex items-center gap-1.5")}
                onClick={() => {
                  // Contrat de l'historique : simple réimpression, sans ré-archiver ni toucher aux Échéances
                  if (!preview.hist) void archiveContract(preview.html);
                  printHtml(preview.html);
                }}
              >
                <FileText className="h-3.5 w-3.5" /> Enregistrer en PDF
              </button>
            </>
          }
        >
          <iframe title={`Contrat ${ref}`} srcDoc={preview.html} sandbox="" className="h-[64vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}
      {pendingDel && (
        <ConfirmDialog
          title={pendingDel.title ?? "Supprimer le cas"}
          message={pendingDel.message}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </div>
  );
}

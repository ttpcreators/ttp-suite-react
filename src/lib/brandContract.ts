/**
 * Moteur des contrats Marque × Créateur et UGC : clauses, conditions particulières et
 * document HTML. Pur (ni React ni Supabase) : la page Contrats s'en sert pour son aperçu et
 * son PDF, et Alfred (agents/alfred/contrats.mjs, généré depuis contractRender.ts) pour
 * envoyer sur Telegram exactement le contrat que l'app aurait fait.
 */
import { CONTRACT_CSS, contractHead, contractTitle, docHead, docToday, pdfFileTitle } from "./pdfDoc";
import { nbspFr } from "./representationContract";
import { sigImgHtml } from "./agencySignature";
import { parseAmount } from "./money";

export type CtType = "marque" | "repr" | "ugc";

export const TYPE_META: Record<CtType, { chip: string; label: string; title: string }> = {
  marque: { chip: "Marque × Créateur", label: "MARQUE × CRÉATEUR", title: "Contrat de partenariat commercial" },
  repr: { chip: "Représentation", label: "AGENCE × CRÉATEUR", title: "Contrat de représentation" },
  ugc: { chip: "Contrat UGC", label: "CONTRAT UGC", title: "Cession de droits UGC" },
};

export type Term = { l: string; v: string };

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
export const CLAUSES: Term[] = [
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
export type Opt = { v: string; label: string };

export const COLLAB_OPTS: Opt[] = [
  { v: "sponso", label: "Post sponsorisé" },
  { v: "ugc", label: "UGC (sans diffusion)" },
  { v: "gifting", label: "Placement / gifting" },
  { v: "ambassador", label: "Ambassadeur (long terme)" },
  { v: "event", label: "Prestation événementielle" },
];
export const RIGHTS_OPTS: Opt[] = [
  { v: "organic", label: "Organique, compte créateur seul" },
  { v: "repost", label: "Repost organique par la marque" },
  { v: "paid", label: "Paid media / whitelisting (ads)" },
  { v: "buyout", label: "Cession totale (buyout)" },
];
export const DUR_OPTS: Opt[] = [
  { v: "3 mois", label: "3 mois" },
  { v: "6 mois", label: "6 mois" },
  { v: "12 mois", label: "12 mois" },
  { v: "illimitée", label: "Illimitée" },
];
export const TERRITORY_OPTS: Opt[] = [
  { v: "France", label: "France" },
  { v: "France + DOM-TOM", label: "France + DOM-TOM" },
  { v: "Europe", label: "Europe" },
  { v: "Monde", label: "Monde entier" },
];
export const PAYMENT_OPTS: Opt[] = [
  { v: "30j", label: "Virement · 30 j fin de mois" },
  { v: "livraison", label: "À la livraison" },
  { v: "acompte", label: "50 % acompte · 50 % livraison" },
  { v: "45j", label: "Virement · 45 j" },
];
export const TVA_OPTS: Opt[] = [
  { v: "non", label: "Non assujetti (art. 293 B CGI)" },
  { v: "20", label: "TVA 20 %" },
];
export const EXCL_OPTS: Opt[] = [
  { v: "non", label: "Aucune" },
  { v: "cat30", label: "Catégorie · 30 jours" },
  { v: "cat90", label: "Catégorie · 90 jours" },
  { v: "total", label: "Secteur complet · durée du contrat" },
];

export const labelOf = (opts: Opt[], v: string) => opts.find((o) => o.v === v)?.label ?? v;

export type Scenario = {
  collab: string;
  rights: string;
  rightsDuration: string;
  territory: string;
  payment: string;
  tva: string;
  exclScope: string;
  defraiement: boolean;
};

export const SCENARIO_DEFAULT: Scenario = {
  collab: "sponso",
  rights: "organic",
  rightsDuration: "6 mois",
  territory: "France",
  payment: "30j",
  tva: "non",
  exclScope: "cat30",
  defraiement: false,
};

export function objetOf(collab: string, brand: string): string {
  const b = brand || "—";
  switch (collab) {
    case "ugc": return `Production de contenus UGC pour ${b}`;
    case "gifting": return `Placement de produit · ${b}`;
    case "ambassador": return `Programme ambassadeur · ${b}`;
    case "event": return `Prestation événementielle · ${b}`;
    default: return `Campagne ${b}`;
  }
}

export function rightsValue(s: Scenario): string {
  switch (s.rights) {
    case "repost": return `Repost organique · ${s.rightsDuration}`;
    case "paid": return `Paid media / whitelisting · ${s.rightsDuration}`;
    case "buyout": return `Cession totale (buyout) · ${s.rightsDuration}`;
    default: return "Organique, compte du créateur uniquement";
  }
}

export function payClause(payment: string): string {
  switch (payment) {
    case "livraison": return "Les sommes sont versées par virement à la livraison et à la validation des contenus. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
    case "acompte": return "50 % du montant sont versés à la signature (acompte), le solde à la livraison et à la validation des contenus. Tout retard entraîne les pénalités légales (art. L441-10 C. com.).";
    case "45j": return "Les sommes sont versées par virement à 45 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
    default: return "Les sommes sont versées par virement à 30 jours fin de mois. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
  }
}

export function rightsClause(s: Scenario): string {
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
export const VIGILANCE_SEUIL_EUR = 5000;

/**
 * Clauses adaptées au cas de figure : Art. 2/3 réécrits + clauses optionnelles.
 * `htValue` sert à insérer la clause de vigilance sociale quand elle devient obligatoire.
 */
export function buildClauses(s: Scenario, htValue = 0): Term[] {
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

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

export function refFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 900;
  return `TTP-${new Date().getFullYear()}-${String(90 + h).padStart(3, "0")}`;
}

export function contractHTML(o: {
  ref: string;
  meta: { label: string; title: string };
  ctName: string;
  brand: string;
  parties: string;
  terms: Term[];
  clauses: Term[];
}): string {
  const { ref, meta, ctName, brand, parties, terms, clauses } = o;
  const termRows = terms.map((t) => `<div><dt>${esc(t.l)}</dt><dd>${esc(t.v)}</dd></div>`).join("");
  const clauseBlocks = clauses
    .map(
      (c, i) =>
        // « Art. 3 — Droits d'auteur » → « Article 3. Droits d'auteur » (numérotation recalculée dans l'ordre).
        `<section class="ct-art"><h2>Article ${i + 1}. ${esc(c.l.replace(/^Art(?:icle)?\.?\s*\d+\s*[—–-]\s*/i, ""))}</h2><p>${esc(c.v)}</p></section>`,
    )
    .join("");
  const kind = meta.label.charAt(0) + meta.label.slice(1).toLowerCase().replace("× créateur", "× Créateur").replace("ugc", "UGC");
  return `${docHead(pdfFileTitle(`Contrat ${ref}`, [brand, ctName].filter(Boolean).join(" x ")), CONTRACT_CSS)}<body><div class="wrap ct">
${contractHead("TTP Creators", "Talent management · Lyon et Genève", [`<b>${esc(kind)}</b>`, `Réf. ${esc(ref)} · ${esc(docToday())}`, "Confidentiel"])}
${contractTitle(meta.title, `${ctName} × ${brand || "[Marque]"}`)}
<p class="ct-intro">${esc(parties)}</p>
<section class="ct-art"><h2>Conditions particulières</h2><dl class="ct-terms">${termRows}</dl></section>
${clauseBlocks}
<div class="ct-sign"><div class="cols">
  <div><div class="who">Pour TTP Creators</div><div class="box">${sigImgHtml()}</div><div class="cap">Date et signature, précédées de « Lu et approuvé »</div></div>
  <div><div class="who">Pour ${esc(ctName)}</div><div class="box"></div><div class="cap">Date et signature, précédées de « Lu et approuvé »</div></div>
</div></div>
<div class="ct-legal">Contrat régi par le droit français · Conforme RGPD (UE 2016/679) · Directive 2011/83/UE · Fait à Lyon. Document généré par TTP Suite.</div>
</div></body></html>`;
}

/** Ce que le formulaire Marque × Créateur / UGC règle (un « cas » sans son nom). */
export type BrandFields = Scenario & {
  ctType: CtType;
  brand: string;
  value: string;
  commission: string;
  duration: string;
  deliverables: string;
  extra: { l: string; v: string }[];
};

/** Les parties et les conditions particulières du contrat. */
export function brandTerms(f: Omit<BrandFields, "extra">, ctDisplay: string): { parties: string; terms: Term[] } {
  const { ctType, brand, deliverables, value, duration, collab, territory, defraiement } = f;
  const exclLabel = labelOf(EXCL_OPTS, f.exclScope);
  const commClean = String(f.commission).replace(/[^0-9.]/g, "") || "20";
  const payTerms: Term[] = [
    { l: "Modalités", v: labelOf(PAYMENT_OPTS, f.payment) },
    { l: "TVA", v: labelOf(TVA_OPTS, f.tva) },
  ];
  if (ctType === "marque") {
    return {
      parties: `ENTRE ${brand || "[Annonceur]"} (l'Annonceur) ET ${ctDisplay}, représenté(e) par TTP Creators (l'Agent).`,
      terms: [
        { l: "Objet", v: objetOf(collab, brand) },
        { l: "Nature", v: labelOf(COLLAB_OPTS, collab) },
        { l: "Livrables", v: deliverables || "—" },
        { l: "Montant", v: nbspFr(value || "—") },
        { l: "Cession de droits", v: rightsValue(f) },
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
      { l: "Cession de droits", v: rightsValue(f) },
      { l: "Territoire", v: territory },
      { l: "Exclusivité", v: exclLabel },
      { l: "Durée", v: duration || "—" },
      ...(defraiement ? [{ l: "Frais & produits", v: "Pris en charge par l'Annonceur" }] : []),
      ...payTerms,
    ],
  };
}

/** Toutes les clauses (socle adapté au cas de figure, puis clauses ajoutées), espaces insécables posées. */
export function brandClauses(s: Scenario, value: string, extra: { l: string; v: string }[]): Term[] {
  return [...buildClauses(s, parseAmount(value)), ...extra.map((e) => ({ l: e.l, v: e.v }))].map((c) => ({ ...c, v: nbspFr(c.v) }));
}

/** Nom du créateur tel qu'il s'affiche dans le contrat (« léa martin » → « Léa Martin »). */
export function ctDisplayName(ctName: string): string {
  if (ctName === "[Créateur]") return ctName;
  return String(ctName ?? "")
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_m, a, b) => a + b.toUpperCase());
}

/** Le contrat complet (HTML du PDF) pour ces réglages : le même que « Générer le PDF » dans l'app. */
export function brandContractDoc(f: BrandFields, ctName: string): { ref: string; title: string; html: string } {
  const ctDisplay = ctDisplayName(ctName);
  const meta = TYPE_META[f.ctType];
  const ref = refFor(ctName);
  const { parties, terms } = brandTerms(f, ctDisplay);
  const html = contractHTML({ ref, meta, ctName: ctDisplay, brand: f.brand, parties, terms, clauses: brandClauses(f, f.value, f.extra) });
  return { ref, title: meta.title, html };
}

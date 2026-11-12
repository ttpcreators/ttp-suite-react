/**
 * Brouillons de contrat Marque × Créateur, UGC ou représentation préparés par Claude (Alfred) avec l'outil
 * `preparer_contrat` du connecteur. Rangés dans le blob agence, clé `contractDrafts` : la page
 * Contrats les montre en haut, « Ouvrir » charge le formulaire du générateur, et le brouillon
 * disparaît quand le contrat est généré. Logique pure (sans client Supabase), testée.
 *
 * Les valeurs permises reprennent celles des menus du générateur (`src/views/Contrats.tsx`) :
 * le test vérifie qu'elles y existent toujours.
 */

export const CONTRACT_DRAFTS_KEY = "contractDrafts";

export const DRAFT_OPTS = {
  nature: ["sponso", "ugc", "gifting", "ambassador", "event"],
  droits: ["organic", "repost", "paid", "buyout"],
  duree_droits: ["3 mois", "6 mois", "12 mois", "illimitée"],
  territoire: ["France", "France + DOM-TOM", "Europe", "Monde"],
  paiement: ["30j", "livraison", "acompte", "45j"],
  tva: ["non", "20"],
  exclusivite: ["non", "cat30", "cat90", "total"],
} as const;

/** Ce que le générateur recharge (même forme que `BrandForm` de la page Contrats). */
export type DraftForm = {
  ctType: "marque" | "ugc";
  brand: string;
  value: string;
  commission: string;
  duration: string;
  deliverables: string;
  excl: boolean;
  extra: { id: string; l: string; v: string }[];
  collab: string;
  rights: string;
  rightsDuration: string;
  territory: string;
  payment: string;
  tva: string;
  exclScope: string;
  defraiement: boolean;
};

/**
 * Les réglages du contrat de représentation que Claude peut remplir (clés de `RC_FIELDS` dans
 * `src/lib/representationContract.ts` : le test vérifie qu'elles y sont toutes).
 */
export const REPR_KEYS = [
  "variante", "contratTest", "titrePersonnalise", "lieuSignature", "dateSignature",
  "talentNom", "talentDateNaissance", "talentAdresse", "talentSiret", "talentEmailPro", "talentStatutTva",
  "modeDuree", "dureeMois", "dateDebut", "dateFin", "taciteReconduction", "periodeReconductionMois", "preavisJours",
  "essaiActif", "essaiJours", "essaiParEmail", "resiliationLibre", "resiliationLibreJours",
  "modeCommission", "regimeFiscalComm", "commApportee", "commInitiee", "commUniforme", "commAutonome", "seuil",
  "avantagesNatureInclus", "giftingSeuilStrict", "mandatEncaissement", "reversJours", "contestationVirementJours",
  "gestionMail", "mailChangementAccesHeures", "mailRevocationHeures", "visibiliteEmail",
] as const;

export type ContractDraft = {
  id: string;
  ts: number;
  /** Qui l'a préparé (« Alfred », « Claude »). */
  by: string;
  ctType: "marque" | "ugc" | "repr";
  /** Nom du créateur tel qu'il est dans le roster (clé des contrats), ou tel qu'écrit s'il n'y est pas encore (représentation). */
  ctName: string;
  /** Représentation : true si le talent n'est pas (encore) dans le roster. */
  externe?: boolean;
  /** La marque ; vide pour une représentation. */
  brand: string;
  /** Ce que Marc doit vérifier avant de générer (points en suspens, sources). */
  note: string;
  /** Marque × Créateur et UGC : le formulaire du générateur. */
  form?: DraftForm;
  /** Représentation : les réglages qui changent des réglages par défaut de la variante. */
  config?: Record<string, string>;
};

type Json = Record<string, unknown>;
const txt = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Le créateur du roster qui correspond à ce que Claude a écrit : nom exact (sans accents ni
 * majuscules), sinon un seul nom qui le contient. Null si aucun ou si c'est ambigu. */
export function choisirCreateur(noms: string[], saisie: string): string | null {
  const s = fold(saisie);
  if (!s) return null;
  const exact = noms.filter((n) => fold(n) === s);
  if (exact.length === 1) return exact[0];
  const proches = noms.filter((n) => fold(n).includes(s) || fold(n).split(/\s+/)[0] === s);
  return proches.length === 1 ? proches[0] : null;
}

/** L'outil demande un contrat de représentation (type « representation » ou « repr »). */
export const estRepresentation = (a: Json) => ["representation", "repr"].includes(txt(a.type, 20));

/** Les entrées de l'outil → un brouillon bien formé, ou l'erreur à dire à Claude. */
export function normaliserBrouillon(
  a: Json,
  { id, ts, ctName, by = "Claude", externe = false }: { id: string; ts: number; ctName: string; by?: string; externe?: boolean },
): { brouillon: ContractDraft } | { erreur: string } {
  if (estRepresentation(a)) return brouillonRepresentation(a, { id, ts, ctName, by, externe });
  const type = txt(a.type || "marque", 10) === "ugc" ? "ugc" : "marque";
  const brand = txt(a.marque, 120);
  if (!brand) return { erreur: "Indique la marque." };
  const choix = (cle: keyof typeof DRAFT_OPTS, defaut: string): { v: string; erreur?: string } => {
    const v = txt(a[cle], 40);
    if (!v) return { v: defaut };
    const permis = DRAFT_OPTS[cle] as readonly string[];
    const trouve = permis.find((p) => fold(p) === fold(v));
    return trouve ? { v: trouve } : { v: "", erreur: `« ${v} » n'est pas permis pour ${cle} : ${permis.join(", ")}.` };
  };
  const nature = choix("nature", type === "ugc" ? "ugc" : "sponso");
  const droits = choix("droits", "organic");
  const dureeDroits = choix("duree_droits", "6 mois");
  const territoire = choix("territoire", "France");
  const paiement = choix("paiement", "30j");
  const tva = choix("tva", "non");
  const exclusivite = choix("exclusivite", "non");
  for (const c of [nature, droits, dureeDroits, territoire, paiement, tva, exclusivite]) if (c.erreur) return { erreur: c.erreur };
  const commission = txt(a.commission, 6).replace(/[^0-9.,]/g, "").replace(",", ".") || "20";
  const clauses = Array.isArray(a.clauses) ? (a.clauses as unknown[]) : [];
  const extra = clauses
    .map((c, i) => {
      const o = c && typeof c === "object" ? (c as Json) : {};
      return { id: `${id}x${i}`, l: txt(o.titre, 80), v: txt(o.texte, 1500) };
    })
    .filter((c) => c.l && c.v)
    .slice(0, 6);
  const form: DraftForm = {
    ctType: type,
    brand,
    value: txt(a.montant, 60),
    commission,
    duration: txt(a.duree, 40),
    deliverables: txt(a.livrables, 300),
    excl: exclusivite.v !== "non",
    extra,
    collab: nature.v,
    rights: droits.v,
    rightsDuration: dureeDroits.v,
    territory: territoire.v,
    payment: paiement.v,
    tva: tva.v,
    exclScope: exclusivite.v,
    defraiement: a.defraiement === true,
  };
  return { brouillon: { id, ts, by: txt(by, 40) || "Claude", ctType: type, ctName, brand, note: txt(a.note, 800), form } };
}

/** Valeur d'un réglage de représentation : texte court, nombre ou booléen (« true » / « false »). */
const reglage = (v: unknown) => (typeof v === "boolean" || typeof v === "number" ? String(v) : txt(v, 300));

/** Brouillon de contrat de représentation : la variante et les réglages connus du générateur. */
function brouillonRepresentation(
  a: Json,
  { id, ts, ctName, by = "Claude", externe = false }: { id: string; ts: number; ctName: string; by?: string; externe?: boolean },
): { brouillon: ContractDraft } | { erreur: string } {
  const r = a.representation && typeof a.representation === "object" && !Array.isArray(a.representation) ? (a.representation as Json) : {};
  const inconnues = Object.keys(r).filter((k) => !(REPR_KEYS as readonly string[]).includes(k));
  if (inconnues.length) return { erreur: `Réglage inconnu du contrat de représentation : ${inconnues.join(", ")}. Permis : ${REPR_KEYS.join(", ")}.` };
  const config: Record<string, string> = {};
  for (const k of REPR_KEYS) {
    const v = reglage(r[k]);
    if (v) config[k] = v;
  }
  config.variante = config.variante === "nonexclusif" ? "nonexclusif" : "exclusif";
  if (!config.talentNom) config.talentNom = ctName;
  return {
    brouillon: { id, ts, by: txt(by, 40) || "Claude", ctType: "repr", ctName, ...(externe ? { externe: true } : {}), brand: "", note: txt(a.note, 800), config },
  };
}

/** Lecture tolérante du blob (entrées d'un autre format ignorées). */
export function lireBrouillons(v: unknown): ContractDraft[] {
  if (!Array.isArray(v)) return [];
  return v.filter((d): d is ContractDraft => {
    if (!d || typeof d !== "object") return false;
    const o = d as Json;
    if (typeof o.id !== "string" || typeof o.ctName !== "string" || typeof o.brand !== "string") return false;
    if (o.ctType === "repr") return !!o.config && typeof o.config === "object";
    return !!o.form && typeof o.form === "object";
  });
}

/** Le résumé que l'outil rend à Claude (et que Claude redit à Marc). */
export function resumeBrouillon(d: ContractDraft): string {
  const f = d.form;
  if (d.ctType === "repr" || !f) {
    const c = d.config ?? {};
    return [
      `Brouillon de contrat prêt dans l'app : représentation de ${d.ctName} (${c.variante === "nonexclusif" ? "non exclusif" : "exclusif"})${d.externe ? ", pas encore dans le roster" : ""} · id ${d.id}`,
      `Réglages repris : ${Object.keys(c).filter((k) => k !== "variante").join(", ") || "ceux par défaut"}`,
      "Marc l'ouvre dans Contrats (en haut, « Brouillons à relire »), vérifie, puis l'enregistre : le brouillon disparaît alors tout seul.",
    ].join("\n");
  }
  const droits = f.rights === "organic" ? "organique" : `${f.rights} ${f.rightsDuration}`;
  return [
    `Brouillon de contrat prêt dans l'app : ${d.brand} × ${d.ctName} (${d.ctType === "ugc" ? "UGC" : "Marque × Créateur"}) · id ${d.id}`,
    `Montant ${f.value || "à compléter"} · livrables ${f.deliverables || "à compléter"} · droits ${droits} · paiement ${f.payment} · TVA ${f.tva} · commission TTP ${f.commission} %`,
    "Marc l'ouvre dans Contrats (en haut, « Brouillons à relire »), vérifie, puis génère le PDF : le brouillon disparaît alors tout seul.",
  ].join("\n");
}

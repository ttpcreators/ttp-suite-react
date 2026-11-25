// ============================================================================
// _shared/reponseProspect.ts : classer la réponse d'un prospect (marque, agence).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M23). Quand une marque répond à un mail de prospection,
// gmail-poll (sequences.ts) range sa réponse dans l'une de ces cases :
//   - « interesse » : elle veut en savoir plus (tarifs, media kit, un appel) → tâche
//     « Visio : [marque] » avec le lien pour choisir un créneau ;
//   - « plus_tard » : pas maintenant (budget bouclé, l'an prochain) → tâche « Recontacter »
//     datée plus tard ;
//   - « refus » : non merci → tâche « Refus » qui PROPOSE la liste « ne plus contacter ».
//     Rien n'est ajouté tout seul : c'est Gianni ou Marc qui décide ;
//   - « a_lire » : rien de clair → tâche « Réponse à lire : [marque] » (pas « Visio »).
// Aucun mail n'est jamais envoyé ici. Règles PURES, testées par reponseProspect.test.ts.
// ============================================================================

export type ClasseReponse = "interesse" | "plus_tard" | "refus" | "a_lire";

/** Page où le client choisit un créneau de visio avec l'agence. */
export const LIEN_RDV = "https://app.ttpcreators.pro/rdv/";

/** Jours avant de recontacter une marque qui a dit « plus tard ». */
export const JOURS_PLUS_TARD = 45;

const plat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");

const REFUS = [
  /\b(ne|n') ?(sommes|suis|sera|serons|est) (pas|plus) (interesse|interessee|interesses|interessees)/,
  /\bpas (interesse|interessee|interesses|interessees)\b/,
  /\bnon,? merci\b/, /\bmerci,? mais non\b/,
  /\bne (plus|pas) (nous|me) (contacter|recontacter|solliciter|ecrire)/, /\bretirez[- ](moi|nous)\b/, /\bdesinscri/, /\bunsubscribe\b/, /\bremove (me|us)\b/,
  /\bne correspond(ent)? pas\b/, /\bpas (dans )?notre (cible|strategie|ligne)\b/, /\bne (travaillons|travaille|faisons|fait) pas (avec|d'|de |appel)/,
  /\bnous (declinons|devons decliner)\b/, /\bdecliner (votre|cette)\b/, /\bpas de suite\b/, /\bne (pas )?donner suite\b/, /\bne pouvons pas donner suite\b/,
  /\bdeja (accompagnee?s?|representee?s?|geree?s?|suivie?s?|managee?s?) par\b/, /\bdeja (en agence|dans une agence|avec une agence)\b/, /\b(already|currently) (represented|managed)\b/,
  /\bdeja confie\b/, /\bquelqu'un qui m'accompagne\b/, /\bdeja (une|un) (agent|manager|agence)\b/,
  /\bnot interested\b/, /\bno,? thanks?\b/, /\bwe (do not|don't) work with\b/, /\bnot a (good )?fit\b/, /\bpass on this\b/, /\bdecline\b/,
];
const PLUS_TARD = [
  /\bpas (pour le|en ce) moment\b/, /\bpas le (bon )?moment\b/, /\bpas pour l'instant\b/, /\bplus tard\b/,
  /\b(revenez|revenir|reviens) vers (nous|moi)\b/, /\b(re)?contactez[- ](nous|moi) (en|dans|a partir|debut|courant)/, /\b(l'annee|l'an) prochaine?\b/,
  /\bbudgets? (est|sont|deja|a ete|ont ete)? ?(boucle|alloue|epuise|ferme|utilise|consomme)s?\b/, /\b(aucun|pas de) budget\b/, /\bpas de besoins?\b/, /\bgardons? (en tete|votre (contact|proposition))\b/, /\bau cas ou\b/, /\breviendra vers vous\b/, /\bpour le moment\b/, /\bd'ici (\d+|deux|trois|quatre|quelques) (semaines|mois)\b/, /\bredis?cut/, /\bbudget (2027|de l'annee prochaine)\b/,
  /\b(debut|courant|fin) (d'annee|de l'annee|janvier|fevrier|mars|2027)\b/, /\bau (prochain|1er|premier|2e|second) (trimestre|semestre)\b/,
  /\bnot (right )?now\b/, /\bnext (year|quarter)\b/, /\breach out (again )?(in|next|later)\b/, /\bbudget is (already )?(closed|allocated|spent)\b/, /\bmaybe later\b/,
];
const INTERESSE = [
  /\binteress/, /\bavec plaisir\b/, /\bvolontiers\b/, /\bcarrement\b/, /\bpourquoi pas\b/,
  /\btarifs?\b/, /\bdevis\b/, /\bgrille\b/, /\bmedia ?kit\b/, /\bkit media\b/, /\bpropositions? (chiffree|commerciale|tarifaire)\b/, /\bcombien\b/, /\bprix\b/,
  /\b(un|en) (appel|call|visio)\b/, /\bvisio\b/, /\bechanger\b/, /\brendez[- ]vous\b/, /\brdv\b/, /\bdisponibilites?\b/, /\bdispo\b/,
  /\bpouvez[- ]vous (m'|nous )?(envoyer|transmettre|partager)\b/, /\benvoyez[- ](moi|nous)\b/, /\bje (vous )?(transmets|transfere)\b/, /\ben interne\b/,
  /\binterested\b/, /\bsounds (good|great)\b/, /\blet's\b/, /\brates?\b/, /\bpricing\b/, /\bhop on a call\b/, /\bsend (me|us|over)\b/,
];

/** Case de la réponse : refus et « plus tard » d'abord (« pas intéressé » contient « intéress »). */
export function classerReponse(objet: string, extrait: string): ClasseReponse {
  // L'objet « Re: Collaboration … » ne dit rien : seul l'extrait compte, l'objet seulement s'il est réécrit.
  const objetReecrit = /^\s*(re|tr|fwd?|aw)\s*:/i.test(objet) ? "" : objet;
  const t = plat(`${objetReecrit} ${extrait}`.slice(0, 600));
  if (!t.trim()) return "a_lire";
  if (REFUS.some((r) => r.test(t))) return "refus";
  if (PLUS_TARD.some((r) => r.test(t))) return "plus_tard";
  if (INTERESSE.some((r) => r.test(t))) return "interesse";
  return "a_lire";
}

/** Réponse notée dans la séquence du contact (types de _shared/sequence.ts). */
export function reponseSequence(c: ClasseReponse): "positive" | "negative" | "a_repondu" {
  return c === "interesse" ? "positive" : c === "refus" ? "negative" : "a_repondu";
}

const ETIQUETTE: Record<ClasseReponse, string> = { interesse: "Intéressé", plus_tard: "Plus tard", refus: "Refus", a_lire: "Réponse" };

/** Début de la note du journal du contact : « Intéressé : Re: … ». */
export const noteReponse = (c: ClasseReponse, objet: string) => `${ETIQUETTE[c]} : ${objet}`.slice(0, 140);

function addDays(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Les textes possibles d'une tâche de réponse pour cette marque (pour ne pas en refaire une). */
export const textesTaches = (marque: string) => {
  const m = marque.slice(0, 80);
  return [`Visio : ${m}`, `Refus : ${m}`, `Recontacter : ${m}`, `Réponse à lire : ${m}`];
};

export type TacheReponse = { text: string; descr: string; priority: "haute" | "moyenne"; due: string };

/**
 * La tâche à créer pour une réponse. `visio` = la tâche « Visio » déjà écrite par tacheVisio
 * (contact en séquence) ou null. Le texte d'une tâche est sa clé anti-doublon.
 */
export function tacheReponse(
  classe: ClasseReponse,
  p: { marque: string; email: string; personne?: string; objet: string; extrait: string; jour: string; visio?: { text: string; descr: string } | null },
): TacheReponse {
  const marque = (p.marque || p.email).slice(0, 80); // même découpe que textesTaches
  const contact = `Contact : ${p.personne?.trim() || "—"} · ${p.email}`;
  const reponse = `Sa réponse : « ${p.objet.slice(0, 140)} » ${p.extrait.slice(0, 280)}`;
  const avant = "Avant d'écrire : relire tout l'historique (mails, DM, fiche, collabs, devis).";
  if (classe === "refus") {
    return {
      text: `Refus : ${marque}`,
      descr: [
        `${marque} a dit non à la prospection (classement automatique, à vérifier).`, contact, reponse,
        "Proposition : l'ajouter à « ne plus contacter » (outil ne_plus_contacter, après ton accord). Rien n'est fait tout seul, aucun mail n'est envoyé.",
        "Si ce n'est pas un vrai non : supprimer cette tâche et répondre normalement.",
      ].join("\n"),
      priority: "moyenne",
      due: p.jour,
    };
  }
  if (classe === "plus_tard") {
    return {
      text: `Recontacter : ${marque}`,
      descr: [
        `${marque} a répondu « pas maintenant » (classement automatique, à vérifier). Recontacter vers le ${addDays(p.jour, JOURS_PLUS_TARD)}, ou à la date qu'elle donne.`,
        contact, reponse, avant,
      ].join("\n"),
      priority: "moyenne",
      due: addDays(p.jour, JOURS_PLUS_TARD),
    };
  }
  const base = p.visio ?? {
    text: `Visio : ${marque}`,
    descr: [`${marque} a répondu à un mail de prospection.`, contact, reponse].join("\n"),
  };
  return {
    text: classe === "interesse" ? base.text : `Réponse à lire : ${marque}`,
    descr: [
      classe === "interesse" ? "Classement automatique : intéressé." : "Classement automatique : rien de clair, à lire.",
      base.descr,
      classe === "interesse" ? `Si elle demande un créneau, le lien de réservation : ${LIEN_RDV}` : "Lire sa réponse et décider de la suite (visio, relance plus tard, ou rien).",
      avant,
    ].join("\n"),
    priority: classe === "interesse" ? "haute" : "moyenne",
    due: p.jour,
  };
}

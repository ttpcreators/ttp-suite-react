/*
 * Aujourd'hui : explication de chaque ligne dans le panneau de droite (demande de Marc,
 * 2026-10-23 : « que Gianni ou moi on comprenne de quoi on parle »). Deux phrases courtes :
 * ce que ça veut dire, puis quoi faire. Logique PURE, testée par todayExplain.test.ts.
 */

export type Explain = { meaning: string; action: string };

/** Prénom lisible (« CANDICE MAISSA » → « Candice »). */
function first(name: string | null | undefined): string {
  const w = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
}

/**
 * Collab qui n'avance plus : quoi faire pour passer à l'étape suivante (étape courante 1 à 10).
 * {c} = prénom du créateur, {m} = marque.
 */
const NEXT_STEP: Record<number, string> = {
  1: "Vérifie que {m} et {c} ont signé le contrat. Envoie ensuite le brief à {c} et passe la collab à « Brief transmis ».",
  2: "Vérifie que {c} a lu le brief et propose son idée. Quand {m} valide le concept, passe à « Concept validé ».",
  3: "Fixe la date de tournage avec {c}. Quand c'est tourné, passe à « Tournage ».",
  4: "Récupère le contenu de {c} et envoie-le à {m}. Passe ensuite à « Validation marque ».",
  5: "Relance {m} pour qu'elle valide ou donne ses retours. Une fois publié, passe à « Publication ».",
  6: "Le contenu est en ligne. Relève les stats 7 jours après la publication, puis passe à « Statistiques à sept jours ».",
  7: "Envoie la facture à {m} (bouton « Créer la facture » sur la collab), puis passe à « Facture envoyée ».",
  8: "Vérifie si {m} a payé. Sinon, relance-la. Quand l'argent est reçu, passe à « Paiement marque reçu ».",
  9: "Verse sa part à {c} dans Reversements, puis passe à « Créateur payé ».",
  10: "Prépare le bilan pour {m} et propose de renouveler. Passe ensuite à « Bilan et renouvellement ».",
};

export function explainCollab(c: { brand: string | null; creator: string | null; step: number; stepLabel: string; staleDays: number }): Explain {
  const name = first(c.creator) || "le créateur";
  const brand = (c.brand ?? "").trim() || "la marque";
  const action = (NEXT_STEP[c.step] ?? "Ouvre la collab et passe-la à l'étape suivante si elle a avancé.")
    .replace(/\{c\}/g, name)
    .replace(/\{m\}/g, brand);
  return {
    meaning: `Cette collab est à l'étape « ${c.stepLabel} » depuis ${c.staleDays} jours, sans changement. Soit elle attend quelque chose, soit elle a avancé et l'étape n'a pas été mise à jour dans l'app.`,
    action,
  };
}

type ItemLike = {
  kind: string;
  lateDays?: number | null;
  daysLeft?: number;
  invoice?: { party?: string | null; creator?: string | null } | null;
  contract?: { creator: string; end: string } | null;
  collab?: { brand: string | null; creator: string | null; step: number; stepLabel: string; staleDays: number } | null;
  brief?: { brand?: string | null; creator?: string | null } | null;
  staleCreators?: string[];
  unread?: number;
};

/** Explication d'une ligne d'Aujourd'hui, ou null si la ligne parle d'elle-même (tâche, rendez-vous). */
export function explainItem(it: ItemLike): Explain | null {
  if (it.collab) return explainCollab(it.collab);
  // « Nike x Sarah » (libellé de facture) → « Nike ».
  const brand = (it.invoice?.party ?? it.brief?.brand ?? "").split(/\s+[x×]\s+/i)[0].trim() || "la marque";
  switch (it.kind) {
    case "relance":
      return {
        meaning: `${brand} n'a pas payé cette facture : l'échéance est dépassée${it.lateDays ? ` de ${it.lateDays} jour${it.lateDays > 1 ? "s" : ""}` : ""}.`,
        action: "Envoie la relance préparée ci-dessous.",
      };
    case "echeance":
      return {
        meaning: `Cette facture de ${brand} arrive bientôt à échéance. Elle n'est pas encore en retard.`,
        action: "Rien à faire si la marque paie à temps. Tu peux la prévenir en douceur.",
      };
    case "contrat": {
      const name = first(it.contract?.creator) || "ce créateur";
      return {
        meaning: `Le contrat de représentation de ${name} se termine bientôt.`,
        action: `Décide avec ${name} si vous continuez, puis prépare le nouveau contrat dans Contrats.`,
      };
    }
    case "stats":
      return {
        meaning: "Ces créateurs n'ont pas mis à jour leurs stats ce mois-ci. Leurs media kits ne sont plus à jour.",
        action: "Demande-leur d'envoyer leurs stats depuis leur espace, ou mets-les à jour sur leur fiche.",
      };
    case "brief": {
      const name = first(it.brief?.creator) || "le créateur";
      return {
        meaning: `Le brief de ${brand} pour ${name} arrive à échéance.`,
        action: `Vérifie que ${name} a tout ce qu'il faut et que le contenu sera prêt à temps.`,
      };
    }
    case "mails":
      return {
        meaning: "Des mails non lus attendent dans les boîtes de l'agence.",
        action: "Ouvre Mails et traite-les.",
      };
    default:
      return null;
  }
}

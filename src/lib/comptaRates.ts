/**
 * Taux et seuils officiels de la micro-entreprise, au même endroit (page Compta).
 * Chaque valeur porte sa source ; vérifiées le RATES_CHECKED. Un taux qui change se
 * corrige ICI (et dans docs/compta-micro.md) ; l'agence peut aussi le modifier dans les
 * réglages de la page Compta.
 */

/** Date de vérification des taux ci-dessous. */
export const RATES_CHECKED = "2026-10-29";

export type Activity = "bnc" | "bic_services";

export const ACTIVITIES: Record<Activity, {
  label: string;
  /** Cotisations sociales, % du chiffre d'affaires encaissé. */
  urssaf: number;
  /** Versement libératoire de l'impôt sur le revenu (option), % du chiffre d'affaires. */
  vl: number;
  /** Contribution à la formation professionnelle, % du chiffre d'affaires. */
  cfp: number;
}> = {
  // service-public.gouv.fr F36232 (vérifié le 1er janvier 2026) : 25,6 % ; avec versement libératoire 27,8 %.
  // CFP 0,2 % pour une activité libérale (service-public.gouv.fr F23459).
  bnc: { label: "Activité libérale non réglementée (BNC)", urssaf: 25.6, vl: 2.2, cfp: 0.2 },
  // service-public.gouv.fr F36232 : 21,2 % ; avec versement libératoire 22,9 %. CFP 0,1 % (commerçant).
  bic_services: { label: "Prestations de services commerciales (BIC)", urssaf: 21.2, vl: 1.7, cfp: 0.1 },
};

/** Plafond de chiffre d'affaires HT de la micro-entreprise, services (BIC) et libéral (BNC), 2026. */
export const MICRO_CEILING = 83_600; // service-public.gouv.fr F32353

/** Franchise en base de TVA, prestations de services, 2026 (inchangée par rapport à 2025). */
export const VAT_FRANCHISE = {
  /** CA de l'année précédente au-delà : TVA à partir du 1er janvier suivant. */
  base: 37_500,
  /** CA de l'année en cours au-delà : TVA dès le jour du dépassement. */
  majore: 41_250,
}; // service-public.gouv.fr F21746 (vérifié le 1er janvier 2026)

export const RATE_SOURCES: { label: string; url: string }[] = [
  { label: "Cotisations du micro-entrepreneur (service-public.gouv.fr)", url: "https://entreprendre.service-public.gouv.fr/vosdroits/F36232" },
  { label: "Formation professionnelle des indépendants (service-public.gouv.fr)", url: "https://entreprendre.service-public.gouv.fr/vosdroits/F23459" },
  { label: "Seuils de la micro-entreprise (service-public.gouv.fr)", url: "https://entreprendre.service-public.gouv.fr/vosdroits/F32353" },
  { label: "Franchise en base de TVA (service-public.gouv.fr)", url: "https://entreprendre.service-public.gouv.fr/vosdroits/F21746" },
];

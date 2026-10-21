/**
 * Modèles de mails (page « Modèles ») : ceux fournis d'office + ceux de l'agence (clé
 * `customTemplates` du blob). Partagés par la page Modèles et le sélecteur des Mails.
 * Variables : {marque}, {créateur}, {prénom} (remplacées si connues, sinon laissées).
 */

/** `id` : présent sur les modèles perso (généré à l'écriture pour les anciens). */
export type Template = { id?: string; category: string; title: string; body: string };

export const DEFAULT_TEMPLATES: Template[] = [
  {
    category: "Prospection",
    title: "DM marque à froid",
    body:
      "Bonjour {marque} 👋\n\n" +
      "Je gère les collaborations de {créateur} chez TTP Creators. On adore votre univers et on pense qu'une campagne ensemble aurait du sens : audience engagée, contenu qui performe.\n\n" +
      "Puis-je vous envoyer le media kit de {créateur} par mail ?\n\n" +
      "Belle journée,\nTTP Creators",
  },
  {
    category: "Prospection",
    title: "Relance après devis",
    body:
      "Bonjour {marque},\n\n" +
      "Je me permets de revenir vers vous concernant le devis envoyé pour la collaboration avec {créateur}.\n\n" +
      "Avez-vous eu l'occasion d'en discuter en interne ? Je reste disponible pour ajuster le format ou le budget si besoin.\n\n" +
      "Au plaisir d'échanger,\nTTP Creators",
  },
  {
    category: "Négociation",
    title: "Contre-proposition tarif",
    body:
      "Bonjour {marque},\n\n" +
      "Merci pour votre retour. Pour ce format, le tarif de {créateur} est de [Montant], droits et exclusivité inclus.\n\n" +
      "Nous pouvons ajuster selon le volume ou la durée de diffusion : dites-moi ce qui correspond à votre budget et je vous fais une proposition sur-mesure.\n\n" +
      "Bien à vous,\nTTP Creators",
  },
  {
    category: "Suivi",
    title: "Brief validé",
    body:
      "Bonjour {marque},\n\n" +
      "Bonne nouvelle : {créateur} a validé le brief 🎉 La production démarre.\n\n" +
      "Livraison prévue le [Date]. Je vous tiens informé(e) de l'avancement et reviens vers vous dès que les premiers contenus sont prêts pour relecture.\n\n" +
      "Merci de votre confiance,\nTTP Creators",
  },
  {
    category: "Suivi",
    title: "Rappel deadline",
    body:
      "Bonjour {marque},\n\n" +
      "Petit rappel amical : la livraison des contenus de {créateur} est prévue pour le [Date].\n\n" +
      "Il nous manque encore [élément manquant] de votre côté pour finaliser. Pourriez-vous nous le transmettre d'ici [Date] afin de tenir la deadline ?\n\n" +
      "Merci !\nTTP Creators",
  },
  {
    category: "Facturation",
    title: "Envoi de facture",
    body:
      "Bonjour {marque},\n\n" +
      "Comme convenu, vous trouverez ci-joint la facture #[Réf] pour la collaboration avec {créateur}, d'un montant de [Montant].\n\n" +
      "Le règlement est attendu sous [30] jours. N'hésitez pas si vous avez besoin d'un justificatif complémentaire.\n\n" +
      "Merci et à bientôt,\nTTP Creators",
  },
  {
    category: "Facturation",
    title: "Relance impayé",
    body:
      "Bonjour {marque},\n\n" +
      "Sauf erreur de notre part, la facture #[Réf] d'un montant de [Montant] (échéance le [Date]) reste en attente de règlement.\n\n" +
      "Pourriez-vous nous indiquer une date de paiement ? Je reste à disposition pour tout justificatif.\n\n" +
      "Merci d'avance,\nTTP Creators",
  },
];

/** Ordre d'affichage des catégories (les autres viennent après). */
export const MODEL_CATEGORY_ORDER = ["Prospection", "Négociation", "Suivi", "Facturation"];

/** Tous les modèles, rangés par catégorie (ordre ci-dessus, puis les autres). */
export function groupModels(list: readonly Template[]): { category: string; items: Template[] }[] {
  const cats: string[] = [];
  for (const t of list) if (!cats.includes(t.category)) cats.push(t.category);
  cats.sort((a, b) => {
    const ia = MODEL_CATEGORY_ORDER.indexOf(a), ib = MODEL_CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return cats.map((category) => ({ category, items: list.filter((t) => t.category === category) }));
}

export type ModelVars = { marque?: string | null; createur?: string | null; prenom?: string | null };

/** Remplace les variables connues ; une variable inconnue reste visible (à compléter). */
export function fillModel(body: string, v: ModelVars): string {
  const val = (x: string | null | undefined) => (x ?? "").trim();
  return body
    .replace(/\{marque\}/gi, (m) => val(v.marque) || m)
    .replace(/\{cr[ée]ateur\}/gi, (m) => val(v.createur) || m)
    .replace(/\{pr[ée]nom\}/gi, (m) => val(v.prenom) || m);
}

const PUBLIC_DOMAINS = ["gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "icloud", "me", "orange", "free", "sfr", "laposte", "wanadoo", "proton", "protonmail", "gmx"];
/** « anna@nike.com » → « Nike » ; adresse perso (gmail…) → "". */
export function brandFromEmail(email: string | null | undefined): string {
  const host = String(email ?? "").toLowerCase().split("@")[1] ?? "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return "";
  // « marque.co.uk », « marque.com.au » : le nom est avant le suffixe à deux niveaux.
  const twoLevel = parts.length >= 3 && parts[parts.length - 1].length === 2 && ["co", "com", "org", "net", "gouv", "ac"].includes(parts[parts.length - 2]);
  const name = parts[parts.length - (twoLevel ? 3 : 2)];
  if (PUBLIC_DOMAINS.includes(name)) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Ajoute le modèle au texte déjà écrit (séparé par une ligne vide), ou le pose tel quel. */
export function insertModel(current: string, model: string): string {
  const cur = current.replace(/\s+$/, "");
  return cur ? `${cur}\n\n${model}` : model;
}

/** Clé stable d'un modèle (favoris) : son id, sinon « défaut : titre » pour les modèles fournis. */
export const modelKey = (t: Template) => t.id ?? `def:${t.title}`;

/** Favoris d'abord (dans l'ordre de la liste), pour la section « Favoris » du sélecteur. */
export function favoriteModels(list: readonly Template[], favs: Readonly<Record<string, unknown>> | null | undefined): Template[] {
  if (!favs) return [];
  return list.filter((t) => !!favs[modelKey(t)]);
}

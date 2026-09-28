import { titleCase } from "@/lib/utils";

/**
 * Modèles de mails de prospection — stockés dans l'app state (clé
 * `mailTemplates`), éditables depuis le composeur. Variables résolues au
 * moment de la sélection du modèle :
 *  - {{destinataire}} : prénom du contact s'il existe, sinon nom de la marque
 *  - {{prenom}}       : prénom seul (vide si inconnu)
 *  - {{marque}}       : nom de la marque
 */

export type MailTemplateKind = "prospection" | "relance";

export type MailTemplate = {
  id: string;
  name: string;
  kind: MailTemplateKind;
  subject: string;
  body: string;
};

export const KIND_LABEL: Record<MailTemplateKind, string> = {
  prospection: "Prospection",
  relance: "Relance",
};

export const TEMPLATE_VARS: { token: string; label: string }[] = [
  { token: "{{destinataire}}", label: "Prénom, sinon marque" },
  { token: "{{prenom}}", label: "Prénom (vide si inconnu)" },
  { token: "{{marque}}", label: "Marque" },
];

export type TemplateContact = {
  brand?: string | null;
  person?: string | null;
  first_name?: string | null;
};

/** Prénom exploitable du contact (first_name, sinon 1er mot de `person`). */
function firstName(c: TemplateContact): string {
  const fn = (c.first_name ?? "").trim();
  if (fn) return titleCase(fn);
  const person = (c.person ?? "").trim();
  if (person && person !== "—") return titleCase(person.split(/\s+/)[0] ?? "");
  return "";
}

/** Résout les variables d'un texte pour un contact donné. */
export function renderTemplate(text: string, c: TemplateContact): string {
  const prenom = firstName(c);
  const marque = (c.brand ?? "").trim();
  const destinataire = prenom || marque;
  return text
    .replaceAll("{{destinataire}}", destinataire)
    .replaceAll("{{prenom}}", prenom)
    .replaceAll("{{marque}}", marque)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +,/g, ",");
}

/** Modèles fournis par défaut — modifiables/supprimables dans le gestionnaire. */
export const DEFAULT_TEMPLATES: MailTemplate[] = [
  {
    id: "tpl-prospection-marque",
    name: "Premier contact — marque",
    kind: "prospection",
    subject: "{{marque}} × TTP Creators — une idée de collaboration",
    body: `Bonjour {{destinataire}},

Je suis Marc, co-fondateur de TTP Creators, agence de talent management Sport & Lifestyle entre Lyon et Genève.

On accompagne des créatrices dont l'audience correspond bien à l'univers de {{marque}}, et je pense qu'il y a une vraie collaboration à construire ensemble : contenus incarnés, campagnes mesurées, zéro friction pour vos équipes.

Est-ce que vous auriez 15 minutes cette semaine ou la suivante pour en parler ? Je peux aussi vous envoyer directement le media kit de la créatrice qui matcherait le mieux.

Bien à vous,
Marc — TTP Creators
ttpcreators.pro`,
  },
  {
    id: "tpl-prospection-mediakit",
    name: "Premier contact — avec media kit",
    kind: "prospection",
    subject: "Une créatrice pour {{marque}} — media kit inclus",
    body: `Bonjour {{destinataire}},

Marc, de TTP Creators (talent management Sport & Lifestyle, Lyon · Genève).

En regardant ce que fait {{marque}} en ce moment, une de nos créatrices s'impose comme une évidence — audience alignée, formats qui performent, historique de campagnes propre. Son media kit complet (chiffres à jour) est ici : ttpcreators.pro/mediakit/

Si le profil vous parle, je vous propose un échange rapide pour cadrer une première collaboration simple.

Bien à vous,
Marc — TTP Creators`,
  },
  {
    id: "tpl-relance-douce",
    name: "Relance douce",
    kind: "relance",
    subject: "Re : {{marque}} × TTP Creators",
    body: `Bonjour {{destinataire}},

Je me permets de revenir vers vous — mon précédent message a pu passer entre deux priorités.

L'idée reste simple : connecter {{marque}} avec la bonne créatrice de notre roster, sur un format court et mesurable pour commencer. Si le timing n'est pas bon, dites-le-moi franchement et je reviendrai au bon moment.

Bien à vous,
Marc — TTP Creators
ttpcreators.pro`,
  },
  {
    id: "tpl-relance-fenetre",
    name: "Relance — dernière fenêtre",
    kind: "relance",
    subject: "On cale {{marque}} sur ce trimestre ?",
    body: `Bonjour {{destinataire}},

Dernier message de ma part, promis : on finalise en ce moment les collaborations de nos créatrices pour le trimestre, et j'aimerais savoir si {{marque}} souhaite en faire partie avant qu'on referme le planning.

Un simple « oui, parlons-en » ou « pas cette fois » me suffit.

Merci pour votre temps,
Marc — TTP Creators
ttpcreators.pro`,
  },
];

/** Modèle suggéré : relance si le contact a déjà été touché, sinon prospection. */
export function suggestedKind(hasBeenContacted: boolean): MailTemplateKind {
  return hasBeenContacted ? "relance" : "prospection";
}

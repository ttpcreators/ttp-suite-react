import { titleCase } from "@/lib/utils";

/**
 * Modèles de mails de prospection — stockés dans l'app state (clé
 * `prospectMailTemplates`, migrée depuis l'ancienne clé partagée `mailTemplates`), éditables depuis le composeur. Variables résolues au
 * moment de la sélection du modèle :
 *  - {{destinataire}} : prénom du contact s'il existe, sinon nom de la marque
 *  - {{prenom}}       : prénom seul (vide si inconnu)
 *  - {{marque}}       : nom de la marque
 */

export type MailTemplateKind = "prospection" | "relance";

/**
 * Clés app state. L'ancienne clé `mailTemplates` était partagée par DEUX
 * formats (prospection avec `kind`, media kit sans `kind`) qui s'écrasaient.
 * Désormais chaque usage a sa clé ; l'ancienne n'est plus écrite ni supprimée,
 * elle sert seulement de source de migration tant que la nouvelle est absente.
 */
export const PROSPECT_TEMPLATES_KEY = "prospectMailTemplates";
export const MEDIAKIT_TEMPLATES_KEY = "mediakitMailTemplates";
export const LEGACY_TEMPLATES_KEY = "mailTemplates";

function legacyEntries(s: Record<string, unknown>): Record<string, unknown>[] {
  const legacy = s[LEGACY_TEMPLATES_KEY];
  return Array.isArray(legacy) ? legacy.filter((t): t is Record<string, unknown> => !!t && typeof t === "object") : [];
}

/** Modèles de prospection : nouvelle clé, sinon entrées AVEC `kind` de l'ancienne. */
export function readProspectTemplates(s: Record<string, unknown>): MailTemplate[] | undefined {
  const cur = s[PROSPECT_TEMPLATES_KEY];
  if (Array.isArray(cur)) return cur as MailTemplate[];
  const migrated = legacyEntries(s).filter((t) => typeof t.kind === "string");
  return migrated.length ? (migrated as unknown as MailTemplate[]) : undefined;
}

/** Modèles media kit : nouvelle clé, sinon entrées SANS `kind` de l'ancienne. */
export function readMediakitTemplates<T>(s: Record<string, unknown>): T[] | undefined {
  const cur = s[MEDIAKIT_TEMPLATES_KEY];
  if (Array.isArray(cur)) return cur as T[];
  const migrated = legacyEntries(s).filter((t) => !("kind" in t));
  return migrated.length ? (migrated as unknown as T[]) : undefined;
}

/**
 * Fusionne les modifs locales d'un gestionnaire de modèles sur l'état FRAIS
 * (relu juste avant la sauvegarde) :
 *  - supprimés localement (dans `base`, plus dans `draft`) → retirés ;
 *  - modifiés localement (différents de `base`) ou nouveaux → version locale ;
 *  - non touchés localement → version fraîche (modifs d'un autre poste gardées) ;
 *  - supprimés à distance et non touchés localement → restent supprimés.
 */
export function mergeTemplateEdits<T extends { id: string }>(fresh: T[], base: T[], draft: T[]): T[] {
  const baseById = new Map(base.map((t) => [t.id, t]));
  const draftById = new Map(draft.map((t) => [t.id, t]));
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  const touched = (t: T) => {
    const b = baseById.get(t.id);
    return !b || !same(b, t);
  };
  const deleted = new Set(base.filter((t) => !draftById.has(t.id)).map((t) => t.id));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const f of fresh) {
    if (deleted.has(f.id)) continue;
    const d = draftById.get(f.id);
    out.push(d && touched(d) ? d : f);
    seen.add(f.id);
  }
  for (const d of draft) {
    if (!seen.has(d.id) && touched(d)) out.push(d);
  }
  return out;
}

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

/**
 * Lien `mailto:` pré-rempli. Il ouvre l'app mail par défaut du Mac (Spark chez
 * nous : c'est lui qui gère `mailto:`, Chrome n'a pas de Gmail branché dessus).
 */
export function mailtoHref(email: string, subject: string, body: string): string {
  const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join("&");
  return `mailto:${email.trim()}${q ? `?${q}` : ""}`;
}

/** Objet + texte du modèle suggéré pour ce contact, variables résolues. */
export function suggestedMail(
  templates: MailTemplate[],
  c: TemplateContact,
  hasBeenContacted: boolean,
): { subject: string; body: string } {
  const kind = suggestedKind(hasBeenContacted);
  const tpl = templates.find((t) => t.kind === kind) ?? templates[0];
  return tpl ? { subject: renderTemplate(tpl.subject, c), body: renderTemplate(tpl.body, c) } : { subject: "", body: "" };
}

// ============================================================================
// _shared/mailTasks.ts : les demandes d'un mail reçu → tâches de la To-do.
// ----------------------------------------------------------------------------
// Logique PURE (testée par mailTasks.test.ts), SANS IA : des règles fixes en
// français et en anglais. Une demande = une phrase qui parle d'un sujet connu
// (stats, facture, contrat, brief, retours, adresse, tarifs, call, date de
// publication, paiement) ET qui demande quelque chose (« merci de », « pouvez-vous »,
// « could you », une question, une échéance…). L'échéance vient de la phrase
// (« avant le 12 novembre », « d'ici vendredi », « demain », « ASAP »), sinon du
// reste du mail, sinon 2 jours après la réception. Utilisé par gmail-poll.
// ============================================================================

export type MailTaskKind =
  | "stats" | "facture" | "contrat" | "brief" | "retours" | "adresse"
  | "tarifs" | "call" | "publication" | "paiement";

export type MailTask = {
  kind: MailTaskKind;
  /** Titre de la tâche (un verbe, 45 caractères au plus avec la marque). */
  title: string;
  /** AAAA-MM-JJ. */
  due: string;
  priority: "haute" | "moyenne";
  /** La phrase du mail qui contient la demande (contexte de la tâche). */
  quote: string;
};

/** Minuscules sans accents (les règles s'écrivent sans accents). */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase();

type Rule = { kind: MailTaskKind; topic: RegExp; title: (who: string) => string; strong?: RegExp };

// `strong` : tournure assez claire pour valoir demande à elle seule (sans « merci de »…).
const RULES: Rule[] = [
  {
    kind: "stats",
    topic: /\b(stats?|statistiques?|insights?|analytics|chiffres|captures? d'ecran|screenshots?|reporting|kpis?|resultats? de la (video|publication|campagne))\b/,
    title: (w) => `Envoyer les stats à ${w}`,
  },
  {
    kind: "facture",
    topic: /\b(factur\w*|invoices?|bon de commande|purchase order|rib|iban|coordonnees bancaires|bank details)\b/,
    title: (w) => `Envoyer la facture à ${w}`,
  },
  {
    kind: "contrat",
    topic: /\b(contrats?|contracts?|avenant|docusign|yousign|agreement)\b/,
    strong: /\b(a signer|merci de (le |la )?signer|pour signature|for signature|please sign|sign (it|the)|ci-joint le contrat|contrat ci-joint|attached (the )?(contract|agreement))\b/,
    title: (w) => `Signer le contrat ${w}`,
  },
  {
    kind: "brief",
    topic: /\bbriefs?\b/,
    strong: /\b(ci-joint|ci joint|voici|vous trouverez|tu trouveras|en piece jointe|attached|here is|here's|please find)\b/,
    title: (w) => `Lire le brief ${w}`,
  },
  {
    kind: "retours",
    topic: /\b(retours?|feedbacks?|modifications?|ajustements?|corrections?|revisions?|changes|edits)\b.{0,60}\b(video|contenu|draft|v1|v2|montage|script|reel|post|story|content|cut)\b|\b(video|contenu|draft|v1|montage|script|reel|content)\b.{0,60}\b(retours?|feedbacks?|modifications?|ajustements?|corrections?|revisions?|changes)\b/,
    strong: /\b(voici (nos|mes|les) retours|nos retours|our feedback|here (is|are) (our|the) (feedback|changes)|quelques (retours|modifications|ajustements))\b/,
    title: (w) => `Appliquer les retours de ${w}`,
  },
  {
    kind: "adresse",
    topic: /\b(adresse( de livraison| postale)?|shipping (address|details)|delivery address|livraison|colis|envoyer (le|les) produits?|send (you|her|him|them) (the )?products?)\b/,
    title: (w) => `Envoyer l'adresse à ${w}`,
  },
  {
    kind: "tarifs",
    topic: /\b(tarifs?|rates?|rate ?card|pricing|prix|devis|quote|media ?kits?|kit media|budget)\b/,
    title: (w) => `Envoyer les tarifs à ${w}`,
  },
  {
    kind: "call",
    topic: /\b(call|visio|appel|meeting|reunion|rendez-vous|rdv|creneau|slot|zoom|google meet|teams|disponibilites?|dispos?|availability|available)\b/,
    title: (w) => `Caler un call avec ${w}`,
  },
  {
    kind: "publication",
    topic: /\b(date de (publication|mise en ligne)|mise en ligne|go[- ]live|posting date|publication (prevue|le)|publier le|post(ed|ing)? on|live on)\b/,
    strong: /\b(prevue?|planifiee?|programmee?|fixee?|scheduled|planned)\b/,
    title: (w) => `Noter la date de publication ${w}`,
  },
  {
    kind: "paiement",
    topic: /\b(paiement|virement|payment|transfer|reglement)\b/,
    strong: /\b(paiement|virement|payment|transfer|reglement) (a ete |has been |was )?(effectue|envoye|fait|realise|lance|sent|made|done|processed|initiated)\b|\b(we|nous) (have |avons )?(paid|paye|regle|vire)\b/,
    title: (w) => `Vérifier le paiement de ${w}`,
  },
];

// Tournures qui demandent quelque chose (texte sans accents).
const ASK = new RegExp(
  [
    "merci de", "merci d'", "pourriez-vous", "pouvez-vous", "pourrais-tu", "peux-tu", "pourrais tu", "peux tu", "pouvez vous", "pourriez vous",
    "est-ce que (vous|tu) (pouvez|peux|pourriez|pourrais)", "(vous|tu) (pouvez|peux|pourriez|pourrais) (nous|me)",
    "il (nous |me )?(faudrait|faut)", "(nous avons|on a|j'ai|j'aurais|nous aurions) besoin", "besoin de",
    "n'oubliez pas", "n'oublie pas", "(envoyez|envoie|transmettez|transmets|partagez|partage|renvoyez|renvoie)[- ]?(nous|moi)",
    "a nous (envoyer|transmettre|renvoyer)", "en attente de", "nous attendons", "on attend", "j'attends", "rappel", "relance",
    "(could|can|would) you", "please", "kindly", "we (would )?need", "we'd need", "i need", "let us know", "let me know",
    "send (us|me|over)", "share (with us|them|it)", "waiting for", "reminder", "deadline", "asap", "au plus vite", "des que possible", "urgent",
    "avant le", "d'ici", "by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|the end|end of|eod|\\d)",
  ].join("|"),
);

const STOP_SENDER = /(no-?reply|noreply|ne-pas-repondre|notifications?|newsletter|mailer-daemon|postmaster|bounce|digest|marketing|news@|info@.*(mailchimp|sendinblue|brevo))/i;

/** Expéditeur à ignorer (robots, newsletters). */
export function ignoredSender(email: string): boolean {
  return STOP_SENDER.test(email);
}

/** Texte du mail sans les citations des messages précédents ni la signature. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (/^>/.test(t)) break;
    if (/^(le|on) .{4,120}(a ecrit|wrote)\s*:?$/i.test(fold(t))) break;
    if (/^-{2,}\s*(original message|message d'origine|forwarded message|message transfere)/i.test(fold(t))) break;
    if (/^(de|from)\s*:\s*.+@/i.test(t) && out.length > 0) break;
    if (/^--\s*$/.test(t)) break; // signature
    out.push(l);
  }
  return out.join("\n").trim();
}

/** Phrases du mail (objet compris), espaces resserrés. */
export function sentences(subject: string, body: string): string[] {
  const text = `${subject}.\n${body}`.replace(/\s*\n\s*\n+/g, ".\n");
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 4);
}

// ── Échéances ─────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, january: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, february: 2, feb: 2, mars: 3, march: 3, mar: 3,
  avril: 4, avr: 4, april: 4, apr: 4, mai: 5, may: 5, juin: 6, june: 6, jun: 6, juillet: 7, juil: 7, july: 7, jul: 7,
  aout: 8, august: 8, aug: 8, septembre: 9, sept: 9, september: 9, sep: 9, octobre: 10, october: 10, oct: 10,
  novembre: 11, november: 11, nov: 11, decembre: 12, december: 12, dec: 12,
};
const DAYS: Record<string, number> = {
  dimanche: 0, sunday: 0, lundi: 1, monday: 1, mardi: 2, tuesday: 2, mercredi: 3, wednesday: 3,
  jeudi: 4, thursday: 4, vendredi: 5, friday: 5, samedi: 6, saturday: 6,
};
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** Jour de réception à Paris (minuit UTC de ce jour-là, pour compter en jours). */
export function parisDay(ts: number): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  const [y, m, d] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date jour/mois sans année : cette année, ou l'an prochain si elle est déjà passée de plus de 2 mois. */
function dayMonth(day: Date, d: number, m: number, y?: number): Date | null {
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
  let year = y ?? day.getUTCFullYear();
  if (y !== undefined && y < 100) year = 2000 + y;
  let out = new Date(Date.UTC(year, m - 1, d));
  if (out.getUTCMonth() !== m - 1) return null; // 31 février
  if (y === undefined && out.getTime() < addDays(day, -60).getTime()) out = new Date(Date.UTC(year + 1, m - 1, d));
  return out;
}

/** Échéance écrite dans un texte (« avant le 12 novembre », « d'ici vendredi », « demain »…), null sinon. */
export function findDue(text: string, day: Date): { due: string; urgent: boolean } | null {
  const t = fold(text);
  const urgent = /\b(asap|urgent|au plus vite|des que possible|rapidement|au plus tot|as soon as possible|today|aujourd'hui|ce soir|eod|end of (the )?day)\b/.test(t);
  // 12 novembre / 12 nov. / november 12 / nov 12th
  const m1 = /\b(\d{1,2})(?:er|st|nd|rd|th)?\s+(janvier|janv|january|jan|fevrier|fevr|fev|february|feb|mars|march|mar|avril|avr|april|apr|mai|may|juin|june|jun|juillet|juil|july|jul|aout|august|aug|septembre|sept|september|sep|octobre|october|oct|novembre|november|nov|decembre|december|dec)\b\.?(?:\s+(\d{4}))?/.exec(t);
  const m2 = /\b(janvier|january|jan|fevrier|february|feb|mars|march|mar|avril|april|apr|mai|may|juin|june|jun|juillet|july|jul|aout|august|aug|septembre|september|sep|sept|octobre|october|oct|novembre|november|nov|decembre|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/.exec(t);
  const m3 = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(t);
  let d: Date | null = null;
  if (m1) d = dayMonth(day, Number(m1[1]), MONTHS[m1[2]], m1[3] ? Number(m1[3]) : undefined);
  else if (m2) d = dayMonth(day, Number(m2[2]), MONTHS[m2[1]], m2[3] ? Number(m2[3]) : undefined);
  else if (m3) d = dayMonth(day, Number(m3[1]), Number(m3[2]), m3[3] ? Number(m3[3]) : undefined);
  if (!d) {
    if (/\b(demain|tomorrow)\b/.test(t)) d = addDays(day, 1);
    else if (/\b(apres-demain|apres demain)\b/.test(t)) d = addDays(day, 2);
    else if (/\b(fin de (la )?semaine|end of (the )?week)\b/.test(t)) d = addDays(day, ((5 - day.getUTCDay() + 7) % 7) || 0);
    else if (/\b(semaine prochaine|next week)\b/.test(t)) d = addDays(day, ((1 - day.getUTCDay() + 7) % 7) || 7);
    else if (/\b(fin du mois|end of (the )?month)\b/.test(t)) d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
    else {
      const wd = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(t);
      if (wd) d = addDays(day, (DAYS[wd[1]] - day.getUTCDay() + 7) % 7);
    }
  }
  if (!d && urgent) d = day;
  if (!d) return null;
  if (d.getTime() < day.getTime()) d = day; // date passée : à faire tout de suite
  return { due: iso(d), urgent };
}

/** Titre de 45 caractères au plus (le nom est raccourci, jamais le verbe). */
function fitTitle(rule: Rule, who: string): string {
  let w = who.trim() || "la marque";
  let title = rule.title(w);
  while (title.length > 45 && w.length > 8) {
    w = `${w.slice(0, w.length - 2).trimEnd()}…`;
    title = rule.title(w);
  }
  return title;
}

/**
 * Demandes d'un mail reçu. `who` = marque (ou nom de l'expéditeur), `receivedAt` en ms.
 * Une tâche au plus par sujet ; « rien » si le mail ne demande rien de précis.
 */
export function mailTasks(input: { subject: string; body: string; who: string; receivedAt: number }): MailTask[] {
  const day = parisDay(input.receivedAt);
  const all = sentences(input.subject, stripQuoted(input.body));
  const wholeDue = findDue(all.join(" "), day);
  const out: MailTask[] = [];
  for (const rule of RULES) {
    const hit = all.find((s) => {
      const f = fold(s);
      if (!rule.topic.test(f)) return false;
      return (rule.strong?.test(f) ?? false) || ASK.test(f) || /\?\s*$/.test(s);
    });
    if (!hit) continue;
    const due = findDue(hit, day) ?? wholeDue;
    out.push({
      kind: rule.kind,
      title: fitTitle(rule, input.who),
      due: due?.due ?? iso(addDays(day, 2)),
      priority: due?.urgent ? "haute" : "moyenne",
      quote: hit.length > 280 ? `${hit.slice(0, 279).trimEnd()}…` : hit,
    });
  }
  return out;
}

/** Clé de dédoublonnage : un sujet par fil de mails (le même fil ne crée jamais deux fois la tâche). */
export const taskKey = (threadId: string, kind: MailTaskKind) => `${threadId}:${kind}`;

/** Marque lisible tirée de l'adresse (« partenariats@nike.com » → « Nike ») ; null pour les messageries publiques. */
export function brandFromEmail(email: string): string | null {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (!domain || /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|mac|orange|free|sfr|laposte|wanadoo|proton|protonmail|gmx|aol)\./.test(domain)) return null;
  const parts = domain.split(".");
  const core = parts.length > 2 && /^(co|com|org|net)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
  if (!core || core.length < 2) return null;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

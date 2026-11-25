// ============================================================================
// _shared/sequence.ts : la séquence de prospection suivie sur chaque fiche contact
// (liste de Gianni « MCP TTP : ce qu'il manque pour automatiser la prospection », 20/11/2026,
// points 1, 2 et 7 ; étapes de la stratégie).
// ----------------------------------------------------------------------------
// Colonnes `contacts.sequence` et `contacts.email_check` (jsonb, SQL 2026-11-20-sequences-contacts).
//   Depuis le 25/11/2026 (décision de Gianni, après le premier lot) : 100 % mail,
//   J0 premier mail · J+5 relance (nouvel angle) · J+12 dernière relance. Chaque relance est
//   écrite à la main par Claude, personnalisée, dans le même fil. Pas d'étape LinkedIn,
//   Instagram ni WhatsApp (on n'automatise pas ces réseaux).
//   Les anciennes étapes (J+1, J+3, J+10, J+20) restent reconnues pour les séquences déjà en base.
// La première réponse arrête la séquence ; un rebond aussi.
// Règles PURES, testées par sequence.test.ts.
// ============================================================================

export type SeqCanal = "email" | "linkedin" | "instagram" | "whatsapp";
export type EtapeDef = { etape: string; jour: number; canal: SeqCanal; quoi: string };

export const ETAPES: EtapeDef[] = [
  { etape: "J0", jour: 0, canal: "email", quoi: "mail : une créatrice, une idée, une date, une preuve, une question" },
  { etape: "J+1", jour: 1, canal: "linkedin", quoi: "invitation LinkedIn sans pitch" },
  { etape: "J+3", jour: 3, canal: "instagram", quoi: "réaction à une story, puis DM court" },
  { etape: "J+5", jour: 5, canal: "email", quoi: "mail avec un nouvel angle (exemple de contenu ou résultat)" },
  { etape: "J+10", jour: 10, canal: "linkedin", quoi: "message court LinkedIn, ou WhatsApp (vocal) si on a le numéro" },
  { etape: "J+12", jour: 12, canal: "email", quoi: "dernière relance, courte et sympathique, sans insister" },
  { etape: "J+20", jour: 20, canal: "email", quoi: "mail de clôture, puis reprise au prochain temps fort" },
];

/** Les étapes suivies aujourd'hui : 100 % mail (décision de Gianni du 25/11/2026). */
export const ETAPES_MAIL = ["J0", "J+5", "J+12"];

export type Reponse = "aucune" | "a_repondu" | "positive" | "negative";
export type Sequence = {
  debut: string; // AAAA-MM-JJ du J0
  faites: string[]; // étapes faites (« J0 », « J+1 »…)
  etape: string | null; // prochaine étape à faire, null = finie ou arrêtée
  canal: SeqCanal | null;
  prochaine: string | null; // AAAA-MM-JJ
  reponse: Reponse;
  statut: "en_cours" | "arretee" | "finie";
  raison?: string;
  createur?: string;
  maj: string;
};

export type EmailCheck = { statut: "ok" | "erreur"; raison: string; le: string };
export type ContactCanaux = { linkedin?: unknown; instagram?: unknown; ig?: unknown; phone?: unknown };

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Les étapes de la séquence : 100 % mail, quels que soient les réseaux du contact. */
export function etapesPour(_c: ContactCanaux): EtapeDef[] {
  return ETAPES.filter((e) => ETAPES_MAIL.includes(e.etape));
}

/** Séquence lue en base (tolérante), ou null. */
export function lireSequence(v: unknown): Sequence | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.debut !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.debut)) return null;
  return {
    debut: s.debut,
    faites: Array.isArray(s.faites) ? s.faites.map(String) : [],
    etape: typeof s.etape === "string" ? s.etape : null,
    canal: (["email", "linkedin", "instagram", "whatsapp"].includes(String(s.canal)) ? s.canal : null) as SeqCanal | null,
    prochaine: typeof s.prochaine === "string" ? s.prochaine : null,
    reponse: (["aucune", "a_repondu", "positive", "negative"].includes(String(s.reponse)) ? s.reponse : "aucune") as Reponse,
    statut: (["en_cours", "arretee", "finie"].includes(String(s.statut)) ? s.statut : "en_cours") as Sequence["statut"],
    ...(typeof s.raison === "string" ? { raison: s.raison } : {}),
    ...(typeof s.createur === "string" && s.createur ? { createur: s.createur } : {}),
    maj: typeof s.maj === "string" ? s.maj : "",
  };
}

/** Pose la prochaine étape après `faites`. */
function suite(base: Omit<Sequence, "etape" | "canal" | "prochaine" | "statut">, c: ContactCanaux, now: Date): Sequence {
  const reste = etapesPour(c).filter((e) => !base.faites.includes(e.etape));
  const n = reste[0];
  return n
    ? { ...base, etape: n.etape, canal: n.canal, prochaine: addDays(base.debut, n.jour), statut: "en_cours", maj: now.toISOString() }
    : { ...base, etape: null, canal: null, prochaine: null, statut: "finie", maj: now.toISOString() };
}

/** Démarre la séquence : le J0 (premier mail) est fait aujourd'hui. */
export function demarrerSequence(c: ContactCanaux, jour: string, now: Date, createur?: string): Sequence {
  return suite({ debut: jour, faites: ["J0"], reponse: "aucune", maj: "", ...(createur ? { createur } : {}) }, c, now);
}

/**
 * Une étape est faite. Sans `etape`, c'est la prochaine prévue. Une séquence arrêtée ou finie
 * ne bouge pas (null).
 */
export function etapeFaite(s: Sequence, c: ContactCanaux, now: Date, etape?: string): Sequence | null {
  if (s.statut !== "en_cours") return null;
  const e = etape || s.etape;
  if (!e || !ETAPES.some((x) => x.etape === e)) return null;
  const faites = s.faites.includes(e) ? s.faites : [...s.faites, e];
  return suite({ debut: s.debut, faites, reponse: s.reponse, maj: s.maj, ...(s.raison ? { raison: s.raison } : {}), ...(s.createur ? { createur: s.createur } : {}) }, c, now);
}

/** Envoi d'un mail à ce contact : avance si la prochaine étape est un mail. */
export function apresMail(s: Sequence, c: ContactCanaux, now: Date): Sequence | null {
  return s.statut === "en_cours" && s.canal === "email" ? etapeFaite(s, c, now) : null;
}

/** Arrêt (réponse, rebond, demande de retrait, ou à la main). */
export function arreter(s: Sequence, raison: string, now: Date, reponse?: Reponse): Sequence {
  return { ...s, etape: null, canal: null, prochaine: null, statut: "arretee", raison, reponse: reponse ?? s.reponse, maj: now.toISOString() };
}

/** À relancer : séquence en cours, prochaine date passée ou aujourd'hui, filtres facultatifs. */
export function aRelancer<T extends { sequence?: unknown; email_check?: unknown }>(
  rows: readonly T[],
  jusqua: string,
  f: { canal?: string; etape?: string } = {},
): (T & { seq: Sequence })[] {
  return rows
    .map((r) => ({ ...r, seq: lireSequence(r.sequence) }))
    .filter((r): r is T & { seq: Sequence } => !!r.seq && r.seq.statut === "en_cours" && !!r.seq.prochaine && r.seq.prochaine <= jusqua)
    .filter((r) => !(f.canal && r.seq.canal !== f.canal) && !(f.etape && r.seq.etape !== f.etape))
    .filter((r) => !(r.seq.canal === "email" && lireEmailCheck(r.email_check)?.statut === "erreur"))
    .sort((a, b) => (a.seq.prochaine! < b.seq.prochaine! ? -1 : a.seq.prochaine! > b.seq.prochaine! ? 1 : 0));
}

export function lireEmailCheck(v: unknown): EmailCheck | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return o.statut === "ok" || o.statut === "erreur" ? { statut: o.statut, raison: String(o.raison ?? ""), le: String(o.le ?? "") } : null;
}

// ── Mails reçus : réponse, réponse automatique, rebond ──────────────────────

/** Réponse automatique (absence, accusé de réception) : n'arrête pas la séquence. */
export function estReponseAuto(subject: string, from = "", snippet = ""): boolean {
  return /absence|absent|out of (the )?office|automatic reply|auto(matic)?[- ]?reply|r[ée]ponse automatique|accus[ée] de r[ée]ception|autoreply|en cong[ée]s?/i.test(subject) ||
    // Objet réécrit par un répondeur (« Merci pour votre message ! Re: … », Anatae le 25/11).
    /^\s*(merci pour votre (message|mail|demande|e-?mail)|thank you for (your|contacting))/i.test(subject) ||
    /nous avons bien (pris en compte|re[çc]u) votre (demande|message|mail|e-?mail)|we (have )?received your (message|email|request)|this is an automated|merci de ne pas r[ée]pondre/i.test(snippet) ||
    /no-?reply|do-?not-?reply/i.test(from);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Adresse en échec d'un rebond (mailer-daemon, postmaster), ou null. `failed` : en-tête
 * X-Failed-Recipients ; sinon la première adresse du résumé qui n'est pas celle du robot
 * ni de l'agence.
 */
export function adresseEnRebond(m: { from: string; subject: string; snippet: string; failed?: string }, domaineAgence: string): string | null {
  const robot = /mailer-daemon|postmaster|mail delivery (sub)?system/i.test(m.from);
  const echec = /delivery status notification|undeliver|non remis|not delivered|delivery (has )?failed|address not found|adresse introuvable|could not be delivered|message bloqu|returned mail|échec de (la )?remise/i.test(m.subject);
  if (!robot || !echec) return null;
  const cands = [...(m.failed ?? "").matchAll(EMAIL_RE), ...m.snippet.matchAll(EMAIL_RE)].map((x) => x[0].toLowerCase());
  return cands.find((a) => !/mailer-daemon|postmaster|googlemail\.com$/.test(a) && !a.endsWith("@" + domaineAgence.toLowerCase())) ?? null;
}

/** Texte de la tâche « Visio » et de sa fiche, quand un contact en séquence répond. */
export function tacheVisio(c: { brand?: unknown; person?: unknown; email?: unknown; touches?: unknown }, s: Sequence, m: { subject: string; snippet: string }): { text: string; descr: string } {
  const marque = String(c.brand ?? "").trim() || String(c.email ?? "");
  const hist = (Array.isArray(c.touches) ? (c.touches as Record<string, unknown>[]) : [])
    .slice(0, 6)
    .map((t) => `- ${String(t.date ?? "").slice(0, 10)} · ${t.canal ?? ""} · ${t.kind ?? ""}${t.note ? ` · ${String(t.note).slice(0, 120)}` : ""}`);
  return {
    text: `Visio : ${marque.slice(0, 80)}`,
    descr: [
      `${marque} a répondu à la prospection (séquence commencée le ${s.debut}, étapes faites : ${s.faites.join(", ") || "—"}).`,
      `Contact : ${String(c.person ?? "").trim() || "—"} · ${String(c.email ?? "")}`,
      s.createur ? `Créatrice proposée : ${s.createur}` : "",
      `Sa réponse : « ${m.subject.slice(0, 140)} » ${m.snippet.slice(0, 280)}`,
      hist.length ? `Historique :\n${hist.join("\n")}` : "",
      "Si c'est un non : noter la réponse négative (sequence_contact), puis supprimer cette tâche. Gifting ou affiliation seule : pas de visio, demander le budget par écrit.",
    ].filter(Boolean).join("\n"),
  };
}

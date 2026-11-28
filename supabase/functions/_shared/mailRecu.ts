// ============================================================================
// _shared/mailRecu.ts : ce qu'on retient d'un mail reçu (relève gmail-poll, journal
// email_activity, file d'envoi _shared/fileEnvoi.ts).
// ----------------------------------------------------------------------------
//   - l'expéditeur : l'adresse du dernier <…> de l'en-tête From, hors guillemets et hors
//     commentaires (adresseDe). Une adresse écrite dans le nom affiché ne compte jamais, et un
//     nom affiché qui contient « @ » n'est pas gardé (nomAffiche) ;
//   - un avis de non-remise (estAvisDeNonRemise) : envoyé par une adresse de robot
//     (mailer-daemon@, postmaster@) ET au format des avis (multipart/report,
//     report-type=delivery-status), ou un avis de Google avec l'en-tête X-Failed-Recipients. Un
//     avis qui se dit de Google doit être signé par Google. Le nom affiché et l'objet seuls ne
//     suffisent jamais. Le format seul ne prouve rien (n'importe qui peut l'écrire) : la relève ne
//     garde l'avis que s'il suit un envoi réel de l'agence à l'adresse citée
//     (_shared/ancreRebond.ts), sinon le mail est noté douteux ;
//   - un expéditeur authentifié (expediteurAuthentifie) : dans l'en-tête Authentication-Results
//     posé par Google, DMARC « pass » pour le domaine de son adresse ; quand Google ne rend aucun
//     résultat DMARC (domaine sans règle DMARC, ou « bestguesspass », une estimation de Google), un
//     SPF ou un DKIM « pass » aligné sur ce domaine.
//     Seule une réponse authentifiée arrête une séquence ou montre qu'une adresse marche ;
//   - la source notée au journal (email_activity.source) qui garde ce verdict : « inbox-rebond »,
//     « inbox-verifie » ou « inbox-douteux ». Les lignes écrites avant (« inbox ») sont lues avec
//     l'ancienne règle, sur l'adresse seule (rebondDuJournal, prouveAdresse).
// Règles PURES, testées par mailRecu.test.ts.
// ============================================================================

/** Adresse acceptée comme expéditeur (minuscules) : ni espace ni séparateur d'en-tête. */
const ADRESSE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

/**
 * Un en-tête From lu caractère par caractère : le contenu du dernier <…> hors guillemets et
 * hors commentaires (`angle`, null s'il n'y en a pas) et sa position, le texte hors guillemets,
 * commentaires et <…> (`hors`), et le premier commentaire (`note`).
 */
function lireFrom(s: string): { angle: string | null; pos: number; hors: string; note: string; ouvert: boolean } {
  let guillemets = false;
  let profondeur = 0;
  let ouvert = -1;
  let angle: string | null = null;
  let pos = -1;
  let hors = "";
  let note = "";
  let courante = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (guillemets) {
      if (c === "\\") i++;
      else if (c === '"') guillemets = false;
      continue;
    }
    if (profondeur > 0) {
      if (c === "\\") {
        courante += s[i + 1] ?? "";
        i++;
      } else if (c === "(") {
        profondeur++;
      } else if (c === ")") {
        profondeur--;
        if (profondeur === 0 && !note) note = courante;
      } else {
        courante += c;
      }
      continue;
    }
    if (ouvert >= 0) {
      if (c === ">") {
        angle = s.slice(ouvert + 1, i);
        pos = ouvert;
        ouvert = -1;
      }
      continue;
    }
    if (c === '"') guillemets = true;
    else if (c === "(") {
      profondeur = 1;
      courante = "";
    } else if (c === "<") ouvert = i;
    else hors += c;
  }
  return { angle, pos, hors, note, ouvert: guillemets || profondeur > 0 || ouvert >= 0 };
}

/**
 * Adresse de l'expéditeur d'un en-tête From (minuscules), ou "" si elle est illisible : en-tête
 * mal formé (guillemet, commentaire ou chevron resté ouvert à la fin) ou plusieurs adresses (une
 * virgule hors guillemets, commentaires et <…>).
 */
export function adresseDe(from: string): string {
  const { angle, hors, ouvert } = lireFrom(String(from ?? ""));
  if (ouvert || hors.includes(",")) return "";
  const brut = (angle !== null ? angle : hors).trim().toLowerCase();
  return ADRESSE.test(brut) ? brut : "";
}

/** Nom affiché de l'en-tête From, ou "" (absent, ou qui contient « @ »). */
export function nomAffiche(from: string): string {
  const s = String(from ?? "");
  const { angle, pos, note } = lireFrom(s);
  const brut = angle !== null ? s.slice(0, pos) : note;
  const nom = brut.trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  return nom.includes("@") ? "" : nom;
}

const domaineDe = (v: string) => String(v ?? "").trim().toLowerCase().replace(/^.*@/, "").replace(/\.$/, "");

/** Adresse d'un robot de messagerie (mailer-daemon@, postmaster@). */
export function estRobot(adresse: string): boolean {
  return /^(mailer-daemon|postmaster)@/.test(String(adresse ?? "").trim().toLowerCase());
}

/** Format des avis de non-remise (RFC 3464) : multipart/report avec report-type=delivery-status. */
export function formatAvis(contentType: string | undefined): boolean {
  const ct = String(contentType ?? "").toLowerCase().replace(/\s+/g, " ");
  return /^\s*multipart\/report\s*(;|$)/.test(ct) && /;\s*report-type\s*=\s*"?delivery-status"?\s*(;|$)/.test(ct);
}

// ── Authentication-Results (RFC 8601) ────────────────────────────────────────

/** Serveur qui pose l'en-tête Authentication-Results des boîtes Gmail et Google Workspace. */
export const SERVEUR_GOOGLE = "mx.google.com";

/** Le texte sans ses commentaires (…) ; ce qui est entre guillemets est gardé. */
function sansCommentaires(s: string): string {
  let out = "";
  let profondeur = 0;
  let guillemets = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (guillemets) {
      out += c;
      if (c === "\\" && i + 1 < s.length) out += s[++i];
      else if (c === '"') guillemets = false;
      continue;
    }
    if (profondeur > 0) {
      if (c === "\\") i++;
      else if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
      continue;
    }
    if (c === "(") {
      profondeur = 1;
      out += " ";
      continue;
    }
    if (c === '"') guillemets = true;
    out += c;
  }
  return out;
}

/** Morceaux séparés par `sep` hors guillemets (guillemets retirés si `sansGuillemets`). */
function morceaux(s: string, sep: (c: string) => boolean, sansGuillemets = false): string[] {
  const out: string[] = [];
  let cur = "";
  let guillemets = false;
  for (const c of s) {
    if (c === '"') {
      guillemets = !guillemets;
      if (sansGuillemets) continue;
    }
    if (!guillemets && sep(c)) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export type ResultatAuth = { methode: string; resultat: string; props: Record<string, string> };

/** Un en-tête Authentication-Results : le serveur qui l'a posé, puis chaque « méthode=résultat » et ses propriétés. */
export function lireAuthentification(valeur: string): { serveur: string; resultats: ResultatAuth[] } {
  const parts = morceaux(sansCommentaires(String(valeur ?? "")), (c) => c === ";").map((p) => p.trim());
  const mots = (p: string) => morceaux(p.replace(/\s*=\s*/g, "="), (c) => /\s/.test(c), true).filter(Boolean);
  const serveur = (mots(parts[0] ?? "")[0] ?? "").toLowerCase();
  const resultats: ResultatAuth[] = [];
  for (const p of parts.slice(1)) {
    const [tete, ...reste] = mots(p);
    const m = /^([a-z0-9_-]+)=([a-z0-9_-]+)$/i.exec(tete ?? "");
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const w of reste) {
      const k = /^([a-z0-9_-]+\.[a-z0-9_.-]+)=(.+)$/i.exec(w);
      if (k) props[k[1].toLowerCase()] = k[2].toLowerCase();
    }
    resultats.push({ methode: m[1].toLowerCase(), resultat: m[2].toLowerCase(), props });
  }
  return { serveur, resultats };
}

/**
 * L'en-tête Authentication-Results posé par Google, parmi ceux du mail dans leur ordre : le
 * premier de son serveur (Google ajoute le sien au-dessus de ceux que le mail portait déjà). "" sinon.
 */
export function authentificationGoogle(valeurs: readonly string[]): string {
  return valeurs.find((v) => lireAuthentification(v).serveur === SERVEUR_GOOGLE) ?? "";
}

/** Deux domaines de la même organisation : égaux, ou l'un sous l'autre (alignement souple de DMARC). */
function aligne(a: string, b: string): boolean {
  if (!a || !b || !a.includes(".") || !b.includes(".")) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * L'expéditeur `adresse` est-il authentifié par Google (`auth` : authentificationGoogle) ? DMARC
 * « pass » pour le domaine de l'adresse ; sans résultat DMARC (domaine sans règle DMARC, ou
 * « bestguesspass » : Google estime, le domaine n'a rien publié), un DKIM ou un SPF « pass »
 * aligné sur ce domaine. Un DMARC en échec ne se rattrape jamais.
 */
export function expediteurAuthentifie(auth: string | undefined, adresse: string): boolean {
  const a = String(adresse ?? "").trim().toLowerCase();
  const dom = a.includes("@") ? domaineDe(a) : "";
  if (!dom) return false;
  const { serveur, resultats } = lireAuthentification(auth ?? "");
  if (serveur !== SERVEUR_GOOGLE) return false;
  const dmarc = resultats.filter((r) => r.methode === "dmarc" && r.resultat !== "none" && r.resultat !== "bestguesspass");
  if (dmarc.length) return dmarc.every((r) => r.resultat === "pass") && dmarc.some((r) => r.props["header.from"] === dom);
  return resultats.some((r) => r.resultat === "pass" && (
    (r.methode === "dkim" && aligne(dom, domaineDe(r.props["header.d"] || r.props["header.i"] || ""))) ||
    (r.methode === "spf" && aligne(dom, domaineDe(r.props["smtp.mailfrom"] || "")))
  ));
}

// ── Avis de non-remise ───────────────────────────────────────────────────────

const GOOGLE = /@(googlemail|google)\.com$/;

/**
 * Le mail est-il un vrai avis de non-remise ? Adresse réelle d'un robot (estRobot), et format des
 * avis (formatAvis) ou, pour un avis de Google, l'en-tête X-Failed-Recipients (`failed`). Un avis
 * qui se dit de Google doit être signé par Google (`auth` : authentificationGoogle).
 */
export function estAvisDeNonRemise(m: { from: string; contentType?: string; failed?: string; auth?: string }): boolean {
  const adresse = adresseDe(m.from);
  if (!estRobot(adresse)) return false;
  const google = GOOGLE.test(adresse);
  if (google && !expediteurAuthentifie(m.auth, adresse)) return false;
  if (formatAvis(m.contentType)) return true;
  return google && !!String(m.failed ?? "").trim();
}

// ── Journal des mails reçus (email_activity.source) ───────────────────────────

export const SOURCE_RECU = { rebond: "inbox-rebond", verifie: "inbox-verifie", douteux: "inbox-douteux" } as const;

/** Source notée au journal pour un mail reçu : avis de non-remise, expéditeur authentifié, ou douteux. */
export function sourceDuJournal(m: { avis: boolean; verifie: boolean }): string {
  return m.avis ? SOURCE_RECU.rebond : m.verifie ? SOURCE_RECU.verifie : SOURCE_RECU.douteux;
}

/**
 * Une ligne du journal peut-elle compter comme un rebond ? « avis » : avis vérifié par la relève ;
 * « ancienne » : ligne d'avant ce tri (« inbox », ou sans source), à juger sur l'adresse du robot ;
 * « non » : mail ordinaire, authentifié ou douteux.
 */
export function rebondDuJournal(source: unknown): "avis" | "ancienne" | "non" {
  const s = String(source ?? "");
  if (s === SOURCE_RECU.rebond) return "avis";
  if (s === SOURCE_RECU.verifie || s === SOURCE_RECU.douteux) return "non";
  return "ancienne";
}

/** Une ligne du journal montre-t-elle que l'adresse de l'expéditeur marche ? Ni avis de non-remise, ni expéditeur douteux. */
export function prouveAdresse(source: unknown): boolean {
  const s = String(source ?? "");
  return s !== SOURCE_RECU.rebond && s !== SOURCE_RECU.douteux;
}

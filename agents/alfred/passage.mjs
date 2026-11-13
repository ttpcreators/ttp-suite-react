// Le bilan d'un passage de Claude (claude -p --output-format json) : réussi ou raté, et pourquoi.
// Alfred s'en sert pour réessayer tout seul, attendre la fin d'une limite de l'abonnement Claude, et
// dire à Marc la vraie raison d'un échec au lieu d'un message vague. Aucun secret ici.
//   node passage.mjs bilan <sortie.json> [code]   une ligne « type<TAB>raison » pour le journal
//   node passage.mjs texte <sortie.json>          le dernier texte de Claude (réponse sans fichier)
//   node passage.mjs echec <sortie.json> <mode> <origine> [code] [partiel]
//                                                 remet les messages de Marc en file si besoin, note
//                                                 la reprise (etat/reprise.json), écrit le message pour Marc
//   node passage.mjs attente <mode> <origine>     code 3 (et le message pour Marc) si la limite court encore
//   node passage.mjs reussi                       le passage a marché : plus de reprise prévue
// <origine> : « marc » (il vient d'écrire), « auto » (launchd, toutes les heures) ou « reprise »
// (l'écoute relance une réponse remise à plus tard).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MINUTE = 60_000;
/** Après un échec passager (Claude surchargé, coupure) : deux reprises toutes seules, 10 minutes plus tard. */
const ESSAIS_MAX = 2;
const PAUSE_ESSAI = 10 * MINUTE;
/** Limite atteinte sans heure de reprise lisible : on réessaie un quart d'heure plus tard. */
const PAUSE_LIMITE = 15 * MINUTE;
/** Connexion perdue : on réessaie toutes les heures, sans redire à Marc ce qu'il sait déjà. */
const PAUSE_CONNEXION = 60 * MINUTE;
const REPONSE = "la réponse à Marc";
/** La veille de 11 h, 13 h et 15 h : silencieuse si elle ne peut pas se faire. */
export const VEILLE = "la veille";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const court = (s, max = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** L'heure où la limite repart, lue dans le message de Claude (« …|1731430800 », « resets 3pm »,
 * « resets 14:00 », « resets in 2 hours »), en millisecondes ; null si on ne la trouve pas. */
export function heureReprise(texte, maintenant = Date.now()) {
  const s = String(texte ?? "");
  const epoch = s.match(/\|(\d{10}|\d{13})\b/);
  if (epoch) {
    const n = Number(epoch[1]);
    return n < 1e12 ? n * 1000 : n;
  }
  const dans = s.match(/resets?\s+in\s+(\d+)\s*(h|hours?|m|min|minutes?)\b/i);
  if (dans) return maintenant + Number(dans[1]) * (/^h/i.test(dans[2]) ? 60 : 1) * MINUTE;
  const m = s.match(/resets?\s+(?:at\s+)?(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date(maintenant);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= maintenant) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Lit la sortie JSON de `claude -p --output-format json`.
 * type : ok, limite (abonnement), connexion (/login), surcharge (passager), tours (trop d'étapes), autre. */
export function lireSortie(brut, { code = 0, maintenant = Date.now() } = {}) {
  const s = String(brut ?? "").trim();
  let j = null;
  for (const ligne of s.split("\n").reverse()) {
    try {
      const o = JSON.parse(ligne);
      if (o && o.type === "result") {
        j = o;
        break;
      }
    } catch {
      // ligne qui n'est pas du JSON : on passe à la précédente
    }
  }
  if (!j) return { type: "autre", fin: null, raison: s ? court(s) : `Claude s'est arrêté sans rien dire, code ${code}`, texte: "" };
  const texte = typeof j.result === "string" ? j.result.trim() : "";
  if (j.subtype === "success" && !j.is_error) return { type: "ok", fin: null, raison: "", texte };
  const message = [texte, ...(Array.isArray(j.errors) ? j.errors : [])].filter(Boolean).join(" · ");
  const statut = Number(j.api_error_status) || 0;
  const raison = court(message || j.terminal_reason || j.subtype || `code ${code}`);
  const sortie = (type, fin = null) => ({ type, fin, raison, texte });
  if (j.subtype === "error_max_turns" || j.terminal_reason === "max_turns") return sortie("tours");
  if (statut === 429 || /usage limit|limit reached|hit your .{0,20}limit|rate.?limit|out of (extra )?usage|resets?\s+(at|in)?\s*\d/i.test(message)) {
    return sortie("limite", heureReprise(message, maintenant));
  }
  if (statut === 401 || statut === 403 || /\/login|not logged in|log in again|authenticat|oauth|credential|token.{0,20}(expired|revoked|invalid)|unauthori[sz]ed/i.test(message)) {
    return sortie("connexion");
  }
  if (statut >= 500 || /overloaded|\b529\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket hang up|timed? ?out|internal server error|service unavailable|bad gateway/i.test(message)) {
    return sortie("surcharge");
  }
  return sortie("autre");
}

/** « 14 h 05 », « demain à 9 h » ou « le 15 novembre à 9 h ». */
export function quand(ms, maintenant = Date.now()) {
  const d = new Date(ms);
  const n = new Date(maintenant);
  const h = `${d.getHours()} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, "0")}` : ""}`;
  if (d.toDateString() === n.toDateString()) return h;
  const demain = new Date(n);
  demain.setDate(n.getDate() + 1);
  if (d.toDateString() === demain.toDateString()) return `demain à ${h}`;
  return `le ${d.getDate()} ${MOIS[d.getMonth()]} à ${h}`;
}

/** La reprise prévue (etat/reprise.json) : { type: limite | connexion | essai, quand, fin, essais }. */
export function lireReprise(brut) {
  try {
    const r = JSON.parse(String(brut ?? ""));
    return r && typeof r.quand === "number" && ["limite", "connexion", "essai"].includes(r.type) ? r : null;
  } catch {
    return null;
  }
}

/** Que faire après un échec : garder les messages de Marc en file ? quand réessayer ? le dire à Marc ?
 * `avant` : la reprise déjà prévue (ou null) ; `origine` : marc, auto ou reprise. */
export function decider({ type, fin = null, avant = null, origine = "marc", mode = REPONSE, maintenant = Date.now() }) {
  // Une vieille reprise d'un échec passager ne compte plus.
  if (avant?.type === "essai" && maintenant - avant.quand > 2 * PAUSE_CONNEXION) avant = null;
  let garder = true;
  let prochaine = null;
  if (type === "limite") {
    const connue = typeof fin === "number" && fin > maintenant;
    prochaine = { type: "limite", quand: connue ? fin + MINUTE : maintenant + PAUSE_LIMITE, fin: connue ? fin : null, essais: 0 };
  } else if (type === "connexion") {
    prochaine = { type: "connexion", quand: maintenant + PAUSE_CONNEXION, fin: null, essais: 0 };
  } else if (type === "tours") {
    // Refaire la même demande finirait pareil : Marc la redit autrement.
    garder = false;
  } else {
    const essais = (origine !== "marc" && avant?.type === "essai" ? avant.essais : 0) + 1;
    if (essais <= ESSAIS_MAX) prochaine = { type: "essai", quand: maintenant + PAUSE_ESSAI, fin: null, essais };
    else garder = false;
  }
  // Une réponse remise à plus tard qui échoue encore pour la même raison : Marc le sait déjà.
  const silencieux = mode === REPONSE && origine !== "marc" && !!prochaine && avant?.type === prochaine.type;
  return { garder, prochaine, silencieux };
}

const estPoint = (mode) => String(mode).startsWith("le point");
const relance = (mode, a) =>
  estPoint(mode) ? `Écris « POINT »${a ? ` à partir de ${a}` : " plus tard"} pour l'avoir.` : `Redemande-le-moi${a ? ` à partir de ${a}` : " plus tard"}.`;

/** Le message pour Marc après un passage raté (ou arrêté en route, `partiel`). */
export function messageEchec({ type, raison = "", mode = REPONSE, garder = false, prochaine = null, partiel = false, maintenant = Date.now() }) {
  const reponse = mode === REPONSE;
  const garde = reponse && garder;
  const fin = prochaine?.fin ? quand(prochaine.fin, maintenant) : "";
  if (partiel) {
    const pourquoi =
      type === "limite" ? ` : limite de ton abonnement Claude${fin ? `, jusqu'à ${fin}` : ""}` : type === "tours" ? " : trop d'étapes" : type === "connexion" ? " : plus connecté à Claude" : "";
    return `Je me suis arrêté avant la fin de ma réponse${pourquoi}. Redemande-moi ce qui manque.`;
  }
  // La veille ratée ne dérange pas Marc (la suivante ou le point la rattrape), sauf si Claude est déconnecté.
  if (mode === VEILLE && type !== "connexion") return "";
  const action = reponse ? "te répondre" : `faire ${mode}`;
  if (type === "limite") {
    const suite = garde ? ` Ton message est gardé : je te réponds tout seul ${fin ? "à ce moment-là" : "dès que ça repart"}.` : ` ${relance(mode, fin)}`;
    return `Limite de ton abonnement Claude atteinte : je ne peux pas ${action} ${fin ? `avant ${fin}` : "pour l'instant"}.${suite}`;
  }
  if (type === "connexion") {
    return `Je ne suis plus connecté à Claude sur l'iMac : ouvre le Terminal, tape claude puis /login.${garde ? " Ton message est gardé." : ""}`;
  }
  if (type === "tours") {
    return reponse
      ? "Ta demande m'a pris trop d'étapes et je me suis arrêté. Redis-la en plus court, ou en plusieurs fois."
      : `Je me suis arrêté avant la fin de ${mode} (trop d'étapes). ${relance(mode, "")}`;
  }
  const cause = type === "surcharge" ? "Claude ne répond pas en ce moment" : `Je n'ai pas pu ${action}`;
  const detail = raison ? ` (${raison})` : "";
  const suite = garde && prochaine ? ` Ton message est gardé : je réessaie tout seul à ${quand(prochaine.quand, maintenant)}.` : reponse ? " Réécris-moi dans un moment." : ` ${relance(mode, "")}`;
  return `${cause}, même après un nouvel essai${detail}.${suite}`;
}

/** Avant un passage : si la limite de l'abonnement court encore, le message pour Marc (chaîne vide :
 * rien à lui dire) ; null : le passage peut se faire. */
export function messageAttente({ reprise, mode = REPONSE, origine = "marc", maintenant = Date.now() }) {
  if (reprise?.type !== "limite" || reprise.quand <= maintenant) return null;
  const fin = reprise.fin ? quand(reprise.fin, maintenant) : "";
  if (mode === REPONSE) {
    if (origine !== "marc") return "";
    return `Toujours à la limite de ton abonnement Claude${fin ? `, jusqu'à ${fin}` : ""} : ton message est gardé, je te réponds tout seul ${fin ? "à ce moment-là" : "dès que ça repart"}.`;
  }
  if (mode === "la préparation des rendez-vous" || mode === VEILLE) return "";
  return `Pas de ${mode.replace(/^(le |la )/, "")} pour l'instant : limite de ton abonnement Claude${fin ? `, jusqu'à ${fin}` : ""}. ${relance(mode, fin)}`;
}

/** Pour l'écoute : la reprise prévue est arrivée à l'heure, et des messages de Marc attendent encore.
 * Rend le contenu du fichier (pour l'oublier si le passage n'y a pas touché), ou null. */
export function repriseDue(here, maintenant = Date.now()) {
  const fichier = join(here, "etat", "reprise.json");
  if (!existsSync(fichier)) return null;
  const brut = readFileSync(fichier, "utf8");
  const r = lireReprise(brut);
  if (!r || r.quand > maintenant) return null;
  const file = join(here, "etat", "file-recue.txt");
  if (!existsSync(file) || !readFileSync(file, "utf8").trim()) return null;
  return brut;
}

/** Le passage relancé n'a pas touché à la reprise (il n'a pas pu se faire) : on l'oublie, pour ne pas boucler. */
export function oublierRepriseSi(here, brut) {
  const fichier = join(here, "etat", "reprise.json");
  if (existsSync(fichier) && readFileSync(fichier, "utf8") === brut) rmSync(fichier, { force: true });
}

/** Les messages de Marc de ce passage repartent en tête de la file, pour le prochain passage. */
function remettreEnFile(here) {
  const recu = /^etat\/recu(-reponse)?\.txt$/.test(process.env.ALFRED_RECU ?? "") ? process.env.ALFRED_RECU : "etat/recu.txt";
  const ids = /^etat\/recu(-reponse)?-ids\.txt$/.test(process.env.ALFRED_RECU_IDS ?? "") ? process.env.ALFRED_RECU_IDS : "etat/recu-ids.txt";
  for (const [de, vers] of [
    [recu, "etat/file-recue.txt"],
    [ids, "etat/file-recue-ids.txt"],
  ]) {
    const source = join(here, de);
    const cible = join(here, vers);
    const contenu = existsSync(source) ? readFileSync(source, "utf8") : "";
    if (!contenu.trim()) continue;
    writeFileSync(cible, contenu + (existsSync(cible) ? readFileSync(cible, "utf8") : ""));
    writeFileSync(source, "");
  }
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const [cmd, ...args] = process.argv.slice(2);
  const fichierReprise = join(here, "etat", "reprise.json");
  const lire = (f) => (f && existsSync(f) ? readFileSync(f, "utf8") : "");
  const maintenant = Date.now();

  if (cmd === "bilan") {
    const r = lireSortie(lire(args[0]), { code: Number(args[1]) || 0, maintenant });
    return console.log(`${r.type}\t${r.raison.replace(/\t/g, " ")}`);
  }
  if (cmd === "texte") return process.stdout.write(lireSortie(lire(args[0])).texte);
  if (cmd === "reussi") return rmSync(fichierReprise, { force: true });
  if (cmd === "attente") {
    const [mode, origine] = args;
    const message = messageAttente({ reprise: lireReprise(lire(fichierReprise)), mode, origine, maintenant });
    if (message === null) return;
    remettreEnFile(here);
    if (message) console.log(message);
    process.exitCode = 3;
    return;
  }
  if (cmd === "echec") {
    const [sortie, mode, origine = "marc", code = "0", partiel] = args;
    let { type, fin, raison } = lireSortie(lire(sortie), { code: Number(code) || 0, maintenant });
    // Claude a fini sans rien déposer pour Marc : on le traite comme un échec passager.
    if (type === "ok") {
      type = "autre";
      raison = "Claude a fini sans rien écrire pour toi";
    }
    const d = decider({ type, fin, avant: lireReprise(lire(fichierReprise)), origine, mode, maintenant });
    // Arrêté en route : rien n'est remis en file, donc pas de nouvel essai à prévoir (la limite et la
    // connexion restent notées, pour ne pas relancer Claude pour rien).
    if (d.prochaine && !(partiel && d.prochaine.type === "essai")) writeFileSync(fichierReprise, JSON.stringify(d.prochaine));
    else rmSync(fichierReprise, { force: true });
    if (partiel) return console.log(messageEchec({ type, raison, mode, prochaine: d.prochaine, partiel: true, maintenant }));
    if (d.garder) remettreEnFile(here);
    if (!d.silencieux) console.log(messageEchec({ type, raison, mode, garder: d.garder, prochaine: d.prochaine, maintenant }));
    return;
  }
  throw new Error("Usage : node passage.mjs bilan|texte <sortie.json> | echec <sortie.json> <mode> <origine> [code] [partiel] | attente <mode> <origine> | reussi");
}

// pathToFileURL : marche aussi quand le chemin contient des espaces.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

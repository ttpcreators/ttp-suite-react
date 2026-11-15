// ============================================================================
// whatsapp.mjs : Alfred lit les discussions WhatsApp de Marc avec les créateurs.
//
// Source : la copie que WhatsApp Desktop garde sur le Mac (ChatStorage.sqlite). Le fichier
// est copié dans un dossier temporaire, lu, puis la copie est effacée : WhatsApp n'est
// jamais modifié, rien n'est envoyé, aucun compte n'est connecté à un robot.
//
// Confidentialité : seules les discussions de etat/whatsapp-autorises.txt (sur le Mac
// seulement, jamais dans le dépôt) peuvent être lues. Format, une ligne par discussion :
//   <identifiant WhatsApp> | <nom du créateur dans le roster>
// « chercher » ne renvoie que les discussions dont le nom contient les mots donnés.
//
//   node whatsapp.mjs chercher <mot> [mot…]       discussions dont le nom contient un des mots
//   node whatsapp.mjs liste                        les discussions autorisées et leur dernier message
//   node whatsapp.mjs lire <id ou nom> [--depuis AAAA-MM-JJ] [--max N] [--vocaux N]
//                                                 (vocaux transcrits : 10 par défaut, 30 pour « nouveaux » ;
//                                                  transcriptions gardées dans etat/whatsapp-vocaux/)
//   node whatsapp.mjs nouveaux --depuis "AAAA-MM-JJ HH:MM"
//   node whatsapp.mjs en-attente [--heures 12] [--jours 14]
//                                                 les discussions où l'autre attend une réponse de Marc
//   node whatsapp.mjs numero <id ou nom>          son numéro, pour le bouton « Ouvrir dans WhatsApp »
//   node whatsapp.mjs piece <n°>                   ouvre une pièce jointe (« [document … · pièce 123] ») :
//                                                 copiée dans etat/pieces/ pour être lue (PDF, photo, Word en texte)
//
// Envoi (choix de Marc le 2026-11-15 : Alfred envoie sur WhatsApp, seulement sur son « oui ») :
//   node whatsapp.mjs envoyer <id>                envoie le texte préparé etat/whatsapp-a-envoyer/<id>.txt,
//                                                 celui que Marc a vu sur Telegram (bouton « Envoyer »)
//   node whatsapp.mjs autoriser "<id WhatsApp>" "<Nom (créateur, marque, équipe)>"
//                                                 ajoute une discussion pro à la liste (après le « oui » de Marc)
// L'envoi passe par le pont WhatsApp de l'iMac (installer-whatsapp.sh, appareil lié, écoute
// seulement 127.0.0.1:8080). alfred.sh ne permet ces deux commandes que pendant un passage où Marc
// a écrit, et Alfred ne peut pas écrire lui même dans etat/whatsapp-a-envoyer/ : seul le texte
// déposé par telegram.mjs au moment où Marc l'a reçu peut partir, à un contact de la liste.
// ============================================================================

import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { separerNotes } from "./texte.mjs";

const BASE = join(homedir(), "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
const CONTACTS = join(BASE, "..", "ContactsV2.sqlite");
const LISTE = process.env.WA_LISTE || "etat/whatsapp-autorises.txt";
/** Les dates WhatsApp comptent les secondes depuis le 1er janvier 2001. */
const EPOQUE_APPLE = 978307200;
const JID = /^[0-9A-Za-z@._-]+$/;
const A_ENVOYER = "etat/whatsapp-a-envoyer";
const ENVOYES = "etat/whatsapp-envoyes";
const PONT = process.env.WA_PONT || "http://127.0.0.1:8080";
/** Un texte préparé part dans les 7 jours, ensuite il est trop vieux (Marc l'a peut être oublié). */
const VALIDITE_MS = 7 * 24 * 3600 * 1000;

// ── Logique pure (testée) ───────────────────────────────────────────────────

export const appleVersDate = (s) => new Date((Number(s) + EPOQUE_APPLE) * 1000);
export const dateVersApple = (d) => Math.floor(d.getTime() / 1000) - EPOQUE_APPLE;

/** « 2026-11-10 15:48 », à l'heure de Paris. */
export function heure(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** « 2026-11-10 » ou « 2026-11-10 09:00 » (heure du Mac) ; null si illisible. */
export function lireDate(s) {
  const m = String(s ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2] ?? "00"}:${m[3] ?? "00"}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const normaliser = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** La liste des discussions autorisées ; les lignes vides, les commentaires et les identifiants bizarres sont ignorés. */
export function lireListe(texte) {
  return String(texte ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [jid, ...nom] = l.split("|");
      return { jid: jid.trim(), nom: nom.join("|").trim() || jid.trim() };
    })
    .filter((x) => JID.test(x.jid));
}

/** Une entrée de la liste par son identifiant ou par le nom du créateur (sans accents ni majuscules). */
export function trouver(liste, cle) {
  const k = normaliser(cle).trim();
  if (!k) return null;
  return liste.find((x) => x.jid === cle.trim()) ?? liste.find((x) => normaliser(x.nom) === k) ?? liste.find((x) => normaliser(x.nom).includes(k)) ?? null;
}

/**
 * Le numéro (chiffres avec l'indicatif, pour wa.me) d'une discussion à deux : écrit dans son
 * identifiant (…@s.whatsapp.net), ou trouvé dans le carnet de WhatsApp pour un identifiant @lid.
 * null pour un groupe ou un numéro introuvable.
 */
export function numeroDe(jid, carnet = []) {
  const j = String(jid ?? "");
  if (!j || j.endsWith("@g.us")) return null;
  const chiffres = (s) => {
    const d = String(s ?? "").split("@")[0].replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? d : null;
  };
  if (j.endsWith("@s.whatsapp.net")) return chiffres(j);
  const c = carnet.find((x) => String(x.lid ?? "").split("@")[0] === j.split("@")[0]);
  return c ? chiffres(c.wa) ?? chiffres(c.tel) : null;
}

/** Vrai si le nom de la discussion contient un des mots (3 lettres au moins, pour ne jamais tout lister). */
export function correspond(nomDiscussion, mots) {
  const n = normaliser(nomDiscussion);
  return mots.map(normaliser).filter((m) => m.length >= 3).some((m) => n.includes(m));
}

const MEDIAS = { 1: "photo", 2: "vidéo", 3: "vocal", 4: "contact", 5: "position", 8: "document", 11: "gif", 15: "sticker" };

/** « 0:42 », « 12:05 » pour une durée en secondes. */
export const duree = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

/** Le texte à montrer pour un message, ou null pour un évènement système (appel, membre ajouté…). */
export function contenu(type, texte, titre, vocal = null) {
  const t = String(texte ?? "").trim();
  const n = Number(type);
  if (n === 14) return "[message supprimé]";
  if (n === 3 && vocal) {
    const tete = `[vocal${vocal.secondes ? ` ${duree(vocal.secondes)}` : ""}]`;
    return vocal.texte ? `${tete} « ${vocal.texte} »` : `${tete} (${vocal.raison ?? "pas transcrit"})`;
  }
  if (MEDIAS[n]) {
    const extra = n === 8 && titre ? ` : ${String(titre).trim()}` : "";
    return `[${MEDIAS[n]}${extra}]${t ? ` ${t}` : ""}`;
  }
  if (n === 0 || n === 7) return t || null;
  return null;
}

/** Photo, vidéo, document ou GIF : une pièce jointe qu'Alfred peut ouvrir avec « piece <n°> ». */
const PIECES = new Set([1, 2, 8, 11]);

/** Le repère d'une pièce jointe dans une ligne : « · pièce 123 », ou pourquoi elle ne s'ouvre pas. */
export function reperePiece(m) {
  if (!PIECES.has(Number(m.type)) || !m.id) return "";
  return m.fichier ? ` · pièce ${m.id}` : " · pas téléchargée sur ce Mac";
}

/** Une ligne lisible : « 2026-11-10 15:48 · Léna : texte ». */
export function ligne(m, auteur) {
  const c = contenu(m.type, m.texte, m.titre, m.vocal ?? null);
  if (c === null) return null;
  const avecPiece = c.replace(/^\[([^\]]*)\]/, (_t, dedans) => `[${dedans}${reperePiece(m)}]`);
  return `${heure(appleVersDate(m.date))} · ${auteur} : ${avecPiece.replace(/\s*\n\s*/g, " / ")}`;
}

/** Nom du fichier copié pour Alfred : « wa-123-brief.pdf » (rien qui sorte du dossier). */
export function nomPiece(id, chemin) {
  const base = String(chemin ?? "").split("/").pop().replace(/[^0-9A-Za-zÀ-ÿ._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return `wa-${id}-${base || "piece"}`;
}

/** « 5 h », « 1 j 4 h », « 6 j » : depuis combien de temps quelqu'un attend. */
export function attente(heures) {
  const h = Math.max(0, Math.floor(heures));
  if (h < 24) return `${h} h`;
  const j = Math.floor(h / 24);
  return j >= 3 || h % 24 === 0 ? `${j} j` : `${j} j ${h % 24} h`;
}

/**
 * La balle est dans le camp de Marc : le dernier vrai message de la discussion (hors évènements
 * système) vient de l'autre, depuis `heures` heures au moins. null sinon.
 */
export function balleChezMarc(rows, now, heures = 12) {
  const vrais = rows.filter((m) => contenu(m.type, m.texte, m.titre, m.vocal ?? null) !== null);
  const dernier = vrais[vrais.length - 1];
  if (!dernier || dernier.moi) return null;
  const h = (now.getTime() - appleVersDate(dernier.date).getTime()) / 3_600_000;
  return h >= heures ? { heures: h, dernier } : null;
}

// ── Accès à la copie WhatsApp ───────────────────────────────────────────────

// ── Envoi (logique pure, testée) ────────────────────────────────────────────

/** Identifiant d'un texte préparé (donné par telegram.mjs, porté par le bouton « Envoyer »). */
export const ID_ENVOI = /^[a-z0-9]{6,12}$/;

/**
 * Lit un texte préparé « Pour Léa sur WhatsApp · 33612345678 » + le message. Renvoie
 * { nom, numero, texte } ou { erreur }.
 */
export function lirePreparation(brut) {
  const [premiere = "", ...reste] = String(brut ?? "").replace(/\r\n/g, "\n").trim().split("\n");
  const m = /^Pour\s+(.+?)\s+sur\s+WhatsApp\s*(?:·\s*\+?([\d ]{8,20}))?\s*$/i.exec(premiere.trim());
  if (!m) return { erreur: "Première ligne illisible : « Pour Prénom sur WhatsApp · numéro »." };
  const numero = m[2] ? m[2].replace(/\D/g, "") : null;
  return { nom: m[1].trim(), numero: numero && numero.length >= 8 && numero.length <= 15 ? numero : null, texte: reste.join("\n").trim() };
}

/** La raison de ne pas envoyer ce texte, ou null s'il peut partir tel quel. */
export function refusEnvoi(texte) {
  const t = String(texte ?? "").trim();
  if (!t) return "Le message est vide.";
  if (t.length > 4000) return `Message trop long (${t.length} caractères, 4 000 au plus).`;
  if (/[—–]/.test(t)) return "Le message contient un tiret long : il ne part pas (règle de Marc).";
  const { texte: propre, notes, trous } = separerNotes(t);
  if (notes.length) return `Le message contient une note pour Marc (« ${notes[0]} ») : il ne part pas.`;
  if (trous.length) return `Le message a un trou à compléter (${trous.join(", ")}) : il ne part pas.`;
  if (propre !== t.replace(/\n{3,}/g, "\n\n")) return "Le message contient autre chose que le texte à envoyer.";
  return null;
}

/**
 * Le contact de la liste à qui envoyer : trouvé par son nom, et, si le texte préparé porte un
 * numéro, ce numéro doit être le sien. { entree } ou { erreur }.
 */
export function destinataire(liste, prep, numeroConnu = () => null) {
  const entree = trouver(liste, prep.nom);
  if (!entree) return { erreur: `« ${prep.nom} » n'est pas dans la liste WhatsApp autorisée : rien n'est envoyé.` };
  if (prep.numero) {
    const n = numeroConnu(entree);
    if (n && n !== prep.numero) return { erreur: `Le numéro du texte (${prep.numero}) n'est pas celui de ${entree.nom} : rien n'est envoyé.` };
  }
  return { entree };
}

/** Une ligne de la liste autorisée, ou null si l'identifiant ou le nom est invalide. */
export function ligneAutorisee(jid, nom) {
  const j = String(jid ?? "").trim();
  const n = String(nom ?? "").replace(/[|\n\r]/g, " ").trim().slice(0, 80);
  if (!/^[0-9A-Za-z._-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(j) || !n) return null;
  return `${j} | ${n}`;
}

function copier(base = BASE) {
  if (!existsSync(base)) throw new Error("WhatsApp Desktop n'a pas de discussions sur ce Mac (fichier introuvable). Il faut l'ouvrir et le relier au téléphone.");
  const dir = mkdtempSync(join(tmpdir(), "alfred-wa-"));
  try {
    for (const ext of ["", "-wal", "-shm"]) if (existsSync(base + ext)) copyFileSync(base + ext, join(dir, "c.sqlite" + ext));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    if (e.code === "EPERM" || e.code === "EACCES") throw new Error("macOS refuse l'accès aux discussions WhatsApp : donner l'« Accès complet au disque » à node (Réglages Système › Confidentialité et sécurité).");
    throw e;
  }
  return dir;
}

function requete(dir, sql) {
  const out = execFileSync("sqlite3", ["-json", join(dir, "c.sqlite"), sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}

function avecBase(fn, base = BASE) {
  const dir = copier(base);
  try {
    return fn((sql) => requete(dir, sql));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const listeAutorisee = () => lireListe(existsSync(LISTE) ? readFileSync(LISTE, "utf8") : "");

// ── Les vocaux : transcrits sur le Mac (ffmpeg + whisper.cpp, gratuits, sans internet) ───────
const MEDIA_DIR = join(BASE, "..", "Message");
const VOCAUX = "etat/whatsapp-vocaux";
const MODELE = process.env.WHISPER_MODEL || join(homedir(), ".cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
const VOCAL_MAX = 10 * 60; // au delà de 10 minutes, on ne transcrit pas

/** Nom du fichier de cache d'un vocal (un par vocal, jamais retranscrit). */
export const cleVocal = (chemin) => String(chemin).replace(/[^0-9A-Za-z._-]+/g, "_").slice(-150) + ".txt";

function transcrire(chemin) {
  const source = join(MEDIA_DIR, chemin);
  if (!existsSync(source)) return { raison: "pas téléchargé sur ce Mac" };
  const dir = mkdtempSync(join(tmpdir(), "alfred-vocal-"));
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-ar", "16000", "-ac", "1", join(dir, "v.wav")], { timeout: 120_000, stdio: ["ignore", "ignore", "ignore"] });
    const out = execFileSync("whisper-cli", ["-m", MODELE, "-f", join(dir, "v.wav"), "-l", "auto", "-nt", "-np"], { encoding: "utf8", timeout: 300_000, maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const texte = out.replace(/\s+/g, " ").trim();
    return texte ? { texte } : { raison: "rien d'audible" };
  } catch {
    return { raison: "transcription ratée" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ajoute la transcription aux vocaux : depuis le cache, sinon transcrit, dans la limite du budget. */
function vocaux(rows, compteur) {
  // Les plus récents d'abord : ce sont eux qui comptent quand le budget est court.
  for (const m of [...rows].reverse()) {
    if (Number(m.type) !== 3) continue;
    m.vocal = { secondes: Number(m.duree) || 0 };
    if (!m.fichier) {
      m.vocal.raison = "pas téléchargé sur ce Mac";
      continue;
    }
    const cache = join(VOCAUX, cleVocal(m.fichier));
    if (existsSync(cache)) {
      m.vocal.texte = readFileSync(cache, "utf8").trim();
      continue;
    }
    if (m.vocal.secondes > VOCAL_MAX) {
      m.vocal.raison = "trop long pour être transcrit";
      continue;
    }
    if (compteur.reste <= 0) {
      m.vocal.raison = "pas encore transcrit, relance avec --vocaux";
      continue;
    }
    compteur.reste -= 1;
    const r = transcrire(m.fichier);
    Object.assign(m.vocal, r);
    if (r.texte) {
      mkdirSync(VOCAUX, { recursive: true });
      writeFileSync(cache, r.texte);
    }
  }
  return rows;
}

function messages(q, jid, depuis, max) {
  const apres = depuis ? `and m.ZMESSAGEDATE >= ${dateVersApple(depuis)}` : "";
  const rows = q(`select m.Z_PK as id, m.ZMESSAGEDATE as date, m.ZISFROMME as moi, m.ZMESSAGETYPE as type, m.ZTEXT as texte, i.ZTITLE as titre,
      i.ZMEDIALOCALPATH as fichier, i.ZMOVIEDURATION as duree,
      coalesce(g.ZCONTACTNAME, g.ZFIRSTNAME) as membre
    from ZWAMESSAGE m join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION
    left join ZWAMEDIAITEM i on i.Z_PK = m.ZMEDIAITEM
    left join ZWAGROUPMEMBER g on g.Z_PK = m.ZGROUPMEMBER
    where s.ZCONTACTJID = '${jid}' ${apres}
    order by m.ZMESSAGEDATE desc limit ${max}`);
  return rows.reverse();
}

function afficher(entree, rows) {
  return rows.map((m) => ligne(m, m.moi ? "Marc" : m.membre || entree.nom)).filter(Boolean);
}

function option(args, nom, defaut) {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "chercher") {
    if (!args.some((m) => normaliser(m).length >= 3)) throw new Error("Donne au moins un mot de 3 lettres (prénom ou nom du créateur).");
    const rows = avecBase((q) => q("select ZCONTACTJID as jid, ZPARTNERNAME as nom, ZSESSIONTYPE as type, ZLASTMESSAGEDATE as dernier from ZWACHATSESSION where ZSESSIONTYPE in (0, 1) and ZREMOVED = 0"));
    const trouves = rows.filter((r) => r.jid && correspond(r.nom, args)).slice(0, 15);
    console.log(trouves.length ? trouves.map((r) => `${r.jid} | ${r.nom}${r.type === 1 ? " (groupe)" : ""} · dernier message ${r.dernier ? heure(appleVersDate(r.dernier)) : "?"}`).join("\n") : "Aucune discussion ne porte ce nom.");
    return;
  }
  const liste = listeAutorisee();
  if (!liste.length) throw new Error(`Aucune discussion autorisée : ${LISTE} est vide. Propose d'abord la liste à Marc (voir « Les discussions WhatsApp »).`);
  if (mode === "liste") {
    const rows = avecBase((q) => q(`select ZCONTACTJID as jid, ZLASTMESSAGEDATE as dernier from ZWACHATSESSION where ZCONTACTJID in (${liste.map((x) => `'${x.jid}'`).join(",")})`));
    const der = Object.fromEntries(rows.map((r) => [r.jid, r.dernier]));
    console.log(liste.map((x) => `${x.nom} · ${x.jid} · dernier message ${der[x.jid] ? heure(appleVersDate(der[x.jid])) : "introuvable sur ce Mac"}`).join("\n"));
    return;
  }
  if (mode === "lire") {
    const cle = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--")).join(" ");
    const entree = trouver(liste, cle);
    if (!entree) throw new Error(`« ${cle} » n'est pas dans les discussions autorisées. Je ne lis que celles-là.`);
    const depuis = lireDate(option(args, "--depuis", ""));
    const max = Math.min(Math.max(Number(option(args, "--max", 200)) || 200, 1), 2000);
    const compteur = { reste: Math.min(Math.max(Number(option(args, "--vocaux", 10)) || 0, 0), 200) };
    const lignes = avecBase((q) => afficher(entree, vocaux(messages(q, entree.jid, depuis, max), compteur)));
    console.log([`# WhatsApp avec ${entree.nom} · ${lignes.length} message(s)`, ...lignes].join("\n"));
    return;
  }
  if (mode === "en-attente") {
    const heures = Math.max(Number(option(args, "--heures", 12)) || 12, 1);
    // Au delà de 14 jours, la discussion est retombée : on ne la remonte plus chaque matin.
    const jours = Math.max(Number(option(args, "--jours", 14)) || 14, 1);
    const compteur = { reste: 10 };
    const maintenant = new Date();
    const lignes = avecBase((q) =>
      liste
        .map((x) => ({ x, b: balleChezMarc(vocaux(messages(q, x.jid, null, 15), compteur), maintenant, heures) }))
        .filter((r) => r.b && r.b.heures <= jours * 24)
        .sort((a, b) => b.b.heures - a.b.heures)
        .map((r) => `${r.x.nom} · attend depuis ${attente(r.b.heures)} · ${ligne(r.b.dernier, r.b.dernier.membre || r.x.nom)}`),
    );
    console.log(lignes.length ? lignes.join("\n") : `Personne n'attend de réponse de Marc sur WhatsApp depuis plus de ${heures} h.`);
    return;
  }
  if (mode === "numero") {
    const cle = args.join(" ");
    const entree = trouver(liste, cle);
    if (!entree) throw new Error(`« ${cle} » n'est pas dans les discussions autorisées. Je ne lis que celles-là.`);
    if (entree.jid.endsWith("@g.us")) return console.log("Pas de numéro : c'est un groupe (pas de lien direct possible).");
    const lid = entree.jid.split("@")[0];
    const carnet = entree.jid.endsWith("@lid") && existsSync(CONTACTS)
      ? avecBase((q) => q(`select ZLID as lid, ZWHATSAPPID as wa, ZPHONENUMBER as tel from ZWAADDRESSBOOKCONTACT where ZLID like '${lid}%'`), CONTACTS)
      : [];
    console.log(numeroDe(entree.jid, carnet) ?? "Numéro introuvable dans le carnet WhatsApp de ce Mac.");
    return;
  }
  if (mode === "nouveaux") {
    const depuis = lireDate(option(args, "--depuis", ""));
    if (!depuis) throw new Error("Donne --depuis \"AAAA-MM-JJ HH:MM\" (l'heure du dernier point).");
    const compteur = { reste: 30 };
    const blocs = avecBase((q) =>
      liste
        .map((x) => ({ x, lignes: afficher(x, vocaux(messages(q, x.jid, depuis, 50), compteur)) }))
        .filter((b) => b.lignes.length)
        .map((b) => [`## ${b.x.nom}`, ...b.lignes].join("\n")),
    );
    console.log(blocs.length ? blocs.join("\n\n") : `Rien de nouveau sur WhatsApp depuis le ${heure(depuis)}.`);
    return;
  }
  if (mode === "piece") {
    const id = Number(args[0]);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Usage : node whatsapp.mjs piece <n° de la pièce> (le numéro « pièce 123 » d'une ligne)");
    const [p] = avecBase((q) => q(`select s.ZCONTACTJID as jid, m.ZMESSAGETYPE as type, i.ZMEDIALOCALPATH as fichier, i.ZTITLE as titre
      from ZWAMESSAGE m join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION left join ZWAMEDIAITEM i on i.Z_PK = m.ZMEDIAITEM where m.Z_PK = ${id}`));
    // Seulement une pièce d'une discussion autorisée : les autres restent fermées.
    if (!p || !liste.some((x) => x.jid === p.jid)) throw new Error(`Pièce ${id} introuvable dans les discussions autorisées.`);
    if (!PIECES.has(Number(p.type)) || !p.fichier) throw new Error(`Pièce ${id} : pas de fichier sur ce Mac (pas téléchargé par WhatsApp Desktop).`);
    const source = join(MEDIA_DIR, p.fichier);
    if (!existsSync(source)) throw new Error(`Pièce ${id} : fichier absent de ce Mac (ouvre-le une fois dans WhatsApp Desktop pour le télécharger).`);
    mkdirSync("etat/pieces", { recursive: true });
    const dest = join("etat/pieces", nomPiece(id, p.titre && /\.[a-z0-9]{2,5}$/i.test(p.titre) ? p.titre : p.fichier));
    copyFileSync(source, dest);
    // Un document Word (ou RTF, OpenDocument) : son texte à côté, lisible directement.
    if (/\.(docx?|rtf|odt|pages)$/i.test(dest)) {
      try {
        execFileSync("textutil", ["-convert", "txt", "-output", `${dest}.txt`, dest], { stdio: "ignore", timeout: 60_000 });
        return console.log(`Pièce copiée : ${dest} · son texte : ${dest}.txt`);
      } catch {
        return console.log(`Pièce copiée : ${dest} (texte illisible : demande-la en PDF)`);
      }
    }
    const nature = Number(p.type) === 2 ? " (vidéo : pour la regarder, demande à Marc de te la transférer sur Telegram)" : "";
    console.log(`Pièce copiée : ${dest}${nature}`);
    return;
  }
  throw new Error("Commandes : chercher <mot>, liste, lire <créateur> [--depuis AAAA-MM-JJ] [--max N] [--vocaux N], nouveaux --depuis \"AAAA-MM-JJ HH:MM\", en-attente [--heures N], numero <créateur>, piece <n°>, envoyer <id>, autoriser \"<id>\" \"<Nom>\".");
}

/** Le numéro (chiffres) d'une entrée de la liste, depuis son identifiant ou le carnet de WhatsApp Desktop. */
function numeroEntree(entree) {
  if (entree.jid.endsWith("@g.us")) return null;
  if (entree.jid.endsWith("@s.whatsapp.net")) return numeroDe(entree.jid);
  if (!existsSync(CONTACTS)) return null;
  const lid = entree.jid.split("@")[0];
  try {
    return numeroDe(entree.jid, avecBase((q) => q(`select ZLID as lid, ZWHATSAPPID as wa, ZPHONENUMBER as tel from ZWAADDRESSBOOKCONTACT where ZLID like '${lid}%'`), CONTACTS));
  } catch {
    return null;
  }
}

async function envoyer(id) {
  if (!ID_ENVOI.test(String(id ?? ""))) throw new Error("Usage : node whatsapp.mjs envoyer <id> (l'id du bouton « Envoyer », « oui whatsapp <id> »).");
  const fichier = join(A_ENVOYER, `${id}.txt`);
  if (!existsSync(fichier)) throw new Error(`Texte ${id} introuvable ou déjà envoyé (${ENVOYES}/).`);
  if (Date.now() - statSync(fichier).mtimeMs > VALIDITE_MS) throw new Error(`Texte ${id} préparé il y a plus de 7 jours : remontre le à Marc avant de l'envoyer.`);
  const prep = lirePreparation(readFileSync(fichier, "utf8"));
  if (prep.erreur) throw new Error(prep.erreur);
  const refus = refusEnvoi(prep.texte);
  if (refus) throw new Error(refus);
  const { entree, erreur } = destinataire(listeAutorisee(), prep, numeroEntree);
  if (erreur) throw new Error(erreur);
  const recipient = numeroEntree(entree) ?? entree.jid;
  let res;
  try {
    res = await fetch(`${PONT}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient, message: prep.texte }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Le pont WhatsApp de l'iMac ne répond pas : rien n'est parti. Marc doit le relancer (zsh installer-whatsapp.sh).");
  }
  const r = await res.json().catch(() => ({}));
  if (!res.ok || !r.success) throw new Error(`WhatsApp a refusé l'envoi : ${r.message ?? res.status}. Rien n'est parti.`);
  mkdirSync(ENVOYES, { recursive: true });
  renameSync(fichier, join(ENVOYES, `${id}.txt`));
  appendFileSync(join(ENVOYES, "journal.log"), `${heure(new Date())} · ${id} · ${entree.nom}\n`);
  console.log(`Envoyé sur WhatsApp à ${entree.nom} (${heure(new Date())}).`);
}

function autoriser(jid, nom) {
  const l = ligneAutorisee(jid, nom);
  if (!l) throw new Error("Usage : node whatsapp.mjs autoriser \"<id WhatsApp>\" \"<Nom (créateur, marque ou équipe)>\" (l'id donné par « chercher »).");
  if (listeAutorisee().some((x) => x.jid === l.split(" | ")[0])) return console.log("Déjà dans la liste.");
  appendFileSync(LISTE, `${existsSync(LISTE) && !readFileSync(LISTE, "utf8").endsWith("\n") && readFileSync(LISTE, "utf8") ? "\n" : ""}${l}\n`);
  console.log(`Ajouté à la liste : ${l}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === "envoyer") await envoyer(args[0]);
    else if (mode === "autoriser") autoriser(args[0], args.slice(1).join(" "));
    else main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

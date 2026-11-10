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
// ============================================================================

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = join(homedir(), "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
const LISTE = process.env.WA_LISTE || "etat/whatsapp-autorises.txt";
/** Les dates WhatsApp comptent les secondes depuis le 1er janvier 2001. */
const EPOQUE_APPLE = 978307200;
const JID = /^[0-9A-Za-z@._-]+$/;

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

/** Une ligne lisible : « 2026-11-10 15:48 · Léna : texte ». */
export function ligne(m, auteur) {
  const c = contenu(m.type, m.texte, m.titre, m.vocal ?? null);
  return c === null ? null : `${heure(appleVersDate(m.date))} · ${auteur} : ${c.replace(/\s*\n\s*/g, " / ")}`;
}

// ── Accès à la copie WhatsApp ───────────────────────────────────────────────

function copier() {
  if (!existsSync(BASE)) throw new Error("WhatsApp Desktop n'a pas de discussions sur ce Mac (fichier introuvable). Il faut l'ouvrir et le relier au téléphone.");
  const dir = mkdtempSync(join(tmpdir(), "alfred-wa-"));
  try {
    for (const ext of ["", "-wal", "-shm"]) if (existsSync(BASE + ext)) copyFileSync(BASE + ext, join(dir, "c.sqlite" + ext));
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

function avecBase(fn) {
  const dir = copier();
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
  const rows = q(`select m.ZMESSAGEDATE as date, m.ZISFROMME as moi, m.ZMESSAGETYPE as type, m.ZTEXT as texte, i.ZTITLE as titre,
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
  throw new Error("Commandes : chercher <mot>, liste, lire <créateur> [--depuis AAAA-MM-JJ] [--max N] [--vocaux N], nouveaux --depuis \"AAAA-MM-JJ HH:MM\".");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

#!/usr/bin/env node
// Telegram d'Alfred : SON propre bot (pas celui de Megan), et seulement avec Marc.
// Les vocaux de Marc sont transcrits sur le Mac (whisper.cpp, modèle WHISPER_MODEL de config.env,
// sinon ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin). Une vidéo (preview d'un créateur),
// une image ou un PDF est préparé dans etat/previews/ (images de la vidéo, transcription horodatée).
// Aucun secret ici : le jeton du bot (ALFRED_BOT_TOKEN) et l'identifiant de Marc
// (TELEGRAM_CHAT_ID) sont dans config.env, sur le Mac seulement.
//
//   node telegram.mjs dossier etat/envoi   envoie chaque fichier à Marc, dans l'ordre des noms
//   node telegram.mjs texte "…"            envoie un seul message simple (alerte du lanceur)
//   node telegram.mjs recevoir             range les nouveaux messages de Marc dans etat/file-recue.txt
//                                          et affiche leur nombre (0 : rien de nouveau)
//   node telegram.mjs ecoute               écoute en continu et lance alfred.sh --reponse dès que Marc écrit
//   node telegram.mjs telecharger <lien>   télécharge et découpe une vidéo (WeTransfer, SwissTransfer, Drive, Dropbox)
//   node telegram.mjs rappels              envoie les rappels arrivés à échéance (etat/rappels.md)
//
// Fichier « …-whatsapp.txt » ou « …-copier.txt » : 1re ligne = intitulé, la suite = texte à copier, mis dans un
// bloc de code (un toucher le copie sur Telegram). Les autres partent en texte simple.
// Tout autre fichier que .txt (contrat .html…) part en pièce jointe.
// Tout ce qui part et tout ce qui arrive est ajouté à etat/conversation.md (le fil).

import { execFile, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { appendFileSync, closeSync, createWriteStream, openSync, readSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const LIMIT = 4000; // Telegram plafonne à 4096 caractères par message.

export function readEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** MarkdownV2 : caractères à échapper hors bloc de code. */
export const escapeMd = (s) => s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
/** MarkdownV2 : dans un bloc de code, seuls \ et ` s'échappent. */
export const escapeCode = (s) => s.replace(/[\\`]/g, (c) => `\\${c}`);

/** Coupe un texte trop long sur des fins de ligne. */
export function chunks(text, limit = LIMIT) {
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && (cur + "\n" + line).length > limit) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line;
    while (cur.length > limit) {
      out.push(cur.slice(0, limit));
      cur = cur.slice(limit);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** HTML de Telegram : seuls &, < et > s'échappent. */
export const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Un lien seul sur sa ligne (« Ouvrir dans Spark : https://… ») : devient un bouton. */
const LIGNE_LIEN = /^\s*(Ouvrir dans [^:\n]{2,30}) : (https?:\/\/\S+)\s*$/;
/** Rubriques mises en gras toutes seules en début de ligne. */
const RUBRIQUE = /^(VIGILANCE|URGENT|ARGENT|À VALIDER|DANS L'APP|À VÉRIFIER|COUP D'AVANCE)\b/;
/** callback_data de Telegram : 64 octets au plus. */
const court = (s, max = 64) => {
  let out = String(s);
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
};

/** Sépare les lignes « Ouvrir dans … : lien » (boutons) du reste du texte. */
export function extraireLiens(text) {
  const liens = [];
  const reste = [];
  for (const l of text.split("\n")) {
    const m = LIGNE_LIEN.exec(l);
    if (m) liens.push({ text: m[1].trim(), url: m[2] });
    else reste.push(l);
  }
  return { liens, texte: reste.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/**
 * Mise en forme légère d'Alfred → HTML de Telegram : **gras**, rubriques en gras, lignes « > » en
 * citation (repliable au delà de 6 lignes), [texte](lien), et les longues adresses raccourcies.
 */
export function enHtml(text) {
  const lignes = text.split("\n");
  const out = [];
  let cite = [];
  const fermer = () => {
    if (!cite.length) return;
    out.push(`<blockquote${cite.length > 6 ? " expandable" : ""}>${cite.join("\n")}</blockquote>`);
    cite = [];
  };
  const enLigne = (l) =>
    escapeHtml(l)
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, "%22")}">${t}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<]{50,})/g, (_, a, u) => `${a}<a href="${u.replace(/"/g, "%22")}">lien</a>`)
      .replace(RUBRIQUE, "<b>$1</b>");
  for (const l of lignes) {
    if (/^>\s?/.test(l)) {
      cite.push(enLigne(l.replace(/^>\s?/, "")));
      continue;
    }
    fermer();
    out.push(enLigne(l));
  }
  fermer();
  return out.join("\n");
}

const boutonsLiens = (liens) => liens.map((l) => ({ text: l.text, url: l.url }));

/**
 * Un mail à valider (…-mail.txt) : titre en gras, le texte du mail en citation repliable,
 * « À vérifier » en gras, et les boutons Envoyer (vaut « oui Marque ») et Ouvrir dans Spark.
 * Pas de « oui Marque » sur la 1re ligne (brouillon dans la boîte d'un créateur) : pas de bouton Envoyer.
 */
export function messageMail(text) {
  const { liens, texte } = extraireLiens(text);
  const [premiere, ...suite] = texte.split("\n");
  const oui = /«\s*(oui [^»]+?)\s*»/i.exec(premiere)?.[1];
  const titre = premiere.split(" · ")[0].trim();
  const meta = /^À\s*:/.test(suite[0] ?? "") ? suite.shift().trim() : "";
  const corps = [];
  const verifier = [];
  for (const l of suite) (/^À VÉRIFIER/i.test(l.trim()) ? verifier : corps).push(l);
  const mail = corps.join("\n").trim();
  const html = [
    `<b>${escapeHtml(titre)}</b>${meta ? `\n${escapeHtml(meta)}` : ""}`,
    mail ? `<blockquote${mail.split("\n").length > 6 ? " expandable" : ""}>${escapeHtml(mail)}</blockquote>` : null,
    ...verifier.map((v) => escapeHtml(v.trim()).replace(/^À VÉRIFIER/i, "<b>À vérifier</b>")),
  ]
    .filter(Boolean)
    .join("\n\n");
  const ligne = [...(oui ? [{ text: "Envoyer", callback_data: court(oui) }] : []), ...boutonsLiens(liens)];
  return { text: html, html: true, plain: text, ...(ligne.length ? { boutons: [ligne] } : {}) };
}

/** Messages à envoyer pour un fichier déposé par Alfred. */
export function messagesFor(name, content) {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (name.endsWith("-whatsapp.txt") || name.endsWith("-copier.txt")) {
    const [label, ...rest] = text.split("\n");
    const body = rest.join("\n").trim();
    if (body && body.length < LIMIT - 200) {
      return [{ text: `${escapeMd(label.trim())}\n\`\`\`\n${escapeCode(body)}\n\`\`\``, md: true, plain: `${label.trim()}\n\n${body}` }];
    }
  }
  if (name.endsWith("-mail.txt") && text.length < LIMIT - 300) return [messageMail(text)];
  // Le reste (résumé, alerte) : mise en forme légère quand il tient en un message, sinon texte simple.
  if (text.length < LIMIT - 300) {
    const { liens, texte } = extraireLiens(text);
    return [{ text: enHtml(texte), html: true, plain: text, ...(liens.length ? { boutons: [boutonsLiens(liens)] } : {}) }];
  }
  return chunks(text).map((t) => ({ text: t, md: false }));
}

/**
 * Toucher sur un bouton « Envoyer » de Marc : devient un message « oui Marque » (le même effet que
 * s'il l'avait tapé), avec le message du mail en contexte. null pour tout autre toucher.
 */
export function toucherDeMarc(u, marcId) {
  const c = u?.callback_query;
  if (!c || String(c.from?.id) !== String(marcId) || !/^oui /i.test(String(c.data ?? ""))) return null;
  const vu = String(c.message?.text ?? "").replace(/\s+/g, " ").trim();
  return {
    id: Number(c.message?.message_id) || null,
    at: new Date(),
    text: `${c.data} (bouton Envoyer)`,
    reply: vu ? `(en réponse à ton message : « ${vu.length > 600 ? `${vu.slice(0, 600)}…` : vu} »)` : null,
    toucher: { id: c.id, chat: c.message?.chat?.id, message: c.message?.message_id, clavier: c.message?.reply_markup?.inline_keyboard ?? [] },
  };
}

/**
 * Messages reçus à garder : seulement ceux de Marc (son identifiant), en privé, avec du texte
 * ou un vocal (`voice` : son identifiant de fichier Telegram, transcrit ensuite).
 * Renvoie aussi le prochain « offset » pour ne jamais relire deux fois les mêmes.
 */
export function marcMessages(updates, marcId, offset = 0) {
  let next = offset;
  const kept = [];
  for (const u of updates ?? []) {
    next = Math.max(next, Number(u.update_id) + 1);
    const t = toucherDeMarc(u, marcId);
    if (t) {
      kept.push(t);
      continue;
    }
    const m = u.message ?? u.edited_message;
    if (!m || String(m.from?.id) !== String(marcId) || m.chat?.type !== "private") continue;
    const voice = m.voice?.file_id ?? m.audio?.file_id ?? null;
    const media = mediaOf(m);
    const text = String(m.text ?? m.caption ?? "").trim();
    if ((!text && !voice && !media) || text === "/start") continue;
    // « Répondre » sur un message : on garde le passage cité (ou tout le message) pour le contexte.
    const cited = m.reply_to_message;
    const quoted = String(m.quote?.text ?? cited?.text ?? cited?.caption ?? "").replace(/\s+/g, " ").trim();
    const reply = cited
      ? `(en réponse à ${cited.from?.is_bot ? "ton message" : "son propre message"}${quoted ? ` : « ${quoted.length > 600 ? `${quoted.slice(0, 600)}…` : quoted} »` : ""})`
      : null;
    kept.push({ id: Number(m.message_id) || null, at: new Date(Number(m.date) * 1000), text, ...(voice ? { voice } : {}), ...(media ? { media } : {}), ...(reply ? { reply } : {}) });
  }
  return { kept, next };
}

/**
 * Pièce jointe à analyser (preview d'un créateur, capture, contrat) : vidéo, note vidéo, GIF,
 * photo (la plus grande) ou document vidéo, image, PDF ou Word. null sinon.
 */
const WORD_EXT = /\.(docx?|odt|rtf)$/i;
export function mediaOf(m) {
  const v = m.video ?? m.video_note ?? m.animation;
  if (v?.file_id) return { fileId: v.file_id, kind: "video", name: v.file_name ?? "video.mp4", size: Number(v.file_size ?? 0) };
  if (Array.isArray(m.photo) && m.photo.length) {
    const p = m.photo[m.photo.length - 1];
    return { fileId: p.file_id, kind: "image", name: "image.jpg", size: Number(p.file_size ?? 0) };
  }
  const d = m.document;
  const mime = String(d?.mime_type ?? "");
  if (d?.file_id && /^(video\/|image\/|application\/pdf)/.test(mime)) {
    return { fileId: d.file_id, kind: mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "pdf", name: d.file_name ?? "fichier", size: Number(d.file_size ?? 0) };
  }
  // Contrat ou document Word (ou OpenDocument, RTF) : converti en texte sur le Mac (textutil).
  if (d?.file_id && (/(msword|wordprocessingml|opendocument\.text|rtf)/.test(mime) || WORD_EXT.test(String(d.file_name ?? "")))) {
    return { fileId: d.file_id, kind: "doc", name: d.file_name ?? "document.docx", size: Number(d.file_size ?? 0) };
  }
  return null;
}

/**
 * Instants (en secondes) des images à extraire d'une vidéo, pour la voir quasiment en entier :
 * l'accroche toutes les demi-secondes (3 premières secondes), puis une image par seconde
 * jusqu'à 90 s ; au delà, environ 60 images réparties sur toute la durée.
 */
export function frameTimes(duration) {
  const d = Math.max(0, Number(duration) || 0);
  const hook = [0, 0.5, 1, 1.5, 2, 2.5].filter((t) => t < d);
  const step = d <= 90 ? 1 : Math.ceil(d / 60);
  const rest = [];
  for (let t = 3; t < d - 0.3; t += step) rest.push(t);
  if (d > 3 && (rest.length === 0 || d - 0.5 - rest[rest.length - 1] > 0.4)) rest.push(Math.max(0, Math.round((d - 0.5) * 10) / 10));
  return [...hook, ...rest];
}

/**
 * Rappels d'Alfred (etat/rappels.md), une ligne par rappel :
 *   - [ ] 2026-11-12 15:00 · Appeler Lorna (Seoni) pour le contrat
 * Ceux dont l'heure est passée partent à Marc et passent en « - [x] ». Heure de Paris.
 */
export function dueReminders(text, now = new Date()) {
  const paris = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(now).replace(" ", "T");
  const due = [];
  const lines = text.split("\n").map((line) => {
    const m = /^\s*-\s*\[ \]\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\s*[·:-]?\s*(.+)$/.exec(line);
    if (!m) return line;
    const at = `${m[1]}T${(m[2] ?? "09").padStart(2, "0")}:${m[3] ?? "00"}`;
    if (at > paris) return line;
    due.push(m[4].trim());
    return line.replace("[ ]", "[x]");
  });
  return { due, text: lines.join("\n") };
}

const stamp = (d = new Date()) =>
  d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function api(token, method, body) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

/**
 * Vocal de Marc → texte, sur le Mac (whisper.cpp, gratuit, sans internet) : téléchargé depuis
 * Telegram, converti en WAV 16 kHz par ffmpeg, transcrit en français. null si ça échoue.
 */
async function transcrire(token, fileId, model) {
  const run = promisify(execFile);
  try {
    const f = await api(token, "getFile", { file_id: fileId });
    if (!f.ok) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`);
    if (!res.ok) return null;
    const base = join(tmpdir(), `alfred-vocal-${Date.now()}`);
    writeFileSync(`${base}.oga`, Buffer.from(await res.arrayBuffer()));
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", `${base}.oga`, "-ar", "16000", "-ac", "1", `${base}.wav`]);
    const { stdout } = await run("whisper-cli", ["-m", model, "-f", `${base}.wav`, "-l", "fr", "-nt", "-np"], { maxBuffer: 10 * 1024 * 1024 });
    for (const ext of ["oga", "wav"]) rmSync(`${base}.${ext}`, { force: true });
    const text = stdout.replace(/\s+/g, " ").trim();
    return text || null;
  } catch {
    return null;
  }
}

const TELEGRAM_MAX = 20 * 1024 * 1024; // un bot ne peut pas télécharger plus de 20 Mo
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}${t % 1 ? `.${Math.round((t % 1) * 10)}` : ""}`;

/**
 * Prépare une pièce jointe pour qu'Alfred l'analyse, dans `dir` (etat/previews/…) :
 * vidéo → images (accroche de près puis toute la vidéo, nommées par leur instant) et
 * transcription horodatée (whisper) ; image ou PDF → enregistré tel quel. Renvoie une
 * ligne qui dit ce qui est prêt, ou ce qui a coincé.
 */
async function preparerMedia(token, media, dir, model) {
  const run = promisify(execFile);
  if (media.size > TELEGRAM_MAX) return `fichier de ${Math.round(media.size / 1048576)} Mo, trop lourd pour Telegram (20 Mo au plus) : demande un lien ou une version plus légère`;
  try {
    const f = await api(token, "getFile", { file_id: media.fileId });
    if (!f.ok) return `fichier impossible à récupérer (${f.description ?? "Telegram"})`;
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`);
    if (!res.ok) return "fichier impossible à télécharger";
    mkdirSync(dir, { recursive: true });
    const ext = (String(f.result.file_path).match(/\.[a-z0-9]+$/i)?.[0] ?? String(media.name).match(/\.[a-z0-9]+$/i)?.[0] ?? (media.kind === "pdf" ? ".pdf" : media.kind === "image" ? ".jpg" : media.kind === "doc" ? ".docx" : ".mp4")).toLowerCase();
    const src = join(dir, `source${ext}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    if (media.kind === "doc") {
      const txt = join(dir, "texte.txt");
      const conv = await run("textutil", ["-convert", "txt", "-output", txt, src]).then(() => true, () => false);
      return conv ? `document Word « ${media.name} » enregistré : ${src}, son texte dans ${txt}` : `document Word « ${media.name} » enregistré (${src}) mais illisible : demande-le en PDF`;
    }
    if (media.kind !== "video") return `${media.kind === "pdf" ? "PDF" : "image"} enregistré : ${src}`;
    return await decouperVideo(src, dir, model);
  } catch (e) {
    return `préparation impossible (${e.message})`;
  }
}

/** Vidéo → images (accroche de près, puis toute la vidéo) et transcription horodatée, dans `dir`. */
export async function decouperVideo(src, dir, model) {
  const run = promisify(execFile);
  // Durée et format lus dans la sortie d'ffmpeg (ffprobe n'est pas toujours installé).
  const probe = await run("ffmpeg", ["-hide_banner", "-i", src]).catch((e) => e);
  const info = String(probe.stderr ?? "");
  const dm = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0;
  const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
  const imgDir = join(dir, "images");
  mkdirSync(imgDir, { recursive: true });
  let n = 0;
  for (const t of frameTimes(duration)) {
    const out = join(imgDir, `t${mmss(t).replace(":", "m").replace(".", "s")}.jpg`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", out]).then(() => n++, () => {});
  }
  // Ce qui est dit, horodaté.
  let parole = "pas de transcription";
  const wav = join(dir, "son.wav");
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vn", "-ar", "16000", "-ac", "1", wav]);
    const { stdout } = await run("whisper-cli", ["-m", model, "-f", wav, "-l", "auto", "-np"], { maxBuffer: 10 * 1024 * 1024 });
    const txt = stdout.trim();
    writeFileSync(join(dir, "transcription.txt"), txt ? `${txt}\n` : "(rien de parlé)\n");
    parole = txt ? "transcription horodatée dans transcription.txt" : "rien de parlé";
  } catch {
    parole = "pas de son ou transcription impossible";
  } finally {
    rmSync(wav, { force: true });
  }
  return `vidéo prête dans ${dir} : ${duration ? `${Math.round(duration)} s` : "durée inconnue"}${size ? `, ${size[1]}×${size[2]}` : ""}, ${n} images dans images/ (nommées par leur instant, l'accroche de près), ${parole}`;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const LIEN_MAX = 3 * 1024 * 1024 * 1024; // 3 Go au plus par vidéo

/** Premier lien de vidéo dans un texte : WeTransfer, SwissTransfer, Google Drive, Dropbox, ou lien direct vers un fichier vidéo. */
export function trouverLien(text) {
  for (const raw of String(text ?? "").match(/https?:\/\/[^\s<>"'»)]+/gi) ?? []) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    let h = "";
    try {
      h = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (/(^|\.)wetransfer\.com$|(^|\.)we\.tl$/.test(h)) return { kind: "wetransfer", url };
    if (/(^|\.)swisstransfer\.com$/.test(h)) return { kind: "swisstransfer", url };
    if (/^(drive|docs)\.google\.com$/.test(h)) return { kind: "drive", url };
    if (/(^|\.)dropbox\.com$/.test(h)) return { kind: "dropbox", url };
    if (VIDEO_EXT.test(new URL(url).pathname)) return { kind: "direct", url };
  }
  return null;
}

/** Lien Google Drive ou Dropbox → lien de téléchargement direct (sans appel réseau). */
export function lienSimple(kind, url) {
  if (kind === "drive") {
    const id = /\/d\/([\w-]{10,})/.exec(url)?.[1] ?? new URL(url).searchParams.get("id");
    return id ? `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` : null;
  }
  if (kind === "dropbox") {
    const u = new URL(url);
    u.searchParams.delete("dl");
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return url;
}

const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" };

/** Lien WeTransfer (y compris we.tl) → lien de téléchargement direct. */
async function lienWetransfer(url) {
  let full = url;
  if (/we\.tl$/i.test(new URL(url).hostname)) full = (await fetch(url, { headers: UA, redirect: "follow" })).url;
  const parts = new URL(full).pathname.split("/").filter(Boolean); // downloads/<transfert>/[<destinataire>/]<hash>
  const i = parts.indexOf("downloads");
  const p = i >= 0 ? parts.slice(i + 1) : [];
  if (p.length < 2) throw new Error("lien WeTransfer illisible");
  const [transferId, recipientId, hash] = p.length >= 3 ? p : [p[0], null, p[1]];
  // Session du site (cookies, et jeton anti-CSRF s'il y en a un).
  const home = await fetch("https://wetransfer.com/", { headers: UA });
  const cookies = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const csrf = /name="csrf-token" content="([^"]+)"/.exec(await home.text())?.[1];
  const res = await fetch(`https://wetransfer.com/api/v4/transfers/${transferId}/download`, {
    method: "POST",
    headers: { ...UA, "content-type": "application/json", "x-requested-with": "XMLHttpRequest", ...(cookies ? { cookie: cookies } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: JSON.stringify({ intent: "entire_transfer", security_hash: hash, ...(recipientId ? { recipient_id: recipientId } : {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.direct_link) throw new Error(`WeTransfer refuse le téléchargement (${j.message ?? j.error ?? res.status} : lien expiré ou protégé ?)`);
  return j.direct_link;
}

/** Lien SwissTransfer → lien direct de la plus grosse vidéo du transfert. */
async function lienSwisstransfer(url) {
  const linkId = /\/d\/([0-9a-f-]{20,})/i.exec(url)?.[1];
  if (!linkId) throw new Error("lien SwissTransfer illisible");
  const res = await fetch(`https://www.swisstransfer.com/api/links/${linkId}`, { headers: { ...UA, accept: "application/json" } });
  const j = await res.json().catch(() => ({}));
  const data = j.data ?? j;
  const files = data?.container?.files ?? data?.files ?? [];
  if (!files.length) throw new Error(`SwissTransfer ne donne pas les fichiers (${res.status} : lien expiré ou protégé par mot de passe ?)`);
  const size = (f) => Number(f.fileSizeInBytes ?? f.receivedSizeInBytes ?? f.size ?? 0);
  const videos = files.filter((f) => VIDEO_EXT.test(String(f.fileName ?? f.name ?? "")) || /^video\//.test(String(f.mimeType ?? "")));
  const f = (videos.length ? videos : files).sort((a, b) => size(b) - size(a))[0];
  const host = data.downloadHost ?? "dl.swisstransfer.com";
  return `https://${host}/api/download/${linkId}/${f.UUID ?? f.uuid}`;
}

/** Télécharge un fichier en flux (gros fichiers sans tout garder en mémoire). Renvoie le chemin. */
async function telechargerFlux(url, dir) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > LIEN_MAX) throw new Error(`fichier de ${Math.round(len / 1073741824)} Go, trop lourd`);
  const cd = res.headers.get("content-disposition") ?? "";
  const nom = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? new URL(res.url).pathname.split("/").pop() ?? "");
  const ext = (/\.[a-z0-9]{2,4}$/i.exec(nom)?.[0] ?? (/zip/.test(res.headers.get("content-type") ?? "") ? ".zip" : ".mp4")).toLowerCase();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `source${ext}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  return path;
}

/** Plus gros fichier vidéo d'un dossier (après un zip). */
function plusGrosseVideo(dir) {
  let best = null;
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else if (VIDEO_EXT.test(n.name) && !n.name.startsWith("._") && (!best || statSync(p).size > best.size)) best = { p, size: statSync(p).size };
    }
  };
  walk(dir);
  return best?.p ?? null;
}

/** Lien de vidéo (transfert, Drive, Dropbox, direct) → vidéo téléchargée et découpée dans `dir`. */
export async function telechargerVideo(lien, dir, model) {
  try {
    const direct = lien.kind === "wetransfer" ? await lienWetransfer(lien.url) : lien.kind === "swisstransfer" ? await lienSwisstransfer(lien.url) : lienSimple(lien.kind, lien.url);
    if (!direct) return `lien ${lien.kind} illisible`;
    let src = await telechargerFlux(direct, dir);
    // Un transfert de plusieurs fichiers arrive en zip : on prend la plus grosse vidéo.
    const head = Buffer.alloc(2);
    const fd = openSync(src, "r");
    readSync(fd, head, 0, 2, 0);
    closeSync(fd);
    if (src.endsWith(".zip") || head.toString() === "PK") {
      const out = join(dir, "zip");
      mkdirSync(out, { recursive: true });
      await promisify(execFile)("unzip", ["-o", "-q", src, "-d", out]);
      const v = plusGrosseVideo(out);
      if (!v) return `le transfert ne contient pas de vidéo (fichiers dans ${out})`;
      src = v;
    }
    return await decouperVideo(src, dir, model);
  } catch (e) {
    return `lien ${lien.kind} impossible à ouvrir : ${e.message}`;
  }
}

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
/** Arguments d'impression PDF d'un navigateur Chromium (anciens et nouveaux drapeaux : un drapeau inconnu est ignoré). */
export function pdfArgs(src, out) {
  return ["--headless", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", "--print-to-pdf-no-header", "--virtual-time-budget=5000", `--print-to-pdf=${out}`, `file://${src}`];
}
/**
 * Document HTML d'Alfred (proposition, bilan, contrat, fiche) → PDF, avec Chrome s'il est
 * installé sur le Mac. Renvoie le chemin du PDF, ou null (le HTML part alors tel quel).
 */
async function enPdf(src) {
  const nav = CHROME.find((c) => existsSync(c));
  if (!nav) return null;
  const out = src.replace(/\.html?$/i, ".pdf");
  const dir = join(tmpdir(), `alfred-pdf-${process.pid}`);
  try {
    await promisify(execFile)(nav, [`--user-data-dir=${dir}`, ...pdfArgs(src, out)], { timeout: 90_000 });
    return existsSync(out) && statSync(out).size > 1000 ? out : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Envoie un fichier à Marc (contrat rédigé, document), 50 Mo au plus. */
async function sendDocument(token, chatId, path, name, replyTo = null) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (replyTo) form.append("reply_parameters", JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
  form.append("document", new Blob([readFileSync(path)]), name);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form }).then((r) => r.json());
  if (!res.ok) throw new Error(`Telegram a refusé le document ${name} : ${res.description ?? "erreur inconnue"}`);
}

async function send(token, chatId, msg, replyTo = null) {
  const cite = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  const clavier = msg.boutons ? { reply_markup: { inline_keyboard: msg.boutons } } : {};
  const call = (body) => api(token, "sendMessage", { chat_id: chatId, disable_web_page_preview: true, ...cite, ...clavier, ...body });
  const mode = msg.md ? "MarkdownV2" : msg.html ? "HTML" : null;
  let res = await call(mode ? { text: msg.text, parse_mode: mode } : { text: msg.text });
  // Mise en forme refusée : on renvoie le même texte, sans mise en forme.
  if (!res.ok && mode) res = await call({ text: msg.plain });
  if (!res.ok) throw new Error(`Telegram a refusé le message : ${res.description ?? "erreur inconnue"}`);
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  const here = new URL(".", import.meta.url).pathname;
  const env = readEnv(join(here, "config.env"));
  const token = env.ALFRED_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Jeton du bot d'Alfred ou identifiant de Marc manquant dans config.env (./installer.sh --bot).");
  const fil = join(here, "etat/conversation.md");

  if (mode === "rappels") {
    const file = join(here, "etat/rappels.md");
    if (!existsSync(file)) return console.log(0);
    const { due, text } = dueReminders(readFileSync(file, "utf8"));
    for (const r of due) {
      await send(token, chatId, { text: `Rappel : ${r}`, md: false });
      appendFileSync(fil, `\n### ${stamp()} · Alfred\nRappel : ${r}\n`);
    }
    if (due.length) writeFileSync(file, text);
    console.log(due.length);
    return;
  }

  const offsetFile = join(here, "etat/telegram-offset");
  /** Range les nouveaux messages de Marc dans la file (etat/file-recue.txt) et le fil. */
  const ranger = async (timeout) => {
    const offset = Number(existsSync(offsetFile) ? readFileSync(offsetFile, "utf8") : 0) || 0;
    const res = await api(token, "getUpdates", { offset, timeout, allowed_updates: ["message", "edited_message", "callback_query"] });
    if (!res.ok) throw Object.assign(new Error(`Telegram : ${res.description ?? "lecture impossible"}`), { code: res.error_code });
    const { kept, next } = marcMessages(res.result, chatId, offset);
    // Bouton Envoyer touché : on le confirme et on le retire (un seul toucher par mail), les liens restent.
    for (const m of kept) {
      if (!m.toucher) continue;
      await api(token, "answerCallbackQuery", { callback_query_id: m.toucher.id, text: "C'est noté, Alfred s'en occupe." }).catch(() => {});
      const restants = m.toucher.clavier.map((l) => l.filter((b) => !b.callback_data)).filter((l) => l.length);
      if (m.toucher.chat && m.toucher.message) {
        await api(token, "editMessageReplyMarkup", { chat_id: m.toucher.chat, message_id: m.toucher.message, reply_markup: { inline_keyboard: restants } }).catch(() => {});
      }
    }
    const model = env.WHISPER_MODEL || join(homedir(), ".cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
    for (const m of kept) {
      if (!m.voice) continue;
      const dit = await transcrire(token, m.voice, model);
      m.text = dit ? `(vocal) ${dit}${m.text ? `\n${m.text}` : ""}` : `(vocal que je n'ai pas réussi à transcrire)${m.text ? `\n${m.text}` : ""}`;
    }
    for (const [i, m] of kept.entries()) {
      const lien = m.media ? null : trouverLien(m.text);
      if (!lien) continue;
      api(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
      const id = new Date(m.at).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      const prete = await telechargerVideo(lien, join(here, "etat", "previews", `${id}-lien${i}`), model);
      m.text = `(lien vidéo ${lien.kind} : ${prete.replace(join(here, ""), "")})\n${m.text}`;
    }
    for (const [i, m] of kept.entries()) {
      if (!m.media) continue;
      api(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
      const id = new Date(m.at).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      const dir = join("etat", "previews", `${id}-${i}`);
      const prete = await preparerMedia(token, m.media, join(here, dir), model);
      m.text = `(pièce jointe : ${m.media.name} · ${prete.replace(join(here, ""), "")})${m.text ? `\n${m.text}` : ""}`;
    }
    for (const m of kept) {
      const full = m.reply ? `${m.reply}\n${m.text}` : m.text;
      appendFileSync(join(here, "etat/file-recue.txt"), `[${stamp(m.at)}] ${full}\n\n`);
      // Pour qu'Alfred réponde en citant ce message (comme « Répondre » sur Telegram).
      if (m.id) appendFileSync(join(here, "etat/file-recue-ids.txt"), `${m.id}\n`);
      appendFileSync(fil, `\n### ${stamp(m.at)} · Marc\n${full}\n`);
    }
    // L'offset n'avance qu'une fois les messages rangés : rien ne se perd si on s'arrête avant.
    if (next !== offset) writeFileSync(offsetFile, String(next));
    return kept.length;
  };

  // Alfred lui même (lien de preview trouvé dans un mail) : node telegram.mjs telecharger <lien>
  if (mode === "telecharger") {
    const lien = trouverLien(arg ?? "");
    if (!lien) return console.log("Lien non reconnu : WeTransfer, SwissTransfer, Google Drive, Dropbox ou lien direct vers une vidéo.");
    const id = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const model = env.WHISPER_MODEL || join(homedir(), ".cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
    console.log((await telechargerVideo(lien, join(here, "etat", "previews", `${id}-mail`), model)).replace(join(here, ""), ""));
    return;
  }

  if (mode === "recevoir") {
    console.log(await ranger(0));
    return;
  }

  // Écoute en continu (launchd, com.ttp.alfred.ecoute) : dès que Marc écrit, Alfred répond.
  if (mode === "ecoute") {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (;;) {
      let n = 0;
      try {
        n = await ranger(50);
      } catch (e) {
        console.error(`${new Date().toISOString()} ${e.message}`);
        await sleep(e.code === 409 ? 30_000 : 5_000);
        continue;
      }
      if (!n) continue;
      // « Alfred est en train d'écrire… » pendant tout le passage.
      const typing = () => api(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
      typing();
      const tick = setInterval(typing, 4_000);
      await new Promise((resolve) => {
        const p = spawn("/bin/zsh", [join(here, "alfred.sh"), "--reponse"], { stdio: "ignore" });
        p.on("exit", resolve);
        p.on("error", resolve);
      });
      clearInterval(tick);
    }
  }


  let messages = [];
  if (mode === "texte") messages = messagesFor("alerte.txt", arg ?? "");
  else if (mode === "dossier") {
    const dir = arg ?? "etat/envoi";
    for (const name of readdirSync(dir).filter((n) => !n.startsWith(".")).sort()) {
      // Un .txt = un message ; tout autre fichier (contrat .html, document) part en pièce jointe.
      if (name.endsWith(".txt")) messages.push(...messagesFor(name, readFileSync(join(dir, name), "utf8")));
      else messages.push({ file: join(dir, name), name });
    }
  } else throw new Error("Usage : node telegram.mjs dossier <chemin> | texte <message> | recevoir | rappels | ecoute");
  // Réponse à Marc : le premier message cite son dernier message (comme « Répondre »).
  const ids = mode === "dossier" && existsSync(join(here, "etat/recu-ids.txt")) ? readFileSync(join(here, "etat/recu-ids.txt"), "utf8").split("\n").map(Number).filter(Boolean) : [];
  let replyTo = ids.length ? ids[ids.length - 1] : null;
  for (const m of messages) {
    if (m.file) {
      // Un document HTML part en PDF quand Chrome est là (plus simple à ouvrir et à transférer).
      const pdf = /\.html?$/i.test(m.name) ? await enPdf(m.file) : null;
      if (pdf) {
        m.file = pdf;
        m.name = m.name.replace(/\.html?$/i, ".pdf");
      }
      await sendDocument(token, chatId, m.file, m.name, replyTo);
      replyTo = null;
      appendFileSync(fil, `\n### ${stamp()} · Alfred\n(document envoyé : ${m.name})\n`);
      continue;
    }
    await send(token, chatId, m, replyTo);
    replyTo = null;
    appendFileSync(fil, `\n### ${stamp()} · Alfred\n${m.plain ?? m.text}\n`);
  }
  console.log(`${messages.length} message(s) envoyé(s) à Marc sur Telegram.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

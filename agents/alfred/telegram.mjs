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
//   node telegram.mjs rappels              envoie les rappels arrivés à échéance (etat/rappels.md)
//
// Fichier « …-whatsapp.txt » ou « …-copier.txt » : 1re ligne = intitulé, la suite = texte à copier, mis dans un
// bloc de code (un toucher le copie sur Telegram). Les autres partent en texte simple.
// Tout autre fichier que .txt (contrat .html…) part en pièce jointe.
// Tout ce qui part et tout ce qui arrive est ajouté à etat/conversation.md (le fil).

import { execFile, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  return chunks(text).map((t) => ({ text: t, md: false }));
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
    kept.push({ at: new Date(Number(m.date) * 1000), text, ...(voice ? { voice } : {}), ...(media ? { media } : {}), ...(reply ? { reply } : {}) });
  }
  return { kept, next };
}

/**
 * Pièce jointe à analyser (preview d'un créateur, capture, PDF) : vidéo, note vidéo, GIF,
 * photo (la plus grande) ou document vidéo, image ou PDF. null sinon.
 */
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
  return null;
}

/** Instants (en secondes) des images à extraire d'une vidéo : l'accroche de près, puis le reste. */
export function frameTimes(duration) {
  const d = Math.max(0, Number(duration) || 0);
  const hook = [0, 0.5, 1, 1.5, 2.5].filter((t) => t < d);
  const step = Math.max(2, Math.ceil(d / 16));
  const rest = [];
  for (let t = 4; t < d - 0.3; t += step) rest.push(t);
  if (d > 4) rest.push(Math.max(0, d - 0.5));
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
    const ext = (String(f.result.file_path).match(/\.[a-z0-9]+$/i)?.[0] ?? (media.kind === "pdf" ? ".pdf" : media.kind === "image" ? ".jpg" : ".mp4")).toLowerCase();
    const src = join(dir, `source${ext}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
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

/** Envoie un fichier à Marc (contrat rédigé, document), 50 Mo au plus. */
async function sendDocument(token, chatId, path, name) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([readFileSync(path)]), name);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form }).then((r) => r.json());
  if (!res.ok) throw new Error(`Telegram a refusé le document ${name} : ${res.description ?? "erreur inconnue"}`);
}

async function send(token, chatId, msg) {
  const call = (body) => api(token, "sendMessage", { chat_id: chatId, disable_web_page_preview: true, ...body });
  let res = await call(msg.md ? { text: msg.text, parse_mode: "MarkdownV2" } : { text: msg.text });
  // Mise en forme refusée : on renvoie le même texte, sans mise en forme.
  if (!res.ok && msg.md) res = await call({ text: msg.plain });
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
    const res = await api(token, "getUpdates", { offset, timeout, allowed_updates: ["message", "edited_message"] });
    if (!res.ok) throw Object.assign(new Error(`Telegram : ${res.description ?? "lecture impossible"}`), { code: res.error_code });
    const { kept, next } = marcMessages(res.result, chatId, offset);
    const model = env.WHISPER_MODEL || join(homedir(), ".cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
    for (const m of kept) {
      if (!m.voice) continue;
      const dit = await transcrire(token, m.voice, model);
      m.text = dit ? `(vocal) ${dit}${m.text ? `\n${m.text}` : ""}` : `(vocal que je n'ai pas réussi à transcrire)${m.text ? `\n${m.text}` : ""}`;
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
      appendFileSync(fil, `\n### ${stamp(m.at)} · Marc\n${full}\n`);
    }
    // L'offset n'avance qu'une fois les messages rangés : rien ne se perd si on s'arrête avant.
    if (next !== offset) writeFileSync(offsetFile, String(next));
    return kept.length;
  };

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
  for (const m of messages) {
    if (m.file) {
      await sendDocument(token, chatId, m.file, m.name);
      appendFileSync(fil, `\n### ${stamp()} · Alfred\n(document envoyé : ${m.name})\n`);
      continue;
    }
    await send(token, chatId, m);
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

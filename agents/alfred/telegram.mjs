#!/usr/bin/env node
// Telegram d'Alfred : SON propre bot (pas celui de Megan), et seulement avec Marc.
// Les vocaux de Marc sont transcrits sur le Mac (whisper.cpp, modèle WHISPER_MODEL de config.env,
// sinon ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin).
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
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    const text = String(m.text ?? m.caption ?? "").trim();
    if ((!text && !voice) || text === "/start") continue;
    // « Répondre » sur un message : on garde le passage cité (ou tout le message) pour le contexte.
    const cited = m.reply_to_message;
    const quoted = String(m.quote?.text ?? cited?.text ?? cited?.caption ?? "").replace(/\s+/g, " ").trim();
    const reply = cited
      ? `(en réponse à ${cited.from?.is_bot ? "ton message" : "son propre message"}${quoted ? ` : « ${quoted.length > 600 ? `${quoted.slice(0, 600)}…` : quoted} »` : ""})`
      : null;
    kept.push({ at: new Date(Number(m.date) * 1000), text, ...(voice ? { voice } : {}), ...(reply ? { reply } : {}) });
  }
  return { kept, next };
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

#!/usr/bin/env node
// Telegram d'Alfred : SON propre bot (pas celui de Megan), et seulement avec Marc.
// Les vocaux de Marc sont transcrits sur le Mac (whisper.cpp, modèle WHISPER_MODEL de config.env,
// sinon ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin). Une vidéo (preview d'un créateur),
// une image ou un PDF est préparé dans etat/previews/ (images de la vidéo, transcription horodatée).
// Aucun secret ici : le jeton du bot (ALFRED_BOT_TOKEN) et l'identifiant de Marc
// (TELEGRAM_CHAT_ID) sont dans config.env, sur le Mac seulement.
//
//   node telegram.mjs dossier etat/envoi   envoie chaque fichier à Marc, dans l'ordre des noms
//   node telegram.mjs suivre <dossier> <pid>  pendant une réponse rapide : envoie chaque fichier
//                                          dès qu'il est écrit (3 s sans changement), tant que Claude
//                                          (le processus <pid>) travaille ; le reste part avec « dossier »
//   node telegram.mjs texte "…"            envoie un seul message simple (alerte du lanceur)
//   node telegram.mjs recevoir             range les nouveaux messages de Marc dans etat/file-recue.txt
//                                          et affiche leur nombre (0 : rien de nouveau)
//   node telegram.mjs ecoute               écoute en continu et lance alfred.sh --reponse dès que Marc écrit
//   node telegram.mjs telecharger <lien>   télécharge et découpe une vidéo (WeTransfer, SwissTransfer, Drive, Dropbox)
//   node telegram.mjs rappels              envoie les rappels arrivés à échéance (etat/rappels.md)
//   node telegram.mjs raccourcis           met les raccourcis des créateurs (etat/raccourcis.txt) dans le menu « / »
//   node telegram.mjs clavier [--forcer]   envoie les boutons fixes du bas de l'écran (une fois par version)
//   node telegram.mjs deposer <etat/…>     dépose un fichier de l'iMac dans l'app, pour le joindre à un mail
//   node telegram.mjs joindre <id> [ordre] copie une pièce jointe d'un mail (Spark) dans le dossier
//                                          d'envoi du passage (ALFRED_ENVOI, sinon etat/envoi) :
//                                          elle part à Marc avec le prochain envoi, sous son nom d'origine
//
// Fichier « …-whatsapp.txt » ou « …-copier.txt » : 1re ligne = intitulé, la suite = texte à copier, mis dans un
// bloc de code (un toucher le copie sur Telegram). Les autres partent en texte simple.
// Tout autre fichier que .txt (contrat .html…) part en pièce jointe.
// Tout ce qui part et tout ce qui arrive est ajouté à etat/conversation.md (le fil).

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { appendFileSync, closeSync, copyFileSync, createWriteStream, openSync, readSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { pieceAutorisee } from "./spark.mjs";
import { oublierRepriseSi, repriseDue } from "./passage.mjs";
import { separerNotes } from "./texte.mjs";

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
/** « Détail : » seul sur sa ligne : la suite du message se replie. */
const DETAIL = /^\s*\**\s*détails?\s*\**\s*:?\s*\**\s*$/i;
/** callback_data de Telegram : 64 octets au plus. */
const court = (s, max = 64) => {
  let out = String(s);
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
};

/** Un bouton d'action seul sur sa ligne : « Bouton : Fait (Reverser Léna) = fait tâche d57b… ». */
const LIGNE_BOUTON = /^\s*Bouton\s*:\s*(.{1,40}?)\s*=\s*(.+?)\s*$/;

/**
 * Sépare du texte les lignes « Ouvrir dans … : lien » (boutons lien) et « Bouton : libellé = message »
 * (boutons d'action : le toucher envoie le message à Alfred). Un message de plus de 64 octets
 * (limite de Telegram) ne devient pas un bouton : la ligne reste dans le texte.
 */
export function extraireLiens(text) {
  const liens = [];
  const actions = [];
  const reste = [];
  for (const l of text.split("\n")) {
    const m = LIGNE_LIEN.exec(l);
    const b = m ? null : LIGNE_BOUTON.exec(l);
    if (m) liens.push({ text: m[1].trim(), url: m[2] });
    else if (b && Buffer.byteLength(b[2], "utf8") <= 64) actions.push({ text: b[1], callback_data: b[2] });
    else reste.push(l);
  }
  return { liens, actions, texte: reste.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** Les rangées de boutons : la 1re (Envoyer, liens), puis les actions deux par deux. */
export function clavier(premiere, actions = []) {
  const rangees = premiere.length ? [premiere] : [];
  for (let i = 0; i < actions.length; i += 2) rangees.push(actions.slice(i, i + 2));
  return rangees.length ? { boutons: rangees } : {};
}

/**
 * Mise en forme légère d'Alfred → HTML de Telegram : **gras**, rubriques en gras, lignes « > » en
 * citation (repliable au delà de 6 lignes), [texte](lien), les longues adresses raccourcies, et une
 * ligne vide avant chaque rubrique ou titre pour que le message respire.
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
  // « Détail : » seul sur sa ligne (demande de Marc, 17 novembre 2026) : tout ce qui suit part
  // dans un bloc replié, ouvert d'un toucher. La réponse reste au dessus, en une ou deux lignes.
  let detail = null;
  for (const l of lignes) {
    if (detail) {
      detail.push(enLigne(l.replace(/^>\s?/, "")));
      continue;
    }
    if (DETAIL.test(l)) {
      fermer();
      detail = [];
      continue;
    }
    if (/^>\s?/.test(l)) {
      cite.push(enLigne(l.replace(/^>\s?/, "")));
      continue;
    }
    fermer();
    // Aéré (demande de Marc) : une ligne vide avant chaque rubrique ou titre en gras.
    const debut = RUBRIQUE.test(l) || /^\*\*[^*]+\*\*/.test(l);
    if (debut && out.length && out[out.length - 1].trim()) out.push("");
    out.push(enLigne(l));
  }
  fermer();
  const corps = detail?.join("\n").trim();
  if (corps) out.push("", `<b>Détail</b>\n<blockquote expandable>${corps}</blockquote>`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Les liens vers TTP Suite s'ouvrent dans Telegram (Mini App, choix de Marc le 2026-11-11) ; les autres dans le navigateur. */
export const estApp = (url) => /^https:\/\/app\.ttpcreators\.pro(\/|$|\?)/.test(String(url));
export const boutonsLiens = (liens) => liens.map((l) => (estApp(l.url) ? { text: l.text, web_app: { url: l.url } } : { text: l.text, url: l.url }));

/**
 * Un mail à valider (…-mail.txt) : titre en gras, le texte du mail en citation repliable,
 * « À vérifier » en gras, le bouton Envoyer (vaut « oui Marque ») seul sur sa ligne, puis Ouvrir dans Spark et Ouvrir dans l'app.
 * Pas de « oui Marque » sur la 1re ligne (brouillon dans la boîte d'un créateur) : pas de bouton Envoyer.
 */
export function messageMail(text) {
  const { liens, actions, texte } = extraireLiens(text);
  const [premiere, ...suite] = texte.split("\n");
  const oui = /«\s*(oui [^»]+?)\s*»/i.exec(premiere)?.[1];
  const titre = premiere.split(" · ")[0].trim();
  const meta = /^À\s*:/.test(suite[0] ?? "") ? suite.shift().trim() : "";
  // « Pièces jointes : Contrat Nova.pdf » (sur la ligne suivante) : affichée sous l'adresse, jamais dans le mail.
  const pj = /^\s*(📎\s*)?pi[eè]ces? jointes?\s*:/i.test(suite[0] ?? "") ? suite.shift().trim().replace(/^📎\s*/, "") : "";
  const corps = [];
  const verifier = [];
  for (const l of suite) (/^À VÉRIFIER/i.test(l.trim()) ? verifier : corps).push(l);
  // Les autres notes pour Marc sortent aussi du bloc du mail.
  const { texte: mail, notes } = separerNotes(corps.join("\n"));
  verifier.push(...notes);
  // Sans bouton Envoyer (boîte d'un créateur dans Spark) : le mail dans un bloc qu'un toucher copie en entier.
  const blocMail = oui
    ? `<blockquote${mail.split("\n").length > 6 ? " expandable" : ""}>${escapeHtml(mail)}</blockquote>`
    : `<pre>${escapeHtml(mail)}</pre>`;
  const html = [
    `<b>${escapeHtml(titre)}</b>${meta ? `\n${escapeHtml(meta)}` : ""}${pj ? `\n📎 ${escapeHtml(pj.replace(/^pi[eè]ces? jointes?\s*:\s*/i, ""))}` : ""}`,
    mail ? blocMail : null,
    ...verifier.map((v) => escapeHtml(v.trim()).replace(/^À VÉRIFIER/i, "<b>À vérifier</b>")),
  ]
    .filter(Boolean)
    .join("\n\n");
  // Envoyer seul sur sa ligne, puis les liens (Spark pour le téléphone, l'app pour l'ordinateur) : plus lisible sur un téléphone.
  // Envoyer, Modifier (Marc répond avec sa correction), Plus tard (remis dans la liste de 17 h ou à demain).
  const qui = oui ? oui.replace(/^oui\s+/i, "").trim() : "";
  const envoyer = oui
    ? [{ text: "Envoyer", callback_data: court(oui) }, { text: "Modifier", callback_data: court(`${MODIFIER}${qui}`) }, { text: "Plus tard", callback_data: court(`${PLUS_TARD}${qui}`) }]
    : [];
  const ouvrir = boutonsLiens(liens);
  if (envoyer.length && ouvrir.length) return { text: html, html: true, plain: text, boutons: [envoyer, ouvrir, ...(clavier([], actions).boutons ?? [])] };
  return { text: html, html: true, plain: text, ...clavier([...envoyer, ...ouvrir], actions) };
}

/** Bouton Copier de Telegram : 256 caractères au plus ; au delà, le bloc à toucher suffit. */
export const boutonCopier = (texte) => (texte.length <= 256 ? [{ text: "Copier", copy_text: { text: texte } }] : []);

/**
 * « Pour Léna sur WhatsApp · 33612345678 » : l'intitulé sans le numéro, et le bouton qui ouvre la
 * discussion WhatsApp avec le texte déjà écrit (wa.me, Marc relit et envoie). Texte trop long pour
 * un lien : le bouton ouvre seulement la discussion.
 */
export function boutonWhatsApp(label, texte) {
  const m = /^(.*?)\s*·\s*\+?(\d[\d ]{6,18}\d)\s*$/.exec(label);
  const numero = m ? m[2].replace(/\D/g, "") : "";
  if (!m || numero.length < 8 || numero.length > 15) return { label, bouton: [] };
  const avecTexte = `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`;
  return { label: m[1].trim(), bouton: [{ text: "Ouvrir dans WhatsApp", url: avecTexte.length <= 2000 ? avecTexte : `https://wa.me/${numero}` }] };
}

/**
 * Bouton « J'ai envoyé » sous un texte à copier (demande de Marc, 13 novembre 2026) : Marc dit
 * d'un toucher qu'il a envoyé le message, et Alfred met la to-do et son suivi à jour. Pas de
 * confirmation (rien ne part) : le toucher arrive à Alfred avec le message en contexte.
 */
/**
 * Les commandes d'Alfred (demande de Marc, 16 novembre 2026) : le menu « / » de Telegram. Écrites
 * dans etat/commandes.txt au premier lancement, puis personnalisées par Marc (« ajoute /x = … »,
 * « change /mails »). Format : « /commande = ce qu'Alfred doit faire » ; le menu montre ce texte.
 */
export const COMMANDES_DE_BASE = [
  "# Tes commandes : « /commande = ce qu'Alfred fait ». Dis à Alfred « ajoute /x = … » ou « change /mails : … ».",
  "/point = Où j'en suis : tâches, mails, WhatsApp, argent",
  "/taches = Mes tâches du jour et en retard",
  "/mails = Les mails qui attendent ma réponse, toutes les boîtes",
  "/whatsapp = Qui attend ma réponse sur WhatsApp",
  "/relances = Ce qu'il faut relancer : marques, créateurs, factures",
  "/publications = Les publications de la semaine et celles en retard",
  "/argent = Factures en retard, paiements reçus, reversements à faire",
  "/commandes = La liste de mes commandes et raccourcis",
].join("\n");

/** Le menu complet : les commandes d'abord, puis les raccourcis des créateurs (100 au plus en tout). */
export function menuDepuis(texteCommandes, texteRaccourcis) {
  const a = commandesDepuis(texteCommandes);
  const b = commandesDepuis(texteRaccourcis);
  const commandes = [...a.commandes];
  const refus = [...a.refus, ...b.refus];
  for (const c of b.commandes) {
    if (commandes.some((x) => x.command === c.command) || commandes.length >= 100) refus.push(`/${c.command} = ${c.description}`);
    else commandes.push(c);
  }
  return { commandes, refus };
}

/**
 * Raccourcis des créateurs (etat/raccourcis.txt, une ligne « /lenapsl = Léna ») → commandes du
 * menu « / » de Telegram. Telegram n'accepte que a-z, 0-9 et _ (32 au plus), 100 commandes.
 * Une ligne invalide ou un raccourci en double est ignoré (et listé dans `refus`).
 */
export function commandesDepuis(texte) {
  const commandes = [];
  const refus = [];
  for (const brut of String(texte ?? "").split("\n")) {
    const ligne = brut.trim();
    if (!ligne || ligne.startsWith("#")) continue;
    const m = ligne.match(/^\/?([^\s=]+)\s*=\s*(.+)$/);
    const cmd = m ? m[1].toLowerCase() : "";
    const nom = m ? m[2].trim().slice(0, 256) : "";
    if (!/^[a-z0-9_]{1,32}$/.test(cmd) || !nom || commandes.some((c) => c.command === cmd) || commandes.length >= 100) {
      refus.push(ligne);
      continue;
    }
    commandes.push({ command: cmd, description: nom });
  }
  return { commandes, refus };
}

export const ENVOYE = "envoye:";
export function boutonEnvoye(label) {
  const qui = String(label).replace(/^(Pour|Mail à|Message (LinkedIn |Instagram )?pour)\s+/i, "").replace(/\s+sur\s+(WhatsApp|Instagram).*$/i, "").trim();
  return [{ text: "J'ai envoyé", callback_data: court(`${ENVOYE}${qui || "texte"}`) }];
}

/** Le message qu'Alfred reçoit quand Marc touche « J'ai envoyé ». */
export const messageEnvoye = (data) => `J'ai envoyé le message à ${String(data).slice(ENVOYE.length) || "ce contact"} (bouton « J'ai envoyé »)`;

/**
 * Texte WhatsApp que le pont de l'iMac peut envoyer (choix de Marc le 2026-11-15) : un
 * « …-whatsapp.txt » « Pour X sur WhatsApp », sans note ni trou. Renvoie le contenu à garder dans
 * etat/whatsapp-a-envoyer/<id>.txt (exactement ce que Marc voit), ou null.
 */
export function aEnvoyerWhatsApp(name, content) {
  if (!name.endsWith("-whatsapp.txt")) return null;
  const [premiere = "", ...rest] = String(content ?? "").replace(/\r\n/g, "\n").trim().split("\n");
  if (!/^Pour\s+.+?\s+sur\s+WhatsApp\b/i.test(premiere.trim())) return null;
  const { texte, notes, trous } = separerNotes(rest.join("\n"));
  if (!texte || notes.length || trous.length || /[—–]/.test(texte)) return null;
  return `${premiere.trim()}\n${texte}\n`;
}

/** Messages à envoyer pour un fichier déposé par Alfred. `waEnvoi` : id du texte que le bouton
 * « Envoyer » fait partir sur WhatsApp (« oui whatsapp <id> »). */
export function messagesFor(name, content, { waEnvoi = null } = {}) {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (name.endsWith("-whatsapp.txt") || name.endsWith("-copier.txt")) {
    const [premiere, ...rest] = text.split("\n");
    // Seulement le message dans le bloc à copier : les notes pour Marc passent dessous, à part
    // (demande de Marc, 13 novembre 2026 : rien qui trahisse l'IA chez le destinataire).
    const { texte: body, notes, trous } = separerNotes(rest.join("\n"));
    const { label, bouton } = boutonWhatsApp(premiere.trim(), body);
    if (body && body.length < LIMIT - 200) {
      const ligne = [...(waEnvoi ? [{ text: "Envoyer", callback_data: court(`oui whatsapp ${waEnvoi}`) }] : []), ...bouton, ...boutonCopier(body)];
      const apart = [...notes, ...(trous.length ? [`À compléter avant d'envoyer : ${trous.join(", ")}`] : [])];
      const pourMarc = apart.length ? `\n${apart.map((n) => `_${escapeMd(n)}_`).join("\n")}` : "";
      const boutons = [...(ligne.length ? [ligne] : []), boutonEnvoye(label)];
      return [{ text: `${escapeMd(label)}\n\`\`\`\n${escapeCode(body)}\n\`\`\`${pourMarc}`, md: true, plain: `${label}\n\n${body}${apart.length ? `\n\n${apart.join("\n")}` : ""}`, boutons }];
    }
  }
  if (name.endsWith("-mail.txt") && text.length < LIMIT - 300) return [messageMail(text)];
  // Le reste (résumé, alerte) : mise en forme légère quand il tient en un message, sinon texte simple.
  if (text.length < LIMIT - 300) {
    const { liens, actions, texte } = extraireLiens(text);
    return [{ text: enHtml(texte), html: true, plain: text, ...clavier(boutonsLiens(liens), actions) }];
  }
  return chunks(text).map((t) => ({ text: t, md: false }));
}

// ── Présentation des messages (demande de Marc, 17 novembre 2026) ─────────────

/** Boutons d'un brouillon gérés ici même, sans réveiller Alfred : Modifier et Plus tard. */
export const MODIFIER = "modifier:";
export const PLUS_TARD = "plus-tard:";
export const PLUS_TARD_QUAND = "plus-tard-quand:";

/** Le clavier qui remplace « Plus tard » : ce soir à 17 h ou demain matin. */
export const clavierPlusTard = (qui) => [[
  { text: "Ce soir, 17 h", callback_data: court(`${PLUS_TARD_QUAND}soir:${qui}`) },
  { text: "Demain, 9 h", callback_data: court(`${PLUS_TARD_QUAND}demain:${qui}`) },
]];

/** La ligne ajoutée à etat/a-valider.md quand Marc remet un mail à plus tard. */
export function ligneRemise(quand, qui, maintenant = new Date()) {
  const jour = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const demain = new Date(maintenant.getTime() + 86_400_000);
  const quandTexte = quand === "demain" ? `à partir du ${jour(demain)} 09:00` : `à partir du ${jour(maintenant)} 17:00`;
  return `${jour(maintenant)} · mail · ${qui} · remis par Marc, ${quandTexte} · · oui ${qui}`;
}

/** « Sujet : Prison Island » seul sur sa ligne : le message répond au précédent du même dossier. */
export function extraireSujet(texte) {
  let sujet = null;
  const reste = String(texte ?? "")
    .split("\n")
    .filter((l) => {
      const m = /^\s*Sujet\s*:\s*(.{2,80}?)\s*$/i.exec(l);
      if (m && !sujet) {
        sujet = m[1];
        return false;
      }
      return true;
    })
    .join("\n");
  return { sujet, texte: reste };
}

/** Clé d'un sujet : sans accents, casse ni ponctuation (« Prison Island » = « prison-island »). */
export const cleSujet = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Le téléphone de Marc sonne seulement pour l'urgent (demande de Marc, 17 novembre 2026) : une
 * réponse à ce qu'il vient d'écrire, une VIGILANCE ou un URGENT, un rappel, la liste à valider de
 * 17 h, et le premier message d'un point. Le reste arrive en silence.
 */
export function doitSonner({ texte = "", nom = "", mode = "", premier = false, sonner = {} }) {
  if (/\b(VIGILANCE|URGENT)\b|🔴/.test(texte)) return true;
  if (mode === "la réponse à Marc") return true;
  // Réglages d'Alfred dans l'app (page Agents) : Marc peut couper la sonnerie de la liste ou des points.
  if (/-valider\.txt$/.test(nom)) return sonner.valider !== false;
  if (premier && /^le point du (matin|soir)$/.test(mode)) return sonner.points !== false;
  return false;
}

/** Les boutons fixes en bas de l'écran (clavier de Telegram) et la commande que chacun vaut. */
export const BOUTONS_FIXES = [["Point", "À valider"], ["Mails", "Créateurs", "Argent"]];
const FIXES = { point: "/point", "à valider": "/valider", mails: "/mails", créateurs: "/createurs", argent: "/argent" };
/** Un toucher sur un bouton fixe arrive comme son texte : on le change en commande. */
export const commandeFixe = (texte) => FIXES[String(texte ?? "").trim().toLowerCase()] ?? null;
/** Version du clavier fixe : changer ce numéro le renvoie à Marc à la prochaine mise à jour. */
export const VERSION_CLAVIER = "1";

/** Commandes ajoutées après coup : mises une seule fois dans etat/commandes.txt (Marc peut les retirer ensuite). */
export const COMMANDES_AJOUTEES = [
  "/valider = Ce qui attend mon oui, tout de suite (comme la liste de 17 h)",
  "/createurs = Mes créateurs, une ligne chacun avec son raccourci",
];
export function ajouterCommandes(texte, deja) {
  const faites = new Set(String(deja ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
  let out = String(texte ?? "");
  const nouvelles = [];
  for (const c of COMMANDES_AJOUTEES) {
    const cmd = c.split(" ")[0];
    if (faites.has(cmd)) continue;
    nouvelles.push(cmd);
    if (!new RegExp(`^${cmd}\\s*=`, "m").test(out)) out = `${out.replace(/\n*$/, "")}\n${c}\n`;
  }
  return { texte: out, nouvelles };
}

/** « Photo : https://… » en 1re ligne d'une carte (…-carte.txt) : la photo et le texte dessous. */
export function carteDepuis(texte) {
  const [premiere = "", ...reste] = String(texte ?? "").replace(/\r\n/g, "\n").trim().split("\n");
  const m = /^\s*Photo\s*:\s*(https:\/\/\S+)\s*$/i.exec(premiere);
  return m ? { photo: m[1], texte: reste.join("\n").trim() } : { photo: null, texte: String(texte ?? "").trim() };
}

/**
 * Le graphique du bilan (…-graphique.json) : barres horizontales, sobres (gris, la valeur de la
 * semaine en bleu de l'app), lisibles sur un téléphone. Données : { titre, sousTitre, unite,
 * barres: [{ label, valeur, actuel }] }. Rendu en image par Chrome sur l'iMac.
 */
export function graphiqueHtml(d) {
  const barres = (Array.isArray(d?.barres) ? d.barres : []).slice(0, 8).map((b) => ({ label: String(b?.label ?? ""), valeur: Number(b?.valeur) || 0, actuel: !!b?.actuel }));
  const max = Math.max(1, ...barres.map((b) => b.valeur));
  const unite = String(d?.unite ?? "");
  const fmt = (n) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }).replace(/ /g, " ")}${unite ? ` ${unite}` : ""}`;
  const ligne = (b, i) => {
    const y = 150 + i * 92;
    const w = Math.round((b.valeur / max) * 620);
    return `<text x="60" y="${y}" class="l">${escapeHtml(b.label)}</text>
<rect x="60" y="${y + 14}" width="${Math.max(w, 4)}" height="40" rx="8" fill="${b.actuel ? "#2563eb" : "#cbd5e1"}"/>
<text x="${60 + Math.max(w, 4) + 16}" y="${y + 43}" class="v">${escapeHtml(fmt(b.valeur))}</text>`;
  };
  const h = 170 + barres.length * 92;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff}svg{display:block}
text{font-family:Inter,-apple-system,"Helvetica Neue",Arial,sans-serif;fill:#0f172a}
.t{font-size:34px;font-weight:700}.s{font-size:22px;fill:#64748b}.l{font-size:24px;fill:#334155}.v{font-size:24px;font-weight:600}
</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="900" height="${h}" viewBox="0 0 900 ${h}">
<text x="60" y="56" class="t">${escapeHtml(String(d?.titre ?? ""))}</text>
<text x="60" y="90" class="s">${escapeHtml(String(d?.sousTitre ?? ""))}</text>
${barres.map(ligne).join("\n")}
</svg></body></html>`;
}

/**
 * Toucher de Marc sur un bouton d'action (Envoyer, Fait, Créer la facture, Rappelle-moi demain…) :
 * devient le message que le bouton porte (« oui Erwann », « fait tâche … »), le même effet que s'il
 * l'avait tapé, avec le message touché en contexte. Seuls les touchers de Marc comptent.
 */
export function toucherDeMarc(u, marcId) {
  const c = u?.callback_query;
  const data = String(c?.data ?? "").trim();
  if (!c || String(c.from?.id) !== String(marcId) || !data) return null;
  const vu = String(c.message?.text ?? "").replace(/\s+/g, " ").trim();
  const libelle = (c.message?.reply_markup?.inline_keyboard ?? []).flat().find((b) => b.callback_data === c.data)?.text ?? "Envoyer";
  return {
    id: Number(c.message?.message_id) || null,
    at: new Date(),
    text: `${data} (bouton « ${libelle} »)`,
    reply: vu ? `(en réponse à ton message : « ${vu.length > 600 ? `${vu.slice(0, 600)}…` : vu} »)` : null,
    toucher: { id: c.id, data: c.data, chat: c.message?.chat?.id, message: c.message?.message_id, clavier: c.message?.reply_markup?.inline_keyboard ?? [] },
  };
}

/**
 * Confirmation des boutons d'action (demande de Marc, 11 novembre 2026 : éviter un toucher par
 * erreur). 1er toucher : on demande « Confirmer : libellé » ou « Annuler » ; seul « Confirmer »
 * envoie l'action à Alfred. Sauf le bouton Envoyer d'un mail (« oui Marque ») : un seul toucher. `attente` : les demandes en cours, par identifiant court.
 */
export function etapeToucher(data, attente = {}, libelle = "") {
  const m = /^(ok|non):([0-9a-z]{4,12})$/.exec(String(data ?? ""));
  // Le bouton Envoyer d'un mail part en un seul toucher (demande de Marc, 16 novembre 2026).
  if (!m && libelle === "Envoyer" && /^oui\s/i.test(String(data ?? ""))) return { action: "direct" };
  if (!m) return { action: "demander" };
  const entree = attente[m[2]];
  if (!entree) return { action: "perime" };
  return { action: m[1] === "ok" ? "valider" : "annuler", id: m[2], entree };
}

/** Le clavier de confirmation qui remplace les boutons le temps de valider. */
export const clavierConfirmation = (id, libelle) => [[{ text: `Confirmer : ${libelle}`.slice(0, 60), callback_data: `ok:${id}` }, { text: "Annuler", callback_data: `non:${id}` }]];

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
    const brut = String(m.text ?? m.caption ?? "").trim();
    if ((!brut && !voice && !media) || brut === "/start") continue;
    // Transféré d'une autre discussion : une information, jamais une demande de Marc (règle 4).
    const origine = origineTransfert(m);
    const text = origine ? `(message transféré de ${origine} : une information, pas une demande de Marc)\n${brut}` : brut;
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

/** Qui a écrit un message transféré à Alfred (null s'il vient de Marc lui même). */
export function origineTransfert(m) {
  const o = m?.forward_origin;
  if (!o) return m?.forward_from ? [m.forward_from.first_name, m.forward_from.last_name].filter(Boolean).join(" ") || "quelqu'un" : null;
  if (o.type === "user") return [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(" ") || "quelqu'un";
  if (o.type === "hidden_user") return o.sender_user_name || "quelqu'un";
  if (o.type === "chat" || o.type === "channel") return o.sender_chat?.title ?? o.chat?.title ?? "un groupe";
  return "quelqu'un";
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
  // Partagé depuis le téléphone (demande de Marc, 17 novembre 2026) : un mail exporté de Spark
  // ou de Mail (.eml), un texte, une page HTML ou un tableau CSV.
  const nom = String(d?.file_name ?? "");
  if (d?.file_id && (/message\/rfc822/.test(mime) || /\.eml$/i.test(nom))) return { fileId: d.file_id, kind: "mail", name: nom || "mail.eml", size: Number(d.file_size ?? 0) };
  if (d?.file_id && (/^text\//.test(mime) || /\.(txt|html?|csv|md)$/i.test(nom))) return { fileId: d.file_id, kind: "texte", name: nom || "texte.txt", size: Number(d.file_size ?? 0) };
  // Tout autre fichier : gardé, et Alfred dit qu'il ne sait pas le lire (jamais un partage ignoré en silence).
  if (d?.file_id) return { fileId: d.file_id, kind: "autre", name: nom || "fichier", size: Number(d.file_size ?? 0) };
  return null;
}

/** Décode un morceau de mail (base64 ou quoted-printable) dans son jeu de caractères. */
function decoderPartie(corps, encodage, charset) {
  const enc = String(encodage ?? "").toLowerCase();
  let octets;
  if (enc === "base64") octets = Buffer.from(corps.replace(/\s+/g, ""), "base64");
  else if (enc === "quoted-printable")
    octets = Buffer.from(corps.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
  else octets = Buffer.from(corps, "latin1");
  try {
    return new TextDecoder(/^(utf-?8|)$/i.test(String(charset ?? "")) ? "utf-8" : String(charset)).decode(octets);
  } catch {
    return new TextDecoder("utf-8").decode(octets);
  }
}

/** En-tête d'un mail, mots encodés (=?UTF-8?B?…?=) décodés. */
function enTete(entetes, nom) {
  const m = new RegExp(`^${nom}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im").exec(entetes);
  if (!m) return "";
  return m[1].replace(/\r?\n[ \t]+/g, " ").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, t, v) =>
    t.toLowerCase() === "b" ? decoderPartie(v, "base64", cs) : decoderPartie(v.replace(/_/g, " "), "quoted-printable", cs),
  ).trim();
}

/**
 * Un mail exporté (.eml) → texte lisible : De, À, Date, Objet, puis le texte du message (la partie
 * texte, sinon le HTML sans balises). Les pièces jointes sont nommées, pas lues.
 */
export function texteDuMail(brut) {
  const s = String(brut ?? "");
  const coupe = s.search(/\r?\n\r?\n/);
  const entetes = coupe < 0 ? s : s.slice(0, coupe);
  const corps = coupe < 0 ? "" : s.slice(coupe).replace(/^\r?\n\r?\n/, "");
  const parties = [];
  const pieces = [];
  const parcourir = (h, c) => {
    const type = enTete(h, "Content-Type") || "text/plain";
    const limite = /boundary="?([^";\r\n]+)"?/i.exec(type)?.[1];
    if (/^multipart\//i.test(type) && limite) {
      for (const bloc of c.split(`--${limite}`).slice(1)) {
        if (bloc.startsWith("--")) break;
        const b = bloc.replace(/^\r?\n/, "");
        const i = b.search(/\r?\n\r?\n/);
        if (i >= 0) parcourir(b.slice(0, i), b.slice(i).replace(/^\r?\n\r?\n/, ""));
      }
      return;
    }
    const dispo = enTete(h, "Content-Disposition");
    const fichier = /name="?([^";\r\n]+)"?/i.exec(`${dispo} ${type}`)?.[1];
    if (/attachment/i.test(dispo) || (fichier && !/^text\//i.test(type))) {
      if (fichier) pieces.push(fichier);
      return;
    }
    const charset = /charset="?([^";\s]+)"?/i.exec(type)?.[1] ?? "utf-8";
    const texte = decoderPartie(c, enTete(h, "Content-Transfer-Encoding"), charset);
    if (/^text\/plain/i.test(type)) parties.push({ html: false, texte });
    else if (/^text\/html/i.test(type)) parties.push({ html: true, texte: texte.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"') });
  };
  parcourir(entetes, corps);
  const texte = (parties.find((p) => !p.html) ?? parties[0])?.texte.replace(/\n{3,}/g, "\n\n").trim() ?? "";
  return [
    `De : ${enTete(entetes, "From")}`,
    `À : ${enTete(entetes, "To")}${enTete(entetes, "Cc") ? `\nCc : ${enTete(entetes, "Cc")}` : ""}`,
    `Date : ${enTete(entetes, "Date")}`,
    `Objet : ${enTete(entetes, "Subject")}`,
    ...(pieces.length ? [`Pièces jointes : ${pieces.join(", ")}`] : []),
    "",
    texte || "(message vide)",
  ].join("\n");
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
    const ext = (String(f.result.file_path).match(/\.[a-z0-9]+$/i)?.[0] ?? String(media.name).match(/\.[a-z0-9]+$/i)?.[0] ?? (media.kind === "pdf" ? ".pdf" : media.kind === "image" ? ".jpg" : media.kind === "doc" ? ".docx" : media.kind === "mail" ? ".eml" : media.kind === "texte" ? ".txt" : media.kind === "autre" ? ".bin" : ".mp4")).toLowerCase();
    const src = join(dir, `source${ext}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    if (media.kind === "mail") {
      const txt = join(dir, "texte.txt");
      writeFileSync(txt, texteDuMail(readFileSync(src, "latin1")));
      return `mail partagé « ${media.name} » : son texte (expéditeur, date, objet, message) dans ${txt}`;
    }
    if (media.kind === "texte") {
      if (!/\.html?$/i.test(src)) return `texte partagé « ${media.name} » enregistré : ${src}`;
      const txt = join(dir, "texte.txt");
      const conv = await run("textutil", ["-convert", "txt", "-output", txt, src]).then(() => true, () => false);
      return conv ? `page partagée « ${media.name} » : son texte dans ${txt}` : `page partagée « ${media.name} » enregistrée : ${src}`;
    }
    if (media.kind === "autre") return `fichier « ${media.name} » enregistré (${src}), mais tu ne sais pas lire ce type : dis-le à Marc et demande-le en PDF, en capture ou en texte`;
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

/**
 * Lien d'une vidéo publiée sur un réseau (Instagram, TikTok, YouTube, X, Facebook, Vimeo) : seulement
 * quand Alfred le télécharge lui même pour donner son avis (node telegram.mjs telecharger), jamais
 * pour un lien que Marc colle sans rien demander (demande de Marc, 24 novembre 2026).
 */
export function lienReseau(text) {
  for (const raw of String(text ?? "").match(/https?:\/\/[^\s<>"'»)]+/gi) ?? []) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    let h = "";
    try {
      h = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (/(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|fb\.watch|vimeo\.com)$/.test(h)) return { kind: "reseau", url };
  }
  return null;
}

/** Une vidéo d'un réseau téléchargée avec yt-dlp (installé sur le Mac), puis découpée comme une preview. */
async function telechargerReseau(lien, dir, model) {
  const ytdlp = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", join(homedir(), ".local/bin/yt-dlp")].find((c) => existsSync(c));
  if (!ytdlp) return "yt-dlp n'est pas installé sur l'iMac : dis à Marc de lancer « brew install yt-dlp » dans le Terminal de l'iMac, ou de t'envoyer la vidéo sur Telegram.";
  mkdirSync(dir, { recursive: true });
  try {
    await promisify(execFile)(ytdlp, ["--no-playlist", "--max-filesize", "300M", "-f", "mp4/bv*[height<=1080]+ba/b", "--merge-output-format", "mp4", "-o", join(dir, "video.%(ext)s"), lien.url], { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    return `vidéo impossible à récupérer (compte privé, connexion demandée ou lien mort) : ${String(e.message).split("\n").filter(Boolean).pop()?.slice(0, 200)}. Demande à Marc de t'envoyer la vidéo sur Telegram.`;
  }
  const v = plusGrosseVideo(dir);
  return v ? await decouperVideo(v, dir, model) : "aucune vidéo trouvée derrière ce lien.";
}

/** Nom d'une pièce jointe de mail copiée sur l'iMac : « 20261124-153000-Brief Nova.pdf ». */
export function nomPieceMail(nom, quand = new Date()) {
  const id = quand.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const propre = String(nom ?? "").replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "piece";
  return `${id}-${propre}`;
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
/** Arguments d'impression PDF d'un navigateur Chromium (anciens et nouveaux drapeaux : un drapeau inconnu est ignoré).
 * Chemins rendus complets : un chemin relatif (etat/envoi-reponse/…) donnait « file://etat/… »,
 * une adresse invalide, et Chrome imprimait sa page d'erreur dans le PDF. */
export function pdfArgs(src, out) {
  return ["--headless", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", "--print-to-pdf-no-header", "--virtual-time-budget=5000", `--print-to-pdf=${resolve(out)}`, pathToFileURL(resolve(src)).href];
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

/** Nom du document d'un contrat : « 02-contrat-Nova-Lea.contrat.json » → « 02-contrat-Nova-Lea.html ». */
export function nomContrat(nom) {
  return String(nom).replace(/\.contrat\.json$/i, ".html");
}

/**
 * Contrat demandé par Alfred (les mêmes entrées que l'outil preparer_contrat, dans un
 * fichier .contrat.json) → le HTML du moteur de l'app (contrats.mjs), à côté, prêt à partir en
 * PDF. Si le contrat ne peut pas être fabriqué : un message qui dit pourquoi.
 */
export async function contratDepuisJson(chemin, name) {
  try {
    const { renderContract } = await import("./contrats.mjs");
    const r = renderContract(JSON.parse(readFileSync(chemin, "utf8")));
    if (r.erreur) throw new Error(r.erreur);
    const html = join(dirname(chemin), nomContrat(name));
    writeFileSync(html, r.html);
    return [{ file: html, name: nomContrat(name), temporaire: html }];
  } catch (e) {
    const texte = `Je n'ai pas pu fabriquer le contrat (${nomAffiche(name)}) : ${e.message}`;
    return [{ text: escapeHtml(texte), html: true, plain: texte }];
  }
}

/** « 02-rapport-Nova-Lea.rapport.json » → « 02-rapport-Nova-Lea.html ». */
export function nomRapport(nom) {
  return String(nom).replace(/\.rapport\.json$/i, ".html");
}

/**
 * Rapport de fin de collab (demande de Marc, 24 novembre 2026) : les données d'Alfred dans un
 * fichier .rapport.json → le document du moteur de l'app (contrats.mjs, identité des PDF de l'app),
 * à côté, prêt à partir en PDF. S'il ne peut pas être fabriqué : un message qui dit pourquoi.
 */
export async function rapportDepuisJson(chemin, name) {
  try {
    const { renderRapportCollab } = await import("./contrats.mjs");
    const d = JSON.parse(readFileSync(chemin, "utf8"));
    // Une capture de l'iMac (« etat/araignee/…/page.png », « etat/previews/… ») : seulement dans etat/.
    const etat = resolve(dirname(chemin), "..", "..", "etat") + sep;
    const ici = resolve(dirname(chemin), "..", "..");
    if (Array.isArray(d?.captures))
      d.captures = d.captures.map((c) => {
        const u = String(c?.url ?? "");
        if (/^https:\/\//.test(u)) return c;
        const f = resolve(ici, u);
        return f.startsWith(etat) && existsSync(f) ? { ...c, url: pathToFileURL(f).href } : null;
      }).filter(Boolean);
    const r = renderRapportCollab(d);
    if (r.erreur) throw new Error(r.erreur);
    const html = join(dirname(chemin), nomRapport(name));
    writeFileSync(html, r.html);
    return [{ file: html, name: nomRapport(name), temporaire: html }];
  } catch (e) {
    const texte = `Je n'ai pas pu fabriquer le rapport (${nomAffiche(name)}) : ${e.message}`;
    return [{ text: escapeHtml(texte), html: true, plain: texte }];
  }
}

const PIECE_MAX = 50 * 1024 * 1024; // limite d'envoi des bots Telegram
// Ce qu'une marque envoie : script, brief, contrat, présentation, tableau, image, vidéo, archive.
// Pas de .txt ni de .html : dans etat/envoi, ils deviendraient un message ou seraient convertis.
const PIECE_EXT = /\.(pdf|docx?|odt|rtf|pages|key|pptx?|xlsx?|csv|png|jpe?g|heic|webp|gif|mp4|mov|zip)$/i;

/** Nom du fichier déposé dans etat/envoi : « 04-Script Vaillant.pdf » (l'ordre, puis le nom d'origine nettoyé). */
export function nomPieceJointe(nom, ordre = "05") {
  const propre = String(nom ?? "")
    .replace(/[\u0000-\u001f/\\:]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+/, "")
    .trim();
  const num = /^\d{1,3}$/.test(String(ordre ?? "")) ? String(ordre).padStart(2, "0") : "05";
  return propre ? `${num}-${propre}` : null;
}

/** Le nom que Marc voit sur Telegram : sans le numéro d'ordre du dossier d'envoi. */
export function nomAffiche(nom) {
  return String(nom).replace(/^\d{1,3}-(?=.)/, "");
}

/** Vérifie une pièce jointe décrite par `spark attachment --json` : la raison du refus, ou null si elle peut partir. */
export function refusPiece(info) {
  if (!info?.path || !info?.name) return "pièce jointe introuvable dans Spark";
  if (!PIECE_EXT.test(info.name)) return `type de fichier non pris en charge (${info.name}) : Marc doit la transférer lui même`;
  if (Number(info.size) > PIECE_MAX) return `${info.name} dépasse 50 Mo, la limite de Telegram : Marc doit la transférer lui même`;
  return null;
}

/** Le dossier d'envoi du passage : etat/envoi ou etat/envoi-reponse (rien d'autre, pour ne rien écrire ailleurs). */
export function dossierEnvoi(valeur) {
  return /^etat\/envoi(-reponse)?$/.test(String(valeur ?? "")) ? valeur : "etat/envoi";
}

/** Les numéros des messages de Marc du passage : etat/recu-ids.txt, ou etat/recu-reponse-ids.txt pour une réponse rapide. */
export function fichierRecuIds(valeur) {
  return /^etat\/recu(-reponse)?-ids\.txt$/.test(String(valeur ?? "")) ? valeur : "etat/recu-ids.txt";
}

/** Les fichiers prêts à partir pendant une réponse rapide : ni cachés ni vides, pas modifiés depuis `calme` ms, dans l'ordre des noms. */
export function fichiersPrets(entrees, maintenant, calme = 3000) {
  return entrees
    .filter((e) => !e.name.startsWith(".") && e.size > 0 && maintenant - e.mtimeMs >= calme)
    .map((e) => e.name)
    .sort();
}

/** Les fichiers d'un dossier, avec leur taille et leur heure de modification. */
function lireDossier(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, st: statSync(join(dir, name)) }))
    .filter((e) => e.st.isFile())
    .map((e) => ({ name: e.name, size: e.st.size, mtimeMs: e.st.mtimeMs }));
}

/** Le processus <pid> tourne encore ? */
function vivant(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Envoie ces fichiers du dossier à Marc, dans l'ordre. Le tout premier message du passage cite le
 * dernier message de Marc ; le fichier caché `.deja-cite` du dossier retient que c'est fait.
 * `supprimer` : chaque fichier envoyé est retiré du dossier (envoi au fil de l'eau). */
async function envoyerFichiers({ token, chatId, here, dir, names, fil, supprimer = false }) {
  const marque = join(dir, ".deja-cite");
  const fichierIds = join(here, fichierRecuIds(process.env.ALFRED_RECU_IDS));
  const ids = existsSync(fichierIds) ? readFileSync(fichierIds, "utf8").split("\n").map(Number).filter(Boolean) : [];
  let replyTo = !existsSync(marque) && ids.length ? ids[ids.length - 1] : null;
  const waActif = readEnv(join(here, "config.env")).ALFRED_WA_ENVOI === "1";
  const mode = String(process.env.ALFRED_MODE ?? "");
  const sujets = lireSujets(here);
  let sonner = {};
  try {
    sonner = JSON.parse(readFileSync(join(here, "etat/reglages.json"), "utf8")).sonner ?? {};
  } catch {
    sonner = {};
  }
  let n = 0;
  for (const name of names) {
    const chemin = join(dir, name);
    // Le message épinglé « Aujourd'hui », la carte d'un créateur et le graphique ont leur propre envoi.
    if (name.endsWith("-epingle.txt") || name.endsWith("-carte.txt") || name.endsWith("-graphique.json")) {
      try {
        await envoyerSpecial({ token, chatId, here, chemin, name, fil });
        n++;
      } catch (e) {
        console.error(`${new Date().toISOString()} ${name} : ${e.message}`);
      }
      if (supprimer) rmSync(chemin, { force: true });
      continue;
    }
    // Un .txt = un message ; un .contrat.json (contrat) ou un .rapport.json (rapport de fin de collab) :
    // un document fabriqué par le moteur de l'app ;
    // tout autre fichier (document .html, PDF) part en pièce jointe.
    // Pont WhatsApp installé (ALFRED_WA_ENVOI=1 dans config.env) : le texte est gardé tel que Marc
    // le voit, et son bouton « Envoyer » le fait partir après confirmation (whatsapp.mjs envoyer).
    // « Sujet : … » (ligne retirée du message) : le message répond au précédent du même dossier.
    const { sujet, texte: brut } = name.endsWith(".txt") ? extraireSujet(readFileSync(chemin, "utf8")) : { sujet: null, texte: "" };
    const cle = sujet ? cleSujet(sujet) : "";
    const garde = waActif ? aEnvoyerWhatsApp(name, brut) : null;
    let waEnvoi = null;
    if (garde) {
      waEnvoi = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
      mkdirSync(join(here, "etat/whatsapp-a-envoyer"), { recursive: true });
      writeFileSync(join(here, "etat/whatsapp-a-envoyer", `${waEnvoi}.txt`), garde);
    }
    const messages = name.endsWith(".txt")
      ? messagesFor(name, brut, { waEnvoi })
      : name.endsWith(".contrat.json")
        ? await contratDepuisJson(chemin, name)
        : name.endsWith(".rapport.json")
          ? await rapportDepuisJson(chemin, name)
          : [{ file: chemin, name }];
    for (const m of messages) {
      if (m.file) {
        // Un document HTML part en PDF quand Chrome est là (plus simple à ouvrir et à transférer).
        const pdf = /\.html?$/i.test(m.name) ? await enPdf(m.file) : null;
        if (pdf) {
          m.file = pdf;
          m.name = m.name.replace(/\.html?$/i, ".pdf");
        }
        await sendDocument(token, chatId, m.file, nomAffiche(m.name), replyTo);
        appendFileSync(fil, `\n### ${stamp()} · Alfred\n(document envoyé : ${nomAffiche(m.name)})\n`);
        // Contrat fabriqué ici : son HTML et son PDF ne restent pas dans le dossier d'envoi.
        if (m.temporaire) for (const f of [m.temporaire, m.file]) rmSync(f, { force: true });
      } else {
        const silence = !doitSonner({ texte: String(m.plain ?? m.text), nom: name, mode, premier: n === 0, sonner });
        const cite = replyTo ?? (cle && sujets[cle]?.id) ?? null;
        const id = await send(token, chatId, m, cite, { silence });
        if (cle && id) sujets[cle] = { id, at: Date.now() };
        appendFileSync(fil, `\n### ${stamp()} · Alfred\n${m.plain ?? m.text}\n`);
      }
      // Le marqueur dit aussi à alfred.sh que Marc a déjà reçu quelque chose (même sans message à citer).
      if (!existsSync(marque)) writeFileSync(marque, "");
      replyTo = null;
      n++;
    }
    if (supprimer) rmSync(chemin, { force: true });
  }
  try {
    writeFileSync(join(here, "etat/sujets.json"), JSON.stringify(sujets));
  } catch {
    // le fil par dossier est un confort : jamais une raison de bloquer l'envoi
  }
  return n;
}

/** Épinglé, carte (photo + texte + boutons) ou graphique (image) : silencieux. */
async function envoyerSpecial({ token, chatId, here, chemin, name, fil }) {
  const brut = readFileSync(chemin, "utf8");
  if (name.endsWith("-epingle.txt")) {
    const { liens, actions, texte } = extraireLiens(brut.trim());
    const msg = { text: enHtml(texte), html: true, plain: texte, ...clavier(boutonsLiens(liens), actions) };
    await epingler(token, chatId, here, msg);
    appendFileSync(fil, `\n### ${stamp()} · Alfred (épinglé)\n${texte}\n`);
    return;
  }
  if (name.endsWith("-carte.txt")) {
    const { photo, texte: corps } = carteDepuis(brut);
    const { liens, actions, texte } = extraireLiens(corps);
    const boutons = clavier(boutonsLiens(liens), actions).boutons ?? null;
    const html = enHtml(texte);
    try {
      if (!photo || html.length > 1000) throw new Error("sans photo");
      await sendPhoto(token, chatId, photo, { caption: html, boutons, silence: true });
    } catch {
      await send(token, chatId, { text: html, html: true, plain: texte, ...(boutons ? { boutons } : {}) }, null, { silence: true });
    }
    appendFileSync(fil, `\n### ${stamp()} · Alfred (carte)\n${texte}\n`);
    return;
  }
  const d = JSON.parse(brut);
  const nb = Math.min(8, Array.isArray(d?.barres) ? d.barres.length : 0);
  const image = await enImage(graphiqueHtml(d), 170 + nb * 92);
  const legende = escapeHtml(String(d?.legende ?? d?.titre ?? ""));
  if (image) await sendPhoto(token, chatId, image, { caption: legende, silence: true });
  else await send(token, chatId, { text: `${legende}\n${(d?.barres ?? []).map((b) => `${b.label} : ${b.valeur}${d?.unite ? ` ${d.unite}` : ""}`).join("\n")}`, md: false }, null, { silence: true });
  appendFileSync(fil, `\n### ${stamp()} · Alfred (graphique)\n${d?.titre ?? ""}\n`);
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

async function send(token, chatId, msg, replyTo = null, { silence = false } = {}) {
  const cite = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  const clavier = msg.boutons ? { reply_markup: { inline_keyboard: msg.boutons } } : {};
  const muet = silence ? { disable_notification: true } : {};
  const call = (body) => api(token, "sendMessage", { chat_id: chatId, disable_web_page_preview: true, ...cite, ...clavier, ...muet, ...body });
  const mode = msg.md ? "MarkdownV2" : msg.html ? "HTML" : null;
  let res = await call(mode ? { text: msg.text, parse_mode: mode } : { text: msg.text });
  // Mise en forme refusée : on renvoie le même texte, sans mise en forme.
  if (!res.ok && mode) res = await call({ text: msg.plain });
  if (!res.ok) throw new Error(`Telegram a refusé le message : ${res.description ?? "erreur inconnue"}`);
  return res.result?.message_id ?? null;
}

/** Une photo avec sa légende (carte d'un créateur, graphique) : par adresse, ou fichier du Mac. */
async function sendPhoto(token, chatId, photo, { caption = "", boutons = null, silence = false, replyTo = null } = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
  }
  if (boutons) form.append("reply_markup", JSON.stringify({ inline_keyboard: boutons }));
  if (silence) form.append("disable_notification", "true");
  if (replyTo) form.append("reply_parameters", JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
  if (/^https:\/\//.test(photo)) form.append("photo", photo);
  else form.append("photo", new Blob([readFileSync(photo)]), "image.png");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form }).then((r) => r.json());
  if (!res.ok) throw new Error(`Telegram a refusé la photo : ${res.description ?? "erreur inconnue"}`);
  return res.result?.message_id ?? null;
}

/** Le graphique en image (Chrome sans fenêtre, comme les PDF). null si Chrome n'est pas là. */
async function enImage(html, hauteur) {
  const nav = CHROME.find((c) => existsSync(c));
  if (!nav) return null;
  const dir = join(tmpdir(), `alfred-img-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const src = join(dir, "g.html");
  const out = join(dir, "g.png");
  writeFileSync(src, html);
  try {
    await promisify(execFile)(nav, [`--user-data-dir=${join(dir, "profil")}`, "--headless", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=2", `--window-size=900,${hauteur}`, `--screenshot=${out}`, pathToFileURL(src).href], { timeout: 60_000 });
    return existsSync(out) && statSync(out).size > 1000 ? out : null;
  } catch {
    return null;
  }
}

/** Le message épinglé « Aujourd'hui » : mis à jour s'il date d'aujourd'hui, sinon nouveau et épinglé. */
async function epingler(token, chatId, here, msg) {
  const fichier = join(here, "etat/epingle.json");
  const jour = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  let avant = {};
  try {
    avant = existsSync(fichier) ? JSON.parse(readFileSync(fichier, "utf8")) : {};
  } catch {
    avant = {};
  }
  if (avant.id && avant.jour === jour) {
    const res = await api(token, "editMessageText", { chat_id: chatId, message_id: avant.id, text: msg.text, parse_mode: "HTML", disable_web_page_preview: true, ...(msg.boutons ? { reply_markup: { inline_keyboard: msg.boutons } } : {}) });
    if (res.ok || /not modified/i.test(res.description ?? "")) return avant.id;
  }
  const id = await send(token, chatId, msg, null, { silence: true });
  if (id) {
    if (avant.id) await api(token, "unpinChatMessage", { chat_id: chatId, message_id: avant.id }).catch(() => {});
    await api(token, "pinChatMessage", { chat_id: chatId, message_id: id, disable_notification: true }).catch(() => {});
    writeFileSync(fichier, JSON.stringify({ id, jour }));
  }
  return id;
}

/** Les fils par dossier (etat/sujets.json) : le dernier message envoyé pour chaque sujet, 30 jours. */
function lireSujets(here) {
  try {
    const f = join(here, "etat/sujets.json");
    const o = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    for (const [k, v] of Object.entries(o)) if (Date.now() - Number(v?.at ?? 0) > 30 * 86_400_000) delete o[k];
    return o;
  } catch {
    return {};
  }
}

// ── Le pont avec l'app (demande de Marc, 17 novembre 2026) ──────────────────
const PONT = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/alfred-pont";

/** Appelle alfred-pont avec le secret de config.env (ALFRED_PONT_SECRET). null sans secret ou en cas d'échec. */
async function pont(env, body, { attente = 20_000, erreurs = false } = {}) {
  // Le secret du pont, ou l'empreinte du jeton du bot (déjà dans config.env) : rien à poser à la main.
  const secret = env.ALFRED_PONT_SECRET || (env.ALFRED_BOT_TOKEN ? `tg:${createHash("sha256").update(env.ALFRED_BOT_TOKEN).digest("hex")}` : "");
  if (!secret) return erreurs ? { error: "pas de secret du pont dans config.env" } : null;
  try {
    const r = await fetch(PONT, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(attente) });
    if (r.ok) return await r.json();
    // erreurs : la raison du refus revient (pièce introuvable, photo trop lourde…), jamais un silence.
    return erreurs ? { error: (await r.json().catch(() => null))?.error || `refusé (${r.status})` } : null;
  } catch (e) {
    return erreurs ? { error: `pont injoignable (${e.message})` } : null;
  }
}

/** Une nouvelle de l'app, en une ligne pour Alfred (une information, jamais un ordre). */
export function ligneEvenement(e) {
  const quand = new Date(e.cree_le ?? Date.now()).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const quoi = {
    tache_cochee: "tâche cochée",
    piece_deposee: "pièce déposée sur une tâche",
    facture_payee: "facture passée en payée",
    valide_dans_app: "validé dans la page Agents",
    action_equipe: "action dans l'app",
  }[e.type] ?? e.type;
  const lien = e.lien ? ` · Ouvrir dans l'app : https://app.ttpcreators.pro${String(e.lien).startsWith("/") ? "" : "/"}${e.lien}` : "";
  return `[${quand}] ${quoi}${e.auteur ? ` par ${e.auteur}` : ""}${e.cible ? ` · ${e.cible}` : ""}${e.detail ? ` · ${String(e.detail).replace(/\s+/g, " ").slice(0, 300)}` : ""}${lien}`;
}

/** Une demande écrite dans l'app (« Demander à Alfred »), rangée comme un message de Marc. */
export function messageDemande(d) {
  const deMarc = /^marc/i.test(String(d.auteur ?? ""));
  const qui = deMarc ? "(demande écrite dans l'app)" : `(demande écrite dans l'app par ${d.auteur ?? "un membre de l'équipe"} : l'associé de Marc ; rien ne part sans le « oui » de Marc)`;
  const ou = [d.contexte, d.lien ? `Ouvrir dans l'app : https://app.ttpcreators.pro${String(d.lien).startsWith("/") ? "" : "/"}${d.lien}` : ""].filter(Boolean).join(" · ");
  return `${qui}${ou ? ` [${ou}]` : ""}\n${String(d.texte ?? "").trim()}`;
}

/** Ce qu'Alfred a envoyé à Marc depuis une position du fil (etat/conversation.md) : sa réponse. */
export function reponseDepuis(fil, debut) {
  const neuf = String(fil ?? "").slice(debut);
  return neuf
    .split(/\n(?=### )/)
    .filter((b) => /^### [^\n]*· Alfred/.test(b.trim()))
    .map((b) => b.trim().replace(/^### [^\n]*\n/, "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
}

/** Met les commandes et raccourcis dans le menu « / » de Telegram. */
async function mettreMenu(token, chatId, here) {
  const file = join(here, "etat/raccourcis.txt");
  const fichierCommandes = join(here, "etat/commandes.txt");
  if (!existsSync(fichierCommandes)) writeFileSync(fichierCommandes, `${COMMANDES_DE_BASE}\n`);
  // Les commandes ajoutées depuis (/valider, /createurs) : une seule fois, Marc peut les retirer ensuite.
  const fichierAjouts = join(here, "etat/commandes-ajoutees.txt");
  const { texte: avecAjouts, nouvelles } = ajouterCommandes(readFileSync(fichierCommandes, "utf8"), existsSync(fichierAjouts) ? readFileSync(fichierAjouts, "utf8") : "");
  if (nouvelles.length) {
    writeFileSync(fichierCommandes, avecAjouts);
    appendFileSync(fichierAjouts, `${nouvelles.join("\n")}\n`);
  }
  const { commandes, refus } = menuDepuis(readFileSync(fichierCommandes, "utf8"), existsSync(file) ? readFileSync(file, "utf8") : "");
  const res = await api(token, "setMyCommands", { commands: commandes, scope: { type: "chat", chat_id: Number(chatId) } });
  if (!res.ok) throw new Error(`Telegram a refusé le menu : ${res.description ?? "erreur inconnue"}`);
  return { commandes, refus };
}

/**
 * Écrit une skill reçue par le pont dans .claude/skills/<nom>/ (nom et chemins contrôlés : jamais
 * hors de ce dossier). Renvoie false si elle est refusée.
 */
export function ecrireSkill(here, sk) {
  const nom = String(sk?.nom ?? "");
  if (!/^[a-z0-9-]{2,40}$/.test(nom) || !sk.fichiers || typeof sk.fichiers !== "object") return false;
  const dossier = join(here, ".claude", "skills", nom);
  const entrees = Object.entries(sk.fichiers).filter(([chemin, contenu]) => /^[A-Za-z0-9._/-]{1,120}$/.test(chemin) && !chemin.split("/").includes("..") && !chemin.startsWith("/") && typeof contenu === "string");
  if (!entrees.some(([c]) => c === "SKILL.md")) return false;
  rmSync(dossier, { recursive: true, force: true });
  for (const [chemin, contenu] of entrees) {
    const f = join(dossier, chemin);
    if (!resolve(f).startsWith(resolve(dossier) + sep)) continue;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, contenu);
  }
  return true;
}

/** Le pouls : signe de vie, nouvelles de l'app, demandes, réglages et commandes. Renvoie { demandes, evenements }. */
async function prendrePouls(env, token, chatId, here, fil) {
  const fichierCommandes = join(here, "etat/commandes.txt");
  const local = existsSync(fichierCommandes) ? { texte: readFileSync(fichierCommandes, "utf8"), maj_le: statSync(fichierCommandes).mtime.toISOString() } : undefined;
  const fichierSkills = join(here, "etat/skills-privees-version");
  const skillsVersion = existsSync(fichierSkills) ? readFileSync(fichierSkills, "utf8").trim() : "";
  const r = await pont(env, { action: "pouls", commandes: local, skills_version: skillsVersion });
  if (!r) return { demandes: [], evenements: [] };
  // Le serveur n'a pas pu lire une table (droits, panne) : noté, et Marc prévenu une fois par jour.
  if (Array.isArray(r.erreurs) && r.erreurs.length) {
    console.error(`${new Date().toISOString()} pont : ${r.erreurs.join(" ; ")}`);
    const f = join(here, "etat/pont-erreur-signalee");
    const jour = new Date().toISOString().slice(0, 10);
    if (!existsSync(f) || readFileSync(f, "utf8").trim() !== jour) {
      writeFileSync(f, jour);
      await send(token, chatId, { text: `🔴 Le pont avec l'app répond mal : ${r.erreurs.join(" ; ")}. Les nouvelles de l'app ou tes demandes peuvent ne pas m'arriver. Dis-le à Claude (session Dev).`, md: false }).catch(() => {});
    }
  }
  // Les skills faites pour Marc (hors du dépôt public) : écrites dans .claude/skills quand elles changent.
  if (Array.isArray(r.skills) && r.skills.length) {
    let ok = true;
    for (const sk of r.skills) ok = ecrireSkill(here, sk) && ok;
    if (ok && r.skills_version) writeFileSync(fichierSkills, String(r.skills_version));
  }
  const fr = join(here, "etat/reglages.json");
  const neuf = JSON.stringify(r.reglages ?? {}, null, 1);
  if (r.reglages && (!existsSync(fr) || readFileSync(fr, "utf8") !== neuf)) writeFileSync(fr, neuf);
  // Commandes changées dans l'app : le fichier de l'iMac et le menu « / » suivent.
  if (r.commandes?.texte && r.commandes.texte !== local?.texte) {
    writeFileSync(fichierCommandes, r.commandes.texte.endsWith("\n") ? r.commandes.texte : `${r.commandes.texte}\n`);
    const t = new Date(r.commandes.maj_le);
    if (!Number.isNaN(t.getTime())) utimesSync(fichierCommandes, t, t);
    await mettreMenu(token, chatId, here).catch(() => {});
  }
  if (r.etait_hors_ligne) {
    await send(token, chatId, { text: "Je suis de nouveau en ligne. Ce que tu m'as écrit pendant la coupure, je le traite maintenant.", md: false }).catch(() => {});
    appendFileSync(fil, `\n### ${stamp()} · Alfred\nDe nouveau en ligne.\n`);
  }
  return { demandes: Array.isArray(r.demandes) ? r.demandes : [], evenements: Array.isArray(r.evenements) ? r.evenements : [] };
}

/**
 * Une seule écoute à la fois : etat/ecoute.pid garde le numéro de l'écoute en cours ; une autre
 * encore vivante (restée d'avant une mise à jour) est arrêtée avant de commencer.
 */
export function prendreLaPlace(here, tuer = (pid) => process.kill(pid, "SIGTERM"), enVie = vivant) {
  const f = join(here, "etat/ecoute.pid");
  const ancien = Number(existsSync(f) ? readFileSync(f, "utf8").trim() : 0);
  if (ancien && ancien !== process.pid && enVie(ancien)) {
    try {
      tuer(ancien);
      console.error(`${new Date().toISOString()} ancienne écoute ${ancien} arrêtée.`);
    } catch {
      // déjà partie
    }
  }
  writeFileSync(f, String(process.pid));
  return ancien;
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  const here = fileURLToPath(new URL(".", import.meta.url));

  // Pièce jointe d'un mail (Spark) : copiée dans etat/envoi, elle part avec le prochain envoi à Marc.
  // Pas besoin du bot ici : rien ne part tant que le dossier n'est pas envoyé.
  if (mode === "joindre") {
    if (!/^\d+$/.test(arg ?? "")) throw new Error("Usage : node telegram.mjs joindre <id de la pièce jointe dans Spark> [ordre]");
    // Seulement une pièce jointe d'une boîte de TTP Creators (spark.mjs refuse les autres boîtes).
    let info;
    try {
      ({ info } = await pieceAutorisee(arg));
    } catch (e) {
      throw new Error(`pièce jointe ${arg} refusée : ${e.message}`);
    }
    const refus = refusPiece(info);
    if (refus) throw new Error(refus);
    const envoi = dossierEnvoi(process.env.ALFRED_ENVOI);
    const dir = join(here, envoi);
    mkdirSync(dir, { recursive: true });
    const nom = nomPieceJointe(info.name, process.argv[4]);
    copyFileSync(info.path, join(dir, nom));
    console.log(`Pièce jointe prête : ${envoi}/${nom} (${Math.ceil(Number(info.size) / 1024)} Ko). Elle part à Marc avec ton message.`);
    return;
  }

  const env = readEnv(join(here, "config.env"));
  const token = env.ALFRED_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Jeton du bot d'Alfred ou identifiant de Marc manquant dans config.env (./installer.sh --bot).");
  const fil = join(here, "etat/conversation.md");

  // Les raccourcis des créateurs dans le menu « / » de Telegram (seulement dans la discussion de Marc).
  if (mode === "raccourcis") {
    const { commandes, refus } = await mettreMenu(token, chatId, here);
    console.log(`Menu à jour : ${commandes.length} commande(s) et raccourci(s)${refus.length ? ` ; ignoré(s) (lettres minuscules, chiffres et _ seulement, sans doublon) : ${refus.join(" | ")}` : ""}.`);
    return;
  }

  // Un fichier de l'iMac à joindre à un mail (demande de Marc, 19 novembre 2026) : déposé dans le
  // stockage de l'app par le pont ; creer_brouillon_mail le joint avec { document: <chemin> }.
  // Seulement un fichier du dossier etat/ d'Alfred (contrat fabriqué, pièce reçue, preview).
  if (mode === "deposer") {
    const src = resolve(here, String(arg ?? ""));
    if (!src.startsWith(join(here, "etat") + sep) || !existsSync(src)) return console.log("Donne un fichier de etat/ (etat/envoi/…, etat/previews/…, etat/pieces/…).");
    const taille = statSync(src).size;
    if (taille > 10 * 1024 * 1024) return console.log(`Fichier trop lourd (${Math.round(taille / 1048576)} Mo, 10 Mo au plus) : envoie un lien à la place.`);
    const r = await pont(env, { action: "deposer", nom: nomAffiche(src.split(sep).pop()), contenu: readFileSync(src).toString("base64") });
    if (!r?.path) return console.log(`Dépôt refusé${r?.error ? ` (${r.error})` : ""} : PDF, image, Word, Excel, PowerPoint ou CSV.`);
    console.log(`Déposé : ${r.nom}. Pour le joindre : creer_brouillon_mail avec pieces_jointes [{ "document": "${r.path}" }]`);
    return;
  }

  // Une pièce jointe d'un mail des boîtes reliées à l'app (partnerships, talent, boîte d'un créateur),
  // copiée dans etat/pieces pour qu'Alfred la lise quand Marc le demande (24 novembre 2026) :
  //   node telegram.mjs piece-mail <boîte> <id du fil> "<nom du fichier, comme lire_mail l'écrit>"
  if (mode === "piece-mail") {
    const [boite, fil, ...reste] = process.argv.slice(3);
    const nom = reste.join(" ").trim();
    if (!boite || !fil || !nom) return console.log('Usage : node telegram.mjs piece-mail <boîte> <id du fil> "<nom du fichier>" (boîte, fil et noms des pièces : rechercher_mails puis lire_mail).');
    const r = await pont(env, { action: "piece_mail", boite, fil, nom }, { attente: 90_000, erreurs: true });
    if (!r?.contenu) return console.log(`Pièce jointe pas récupérée : ${r?.error ?? "réponse vide"}. Vérifie le nom exact avec lire_mail ; sinon, dis à Marc de te la transférer sur Telegram.`);
    const dir = join(here, "etat", "pieces");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, nomPieceMail(r.nom));
    writeFileSync(dest, Buffer.from(r.contenu, "base64"));
    const rel = dest.replace(join(here, ""), "");
    const quoi = /^video\//.test(r.type) || VIDEO_EXT.test(r.nom)
      ? `C'est une vidéo : node telegram.mjs preparer "${rel}" te donne ses images et sa transcription.`
      : /pdf|image\//.test(r.type) ? "Lis la avec Read (un PDF de plus de 10 pages : par tranches de 20 avec pages)." : "Lis la avec Read ; un document Word ou Excel illisible : demande le PDF.";
    console.log(`Pièce jointe prête : ${rel} (${Math.ceil(statSync(dest).size / 1024)} Ko). ${quoi}`);
    return;
  }

  // Une photo téléversée sur l'app, seulement quand Marc le demande (24 novembre 2026) :
  //   node telegram.mjs photo <etat/…> [createur:<id> | mediakit:<id>:<cle>]
  //   node telegram.mjs photo --remettre "<ancienne adresse ou vide>" <cible>   (bouton Annuler)
  if (mode === "photo") {
    if (arg === "--remettre") {
      const [ancienne, cible] = process.argv.slice(4);
      const r = await pont(env, { action: "photo", cible, remettre: ancienne || null }, { erreurs: true });
      return console.log(r?.ok ? `Remis comme avant${r.createur ? ` pour ${r.createur}` : ""}.` : `Pas remis : ${r?.error}.`);
    }
    const src = resolve(here, String(arg ?? ""));
    if (!src.startsWith(join(here, "etat") + sep) || !existsSync(src)) return console.log("Donne une photo de etat/ (etat/previews/… pour une photo que Marc t'a envoyée, etat/pieces/… pour une pièce jointe).");
    if (statSync(src).size > 10 * 1024 * 1024) return console.log("Photo de plus de 10 Mo : demande à Marc une version plus légère.");
    const cible = process.argv[4] ?? "";
    const r = await pont(env, { action: "photo", nom: src.split(sep).pop(), contenu: readFileSync(src).toString("base64"), cible }, { attente: 60_000, erreurs: true });
    if (!r?.url) return console.log(`Photo pas téléversée : ${r?.error ?? "réponse vide"}.`);
    const ou = cible.startsWith("createur:") ? `photo de profil de ${r.createur}` : cible.startsWith("mediakit:") ? `media kit de ${r.createur} (${cible.split(":")[2]})` : "stockage de l'app (rien d'autre n'a changé)";
    console.log(`Photo en ligne : ${r.url}\nRangée : ${ou}.${cible ? `\nPour Annuler : node telegram.mjs photo --remettre "${r.avant ?? ""}" ${cible}` : ""}`);
    return;
  }

  // Fin d'un passage (alfred.sh) : l'app affiche « dernier passage : point du soir à 17 h 02 ».
  if (mode === "passage") {
    await pont(env, { action: "passage", passage: String(arg ?? "") });
    return;
  }

  // Les boutons fixes en bas de l'écran (Point, À valider, Mails, Créateurs, Argent) : envoyés une
  // fois par version (mise-a-jour.sh), ils restent ensuite à la place du clavier.
  if (mode === "clavier") {
    const fichier = join(here, "etat/clavier-version");
    if (arg !== "--forcer" && existsSync(fichier) && readFileSync(fichier, "utf8").trim() === VERSION_CLAVIER) return console.log("Clavier déjà en place.");
    const res = await api(token, "sendMessage", {
      chat_id: chatId,
      text: "Tes raccourcis sont en bas de l'écran : Point, À valider, Mails, Créateurs, Argent. Un toucher suffit.",
      disable_notification: true,
      reply_markup: { keyboard: BOUTONS_FIXES.map((l) => l.map((text) => ({ text }))), is_persistent: true, resize_keyboard: true },
    });
    if (!res.ok) throw new Error(`Telegram a refusé le clavier : ${res.description ?? "erreur inconnue"}`);
    writeFileSync(fichier, VERSION_CLAVIER);
    return console.log("Clavier envoyé.");
  }

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
    const { kept: recus, next } = marcMessages(res.result, chatId, offset);
    // Boutons d'action : 1er toucher = demande de confirmation ; seul « Confirmer » passe à Alfred.
    const attenteFile = join(here, "etat/boutons-attente.json");
    let attente = {};
    try {
      attente = existsSync(attenteFile) ? JSON.parse(readFileSync(attenteFile, "utf8")) : {};
    } catch {
      attente = {};
    }
    // Une demande vieille de plus de 2 jours n'est plus valable.
    let change = false;
    for (const [k, v] of Object.entries(attente)) {
      if (Date.now() - Number(v.at ?? 0) > 2 * 86_400_000) {
        delete attente[k];
        change = true;
      }
    }
    const clavierDe = (t, inline_keyboard) =>
      t.chat && t.message ? api(token, "editMessageReplyMarkup", { chat_id: t.chat, message_id: t.message, reply_markup: { inline_keyboard } }).catch(() => {}) : null;
    const repondre = (t, text) => api(token, "answerCallbackQuery", { callback_query_id: t.id, text }).catch(() => {});
    const kept = [];
    for (const m of recus) {
      if (!m.toucher) {
        kept.push(m);
        continue;
      }
      const t = m.toucher;
      change = true;
      // « J'ai envoyé » : rien ne part, pas de confirmation ; le bouton devient « Envoyé ✓ ».
      if (String(t.data).startsWith(ENVOYE)) {
        await clavierDe(t, t.clavier.map((l) => l.map((b) => (b.callback_data === t.data ? { text: "Envoyé ✓", callback_data: "deja-envoye" } : b))));
        await repondre(t, "Noté, Alfred met la to-do à jour.");
        kept.push({ ...m, text: messageEnvoye(t.data) });
        continue;
      }
      if (t.data === "deja-envoye") {
        await repondre(t, "Déjà noté.");
        continue;
      }
      // Modifier : Marc répond avec sa correction, sans réveiller Alfred pour rien (demande de Marc, 17/11/2026).
      if (String(t.data).startsWith(MODIFIER)) {
        const qui = String(t.data).slice(MODIFIER.length);
        await repondre(t, "Écris ta correction en réponse.");
        await api(token, "sendMessage", {
          chat_id: chatId,
          text: `Ta correction pour le mail ${qui} ? Réponds à ce message (« plus court », « enlève le prix », ou le texte à mettre).`,
          reply_parameters: { message_id: t.message, allow_sending_without_reply: true },
          reply_markup: { force_reply: true, input_field_placeholder: `Correction du mail ${qui}`.slice(0, 64) },
        }).catch(() => {});
        continue;
      }
      // Plus tard : ce soir 17 h ou demain 9 h, rangé dans la liste à valider.
      if (String(t.data).startsWith(PLUS_TARD_QUAND)) {
        const [quand, ...rest] = String(t.data).slice(PLUS_TARD_QUAND.length).split(":");
        const qui = rest.join(":");
        appendFileSync(join(here, "etat/a-valider.md"), `${ligneRemise(quand, qui)}\n`);
        await clavierDe(t, [[{ text: quand === "demain" ? "Remis à demain 9 h ✓" : "Remis à 17 h ✓", callback_data: "deja-envoye" }]]);
        await repondre(t, quand === "demain" ? "Je te le remets demain à 9 h." : "Je te le remets à 17 h.");
        appendFileSync(fil, `\n### ${stamp()} · Marc\nMail ${qui} remis à plus tard (${quand === "demain" ? "demain 9 h" : "ce soir 17 h"})\n`);
        continue;
      }
      if (String(t.data).startsWith(PLUS_TARD)) {
        const qui = String(t.data).slice(PLUS_TARD.length);
        attente[`pt${String(t.message).slice(-8)}`] = { data: t.data, libelle: "Plus tard", clavier: t.clavier, at: Date.now() };
        await clavierDe(t, [...clavierPlusTard(qui), [{ text: "Retour", callback_data: `non:pt${String(t.message).slice(-8)}` }]]);
        await repondre(t, "Quand veux-tu le revoir ?");
        continue;
      }
      const libelle = /« (.+) »\)$/.exec(m.text)?.[1] ?? "Envoyer";
      const etape = etapeToucher(t.data, attente, libelle);
      if (etape.action === "direct") {
        await clavierDe(t, t.clavier.map((l) => l.map((b) => (b.callback_data === t.data ? { text: "Envoyé ✓", callback_data: "deja-envoye" } : b))));
        await repondre(t, "Envoyé. Alfred met la to-do à jour.");
        kept.push({ ...m, text: `${t.data} (bouton « Envoyer », confirmé)` });
      } else if (etape.action === "demander") {
        const id = Math.random().toString(36).slice(2, 10);
        attente[id] = { data: t.data, libelle, clavier: t.clavier, at: Date.now() };
        await clavierDe(t, clavierConfirmation(id, libelle));
        await repondre(t, "Touche Confirmer pour valider.");
      } else if (etape.action === "valider") {
        const e = etape.entree;
        delete attente[etape.id];
        await clavierDe(t, e.clavier.map((l) => l.filter((b) => b.callback_data !== e.data)).filter((l) => l.length));
        await repondre(t, "C'est noté, Alfred s'en occupe.");
        kept.push({ ...m, text: `${e.data} (bouton « ${e.libelle} », confirmé)` });
      } else if (etape.action === "annuler") {
        delete attente[etape.id];
        await clavierDe(t, etape.entree.clavier);
        await repondre(t, "Annulé.");
      } else {
        await repondre(t, "Ce bouton a expiré : écris ta demande à Alfred.");
      }
    }
    if (change) writeFileSync(attenteFile, JSON.stringify(attente));
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
      // Bouton fixe du bas de l'écran (« Point », « À valider »…) : la commande qu'il vaut.
      const fixe = !m.toucher && commandeFixe(m.text);
      if (fixe) m.text = fixe;
      // 👀 : Marc voit tout de suite que son message est arrivé (👌 quand c'est fait, voir l'écoute).
      if (!m.toucher && m.id) api(token, "setMessageReaction", { chat_id: chatId, message_id: m.id, reaction: [{ type: "emoji", emoji: "👀" }] }).catch(() => {});
      const full = m.reply ? `${m.reply}\n${m.text}` : m.text;
      appendFileSync(join(here, "etat/file-recue.txt"), `[${stamp(m.at)}] ${full}\n\n`);
      // Pour qu'Alfred réponde en citant ce message (comme « Répondre » sur Telegram).
      if (m.id) appendFileSync(join(here, "etat/file-recue-ids.txt"), `${m.id}\n`);
      appendFileSync(fil, `\n### ${stamp(m.at)} · Marc\n${full}\n`);
    }
    // L'offset n'avance qu'une fois les messages rangés : rien ne se perd si on s'arrête avant.
    if (next !== offset) writeFileSync(offsetFile, String(next));
    return kept;
  };

  // Alfred lui même (lien de preview trouvé dans un mail) : node telegram.mjs telecharger <lien>
  // Une vidéo copiée d'une discussion WhatsApp (whatsapp.mjs piece) : images et transcription,
  // comme une preview reçue sur Telegram (demande de Marc, 16 novembre 2026). Seulement etat/pieces/.
  if (mode === "preparer") {
    const src = resolve(here, String(arg ?? ""));
    const pieces = join(here, "etat", "pieces") + sep;
    if (!src.startsWith(pieces) || !existsSync(src)) return console.log("Donne une vidéo copiée dans etat/pieces/ (node whatsapp.mjs piece <n°>).");
    const id = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const model = env.WHISPER_MODEL || join(homedir(), ".cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
    const dir = join(here, "etat", "previews", `${id}-whatsapp`);
    mkdirSync(dir, { recursive: true });
    console.log((await decouperVideo(src, dir, model)).replace(join(here, ""), ""));
    return;
  }

  if (mode === "telecharger") {
    const lien = trouverLien(arg ?? "");
    const reseau = lien ? null : lienReseau(arg ?? "");
    if (!lien && !reseau) return console.log("Lien non reconnu : WeTransfer, SwissTransfer, Google Drive, Dropbox, Instagram, TikTok, YouTube, X, Facebook, Vimeo ou lien direct vers une vidéo.");
    const id = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const model = env.WHISPER_MODEL || join(homedir(), ".cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin");
    const dir = join(here, "etat", "previews", `${id}-${reseau ? "reseau" : "mail"}`);
    console.log((reseau ? await telechargerReseau(reseau, dir, model) : await telechargerVideo(lien, dir, model)).replace(join(here, ""), ""));
    return;
  }

  if (mode === "recevoir") {
    console.log((await ranger(0)).length);
    return;
  }

  // Écoute en continu (launchd, com.ttp.alfred.ecoute) : dès que Marc écrit, Alfred répond.
  if (mode === "ecoute") {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Le pouls (demande de Marc, 17 novembre 2026) : chaque minute, l'iMac dit à l'app qu'il est
    // là, et reçoit les nouvelles de l'app et les demandes écrites dans « Demander à Alfred ».
    let dernierPouls = 0;
    const lancer = (args) =>
      new Promise((resolve) => {
        const p = spawn("/bin/zsh", [join(here, "alfred.sh"), ...args], { stdio: "ignore" });
        p.on("exit", (c) => resolve(c));
        p.on("error", () => resolve(1));
      });
    // Pendant un passage, l'écoute attend : un signe de vie par minute, pour que l'app ne le croie pas tombé.
    const vivant = () => pont(env, { action: "vivant" });
    const fichierEv = join(here, "etat/evenements.txt");
    // Stabilité (coupure du 20 novembre 2026, 4 h à 10 h, après la mise à jour de nuit) :
    // 1. une seule écoute à la fois : deux écoutes qui lisent Telegram en même temps se font
    //    refuser toutes les deux (erreur 409), et plus rien ne passe ;
    prendreLaPlace(here);
    // 2. le signe de vie part chaque minute, que Telegram réponde ou non (avant, il attendait une
    //    lecture réussie de Telegram, et se taisait alors que l'iMac était allumé) ;
    // 3. Telegram en échec depuis 10 minutes : l'écoute s'arrête, launchd la relance à neuf (30 s).
    let telegramOkLe = Date.now();
    const coeurPermanent = setInterval(() => {
      writeFileSync(join(here, "etat/ecoute-vu"), String(Date.now()));
      vivant().catch(() => {});
      if (Date.now() - telegramOkLe > 10 * 60_000) {
        console.error(`${new Date().toISOString()} Telegram en échec depuis 10 min : l'écoute redémarre.`);
        clearInterval(coeurPermanent);
        process.exit(1);
      }
    }, 60_000);
    writeFileSync(join(here, "etat/ecoute-vu"), String(Date.now()));
    for (;;) {
      let n = 0;
      let recus = [];
      try {
        recus = await ranger(dernierPouls ? 45 : 0);
        n = recus.length;
        telegramOkLe = Date.now();
      } catch (e) {
        console.error(`${new Date().toISOString()} ${e.message}`);
        await sleep(e.code === 409 ? 30_000 : 5_000);
        continue;
      }
      let demandes = [];
      if (Date.now() - dernierPouls >= 45_000) {
        dernierPouls = Date.now();
        const p = await prendrePouls(env, token, chatId, here, fil).catch(() => ({ demandes: [], evenements: [] }));
        demandes = p.demandes;
        if (p.evenements.length) appendFileSync(fichierEv, `${p.evenements.map(ligneEvenement).join("\n")}\n`);
      }
      // Une demande écrite dans l'app : rangée comme un message de Marc (avec qui l'a écrite).
      for (const d of demandes) {
        const texte = messageDemande(d);
        appendFileSync(join(here, "etat/file-recue.txt"), `[${stamp(new Date(d.cree_le ?? Date.now()))}] ${texte}\n\n`);
        appendFileSync(fil, `\n### ${stamp(new Date(d.cree_le ?? Date.now()))} · Marc (depuis l'app)\n${texte}\n`);
      }
      n += demandes.length;
      // Une réponse remise à plus tard (limite de l'abonnement Claude, Claude surchargé) : relancée
      // toute seule à l'heure prévue, tant que des messages de Marc attendent (passage.mjs).
      const reprise = n ? null : repriseDue(here);
      if (!n && !reprise) {
        // Seulement des nouvelles de l'app : un passage court et silencieux (rien à dire, rien n'arrive à Marc).
        if (existsSync(fichierEv) && readFileSync(fichierEv, "utf8").trim()) {
          const lu = join(here, "etat/evenements-lus.txt");
          writeFileSync(lu, readFileSync(fichierEv, "utf8"));
          rmSync(fichierEv, { force: true });
          const coeur = setInterval(vivant, 60_000);
          const c = await lancer(["--evenements"]);
          clearInterval(coeur);
          // Raté : les nouvelles reviennent dans la file pour le prochain essai.
          if (c !== 0) appendFileSync(fichierEv, readFileSync(lu, "utf8"));
        }
        continue;
      }
      const debutFil = existsSync(fil) ? readFileSync(fil, "utf8").length : 0;
      // « Alfred est en train d'écrire… » pendant tout le passage.
      const typing = () => api(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
      typing();
      const tick = setInterval(typing, 4_000);
      const coeur = setInterval(vivant, 60_000);
      const code = await lancer(["--reponse", ...(reprise ? ["reprise"] : [])]);
      clearInterval(tick);
      clearInterval(coeur);
      // Les demandes de l'app reçoivent la réponse d'Alfred, visible aussi dans l'app.
      if (demandes.length) {
        const texte = reponseDepuis(readFileSync(fil, "utf8"), debutFil) || (code === 0 ? "" : "Alfred n'a pas pu répondre : il réessaie, ou redemande sur Telegram.");
        await pont(env, { action: "reponse", demandes: demandes.map((d) => d.id), texte });
      }
      // 👌 sur les messages de Marc traités (Telegram n'a pas de ✅ parmi ses réactions).
      if (code === 0) for (const m of recus) if (!m.toucher && m.id) api(token, "setMessageReaction", { chat_id: chatId, message_id: m.id, reaction: [{ type: "emoji", emoji: "👌" }] }).catch(() => {});
      // Le passage relancé n'a pas pu se faire (il n'a pas touché à la reprise) : on l'oublie, pour ne pas boucler.
      if (reprise) oublierRepriseSi(here, reprise);
    }
  }


  // Réponse rapide : chaque fichier part dès qu'il est écrit, tant que Claude travaille.
  if (mode === "suivre") {
    const dir = arg ?? "etat/envoi-reponse";
    const pid = Number(process.argv[4]);
    if (!pid) throw new Error("Usage : node telegram.mjs suivre <dossier> <pid de Claude>");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let total = 0;
    // Le message d'avancement (demande de Marc, 17 novembre 2026) : Alfred écrit dans
    // <dossier>/.avancement ce qu'il fait (« Je lis le fil Prison Island… ») ; un seul message,
    // mis à jour, puis retiré quand la réponse est partie.
    const avancement = join(dir, ".avancement");
    let avId = null;
    let avTexte = "";
    for (;;) {
      const encore = vivant(pid);
      if (existsSync(avancement)) {
        const t = readFileSync(avancement, "utf8").trim().split("\n").pop()?.slice(0, 200) ?? "";
        if (t && t !== avTexte) {
          avTexte = t;
          if (avId) await api(token, "editMessageText", { chat_id: chatId, message_id: avId, text: `⏳ ${t}` }).catch(() => {});
          else avId = await send(token, chatId, { text: `⏳ ${t}`, md: false }, null, { silence: true }).catch(() => null);
        }
      }
      const names = fichiersPrets(lireDossier(dir), Date.now());
      if (names.length) {
        try {
          total += await envoyerFichiers({ token, chatId, here, dir, names, fil, supprimer: true });
        } catch (e) {
          console.error(`${new Date().toISOString()} envoi au fil de l'eau : ${e.message}`);
        }
      }
      // Claude a fini : ce qui reste (écrit dans les dernières secondes) part avec « dossier ».
      if (!encore) break;
      await sleep(1000);
    }
    if (avId) await api(token, "deleteMessage", { chat_id: chatId, message_id: avId }).catch(() => {});
    rmSync(avancement, { force: true });
    console.log(`${total} message(s) envoyé(s) au fil de l'eau.`);
    return;
  }

  if (mode === "texte") {
    for (const m of messagesFor("alerte.txt", arg ?? "")) {
      await send(token, chatId, m);
      appendFileSync(fil, `\n### ${stamp()} · Alfred\n${m.plain ?? m.text}\n`);
    }
    return console.log("Message envoyé à Marc sur Telegram.");
  }
  if (mode !== "dossier") throw new Error("Usage : node telegram.mjs dossier <chemin> | texte <message> | recevoir | rappels | ecoute | joindre <id> [ordre] | suivre <dossier> <pid>");
  const dir = arg ?? "etat/envoi";
  const names = lireDossier(dir).filter((e) => !e.name.startsWith(".")).map((e) => e.name).sort();
  const n = await envoyerFichiers({ token, chatId, here, dir, names, fil });
  console.log(`${n} message(s) envoyé(s) à Marc sur Telegram.`);
}

// pathToFileURL : marche aussi quand le chemin contient des espaces.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

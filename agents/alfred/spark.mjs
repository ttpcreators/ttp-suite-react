// ============================================================================
// spark.mjs : la seule porte d'Alfred vers Spark, limitée aux boîtes de TTP Creators.
//
// Spark Desktop peut contenir d'autres boîtes que celles de l'agence (un autre projet, une
// boîte perso). Alfred n'a pas le droit d'appeler `spark` lui même : il passe par ce script,
// qui refuse toute boîte hors de la liste.
//
// La liste : les adresses en @ttpcreators.pro, plus celles de ALFRED_SPARK_BOITES dans
// config.env (sur le Mac seulement, jamais dans le dépôt ; Alfred ne peut pas modifier ce
// fichier). Exemple, adresses séparées par des espaces ou des virgules :
//   ALFRED_SPARK_BOITES="contact.lea@example.com nova.pro@example.com"
//
//   node spark.mjs accounts                       les boîtes autorisées (JSON)
//   node spark.mjs search [<sujet>] --in <boîte>[:Dossier] [--filter …] [--json] …
//   node spark.mjs emails <boîte>[:Dossier] [--filter …] [--json] …
//   node spark.mjs thread <id ou lien Spark> [--json] [--download-attachments] [--include-quoted]
//   node spark.mjs attachment <id> [--json]       copie le fichier dans etat/pieces/ et donne ce chemin
//   node spark.mjs draft --account <boîte> [--reply-all <id> | --reply-to <id> | --forward <id> | --edit <id>]
//                        [--to …] [--cc …] [--bcc …] [--subject …] [--body …] [--attach <fichier d'etat/>]
//                        [--attach-id <id>] [--no-signature] [--json]
// Tout le reste (supprimer, partager, envoyer, actions) est refusé.
// ============================================================================

import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const DOMAINE = "@ttpcreators.pro";

// ── Logique pure (testée) ───────────────────────────────────────────────────

/** Les boîtes ajoutées dans config.env (ALFRED_SPARK_BOITES), en minuscules. */
export function listeBoites(valeur) {
  return String(valeur ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s));
}

/** Une boîte d'Alfred : une adresse de l'agence, ou une adresse de la liste. */
export function boiteAutorisee(adresse, liste) {
  const a = String(adresse ?? "").trim().toLowerCase();
  if (!/^[^@\s:]+@[^@\s:]+$/.test(a)) return false;
  return a.endsWith(DOMAINE) || liste.includes(a);
}

/** « boite@x.fr:Archive » → « boite@x.fr » ; null pour un dossier commun (« Inbox ») ou une équipe. */
export function boiteDePortee(portee) {
  const b = String(portee ?? "").split(":")[0].trim().toLowerCase();
  return b.includes("@") ? b : null;
}

/** La boîte d'un mail, lue dans son lien Spark (le jeton contient « A:<boîte>;ID:… ») ; null si illisible. */
export function boiteDeLien(lien) {
  try {
    const jeton = new URL(String(lien)).searchParams.get("token");
    if (!jeton) return null;
    const texte = Buffer.from(jeton.replace(/\s+/g, ""), "base64").toString("utf8");
    return /^A:([^;\s]+@[^;\s]+);/.exec(texte)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

const VALEURS = {
  search: ["--filter", "--in", "--page", "--page-size", "--limit", "--order"],
  emails: ["--filter", "--page", "--page-size", "--limit", "--order"],
  thread: [],
  attachment: [],
  draft: ["--to", "--cc", "--bcc", "--subject", "--body", "--account", "--edit", "--reply-to", "--reply-all", "--forward", "--attach", "--attach-id"],
};
const DRAPEAUX = {
  search: ["--json", "--include-quoted"],
  emails: ["--json", "--new-senders"],
  thread: ["--json", "--download-attachments", "--include-quoted"],
  attachment: ["--json"],
  draft: ["--json", "--no-signature"],
};

/**
 * Découpe les arguments d'une sous-commande : options à valeur (répétables), drapeaux et
 * arguments libres. Une option inconnue (supprimer, partager, envoyer…) est une erreur.
 */
export function lireArgs(cmd, args) {
  const valeurs = VALEURS[cmd];
  const drapeaux = DRAPEAUX[cmd];
  if (!valeurs) throw new Error(`commande Spark non autorisée : ${cmd ?? "(aucune)"}`);
  const opts = {};
  const libres = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (!a.startsWith("--")) {
      libres.push(a);
      continue;
    }
    const [nom, egal] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    if (drapeaux.includes(nom) && egal === undefined) {
      opts[nom] = true;
    } else if (valeurs.includes(nom)) {
      const v = egal ?? args[++i];
      if (v === undefined) throw new Error(`${nom} attend une valeur`);
      (opts[nom] ??= []).push(String(v));
    } else {
      throw new Error(`option refusée pour Alfred : ${nom}`);
    }
  }
  return { opts, libres };
}

/** La raison du refus d'une recherche ou d'une liste, ou null : chaque portée doit être une boîte autorisée. */
export function refusPortees(portees, liste) {
  if (!portees.length) return "précise la boîte : --in <boîte> (Alfred ne cherche jamais dans toutes les boîtes à la fois)";
  for (const p of portees) {
    const b = boiteDePortee(p);
    if (!b) return `« ${p} » n'est pas une boîte : donne l'adresse de la boîte (boite@exemple.fr ou boite@exemple.fr:Dossier)`;
    if (!boiteAutorisee(b, liste)) return `la boîte ${b} n'est pas une boîte de TTP Creators : Alfred n'y a pas accès`;
  }
  return null;
}

/** Garde seulement les boîtes autorisées dans la réponse de `spark accounts --json`. */
export function filtrerComptes(donnees, liste) {
  const garder = (x) => boiteAutorisee(x?.email, liste);
  const accounts = (donnees?.accounts ?? []).filter(garder).map((a) => ({
    ...a,
    ...(Array.isArray(a.shared_inboxes) ? { shared_inboxes: a.shared_inboxes.filter(garder) } : {}),
  }));
  return { accounts };
}

// ── Appels à Spark ──────────────────────────────────────────────────────────

const here = fileURLToPath(new URL(".", import.meta.url));

function lireConfig() {
  const f = join(here, "config.env");
  if (!existsSync(f)) return {};
  const env = {};
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

export const boitesDuMac = () => listeBoites(lireConfig().ALFRED_SPARK_BOITES);

async function spark(args, { json = false } = {}) {
  try {
    const { stdout } = await promisify(execFile)("spark", args, { maxBuffer: 32 << 20 });
    return json ? JSON.parse(stdout) : stdout;
  } catch (e) {
    const detail = /"message"\s*:\s*"([^"]+)"/.exec(String(e.stdout ?? ""))?.[1] ?? String(e.stderr || e.message).trim().split("\n")[0];
    throw new Error(`Spark : ${detail}`);
  }
}

/** La boîte d'un mail (id ou lien Spark), ou une erreur si elle n'est pas autorisée. */
export async function verifierMail(idOuLien, liste) {
  const s = String(idOuLien ?? "");
  let boite = /^https?:\/\//.test(s) ? boiteDeLien(s) : null;
  if (!boite) {
    if (!/^\d+$/.test(s)) throw new Error(`id de mail invalide : ${s}`);
    boite = boiteDeLien((await spark(["thread", "--json", s], { json: true }))?.link);
  }
  if (!boite) throw new Error(`boîte du mail ${s} introuvable : refusé par prudence`);
  if (!boiteAutorisee(boite, liste)) throw new Error(`ce mail est dans ${boite}, qui n'est pas une boîte de TTP Creators : Alfred n'y a pas accès`);
  return boite;
}

/** Une pièce jointe d'une boîte autorisée : ses infos (`spark attachment --json`) et sa boîte. */
export async function pieceAutorisee(id, liste = boitesDuMac()) {
  if (!/^\d+$/.test(String(id ?? ""))) throw new Error("id de pièce jointe invalide");
  const info = await spark(["attachment", "--json", String(id)], { json: true });
  if (!info?.message_id) throw new Error(`pièce jointe ${id} introuvable dans Spark`);
  const boite = await verifierMail(String(info.message_id), liste);
  return { info, boite };
}

const nomSur = (n) => String(n).normalize("NFC").replace(/[\/\\:\0]/g, "-").replace(/^[.\s]+/, "").slice(0, 120) || "fichier";

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const liste = boitesDuMac();

  if (cmd === "accounts") {
    if (args.some((a) => a !== "--json")) throw new Error("accounts ne prend pas d'option");
    console.log(JSON.stringify(filtrerComptes(await spark(["accounts", "--json"], { json: true }), liste), null, 2));
    return;
  }

  const { opts, libres } = lireArgs(cmd, args);

  if (cmd === "search" || cmd === "emails") {
    const portees = cmd === "search" ? (opts["--in"] ?? []) : libres;
    if (cmd === "search" && (opts["--in"]?.length ?? 0) > 1) throw new Error("une seule boîte par recherche (--in)");
    if (cmd === "search" && libres.length > 1) throw new Error("un seul sujet de recherche, entre guillemets");
    const refus = refusPortees(portees, liste);
    if (refus) throw new Error(refus);
    process.stdout.write(await spark([cmd, ...args]));
    return;
  }

  if (cmd === "thread") {
    if (libres.length !== 1) throw new Error("Usage : node spark.mjs thread <id ou lien Spark>");
    await verifierMail(libres[0], liste);
    process.stdout.write(await spark(["thread", ...args]));
    return;
  }

  if (cmd === "attachment") {
    if (libres.length !== 1) throw new Error("Usage : node spark.mjs attachment <id>");
    const { info, boite } = await pieceAutorisee(libres[0], liste);
    const dir = join(here, "etat", "pieces");
    mkdirSync(dir, { recursive: true });
    const chemin = join(dir, `${info.id}-${nomSur(info.name)}`);
    copyFileSync(info.path, chemin);
    const sortie = { ...info, path: chemin, account: boite };
    console.log(opts["--json"] ? JSON.stringify(sortie, null, 2) : Object.entries(sortie).map(([k, v]) => `${k}: ${v}`).join("\n"));
    return;
  }

  if (cmd === "draft") {
    if (libres.length) throw new Error(`argument refusé : ${libres[0]} (pas de « signatures » ni de suppression)`);
    const compte = opts["--account"];
    if (compte?.length !== 1) throw new Error("précise la boîte du brouillon : --account <boîte>");
    const boite = compte[0].toLowerCase();
    if (!boiteAutorisee(boite, liste)) throw new Error(`la boîte ${boite} n'est pas une boîte de TTP Creators : Alfred n'y a pas accès`);
    // Un mail se traite dans sa propre boîte : la réponse part de la boîte qui l'a reçu.
    for (const o of ["--edit", "--reply-to", "--reply-all", "--forward"]) {
      for (const id of opts[o] ?? []) {
        const b = await verifierMail(id, liste);
        if (b !== boite) throw new Error(`ce mail est dans ${b} : le brouillon doit partir de cette boîte (--account ${b})`);
      }
    }
    for (const id of opts["--attach-id"] ?? []) await pieceAutorisee(id, liste);
    for (const f of opts["--attach"] ?? []) {
      const r = relative(join(here, "etat"), resolve(here, f));
      if (r.startsWith("..") || isAbsolute(r)) throw new Error(`fichier refusé : ${f} (seulement un fichier du dossier etat/ d'Alfred)`);
    }
    process.stdout.write(await spark(["draft", ...args]));
    return;
  }

  throw new Error(`commande Spark non autorisée : ${cmd ?? "(aucune)"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`Refusé : ${e.message}`);
    process.exit(1);
  });
}

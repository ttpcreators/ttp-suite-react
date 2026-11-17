// ============================================================================
// araignee.mjs : la porte d'Alfred vers l'araignée de Marc (son outil de scraping et de veille).
//
// L'araignée n'est pas dans ce dépôt : c'est le skill « web-crawler » que l'installeur iCloud
// « Installer l'araignée sur ce Mac » copie dans ~/.claude/skills/web-crawler. Alfred ne charge
// pas les skills globaux du Mac (cloisonnement) : il passe par ce script, et seulement par lui.
// Ce que l'araignée fait se voit en direct dans la salle de l'araignée (app Araignée de Marc).
//
//   node araignee.mjs etat                          l'araignée est-elle prête sur ce Mac ?
//   node araignee.mjs site <url> [--pages N]        fait le tour d'un site public (1 à 30 pages, 15 par défaut) :
//                                                   captures, textes, liens, rapport audit.md dans etat/araignee/<dossier>/
//   node araignee.mjs start "<titre>"               ouvre la fenêtre de l'araignée pour un scraping fait à la main
//                                                   (WebFetch, WebSearch, TTP Suite…) et donne son dossier
//   node araignee.mjs now <dossier> <url>           la page qu'Alfred lit en ce moment
//   node araignee.mjs find <dossier> "<texte>" [--ecarte] [--url <url>] [--note "<pourquoi>"]
//                                                   un vrai résultat, au moment où il est trouvé (gardé, ou écarté)
//   node araignee.mjs done <dossier>                fin du scraping
// Jamais de page privée, de connexion, ni d'adresse du Mac ou du réseau local.
// ============================================================================

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SKILL = join(homedir(), ".claude/skills/web-crawler/scripts");
const PLAYWRIGHT = "playwright==1.65.1";
const PATHS = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin"), "/usr/bin", "/bin"];
const INSTALLER = "Il manque l'araignée sur ce Mac : Marc doit double-cliquer « Installer l'araignée sur ce Mac » dans iCloud Drive › Araignée.";

// ── Logique pure (testée) ───────────────────────────────────────────────────

/** Une adresse de page publique (http ou https, jamais le Mac ni le réseau local), ou une erreur. */
export function urlPublique(texte) {
  let u;
  try {
    u = new URL(String(texte ?? "").trim());
  } catch {
    throw new Error(`adresse illisible : ${texte}`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`seulement une page web (http ou https) : ${texte}`);
  if (u.username || u.password) throw new Error("pas d'adresse avec identifiant ou mot de passe");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)
    || h === "::1" || /^f[cd]/.test(h) || /^fe80:/.test(h);
  if (local) throw new Error(`adresse du Mac ou du réseau local refusée : ${h}`);
  return u.href;
}

/** Le nombre de pages d'un tour de site : 15 par défaut, entre 1 et 30. */
export function nbPages(valeur) {
  if (valeur === undefined || valeur === null || valeur === "") return 15;
  const n = Number.parseInt(String(valeur), 10);
  if (!Number.isFinite(n)) throw new Error(`--pages attend un nombre : ${valeur}`);
  return Math.min(30, Math.max(1, n));
}

/** Le dossier d'un tour de site dans etat/araignee/ : « 2026-11-16-1530-marque-fr ». */
export function nomDossier(url, date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const jour = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  const hote = new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${jour}-${hote || "site"}`;
}

/** Un dossier de scraping de l'araignée (~/.araignee/jobs/…), ou une erreur. */
export function dossierAutorise(dossier, maison = homedir()) {
  const jobs = join(maison, ".araignee", "jobs");
  const r = relative(jobs, resolve(String(dossier ?? "")));
  if (!dossier || !r || r.startsWith("..") || isAbsolute(r) || r.includes("/")) throw new Error(`dossier de l'araignée attendu (~/.araignee/jobs/…) : ${dossier}`);
  return join(jobs, r);
}

/** Lit « --cle valeur » et les drapeaux ; le reste dans libres. */
export function lireArgs(args, valeurs, drapeaux) {
  const opts = {}, libres = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valeurs.includes(a)) {
      if (i + 1 >= args.length) throw new Error(`${a} attend une valeur`);
      opts[a] = args[++i];
    } else if (drapeaux.includes(a)) opts[a] = true;
    else if (a.startsWith("--")) throw new Error(`option inconnue : ${a}`);
    else libres.push(a);
  }
  return { opts, libres };
}

// ── Lancement ───────────────────────────────────────────────────────────────

function trouver(nom) {
  for (const d of PATHS) if (existsSync(join(d, nom))) return join(d, nom);
  return null;
}

function lancer(cmd, args, minutes) {
  return new Promise((ok, ko) => {
    const env = { ...process.env, PATH: [...PATHS, process.env.PATH ?? ""].join(":") };
    execFile(cmd, args, { env, timeout: minutes * 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const texte = `${stderr || ""}\n${stdout || ""}`;
        if (/Executable doesn't exist|playwright install/i.test(texte))
          return ko(new Error(`le navigateur de l'araignée manque sur ce Mac : demande à Marc s'il veut le télécharger (environ 110 Mo, commande : uv run --with ${PLAYWRIGHT} playwright install chromium)`));
        if (err.killed) return ko(new Error(`l'araignée a dépassé ${minutes} minutes et a été arrêtée`));
        return ko(new Error((stderr || err.message).trim().split("\n").slice(-3).join(" ")));
      }
      ok(stdout);
    });
  });
}

function pret() {
  const manque = [];
  if (!existsSync(join(SKILL, "crawl.py")) || !existsSync(join(SKILL, "araignee.py"))) manque.push(INSTALLER);
  if (!trouver("uv")) manque.push("Il manque « uv » sur ce Mac (il lance l'araignée) : Marc peut l'installer avec « brew install uv ».");
  if (!trouver("python3")) manque.push("Il manque python3 sur ce Mac.");
  return manque;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === "etat") {
    const manque = pret();
    process.stdout.write(manque.length ? `Pas prête :\n- ${manque.join("\n- ")}\n` : "L'araignée est prête sur ce Mac.\n");
    return;
  }

  const manque = pret();
  if (manque.length) throw new Error(manque.join(" "));
  const py = trouver("python3");
  const A = join(SKILL, "araignee.py");

  if (cmd === "site") {
    const { opts, libres } = lireArgs(args, ["--pages"], []);
    if (libres.length !== 1) throw new Error("usage : node araignee.mjs site <url> [--pages N]");
    const url = urlPublique(libres[0]);
    const n = nbPages(opts["--pages"]);
    const dossier = join(here, "etat", "araignee", nomDossier(url));
    mkdirSync(dossier, { recursive: true });
    // Pages publiques seulement, à un rythme poli (--wait 3), et en direct dans la salle (--live).
    await lancer(trouver("uv"), ["run", "--with", PLAYWRIGHT, "python3", join(SKILL, "crawl.py"), url, "--audit", "--max-pages", String(n), "--wait", "3", "--live", "--output-dir", dossier], 20);
    const rel = relative(here, dossier);
    let pages = "?";
    try { pages = String(JSON.parse(readFileSync(join(dossier, "report.json"), "utf8")).pages_crawled ?? "?"); } catch { /* rapport absent : on donne le dossier */ }
    process.stdout.write(`Fini : ${pages} page(s) lue(s) sur ${new URL(url).hostname}.\nRapport : ${rel}/audit.md\nTextes des pages : ${rel}/pages/\nCaptures : ${rel}/screenshots/\n`);
    return;
  }

  if (cmd === "start") {
    const titre = args.join(" ").trim();
    if (!titre) throw new Error("usage : node araignee.mjs start \"<titre>\"");
    process.stdout.write(await lancer(py, [A, "start", `Alfred · ${titre.slice(0, 80)}`], 1));
    return;
  }

  if (cmd === "now") {
    if (args.length !== 2) throw new Error("usage : node araignee.mjs now <dossier> <url>");
    process.stdout.write(await lancer(py, [A, "now", dossierAutorise(args[0]), urlPublique(args[1])], 1));
    return;
  }

  if (cmd === "find") {
    const { opts, libres } = lireArgs(args, ["--url", "--note"], ["--ecarte"]);
    if (libres.length !== 2) throw new Error("usage : node araignee.mjs find <dossier> \"<texte>\" [--ecarte] [--url <url>] [--note \"<pourquoi>\"]");
    const extra = ["--tone", opts["--ecarte"] ? "violet" : "pink"];
    if (opts["--url"]) extra.push("--url", urlPublique(opts["--url"]));
    if (opts["--note"]) extra.push("--note", String(opts["--note"]).slice(0, 200));
    process.stdout.write(await lancer(py, [A, "find", dossierAutorise(libres[0]), libres[1].slice(0, 200), ...extra], 1));
    return;
  }

  if (cmd === "done") {
    if (args.length !== 1) throw new Error("usage : node araignee.mjs done <dossier>");
    process.stdout.write(await lancer(py, [A, "done", dossierAutorise(args[0])], 1));
    return;
  }

  throw new Error(`commande de l'araignée inconnue : ${cmd ?? "(aucune)"} (etat, site, start, now, find, done)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`Refusé : ${e.message}`);
    process.exit(1);
  });
}

// ============================================================================
// monthly-backup/index.ts : sauvegarde mensuelle envoyée par mail aux fondateurs.
// ----------------------------------------------------------------------------
// Une archive .zip avec :
//   • un CSV par table du travail de l'agence (contacts, roster, collabs, briefs,
//     factures, to-do, mails, DM, liste « ne plus contacter », mémoire d'Alfred…),
//     lisible dans Excel. La liste complète, et les tables exclues exprès (jetons,
//     quotas, journaux, caches) : _shared/backupTables.ts ; une table que la liste ne
//     classe pas est signalée dans le mail (contrôle des tables en base) ;
//   • les réglages de l'agence (blob __app_state__) en JSON, SANS le coffre des mots
//     de passe (credVault) ;
//   • les PDF des media kits publiés sur le site (créateurs + agence) ;
//   • un LISEZMOI.txt, qui dit aussi ce qui n'est pas dans l'archive.
// L'archive est aussi rangée dans Storage, bucket PRIVÉ « backups » (aucune politique :
// seul le serveur y accède ; les membres de l'agence ne voient pas les factures),
// et le mail contient un lien de téléchargement valable 30 jours. Si l'archive dépasse
// 20 Mo, elle n'est pas jointe : le lien suffit.
//
// Appels :
//   • pg_cron, le 1er de chaque mois : Authorization: Bearer <CRON_SECRET> ;
//   • bouton « Envoyer la sauvegarde maintenant » (Paramètres) : JWT d'un FONDATEUR.
// Google Drive : l'archive est aussi rangée dans « TTP Suite · Sauvegardes » (un .zip par
// mois), avec les contacts à part dans « Contacts » (contacts-AAAA-MM.csv + contacts-a-jour.csv).
// Autorisation « drive.file » (l'app ne voit que ses propres fichiers). Sans elle : le mail
// part quand même et dit quoi faire.
// Destinataires : les comptes fondateurs (adresse de connexion), ou la liste
// `backupRecipients` des réglages si elle existe.
// Envoi : boîte partnerships@ (connexion Google de l'app, droit gmail.send).
// verify_jwt = false (config.toml) : l'appel du cron n'est pas un JWT.
// Sortie : { ok, month, files, bytes, attached, recipients } ou { error }.
// État : chaque passage écrit `backupStatus` dans le blob agence (_shared/backupStatus.ts).
// ============================================================================

import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { CRON_SECRET, corsHeaders, getAccessToken, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { readAppState } from "../_shared/appState.ts";
import { backupMonth, mediakitPages, mediakitSlug, mimeMessage, pdfLinksIn, safeAppState, toCsv } from "../_shared/backup.ts";
import { DriveFail, ensureFolder, putFile, type DriveError } from "../_shared/drive.ts";
import { BACKUP_STATUS_KEY, statusFromResult, type BackupResult, type BackupStatus } from "../_shared/backupStatus.ts";
import { fichierCsv, nomTable, type Schema, TABLES_SAUVEES, tablesDeLApi, tablesNonClassees, type TableSauvee, texteExclusions } from "../_shared/backupTables.ts";

const SITE = "https://ttpcreators.pro";
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const ATTACH_MAX = 20 * 1024 * 1024;
const PDF_MAX = 15 * 1024 * 1024;

type Sb = ReturnType<typeof getServiceClient>;

/** Lignes d'une table (schéma public ou agent). `partial` : la lecture s'est arrêtée sur une
 *  erreur (table absente, illisible, ou coupée en route) : la sauvegarde le dit au lieu de
 *  passer pour complète. */
async function allRows(sb: Sb, t: TableSauvee): Promise<{ rows: Record<string, unknown>[]; partial: boolean }> {
  const out: Record<string, unknown>[] = [];
  const cols = t.colonnes ?? "*";
  for (let from = 0; from < 200_000; from += 1000) {
    const q = t.schema === "public" ? sb.from(t.table).select(cols) : sb.schema(t.schema).from(t.table).select(cols);
    const { data, error } = await q.range(from, from + 999);
    if (error) return { rows: out, partial: true };
    // Colonnes choisies à l'exécution : le type déduit par supabase-js ne veut rien dire ici.
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return { rows: out, partial: false };
}

/**
 * Tables réellement en base dans un schéma (description OpenAPI de l'API, clé service),
 * au format de nomTable. null si l'API ne répond pas comme prévu : le contrôle est sauté.
 */
async function tablesEnBase(schema: Schema): Promise<string[] | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json", ...(schema === "public" ? {} : { "Accept-Profile": schema }) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const noms = tablesDeLApi(await r.json());
    return noms ? noms.map((table) => nomTable({ schema, table })) : null;
  } catch {
    return null;
  }
}

async function founderEmails(sb: Sb): Promise<string[]> {
  const { data } = await sb.from("profiles").select("user_id").eq("role", "agency").eq("agency_role", "founder");
  const emails: string[] = [];
  for (const p of (data ?? []) as { user_id: string }[]) {
    const { data: u } = await sb.auth.admin.getUserById(p.user_id);
    const e = u?.user?.email?.trim().toLowerCase();
    if (e && !emails.includes(e)) emails.push(e);
  }
  return emails;
}

async function authorize(req: Request, sb: Sb): Promise<"cron" | "founder" | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!token) return null;
  if (timingSafeEqualStr(token, CRON_SECRET)) return "cron";
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await sb.from("profiles").select("role, agency_role").eq("user_id", data.user.id).maybeSingle<{ role: string; agency_role: string | null }>();
  return prof?.role === "agency" && prof.agency_role === "founder" ? "founder" : null;
}

/**
 * État du passage dans le blob agence (clé `backupStatus`, lue par Paramètres). UNE clé
 * via app_state_set (jsonb_set sous verrou de ligne), jamais le blob entier : si la
 * fonction SQL manque ou que l'écriture rate, la sauvegarde continue sans état.
 */
async function recordStatus(sb: Sb, status: BackupStatus): Promise<void> {
  try {
    const { error } = await sb.rpc("app_state_set", { p_key: BACKUP_STATUS_KEY, p_value: status });
    if (error) console.error("monthly-backup app_state_set", error.message);
  } catch (e) {
    console.error("monthly-backup app_state_set", String(e).slice(0, 200));
  }
}

type Out = { status: number; body: BackupResult & Record<string, unknown> };

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = getServiceClient();
  const who = await authorize(req, sb);
  if (!who) return json({ error: "unauthorized" }, 401);

  // Chaque passage (cron ou bouton) laisse son état : « en cours » au départ, puis le
  // résultat. Un passage coupé net (limite de temps) reste « en cours » : Paramètres
  // l'affiche comme interrompu au bout de 15 minutes.
  const source = who === "cron" ? "cron" : "manuel";
  const startedAt = new Date();
  await recordStatus(sb, { at: startedAt.toISOString(), running: true, source });
  let out: Out;
  try {
    out = await runBackup(sb, startedAt);
  } catch (e) {
    console.error("monthly-backup", String(e).slice(0, 300));
    out = { status: 500, body: { error: "erreur_inattendue" } };
  }
  await recordStatus(sb, statusFromResult(startedAt, new Date(), source, out.body));
  return json(out.body, out.status);
});

async function runBackup(sb: Sb, now: Date): Promise<Out> {
  const month = backupMonth(now);
  const files: Record<string, Uint8Array> = {};
  const counts: { name: string; n: string }[] = [];

  // 1) Tables → CSV (liste complète : _shared/backupTables.ts)
  const missing: string[] = []; // ce qui manque ou est incomplet dans cette sauvegarde
  for (const t of TABLES_SAUVEES) {
    const nom = nomTable(t);
    const { rows, partial } = await allRows(sb, t);
    if (partial) missing.push(rows.length ? `${nom} (incomplète)` : nom);
    if (partial && !rows.length) continue;
    files[fichierCsv(t)] = strToU8(toCsv(rows));
    counts.push({ name: nom, n: `${rows.length} ligne${rows.length > 1 ? "s" : ""}${partial ? " · incomplète" : ""}` });
  }

  // 1 bis) Contrôle : une table en base que la liste ne classe pas (ni sauvegardée, ni exclue
  // exprès) n'est pas dans l'archive : le mail et l'état de la sauvegarde le disent.
  const nonClassees: string[] = [];
  let controle = true;
  for (const schema of ["public", "agent"] as const) {
    const enBase = await tablesEnBase(schema);
    if (!enBase) {
      controle = false;
      console.error("monthly-backup contrôle des tables illisible", schema);
      continue;
    }
    nonClassees.push(...tablesNonClassees(enBase));
  }

  // 2) Réglages de l'agence (sans le coffre)
  let state: Record<string, unknown> = {};
  try {
    state = await readAppState(sb); // ligne commune + ligne argent des fondateurs
  } catch {
    state = {};
    missing.push("réglages de l'agence");
  }
  files["reglages-agence.json"] = strToU8(JSON.stringify(safeAppState(state), null, 2));

  // 3) Media kits publiés (PDF du site)
  let kits = 0;
  try {
    const xml = await (await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(15_000) })).text();
    const pages = mediakitPages(xml, SITE);
    if (!pages.some((p) => p.includes("/mediakit/agence"))) pages.push(`${SITE}/mediakit/agence/`);
    for (const page of pages) {
      const html = await fetch(page, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      const slug = mediakitSlug(page);
      for (const [i, pdf] of pdfLinksIn(html, page).entries()) {
        const r = await fetch(pdf, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!r?.ok) continue;
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > PDF_MAX) continue;
        files[`media-kits/${slug}${i ? `-${i + 1}` : ""}.pdf`] = bytes;
        kits++;
      }
    }
  } catch {
    /* site injoignable : la sauvegarde part quand même, sans les PDF */
  }
  counts.push({ name: "media kits (PDF)", n: String(kits) });

  files["LISEZMOI.txt"] = strToU8(
    `Sauvegarde TTP Suite de ${month}.\r\n\r\n` +
      "donnees/ : un fichier CSV par liste de l'app (ouvrir avec Excel ou Numbers ; séparateur point-virgule).\r\n" +
      "donnees/agent/ : la mémoire, les leçons et le travail d'Alfred.\r\n" +
      "reglages-agence.json : réglages de l'agence (factures, contrats, notes…), sans le coffre des mots de passe.\r\n" +
      "media-kits/ : les media kits publiés sur ttpcreators.pro (créateurs et agence).\r\n\r\n" +
      `${texteExclusions()}\r\n` +
      (nonClassees.length ? `\r\nAttention : tables nouvelles en base, pas encore classées, donc pas sauvegardées : ${nonClassees.join(", ")}.\r\n` : "") +
      "\r\nDocument confidentiel : coordonnées de contacts et données de facturation.\r\n",
  );

  const zip = zipSync(files, { level: 6 });
  const name = `sauvegarde-ttp-${month}.zip`;

  // 4) Rangée dans Storage + lien 30 jours
  const path = name;
  let link = "";
  const up = await sb.storage.from("backups").upload(path, zip, { contentType: "application/zip", upsert: true });
  if (!up.error) {
    const { data: s } = await sb.storage.from("backups").createSignedUrl(path, 30 * 86400);
    link = s?.signedUrl ?? "";
  }

  // 5) Google Drive (même jeton Google que l'envoi du mail)
  let token = "";
  try {
    token = await getAccessToken(sb);
  } catch {
    token = "";
  }
  let drive: "ok" | DriveError | "google_non_connecte" = "google_non_connecte";
  if (token) {
    try {
      const root = await ensureFolder(token, "TTP Suite · Sauvegardes");
      await putFile(token, root, name, "application/zip", zip);
      const contacts = files["donnees/contacts.csv"];
      if (contacts) {
        const dir = await ensureFolder(token, "Contacts", root);
        await putFile(token, dir, `contacts-${month}.csv`, "text/csv", contacts);
        await putFile(token, dir, "contacts-a-jour.csv", "text/csv", contacts);
      }
      drive = "ok";
    } catch (e) {
      drive = e instanceof DriveFail ? e.code : "drive_indisponible";
      console.error("monthly-backup drive", String(e).slice(0, 300));
    }
  }
  const driveNote =
    drive === "ok"
      ? `<p>Rangée aussi dans ton Google Drive : dossier « TTP Suite · Sauvegardes » (les contacts à part dans « Contacts »).</p>`
      : drive === "api_desactivee"
        ? `<p style="color:#b00020">Pas rangée dans Google Drive : l'API Google Drive n'est pas activée pour l'app (console Google Cloud).</p>`
        : drive === "autorisation_manquante"
          ? `<p style="color:#b00020">Pas rangée dans Google Drive : reconnecte Google dans Paramètres pour autoriser Drive.</p>`
          : `<p style="color:#b00020">Pas rangée dans Google Drive cette fois (Drive injoignable).</p>`;

  // 6) Mail aux fondateurs
  const listed = Array.isArray(state.backupRecipients) ? (state.backupRecipients as unknown[]).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) : [];
  // Une sauvegarde contient tout l'argent de l'agence : elle ne part que chez des fondateurs.
  // `backupRecipients` sert seulement à en choisir certains parmi eux.
  const founders = (await founderEmails(sb)).map((x) => x.trim().toLowerCase());
  const chosen = listed.filter((x) => founders.includes(x));
  const to = chosen.length ? chosen : founders;
  if (!to.length) return { status: 409, body: { error: "aucun_destinataire", drive } };
  const attach = zip.length <= ATTACH_MAX;
  const mb = (zip.length / 1024 / 1024).toFixed(1).replace(".", ",");
  // État de la sauvegarde : ce qui n'a pas pu être lu, et les tables pas classées.
  const manque = [...missing, ...nonClassees.map((n) => `${n} (table pas classée)`)];
  const html =
    `<p>Bonjour,</p><p>Voici la sauvegarde mensuelle de TTP Suite (${month}).` +
    (attach ? " L'archive est jointe à ce mail." : ` L'archive fait ${mb} Mo : trop lourde pour être jointe, elle est à télécharger avec le lien ci-dessous.`) +
    `</p>` +
    (missing.length ? `<p style="color:#b00020"><b>Sauvegarde incomplète.</b> Non lu ce jour-là : ${missing.join(", ")}. Relance « Envoyer maintenant » dans Paramètres.</p>` : "") +
    (nonClassees.length ? `<p style="color:#b00020"><b>Tables pas sauvegardées.</b> Nouvelles en base, pas encore classées : ${nonClassees.join(", ")}. À ajouter à la liste de la sauvegarde (_shared/backupTables.ts).</p>` : "") +
    (controle ? "" : `<p style="color:#777;font-size:12px">Contrôle des tables en base impossible ce jour-là : la liste de l'app fait foi.</p>`) +
    (link ? `<p><a href="${link}">Télécharger la sauvegarde (${mb} Mo)</a> · lien valable 30 jours.</p>` : "") +
    driveNote +
    `<table style="border-collapse:collapse;font-size:13px">${counts.map((c) => `<tr><td style="padding:2px 12px 2px 0">${c.name}</td><td style="padding:2px 0;color:#555">${c.n}</td></tr>`).join("")}</table>` +
    `<p style="color:#777;font-size:12px">Le coffre des mots de passe n'est jamais inclus. Garde ce mail en lieu sûr.</p>`;
  const raw = mimeMessage({
    from: `TTP Suite <partnerships@${AGENCY_DOMAIN}>`,
    to,
    subject: `Sauvegarde TTP Suite · ${month}${manque.length ? " · incomplète" : ""}`,
    html,
    attachments: attach ? [{ filename: name, mimeType: "application/zip", bytes: zip }] : [],
  });
  if (!token) return { status: 409, body: { error: "google_non_connecte", stored: !up.error, drive } };
  // Envoi « media » : accepte un mail jusqu'à 35 Mo (le format JSON raw s'arrête à 5 Mo).
  const sent = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
    body: raw,
    signal: AbortSignal.timeout(60_000),
  });
  if (!sent.ok) {
    console.error("monthly-backup send", sent.status, (await sent.text()).slice(0, 300));
    return { status: 502, body: { error: "envoi_echoue", stored: !up.error, drive } };
  }
  return { status: 200, body: { ok: true, month, files: Object.keys(files).length, bytes: zip.length, attached: attach, recipients: to.length, missing: manque, drive } };
}

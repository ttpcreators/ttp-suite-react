// ============================================================================
// monthly-backup/index.ts : sauvegarde mensuelle envoyée par mail aux fondateurs.
// ----------------------------------------------------------------------------
// Une archive .zip avec :
//   • un CSV par table utile (contacts, roster, collabs, briefs, factures, to-do,
//     planning, scouting, gifting, documents…), lisible dans Excel ;
//   • les réglages de l'agence (blob __app_state__) en JSON, SANS le coffre des mots
//     de passe (credVault) ;
//   • les PDF des media kits publiés sur le site (créateurs + agence) ;
//   • un LISEZMOI.txt.
// L'archive est aussi rangée dans Storage, bucket PRIVÉ « backups » (aucune politique :
// seul le serveur y accède ; les membres de l'agence ne voient pas les factures),
// et le mail contient un lien de téléchargement valable 30 jours. Si l'archive dépasse
// 20 Mo, elle n'est pas jointe : le lien suffit.
//
// Appels :
//   • pg_cron, le 1er de chaque mois : Authorization: Bearer <CRON_SECRET> ;
//   • bouton « Envoyer la sauvegarde maintenant » (Paramètres) : JWT d'un FONDATEUR.
// Destinataires : les comptes fondateurs (adresse de connexion), ou la liste
// `backupRecipients` des réglages si elle existe.
// Envoi : boîte partnerships@ (connexion Google de l'app, droit gmail.send).
// verify_jwt = false (config.toml) : l'appel du cron n'est pas un JWT.
// Sortie : { ok, month, files, bytes, attached, recipients } ou { error }.
// ============================================================================

import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { CRON_SECRET, corsHeaders, getAccessToken, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { backupMonth, mediakitPages, mediakitSlug, mimeMessage, pdfLinksIn, safeAppState, toCsv } from "../_shared/backup.ts";

const SITE = "https://ttpcreators.pro";
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const ATTACH_MAX = 20 * 1024 * 1024;
const PDF_MAX = 15 * 1024 * 1024;

/** Tables sauvegardées (les jetons de connexion, abonnements push et quotas n'y sont jamais). */
const TABLES = [
  "contacts", "creators", "collabs", "collab_steps", "briefs", "invoices", "todos", "todo_routines", "events",
  "gifting", "documents", "ideas", "prospects", "creator_pool", "athlete_pool", "creator_roadmap",
  "creator_mail_settings", "creator_mail_status_log", "creator_mail_notes", "agency_mediakit", "email_sequences",
];

type Sb = ReturnType<typeof getServiceClient>;

async function allRows(sb: Sb, table: string): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) return out.length ? out : null; // table absente ou illisible : on la saute
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return out;
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

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = getServiceClient();
  if (!(await authorize(req, sb))) return json({ error: "unauthorized" }, 401);

  const now = new Date();
  const month = backupMonth(now);
  const files: Record<string, Uint8Array> = {};
  const counts: { name: string; n: string }[] = [];

  // 1) Tables → CSV
  for (const t of TABLES) {
    const rows = await allRows(sb, t);
    if (!rows) continue;
    files[`donnees/${t}.csv`] = strToU8(toCsv(rows));
    counts.push({ name: t, n: `${rows.length} ligne${rows.length > 1 ? "s" : ""}` });
  }

  // 2) Réglages de l'agence (sans le coffre)
  let state: Record<string, unknown> = {};
  const { data: st } = await sb.from("module_rows").select("a").eq("module", "__app_state__").order("created_at", { ascending: false }).limit(1);
  try {
    const raw = (st?.[0] as { a?: string } | undefined)?.a;
    if (raw) state = JSON.parse(raw);
  } catch {
    state = {};
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
      "reglages-agence.json : réglages de l'agence (factures, contrats, notes…), sans le coffre des mots de passe.\r\n" +
      "media-kits/ : les media kits publiés sur ttpcreators.pro (créateurs et agence).\r\n\r\n" +
      "Document confidentiel : coordonnées de contacts et données de facturation.\r\n",
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

  // 5) Mail aux fondateurs
  const listed = Array.isArray(state.backupRecipients) ? (state.backupRecipients as unknown[]).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) : [];
  const to = listed.length ? listed : await founderEmails(sb);
  if (!to.length) return json({ error: "aucun_destinataire" }, 409);
  const attach = zip.length <= ATTACH_MAX;
  const mb = (zip.length / 1024 / 1024).toFixed(1).replace(".", ",");
  const html =
    `<p>Bonjour,</p><p>Voici la sauvegarde mensuelle de TTP Suite (${month}).` +
    (attach ? " L'archive est jointe à ce mail." : ` L'archive fait ${mb} Mo : trop lourde pour être jointe, elle est à télécharger avec le lien ci-dessous.`) +
    `</p>` +
    (link ? `<p><a href="${link}">Télécharger la sauvegarde (${mb} Mo)</a> · lien valable 30 jours.</p>` : "") +
    `<table style="border-collapse:collapse;font-size:13px">${counts.map((c) => `<tr><td style="padding:2px 12px 2px 0">${c.name}</td><td style="padding:2px 0;color:#555">${c.n}</td></tr>`).join("")}</table>` +
    `<p style="color:#777;font-size:12px">Le coffre des mots de passe n'est jamais inclus. Garde ce mail en lieu sûr.</p>`;
  const raw = mimeMessage({
    from: `TTP Suite <partnerships@${AGENCY_DOMAIN}>`,
    to,
    subject: `Sauvegarde TTP Suite · ${month}`,
    html,
    attachments: attach ? [{ filename: name, mimeType: "application/zip", bytes: zip }] : [],
  });
  let token: string;
  try {
    token = await getAccessToken(sb);
  } catch {
    return json({ error: "google_non_connecte", stored: !up.error }, 409);
  }
  // Envoi « media » : accepte un mail jusqu'à 35 Mo (le format JSON raw s'arrête à 5 Mo).
  const sent = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
    body: raw,
    signal: AbortSignal.timeout(60_000),
  });
  if (!sent.ok) {
    console.error("monthly-backup send", sent.status, (await sent.text()).slice(0, 300));
    return json({ error: "envoi_echoue", stored: !up.error }, 502);
  }
  return json({ ok: true, month, files: Object.keys(files).length, bytes: zip.length, attached: attach, recipients: to.length });
});

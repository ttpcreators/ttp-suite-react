// ============================================================================
// ttp-mcp/tools.ts : les outils de TTP Suite pour Claude.
// Lecture : point du jour, recherche, roster, fiche créateur, mails, DM Instagram,
// scouting (créateurs / sportifs), contacts, pipeline, collabs, planning, tâches,
// factures (fondateurs). Actions : tâche, rendez-vous, brouillon de mail, contact,
// échange noté, scouting, étape de collab. Claude demande l'accord avant chaque action.
// Jamais exposés : coffre des mots de passe, IBAN, jetons de connexion.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { triggerSync } from "../_shared/google.ts";
import type { Ctx } from "./oauth.ts";
import { boxesFor, createDraft, readThread, searchThreads, unreadCounts, type MailBox } from "./gmail.ts";

type Json = Record<string, unknown>;
type Args = Record<string, unknown>;
export type ToolResult = { text: string; isError?: boolean };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  write?: boolean;
  founder?: boolean;
  run: (sb: SupabaseClient, ctx: Ctx, a: Args) => Promise<ToolResult>;
};

// ── Outils communs ─────────────────────────────────────────────────────────
const TZ = "Europe/Paris";
const isoDay = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const frDay = (iso: string) => {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
};
/** Échéance des tâches : « AAAA-MM-JJ », ancien « jj/mm/aaaa » ou « — » → « AAAA-MM-JJ » ou "". */
const dueIso = (v: unknown) => {
  const t = String(v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  return fr ? `${fr[3].length === 2 ? "20" + fr[3] : fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}` : "";
};
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};
const esc = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);
const like = (s: string) => `%${esc(s)}%`;
/** Motif ilike EXACT (insensible à la casse) : un « _ » dans un nom ne sert pas de joker. */
const exact = esc;

/** Nom officiel d'un créateur du roster (tel qu'en base) : exact d'abord, sinon partiel unique. */
async function rosterName(sb: SupabaseClient, n: string): Promise<{ name: string } | { error: string }> {
  const { data: same, error } = await sb.from("creators").select("name").ilike("name", exact(n)).limit(1);
  if (error) return { error: `Lecture du roster impossible : ${error.message}` };
  if (same?.[0]) return { name: String((same[0] as Json).name) };
  const { data: part } = await sb.from("creators").select("name").ilike("name", like(n)).limit(3);
  const list = (part as Json[] | null) ?? [];
  if (list.length === 1) return { name: String(list[0].name) };
  return { error: list.length ? `Plusieurs créateurs correspondent à « ${n} » : ${list.map((x) => titleCase(String(x.name))).join(", ")}. Précise le nom.` : `Aucun créateur du roster ne correspond à « ${n} ».` };
}
const orLike = (cols: string[], q: string) => cols.map((c) => `${c}.ilike.${JSON.stringify(like(q))}`).join(",");
const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });
const lines = (xs: string[], empty: string) => (xs.length ? xs.join("\n") : empty);
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

const COLLAB_STEPS = [
  "Signature", "Brief transmis au créateur", "Concept validé", "Tournage", "Validation marque", "Publication",
  "Statistiques à sept jours", "Facture envoyée", "Paiement marque reçu", "Créateur payé", "Bilan et renouvellement",
];
const SCOUT_STATUS: Record<string, string> = { observation: "En observation", contacter: "À contacter", discussion: "En discussion", signe: "Signé", ecarte: "Pas intéressé" };
const INVOICE_STATUS: Record<string, string> = { brouillon: "Brouillon", attente: "En attente", retard: "En retard", payee: "Payée", annulee: "Annulée" };

// FAIL-CLOSED : une lecture ratée ou illisible lève une erreur. Renvoyer {} ferait
// réécrire une clé entière à partir de rien (ex. tout le suivi du scouting effacé).
async function appState(sb: SupabaseClient): Promise<Json> {
  const { data, error } = await sb.from("module_rows").select("a").eq("module", "__app_state__").order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`lecture des réglages impossible (${error.message})`);
  const raw = (data?.[0] as { a?: string } | undefined)?.a;
  if (!raw) return {};
  const o = JSON.parse(raw);
  if (!o || typeof o !== "object") throw new Error("réglages illisibles");
  return o;
}

// ── Lecture ────────────────────────────────────────────────────────────────
const pointDuJour: Tool = {
  name: "point_du_jour",
  title: "Point du jour",
  description: "Résumé de la journée de l'agence : rendez-vous d'aujourd'hui et de demain, tâches en retard ou du jour, DM Instagram sans réponse, mails non lus, collabs qui n'avancent plus, factures en retard (fondateurs). À appeler en premier pour « qu'est-ce que j'ai aujourd'hui ? ».",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run: async (sb, ctx) => {
    const today = isoDay();
    const tomorrow = addDays(today, 1);
    const [ev, todos, dms, collabs, inv] = await Promise.all([
      sb.from("events").select("date, time, title, type, who").in("date", [today, tomorrow]).eq("deleted", false).order("date").order("time"),
      sb.from("todos").select("text, due, creator, priority").eq("done", false).not("due", "is", null).limit(500),
      sb.from("ig_threads").select("username, name, last_text, updated_at").eq("hidden", false).eq("last_from_me", false).gte("updated_at", new Date(Date.now() - 3 * 86400000).toISOString()).order("updated_at", { ascending: false }).limit(10),
      sb.from("collabs").select("brand, creator, step, updated_at").eq("status", "active").lt("updated_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("updated_at").limit(10),
      ctx.founder ? sb.from("invoices").select("ref, party, amount, date, status").in("status", ["retard", "attente"]).limit(50) : Promise.resolve({ data: [] }),
    ]);
    const bad = [ev, todos, dms, collabs, inv].find((r) => (r as { error?: { message: string } | null }).error);
    if (bad) return fail(`Lecture impossible (${(bad as { error: { message: string } }).error.message}) : réessaie dans un instant.`);
    const mails = await unreadCounts(sb).catch(() => []);
    const evs = (ev.data as Json[] | null) ?? [];
    const late = ((inv.data as Json[] | null) ?? []).filter((r) => r.status === "retard" || (/^\d{4}-\d{2}-\d{2}/.test(String(r.date)) && String(r.date) < today));
    const out = [
      `# Point du ${frDay(today)}`,
      `\n## Rendez-vous`,
      lines(evs.map((e) => `- ${e.date === today ? "Aujourd'hui" : "Demain"} ${e.time || "(journée)"} · ${e.title}${e.who ? ` · ${titleCase(String(e.who))}` : ""} [${e.type}]`), "Aucun."),
      `\n## Tâches en retard ou du jour`,
      lines(((todos.data as Json[] | null) ?? []).map((t) => ({ t, d: dueIso(t.due) })).filter((x) => x.d && x.d <= today).sort((x, y) => x.d.localeCompare(y.d)).slice(0, 30)
        .map(({ t, d }) => `- ${t.text}${t.creator ? ` (${titleCase(String(t.creator))})` : ""} · ${d < today ? "en retard depuis le" : "pour aujourd'hui,"} ${frDay(d)}${t.priority === "haute" ? " · priorité haute" : ""}`), "Aucune."),
      `\n## DM Instagram sans réponse (3 derniers jours)`,
      lines(((dms.data as Json[] | null) ?? []).map((d) => `- @${d.username ?? "?"}${d.name ? ` (${d.name})` : ""} : « ${String(d.last_text ?? "").slice(0, 120)} »`), "Aucun."),
      `\n## Mails`,
      lines(mails.map((m) => `- ${m}`), "Lecture impossible."),
      `\n## Collabs sans mouvement depuis 7 jours`,
      lines(((collabs.data as Json[] | null) ?? []).map((c) => `- ${c.brand} × ${titleCase(String(c.creator ?? ""))} · étape ${c.step} « ${COLLAB_STEPS[Number(c.step) - 1] ?? ""} »`), "Aucune."),
    ];
    if (ctx.founder) {
      out.push(`\n## Factures en retard`, lines(late.map((f) => `- ${f.ref} · ${f.party} · ${f.amount} € · échéance ${f.date}`), "Aucune."));
    }
    return ok(out.join("\n"));
  },
};

const rechercher: Tool = {
  name: "rechercher",
  title: "Recherche dans TTP Suite",
  description: "Recherche un nom, une marque, un @ ou un email partout : créateurs du roster, contacts marques, pipeline, collabs, scouting (créateurs et sportifs), DM Instagram, factures (fondateurs). Pour les mails, utiliser rechercher_mails.",
  inputSchema: { type: "object", properties: { requete: { type: "string", description: "Texte cherché (nom, marque, @, email)" } }, required: ["requete"], additionalProperties: false },
  run: async (sb, ctx, a) => {
    const q = str(a.requete, 80);
    if (q.length < 2) return fail("Donne au moins 2 caractères.");
    const [cr, ct, pr, co, sp, ap, ig, inv] = await Promise.all([
      sb.from("creators").select("name, niche, platform, followers, status").or(orLike(["name", "handle", "instagram", "tiktok", "email_pro"], q)).limit(8),
      sb.from("contacts").select("id, brand, person, email, instagram, last_contacted").or(orLike(["brand", "person", "email", "instagram", "first_name", "last_name"], q)).limit(8),
      sb.from("prospects").select("brand, contact, stage, value").or(orLike(["brand", "contact"], q)).limit(8),
      sb.from("collabs").select("id, brand, creator, step, status").or(orLike(["brand", "creator", "title"], q)).limit(8),
      sb.from("creator_pool").select("id, name, handle, tag").or(orLike(["name", "handle", "email", "tag"], q)).limit(8),
      sb.from("athlete_pool").select("id, name, handle, tag, club").or(orLike(["name", "handle", "email", "tag", "club"], q)).limit(8),
      sb.from("ig_threads").select("id, username, name, last_text").or(orLike(["username", "name"], q)).limit(8),
      ctx.founder ? sb.from("invoices").select("ref, party, amount, status").or(orLike(["ref", "party", "creator"], q)).limit(8) : Promise.resolve({ data: [] }),
    ]);
    const sec = (title: string, rows: Json[] | null, f: (r: Json) => string) => (rows?.length ? [`\n## ${title}`, ...rows.map((r) => `- ${f(r)}`)] : []);
    const out = [
      `# Résultats pour « ${q} »`,
      ...sec("Roster", cr.data as Json[], (r) => `${titleCase(String(r.name))} · ${r.niche ?? ""} · ${r.platform ?? ""} · ${r.followers ?? "?"} abonnés · ${r.status ?? ""}`),
      ...sec("Contacts marques", ct.data as Json[], (r) => `${r.brand}${r.person ? ` (${r.person})` : ""} · ${r.email ?? "sans email"} · ${r.instagram ?? ""} · dernier contact ${r.last_contacted ? String(r.last_contacted).slice(0, 10) : "jamais"} [contact ${r.id}]`),
      ...sec("Pipeline", pr.data as Json[], (r) => `${r.brand} · étape ${r.stage}${r.contact ? ` · ${r.contact}` : ""}${r.value && r.value !== "—" ? ` · ${r.value}` : ""}`),
      ...sec("Collabs", co.data as Json[], (r) => `${r.brand} × ${titleCase(String(r.creator ?? ""))} · étape ${r.step}/11 · ${r.status} [collab ${r.id}]`),
      ...sec("Scouting créateurs", sp.data as Json[], (r) => `${r.name} · ${r.handle ?? ""} · ${r.tag ?? ""} [scouting ${r.id}]`),
      ...sec("Scouting sportifs", ap.data as Json[], (r) => `${r.name} · ${r.tag ?? ""}${r.club ? ` · ${r.club}` : ""} · ${r.handle ?? ""} [sportif ${r.id}]`),
      ...sec("DM Instagram", ig.data as Json[], (r) => `@${r.username ?? "?"}${r.name ? ` (${r.name})` : ""} : « ${String(r.last_text ?? "").slice(0, 100)} » [dm ${r.id}]`),
      ...sec("Factures", inv.data as Json[], (r) => `${r.ref} · ${r.party} · ${r.amount} € · ${INVOICE_STATUS[String(r.status)] ?? r.status}`),
    ];
    return ok(out.length > 1 ? out.join("\n") : `Rien trouvé pour « ${q} » (essaie rechercher_mails pour les mails).`);
  },
};

const roster: Tool = {
  name: "lister_createurs",
  title: "Roster",
  description: "Liste les créateurs représentés par l'agence (roster) : niche, plateforme, abonnés, engagement, statut. Filtre facultatif par statut (actif, inactif) ou niche.",
  inputSchema: { type: "object", properties: { statut: { type: "string", enum: ["actif", "inactif", "tous"] }, niche: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("creators").select("name, niche, platform, followers, er, status, ville, instagram, tiktok").order("sort_order");
    const st = str(a.statut);
    if (st && st !== "tous") q = q.eq("status", st);
    if (str(a.niche)) q = q.ilike("niche", like(str(a.niche)));
    const { data, error } = await q;
    if (error) return fail("Lecture du roster impossible.");
    const rows = (data as Json[]) ?? [];
    return ok([`# Roster · ${rows.length} créateur(s)`, ...rows.map((r) => `- ${titleCase(String(r.name))} · ${r.niche ?? "?"} · ${r.platform ?? "?"} · ${r.followers ?? "?"} abonnés · engagement ${r.er ?? "?"} · ${r.status ?? ""}${r.ville ? ` · ${r.ville}` : ""}${r.instagram ? ` · IG ${r.instagram}` : ""}${r.tiktok ? ` · TT ${r.tiktok}` : ""}`)].join("\n"));
  },
};

const ficheCreateur: Tool = {
  name: "fiche_createur",
  title: "Fiche créateur",
  description: "Tout sur un créateur du roster : profil, statistiques Instagram / TikTok / YouTube, collabs en cours, prochains rendez-vous, tâches ouvertes, factures (fondateurs).",
  inputSchema: { type: "object", properties: { nom: { type: "string", description: "Nom du créateur (même partiel)" } }, required: ["nom"], additionalProperties: false },
  run: async (sb, ctx, a) => {
    const n = str(a.nom, 80);
    const found = await rosterName(sb, n);
    if ("error" in found) return fail(found.error);
    const { data: list, error: cErr } = await sb.from("creators").select("*").eq("name", found.name).limit(1);
    if (cErr) return fail(`Lecture impossible : ${cErr.message}`);
    const c = (list as Json[] | null)?.[0];
    if (!c) return fail(`Aucun créateur du roster ne correspond à « ${n} ».`);
    const name = String(c.name);
    const pat = exact(name);
    const today = isoDay();
    const [col, ev, td, inv] = await Promise.all([
      sb.from("collabs").select("id, brand, step, status, cachet, deliverables").ilike("creator", pat).neq("status", "archivee").order("updated_at", { ascending: false }).limit(15),
      sb.from("events").select("date, time, title, type").ilike("who", pat).gte("date", today).eq("deleted", false).order("date").limit(10),
      sb.from("todos").select("text, due, priority").ilike("creator", pat).eq("done", false).limit(15),
      ctx.founder ? sb.from("invoices").select("ref, party, amount, date, status").ilike("creator", pat).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    ]);
    const badF = [col, ev, td, inv].find((r) => (r as { error?: unknown }).error);
    if (badF) return fail("Lecture impossible : réessaie dans un instant.");
    const ig = c.ig as Json | null;
    const tt = c.tt as Json | null;
    const yt = c.yt as Json | null;
    const out = [
      `# ${titleCase(name)}`,
      `Niche : ${c.niche ?? "?"} · plateforme : ${c.platform ?? "?"} · abonnés : ${c.followers ?? "?"} · engagement : ${c.er ?? "?"} · statut : ${c.status ?? "?"}${c.ville ? ` · ${c.ville}` : ""}`,
      `Comptes : ${[c.instagram && `IG ${c.instagram}`, c.tiktok && `TikTok ${c.tiktok}`, c.email_pro && `email pro ${c.email_pro}`].filter(Boolean).join(" · ") || "?"}`,
      ig ? `Instagram (relevé automatique) : ${ig.followers ?? "?"} abonnés${ig.er != null ? ` · engagement ${ig.er} %` : ""}${ig.reach30 ? ` · couverture 28 j ${ig.reach30}` : ""}` : "",
      tt ? `TikTok : ${tt.followers ?? "?"} abonnés` : "",
      yt ? `YouTube : ${yt.subscribers ?? "?"} abonnés` : "",
      `\n## Collabs`,
      lines(((col.data as Json[] | null) ?? []).map((r) => `- ${r.brand} · étape ${r.step}/11 « ${COLLAB_STEPS[Number(r.step) - 1] ?? ""} » · ${r.status}${r.cachet ? ` · cachet ${r.cachet}` : ""} [collab ${r.id}]`), "Aucune."),
      `\n## Prochains rendez-vous`,
      lines(((ev.data as Json[] | null) ?? []).map((e) => `- ${frDay(String(e.date))} ${e.time || ""} · ${e.title} [${e.type}]`), "Aucun."),
      `\n## Tâches ouvertes`,
      lines(((td.data as Json[] | null) ?? []).map((t) => `- ${t.text}${t.due ? ` · échéance ${t.due}` : ""}`), "Aucune."),
    ];
    if (ctx.founder) out.push(`\n## Factures`, lines(((inv.data as Json[] | null) ?? []).map((f) => `- ${f.ref} · ${f.party} · ${f.amount} € · ${INVOICE_STATUS[String(f.status)] ?? f.status} · échéance ${f.date}`), "Aucune."));
    return ok(out.filter(Boolean).join("\n"));
  },
};

const rechercherMails: Tool = {
  name: "rechercher_mails",
  title: "Rechercher dans les mails",
  description: "Cherche dans les boîtes Gmail de l'agence (partnerships@ et talent@). La requête suit la syntaxe Gmail : « from:nike », « is:unread », « newer_than:7d », « subject:contrat », « in:sent », etc. Vide = derniers mails de la boîte de réception. Renvoie l'id du fil pour lire_mail.",
  inputSchema: {
    type: "object",
    properties: {
      requete: { type: "string", description: "Recherche Gmail (vide = boîte de réception)" },
      boite: { type: "string", enum: ["toutes", "partnerships", "talent"], description: "Boîte (défaut : toutes)" },
      max: { type: "number", description: "Nombre de fils (1 à 25, défaut 10)" },
    },
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const q = str(a.requete, 200) || "in:inbox";
    const { threads, errors } = await searchThreads(sb, str(a.boite) === "toutes" ? undefined : str(a.boite) || undefined, q, int(a.max, 10, 1, 25));
    const out = [`# Mails · « ${q} »`, ...threads.map((t) => `- ${t.unread ? "● " : ""}${t.date} · ${t.from} · « ${t.subject} »${t.messages > 1 ? ` (${t.messages} messages)` : ""}\n  ${t.snippet.slice(0, 160)}\n  [fil ${t.threadId} · boîte ${t.box}]`)];
    if (!threads.length) out.push("Aucun mail trouvé.");
    if (errors.length) out.push(`\nBoîtes illisibles : ${errors.join(" ; ")}`);
    return ok(out.join("\n"));
  },
};

const lireMail: Tool = {
  name: "lire_mail",
  title: "Lire un fil de mails",
  description: "Lit un fil Gmail en entier (expéditeurs, dates, texte des messages, noms des pièces jointes). Utiliser l'id du fil et la boîte donnés par rechercher_mails.",
  inputSchema: { type: "object", properties: { fil: { type: "string", description: "Id du fil Gmail" }, boite: { type: "string", enum: ["partnerships", "talent"] } }, required: ["fil", "boite"], additionalProperties: false },
  run: async (sb, _c, a) => {
    const box = (str(a.boite) === "talent" ? "talent" : "partnerships") as MailBox;
    if (!boxesFor(box).length) return fail("Boîte talent@ non configurée.");
    const id = str(a.fil, 40);
    if (!/^[A-Za-z0-9]+$/.test(id)) return fail("Id de fil invalide.");
    try {
      return ok(await readThread(sb, box, id));
    } catch (e) {
      return fail(`Lecture impossible : ${(e as Error).message}`);
    }
  },
};

const dmInstagram: Tool = {
  name: "dm_instagram",
  title: "DM Instagram",
  description: "Conversations Instagram du compte @ttpcreators (les plus récentes d'abord), ou les messages d'une conversation si « conversation » (id ou @) est donné.",
  inputSchema: {
    type: "object",
    properties: {
      conversation: { type: "string", description: "Id de conversation ou @ de la personne (facultatif)" },
      recherche: { type: "string", description: "Filtre sur le nom ou le @ (facultatif)" },
      max: { type: "number", description: "1 à 30 (défaut 15)" },
    },
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const conv = str(a.conversation, 80).replace(/^@/, "");
    if (conv) {
      const { data: t } = await sb.from("ig_threads").select("id, username, name, followers").or(`id.eq.${JSON.stringify(conv)},username.eq.${JSON.stringify(conv.toLowerCase())}`).limit(1);
      const th = (t as Json[] | null)?.[0];
      if (!th) return fail("Conversation introuvable.");
      const { data: m } = await sb.from("ig_messages").select("at, me, text").eq("thread_id", th.id).order("at").limit(60);
      return ok([`# DM avec @${th.username}${th.name ? ` (${th.name})` : ""}${th.followers ? ` · ${th.followers} abonnés` : ""}`, ...((m as Json[] | null) ?? []).map((x) => `- ${new Date(String(x.at)).toLocaleString("fr-FR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${x.me ? "TTP" : `@${th.username}`} : ${x.text}`)].join("\n"));
    }
    let q = sb.from("ig_threads").select("id, username, name, last_text, last_from_me, updated_at, emails").eq("hidden", false).order("updated_at", { ascending: false }).limit(int(a.max, 15, 1, 30));
    if (str(a.recherche)) q = q.or(orLike(["username", "name"], str(a.recherche, 60)));
    const { data } = await q;
    return ok([`# DM Instagram`, ...((data as Json[] | null) ?? []).map((r) => `- @${r.username ?? "?"}${r.name ? ` (${r.name})` : ""} · ${String(r.updated_at ?? "").slice(0, 10)} · ${r.last_from_me ? "TTP" : "eux"} : « ${String(r.last_text ?? "").slice(0, 120)} »${(r.emails as string[] | null)?.length ? ` · email ${(r.emails as string[])[0]}` : ""} [dm ${r.id}]`)].join("\n"));
  },
};

const scouting: Tool = {
  name: "scouting",
  title: "Scouting",
  description: "Profils repérés par l'agence avant recrutement : créateurs ou sportifs. Statut (En observation, À contacter, En discussion, Signé, Pas intéressé), catégorie ou sport (saisie ou devinée via Instagram), abonnés, engagement, dernier contact.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["createurs", "sportifs"], description: "Défaut : createurs" },
      statut: { type: "string", enum: ["observation", "contacter", "discussion", "signe", "ecarte"] },
      categorie: { type: "string", description: "Catégorie ou sport (facultatif)" },
      recherche: { type: "string" },
    },
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const athletes = str(a.type) === "sportifs";
    const { data, error } = await sb.from(athletes ? "athlete_pool" : "creator_pool").select("*").order("sort_order");
    if (error) return fail("Lecture du scouting impossible.");
    const track = ((await appState(sb))[athletes ? "athleteTracking" : "poolTracking"] ?? {}) as Record<string, Json>;
    const cat = str(a.categorie).toLowerCase();
    const q = str(a.recherche).toLowerCase();
    const rows = ((data as Json[]) ?? []).map((r) => {
      const t = track[String(r.id)] ?? {};
      const snaps = ((t.snaps as { date: string; value: number }[] | undefined) ?? []).sort((x, y) => x.date.localeCompare(y.date));
      return { r, status: String(t.status ?? "observation"), niche: String(r.tag ?? "") || String(t.igNiche ?? ""), fol: snaps.length ? snaps[snaps.length - 1].value : null, er: t.igEr as number | null | undefined };
    }).filter((x) => (!a.statut || x.status === a.statut) && (!cat || x.niche.toLowerCase().includes(cat)) && (!q || `${x.r.name} ${x.r.handle ?? ""} ${x.r.note ?? ""}`.toLowerCase().includes(q)));
    return ok([`# Scouting ${athletes ? "sportifs" : "créateurs"} · ${rows.length} profil(s)`, ...rows.map((x) => `- ${x.r.name} · ${x.r.handle ?? "sans @"} · ${x.niche || "sans catégorie"}${athletes && x.r.club ? ` · ${x.r.club}` : ""}${athletes && x.r.level ? ` · ${x.r.level}` : ""} · ${SCOUT_STATUS[x.status] ?? x.status}${x.fol != null ? ` · ${x.fol.toLocaleString("fr-FR")} abonnés` : ""}${x.er != null ? ` · engagement ${x.er} %` : ""}${x.r.last_contacted ? ` · contacté le ${String(x.r.last_contacted).slice(0, 10)}` : ""}${x.r.email ? ` · ${x.r.email}` : ""} [${athletes ? "sportif" : "scouting"} ${x.r.id}]`)].join("\n"));
  },
};

const contacts: Tool = {
  name: "contacts",
  title: "Contacts marques",
  description: "Carnet des contacts marques (CRM) avec email, Instagram, dernier contact et historique des échanges. « a_relancer » = contacts sans échange depuis 45 jours ou plus.",
  inputSchema: { type: "object", properties: { recherche: { type: "string" }, a_relancer: { type: "boolean" }, max: { type: "number" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("contacts").select("id, brand, person, role, email, phone, instagram, tag, last_contacted, touches").order("last_contacted", { ascending: true, nullsFirst: true }).limit(int(a.max, 25, 1, 60));
    if (str(a.recherche)) q = q.or(orLike(["brand", "person", "email", "instagram", "tag"], str(a.recherche, 60)));
    if (a.a_relancer === true) q = q.lt("last_contacted", new Date(Date.now() - 45 * 86400000).toISOString());
    const { data, error } = await q;
    if (error) return fail("Lecture des contacts impossible.");
    return ok([`# Contacts`, ...((data as Json[]) ?? []).map((r) => {
      const t = (Array.isArray(r.touches) ? r.touches : []) as { date: string; canal: string; kind: string; note?: string }[];
      const last = t[0];
      return `- ${r.brand}${r.person ? ` · ${r.person}${r.role ? ` (${r.role})` : ""}` : ""} · ${r.email ?? "sans email"}${r.instagram ? ` · ${r.instagram}` : ""}${r.tag ? ` · ${r.tag}` : ""} · dernier contact ${r.last_contacted ? String(r.last_contacted).slice(0, 10) : "jamais"}${last ? ` (${last.kind} par ${last.canal}${last.note ? ` : ${last.note}` : ""})` : ""} · ${t.length} échange(s) [contact ${r.id}]`;
    })].join("\n"));
  },
};

const pipeline: Tool = {
  name: "pipeline",
  title: "Pipeline marques",
  description: "Marques en prospection et leur étape (Repérée, Contact, Discussion, Proposition, Signée…).",
  inputSchema: { type: "object", properties: { etape: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("prospects").select("brand, contact, stage, value, created_at").order("sort_order");
    if (str(a.etape)) q = q.ilike("stage", like(str(a.etape)));
    const { data } = await q;
    const rows = (data as Json[] | null) ?? [];
    return ok([`# Pipeline · ${rows.length} marque(s)`, ...rows.map((r) => `- ${r.brand} · ${r.stage}${r.contact ? ` · ${r.contact}` : ""}${r.value && r.value !== "—" ? ` · ${r.value}` : ""} · ajoutée le ${String(r.created_at).slice(0, 10)}`)].join("\n"));
  },
};

const collabs: Tool = {
  name: "collabs",
  title: "Collabs",
  description: "Collaborations marque × créateur et leur avancement sur 11 étapes (Signature → Bilan). Filtre par créateur, marque ou statut (active, terminee, archivee).",
  inputSchema: { type: "object", properties: { createur: { type: "string" }, marque: { type: "string" }, statut: { type: "string", enum: ["active", "terminee", "archivee", "toutes"] } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("collabs").select("id, brand, creator, title, step, status, cachet, deliverables, updated_at").order("updated_at", { ascending: false }).limit(40);
    const st = str(a.statut) || "active";
    if (st !== "toutes") q = q.eq("status", st);
    if (str(a.createur)) q = q.ilike("creator", like(str(a.createur)));
    if (str(a.marque)) q = q.ilike("brand", like(str(a.marque)));
    const { data } = await q;
    return ok([`# Collabs (${st})`, ...((data as Json[] | null) ?? []).map((r) => `- ${r.brand} × ${titleCase(String(r.creator ?? ""))}${r.title ? ` · ${r.title}` : ""} · étape ${r.step}/11 « ${COLLAB_STEPS[Number(r.step) - 1] ?? ""} »${r.cachet ? ` · ${r.cachet}` : ""}${r.deliverables ? ` · ${r.deliverables}` : ""} · bougée le ${String(r.updated_at).slice(0, 10)} [collab ${r.id}]`)].join("\n"));
  },
};

const planning: Tool = {
  name: "planning",
  title: "Planning",
  description: "Rendez-vous, tournages, calls et deadlines de l'agenda entre deux dates (défaut : les 7 prochains jours).",
  inputSchema: { type: "object", properties: { du: { type: "string", description: "AAAA-MM-JJ" }, au: { type: "string", description: "AAAA-MM-JJ" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(str(a.du)) ? str(a.du) : isoDay();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(str(a.au)) ? str(a.au) : addDays(from, 7);
    const { data } = await sb.from("events").select("date, time, title, type, who, description").gte("date", from).lte("date", to).eq("deleted", false).order("date").order("time").limit(80);
    return ok([`# Planning du ${frDay(from)} au ${frDay(to)}`, lines(((data as Json[] | null) ?? []).map((e) => `- ${frDay(String(e.date))} ${e.time || "(journée)"} · ${e.title}${e.who ? ` · ${titleCase(String(e.who))}` : ""} [${e.type}]${e.description ? `\n  ${String(e.description).slice(0, 200)}` : ""}`), "Rien de prévu.")].join("\n"));
  },
};

const taches: Tool = {
  name: "taches",
  title: "Tâches",
  description: "To-do de l'agence : tâches ouvertes (par défaut) ou faites, avec échéance, priorité et créateur concerné.",
  inputSchema: { type: "object", properties: { faites: { type: "boolean" }, createur: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("todos").select("text, descr, due, creator, priority, status, done_at").eq("done", a.faites === true).order("sort_order").limit(60);
    if (str(a.createur)) q = q.ilike("creator", like(str(a.createur)));
    const { data } = await q;
    return ok([`# Tâches ${a.faites === true ? "faites" : "ouvertes"}`, lines(((data as Json[] | null) ?? []).map((t) => `- ${t.text}${t.creator ? ` (${titleCase(String(t.creator))})` : ""}${t.due ? ` · échéance ${t.due}` : ""}${t.priority ? ` · ${t.priority}` : ""}${t.descr ? `\n  ${String(t.descr).slice(0, 160)}` : ""}`), "Aucune.")].join("\n"));
  },
};

const factures: Tool = {
  name: "factures",
  title: "Factures",
  description: "Factures de l'agence (réservé aux fondateurs) : référence, marque, montant TTC, échéance, statut, et totaux par statut. Filtre par statut ou mois (AAAA-MM).",
  inputSchema: { type: "object", properties: { statut: { type: "string", enum: ["brouillon", "attente", "retard", "payee", "annulee"] }, mois: { type: "string", description: "AAAA-MM (échéance)" } }, additionalProperties: false },
  founder: true,
  run: async (sb, _c, a) => {
    let q = sb.from("invoices").select("ref, party, amount, date, status, creator").order("created_at", { ascending: false }).limit(100);
    if (str(a.statut)) q = q.eq("status", str(a.statut));
    if (/^\d{4}-\d{2}$/.test(str(a.mois))) q = q.like("date", `${str(a.mois)}%`);
    const { data } = await q;
    const rows = (data as Json[] | null) ?? [];
    const num = (v: unknown) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "")) || 0;
    const totals: Record<string, number> = {};
    for (const r of rows) totals[String(r.status)] = (totals[String(r.status)] ?? 0) + num(r.amount);
    return ok([
      `# Factures · ${rows.length}`,
      `Totaux : ${Object.entries(totals).map(([k, v]) => `${INVOICE_STATUS[k] ?? k} ${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`).join(" · ") || "—"}`,
      ...rows.map((r) => `- ${r.ref} · ${r.party} · ${r.amount} € · échéance ${r.date} · ${INVOICE_STATUS[String(r.status)] ?? r.status}`),
    ].join("\n"));
  },
};

// ── Actions ────────────────────────────────────────────────────────────────
const creerTache: Tool = {
  name: "creer_tache",
  title: "Créer une tâche",
  description: "Ajoute une tâche à la to-do de l'agence.",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      titre: { type: "string" },
      details: { type: "string" },
      echeance: { type: "string", description: "AAAA-MM-JJ (facultatif)" },
      createur: { type: "string", description: "Créateur concerné (facultatif)" },
      priorite: { type: "string", enum: ["haute", "moyenne", "basse"] },
    },
    required: ["titre"],
    additionalProperties: false,
  },
  run: async (sb, ctx, a) => {
    const titre = str(a.titre, 200);
    if (!titre) return fail("Titre manquant.");
    const due = /^\d{4}-\d{2}-\d{2}$/.test(str(a.echeance)) ? str(a.echeance) : null;
    // Nom officiel du roster : l'app et la RLS comparent le nom EXACT (sinon tâche invisible chez le créateur).
    let who: string | null = null;
    if (str(a.createur)) {
      const found = await rosterName(sb, str(a.createur, 80));
      if ("error" in found) return fail(found.error);
      who = found.name;
    }
    const { data: top } = await sb.from("todos").select("sort_order").order("sort_order", { ascending: true }).limit(1);
    const order = ((top as { sort_order: number }[] | null)?.[0]?.sort_order ?? 0) - 1;
    const { error } = await sb.from("todos").insert({
      text: titre, descr: str(a.details, 2000) || null, due: due ?? "—", creator: who,
      priority: ["haute", "moyenne", "basse"].includes(str(a.priorite)) ? str(a.priorite) : "moyenne",
      source: "agency", status: "À faire", sort_order: order, tag: ctx.name ? `Claude · ${ctx.name}` : "Claude",
    });
    return error ? fail(`Tâche non créée : ${error.message}`) : ok(`Tâche créée : « ${titre} »${due ? ` pour le ${frDay(due)}` : ""}.`);
  },
};

const creerEvenement: Tool = {
  name: "creer_evenement",
  title: "Ajouter au planning",
  description: "Ajoute un rendez-vous au planning de l'agence (synchronisé avec Google Agenda).",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      titre: { type: "string" },
      date: { type: "string", description: "AAAA-MM-JJ" },
      heure: { type: "string", description: "HH:MM (vide = toute la journée)" },
      type: { type: "string", enum: ["call", "reunion", "collab", "shoot", "event", "voyage", "deadline"] },
      createur: { type: "string", description: "Créateur concerné (facultatif)" },
      details: { type: "string" },
    },
    required: ["titre", "date"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const date = str(a.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Date attendue au format AAAA-MM-JJ.");
    const time = /^\d{2}:\d{2}$/.test(str(a.heure)) ? str(a.heure) : "";
    let who: string | null = null;
    if (str(a.createur)) {
      const found = await rosterName(sb, str(a.createur, 80));
      if ("error" in found) return fail(found.error);
      who = found.name;
    }
    const { error } = await sb.from("events").insert({
      date, time, title: str(a.titre, 200), type: ["call", "reunion", "collab", "shoot", "event", "voyage", "deadline"].includes(str(a.type)) ? str(a.type) : "call",
      who, description: str(a.details, 2000) || null, source: "agency", sync_source: "agence",
    });
    if (error) return fail(`Rendez-vous non créé : ${error.message}`);
    try {
      triggerSync("cron");
    } catch {
      /* la synchro horaire le poussera vers Google */
    }
    return ok(`Ajouté au planning : « ${str(a.titre, 200)} » le ${frDay(date)}${time ? ` à ${time}` : ""}.`);
  },
};

const brouillonMail: Tool = {
  name: "creer_brouillon_mail",
  title: "Préparer un brouillon de mail",
  description: "Prépare un BROUILLON dans Gmail (partnerships@ ou talent@), en nouveau mail ou en réponse dans un fil existant. Rien n'est envoyé : Marc relit et envoie depuis Gmail ou l'app.",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      boite: { type: "string", enum: ["partnerships", "talent"] },
      a: { type: "string", description: "Destinataire(s), séparés par des virgules" },
      objet: { type: "string" },
      message: { type: "string", description: "Texte du mail (sans signature : Gmail ajoute la sienne)" },
      fil: { type: "string", description: "Id du fil pour répondre (facultatif)" },
    },
    required: ["boite", "a", "objet", "message"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const box = (str(a.boite) === "talent" ? "talent" : "partnerships") as MailBox;
    if (!boxesFor(box).length) return fail("Boîte talent@ non configurée.");
    const to = str(a.a, 500);
    if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(to)) return fail("Adresse du destinataire invalide.");
    const fil = str(a.fil, 40);
    try {
      await createDraft(sb, box, to, str(a.objet, 300), str(a.message, 20000), /^[A-Za-z0-9]+$/.test(fil) ? fil : undefined);
      return ok(`Brouillon prêt dans ${box}@ pour ${to} : « ${str(a.objet, 300)} ». À relire et envoyer depuis Gmail.`);
    } catch (e) {
      return fail(`Brouillon non créé : ${(e as Error).message}`);
    }
  },
};

const ajouterContact: Tool = {
  name: "ajouter_contact",
  title: "Ajouter un contact marque",
  description: "Ajoute une marque au carnet de contacts (ne crée pas de doublon : un contact existant avec le même email ou le même @ est renvoyé).",
  write: true,
  inputSchema: {
    type: "object",
    properties: { marque: { type: "string" }, personne: { type: "string" }, role: { type: "string" }, email: { type: "string" }, instagram: { type: "string" }, telephone: { type: "string" }, categorie: { type: "string" } },
    required: ["marque"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const email = str(a.email, 200).toLowerCase();
    const ig = str(a.instagram, 80) ? `@${str(a.instagram, 80).replace(/^@/, "")}` : "";
    if (email || ig) {
      const conds = [email && `email.ilike.${JSON.stringify(email)}`, ig && `instagram.ilike.${JSON.stringify(ig)}`].filter(Boolean).join(",");
      const { data: same } = await sb.from("contacts").select("id, brand").or(conds).limit(1);
      const s = (same as Json[] | null)?.[0];
      if (s) return ok(`Contact déjà présent : ${s.brand} [contact ${s.id}].`);
    }
    const { data, error } = await sb.from("contacts").insert({
      brand: str(a.marque, 120), person: str(a.personne, 120) || null, role: str(a.role, 80) || null, email: email || null, instagram: ig || null, phone: str(a.telephone, 40) || null, tag: str(a.categorie, 60) || null, tone: "cyan",
    }).select("id").single<{ id: string }>();
    return error ? fail(`Contact non créé : ${error.message}`) : ok(`Contact ajouté : ${str(a.marque, 120)} [contact ${data.id}].`);
  },
};

const noterEchange: Tool = {
  name: "noter_echange_contact",
  title: "Noter un échange avec un contact",
  description: "Note dans le suivi d'un contact marque un échange (premier contact, relance ou réponse reçue) par WhatsApp, email, Instagram, LinkedIn, téléphone… Met à jour la date du dernier contact.",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      contact: { type: "string", description: "Id du contact (donné par contacts / rechercher) ou nom de la marque" },
      canal: { type: "string", enum: ["whatsapp", "email", "instagram", "linkedin", "tel", "autre"] },
      type: { type: "string", enum: ["contact", "relance", "reponse"] },
      note: { type: "string" },
      date: { type: "string", description: "AAAA-MM-JJ (défaut : aujourd'hui)" },
    },
    required: ["contact", "canal"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const key = str(a.contact, 120);
    const isId = /^[0-9a-f-]{36}$/i.test(key);
    const { data: rows } = isId ? await sb.from("contacts").select("id, brand, touches, last_contacted").eq("id", key).limit(1) : await sb.from("contacts").select("id, brand, touches, last_contacted").ilike("brand", like(key)).limit(2);
    const list = (rows as Json[] | null) ?? [];
    if (!list.length) return fail(`Aucun contact « ${key} ».`);
    if (list.length > 1) return fail(`Plusieurs contacts correspondent à « ${key} » : précise l'id (outil contacts).`);
    const c = list[0];
    const existing = Array.isArray(c.touches) ? (c.touches as Json[]) : [];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(a.date)) ? str(a.date) : isoDay();
    const kind = ["contact", "relance", "reponse"].includes(str(a.type)) ? str(a.type) : existing.length ? "relance" : "contact";
    const touch = { id: `cl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, canal: str(a.canal), kind, ...(str(a.note) ? { note: str(a.note, 500) } : {}) };
    const when = new Date(date + "T12:00:00Z").toISOString();
    const patch: Json = { touches: [touch, ...existing] };
    if (!c.last_contacted || when > String(c.last_contacted)) patch.last_contacted = when;
    const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
    return error ? fail(`Échange non noté : ${error.message}`) : ok(`Noté chez ${c.brand} : ${kind} par ${str(a.canal)} le ${frDay(date)}.`);
  },
};

const ajouterScouting: Tool = {
  name: "ajouter_au_scouting",
  title: "Ajouter au scouting",
  description: "Ajoute un créateur ou un sportif repéré au scouting (pas de doublon sur le même @). Catégorie vide : l'app la devinera via Instagram.",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["createurs", "sportifs"] },
      nom: { type: "string" },
      compte: { type: "string", description: "@ Instagram (ou lien YouTube)" },
      email: { type: "string" },
      categorie: { type: "string", description: "Niche (créateurs) ou sport (sportifs)" },
      club: { type: "string", description: "Sportifs : club / équipe" },
      niveau: { type: "string", enum: ["Pro", "Semi-pro", "Espoir", "Amateur"] },
      note: { type: "string" },
    },
    required: ["nom"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const athletes = str(a.type) === "sportifs";
    const table = athletes ? "athlete_pool" : "creator_pool";
    const handle = str(a.compte, 200);
    if (handle) {
      const h = handle.replace(/^@/, "");
      const { data: same } = await sb.from(table).select("id, name").or(`handle.ilike.${JSON.stringify(h)},handle.ilike.${JSON.stringify("@" + h)}`).limit(1);
      const s = (same as Json[] | null)?.[0];
      if (s) return ok(`Déjà au scouting : ${s.name} [${athletes ? "sportif" : "scouting"} ${s.id}].`);
    }
    const { data: top } = await sb.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const row: Json = {
      name: str(a.nom, 120), handle: handle || null, email: str(a.email, 200) || null, tag: str(a.categorie, 60) || null, note: str(a.note, 2000) || null,
      sort_order: ((top as { sort_order: number }[] | null)?.[0]?.sort_order ?? 0) + 1,
    };
    if (athletes) {
      row.club = str(a.club, 120) || null;
      row.level = str(a.niveau, 20) || null;
    }
    const { data, error } = await sb.from(table).insert(row).select("id").single<{ id: string }>();
    return error ? fail(`Profil non ajouté : ${error.message}`) : ok(`Ajouté au scouting ${athletes ? "sportifs" : "créateurs"} : ${str(a.nom, 120)} [${athletes ? "sportif" : "scouting"} ${data.id}].`);
  },
};

const statutScouting: Tool = {
  name: "changer_statut_scouting",
  title: "Changer le statut d'un profil repéré",
  description: "Change le statut d'un profil du scouting : observation, contacter, discussion, signe, ecarte (pas intéressé).",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["createurs", "sportifs"] },
      profil: { type: "string", description: "Id (donné par scouting) ou nom" },
      statut: { type: "string", enum: ["observation", "contacter", "discussion", "signe", "ecarte"] },
    },
    required: ["profil", "statut"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const athletes = str(a.type) === "sportifs";
    const key = str(a.profil, 120);
    const table = athletes ? "athlete_pool" : "creator_pool";
    const { data } = /^[0-9a-f-]{36}$/i.test(key) ? await sb.from(table).select("id, name").eq("id", key).limit(1) : await sb.from(table).select("id, name").ilike("name", like(key)).limit(2);
    const list = (data as Json[] | null) ?? [];
    if (list.length !== 1) return fail(list.length ? "Plusieurs profils correspondent : précise l'id." : "Profil introuvable.");
    const status = str(a.statut);
    if (!SCOUT_STATUS[status]) return fail("Statut inconnu.");
    const k = athletes ? "athleteTracking" : "poolTracking";
    const cur = ((await appState(sb))[k] ?? {}) as Record<string, Json>;
    const id = String(list[0].id);
    // Seule l'entrée de CE profil est réécrite (app_state_merge, sous verrou) : un statut
    // changé en même temps dans l'app pour un autre profil n'est jamais effacé.
    let { error } = await sb.rpc("app_state_merge", { p_key: k, p_set: { [id]: { ...(cur[id] ?? {}), status } }, p_remove: [] });
    if (error && /app_state_merge|PGRST202|42883/.test(`${error.code ?? ""} ${error.message}`)) {
      ({ error } = await sb.rpc("app_state_set", { p_key: k, p_value: { ...cur, [id]: { ...(cur[id] ?? {}), status } } }));
    }
    return error ? fail(`Statut non changé : ${error.message}`) : ok(`${list[0].name} : ${SCOUT_STATUS[status]}.`);
  },
};

const avancerCollab: Tool = {
  name: "avancer_collab",
  title: "Changer l'étape d'une collab",
  description: "Passe une collab à une étape (1 Signature, 2 Brief transmis, 3 Concept validé, 4 Tournage, 5 Validation marque, 6 Publication, 7 Stats à 7 jours, 8 Facture envoyée, 9 Paiement marque reçu, 10 Créateur payé, 11 Bilan).",
  write: true,
  inputSchema: { type: "object", properties: { collab: { type: "string", description: "Id de la collab (outil collabs)" }, etape: { type: "number" } }, required: ["collab", "etape"], additionalProperties: false },
  run: async (sb, _c, a) => {
    const id = str(a.collab, 40);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Id de collab invalide.");
    const step = int(a.etape, 0, 1, 11);
    if (!step) return fail("Étape entre 1 et 11.");
    const { data, error } = await sb.from("collabs").update({ step, updated_at: new Date().toISOString() }).eq("id", id).select("brand, creator").maybeSingle<{ brand: string; creator: string | null }>();
    if (error || !data) return fail("Collab introuvable ou non modifiée.");
    return ok(`${data.brand} × ${titleCase(data.creator)} : étape ${step} « ${COLLAB_STEPS[step - 1]} ».`);
  },
};

// ── Agents (section Agents de l'app) ────────────────────────────────────────
type AgentRow = { id: string; slug: string; nom: string; emoji: string; role: string | null; moteur: string; consignes: string; routines: { nom: string; quand: string; consigne: string }[]; actif: boolean };
async function findAgent(sb: SupabaseClient, key: string): Promise<AgentRow | null> {
  const db = sb.schema("agent");
  const k = key.trim();
  if (!k) return null;
  const { data } = /^[0-9a-f-]{36}$/i.test(k)
    ? await db.from("agents").select("*").eq("id", k).limit(1)
    : await db.from("agents").select("*").or(`slug.eq.${JSON.stringify(k.toLowerCase())},nom.ilike.${JSON.stringify(like(k))}`).order("sort_order").limit(1);
  return ((data as AgentRow[] | null) ?? [])[0] ?? null;
}
const agentJournal = (sb: SupabaseClient, agentId: string | null, action: string, detail: string) =>
  sb.schema("agent").from("journal").insert({ action, detail: detail.slice(0, 300), agent_id: agentId }).then(() => {}, () => {});

const mesAgents: Tool = {
  name: "mes_agents",
  title: "Agents de TTP",
  description: "Liste les agents configurés dans l'app TTP Suite (nom, rôle, en service ou en pause). Pour jouer un agent, appeler ensuite lire_agent.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  founder: true,
  run: async (sb) => {
    const { data, error } = await sb.schema("agent").from("agents").select("nom, emoji, role, moteur, actif").order("sort_order");
    if (error) return fail("Section Agents pas encore activée.");
    return ok([`# Agents de TTP`, ...((data as Json[]) ?? []).map((a) => `- ${a.emoji} ${a.nom}${a.actif ? "" : " (en pause)"} · ${a.moteur === "claude" ? "joué par Claude" : "programme externe"} · ${a.role ?? ""}`)].join("\n"));
  },
};

const lireAgent: Tool = {
  name: "lire_agent",
  title: "Consignes d'un agent",
  description: "À appeler EN PREMIER quand tu joues un agent de TTP (ex. « Talent manager ») : renvoie ses consignes à jour (rôle, ton, règles), ses routines et les leçons apprises (corrections de Marc). Applique-les pendant toute la conversation.",
  inputSchema: { type: "object", properties: { agent: { type: "string", description: "Nom de l'agent (ex. Talent manager)" } }, required: ["agent"], additionalProperties: false },
  founder: true,
  run: async (sb, _c, a) => {
    const ag = await findAgent(sb, str(a.agent, 80));
    if (!ag) return fail(`Agent « ${str(a.agent, 80)} » introuvable (outil mes_agents pour la liste).`);
    if (!ag.actif) return ok(`${ag.emoji} ${ag.nom} est en pause dans l'app : préviens Marc avant d'agir en son nom.`);
    const { data: lec } = await sb.schema("agent").from("lecons").select("module, lecon, agent_id, cree_le").or(`agent_id.eq.${ag.id},agent_id.is.null`).order("cree_le", { ascending: false }).limit(60);
    const { count } = await sb.schema("agent").from("actions").select("id", { count: "exact", head: true }).eq("statut", "a_valider").eq("agent_id", ag.id);
    await agentJournal(sb, ag.id, "agent_session", "Consignes relues");
    return ok([
      `# ${ag.emoji} ${ag.nom}`,
      ag.role ? `Rôle : ${ag.role}` : "",
      `\n${ag.consignes || "(Pas encore de consignes : demande à Marc de les écrire dans l'app, section Agents.)"}`,
      `\n## Leçons apprises (à respecter)`,
      lines(((lec as Json[] | null) ?? []).map((l) => `- ${l.module ? `[${l.module}] ` : ""}${l.lecon}`), "Aucune pour l'instant."),
      ag.routines?.length ? `\n## Routines\n${ag.routines.map((r) => `- ${r.nom} (${r.quand}) : ${r.consigne}`).join("\n")}` : "",
      `\n${count ?? 0} proposition(s) de cet agent attendent la validation de Marc.`,
    ].filter(Boolean).join("\n"));
  },
};

const proposerAction: Tool = {
  name: "proposer_action",
  title: "Proposer une action à valider",
  description: "Dépose une proposition dans la file « À valider » de l'app (section Agents) : message WhatsApp, DM Instagram, message LinkedIn, alerte, ou mail (préférer creer_brouillon_mail pour un mail). Marc la copie, l'ouvre et l'envoie lui-même, ou l'écarte.",
  write: true,
  founder: true,
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", description: "Nom de l'agent qui propose (ex. Talent manager)" },
      type: { type: "string", enum: ["whatsapp", "instagram", "linkedin", "brouillon_mail", "alerte"] },
      cible: { type: "string", description: "À qui (marque, créateur, @, numéro)" },
      contexte: { type: "string", description: "Pourquoi, en une ou deux phrases" },
      contenu: { type: "string", description: "Le message prêt à envoyer (ou le texte de l'alerte)" },
      lien: { type: "string", description: "Lien utile (profil, fil, document) facultatif" },
    },
    required: ["agent", "type", "contenu"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const ag = await findAgent(sb, str(a.agent, 80));
    const type = ["whatsapp", "instagram", "linkedin", "brouillon_mail", "alerte"].includes(str(a.type)) ? str(a.type) : "alerte";
    const lien = /^https?:\/\//i.test(str(a.lien, 500)) ? str(a.lien, 500) : null;
    const { error } = await sb.schema("agent").from("actions").insert({
      type, cible: str(a.cible, 200) || null, contexte: str(a.contexte, 1000) || null, contenu: str(a.contenu, 6000), lien_spark: lien, statut: "a_valider", agent_id: ag?.id ?? null,
    });
    if (error) return fail(`Proposition non déposée : ${error.message}`);
    await agentJournal(sb, ag?.id ?? null, "proposition", `${type} · ${str(a.cible, 120)}`);
    return ok(`Déposé dans « À valider » (${type}${str(a.cible) ? ` pour ${str(a.cible, 120)}` : ""}). Marc le verra dans l'app, section Agents.`);
  },
};

const noterLecon: Tool = {
  name: "noter_lecon",
  title: "Retenir une leçon",
  description: "Enregistre une correction ou une préférence de Marc pour qu'un agent (ou tous) ne refasse pas l'erreur. Ex. « Jamais de reel de Léa sous 800 € ».",
  write: true,
  founder: true,
  inputSchema: {
    type: "object",
    properties: { agent: { type: "string", description: "Nom de l'agent, ou « tous »" }, lecon: { type: "string" }, sujet: { type: "string", description: "Ex. Tarifs, Ton, Prospection" } },
    required: ["lecon"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const key = str(a.agent, 80);
    const ag = key && key.toLowerCase() !== "tous" ? await findAgent(sb, key) : null;
    const { error } = await sb.schema("agent").from("lecons").insert({ module: str(a.sujet, 60) || null, lecon: str(a.lecon, 1000), agent_id: ag?.id ?? null });
    if (error) return fail(`Leçon non enregistrée : ${error.message}`);
    await agentJournal(sb, ag?.id ?? null, "lecon", str(a.lecon, 120));
    return ok(`Leçon retenue${ag ? ` pour ${ag.nom}` : " pour tous les agents"} : « ${str(a.lecon, 200)} ».`);
  },
};

const MEM_CATS = ["anniversaire", "projet", "voyage", "examen", "objectif", "preference_tournage", "disponibilite"];
const memoireCreateur: Tool = {
  name: "memoire_createur",
  title: "Mémoire d'un créateur",
  description: "Ce que l'agence sait d'un créateur au-delà des chiffres : anniversaire, projets, voyages, objectifs, préférences de tournage, disponibilités. Avec « info », ajoute une nouvelle note (jamais de santé ni de vie privée).",
  founder: true,
  write: true, // ajoute une note quand « info » est fourni : Claude demande l'accord
  inputSchema: {
    type: "object",
    properties: {
      createur: { type: "string" },
      info: { type: "string", description: "Pour AJOUTER une note (facultatif)" },
      categorie: { type: "string", enum: MEM_CATS },
      date: { type: "string", description: "AAAA-MM-JJ si la note a une date" },
    },
    required: ["createur"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const who = str(a.createur, 80).toLowerCase();
    if (!who) return fail("Créateur manquant.");
    const db = sb.schema("agent");
    if (str(a.info)) {
      const cat = MEM_CATS.includes(str(a.categorie)) ? str(a.categorie) : "projet";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(a.date)) ? str(a.date) : null;
      const { error } = await db.from("memoire_createurs").insert({ creatrice: who, categorie: cat, info: str(a.info, 1000), date, source: "Claude" });
      return error ? fail(`Note non ajoutée : ${error.message}`) : ok(`Noté pour ${titleCase(who)} (${cat}).`);
    }
    const { data } = await db.from("memoire_createurs").select("categorie, info, date, cree_le").ilike("creatrice", like(who)).order("cree_le", { ascending: false }).limit(40);
    return ok([`# Mémoire · ${titleCase(who)}`, lines(((data as Json[] | null) ?? []).map((m) => `- [${m.categorie}] ${m.info}${m.date ? ` (${m.date})` : ""}`), "Rien en mémoire.")].join("\n"));
  },
};

const preparerReponseMail: Tool = {
  name: "preparer_reponse_mail",
  title: "Déposer une réponse dans l'app",
  description: "Dépose le texte d'une réponse à un fil de mails dans la page Mails de TTP Suite (zone de réponse du fil). L'équipe relit, modifie et envoie elle-même : rien n'est envoyé. Utiliser l'id du fil et la boîte du fil (lire_mail). Texte du mail seulement : sans objet ni signature (ajoutée par l'app).",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      fil: { type: "string", description: "Id du fil Gmail" },
      boite: { type: "string", enum: ["partnerships", "talent"] },
      texte: { type: "string", description: "Texte de la réponse (paragraphes séparés par une ligne vide)" },
    },
    required: ["fil", "boite", "texte"],
    additionalProperties: false,
  },
  run: async (sb, ctx, a) => {
    const id = str(a.fil, 40);
    if (!/^[A-Za-z0-9]+$/.test(id)) return fail("Id de fil invalide.");
    const box = str(a.boite) === "talent" ? "talent" : "partnerships";
    const body = str(a.texte, 8000).replace(/\s*[—–]\s*/g, ", ");
    if (!body) return fail("Texte vide.");
    const { error } = await sb.from("mail_reply_drafts").insert({ thread_id: id, box, body, created_by: ctx.userId });
    if (error) return fail(/relation|does not exist/i.test(error.message) ? "Le réglage « réponses de Claude » n'est pas encore installé dans l'app (SQL à lancer)." : `Réponse non déposée : ${error.message}`);
    return ok("Réponse déposée dans TTP Suite : elle apparaît dans la zone de réponse de ce fil (page Mails). Rien n'a été envoyé.");
  },
};

export const TOOLS: Tool[] = [
  pointDuJour, rechercher, roster, ficheCreateur, rechercherMails, lireMail, preparerReponseMail, dmInstagram, scouting, contacts, pipeline, collabs, planning, taches, factures,
  creerTache, creerEvenement, brouillonMail, ajouterContact, noterEchange, ajouterScouting, statutScouting, avancerCollab,
  mesAgents, lireAgent, proposerAction, noterLecon, memoireCreateur,
];

/** Liste MCP (les outils fondateurs n'apparaissent pas pour un membre). */
export function toolList(ctx: Ctx) {
  return TOOLS.filter((t) => !t.founder || ctx.founder).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
  }));
}

export async function callTool(sb: SupabaseClient, ctx: Ctx, name: string, args: Args): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return fail(`Outil inconnu : ${name}`);
  if (t.founder && !ctx.founder) return fail("Réservé aux fondateurs de l'agence.");
  let res: ToolResult;
  try {
    res = await t.run(sb, ctx, args ?? {});
  } catch (e) {
    res = fail(`Erreur : ${(e as Error).message}`);
  }
  // Journal : qui, quoi, quand (Paramètres → Claude).
  const summary = JSON.stringify(args ?? {}).slice(0, 300);
  await sb.from("mcp_log").insert({ user_id: ctx.userId, grant_id: ctx.grantId, tool: name, summary, ok: !res.isError }).then(() => {}, () => {});
  return res;
}

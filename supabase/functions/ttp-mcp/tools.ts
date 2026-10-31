// ============================================================================
// ttp-mcp/tools.ts : les outils de TTP Suite pour Claude.
// Lecture : point du jour, recherche, roster, fiche créateur, mails, DM Instagram,
// scouting (créateurs / sportifs), contacts, pipeline, collabs, planning, tâches,
// factures et méthode TARIF (fondateurs), briefs. Actions : tâche, rendez-vous, brouillon de mail, contact,
// échange noté, scouting, étape de collab, résumé de brief. Claude demande l'accord avant chaque action.
// Accès complet des fondateurs (admin.ts) : lire / créer / modifier / supprimer (Corbeille) partout,
// réglages, factures, envoi de mails et de DM Instagram.
// Jamais exposés : coffre des mots de passe, IBAN, jetons de connexion.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { triggerSync } from "../_shared/google.ts";
import { readAppState } from "../_shared/appState.ts";
import { activeByCreator, conflictsFor, excluLine, excluState, foldName, readExclusivites } from "../_shared/exclusivites.ts";
import type { Ctx } from "./oauth.ts";
import { boxesFor, createDraft, readThread, searchThreads, unreadCounts, type MailBox } from "./gmail.ts";
import { ADMIN_TOOLS } from "./admin.ts";
import { contractList, owesMoney, pctOf, reversementRows, type Detail, type Payout } from "../_shared/reversements.ts";
import { audienceOf, compact, perPlatformText, type EngEntry } from "../_shared/audience.ts";
import { creatorFloor, creatorTarifText, gridDiff, methodText, pastRates, pastRatesText, readTarifGrid, type CreatorForTarif, type InvoiceItemForPast } from "../_shared/tarif.ts";

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
  destructive?: boolean;
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
// « LÉNA PASQUALE » → « Léna Pasquale » (\b ignore les lettres accentuées : « LÉNa » avant).
const titleCase = (s: string | null | undefined) =>
  (s ?? "").toLocaleLowerCase("fr-FR").replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase("fr-FR"));

/** Engagement enregistré « 5,93 % » ou 5.93 → « 5,93 % » (jamais « % % »). */
const pct = (v: unknown) => `${String(v ?? "").trim().replace(/\s*%$/, "")} %`;
/** Heure d'un événement : « — », « - » ou vide = journée entière. */
const timeOf = (v: unknown) => {
  const t = String(v ?? "").trim();
  return t && !/^[—–-]+$/.test(t) ? t : "";
};
/** Conversation Instagram : @pseudo, sinon le nom, sinon une conversation sans identité. */
const dmWho = (d: Json) => (d.username ? `@${d.username}${d.name ? ` (${d.name})` : ""}` : d.name ? String(d.name) : "conversation sans pseudo (Instagram n'a pas donné l'identité)");

const COLLAB_STEPS = [
  "Signature", "Brief transmis au créateur", "Concept validé", "Tournage", "Validation marque", "Publication",
  "Statistiques à sept jours", "Facture envoyée", "Paiement marque reçu", "Créateur payé", "Bilan et renouvellement",
];
/** Comme la page Collabs : arrivée à l'étape 11 (Bilan), la collab est bouclée = terminée. */
const collabState = (r: Json) => (r.status === "active" && Number(r.step) >= COLLAB_STEPS.length ? "terminee" : String(r.status));
const COLLAB_LABEL: Record<string, string> = { active: "en cours", terminee: "bouclée", archivee: "archivée", gagnee: "gagnée", perdue: "perdue" };
const SCOUT_STATUS: Record<string, string> = { observation: "En observation", contacter: "À contacter", discussion: "En discussion", signe: "Signé", ecarte: "Pas intéressé" };
const INVOICE_STATUS: Record<string, string> = { brouillon: "Brouillon", attente: "En attente", retard: "En retard", payee: "Payée", annulee: "Annulée" };
/** Montant tel qu'enregistré (« 600,00 € ») : « € » ajouté seulement s'il manque. */
const money = (v: unknown) => {
  const t = String(v ?? "").trim();
  return !t ? "?" : /€/.test(t) ? t : `${t} €`;
};
/** Facture en retard (même règle que l'app, page Relances) : « En retard », ou « En attente » échue. */
const invoiceLate = (r: Json, today: string) => {
  if (r.status === "retard") return true;
  const d = dueIso(r.date);
  return r.status === "attente" && !!d && d < today;
};
/** Statut affiché : une facture « En attente » échue est « En retard ». */
const invoiceStatus = (r: Json, today: string) => (invoiceLate(r, today) ? "retard" : String(r.status));
/** Échéance lisible : « 1 oct. » si date complète, sinon le texte saisi (signalé). */
const dueText = (v: unknown) => {
  const d = dueIso(v);
  return d ? frDay(d) : `${String(v ?? "").trim() || "?"} (date incomplète)`;
};
/**
 * Date d'arrivée sur l'étape courante (historique `collab_steps`), sinon updated_at.
 * Le scan Instagram du matin réécrit chaque collab (updated_at) : ce n'est pas un mouvement.
 */
async function stepSince(sb: SupabaseClient, rows: Json[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = rows.map((r) => String(r.id)).filter(Boolean);
  if (!ids.length) return out;
  const { data } = await sb.from("collab_steps").select("collab_id, step, reached_at").in("collab_id", ids).order("reached_at");
  const byCollab = new Map<string, Json[]>();
  for (const s of (data as Json[] | null) ?? []) byCollab.set(String(s.collab_id), [...(byCollab.get(String(s.collab_id)) ?? []), s]);
  for (const r of rows) {
    const hit = [...(byCollab.get(String(r.id)) ?? [])].reverse().find((s) => Number(s.step) === Number(r.step));
    out.set(String(r.id), String(hit?.reached_at ?? r.updated_at ?? ""));
  }
  return out;
}

/** Mesures d'engagement de l'agence (blob) pour le total des abonnés. */
const engHistory = (st: Json) => (Array.isArray(st.engagementHistory) ? (st.engagementHistory as EngEntry[]) : []);

// FAIL-CLOSED : une lecture ratée ou illisible lève une erreur. Renvoyer {} ferait
// réécrire une clé entière à partir de rien (ex. tout le suivi du scouting effacé).
// Ligne commune + ligne argent des fondateurs (_shared/appState.ts).
async function appState(sb: SupabaseClient): Promise<Json> {
  return (await readAppState(sb)) as Json;
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
      sb.from("collabs").select("id, brand, creator, step, updated_at").eq("status", "active").lt("step", COLLAB_STEPS.length).limit(300),
      ctx.founder ? sb.from("invoices").select("ref, party, amount, date, status").in("status", ["retard", "attente"]).limit(50) : Promise.resolve({ data: [] }),
    ]);
    const bad = [ev, todos, dms, collabs, inv].find((r) => (r as { error?: { message: string } | null }).error);
    if (bad) return fail(`Lecture impossible (${(bad as { error: { message: string } }).error.message}) : réessaie dans un instant.`);
    const mails = await unreadCounts(sb).catch(() => []);
    // Bloquée = 7 jours ou plus sur la même étape (historique des étapes, comme la page Collabs).
    const activeCollabs = (collabs.data as Json[] | null) ?? [];
    const since = await stepSince(sb, activeCollabs);
    const stuck = activeCollabs
      .map((c) => ({ c, d: Math.floor((Date.now() - Date.parse(since.get(String(c.id)) ?? "")) / 86400000) }))
      .filter((x) => Number.isFinite(x.d) && x.d >= 7)
      .sort((x, y) => y.d - x.d)
      .slice(0, 15);
    const evs = (ev.data as Json[] | null) ?? [];
    const late = ((inv.data as Json[] | null) ?? []).filter((r) => invoiceLate(r, today));
    const out = [
      `# Point du ${frDay(today)}`,
      `\n## Rendez-vous`,
      lines(evs.map((e) => `- ${e.date === today ? "Aujourd'hui" : "Demain"} ${timeOf(e.time) || "(journée)"} · ${e.title}${e.who ? ` · ${titleCase(String(e.who))}` : ""} [${e.type}]`), "Aucun."),
      `\n## Tâches en retard ou du jour`,
      lines(((todos.data as Json[] | null) ?? []).map((t) => ({ t, d: dueIso(t.due) })).filter((x) => x.d && x.d <= today).sort((x, y) => x.d.localeCompare(y.d)).slice(0, 30)
        .map(({ t, d }) => `- ${t.text}${t.creator ? ` (${titleCase(String(t.creator))})` : ""} · ${d < today ? "en retard depuis le" : "pour aujourd'hui,"} ${frDay(d)}${t.priority === "haute" ? " · priorité haute" : ""}`), "Aucune."),
      `\n## DM Instagram sans réponse (3 derniers jours)`,
      lines(((dms.data as Json[] | null) ?? []).map((d) => `- ${dmWho(d)} : « ${String(d.last_text ?? "").slice(0, 120)} »`), "Aucun."),
      `\n## Mails non lus (comme l'app : boîte de réception, hors Promotions et Réseaux sociaux)`,
      lines(mails.map((m) => `- ${m}`), "Lecture impossible."),
      `\n## Collabs sans mouvement depuis 7 jours`,
      lines(stuck.map(({ c, d }) => `- ${c.brand} × ${titleCase(String(c.creator ?? ""))} · étape ${c.step} « ${COLLAB_STEPS[Number(c.step) - 1] ?? ""} » depuis ${d} j`), "Aucune."),
    ];
    if (ctx.founder) {
      out.push(`\n## Factures en retard`, lines(late.map((f) => `- ${f.ref} · ${f.party} · ${money(f.amount)} · échéance ${dueText(f.date)}`), "Aucune."));
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
    // « @lenaa.psl » : les @ des DM sont enregistrés sans « @ ».
    const q = str(a.requete, 80).replace(/^@+/, "");
    if (q.length < 2) return fail("Donne au moins 2 caractères.");
    const [cr, ct, pr, co, sp, ap, ig, inv] = await Promise.all([
      sb.from("creators").select("name, niche, platform, followers, status").or(orLike(["name", "handle", "instagram", "tiktok", "email_pro"], q)).limit(8),
      sb.from("contacts").select("id, brand, person, email, instagram, last_contacted").or(orLike(["brand", "person", "email", "instagram", "first_name", "last_name"], q)).limit(8),
      sb.from("prospects").select("brand, contact, stage, value").or(orLike(["brand", "contact"], q)).limit(8),
      sb.from("collabs").select("id, brand, creator, step, status").or(orLike(["brand", "creator", "title"], q)).limit(8),
      sb.from("creator_pool").select("id, name, handle, tag").or(orLike(["name", "handle", "email", "tag"], q)).limit(8),
      sb.from("athlete_pool").select("id, name, handle, tag, club").or(orLike(["name", "handle", "email", "tag", "club"], q)).limit(8),
      sb.from("ig_threads").select("id, username, name, last_text").or(orLike(["username", "name"], q)).limit(8),
      ctx.founder ? sb.from("invoices").select("ref, party, amount, date, status").or(orLike(["ref", "party", "creator"], q)).limit(8) : Promise.resolve({ data: [] }),
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
      ...sec("DM Instagram", ig.data as Json[], (r) => `${dmWho(r)} : « ${String(r.last_text ?? "").slice(0, 100)} » [dm ${r.id}]`),
      ...sec("Factures", inv.data as Json[], (r) => `${r.ref} · ${r.party} · ${money(r.amount)} · ${INVOICE_STATUS[invoiceStatus(r, isoDay())] ?? r.status}`),
    ];
    return ok(out.length > 1 ? out.join("\n") : `Rien trouvé pour « ${q} » (essaie rechercher_mails pour les mails).`);
  },
};

const roster: Tool = {
  name: "lister_createurs",
  title: "Roster",
  description: "Liste les créateurs représentés par l'agence (roster) : niche, plateforme, abonnés, engagement, statut, et ⚠ leurs exclusivités en cours. Filtre facultatif par statut (actif, inactif) ou niche.",
  inputSchema: { type: "object", properties: { statut: { type: "string", enum: ["actif", "inactif", "tous"] }, niche: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("creators").select("name, niche, platform, followers, er, status, ville, handle, instagram, tiktok, ig, tt, yt").order("sort_order");
    const st = str(a.statut);
    if (st && st !== "tous") q = q.eq("status", st);
    if (str(a.niche)) q = q.ilike("niche", like(str(a.niche)));
    const { data, error } = await q;
    if (error) return fail("Lecture du roster impossible.");
    const rows = (data as Json[]) ?? [];
    // Exclusivités en cours (page Exclusivités) : à ne jamais oublier avant de proposer quelqu'un.
    const state = await appState(sb).catch(() => ({} as Json));
    const exclu = activeByCreator(readExclusivites(state.exclusivites), isoDay());
    const ex = (n: unknown) => (exclu.get(String(n).trim().toLowerCase()) ?? []).map((e) => ` · ⚠ ${excluLine(e)}`).join("");
    const hist = engHistory(state);
    // Anciens créateurs (factures sans fiche roster) : listés pour « inactif » et « tous ».
    let former: string[] = [];
    if (st === "inactif" || st === "tous") {
      const { data: inv } = await sb.from("invoices").select("creator").not("creator", "is", null).limit(5000);
      const known = new Set(((data as Json[]) ?? []).map((r) => String(r.name).trim().toLowerCase()));
      const { data: all } = await sb.from("creators").select("name");
      for (const r of (all as Json[] | null) ?? []) known.add(String(r.name).trim().toLowerCase());
      const first = new Set([...known].map((k) => k.split(/\s+/)[0]));
      former = [...new Set(((inv as Json[] | null) ?? []).map((r) => String(r.creator).trim()).filter((n) => n && !known.has(n.toLowerCase()) && !first.has(n.toLowerCase())))].sort();
    }
    if (former.length) rows.push(...former.map((n) => ({ name: n, status: "hors roster (ancien créateur, a des factures)" } as Json)));
    return ok([`# Roster · ${rows.length} créateur(s)`, "Abonnés = total tous réseaux (comme la page Roster), détail par réseau entre parenthèses.", ...rows.map((r) => {
      const au = audienceOf({ name: String(r.name), followers: r.followers, ig: r.ig as Json | null, tt: r.tt as Json | null, yt: r.yt as Json | null }, hist);
      const detail = perPlatformText(au);
      const accounts = [r.instagram && `IG ${r.instagram}`, r.tiktok && `TT ${r.tiktok}`, !r.instagram && !r.tiktok && r.handle && String(r.handle)].filter(Boolean).join(" · ");
      return `- ${titleCase(String(r.name))} · ${r.niche ?? "?"} · ${r.platform || "?"} · ${compact(au.total)} abonnés${detail ? ` (${detail})` : ""} · engagement ${r.er ?? "?"} · ${r.status ?? ""}${r.ville ? ` · ${r.ville}` : ""}${accounts ? ` · ${accounts}` : ""}${ex(r.name)}`;
    })].join("\n"));
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
    if ("error" in found) return /^Aucun créateur/.test(found.error) ? formerCreator(sb, ctx, n, found.error) : fail(found.error);
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
    const st = await appState(sb).catch(() => ({} as Json));
    const hist = engHistory(st);
    const au = audienceOf({ name, followers: c.followers, ig, tt, yt }, hist);
    // Dernière mesure d'engagement de chaque réseau (page de la fiche, « Mesures »).
    const lastEng = new Map<string, Json>();
    for (const h of hist.filter((h) => (h.creator ?? "").trim().toLowerCase() === name.trim().toLowerCase()) as Json[]) {
      const pf = String(h.platform ?? "").toLowerCase();
      const cur = lastEng.get(pf);
      if (pf && (!cur || dueIso(h.date) > dueIso(cur.date))) lastEng.set(pf, h);
    }
    const measure = (pf: string, label: string) => {
      const h = lastEng.get(pf);
      return h ? `${label} (mesure du ${h.date ?? "?"}) : ${h.followers ?? "?"} abonnés${h.er ? ` · engagement ${pct(h.er)}` : ""}` : "";
    };
    const out = [
      `# ${titleCase(name)}`,
      `Niche : ${c.niche ?? "?"} · plateforme : ${c.platform || "?"} · abonnés tous réseaux : ${compact(au.total)}${perPlatformText(au) ? ` (${perPlatformText(au)})` : ""} · engagement : ${c.er ?? "?"} · statut : ${c.status ?? "?"}${c.ville ? ` · ${c.ville}` : ""}`,
      `Comptes : ${[c.handle && `@${String(c.handle).replace(/^@+/, "").trim()}`, c.instagram && `IG ${c.instagram}`, c.tiktok && `TikTok ${c.tiktok}`, c.youtube && `YouTube ${c.youtube}`, c.email_pro && `email pro ${c.email_pro}`].filter(Boolean).join(" · ") || "?"}`,
      ig && ig.followers != null
        ? `Instagram (relevé automatique Meta) : ${ig.followers} abonnés${ig.er != null ? ` · engagement ${pct(ig.er)}` : ""}${ig.reach30 ? ` · couverture 28 j ${ig.reach30}` : ""}`
        : [measure("instagram", "Instagram"), ig?.why ? `Relevé automatique Instagram indisponible (${ig.why === "compte_perso" ? "compte personnel : Meta ne donne les chiffres que d'un compte professionnel" : ig.why})` : ""].filter(Boolean).join("\n"),
      tt ? `TikTok (relevé automatique) : ${tt.followers ?? "?"} abonnés${tt.er != null ? ` · engagement ${pct(tt.er)}` : ""}${tt.avgViews ? ` · vues moyennes ${tt.avgViews}` : ""}` : measure("tiktok", "TikTok"),
      yt ? `YouTube (relevé automatique) : ${yt.subscribers ?? "?"} abonnés${yt.avgViews ? ` · vues moyennes ${yt.avgViews}` : ""}` : measure("youtube", "YouTube"),
      ...[...lastEng.keys()].filter((k) => !["instagram", "tiktok", "youtube"].includes(k)).map((k) => measure(k, titleCase(k))),
      `\n## Collabs`,
      lines(((col.data as Json[] | null) ?? []).map((r) => `- ${r.brand} · étape ${r.step}/11 « ${COLLAB_STEPS[Number(r.step) - 1] ?? ""} » · ${COLLAB_LABEL[collabState(r)] ?? collabState(r)}${r.cachet ? ` · cachet ${r.cachet}` : ""} [collab ${r.id}]`), "Aucune."),
      `\n## Prochains rendez-vous`,
      lines(((ev.data as Json[] | null) ?? []).map((e) => `- ${frDay(String(e.date))} ${timeOf(e.time) || "(journée)"} · ${e.title} [${e.type}]`), "Aucun."),
      `\n## Tâches ouvertes`,
      lines(((td.data as Json[] | null) ?? []).map((t) => `- ${t.text}${t.due ? ` · échéance ${t.due}` : ""}`), "Aucune."),
    ];
    const exclus = readExclusivites(st.exclusivites)
      .filter((e) => e.creator.trim().toLowerCase() === name.trim().toLowerCase() && excluState(e, today) !== "terminee");
    out.push(`\n## Exclusivités (ne pas proposer de concurrent)`, lines(exclus.map((e) => `- ${excluLine(e)}${e.points.length ? `\n  Points clés : ${e.points.join(" | ")}` : ""}`), "Aucune."));
    if (ctx.founder) out.push(`\n## Factures`, lines(((inv.data as Json[] | null) ?? []).map((f) => `- ${f.ref} · ${f.party} · ${money(f.amount)} · ${INVOICE_STATUS[invoiceStatus(f, today)] ?? f.status} · échéance ${dueText(f.date)}`), "Aucune."));
    return ok(out.filter(Boolean).join("\n"));
  },
};

/** Créateur qui n'est plus (ou pas) dans le roster mais a encore des factures, briefs, gifting ou reversements. */
async function formerCreator(sb: SupabaseClient, ctx: Ctx, n: string, notFound: string): Promise<ToolResult> {
  const pat = like(n);
  const [inv, br, gi] = await Promise.all([
    ctx.founder ? sb.from("invoices").select("ref, party, amount, date, status, creator").ilike("creator", pat).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    sb.from("briefs").select("brand, creator, status, due").ilike("creator", pat).limit(20),
    sb.from("gifting").select("brand, product, creator, received_on").ilike("creator", pat).limit(20),
  ]);
  const invs = ((inv as { data: unknown }).data as Json[] | null) ?? [];
  const briefs = ((br as { data: unknown }).data as Json[] | null) ?? [];
  const gifts = ((gi as { data: unknown }).data as Json[] | null) ?? [];
  const names = [...new Set([...invs, ...briefs, ...gifts].map((r) => String(r.creator ?? "").trim()).filter(Boolean))];
  if (!names.length) return fail(notFound);
  const today = isoDay();
  const out = [`# ${titleCase(names[0])} (hors roster : ancien créateur ou pas encore ajouté)`, names.length > 1 ? `Noms trouvés : ${names.map((x) => titleCase(x)).join(", ")}` : ""];
  if (ctx.founder) {
    const st = await appState(sb).catch(() => ({} as Json));
    const rows = reversementRows({
      invoices: invs as unknown as { id: string; amount: unknown; status: unknown; creator: unknown }[],
      details: {},
      payouts: (st.creatorPayouts ?? {}) as Record<string, Payout[]>,
      rosterRates: {},
      savedRates: (st.creatorCommission ?? {}) as Record<string, number>,
      collabModes: (st.collabCashMode ?? {}) as Record<string, string>,
      contractHistory: st.contractHistory,
    }).filter((r) => names.some((x) => x.trim().toLowerCase() === r.creator.trim().toLowerCase()));
    out.push(`\n## Factures`, lines(invs.map((f) => `- ${f.ref} · ${f.party} · ${money(f.amount)} · ${INVOICE_STATUS[invoiceStatus(f, today)] ?? f.status} · échéance ${dueText(f.date)}`), "Aucune."));
    out.push(`\n## Reversements`, lines(rows.map((r) => `- dû ${eur(r.du)} · versé ${eur(r.reverse)} · reste ${eur(r.reste)}`), "Rien à reverser."));
  }
  out.push(`\n## Briefs`, lines(briefs.map((b) => `- ${b.brand} · ${b.status ?? ""}${b.due ? ` · échéance ${b.due}` : ""}`), "Aucun."));
  out.push(`\n## Gifting`, lines(gifts.map((g) => `- ${g.brand}${g.product ? ` · ${g.product}` : ""}${g.received_on ? ` · reçu le ${g.received_on}` : ""}`), "Aucun."));
  return ok(out.filter(Boolean).join("\n"));
}

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const reversements: Tool = {
  name: "reversements",
  title: "Reversements créateurs",
  description: "Ce que l'agence doit à chaque créateur (réservé aux fondateurs) : part créateur des factures payées par la marque, déjà versé, reste à verser, dernier virement. Mêmes chiffres que la page Reversements. Filtre facultatif par créateur.",
  inputSchema: { type: "object", properties: { createur: { type: "string" }, tous: { type: "boolean", description: "Aussi les créateurs à jour (défaut : seulement ceux à qui on doit de l'argent)" } }, additionalProperties: false },
  founder: true,
  run: async (sb, _c, a) => {
    const [{ data: inv, error }, { data: cr }] = await Promise.all([
      sb.from("invoices").select("id, amount, status, creator, collab_id").eq("status", "payee").limit(5000),
      sb.from("creators").select("name, commission"),
    ]);
    if (error) return fail(`Factures illisibles : ${error.message}`);
    const st = await appState(sb);
    const roster: Record<string, number> = {};
    for (const c of (cr as Json[] | null) ?? []) {
      const v = pctOf(c.commission);
      if (v != null) roster[String(c.name)] = v;
    }
    let rows = reversementRows({
      invoices: (inv as unknown as { id: string; amount: unknown; status: unknown; creator: unknown; collab_id: unknown }[]) ?? [],
      details: (st.invoiceDetails ?? {}) as Record<string, Detail>,
      payouts: (st.creatorPayouts ?? {}) as Record<string, Payout[]>,
      rosterRates: roster,
      savedRates: (st.creatorCommission ?? {}) as Record<string, number>,
      collabModes: (st.collabCashMode ?? {}) as Record<string, string>,
      contractHistory: st.contractHistory,
    });
    const who = str(a.createur, 80).toLowerCase();
    if (who) rows = rows.filter((r) => r.creator.toLowerCase().includes(who));
    const owing = rows.filter(owesMoney);
    const shown = a.tous === true || who ? rows : owing;
    const total = owing.reduce((s, r) => s + r.reste, 0);
    return ok([
      `# Reversements · reste à verser ${eur(total)} à ${owing.length} créateur(s)`,
      ...shown.map((r) => `- ${titleCase(r.creator)} · reste ${eur(r.reste)} · dû ${eur(r.du)} (factures payées ${eur(r.encaisse)} TTC, commission ${r.rate} %) · versé ${eur(r.reverse)}${r.lastPayout ? ` · dernier virement ${frDay(r.lastPayout)}` : ""}`),
      shown.length ? "" : "Tout est à jour.",
    ].filter(Boolean).join("\n"));
  },
};

const contrats: Tool = {
  name: "contrats",
  title: "Contrats et fins de contrat",
  description: "Contrats des créateurs (représentation, marque, UGC) avec leur date de fin, comme la page Fins de contrat : à renouveler dans les 30 jours, déjà échus, puis les autres. Filtre facultatif par créateur.",
  inputSchema: { type: "object", properties: { createur: { type: "string" }, tous: { type: "boolean", description: "Aussi les contrats déjà renouvelés" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    const st = await appState(sb);
    const today = isoDay();
    const who = str(a.createur, 80).toLowerCase();
    const TYPE: Record<string, string> = { "représentation": "Représentation", representation: "Représentation", marque: "Marque", ugc: "UGC" };
    const days = (end: string) => Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
    const list = contractList(st.contractDeadlines).filter((d) => (a.tous === true || !d.renewed) && (!who || String(d.creator ?? "").toLowerCase().includes(who)));
    const line = (d: (typeof list)[number]) => {
      const left = days(d.end);
      return `- ${titleCase(String(d.creator))} · ${TYPE[String(d.type ?? "").toLowerCase()] ?? (d.type || "Contrat")} · fin le ${frDay(d.end)} (${left < 0 ? `échu depuis ${-left} j` : left === 0 ? "aujourd'hui" : `dans ${left} j`})${d.months ? ` · ${d.months} mois depuis le ${frDay(String(d.start))}` : ""}${d.renewed ? " · renouvelé" : ""}${d.note ? ` · ${String(d.note).slice(0, 120)}` : ""}`;
    };
    const soon = list.filter((d) => !d.renewed && days(d.end) <= 30);
    const later = list.filter((d) => !soon.includes(d));
    return ok([
      `# Contrats · ${list.length}`,
      `\n## À renouveler (30 jours) ou échus`, lines(soon.map(line), "Aucun."),
      `\n## Plus tard`, lines(later.map(line), "Aucun."),
    ].join("\n"));
  },
};

/** Proposition qu'un agent a lui même déclarée périmée (« PÉRIMÉ … à écarter »). */
const isStale = (r: Json) => /^\s*p[ée]rim[ée]/i.test(String(r.contexte ?? ""));

const aValider: Tool = {
  name: "a_valider",
  title: "File « À valider » des agents",
  description: "Propositions des agents qui attendent la validation de l'équipe (page Agents → À valider) : messages WhatsApp ou mails à envoyer, alertes. Les propositions marquées périmées par l'agent sont listées à part. Donne l'id pour ecarter_proposition.",
  inputSchema: { type: "object", properties: { agent: { type: "string", description: "Nom de l'agent (facultatif)" } }, additionalProperties: false },
  founder: true,
  run: async (sb, _c, a) => {
    const db = sb.schema("agent");
    const [{ data, error }, { data: ags }] = await Promise.all([
      db.from("actions").select("id, type, cible, contexte, contenu, cree_le, agent_id").eq("statut", "a_valider").order("cree_le", { ascending: false }).limit(200),
      db.from("agents").select("id, nom, slug"),
    ]);
    if (error) return fail(`Lecture de la file impossible : ${error.message}`);
    const agents = new Map(((ags as Json[] | null) ?? []).map((x) => [String(x.id), x]));
    const nameOf = (r: Json) => String((r.agent_id ? agents.get(String(r.agent_id))?.nom : [...agents.values()].find((x) => x.slug === "megan")?.nom) ?? "Agent");
    const want = str(a.agent, 60).toLowerCase();
    const rows = ((data as Json[] | null) ?? []).filter((r) => !want || nameOf(r).toLowerCase().includes(want));
    const live = rows.filter((r) => !isStale(r));
    const stale = rows.filter(isStale);
    const line = (r: Json) => `- [${r.type}] ${r.cible ?? ""} · ${nameOf(r)} · ${frDay(String(r.cree_le))} [proposition ${r.id}]${r.contexte ? `\n  Contexte : ${String(r.contexte).slice(0, 300)}` : ""}${r.contenu ? `\n  Message : ${String(r.contenu).slice(0, 500)}` : ""}`;
    return ok([
      `# À valider · ${live.length} proposition(s)${stale.length ? ` (+ ${stale.length} périmée(s) à écarter)` : ""}`,
      lines(live.map(line), "Rien à valider."),
      stale.length ? `\n## Périmées (l'agent les a remplacées : à écarter)\n${stale.map(line).join("\n")}` : "",
    ].filter(Boolean).join("\n"));
  },
};

const ecarterProposition: Tool = {
  name: "ecarter_proposition",
  title: "Écarter une proposition d'agent",
  description: "Retire une proposition de la file « À valider » (statut Écarté), par exemple une proposition périmée ou remplacée par une plus récente. Donner l'id (a_valider).",
  inputSchema: { type: "object", properties: { proposition: { type: "string", description: "Id de la proposition" } }, required: ["proposition"], additionalProperties: false },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const id = str(a.proposition, 40);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Id de proposition invalide.");
    const db = sb.schema("agent");
    const { data, error } = await db.from("actions").update({ statut: "ecarte", traite_le: new Date().toISOString() }).eq("id", id).eq("statut", "a_valider").select("type, cible");
    if (error) return fail(`Proposition non écartée : ${error.message}`);
    const row = (data as Json[] | null)?.[0];
    if (!row) return fail("Proposition introuvable ou déjà traitée.");
    await db.from("journal").insert({ action: "marc_ecarte", detail: `${row.type} · ${row.cible ?? ""} (via Claude)` }).then(() => {}, () => {});
    return ok(`Proposition écartée : ${row.type} · ${row.cible ?? ""}.`);
  },
};

const verifierExclusivite: Tool = {
  name: "verifier_exclusivite",
  title: "Vérifier une exclusivité",
  description: "À appeler AVANT de proposer un créateur à une marque (prospection, réponse à un mail ou à un DM) : liste les créateurs du roster en exclusivité avec un concurrent de cette marque (en cours ou à venir), qu'il ne faut pas proposer. Avec « createur », dit si CE créateur peut travailler avec la marque.",
  inputSchema: { type: "object", properties: { marque: { type: "string", description: "Marque à qui on veut proposer quelqu'un" }, createur: { type: "string", description: "Créateur envisagé (facultatif)" } }, required: ["marque"], additionalProperties: false },
  run: async (sb, _c, a) => {
    const brand = str(a.marque, 80);
    if (!brand) return fail("Donne la marque.");
    const list = readExclusivites((await appState(sb)).exclusivites);
    const today = isoDay();
    const who = str(a.createur, 80);
    // Secteurs de la marque (étiquette de sa fiche contact) : une exclusivité « même catégorie »
    // la bloque aussi, même si elle n'est pas citée parmi les concurrents.
    const { data: tags } = await sb.from("contacts").select("tag").ilike("brand", exact(brand)).not("tag", "is", null).limit(20);
    const brandTags = [...new Set(((tags as Json[] | null) ?? []).map((r) => String(r.tag ?? "").trim()).filter(Boolean))];
    const names = who ? [who] : [...new Set(list.map((e) => e.creator))];
    const hits = names.flatMap((n) => conflictsFor(list, n, brand, today, brandTags));
    // Engagements en cours (collabs, briefs) : un contrat signé n'est pas toujours saisi en
    // exclusivité. On les montre pour juger soi-même si la marque en est concurrente.
    const [{ data: col }, { data: br }, { data: docs }] = await Promise.all([
      (who ? sb.from("collabs").select("brand, creator, step, status").ilike("creator", like(who)) : sb.from("collabs").select("brand, creator, step, status")).eq("status", "active").lt("step", COLLAB_STEPS.length).limit(100),
      (who ? sb.from("briefs").select("brand, creator, due, status").ilike("creator", like(who)) : sb.from("briefs").select("brand, creator, due, status")).neq("status", "terminé").limit(100),
      // Briefs et contrats déposés en PDF dans Documents ces 6 derniers mois (ex. un brief
      // de marque avec sa liste de concurrents interdits, sans fiche dans la page Briefs).
      (who ? sb.from("documents").select("name, creator, type, created_at").ilike("creator", like(who)) : sb.from("documents").select("name, creator, type, created_at"))
        .in("type", ["brief", "contract", "contrat"]).gte("created_at", addDays(today, -183)).limit(100),
    ]);
    const engaged = [
      ...((col as Json[] | null) ?? []).map((r) => `- ${titleCase(String(r.creator ?? "?"))} · collab ${r.brand} en cours (étape ${r.step}/11)`),
      ...((br as Json[] | null) ?? []).filter((r) => r.creator).map((r) => `- ${titleCase(String(r.creator))} · brief ${r.brand}${r.due ? ` (échéance ${r.due})` : ""}`),
      ...((docs as Json[] | null) ?? []).filter((r) => r.creator).map((r) => `- ${titleCase(String(r.creator))} · ${r.type} en PDF « ${r.name} » (déposé le ${String(r.created_at).slice(0, 10)}, à lire avec lire_brief : il peut lister des concurrents interdits)`),
    ];
    const out: string[] = [];
    if (!list.length) out.push("⚠ Aucune exclusivité n'est enregistrée dans TTP Suite (page Exclusivités) : ce contrôle ne garantit rien. Vérifie les contrats et briefs en cours ci-dessous avant de proposer quelqu'un, et demande à l'équipe en cas de doute.");
    if (hits.length) out.push(`# À ne pas proposer à ${brand}`, ...hits.map((e) => `- ${titleCase(e.creator)} : ${excluLine(e)}`));
    else if (list.length) out.push(who ? `${titleCase(who)} n'a aucune exclusivité enregistrée qui bloque ${brand}.` : `Aucun créateur n'a d'exclusivité enregistrée contre ${brand}.`);
    if (engaged.length) out.push(`\n## Engagements en cours (vérifie que ${brand} n'est pas concurrent de ces marques)`, ...engaged);
    return ok(out.join("\n"));
  },
};

const rechercherMails: Tool = {
  name: "rechercher_mails",
  title: "Rechercher dans les mails",
  description: "Cherche dans les boîtes Gmail de l'agence (partnerships@ et talent@). La requête suit la syntaxe Gmail : « from:nike », « is:unread », « newer_than:7d », « subject:contrat », « in:sent », etc. Vide = derniers mails de la boîte de réception. Non lus comptés comme l'app et le point du jour : « in:inbox is:unread -category:promotions -category:social » avec max 25. Renvoie l'id du fil pour lire_mail.",
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
    else if (threads.length >= int(a.max, 10, 1, 25)) out.push(`\n(${threads.length} premiers fils seulement : il y en a peut-être d'autres, relance avec max plus grand.)`);
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
    return ok([`# DM Instagram`, ...((data as Json[] | null) ?? []).map((r) => `- ${dmWho(r)} · ${String(r.updated_at ?? "").slice(0, 10)} · ${r.last_from_me ? "TTP" : "eux"} : « ${String(r.last_text ?? "").slice(0, 120)} »${(r.emails as string[] | null)?.length ? ` · email ${(r.emails as string[])[0]}` : ""} [dm ${r.id}]`)].join("\n"));
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
    return ok([`# Scouting ${athletes ? "sportifs" : "créateurs"} · ${rows.length} profil(s)`, ...rows.map((x) => `- ${x.r.name} · ${x.r.handle ?? "sans @"} · ${x.niche || "sans catégorie"}${athletes && x.r.club ? ` · ${x.r.club}` : ""}${athletes && x.r.level ? ` · ${x.r.level}` : ""} · ${SCOUT_STATUS[x.status] ?? x.status}${x.fol != null ? ` · ${x.fol.toLocaleString("fr-FR")} abonnés` : ""}${x.er != null ? ` · engagement ${pct(x.er)}` : ""}${x.r.last_contacted ? ` · contacté le ${String(x.r.last_contacted).slice(0, 10)}` : ""}${x.r.email ? ` · ${x.r.email}` : ""} [${athletes ? "sportif" : "scouting"} ${x.r.id}]`)].join("\n"));
  },
};

const contacts: Tool = {
  name: "contacts",
  title: "Contacts marques",
  description: "Carnet des contacts marques (CRM) avec email, Instagram, dernier contact et historique des échanges. Par défaut les plus récemment contactés d'abord. « a_relancer » = même règle que la page Contacts (aucun échange depuis le délai de relance réglé, 45 jours par défaut). « max » jusqu'à 500, « depuis » pour la page suivante.",
  inputSchema: {
    type: "object",
    properties: {
      recherche: { type: "string" },
      a_relancer: { type: "boolean" },
      jamais_contactes: { type: "boolean", description: "Seulement les contacts jamais contactés" },
      max: { type: "number", description: "1 à 500 (défaut 50)" },
      depuis: { type: "number", description: "Position de départ (pagination, défaut 0)" },
    },
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    // Tout le carnet (quelques centaines de lignes), filtré ici avec la règle de l'app.
    const all: Json[] = [];
    for (let from = 0; from < 10000; from += 1000) {
      // « * » : marche avec ou sans la colonne linkedin.
      let q = sb.from("contacts").select("*").order("id").range(from, from + 999);
      if (str(a.recherche)) q = q.or(orLike(["brand", "person", "email", "instagram", "tag"], str(a.recherche, 60)));
      const { data, error } = await q;
      if (error) return fail(`Lecture des contacts impossible : ${error.message}`);
      all.push(...((data as Json[]) ?? []));
      if (((data as Json[]) ?? []).length < 1000) break;
    }
    const st = await appState(sb).catch(() => ({} as Json));
    const relanceDays = Math.max(1, Number((st.prospectSettings as Json | undefined)?.relanceDays) || 45);
    // Marques en affaire avec l'agence (collab en cours, négociation au pipeline) : on leur
    // parle déjà, elles ne sont ni « à relancer » ni « jamais contactées », même si le
    // carnet n'a pas encore noté l'échange.
    const [{ data: liveCol }, { data: liveProsp }] = await Promise.all([
      sb.from("collabs").select("brand, step").eq("status", "active").lt("step", COLLAB_STEPS.length).limit(500),
      sb.from("prospects").select("brand, stage").limit(500),
    ]);
    const deal = new Map<string, string>();
    for (const r of (liveProsp as Json[] | null) ?? []) if (!/perdu|refus|sign|gagn/i.test(String(r.stage ?? ""))) deal.set(foldName(String(r.brand ?? "")), `${String(r.stage ?? "pipeline").toLowerCase()} en cours`);
    for (const r of (liveCol as Json[] | null) ?? []) deal.set(foldName(String(r.brand ?? "")), "collab en cours");
    const dealOf = (brand: unknown) => {
      const b = foldName(String(brand ?? ""));
      if (!b) return "";
      for (const [k, v] of deal) if (k && (k === b || (Math.min(k.length, b.length) >= 4 && (k.startsWith(b) || b.startsWith(k))))) return v;
      return "";
    };
    type T = { date: string; canal: string; kind?: string; note?: string };
    const ms = (d: unknown) => { const t = new Date(String(d ?? "")).getTime(); return Number.isFinite(t) ? t : 0; };
    const rows = all.map((r) => {
      const t = ((Array.isArray(r.touches) ? r.touches : []) as T[]).filter((x) => x && typeof x.date === "string" && typeof x.canal === "string").sort((x, y) => ms(y.date) - ms(x.date));
      const lastAt = Math.max(ms(t[0]?.date), ms(r.last_contacted));
      const busy = dealOf(r.brand);
      return { r, t, lastAt, busy, relance: !busy && lastAt > 0 && Date.now() - lastAt >= relanceDays * 86400000 };
    });
    const toRelance = rows.filter((x) => x.relance).length;
    const never = rows.filter((x) => !x.lastAt && !x.busy).length;
    let list = a.a_relancer === true ? rows.filter((x) => x.relance) : a.jamais_contactes === true ? rows.filter((x) => !x.lastAt && !x.busy) : rows;
    // À relancer : les plus anciens d'abord ; sinon les plus récents d'abord.
    list = [...list].sort((x, y) => (a.a_relancer === true ? x.lastAt - y.lastAt : y.lastAt - x.lastAt) || String(x.r.brand ?? "").localeCompare(String(y.r.brand ?? "")));
    const start = int(a.depuis, 0, 0, 100000);
    const page = list.slice(start, start + int(a.max, 50, 1, 500));
    return ok([
      `# Contacts · ${all.length} au total${str(a.recherche) ? ` pour « ${str(a.recherche, 60)} »` : ""} · ${toRelance} à relancer (${relanceDays} j) · ${never} jamais contactés`,
      `Affichés : ${page.length ? `${start + 1} à ${start + page.length}` : "aucun"} sur ${list.length}${start + page.length < list.length ? ` (suite avec depuis = ${start + page.length})` : ""}`,
      ...page.map(({ r, t, lastAt, busy }) => {
        const last = t[0];
        return `- ${r.brand}${r.person ? ` · ${r.person}${r.role ? ` (${r.role})` : ""}` : ""} · ${r.email ?? "sans email"}${r.instagram ? ` · ${r.instagram}` : ""}${r.linkedin ? ` · LinkedIn ${r.linkedin}` : ""}${r.tag ? ` · ${r.tag}` : ""} · dernier contact ${lastAt ? new Date(lastAt).toISOString().slice(0, 10) : busy ? "non noté au carnet" : "jamais"}${busy ? ` · ${busy}` : ""}${last ? ` (${last.kind ?? "échange"} par ${last.canal}${last.note ? ` : ${String(last.note).slice(0, 120)}` : ""})` : ""} · ${t.length} échange(s) [contact ${r.id}]`;
      }),
    ].join("\n"));
  },
};

const pipeline: Tool = {
  name: "pipeline",
  title: "Pipeline marques",
  description: "Marques en prospection et leur étape (Repérée, Contact, Discussion, Proposition, Signée…), avec le contact affiché par l'app (fiche contact reliée, sinon le contact de la marque qui a un email) et la note de contact saisie dans la négociation si elle diffère.",
  inputSchema: { type: "object", properties: { etape: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("prospects").select("*").order("sort_order");
    if (str(a.etape)) q = q.ilike("stage", like(str(a.etape)));
    const [{ data, error }, { data: cts }] = await Promise.all([q, sb.from("contacts").select("id, brand, person, email").limit(5000)]);
    if (error) return fail(`Lecture du pipeline impossible : ${error.message}`);
    const rows = (data as Json[] | null) ?? [];
    const contacts = (cts as Json[] | null) ?? [];
    // Même règle que la page Négociations (Prospection.tsx, contactOf).
    const contactOf = (r: Json) =>
      (r.contact_id ? contacts.find((c) => c.id === r.contact_id) : undefined) ??
      contacts.find((c) => String(c.brand ?? "").trim().toLowerCase() === String(r.brand ?? "").trim().toLowerCase() && c.email);
    return ok([`# Pipeline · ${rows.length} marque(s)`, ...rows.map((r) => {
      const c = contactOf(r);
      const shown = c ? `${c.person ? `${c.person} · ` : ""}${c.email ?? "sans email"}${r.contact_id ? "" : " (deviné par la marque, pas relié)"}` : "";
      const note = clean(r.contact);
      const extra = note && (!c || !`${c.person ?? ""} ${c.email ?? ""}`.toLowerCase().includes(note.toLowerCase())) ? ` · noté dans la négo : ${note}` : "";
      return `- ${r.brand} · ${r.stage}${r.creator ? ` · ${titleCase(String(r.creator))}` : ""}${shown ? ` · contact : ${shown}` : ""}${extra}${r.value && r.value !== "—" ? ` · ${r.value}` : ""} · ajoutée le ${String(r.created_at).slice(0, 10)}`;
    })].join("\n"));
  },
};

const collabs: Tool = {
  name: "collabs",
  title: "Collabs",
  description: "Collaborations marque × créateur et leur avancement sur 11 étapes (Signature → Bilan). Filtre par créateur, marque ou statut (active, terminee, archivee).",
  inputSchema: { type: "object", properties: { createur: { type: "string" }, marque: { type: "string" }, statut: { type: "string", enum: ["active", "terminee", "archivee", "toutes"] } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    let q = sb.from("collabs").select("id, brand, creator, title, step, status, cachet, deliverables, updated_at").order("updated_at", { ascending: false }).limit(500);
    const st = str(a.statut) || "active";
    if (str(a.createur)) q = q.ilike("creator", like(str(a.createur)));
    if (str(a.marque)) q = q.ilike("brand", like(str(a.marque)));
    const { data, error } = await q;
    if (error) return fail(`Lecture des collabs impossible : ${error.message}`);
    const stateOf = collabState;
    const rows = ((data as Json[] | null) ?? []).filter((r) => st === "toutes" || stateOf(r) === st).slice(0, 60);
    const since = await stepSince(sb, rows);
    const LABEL = COLLAB_LABEL;
    return ok([`# Collabs (${st}) · ${rows.length}`, ...rows.map((r) => `- ${r.brand} × ${titleCase(String(r.creator ?? ""))}${r.title ? ` · ${r.title}` : ""} · étape ${r.step}/11 « ${COLLAB_STEPS[Number(r.step) - 1] ?? ""} » · ${LABEL[stateOf(r)] ?? stateOf(r)}${r.cachet ? ` · ${r.cachet}` : ""}${r.deliverables ? ` · ${r.deliverables}` : ""} · sur cette étape depuis le ${String(since.get(String(r.id)) ?? "").slice(0, 10) || "?"} [collab ${r.id}]`)].join("\n"));
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
    return ok([`# Planning du ${frDay(from)} au ${frDay(to)}`, lines(((data as Json[] | null) ?? []).map((e) => `- ${frDay(String(e.date))} ${timeOf(e.time) || "(journée)"} · ${e.title}${e.who ? ` · ${titleCase(String(e.who))}` : ""} [${e.type}]${e.description ? `\n  ${String(e.description).slice(0, 200)}` : ""}`), "Rien de prévu.")].join("\n"));
  },
};

const taches: Tool = {
  name: "taches",
  title: "Tâches",
  description: "To-do de l'agence : tâches ouvertes (par défaut) ou faites, avec échéance, priorité et créateurs concernés (une tâche peut en avoir plusieurs).",
  inputSchema: { type: "object", properties: { faites: { type: "boolean" }, createur: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    const who = str(a.createur);
    // Nom exact du roster : pour trouver aussi les tâches PARTAGÉES (todos.creators).
    const found = who ? await rosterName(sb, str(who, 80)) : null;
    const named = found && "name" in found ? found.name : null;
    const query = (cols: string, multi: boolean) => {
      let q = sb.from("todos").select(cols).eq("done", a.faites === true).order("sort_order").limit(60);
      if (who) q = multi && named ? q.or(`creator.ilike.${JSON.stringify(like(who))},creators.cs.{${JSON.stringify(named)}}`) : q.ilike("creator", like(who));
      return q;
    };
    let res = await query("text, descr, due, creator, creators, priority, status, done_at", true);
    // Colonne `creators` absente (SQL pas encore lancé) : ancienne lecture.
    if (res.error && /creators/i.test(res.error.message)) res = await query("text, descr, due, creator, priority, status, done_at", false);
    if (res.error) return fail(`Lecture des tâches impossible : ${res.error.message}`);
    const namesOf = (t: Json) => {
      const list = Array.isArray(t.creators) ? (t.creators as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
      return list.length ? list : t.creator ? [String(t.creator)] : [];
    };
    return ok([`# Tâches ${a.faites === true ? "faites" : "ouvertes"}`, lines(((res.data as unknown as Json[] | null) ?? []).map((t) => {
      const names = namesOf(t);
      return `- ${t.text}${names.length ? ` (${names.map((n) => titleCase(n)).join(", ")})` : ""}${t.due ? ` · échéance ${t.due}` : ""}${t.priority ? ` · ${t.priority}` : ""}${t.descr ? `\n  ${String(t.descr).slice(0, 160)}` : ""}`;
    }), "Aucune.")].join("\n"));
  },
};

const factures: Tool = {
  name: "factures",
  title: "Factures",
  description: "Factures de l'agence (réservé aux fondateurs) : référence, marque, montant TTC, échéance, statut, et totaux par statut. « En retard » = même règle que l'app (statut « En retard », ou « En attente » dont l'échéance est passée). Filtre par statut ou mois (AAAA-MM, échéance).",
  inputSchema: { type: "object", properties: { statut: { type: "string", enum: ["brouillon", "attente", "retard", "payee", "annulee"] }, mois: { type: "string", description: "AAAA-MM (échéance)" } }, additionalProperties: false },
  founder: true,
  run: async (sb, _c, a) => {
    const { data, error } = await sb.from("invoices").select("ref, party, amount, date, status, creator").order("created_at", { ascending: false }).limit(1000);
    if (error) return fail(`Lecture des factures impossible : ${error.message}`);
    const today = isoDay();
    const want = str(a.statut);
    const month = /^\d{4}-\d{2}$/.test(str(a.mois)) ? str(a.mois) : "";
    const rows = ((data as Json[] | null) ?? [])
      .map((r) => ({ r, st: invoiceStatus(r, today) }))
      .filter(({ r, st }) => (!want || st === want) && (!month || dueIso(r.date).startsWith(month)));
    const num = (v: unknown) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "")) || 0;
    const totals: Record<string, { n: number; sum: number }> = {};
    for (const { r, st } of rows) totals[st] = { n: (totals[st]?.n ?? 0) + 1, sum: (totals[st]?.sum ?? 0) + num(r.amount) };
    const shown = rows.slice(0, 150);
    return ok([
      `# Factures · ${rows.length}${rows.length > shown.length ? ` (150 plus récentes affichées)` : ""}`,
      `Totaux TTC : ${Object.entries(totals).map(([k, v]) => `${INVOICE_STATUS[k] ?? k} ${v.sum.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € (${v.n})`).join(" · ") || "Aucun"}`,
      ...shown.map(({ r, st }) => `- ${r.ref} · ${r.party}${r.creator ? ` · ${titleCase(String(r.creator))}` : ""} · ${money(r.amount)} · échéance ${dueText(r.date)} · ${INVOICE_STATUS[st] ?? st}`),
    ].join("\n"));
  },
};

// Méthode TARIF : la méthode, le barème en vigueur (blob `pricingRates`), les chiffres connus
// du créateur et les tarifs déjà facturés. Lecture seule ; le calcul est fait par Claude.
const methodeTarif: Tool = {
  name: "methode_tarif",
  title: "Méthode TARIF",
  description:
    "À appeler dès que l'utilisateur tape « TARIF » ou demande combien facturer une collab d'influence. Renvoie la méthode de tarification de l'agence avec le barème en vigueur, et, si on les donne, les chiffres connus du créateur, ses tarifs déjà facturés et le dernier tarif facturé à la marque. Calcule ensuite exactement selon la méthode. N'écris aucun message pour la marque. Signale en tête chaque donnée manquante (marquée MANQUANT), sans jamais l'estimer ni la tirer de ta mémoire. Chaque montant porte « À VÉRIFIER » : aucun prix n'est transmis à une marque sans la validation de Marc.",
  inputSchema: {
    type: "object",
    properties: {
      createur: { type: "string", description: "Nom du créateur du roster (même partiel)" },
      marque: { type: "string", description: "Marque qui demande le prix" },
    },
    additionalProperties: false,
  },
  founder: true,
  run: async (sb, _c, a) => {
    const st = await appState(sb);
    const rates = (st.pricingRates ?? {}) as Json;
    const grid = readTarifGrid(rates.ttp);
    const changed = Object.keys(gridDiff(grid)).length > 0;
    const out = [
      methodText(grid),
      changed ? "Barème : valeurs réglées par l'agence (page Tarifs)." : "Barème : valeurs de départ, pas encore ajustées par l'agence. Le dire à Marc.",
    ];
    const marque = str(a.marque, 80);
    const n = str(a.createur, 80);
    let name: string | null = null;
    if (n) {
      const found = await rosterName(sb, n);
      if ("error" in found) return fail(found.error);
      const { data, error } = await sb.from("creators").select("*").eq("name", found.name).limit(1);
      if (error) return fail(`Lecture impossible : ${error.message}`);
      const c = (data as CreatorForTarif[] | null)?.[0];
      if (!c) return fail(`Aucun créateur du roster ne correspond à « ${n} ».`);
      name = String(c.name);
      out.push(`\n# Données de ${titleCase(name)}`, creatorTarifText(c, creatorFloor(rates.ttpFloors, c.id, grid)));
      // Le taux qui compte est celui de la fiche (règle de l'app) ; on signale s'il diffère des dernières factures.
      const savedRate = Object.entries((st.creatorCommission ?? {}) as Record<string, number>).find(([k]) => k.trim().toLowerCase() === name!.trim().toLowerCase())?.[1];
      const ficheRate = pctOf((c as unknown as Json).commission);
      if (savedRate != null && ficheRate != null && Number(savedRate) !== ficheRate) {
        out.push(`⚠ Commission : ${ficheRate} % sur la fiche (taux appliqué par l'app), mais ${savedRate} % sur les dernières factures. À faire trancher par Marc avant tout calcul.`);
      }
    }
    if (name || marque) {
      let q = sb.from("invoices").select("id, ref, party, amount, date, status, creator").order("created_at", { ascending: false }).limit(300);
      const ors = [name ? `creator.ilike.${JSON.stringify(exact(name))}` : "", marque ? `party.ilike.${JSON.stringify(exact(marque))}` : ""].filter(Boolean);
      q = q.or(ors.join(","));
      const { data, error } = await q;
      if (error) return fail(`Factures illisibles : ${error.message}`);
      const details = (st.invoiceDetails ?? {}) as Record<string, { items?: InvoiceItemForPast[] } | undefined>;
      const items: Record<string, InvoiceItemForPast[]> = {};
      for (const inv of (data as { id: string }[] | null) ?? []) items[inv.id] = Array.isArray(details[inv.id]?.items) ? details[inv.id]!.items! : [];
      const num = (v: unknown) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "")) || 0;
      out.push("\n# Tarifs déjà facturés (hors brouillons et annulées)", pastRatesText(pastRates((data as never[]) ?? [], items, name, marque, num), marque));
    }
    return ok(out.join("\n"));
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
      createurs: { type: "array", items: { type: "string" }, maxItems: 20, description: "Plusieurs créateurs concernés (facultatif) : tâche partagée, visible dans l'espace de chacun" },
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
    // `createur` (un seul, comme avant) puis `createurs` (plusieurs), sans doublon.
    const asked = [str(a.createur, 80), ...(Array.isArray(a.createurs) ? a.createurs.slice(0, 20).map((x) => str(x, 80)) : [])].filter(Boolean);
    const names: string[] = [];
    for (const n of asked) {
      const found = await rosterName(sb, n);
      if ("error" in found) return fail(found.error);
      if (!names.some((x) => x.toLowerCase() === found.name.toLowerCase())) names.push(found.name);
    }
    const { data: top } = await sb.from("todos").select("sort_order").order("sort_order", { ascending: true }).limit(1);
    const order = ((top as { sort_order: number }[] | null)?.[0]?.sort_order ?? 0) - 1;
    const row = {
      text: titre, descr: str(a.details, 2000) || null, due: due ?? "—", creator: names[0] ?? null,
      priority: ["haute", "moyenne", "basse"].includes(str(a.priorite)) ? str(a.priorite) : "moyenne",
      source: "agency", status: "À faire", sort_order: order, tag: ctx.name ? `Claude · ${ctx.name}` : "Claude",
    };
    let { error } = await sb.from("todos").insert({ ...row, creators: names });
    // Colonne `creators` absente (SQL pas encore lancé) : seul le premier créateur est enregistré.
    let onlyFirst = false;
    if (error && /creators/i.test(error.message)) {
      ({ error } = await sb.from("todos").insert(row));
      onlyFirst = names.length > 1;
    }
    if (error) return fail(`Tâche non créée : ${error.message}`);
    const pour = names.length ? ` pour ${names.map((n) => titleCase(n)).join(", ")}` : "";
    return ok(`Tâche créée : « ${titre} »${pour}${due ? `, échéance le ${frDay(due)}` : ""}.${onlyFirst ? ` (Seul ${titleCase(names[0])} est enregistré : la base n'a pas encore la mise à jour « plusieurs créateurs ».)` : ""}`);
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
  description: "Prépare un BROUILLON dans Gmail (partnerships@ ou talent@), en nouveau mail ou en réponse dans un fil existant. Rien n'est envoyé : Marc relit et envoie depuis Gmail ou l'app. Un seul brouillon par destinataire et par objet : rappeler l'outil avec le même destinataire et le même objet MET À JOUR le brouillon existant (jamais de doublon).",
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
      const r = await createDraft(sb, box, to, str(a.objet, 300), str(a.message, 20000), /^[A-Za-z0-9]+$/.test(fil) ? fil : undefined);
      const how = r.replaced
        ? `Brouillon MIS À JOUR dans ${box}@ (il remplace celui déjà préparé pour ${to}, aucun doublon${r.removed ? `, ${r.removed} ancien${r.removed > 1 ? "s" : ""} doublon${r.removed > 1 ? "s" : ""} supprimé${r.removed > 1 ? "s" : ""}` : ""})`
        : `Brouillon prêt dans ${box}@ pour ${to}`;
      return ok(`${how} : « ${str(a.objet, 300)} ». À relire et envoyer depuis Gmail ou l'app (Mails, dossier Brouillons).`);
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

// ── Briefs : résumé pour le créateur ────────────────────────────────────────
type BriefRow = { id: string; brand: string; creator: string | null; deliverables: string | null; due: string | null; budget: string | null; objectif: string | null; consignes: string | null; pdf: { name?: string; path?: string } | null; resume?: unknown };
const BRIEF_COLS = "id, brand, creator, deliverables, due, budget, objectif, consignes, pdf";
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const clean = (v: unknown) => (v == null || v === "—" ? "" : String(v).trim());

/** Texte d'un PDF du bucket documents (PDF de la marque joint au brief), borné. */
async function pdfText(sb: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await sb.storage.from("documents").download(path);
  if (error || !data) throw new Error("PDF illisible");
  const { extractText, getDocumentProxy } = await import("npm:unpdf@1.8.1");
  const doc = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()));
  const { text } = await extractText(doc, { mergePages: true });
  return String(Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 40000);
}

/** Brief rangé seulement en PDF dans Documents (pas de fiche dans la page Briefs) : le lire quand même. */
async function briefFromDocuments(sb: SupabaseClient, brand: string, creator: string): Promise<ToolResult> {
  let q = sb.from("documents").select("name, creator, path, created_at").eq("type", "brief").ilike("name", like(brand)).order("created_at", { ascending: false }).limit(5);
  if (creator) q = q.ilike("creator", like(creator));
  const { data, error } = await q;
  const docs = (data as Json[] | null) ?? [];
  if (error || !docs.length) return fail("Aucun brief trouvé (ni dans Briefs, ni en PDF dans Documents).");
  const parts = [`# Brief ${brand} : seulement en PDF dans Documents (pas de fiche dans la page Briefs, donc pas de résumé possible avec resumer_brief)`];
  for (const d of docs.slice(0, 3)) {
    const text = String(d.path ?? "").toLowerCase().endsWith(".pdf") ? await pdfText(sb, String(d.path)).catch(() => "") : "";
    parts.push(`\n## ${d.name}${d.creator ? ` · ${titleCase(String(d.creator))}` : ""} · ajouté le ${String(d.created_at).slice(0, 10)}`, text ? text.slice(0, 12000) : "(PDF illisible ici, par exemple scanné.)");
  }
  if (docs.length > 3) parts.push(`\nAutres PDF : ${docs.slice(3).map((d) => d.name).join(" ; ")}`);
  return ok(parts.join("\n"));
}

const lireBrief: Tool = {
  name: "lire_brief",
  title: "Lire un brief",
  description: "Lit un brief de collab : marque, créateur et sa langue, livrables, échéance, budget, objectif, script du créateur, TEXTE du PDF de la marque s'il est joint, et le résumé déjà fait. Donner l'id du brief, ou la marque (et le créateur si plusieurs briefs). Sert à résumer le brief avec resumer_brief.",
  inputSchema: { type: "object", properties: { brief: { type: "string", description: "Id du brief" }, marque: { type: "string" }, createur: { type: "string" } }, additionalProperties: false },
  run: async (sb, _c, a) => {
    const id = str(a.brief, 40);
    let q = sb.from("briefs").select(BRIEF_COLS).order("created_at", { ascending: false }).limit(5);
    if (id) {
      if (!isUuid(id)) return fail("Id de brief invalide.");
      q = q.eq("id", id);
    } else {
      const m = str(a.marque, 80);
      if (!m) return fail("Donne l'id du brief ou la marque.");
      q = q.ilike("brand", like(m));
      const c = str(a.createur, 80);
      if (c) q = q.ilike("creator", like(c));
    }
    const { data, error } = await q;
    if (error) return fail(`Lecture impossible : ${error.message}`);
    const rows = (data as BriefRow[] | null) ?? [];
    if (!rows.length) return id ? fail("Aucun brief trouvé.") : briefFromDocuments(sb, str(a.marque, 80), str(a.createur, 80));
    if (rows.length > 1 && !id) return ok(["Plusieurs briefs correspondent, redemande avec l'id :", ...rows.map((r) => `- ${r.id} · ${r.brand} × ${titleCase(r.creator)} · échéance ${clean(r.due) || "?"}`)].join("\n"));
    const b = rows[0];
    const [{ data: res }, { data: cr }] = await Promise.all([
      sb.from("briefs").select("resume").eq("id", b.id).maybeSingle(),
      b.creator ? sb.from("creators").select("lang").ilike("name", exact(b.creator)).limit(1) : Promise.resolve({ data: [] }),
    ]);
    const lang = ((cr as Json[] | null) ?? [])[0]?.lang === "en" ? "anglais" : "français";
    let pdf = "";
    if (b.pdf?.path) {
      pdf = await pdfText(sb, b.pdf.path).catch(() => "");
      if (!pdf) pdf = `(PDF « ${b.pdf.name ?? "brief"} » joint mais illisible ici, par exemple un PDF scanné : demande à l'équipe de te le glisser dans la conversation.)`;
    }
    const resume = (res as { resume?: Record<string, string[]> } | null)?.resume;
    return ok([
      `# Brief ${b.brand} × ${titleCase(b.creator) || "créateur à définir"} (id ${b.id})`,
      `Langue du créateur : ${lang}`,
      `Livrables : ${clean(b.deliverables) || "non précisés"}`,
      `Échéance : ${clean(b.due) || "non précisée"}`,
      `Budget : ${clean(b.budget) || "non précisé"}`,
      `Objectif : ${clean(b.objectif) || "non précisé"}`,
      `\n## Script écrit par le créateur\n${clean(b.consignes) || "Pas encore écrit."}`,
      `\n## Brief de la marque (PDF)\n${pdf || "Aucun PDF joint."}`,
      resume ? `\n## Résumé actuel\n${JSON.stringify(resume)}` : "",
    ].filter(Boolean).join("\n"));
  },
};

const listArg = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? "").replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 280))
    .filter(Boolean)
    .slice(0, 10);
const listSchema = (d: string) => ({ type: "array", items: { type: "string" }, description: d });

const resumerBrief: Tool = {
  name: "resumer_brief",
  title: "Déposer le résumé d'un brief",
  description: "Écrit le résumé d'un brief dans TTP Suite, affiché en haut du brief pour le créateur (son espace) et pour l'équipe. 4 listes de phrases courtes, tutoiement, dans la langue du créateur, 6 points au plus chacune, rien d'inventé. Remplace le résumé précédent.",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      brief: { type: "string", description: "Id du brief (lire_brief)" },
      a_faire: listSchema("Ce que la marque attend"),
      a_ne_pas_faire: listSchema("Interdits et erreurs à éviter"),
      livrables_et_dates: listSchema("Formats, nombre, durée, dates de brouillon et de publication"),
      mentions_obligatoires: listSchema("#, @, code promo, lien, mention de partenariat"),
    },
    required: ["brief"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const id = str(a.brief, 40);
    if (!isUuid(id)) return fail("Id de brief invalide.");
    const resume = { faire: listArg(a.a_faire), eviter: listArg(a.a_ne_pas_faire), livrables: listArg(a.livrables_et_dates), mentions: listArg(a.mentions_obligatoires), maj_le: new Date().toISOString(), par: "claude" };
    if (!resume.faire.length && !resume.eviter.length && !resume.livrables.length && !resume.mentions.length) return fail("Résumé vide.");
    const { data, error } = await sb.from("briefs").update({ resume }).eq("id", id).select("brand, creator, resume").maybeSingle<{ brand: string; creator: string | null; resume: { maj_le?: string } | null }>();
    if (error) return fail(/column|resume/i.test(error.message) ? "Le résumé des briefs n'est pas encore installé dans l'app (SQL à lancer)." : `Résumé non déposé : ${error.message}`);
    if (!data) return fail("Brief introuvable.");
    // Relu : un ancien garde-fou de la base annulait l'écriture sans erreur (SQL 2026-10-25-audit).
    if (data.resume?.maj_le !== resume.maj_le) return fail("Résumé non enregistré par la base : SQL 2026-10-25-audit à lancer.");
    return ok(`Résumé déposé sur le brief ${data.brand} × ${titleCase(data.creator)} : le créateur le voit en haut de son brief.`);
  },
};

export const TOOLS: Tool[] = [
  pointDuJour, rechercher, roster, ficheCreateur, verifierExclusivite, rechercherMails, lireMail, preparerReponseMail, dmInstagram, scouting, contacts, pipeline, collabs, contrats, planning, taches, factures, reversements, methodeTarif, aValider, ecarterProposition,
  creerTache, creerEvenement, brouillonMail, ajouterContact, noterEchange, ajouterScouting, statutScouting, avancerCollab,
  mesAgents, lireAgent, proposerAction, noterLecon, memoireCreateur,
  lireBrief, resumerBrief,
  ...ADMIN_TOOLS,
];

/** Liste MCP (les outils fondateurs n'apparaissent pas pour un membre). */
export function toolList(ctx: Ctx) {
  return TOOLS.filter((t) => !t.founder || ctx.founder).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: !!t.destructive, idempotentHint: !t.write, openWorldHint: false },
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
  // Journal : qui, quoi, quand (Paramètres → Assistants IA).
  const summary = JSON.stringify(args ?? {}).slice(0, 300);
  await sb.from("mcp_log").insert({ user_id: ctx.userId, grant_id: ctx.grantId, tool: name, summary, ok: !res.isError }).then(() => {}, () => {});
  return res;
}

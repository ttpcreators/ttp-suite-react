// ============================================================================
// ttp-mcp/admin.ts : « accès complet » de Claude à TTP Suite (fondateurs seulement).
// Demandé par Marc le 2026-10-28 : Claude peut lire, créer, modifier et supprimer
// (vers la Corbeille de l'app, restaurable 30 jours) presque tout, régler l'app,
// préparer les factures, et ENVOYER mails et DM Instagram quand on le lui demande.
// Claude demande l'accord avant chaque écriture (consignes du serveur) ; chaque appel
// est noté dans le journal (Paramètres → Assistants IA) ; une modification renvoie l'avant /
// l'après, pour pouvoir revenir en arrière.
// Jamais : coffre des mots de passe, IBAN, jetons de connexion (_shared/mcpAdmin.ts).
// ============================================================================

import { DEFAULT_MAIL_MODELS } from "../_shared/mailModels.ts";
import { readTarifGrid } from "../_shared/tarif.ts";
import { alerteDealMinimum } from "../_shared/strategie.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { readAppState } from "../_shared/appState.ts";
import { pageAccess, postGraph } from "../_shared/instagram.ts";
import { cleanDm, sendWhy } from "../_shared/igSend.ts";
import {
  INVOICE_STATUSES, TABLES, addressList, blockedSetting, defaultFranchise, euro2, invoiceParty, lockedInvoiceChange, invoiceTotals, mailHtml, nextInvoiceRef, nextQuoteRef, pct, readableRow, writableFields, type InvoiceLine,
} from "../_shared/mcpAdmin.ts";
import { eurRateOf } from "../_shared/reversements.ts";
import { estUuid, plageUuid } from "../_shared/idCourt.ts";
import { listSendAs, parseMailBox, resolveSender, sendDraft, sendMail, type MailBox } from "./gmail.ts";
import { LIEN_TTL_MS, PROJECT_URL, creatorBoxReady, listCreatorBoxes, normEmail } from "../_shared/creatorBox.ts";
import { genNonce, signState } from "../_shared/state.ts";
import type { Ctx } from "./oauth.ts";
import { PROSPECTION_TOOLS, adressesDe, adressesInvalides, suiviApresEnvoi } from "./prospection.ts";
import { verifierBrouillon, verifierKitsDuMail } from "./kitGarde.ts";

type Json = Record<string, unknown>;
type Args = Record<string, unknown>;
type Result = { text: string; isError?: boolean };
export type AdminTool = {
  name: string; title: string; description: string; inputSchema: Json;
  write?: boolean; founder?: boolean; destructive?: boolean;
  run: (sb: SupabaseClient, ctx: Ctx, a: Args) => Promise<Result>;
};

const ok = (text: string): Result => ({ text });
const fail = (text: string): Result => ({ text, isError: true });
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const json = (v: unknown) => JSON.stringify(v, null, 1);
const TABLE_ENUM = Object.keys(TABLES);
const ORDER: Record<string, string | null> = { collab_steps: "reached_at", creator_roadmap: "updated_at", creator_mail_settings: "updated_at", agency_mediakit: "updated_at" };
const like = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const keyOf = (table: string) => TABLES[table]?.key ?? "id";
const todayIso = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function tableOf(a: Args): { table: string } | { error: string } {
  const table = str(a.table, 40);
  return TABLES[table] ? { table } : { error: `Table inconnue « ${table} ». Tables : ${TABLE_ENUM.join(", ")}.` };
}

// ── 1. Lire ─────────────────────────────────────────────────────────────────
const lireDonnees: AdminTool = {
  name: "lire_donnees",
  title: "Lire les données de l'app",
  description:
    "Accès complet en lecture (fondateurs) à toutes les données de TTP Suite : contacts, creators (roster), collabs, collab_steps, briefs, invoices, todos, todo_routines, events (planning), gifting, documents, ideas, prospects (pipeline), creator_pool / athlete_pool (scouting), creator_roadmap, creator_mail_settings, ig_threads (DM), email_sequences, agency_mediakit. Par id, par recherche texte ou par filtres « colonne = valeur ». Renvoie les lignes complètes en JSON avec leur id : à appeler avant modifier_element ou supprimer_element.",
  inputSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: TABLE_ENUM },
      id: { type: "string", description: "Id de la ligne (ou nom du créateur pour creator_roadmap / creator_mail_settings)" },
      recherche: { type: "string", description: "Texte cherché dans les colonnes principales (nom, marque, email…)" },
      filtres: { type: "object", description: "Égalités exactes, ex. { \"status\": \"en_cours\", \"creator\": \"Ana Milanovic\" }" },
      limite: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["table"],
    additionalProperties: false,
  },
  founder: true,
  run: async (sb, _c, a) => {
    const t = tableOf(a);
    if ("error" in t) return fail(t.error);
    const rule = TABLES[t.table];
    let q = sb.from(t.table).select("*");
    if (str(a.id)) {
      const p = keyOf(t.table) === "id" && !estUuid(str(a.id)) ? plageUuid(str(a.id)) : null;
      q = p ? q.gte("id", p.de).lte("id", p.a) : q.eq(keyOf(t.table), str(a.id));
    }
    const s = str(a.recherche, 120);
    if (s && rule.search.length) q = q.or(rule.search.map((c) => `${c}.ilike.${JSON.stringify(like(s))}`).join(","));
    for (const [k, v] of Object.entries(obj(a.filtres) ?? {})) {
      if (!/^[a-z_][a-z0-9_]{0,40}$/.test(k)) return fail(`Filtre invalide : ${k}`);
      q = v === null ? q.is(k, null) : q.eq(k, v as string);
    }
    if (t.table === "events" && !obj(a.filtres)?.deleted) q = q.or("deleted.is.null,deleted.eq.false");
    const order = t.table in ORDER ? ORDER[t.table] : "created_at";
    if (order) q = q.order(order, { ascending: false, nullsFirst: false });
    const { data, error } = await q.limit(Math.min(100, Math.max(1, Number(a.limite) || 20)));
    if (error) return fail(`Lecture impossible : ${error.message}`);
    const rows = ((data as Json[] | null) ?? []).map((r) => readableRow(r));
    return ok(rows.length ? `# ${rule.label} · ${rows.length} ligne${rows.length > 1 ? "s" : ""}\n${json(rows)}` : "Aucune ligne ne correspond.");
  },
};

// ── 2. Créer ────────────────────────────────────────────────────────────────
const creerElement: AdminTool = {
  name: "creer_element",
  title: "Créer un élément",
  description:
    "Crée une ligne dans une table de l'app (fondateurs) : contact, créateur, collab, brief, tâche, rendez-vous, gifting, idée, prospect, scouting… `champs` = colonnes de la table (lis d'abord une ligne existante avec lire_donnees pour connaître les colonnes et leur format). Pour une facture, utilise preparer_facture. Demande l'accord de l'utilisateur avant.",
  inputSchema: {
    type: "object",
    properties: { table: { type: "string", enum: TABLE_ENUM }, champs: { type: "object" } },
    required: ["table", "champs"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const t = tableOf(a);
    if ("error" in t) return fail(t.error);
    const rule = TABLES[t.table];
    if (rule.noCreate) return fail(t.table === "invoices" ? "Pour une facture : preparer_facture." : `Création impossible ici (${rule.label}) : à faire dans l'app.`);
    const { ok: fields, refused } = writableFields(t.table, obj(a.champs) ?? {});
    if (!Object.keys(fields).length) return fail("Aucun champ à enregistrer.");
    if (t.table === "events") fields.sync_source = "agence"; // poussé vers Google Agenda
    // Rangé en dernier, comme dans l'app (si la table a un ordre).
    if (!("sort_order" in fields)) {
      const { data: top, error: e } = await sb.from(t.table).select("sort_order").order("sort_order", { ascending: false, nullsFirst: false }).limit(1);
      if (!e) fields.sort_order = (Number(((top as Json[] | null) ?? [])[0]?.sort_order) || 0) + 1;
    }
    const { data, error } = await sb.from(t.table).insert(fields).select("*").single();
    if (error) return fail(`Création refusée : ${error.message}`);
    return ok(`✓ ${rule.label} créé${refused.length ? ` (champs ignorés : ${refused.join(", ")})` : ""}.\n${json(readableRow(data as Json))}`);
  },
};

// ── 3. Modifier ─────────────────────────────────────────────────────────────
const modifierElement: AdminTool = {
  name: "modifier_element",
  title: "Modifier un élément",
  description:
    "Modifie une ligne de l'app (fondateurs) : n'importe quel champ d'un contact, créateur, collab, brief, tâche, rendez-vous, gifting, prospect, scouting, statut d'une facture… Lis d'abord la ligne (lire_donnees) pour avoir son id et le format des champs. Renvoie l'avant / l'après de chaque champ (pour revenir en arrière si besoin). Demande l'accord de l'utilisateur avant.",
  inputSchema: {
    type: "object",
    properties: { table: { type: "string", enum: TABLE_ENUM }, id: { type: "string" }, champs: { type: "object" } },
    required: ["table", "id", "champs"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const t = tableOf(a);
    if ("error" in t) return fail(t.error);
    const rule = TABLES[t.table];
    const key = keyOf(t.table);
    let id = str(a.id, 200);
    // Le début d'un id (8 caractères, comme dans les boutons d'Alfred) : on retrouve l'id complet.
    if (key === "id" && !estUuid(id) && plageUuid(id)) {
      const p = plageUuid(id)!;
      const { data: trouves } = await sb.from(t.table).select("id").gte("id", p.de).lte("id", p.a).limit(2);
      const l = (trouves as { id: string }[] | null) ?? [];
      if (l.length !== 1) return fail(l.length ? `Plusieurs éléments commencent par ${id} : donne l'id complet.` : `${rule.label} introuvable (${id}).`);
      id = l[0].id;
    }
    const { ok: fields, refused } = writableFields(t.table, obj(a.champs) ?? {});
    if (!Object.keys(fields).length) return fail(`Aucun champ modifiable${refused.length ? ` (refusés : ${refused.join(", ")})` : ""}.`);
    const { data: before, error: e1 } = await sb.from(t.table).select("*").eq(key, id).maybeSingle();
    if (e1) return fail(`Lecture impossible : ${e1.message}`);
    if (!before) return fail(`${rule.label} introuvable (${id}).`);
    const patch = t.table === "events" ? { ...fields, sync_source: "agence" } : fields;
    const { data: after, error } = await sb.from(t.table).update(patch).eq(key, id).select("*").maybeSingle();
    if (error) return fail(`Modification refusée : ${error.message}`);
    const changes = Object.keys(fields).map((k) => `- ${k} : ${JSON.stringify((before as Json)[k] ?? null)} → ${JSON.stringify((after as Json | null)?.[k] ?? null)}`);
    return ok(`✓ ${rule.label} modifié${refused.length ? ` (champs refusés : ${refused.join(", ")})` : ""}.\n${changes.join("\n")}`);
  },
};

// ── 4. Supprimer (Corbeille) ────────────────────────────────────────────────
const supprimerElement: AdminTool = {
  name: "supprimer_element",
  title: "Supprimer (vers la Corbeille)",
  description:
    "Supprime une ligne de l'app (fondateurs) en la mettant dans la Corbeille de TTP Suite (restaurable 30 jours depuis l'app). Un rendez-vous est aussi retiré de Google Agenda. Toujours demander l'accord de l'utilisateur avant, en nommant l'élément.",
  inputSchema: {
    type: "object",
    properties: { table: { type: "string", enum: TABLE_ENUM }, id: { type: "string" } },
    required: ["table", "id"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  destructive: true,
  run: async (sb, _c, a) => {
    const t = tableOf(a);
    if ("error" in t) return fail(t.error);
    const rule = TABLES[t.table];
    const id = str(a.id, 200);
    if (!rule.remove) return fail(`Suppression impossible ici (${rule.label}) : à faire dans l'app.`);
    const { data: row, error: e1 } = await sb.from(t.table).select("*").eq("id", id).maybeSingle();
    if (e1) return fail(`Lecture impossible : ${e1.message}`);
    if (!row) return fail(`${rule.label} introuvable (${id}).`);
    const r = row as Json;
    const name = String(r[rule.search[0]] ?? rule.label);
    // Une facture émise ne se supprime pas (numérotation continue) : elle s'annule (règle de l'app).
    if (t.table === "invoices" && r.status !== "brouillon") {
      return fail(`La facture ${r.ref ?? ""} est émise : elle ne se supprime pas, elle s'annule (numérotation continue). Utilise modifier_element avec status = "annulee". Seul un brouillon part à la Corbeille.`);
    }
    if (rule.remove === "tombstone") {
      const { error } = await sb.from(t.table).update({ deleted: true, deleted_at: new Date().toISOString(), sync_source: "agence" }).eq("id", id);
      return error ? fail(`Suppression refusée : ${error.message}`) : ok(`✓ Rendez-vous « ${name} » supprimé (et retiré de Google Agenda).`);
    }
    // Copie complète dans la Corbeille AVANT de supprimer (même règle que l'app : src/lib/trash.ts).
    const entry = { id: `tr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, table: t.table, label: name, sub: rule.search[1] ? String(r[rule.search[1]] ?? "") || undefined : undefined, data: r, deletedAt: new Date().toISOString() };
    const { error: e2 } = await sb.rpc("app_state_list", { p_key: "trashBin", p_upsert: [entry], p_remove: [], p_prepend: true });
    if (e2) return fail(`Corbeille indisponible, rien n'a été supprimé : ${e2.message}`);
    const { error: e3 } = await sb.from(t.table).delete().eq("id", id);
    if (e3) {
      await sb.rpc("app_state_list", { p_key: "trashBin", p_upsert: [], p_remove: [entry.id], p_prepend: false });
      return fail(`Suppression refusée : ${e3.message}`);
    }
    // Brief supprimé : les collabs qui le désignaient ne pointent plus dans le vide (pas de clé étrangère).
    if (t.table === "briefs") await sb.from("collabs").update({ brief_id: null }).eq("brief_id", id);
    return ok(`✓ ${rule.label} « ${name} » mis à la Corbeille (restaurable 30 jours depuis l'app).`);
  },
};

// ── 5. Réglages de l'app (blob agence) ─────────────────────────────────────
const reglagesApp: AdminTool = {
  name: "reglages_app",
  title: "Réglages de l'app",
  description:
    "Lit ou modifie les réglages partagés de TTP Suite (fondateurs) : barème des tarifs (pricingRates), modèles de mails (customTemplates), réglages mails et signature (mailSettings), notifications (notifPrefs), dossiers des DM (dmLabels), émetteur et détails des factures, etc. `action` : « lire » (sans clé : la liste des clés) ou « modifier ». Pour un objet, `valeur` est fusionnée (et `retirer` enlève des sous-clés) ; sinon elle remplace la valeur. Demande l'accord avant de modifier.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["lire", "modifier"] },
      cle: { type: "string" },
      valeur: { description: "Nouvelle valeur (objet fusionné, ou valeur complète)" },
      retirer: { type: "array", items: { type: "string" }, description: "Sous-clés à retirer d'un objet" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  founder: true,
  write: true,
  run: async (sb, _c, a) => {
    const st = await readAppState(sb);
    const key = str(a.cle, 80);
    if (str(a.action) === "lire") {
      if (!key) {
        const keys = Object.keys(st).filter((k) => !blockedSetting(k)).sort();
        return ok(`# Réglages · ${keys.length} clés\n${keys.map((k) => `- ${k} (${Array.isArray(st[k]) ? `liste de ${(st[k] as unknown[]).length}` : typeof st[k]})`).join("\n")}`);
      }
      if (blockedSetting(key)) return fail("Réglage protégé (jamais lu par Claude).");
      // Valeurs fournies d'office par l'app (jamais enregistrées tant qu'on n'y touche pas).
      if (key === "customTemplates") {
        const own = Array.isArray(st.customTemplates) ? (st.customTemplates as { category?: string; title?: string; body?: string }[]) : [];
        const fmt = (t: { category?: string; title?: string; body?: string }) => `## ${t.title ?? "Sans titre"} (${t.category ?? "?"})\n${t.body ?? ""}`;
        return ok([`# Modèles de mails · ${DEFAULT_MAIL_MODELS.length} fournis par l'app + ${own.length} de l'agence`, ...DEFAULT_MAIL_MODELS.map(fmt), own.length ? "\n# Modèles de l'agence" : "", ...own.map(fmt)].filter(Boolean).join("\n\n"));
      }
      if (key === "pricingRates" && st.pricingRates == null) {
        return ok(`# pricingRates\nPas encore réglé dans l'app : le barème utilisé est celui de départ.\n${JSON.stringify({ ttp: readTarifGrid(undefined) }, null, 1)}`);
      }
      const v = JSON.stringify(st[key] ?? null, null, 1);
      return ok(`# ${key}\n${v.length > 12000 ? `${v.slice(0, 12000)}… (coupé, ${v.length} caractères)` : v}`);
    }
    if (!key || blockedSetting(key)) return fail(key ? "Réglage protégé (jamais modifié par Claude)." : "Indique la clé à modifier.");
    if (!("valeur" in a) && !Array.isArray(a.retirer)) return fail("Indique la nouvelle valeur.");
    const cur = st[key];
    const v = a.valeur;
    const remove = Array.isArray(a.retirer) ? a.retirer.map(String) : [];
    const merge = (obj(v) || (v === undefined && remove.length)) && (cur === undefined || obj(cur));
    const { error } = merge
      ? await sb.rpc("app_state_merge", { p_key: key, p_set: obj(v) ?? {}, p_remove: remove })
      : await sb.rpc("app_state_set", { p_key: key, p_value: v ?? null });
    if (error) return fail(`Réglage non enregistré : ${error.message}`);
    return ok(`✓ Réglage « ${key} » ${merge ? "mis à jour" : "remplacé"}. Avant : ${JSON.stringify(cur ?? null).slice(0, 1500)}`);
  },
};

// ── 6. Factures (brouillon / mise à jour, comme la page Facturation) ────────
const preparerFacture: AdminTool = {
  name: "preparer_facture",
  title: "Préparer une facture",
  description:
    "Crée ou met à jour une facture dans Facturation (fondateurs), avec les mêmes règles que l'app : lignes HT, TVA selon le régime réglé dans Compta (franchise par défaut ; avec TVA seulement si `tva` ou `franchise: false` est donné), commission du créateur (fiche roster, sinon dernière facture, sinon 20 %), numéro « AAAA-NNN » automatique, libellé « Marque × Prénom ». Sans `id`/`ref` : nouvelle facture en brouillon. Avec `id` ou `ref` : modifie cette facture (seuls les champs donnés changent ; `lignes` remplace toutes les lignes). Rappelle à l'utilisateur de vérifier puis d'envoyer depuis Facturation (le PDF est fait par l'app). Demande l'accord avant.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" }, ref: { type: "string", description: "Numéro existant, ex. 2026-191" },
      marque: { type: "string" }, createur: { type: "string" },
      statut: { type: "string", enum: ["brouillon", "attente", "retard", "payee", "annulee"] },
      client: { type: "object", properties: { nom: { type: "string" }, email: { type: "string" }, adresse: { type: "string" }, siret: { type: "string" }, tva: { type: "string" }, tpo: { type: "string" } }, additionalProperties: false },
      lignes: { type: "array", items: { type: "object", properties: { libelle: { type: "string" }, quantite: { type: "number" }, prix_ht: { type: "number" } }, required: ["libelle", "prix_ht"], additionalProperties: false } },
      tva: { type: "number" }, franchise: { type: "boolean" }, commission: { type: "number" },
      date_emission: { type: "string", description: "AAAA-MM-JJ" }, echeance: { type: "string", description: "AAAA-MM-JJ" },
      notes: { type: "string" }, collab_id: { type: "string" },
    },
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    // Facture existante ?
    let row: Json | null = null;
    if (str(a.id) || str(a.ref)) {
      const q = sb.from("invoices").select("*");
      const { data } = await (str(a.id) ? q.eq("id", str(a.id)) : q.eq("ref", str(a.ref))).maybeSingle();
      row = (data as Json | null) ?? null;
      if (!row) return fail(`Facture introuvable (${str(a.id) || str(a.ref)}).`);
    }
    if (str(a.statut) && !INVOICE_STATUSES.includes(str(a.statut))) return fail(`Statut inconnu (« ${str(a.statut)} »). Choisis parmi : ${INVOICE_STATUSES.join(", ")}.`);
    if (row && lockedInvoiceChange(row.status, a)) return fail(`La facture ${row.ref} est déjà émise (${row.status}) : ses lignes, sa TVA et sa commission se modifient dans l'app, pas ici. Tu peux encore changer son statut, son échéance ou ses notes.`);
    const st = await readAppState(sb);
    const allDetails = (st.invoiceDetails as Record<string, Json> | undefined) ?? {};
    const prev = row ? allDetails[String(row.id)] ?? {} : {};
    const client = obj(a.client) ?? {};
    const creator = "createur" in a ? str(a.createur, 120) : String(row?.creator ?? "");
    const brand = str(a.marque, 200) || (row ? String(row.party ?? "").split(" × ")[0] : "");
    if (!brand) return fail("Indique la marque (ou la campagne).");
    // Commission : donnée, sinon celle de la facture, sinon fiche roster, dernière facture, 20 %.
    let commission = typeof a.commission === "number" ? a.commission : typeof prev.commissionRate === "number" ? prev.commissionRate : null;
    if (commission == null && creator) {
      const { data: c } = await sb.from("creators").select("commission").ilike("name", creator.replace(/[%_\\]/g, (x) => `\\${x}`)).limit(1);
      const saved = (st.creatorCommission as Record<string, number> | undefined) ?? {};
      commission = pct(((c as Json[] | null) ?? [])[0]?.commission) ?? saved[creator] ?? null;
    }
    commission = commission ?? 20;
    const items: InvoiceLine[] = Array.isArray(a.lignes)
      ? (a.lignes as Json[]).map((l, i) => ({ id: `l${Date.now().toString(36)}${i}`, label: str(l.libelle, 300), qty: Number(l.quantite ?? 1) || 1, unit: Number(l.prix_ht) || 0 }))
      : ((prev.items as InvoiceLine[] | undefined) ?? []);
    if (!items.length) return fail("Ajoute au moins une ligne (libellé et prix HT).");
    const banks = (st.invoiceBankAccounts as { id?: string }[] | undefined) ?? [];
    const detail = {
      // On repart du détail existant : devise, taux de change, facture « au nom du créateur »
      // et type « commission » ne sont pas gérés ici et ne doivent jamais être perdus.
      ...prev,
      clientName: str(client.nom, 200) || String(prev.clientName ?? ""),
      clientEmail: str(client.email, 200) || String(prev.clientEmail ?? ""),
      clientAddress: str(client.adresse, 500) || String(prev.clientAddress ?? ""),
      clientSiret: str(client.siret, 40) || String(prev.clientSiret ?? ""),
      clientVat: str(client.tva, 40) || String(prev.clientVat ?? ""),
      tpoRef: str(client.tpo, 60) || String(prev.tpoRef ?? ""),
      issueDate: str(a.date_emission, 10) || String(prev.issueDate ?? "") || todayIso(),
      dueDate: str(a.echeance, 10) || String(prev.dueDate ?? "") || todayIso(),
      items,
      franchise: defaultFranchise(a.franchise, a.tva, prev.franchise, st.comptaSettings),
      vatRate: typeof a.tva === "number" ? a.tva : typeof prev.vatRate === "number" ? prev.vatRate : 20,
      commissionRate: commission,
      bankId: String(prev.bankId ?? "") || banks[0]?.id || "",
      notes: "notes" in a ? str(a.notes, 2000) : String(prev.notes ?? ""),
    };
    const tot = invoiceTotals(items, detail.franchise, detail.vatRate, commission);
    const summary: Json = {
      // Montant enregistré = TTC en euros (facture en devise : au taux de la facture, comme l'app).
      party: invoiceParty(brand, creator), amount: euro2(tot.ttc * (eurRateOf(detail) ?? 1)), date: detail.dueDate || "—",
      status: str(a.statut) || String(row?.status ?? "brouillon"), creator: creator || null,
      ...(str(a.collab_id) ? { collab_id: str(a.collab_id) } : {}),
    };
    let id = row ? String(row.id) : "";
    let ref = row ? String(row.ref) : "";
    if (row) {
      const { error } = await sb.from("invoices").update(summary).eq("id", id);
      if (error) return fail(`Facture non modifiée : ${error.message}`);
    } else {
      // Numéro recalculé juste avant l'insertion (comme l'app : pas de doublon).
      const { data: refs, error: e } = await sb.from("invoices").select("ref");
      if (e) return fail(`Numérotation impossible : ${e.message}`);
      ref = nextInvoiceRef(((refs as Json[] | null) ?? []).map((x) => String(x.ref)));
      const { data: top } = await sb.from("invoices").select("sort_order").order("sort_order", { ascending: false, nullsFirst: false }).limit(1);
      const { data, error } = await sb.from("invoices").insert({ ...summary, ref, sort_order: (Number(((top as Json[] | null) ?? [])[0]?.sort_order) || 0) + 1 }).select("id").single();
      if (error) return fail(`Facture non créée : ${error.message}`);
      id = String((data as Json).id);
    }
    const { error: e2 } = await sb.rpc("app_state_merge", { p_key: "invoiceDetails", p_set: { [id]: detail }, p_remove: [] });
    if (creator) await sb.rpc("app_state_merge", { p_key: "creatorCommission", p_set: { [creator]: commission }, p_remove: [] });
    const fmt = (n: number) => euro2(n).replace(/ /g, " ");
    return ok([
      `✓ Facture ${ref} ${row ? "mise à jour" : "créée"} (${summary.status}) : ${summary.party}`,
      ...items.map((l) => `- ${l.label} : ${l.qty} × ${fmt(l.unit)}`),
      `HT ${fmt(tot.ht)} · TVA ${detail.franchise ? "franchise" : `${detail.vatRate} %`} ${fmt(tot.tva)} · TTC ${fmt(tot.ttc)}`,
      `Commission ${commission} % : ${fmt(tot.commission)} · reversé au créateur ${fmt(tot.reversal)} · échéance ${detail.dueDate}`,
      e2 ? `⚠️ Détails non enregistrés (${e2.message}) : ouvre la facture dans Facturation et enregistre-la.` : "À vérifier puis envoyer depuis Facturation (le PDF est fait par l'app).",
    ].join("\n"));
  },
};

// ── 6 bis. Devis (onglet Devis de Facturation) ──────────────────────────────
// Un devis n'est pas une facture : il vit dans le blob agence (clé `quotes`, écrite entrée
// par entrée avec app_state_list, comme l'app), ne compte ni dans le CA ni dans les relances,
// et devient une facture dans l'app une fois accepté. Toujours créé en brouillon.
const QUOTE_VALIDITY_DAYS = 30;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const preparerDevis: AdminTool = {
  name: "preparer_devis",
  title: "Préparer un devis",
  description:
    "Crée ou met à jour un DEVIS en brouillon dans Facturation → Devis (fondateurs), mêmes règles que l'app : lignes HT, TVA selon le régime réglé dans Compta (franchise par défaut ; avec TVA seulement si `tva` ou `franchise: false` est donné), commission du créateur (fiche roster, sinon 20 %), numéro « D-AAAA-NNN » automatique, valable 30 jours. Rien n'est envoyé : Marc vérifie le devis, en fait le PDF et l'envoie depuis l'app. Sans `ref` : nouveau devis. Avec `ref` : modifie ce devis (seuls les champs donnés changent ; `lignes` remplace toutes les lignes). Prix : toujours la méthode de l'agence (methode_tarif) et le flag « À vérifier ». Deal minimum 500 € HT (stratégie de l'agence) : en dessous, l'outil le signale.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Numéro d'un devis existant, ex. D-2026-004" },
      marque: { type: "string" }, createur: { type: "string" },
      client: { type: "object", properties: { nom: { type: "string" }, email: { type: "string" }, adresse: { type: "string" }, siret: { type: "string" }, tva: { type: "string" } }, additionalProperties: false },
      lignes: { type: "array", items: { type: "object", properties: { libelle: { type: "string" }, quantite: { type: "number" }, prix_ht: { type: "number" } }, required: ["libelle", "prix_ht"], additionalProperties: false } },
      tva: { type: "number" }, franchise: { type: "boolean" }, commission: { type: "number" },
      valable_jusqu_au: { type: "string", description: "AAAA-MM-JJ (défaut : dans 30 jours)" },
      notes: { type: "string" }, collab_id: { type: "string" },
    },
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const st = await readAppState(sb);
    const quotes = Array.isArray(st.quotes) ? (st.quotes as Json[]) : [];
    const prev = str(a.ref) ? quotes.find((q) => String(q.ref) === str(a.ref)) : undefined;
    if (str(a.ref) && !prev) return fail(`Devis introuvable (${str(a.ref)}).`);
    if (prev && prev.status !== "brouillon") return fail(`Le devis ${prev.ref} n'est plus en brouillon (${prev.status}) : à modifier dans l'app.`);
    const client = obj(a.client) ?? {};
    const creator = "createur" in a ? str(a.createur, 120) : String(prev?.creator ?? "");
    const brand = str(a.marque, 200) || String(prev?.brand ?? "");
    if (!brand) return fail("Indique la marque.");
    let commission = typeof a.commission === "number" ? a.commission : typeof prev?.commissionRate === "number" ? (prev.commissionRate as number) : null;
    if (commission == null && creator) {
      const { data: c } = await sb.from("creators").select("commission").ilike("name", creator.replace(/[%_\\]/g, (x) => `\\${x}`)).limit(1);
      const saved = (st.creatorCommission as Record<string, number> | undefined) ?? {};
      commission = pct(((c as Json[] | null) ?? [])[0]?.commission) ?? saved[creator] ?? null;
    }
    commission = commission ?? 20;
    const items: InvoiceLine[] = Array.isArray(a.lignes)
      ? (a.lignes as Json[]).map((l, i) => ({ id: `l${Date.now().toString(36)}${i}`, label: str(l.libelle, 300), qty: Number(l.quantite ?? 1) || 1, unit: Number(l.prix_ht) || 0 }))
      : ((prev?.items as InvoiceLine[] | undefined) ?? []);
    if (!items.length) return fail("Ajoute au moins une ligne (libellé et prix HT).");
    const banks = (st.invoiceBankAccounts as { id?: string }[] | undefined) ?? [];
    const issueDate = String(prev?.issueDate ?? "") || todayIso();
    const quote: Json = {
      ...(prev ?? {}), // devise et taux d'un devis existant : jamais perdus
      clientName: str(client.nom, 200) || String(prev?.clientName ?? ""),
      clientEmail: str(client.email, 200) || String(prev?.clientEmail ?? ""),
      clientAddress: str(client.adresse, 500) || String(prev?.clientAddress ?? ""),
      clientSiret: str(client.siret, 40) || String(prev?.clientSiret ?? ""),
      clientVat: str(client.tva, 40) || String(prev?.clientVat ?? ""),
      tpoRef: String(prev?.tpoRef ?? ""),
      issueDate,
      dueDate: str(a.valable_jusqu_au, 10) || String(prev?.dueDate ?? "") || addDays(todayIso(), QUOTE_VALIDITY_DAYS),
      items,
      franchise: defaultFranchise(a.franchise, a.tva, prev?.franchise, st.comptaSettings),
      vatRate: typeof a.tva === "number" ? a.tva : typeof prev?.vatRate === "number" ? prev.vatRate : 20,
      commissionRate: commission,
      bankId: String(prev?.bankId ?? "") || banks[0]?.id || "",
      notes: "notes" in a ? str(a.notes, 2000) : String(prev?.notes ?? ""),
      id: prev ? String(prev.id) : `q${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      // Numéro recalculé sur la liste relue à l'instant (comme l'app : pas de doublon).
      ref: prev ? String(prev.ref) : nextQuoteRef(quotes.map((q) => String(q.ref))),
      brand,
      creator,
      status: "brouillon",
      createdAt: String(prev?.createdAt ?? "") || todayIso(),
      ...(str(a.collab_id) ? { collabId: str(a.collab_id) } : prev?.collabId ? { collabId: prev.collabId } : {}),
    };
    const { error } = await sb.rpc("app_state_list", { p_key: "quotes", p_upsert: [quote], p_remove: [], p_prepend: true });
    if (error) return fail(`Devis non enregistré : ${error.message}`);
    const tot = invoiceTotals(items, quote.franchise as boolean, quote.vatRate as number, commission);
    const fmt = (n: number) => euro2(n).replace(/\u202f/g, " ");
    return ok([
      `✓ Devis ${quote.ref} ${prev ? "mis à jour" : "créé"} (brouillon) : ${invoiceParty(brand, creator)}`,
      ...items.map((l) => `- ${l.label} : ${l.qty} × ${fmt(l.unit)}`),
      `HT ${fmt(tot.ht)} · TVA ${quote.franchise ? "franchise" : `${quote.vatRate} %`} ${fmt(tot.tva)} · TTC ${fmt(tot.ttc)} · valable jusqu'au ${quote.dueDate}`,
      ...[alerteDealMinimum(tot.ht)].filter((x): x is string => !!x),
      "À vérifier dans Facturation → Devis, puis à envoyer depuis l'app (le PDF est fait par l'app).",
    ].join("\n"));
  },
};

// ── 7. Envoyer un mail ──────────────────────────────────────────────────────
const envoyerMail: AdminTool = {
  name: "envoyer_mail",
  title: "Envoyer un mail",
  description:
    "ENVOIE un mail depuis une boîte de l'agence (partnerships@ ou talent@) ou la boîte connectée d'un créateur (boites_createurs : sa signature Gmail), signature des Réglages Mails ajoutée. Avec `envoyer_en_tant_que` (alias d'une créatrice), le mail part DE cet alias, avec son nom affiché et la signature Gmail de l'alias (pas celle de l'agence). `fil` (id d'un fil, via rechercher_mails) : réponse dans ce fil. Toujours montrer le texte final, les destinataires (À, Cc, Cci), la boîte ET l'adresse d'envoi (« De »), et attendre un « oui » explicite de l'utilisateur avant d'appeler cet outil. Pour préparer sans envoyer : creer_brouillon_mail.",
  inputSchema: {
    type: "object",
    properties: {
      boite: { type: "string", description: "partnerships, talent, ou l'adresse d'une boîte de créateur connectée (voir boites_createurs)" },
      a: { type: "string", description: "Destinataire(s), séparés par des virgules" },
      cc: { type: "string" }, cci: { type: "string" },
      objet: { type: "string", description: "Facultatif pour une réponse dans un fil" },
      message: { type: "string", description: "Texte du mail (sans signature)" },
      fil: { type: "string", description: "Id du fil Gmail pour répondre dedans" },
      signature: { type: "boolean", description: "false pour ne pas ajouter la signature (par défaut : ajoutée)" },
      envoyer_en_tant_que: { type: "string", description: "Facultatif : alias mail d'une créatrice (ex. anamilanovic@ttpcreators.pro, via alias_createurs ou fiche_createur) pour envoyer EN SON NOM. Accepté seulement s'il est réglé dans « Envoyer en tant que » de la boîte dans Gmail ; les réponses de la marque reviennent sur l'alias." },
      demarrer_sequence: { type: "boolean", description: "true : premier mail de prospection, la séquence du contact commence (J0). Sinon, la séquence avance toute seule si sa prochaine étape est un mail." },
      createur: { type: "string", description: "Le créateur proposé dans ce mail de prospection (son media kit est comparé aux chiffres réels ; un kit faux bloque l'envoi). Sert aussi à demarrer_sequence." },
    },
    required: ["boite", "a", "message"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const pb = await parseMailBox(sb, a.boite);
    if ("error" in pb) return fail(pb.error);
    const box: MailBox = pb.box;
    const to = addressList(a.a);
    const cc = addressList(a.cc ?? "");
    const bcc = addressList(a.cci ?? "");
    if (!to?.length) return fail("Destinataire invalide.");
    if (!cc || !bcc) return fail("Adresse en copie invalide.");
    const text = str(a.message, 20000);
    if (!text) return fail("Message vide.");
    if (!str(a.objet) && !str(a.fil)) return fail("Indique l'objet du mail.");
    const alias = str(a.envoyer_en_tant_que, 200);
    // Domaine du destinataire vérifié (MX) : une adresse impossible ne part pas, la fiche est marquée.
    const invalide = await adressesInvalides(sb, to);
    if (invalide) return fail(invalide);
    // Media kit faux : un mail de prospection ne part pas (kitGarde.ts).
    const kit = await verifierKitsDuMail(sb, { createur: str(a.createur, 80), alias, a: to, copies: [...cc, ...bcc], objet: str(a.objet, 300), texte: text, reponse: !!str(a.fil), pieces: [] });
    if (kit.refus) return fail(kit.refus.replace("Rien n'est préparé ni envoyé", "Rien n'est envoyé"));
    try {
      // Alias : vérifié dans les « Envoyer en tant que » de la boîte AVANT tout envoi.
      const from = alias ? await resolveSender(sb, box, alias) : undefined;
      let sig = "";
      if (a.signature !== false) {
        if (from) sig = from.signature; // comme Gmail : la signature de l'alias choisi
        // Boîte d'un créateur : SA signature Gmail, jamais celle de l'agence.
        else if (box.includes("@")) sig = (await listSendAs(sb, box).catch(() => [])).find((x) => x.primary)?.signature ?? "";
        else {
          const ms = ((await readAppState(sb)).mailSettings as Json | undefined) ?? {};
          sig = ms.signatureOn !== false ? String(ms.signatureHtml ?? "") : "";
        }
      }
      const r = await sendMail(sb, box, { to, cc, bcc, subject: str(a.objet, 300), html: mailHtml(text, sig), threadId: str(a.fil, 64) || undefined, from });
      const suivi = await suiviApresEnvoi(sb, to, { demarrer: a.demarrer_sequence === true, createur: str(a.createur, 80) || undefined }).catch(() => "");
      return ok(`✓ Mail envoyé ${from ? `de ${from.email}${from.name ? ` (${from.name})` : ""} via ${box}` : `depuis ${box.includes("@") ? box : `${box}@`}`} à ${to.join(", ")}${cc.length ? ` (cc ${cc.join(", ")})` : ""} · objet « ${r.subject} ».` + suivi + kit.note);
    } catch (e) {
      const m = (e as Error).message ?? "";
      if (m.startsWith("alias_refuse: ")) return fail(m.slice(14));
      return fail(/not_connected|invalid_grant/.test(m) ? "La boîte n'est pas connectée à l'app (Planning → Google Agenda → Connecter)." : /403|insufficient/i.test(m) ? "Gmail refuse l'envoi : le droit d'envoi manque pour cette boîte." : `Envoi impossible : ${m}`);
    }
  },
};

// ── 7 bis. Envoyer un brouillon préparé par Claude ─────────────────────────
// Pour Alfred (talent manager) : Marc lit le brouillon, répond « oui » pour CE brouillon, et
// il part tel quel (pas de mail retapé, pas de brouillon oublié qui ferait doublon).
const envoyerBrouillon: AdminTool = {
  name: "envoyer_brouillon",
  title: "Envoyer un brouillon",
  description:
    "ENVOIE un brouillon Gmail préparé par Claude (creer_brouillon_mail donne son id), exactement tel qu'il est dans Gmail, puis il quitte les brouillons. Un brouillon écrit à la main est refusé. Il part de l'adresse choisie à sa création ; `envoyer_en_tant_que` (facultatif) vérifie qu'il part bien de cet alias, sinon rien n'est envoyé. N'appeler qu'après un « oui » explicite de l'utilisateur pour CE brouillon précis (destinataire, objet et adresse d'envoi montrés avant).",
  inputSchema: {
    type: "object",
    properties: {
      boite: { type: "string", description: "partnerships, talent, ou l'adresse d'une boîte de créateur connectée (voir boites_createurs)" },
      brouillon: { type: "string", description: "Id du brouillon Gmail (donné par creer_brouillon_mail)" },
      envoyer_en_tant_que: { type: "string", description: "Facultatif : alias mail d'une créatrice (ex. anamilanovic@ttpcreators.pro, via alias_createurs ou fiche_createur) pour envoyer EN SON NOM. Accepté seulement s'il est réglé dans « Envoyer en tant que » de la boîte dans Gmail ; les réponses de la marque reviennent sur l'alias." },
      demarrer_sequence: { type: "boolean", description: "true : premier mail de prospection, la séquence du contact commence (J0). Sinon, la séquence avance toute seule si sa prochaine étape est un mail." },
      createur: { type: "string", description: "Le créateur proposé (son media kit est revérifié avant l'envoi). Sert aussi à demarrer_sequence." },
    },
    required: ["boite", "brouillon"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const pb = await parseMailBox(sb, a.boite);
    if ("error" in pb) return fail(pb.error);
    const box: MailBox = pb.box;
    const id = str(a.brouillon, 64);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return fail("Id de brouillon invalide.");
    const alias = str(a.envoyer_en_tant_que, 200);
    try {
      if (alias) await resolveSender(sb, box, alias);
      const r = await sendDraft(sb, box, id, alias || undefined, verifierBrouillon(sb, str(a.createur, 80) || undefined));
      const suivi = await suiviApresEnvoi(sb, adressesDe(r.to), { demarrer: a.demarrer_sequence === true, createur: str(a.createur, 80) || undefined }).catch(() => "");
      return ok(`✓ Brouillon envoyé de ${r.from || `${box}@`} à ${r.to} · objet « ${r.subject} ».${suivi}`);
    } catch (e) {
      const m = (e as Error).message ?? "";
      if (m.startsWith("alias_refuse: ")) return fail(m.slice(14));
      if (m.startsWith("kit_refuse: ")) return fail(m.slice(12));
      if (m.startsWith("from_mismatch: ")) return fail(`Ce brouillon part de ${m.slice(15)}, pas de ${alias} : rien n'est envoyé. Refais le brouillon avec envoyer_en_tant_que.`);
      if (m === "not_claude") return fail("Ce brouillon n'a pas été préparé par Claude : à envoyer depuis Gmail ou l'app.");
      if (/gmail_404/.test(m)) return fail("Brouillon introuvable : déjà envoyé ou supprimé.");
      return fail(/not_connected|invalid_grant/.test(m) ? "La boîte n'est pas connectée à l'app (Planning → Google Agenda → Connecter)." : /403|insufficient/i.test(m) ? "Gmail refuse l'envoi : le droit d'envoi manque pour cette boîte." : `Envoi impossible : ${m}`);
    }
  },
};

// ── 7 bis. Envoi par lots (liste de Gianni, point 3) ─────────────────────────
// Marc relit les brouillons préparés et répond « oui » pour une liste précise : elle part
// en une fois, avec un compte rendu par brouillon. Même règle que envoyer_brouillon.
const envoyerBrouillonsValides: AdminTool = {
  name: "envoyer_brouillons_valides",
  title: "Envoyer des brouillons validés",
  description:
    "ENVOIE en une fois une liste de brouillons Gmail préparés par Claude (ids de creer_brouillon_mail), chacun exactement tel qu'il est dans Gmail. À n'appeler qu'après le « oui » explicite de Marc pour CETTE liste d'ids (jamais « tout », jamais un id qu'il n'a pas vu). Un brouillon écrit à la main, introuvable ou refusé est sauté, les autres partent. La séquence de chaque destinataire avance (ou commence avec demarrer_sequence). Compte rendu brouillon par brouillon. 25 au plus.",
  inputSchema: {
    type: "object",
    properties: {
      boite: { type: "string", description: "partnerships, talent, ou l'adresse d'une boîte de créateur connectée" },
      brouillons: { type: "array", items: { type: "string" }, description: "Ids des brouillons validés par Marc" },
      envoyer_en_tant_que: { type: "string", description: "Facultatif : alias d'une créatrice, commun à toute la liste (vérifié dans « Envoyer en tant que »)" },
      demarrer_sequence: { type: "boolean", description: "true : premiers mails de prospection, chaque séquence commence (J0)" },
    },
    required: ["boite", "brouillons"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const pb = await parseMailBox(sb, a.boite);
    if ("error" in pb) return fail(pb.error);
    const box: MailBox = pb.box;
    const ids = [...new Set((Array.isArray(a.brouillons) ? a.brouillons : []).map((x) => str(x, 64)).filter((x) => /^[A-Za-z0-9_-]+$/.test(x)))];
    if (!ids.length) return fail("Aucun id de brouillon valable.");
    if (ids.length > 25) return fail("25 brouillons au plus par envoi : coupe la liste en deux.");
    const alias = str(a.envoyer_en_tant_que, 200);
    if (alias) {
      try {
        await resolveSender(sb, box, alias);
      } catch (e) {
        const m = (e as Error).message ?? "";
        return fail(m.startsWith("alias_refuse: ") ? m.slice(14) : `Alias impossible à vérifier : ${m.slice(0, 120)}`);
      }
    }
    const lignes: string[] = [];
    let partis = 0;
    for (const id of ids) {
      try {
        const r = await sendDraft(sb, box, id, alias || undefined, verifierBrouillon(sb));
        partis++;
        const suivi = await suiviApresEnvoi(sb, adressesDe(r.to), { demarrer: a.demarrer_sequence === true }).catch(() => "");
        lignes.push(`✓ ${id} → ${r.to} · « ${r.subject} »${suivi.replace(/^\nSuivi : /, " · ")}`);
      } catch (e) {
        const m = (e as Error).message ?? "";
        const why = m.startsWith("kit_refuse: ") ? m.slice(12).replace(/^Rien n'est envoyé : /, "").replace(/\n/g, " ") : m === "not_claude" ? "pas préparé par Claude" : /gmail_404/.test(m) ? "introuvable (déjà envoyé ou supprimé)" : m.startsWith("from_mismatch: ") ? `part de ${m.slice(15)}, pas de ${alias}` : /not_connected|invalid_grant/.test(m) ? "boîte non connectée" : m.slice(0, 120);
        lignes.push(`✗ ${id} : ${why}, rien n'est parti`);
      }
    }
    return ok([`${partis} envoyé(s) sur ${ids.length} depuis ${box.includes("@") ? box : `${box}@`}${alias ? ` en tant que ${alias}` : ""} :`, ...lignes].join("\n"));
  },
};

// ── 7 ter. Les boîtes Gmail des créateurs (demande de Marc, 16 novembre 2026) ──
const lienBoiteCreateur: AdminTool = {
  name: "lien_boite_createur",
  title: "Lien pour connecter la boîte d'un créateur",
  description:
    "Donne le lien (valable 7 jours) qui permet de relier la boîte Gmail d'un créateur à TTP Suite : la personne qui l'ouvre se connecte elle même à Google et accepte (Google affiche « application non validée » : Paramètres avancés, puis Accéder à TTP Creators). Ensuite, creer_brouillon_mail, envoyer_brouillon, rechercher_mails et lire_mail acceptent son adresse comme boîte. Ne jamais demander ni taper le mot de passe du créateur.",
  inputSchema: {
    type: "object",
    properties: {
      createur: { type: "string", description: "Nom du créateur, tel qu'au roster" },
      email: { type: "string", description: "Adresse Gmail de sa boîte pro" },
    },
    required: ["createur", "email"],
    additionalProperties: false,
  },
  founder: true,
  run: async (sb, _c, a) => {
    if (!creatorBoxReady()) return fail("La connexion des boîtes n'est pas réglée : secrets YT_CLIENT_ID et YT_CLIENT_SECRET manquants.");
    const email = normEmail(a.email);
    if (!email) return fail("Adresse invalide.");
    const nom = str(a.createur, 80);
    const { data } = await sb.from("creators").select("name").ilike("name", nom.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(1);
    const creator = String(data?.[0]?.name ?? "");
    if (!creator) return fail(`« ${nom} » n'est pas au roster (nom exact de sa fiche).`);
    const t = await signState({ origin: "lien-boite", nonce: genNonce(), sub: `${email}|${creator}` });
    const jours = Math.round(LIEN_TTL_MS / 86_400_000);
    return ok(`Lien pour relier ${email} (${creator}), valable ${jours} jours :\n${PROJECT_URL}/functions/v1/creator-box-callback?t=${encodeURIComponent(t)}\nLa personne qui l'ouvre se connecte à Google avec ${email}, passe l'écran « application non validée » (Paramètres avancés, puis Accéder à TTP Creators) et coche les deux autorisations Gmail.`);
  },
};

const boitesCreateurs: AdminTool = {
  name: "boites_createurs",
  title: "Boîtes Gmail des créateurs",
  description: "Liste les boîtes Gmail de créateurs reliées à TTP Suite : adresse, créateur, connectée ou non, depuis quand. Une boîte connectée s'utilise comme « boite » dans creer_brouillon_mail, envoyer_brouillon, envoyer_mail, rechercher_mails, lire_mail, brouillons_claude et supprimer_brouillon.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  founder: true,
  run: async (sb) => {
    const rows = await listCreatorBoxes(sb);
    if (!rows.length) return ok("Aucune boîte de créateur reliée. Pour en relier une : lien_boite_createur.");
    return ok(["# Boîtes des créateurs", ...rows.map((r) => `- ${r.email} · ${r.creator} · ${r.connected ? `connectée depuis le ${String(r.connected_at ?? "").slice(0, 10)}` : `DÉCONNECTÉE${r.last_error ? ` (${r.last_error})` : ""} : refaire le lien`}`)].join("\n"));
  },
};

// ── 8. Envoyer un DM Instagram ─────────────────────────────────────────────
const envoyerDm: AdminTool = {
  name: "envoyer_dm",
  title: "Envoyer un DM Instagram",
  description:
    "ENVOIE un DM depuis le compte Instagram de TTP, dans une conversation existante (id ou @ du compte, via dm_instagram). Règle de Meta : seulement dans les 24 h qui suivent le dernier message de la personne. Toujours montrer le texte final et attendre un « oui » explicite avant d'appeler cet outil.",
  inputSchema: {
    type: "object",
    properties: { conversation: { type: "string", description: "Id de la conversation ou @ du compte" }, message: { type: "string" } },
    required: ["conversation", "message"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const text = cleanDm(a.message);
    if (!text) return fail("Message vide ou trop long (1 000 caractères max).");
    const who = str(a.conversation, 120).replace(/^@/, "");
    const q = sb.from("ig_threads").select("id, igsid, username");
    const { data } = await (/^[a-z0-9._]{1,30}$/i.test(who) && !/^\d{10,}$/.test(who) && who.length < 31 ? q.ilike("username", who.replace(/[%_\\]/g, (x) => `\\${x}`)) : q.eq("id", who)).limit(2);
    // « _ » était lu comme « n'importe quel caractère » : marie_dupont pouvait tomber sur marie.dupont.
    if (((data as Json[] | null) ?? []).length > 1) return fail("Plusieurs conversations portent ce nom : donne l'id de la conversation (outil dm_instagram).");
    const th = ((data as Json[] | null) ?? [])[0];
    if (!th?.igsid) return fail("Conversation introuvable ou pas encore synchronisée (page DM Instagram → Actualiser).");
    const page = await pageAccess();
    if (!page.ok) return fail(`Instagram indisponible : ${page.why}`);
    const r = await postGraph(`${page.pageId}/messages`, { recipient: JSON.stringify({ id: th.igsid }), message: JSON.stringify({ text }) }, page.token);
    if (r.error) {
      const why = sendWhy(r.error as { code?: number; error_subcode?: number; message?: string });
      return fail(why === "hors_fenetre" ? "Plus de 24 h depuis son dernier message : Instagram oblige à répondre depuis l'app Instagram." : `DM non envoyé (${why}).`);
    }
    const at = new Date().toISOString();
    await sb.from("ig_messages").upsert({ id: `sent:${String(r.message_id ?? crypto.randomUUID())}`, thread_id: th.id, at, me: true, text });
    await sb.from("ig_threads").update({ updated_at: at, last_text: text.slice(0, 300), last_from_me: true }).eq("id", th.id);
    return ok(`✓ DM envoyé à @${th.username ?? who}.`);
  },
};

export const ADMIN_TOOLS: AdminTool[] = [lireDonnees, creerElement, modifierElement, supprimerElement, reglagesApp, preparerFacture, preparerDevis, envoyerMail, envoyerBrouillon, envoyerBrouillonsValides, ...PROSPECTION_TOOLS, lienBoiteCreateur, boitesCreateurs, envoyerDm];

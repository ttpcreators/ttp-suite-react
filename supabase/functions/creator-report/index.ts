// ============================================================================
// creator-report/index.ts
// ----------------------------------------------------------------------------
// Données du RAPPORT MENSUEL d'un créateur (gains, collabs, chiffres, gifting),
// filtrées côté serveur sur UN créateur. Le calcul se fait dans l'app
// (src/lib/monthlyReport.ts) ; ici on ne fait que rassembler.
// Le blob agence est agence-only (RLS) : on n'en sort que les détails des
// factures de CE créateur, SES versements et SES mesures d'engagement.
//
// Version 2 (2026-11-23) : factures avec leur date de paiement `paid_at` (« Ce qu'on te
// doit », page Gains), écho `version: 2`. Contrat inchangé sinon.
//
// AUTH (config.toml -> verify_jwt = true) : JWT requis.
//   créateur → toujours lui-même (le nom envoyé est ignoré) ;
//   agence   → le créateur demandé dans { creator } ; l'argent (factures,
//              détails, versements) seulement pour les fondateurs, comme en base
//              (invoices_agency exige is_founder()).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { readAppState } from "../_shared/appState.ts";
import { cashModeFor } from "../_shared/reversements.ts";

type Json = Record<string, unknown>;
const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
// Motif ilike exact (insensible à la casse) : on neutralise % _ et \.
const exact = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return jsonRes({ error: "unauthorized" }, 401);

  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return jsonRes({ error: "unauthorized" }, 401);
  // FAIL-CLOSED : profil illisible ou absent → refus.
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role,creator_name,agency_role").eq("user_id", data.user.id)
    .maybeSingle<{ role: string; creator_name: string | null; agency_role: string | null }>();
  if (profErr || !prof) return jsonRes({ error: "forbidden" }, 403);

  const body = (await req.json().catch(() => ({}))) as Json;
  let name = "";
  if (prof.role === "creator") name = (prof.creator_name ?? "").trim();
  else if (prof.role === "agency") name = String(body.creator ?? "").trim();
  else return jsonRes({ error: "forbidden" }, 403);
  if (!name) return jsonRes({ error: "creator manquant" }, 400);
  // Le créateur voit SES gains ; côté agence, seuls les fondateurs voient l'argent.
  const money = prof.role === "creator" || prof.agency_role === "founder";
  const pat = exact(name);

  // Date de paiement (`paid_at`, page Gains « Ce qu'on te doit ») : si la colonne manque,
  // on relit sans elle (même réponse qu'avant).
  const readInvoices = async () => {
    const cols = "id,ref,party,amount,date,status,created_at,collab_id";
    const r = await sb.from("invoices").select(`${cols},paid_at`).ilike("creator", pat);
    return r.error ? await sb.from("invoices").select(cols).ilike("creator", pat) : r;
  };
  const [cr, inv, col, gif] = await Promise.all([
    sb.from("creators").select("name,commission,ig,tt,yt").ilike("name", pat).limit(1).maybeSingle(),
    money ? readInvoices() : Promise.resolve({ data: [], error: null }),
    sb.from("collabs").select("id,brand,deliverables,cachet,step,status,created_at").ilike("creator", pat),
    sb.from("gifting").select("brand,product,value,received_on,created_at").ilike("creator", pat),
  ]);
  const failed = [cr, inv, col, gif].find((r) => r.error);
  if (failed) return jsonRes({ error: "lecture impossible" }, 500);

  const collabs = (col.data ?? []) as { id: string }[];
  const steps = collabs.length
    ? await sb.from("collab_steps").select("collab_id,step,reached_at").in("collab_id", collabs.map((c) => c.id)).gte("step", 6)
    : { data: [], error: null };
  if (steps.error) return jsonRes({ error: "lecture impossible" }, 500);

  // Blob agence : ligne commune + ligne argent des fondateurs (_shared/appState.ts).
  let state: Json;
  try {
    state = await readAppState(sb);
  } catch {
    return jsonRes({ error: "lecture impossible" }, 500);
  }
  // Détails des SEULES factures du créateur, réduits aux champs utiles au calcul.
  const invoices = (inv.data ?? []) as { id: string; collab_id?: string | null }[];
  const allDetails = (state.invoiceDetails ?? {}) as Record<string, Json>;
  const details: Record<string, Json> = {};
  for (const i of invoices) {
    const d = allDetails[i.id];
    if (d) details[i.id] = { items: d.items, franchise: d.franchise, vatRate: d.vatRate, commissionRate: d.commissionRate, issueDate: d.issueDate, currency: d.currency, fxRate: d.fxRate, onBehalf: d.onBehalf };
  }
  // Factures sans reversement, même règle que la page Reversements (src/lib/compta.ts
  // noPayoutIds) : facture de commission, ou collab où la marque paie le créateur.
  const modes = (state.collabCashMode ?? {}) as Record<string, string>;
  const noPayout = invoices
    .filter((i) => (allDetails[i.id] as Json | undefined)?.kind === "commission" || cashModeFor(i.collab_id, null, modes, {}) === "createur")
    .map((i) => i.id);
  const payMap = (state.creatorPayouts ?? {}) as Record<string, unknown[]>;
  const payouts = !money ? [] : Object.entries(payMap).filter(([k]) => lc(k) === lc(name)).flatMap(([, v]) => (Array.isArray(v) ? v : []));
  const engagement = (Array.isArray(state.engagementHistory) ? (state.engagementHistory as Json[]) : [])
    .filter((e) => lc(e?.creator) === lc(name))
    .map((e) => ({ date: e.date, platform: e.platform, platformLabel: e.platformLabel, er: e.er }));

  const c = (cr.data ?? null) as Json | null;
  const pick = (x: unknown, keys: string[]) => {
    if (!x || typeof x !== "object") return null;
    const o = x as Json;
    return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  };
  return jsonRes({
    // Écho de version : 2 = factures avec `paid_at` (2026-11-23). Absent avec l'ancienne.
    version: 2,
    money,
    creator: {
      name: (c?.name as string) ?? name,
      commission: c?.commission ?? null,
      ig: pick(c?.ig, ["history", "insights"]),
      tt: pick(c?.tt, ["history"]),
      yt: pick(c?.yt, ["history"]),
    },
    invoices,
    details,
    noPayout,
    payouts,
    collabs,
    steps: steps.data ?? [],
    gifting: gif.data ?? [],
    engagement,
  });
});

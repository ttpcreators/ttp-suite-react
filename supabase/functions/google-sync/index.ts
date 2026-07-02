// ============================================================================
// google-sync/index.ts
// ----------------------------------------------------------------------------
// Cycle de synchronisation BIDIRECTIONNELLE `events` <-> Google Calendar 'primary'.
//
// AUTH (config.toml -> verify_jwt = false ; validation applicative ici) :
//   - Authorization: Bearer <CRON_SECRET>  (appels internes webhook / pg_cron), OU
//   - JWT Supabase valide d'un compte AGENCE (vérifié via getUser + is_agency()).
//   verify_jwt=false est OBLIGATOIRE, sinon les appels CRON_SECRET (non-JWT) sont
//   rejetés par la plateforme avant d'atteindre ce code.
//
// La logique de sync vit dans _shared/google.ts (runSyncCycle) — source unique.
// Sortie : { ok, pulled, pushed, deleted, resynced } ou { ok:true, skipped:'locked' }.
// ============================================================================

import {
  CRON_SECRET,
  corsHeaders,
  getServiceClient,
  runSyncCycle,
  timingSafeEqualStr,
} from "../_shared/google.ts";

/** Vérifie que l'appelant est l'agence (JWT valide + rôle 'agency') OU le cron. */
async function authorize(req: Request): Promise<{ ok: boolean; via?: "cron" | "agency" }> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { ok: false };

  // 1) Appel interne (webhook / pg_cron) — comparaison à temps constant.
  if (timingSafeEqualStr(token, CRON_SECRET)) return { ok: true, via: "cron" };

  // 2) JWT Supabase : on valide le token ET on exige le rôle agence.
  const sb = getServiceClient();
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return { ok: false };
    // is_agency() est SECURITY DEFINER mais lit auth.uid() ; en service-role
    // auth.uid() est null. On vérifie donc le rôle via la table profiles.
    const { data: prof } = await sb
      .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
    if (prof?.role === "creator") return { ok: false };
    return { ok: true, via: "agency" };
  } catch {
    return { ok: false };
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: { trigger?: string; mode?: "incremental" | "full" } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const mode = body.mode === "full" ? "full" : "incremental";

  const sb = getServiceClient();
  try {
    const result = await runSyncCycle(sb, mode);
    if ("skipped" in result) {
      return new Response(JSON.stringify({ ok: true, skipped: result.skipped }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // not_connected / invalid_grant : reconnexion requise -> 409.
    const status = msg === "not_connected" || msg === "invalid_grant" ? 409 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

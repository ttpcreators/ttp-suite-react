// ============================================================================
// google-status/index.ts
// ----------------------------------------------------------------------------
// Renvoie le statut de connexion Google au front, SANS jamais exposer de token.
// Le front lit ce statut au lieu des tables protégées (RLS deny-all).
//
// AUTH (config.toml -> verify_jwt = true) : JWT agence requis.
// Sortie : { connected, email, lastSyncAt, channelExpiration, lastError }.
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";

async function requireAgency(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: prof } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return prof?.role === "agency";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // POST ou GET acceptés (le front invoque en POST pour la fiabilité du transport).
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonRes({ error: "method_not_allowed" }, 405);
  }
  if (!(await requireAgency(req))) return jsonRes({ error: "unauthorized" }, 401);

  const sb = getServiceClient();
  const { data: tok } = await sb
    .from("google_tokens")
    .select("connected, google_email, last_error")
    .eq("id", 1).maybeSingle<{ connected: boolean; google_email: string | null; last_error: string | null }>();
  const { data: st } = await sb
    .from("sync_state")
    .select("last_sync_at, channel_expiration")
    .eq("id", 1).maybeSingle<{ last_sync_at: string | null; channel_expiration: string | null }>();

  return jsonRes({
    connected: tok?.connected === true,
    email: tok?.google_email ?? null,
    lastSyncAt: st?.last_sync_at ?? null,
    channelExpiration: st?.channel_expiration ?? null,
    lastError: tok?.last_error ?? null,
  }, 200);
});

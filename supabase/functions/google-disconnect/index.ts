// ============================================================================
// google-disconnect/index.ts
// ----------------------------------------------------------------------------
// Déconnecte proprement le compte Google :
//   1. Stop du channel watch (best effort).
//   2. Révocation du refresh_token chez Google (best effort).
//   3. google_tokens -> connected=false, access_token=null, refresh_token=null.
//   4. Reset de sync_state (channel_*, sync_token).
// On CONSERVE les google_event_id sur `events` (reconnexion propre ultérieure).
//
// AUTH (config.toml -> verify_jwt = true) : JWT agence requis.
// Sortie : { ok:true }.
// ============================================================================

import { corsHeaders, gcalStopChannel, getServiceClient, getSyncState } from "../_shared/google.ts";

async function requireAgency(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: prof } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return prof?.role !== "creator";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!(await requireAgency(req))) return jsonRes({ error: "unauthorized" }, 401);

  const sb = getServiceClient();

  // 1. Stop channel (best effort) — nécessite l'access token, donc avant révocation.
  try {
    const st = await getSyncState(sb);
    if (st?.channel_id && st?.channel_resource_id) {
      await gcalStopChannel(sb, st.channel_id, st.channel_resource_id);
    }
  } catch (e) {
    console.warn("google-disconnect: stop channel échoué", e);
  }

  // 2. Révocation du refresh_token (best effort).
  try {
    const { data: tok } = await sb
      .from("google_tokens").select("refresh_token").eq("id", 1)
      .maybeSingle<{ refresh_token: string | null }>();
    if (tok?.refresh_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.refresh_token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    }
  } catch (e) {
    console.warn("google-disconnect: revoke échoué", e);
  }

  // 3. Efface les credentials.
  await sb.from("google_tokens").update({
    connected: false, access_token: null, refresh_token: null,
    expires_at: null, last_error: null,
  }).eq("id", 1);

  // 4. Reset du curseur + watch.
  await sb.from("sync_state").update({
    sync_token: null, channel_id: null, channel_resource_id: null,
    channel_token: null, channel_expiration: null,
    syncing: false, syncing_at: null,
  }).eq("id", 1);

  return jsonRes({ ok: true }, 200);
});

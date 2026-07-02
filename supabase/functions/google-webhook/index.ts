// ============================================================================
// google-webhook/index.ts
// ----------------------------------------------------------------------------
// Endpoint appelé par Google Calendar (events.watch) à chaque changement.
//
// AUTH (config.toml -> verify_jwt = false) : Google ne porte pas de JWT.
// Authenticité vérifiée via le channel token secret (X-Goog-Channel-Token),
// comparé à temps constant à sync_state.channel_token, + X-Goog-Channel-ID et
// X-Goog-Resource-ID. Mismatch => 200 silencieux SANS sync (anti-forgery).
//
// RÉPONSE : toujours 200 (même erreur interne) pour éviter les retries en boucle
// de Google. Le sync est lancé via waitUntil (survit à la réponse) — pas un
// fetch détaché qui pourrait être tué avec l'isolate.
// ============================================================================

import {
  getServiceClient,
  getSyncState,
  json,
  runSyncCycle,
  timingSafeEqualStr,
  waitUntil,
} from "../_shared/google.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ ok: true, ignored: "method" }, 200);
  }

  try {
    const channelId = req.headers.get("X-Goog-Channel-ID") ?? "";
    const channelToken = req.headers.get("X-Goog-Channel-Token") ?? "";
    const resourceId = req.headers.get("X-Goog-Resource-ID") ?? "";
    const resourceState = (req.headers.get("X-Goog-Resource-State") ?? "").toLowerCase();

    const sb = getServiceClient();
    const state = await getSyncState(sb);

    // Anti-forgery : token + channel_id + resource_id doivent correspondre.
    if (
      !state || !state.channel_token ||
      !timingSafeEqualStr(channelToken, state.channel_token) ||
      channelId !== state.channel_id ||
      resourceId !== state.channel_resource_id
    ) {
      console.warn("google-webhook: rejet (token/identifiants invalides)");
      return json({ ok: true, ignored: "unauthorized" }, 200);
    }

    // Message d'ouverture du channel : rien à faire.
    if (resourceState === "sync") {
      return json({ ok: true, ignored: "sync-open" }, 200);
    }

    // Changement : on lance un cycle de sync inline via waitUntil (fiable),
    // et on répond immédiatement <10 s à Google.
    if (resourceState === "exists" || resourceState === "not_exists") {
      waitUntil(
        runSyncCycle(sb, "incremental").catch((e) =>
          console.error("google-webhook: sync failed", e)
        ),
      );
      return json({ ok: true, triggered: true }, 200);
    }

    return json({ ok: true, ignored: `state:${resourceState}` }, 200);
  } catch (e) {
    console.error("google-webhook: erreur interne", e);
    return json({ ok: true, error: "internal" }, 200);
  }
});

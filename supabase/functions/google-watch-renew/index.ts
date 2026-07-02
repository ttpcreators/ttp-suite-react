// ============================================================================
// google-watch-renew/index.ts
// ----------------------------------------------------------------------------
// Renouvelle le channel watch Google Calendar avant expiration (~7 j).
// Appelée par pg_cron (nightly) via net.http_post.
//
// AUTH (config.toml -> verify_jwt = false) : CRON_SECRET dans Authorization.
//
// COMPORTEMENT :
//   1. Vérifie le CRON_SECRET (temps constant).
//   2. Lit sync_state. Si le channel expire dans > 48 h -> no-op.
//   3. Sinon : crée un NOUVEAU channel (gcalWatch persiste dans sync_state),
//      stoppe l'ancien (best effort), lance un sync de rattrapage inline.
// ============================================================================

import {
  checkCronSecret,
  gcalStopChannel,
  gcalWatch,
  getServiceClient,
  getSyncState,
  json,
  runSyncCycle,
  waitUntil,
} from "../_shared/google.ts";

const RENEW_THRESHOLD_MS = 48 * 60 * 60 * 1000;
const CHANNEL_TTL_SECONDS = 604800;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!checkCronSecret(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const sb = getServiceClient();
    const state = await getSyncState(sb);

    if (!state || !state.channel_id || !state.channel_expiration) {
      return json({ ok: true, skipped: "no_active_channel" }, 200);
    }

    const remainingMs = new Date(state.channel_expiration).getTime() - Date.now();
    if (remainingMs > RENEW_THRESHOLD_MS) {
      return json({
        ok: true, skipped: "not_due",
        channelExpiration: state.channel_expiration,
        remainingHours: Math.round(remainingMs / 3_600_000),
      }, 200);
    }

    const oldChannelId = state.channel_id;
    const oldResourceId = state.channel_resource_id;

    // Nouveau channel (écrase sync_state).
    const fresh = await gcalWatch(sb, CHANNEL_TTL_SECONDS);

    // Stop de l'ancien (best effort).
    let oldStopped = false;
    if (oldChannelId && oldResourceId) {
      oldStopped = await gcalStopChannel(sb, oldChannelId, oldResourceId);
      if (!oldStopped) {
        console.warn(`google-watch-renew: échec stop ancien channel ${oldChannelId} (expirera seul)`);
      }
    }

    // Sync de rattrapage inline (couvre la fenêtre de bascule).
    waitUntil(runSyncCycle(sb, "incremental").catch((e) => console.error("renew sync failed", e)));

    return json({
      ok: true, renewed: true,
      newChannelExpiration: fresh.channel_expiration,
      oldChannelStopped: oldStopped,
    }, 200);
  } catch (e) {
    console.error("google-watch-renew: erreur", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

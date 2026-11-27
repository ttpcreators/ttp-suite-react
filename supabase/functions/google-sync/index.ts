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
// Sortie : { ok, pulled, pushed, deleted, resynced, conflits, absents, refus,
// statutsRefus, verrouPerdu? } ou { ok:true, skipped:'locked' }.
//
// JOURNAL : une ligne par passage, `google-sync {…}` : déclencheur, accès (« secret »
// des crons ou « compte » agence), mode, envoyés, reçus, supprimés, durée, ou l'erreur.
// Le déclencheur est une ÉTIQUETTE choisie par l'appelant, pas une preuve de l'origine :
//   - « cron » : la tâche horaire de la minute 17 (google-sync-hourly), mais aussi le
//     connecteur (ttp-mcp : creer_evenement, cocher_tache, creer_element,
//     modifier_element, supprimer_element) ;
//   - « webhook » : rdv, meet-invite et le connecteur (creer_meet, inviter_rdv). Jamais
//     un avis de Google : ceux-là sont dans le journal de google-webhook ;
//   - « manual » : le bouton « Synchroniser » de l'app ; « app » : la relance
//     automatique de l'app après un enregistrement de rendez-vous (googleCalendar.ts) ;
//   - « renew » n'arrive pas ici : google-watch-renew et google-oauth-callback lancent
//     leur passage elles-mêmes et l'écrivent dans leur propre journal.
// Des étiquettes distinctes (rdv, meet, connecteur) demanderaient de redéployer rdv,
// meet-invite et ttp-mcp : à faire plus tard. Le cron horaire reste indispensable :
// Google n'envoie pas toujours d'avis.
// ============================================================================

import {
  CRON_SECRET,
  corsHeaders,
  getServiceClient,
  runSyncCycle,
  timingSafeEqualStr,
} from "../_shared/google.ts";
import { declencheurSync, ligneErreur, ligneJournal } from "../_shared/synchroAgenda.ts";

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
    const { data: prof, error: profErr } = await sb
      .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
    if (profErr || !prof || prof.role !== "agency") return { ok: false }; // fail-closed
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
  const contexte = {
    declencheur: declencheurSync(body.trigger, auth.via),
    acces: auth.via === "cron" ? "secret" : "compte",
    mode,
  };
  const t0 = Date.now();

  const sb = getServiceClient();
  try {
    const result = await runSyncCycle(sb, mode);
    console.log("google-sync", JSON.stringify(ligneJournal(contexte, result, Date.now() - t0)));
    if ("skipped" in result) {
      return new Response(JSON.stringify({ ok: true, skipped: result.skipped }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("google-sync", JSON.stringify(ligneErreur(contexte, e, Date.now() - t0)));
    const msg = String((e as Error).message ?? e);
    // not_connected / invalid_grant : reconnexion requise -> 409.
    const status = msg === "not_connected" || msg === "invalid_grant" ? 409 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

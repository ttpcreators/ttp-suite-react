// ============================================================================
// creator-box-callback/index.ts : un créateur connecte SA boîte Gmail à TTP Suite.
// ----------------------------------------------------------------------------
// 1. GET ?t=<lien signé, 7 jours> : le lien que Marc envoie au créateur (outil
//    lien_boite_createur du connecteur Claude). On signe un state frais (10 min) et on
//    redirige vers Google, adresse du créateur pré-remplie.
// 2. GET ?code&state : retour de Google. L'adresse connectée doit être celle prévue,
//    avec les deux droits (lire, brouillons). Le jeton va dans creator_mail_boxes.
// Le créateur se connecte lui même : aucun mot de passe ne passe par l'agence.
// AUTH : config.toml -> verify_jwt = false (navigation, pas de JWT), state signé HMAC.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { genNonce, signState, verifyState } from "../_shared/state.ts";
import {
  CALLBACK_URL, LIEN_TTL_MS, creatorBoxClientId, creatorBoxClientSecret, creatorBoxReady,
  droitsComplets, emailDuJeton, normEmail, urlAutorisation,
} from "../_shared/creatorBox.ts";

// Les pages de fin vivent sur app.ttpcreators.pro/boite-reliee/ : Supabase affiche le HTML
// renvoyé par une fonction comme du texte brut (code visible, accents cassés).
const PAGE_FIN = "https://app.ttpcreators.pro/boite-reliee/";
const fin = (params: Record<string, string>) => Response.redirect(`${PAGE_FIN}?${new URLSearchParams(params)}`, 302);
// Un code, pas un texte : la page n'affiche que ses propres messages (personne ne peut lui
// faire dire autre chose en bricolant l'adresse).
type CodeErreur = "lien" | "agence" | "expire" | "refus" | "retour" | "delai" | "google" | "adresse" | "droits" | "enregistrement" | "durable";
const erreur = (code: CodeErreur) => fin({ erreur: code });

/** sub du state : « adresse|créateur ». */
function lireSub(sub: string | undefined): { email: string; creator: string } | null {
  const [e, ...rest] = String(sub ?? "").split("|");
  const email = normEmail(e);
  const creator = rest.join("|").trim();
  return email && creator ? { email, creator } : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return erreur("lien");
  if (!creatorBoxReady()) return erreur("agence");
  const url = new URL(req.url);

  // 1. Le lien envoyé au créateur : on part chez Google.
  const lien = url.searchParams.get("t");
  if (lien) {
    let qui: { email: string; creator: string } | null = null;
    try {
      const p = await verifyState(lien, LIEN_TTL_MS);
      if (p.origin === "lien-boite") qui = lireSub(p.sub);
    } catch (e) {
      return erreur((e as Error).message === "state_expired" ? "expire" : "lien");
    }
    if (!qui) return erreur("lien");
    const state = await signState({ origin: "google-boite", nonce: genNonce(), sub: `${qui.email}|${qui.creator}` });
    return Response.redirect(urlAutorisation(creatorBoxClientId(), state, qui.email), 302);
  }

  // 2. Retour de Google.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return erreur("refus");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return erreur("retour");
  let qui: { email: string; creator: string } | null = null;
  try {
    const p = await verifyState(state);
    if (p.origin === "google-boite") qui = lireSub(p.sub);
  } catch {
    return erreur("delai");
  }
  if (!qui) return erreur("retour");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: creatorBoxClientId(), client_secret: creatorBoxClientSecret(),
      redirect_uri: CALLBACK_URL, grant_type: "authorization_code",
    }),
  });
  const tok = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tok.access_token) return erreur("google");

  const email = tok.id_token ? emailDuJeton(String(tok.id_token)) : null;
  if (email !== qui.email) {
    return erreur("adresse");
  }
  if (!droitsComplets(String(tok.scope ?? ""))) {
    return erreur("droits");
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const row: Record<string, unknown> = {
    email, creator: qui.creator, access_token: tok.access_token,
    expires_at: new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString(),
    scope: String(tok.scope ?? ""), connected: true, connected_at: new Date().toISOString(), last_error: null,
  };
  if (tok.refresh_token) row.refresh_token = tok.refresh_token;
  const { error } = await sb.from("creator_mail_boxes").upsert(row, { onConflict: "email" });
  if (error) return erreur("enregistrement");
  const { data } = await sb.from("creator_mail_boxes").select("refresh_token").eq("email", email).maybeSingle();
  if (!data?.refresh_token) {
    await sb.from("creator_mail_boxes").update({ connected: false, last_error: "no_refresh_token" }).eq("email", email);
    return erreur("durable");
  }

  return fin({ ok: email });
});

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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function page(titre: string, texte: string, status = 200): Response {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TTP Creators</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f6f6f7;color:#111;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{background:#fff;border-radius:16px;padding:28px;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;margin:0 0 10px;color:#333}</style></head>
<body><main><h1>${esc(titre)}</h1>${texte}</main></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const erreur = (texte: string, status = 400) => page("Connexion impossible", `<p>${esc(texte)}</p><p>Écris à TTP Creators pour recevoir un nouveau lien.</p>`, status);

/** sub du state : « adresse|créateur ». */
function lireSub(sub: string | undefined): { email: string; creator: string } | null {
  const [e, ...rest] = String(sub ?? "").split("|");
  const email = normEmail(e);
  const creator = rest.join("|").trim();
  return email && creator ? { email, creator } : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return erreur("Méthode non autorisée.", 405);
  if (!creatorBoxReady()) return erreur("La connexion des boîtes n'est pas encore réglée côté agence.", 500);
  const url = new URL(req.url);

  // 1. Le lien envoyé au créateur : on part chez Google.
  const lien = url.searchParams.get("t");
  if (lien) {
    let qui: { email: string; creator: string } | null = null;
    try {
      const p = await verifyState(lien, LIEN_TTL_MS);
      if (p.origin === "lien-boite") qui = lireSub(p.sub);
    } catch (e) {
      return erreur((e as Error).message === "state_expired" ? "Ce lien a expiré (il reste valable 7 jours)." : "Ce lien n'est pas valide.");
    }
    if (!qui) return erreur("Ce lien n'est pas valide.");
    const state = await signState({ origin: "google-boite", nonce: genNonce(), sub: `${qui.email}|${qui.creator}` });
    return Response.redirect(urlAutorisation(creatorBoxClientId(), state, qui.email), 302);
  }

  // 2. Retour de Google.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return erreur("Tu n'as pas donné l'accord sur l'écran de Google : rien n'a été connecté.");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return erreur("Il manque des informations dans le retour de Google.");
  let qui: { email: string; creator: string } | null = null;
  try {
    const p = await verifyState(state);
    if (p.origin === "google-boite") qui = lireSub(p.sub);
  } catch {
    return erreur("La connexion a pris plus de 10 minutes : rouvre le lien et recommence.");
  }
  if (!qui) return erreur("Retour de Google non reconnu.");

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
  if (!tokenRes.ok || !tok.access_token) return erreur("Google a refusé la connexion. Rouvre le lien et recommence.", 502);

  const email = tok.id_token ? emailDuJeton(String(tok.id_token)) : null;
  if (email !== qui.email) {
    return erreur(`Tu t'es connecté avec ${email ?? "une autre adresse"}, alors que le lien est prévu pour ${qui.email}. Rouvre le lien et choisis la bonne adresse.`);
  }
  if (!droitsComplets(String(tok.scope ?? ""))) {
    return erreur("Il faut cocher les deux autorisations Gmail (lire et préparer les brouillons) sur l'écran de Google. Rouvre le lien et coche les deux cases.");
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const row: Record<string, unknown> = {
    email, creator: qui.creator, access_token: tok.access_token,
    expires_at: new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString(),
    scope: String(tok.scope ?? ""), connected: true, connected_at: new Date().toISOString(), last_error: null,
  };
  if (tok.refresh_token) row.refresh_token = tok.refresh_token;
  const { error } = await sb.from("creator_mail_boxes").upsert(row, { onConflict: "email" });
  if (error) return erreur("La connexion a marché, mais l'enregistrement a échoué. Préviens TTP Creators.", 500);
  const { data } = await sb.from("creator_mail_boxes").select("refresh_token").eq("email", email).maybeSingle();
  if (!data?.refresh_token) {
    await sb.from("creator_mail_boxes").update({ connected: false, last_error: "no_refresh_token" }).eq("email", email);
    return erreur("Google n'a pas donné d'accès durable. Rouvre le lien et recommence.", 502);
  }

  return page("C'est fait ✓", `<p>Ta boîte <b>${esc(email)}</b> est reliée à TTP Creators.</p><p>L'agence peut maintenant préparer tes réponses aux marques directement dans ta boîte. Rien ne part sans validation de Marc, et tu peux retirer l'accès quand tu veux dans ton compte Google (Sécurité › Applications tierces).</p>`);
});

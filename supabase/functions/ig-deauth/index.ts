// ============================================================================
// ig-deauth/index.ts : « URL de rappel pour les annulations d'autorisation » de
// l'app Instagram (Meta › Instagram › Configuration de l'API avec connexion
// Instagram › Paramètres de connexion professionnelle).
// ----------------------------------------------------------------------------
// Meta appelle cette adresse quand une créatrice retire TTP Creators de son compte
// (Instagram › Paramètres › Sites web et apps) : POST formulaire `signed_request`.
// 1. Signature vérifiée avec IG_APP_SECRET (_shared/metaSignedRequest.ts) : invalide
//    → 400, rien n'est fait ni noté.
// 2. Compte retrouvé par user_id dans ig_accounts.ig_user_id : ligne supprimée (le
//    jeton ne sert plus), creators.ig.link mis à null (le reste de creators.ig gardé).
// 3. Une ligne dans ig_connexions (étape « annulation »), même si le compte est inconnu.
//    Son message porte « (user_id <id>) » : ig-data-deletion s'en sert pour retrouver
//    la créatrice quand la demande de suppression arrive après (format à garder).
// 4. Réponse 200 (Meta ne demande rien d'autre).
// La suppression des chiffres déjà relevés passe par ig-data-deletion.
//
// AUTH : verify_jwt = false (appel de Meta, sans JWT) ; l'authenticité tient à la
// signature HMAC du signed_request.
// ============================================================================

import { getServiceClient } from "../_shared/google.ts";
import { tidySecret } from "../_shared/instagram.ts";
import { lireSignedRequest, signedRequestDuCorps } from "../_shared/metaSignedRequest.ts";
import { igSansLien } from "../_shared/igSuppression.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "methode" }, 405);
  const body = await req.text().catch(() => "");
  const lu = await lireSignedRequest(tidySecret(Deno.env.get("IG_APP_SECRET")), signedRequestDuCorps(body, req.headers.get("Content-Type") ?? ""));
  if (!lu.ok) {
    console.error("ig-deauth signed_request refusé", lu.raison);
    return json({ error: "signed_request_invalide" }, 400);
  }

  const sb = getServiceClient();
  const { data: acc, error: accErr } = await sb.from("ig_accounts").select("creator_id, username").eq("ig_user_id", lu.userId).maybeSingle<{ creator_id: string; username: string | null }>();
  if (accErr) console.error("ig-deauth ig_accounts", accErr.message);

  let message = `Accès retiré par la créatrice depuis Instagram (user_id ${lu.userId})`;
  if (acc) {
    const { error: delErr } = await sb.from("ig_accounts").delete().eq("creator_id", acc.creator_id);
    if (delErr) message += ` ; jeton NON supprimé : ${delErr.message}`;
    const { data: c } = await sb.from("creators").select("ig").eq("id", acc.creator_id).maybeSingle<{ ig: unknown }>();
    if (c) {
      const { error: upErr } = await sb.from("creators").update({ ig: igSansLien(c.ig) }).eq("id", acc.creator_id);
      if (upErr) message += ` ; lien NON retiré : ${upErr.message}`;
    }
  } else if (!accErr) {
    message += " ; aucun compte connecté avec cet identifiant";
  }

  const { error: logErr } = await sb.from("ig_connexions").insert({
    creator_id: acc?.creator_id ?? null, via: "meta", etape: "annulation", ok: !!acc, raison: null,
    message: message.slice(0, 400), ig_username: acc?.username ?? null, account_type: null,
  });
  if (logErr) console.error("ig-deauth ig_connexions", logErr.message);
  console.log("ig-deauth", JSON.stringify({ creator: acc?.creator_id ?? null, trouve: !!acc }));
  return json({ ok: true });
});

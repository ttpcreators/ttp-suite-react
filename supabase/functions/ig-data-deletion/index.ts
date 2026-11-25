// ============================================================================
// ig-data-deletion/index.ts : « URL de la demande de suppression des données » de
// l'app Instagram (Meta › Instagram › Configuration de l'API avec connexion
// Instagram › Paramètres de connexion professionnelle).
// ----------------------------------------------------------------------------
// Meta appelle cette adresse quand une créatrice demande l'effacement des données
// que TTP Creators a reçues de son compte : POST formulaire `signed_request`.
// 1. Signature vérifiée avec IG_APP_SECRET (_shared/metaSignedRequest.ts) : invalide
//    → 400, rien n'est fait ni noté.
// 2. Compte retrouvé par user_id dans ig_accounts.ig_user_id, sinon (annulation déjà
//    passée par ig-deauth, qui a supprimé le jeton) par la ligne « annulation » de
//    ig_connexions qui porte ce user_id. Effacé (règles dans
//    _shared/igSuppression.ts) : le jeton (ig_accounts), creators.ig.link / insights /
//    insightsWhy, les chiffres privés des posts du feed et des posts de ses collabs,
//    les mesures d'engagement relevées avec son jeton (blob, engagementHistory), le @
//    et le type de compte des lignes de ig_connexions de cette créatrice.
//    Gardé : sa fiche, les chiffres publics, le media kit et tout ce que l'agence saisit.
// 3. Une ligne dans ig_connexions (étape « suppression ») avec le code de confirmation.
// 4. Réponse 200 JSON demandée par Meta : { url, confirmation_code }, où url est la
//    page statique app.ttpcreators.pro/instagram-donnees/?code=… (Supabase sert les
//    pages HTML des fonctions en texte brut, d'où la page de l'app).
// Compte inconnu (jamais connecté, ou déjà effacé) : rien à effacer, mêmes réponse et
// ligne de journal : Meta attend toujours un code.
//
// AUTH : verify_jwt = false (appel de Meta, sans JWT) ; l'authenticité tient à la
// signature HMAC du signed_request.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getServiceClient } from "../_shared/google.ts";
import { tidySecret } from "../_shared/instagram.ts";
import { readAppState } from "../_shared/appState.ts";
import { lireSignedRequest, signedRequestDuCorps } from "../_shared/metaSignedRequest.ts";
import { codeConfirmation, collabIgSansStatsPrivees, igSansDonneesPrivees, mesuresAutoInstagram, urlStatutSuppression } from "../_shared/igSuppression.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
// Motif ilike EXACT : « _ » et « % » d'un nom ne servent pas de jokers (même règle que ig-sync).
const exactName = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Efface tout ce qui vient du jeton de cette créatrice ; renvoie les étapes ratées. */
async function effacer(sb: SupabaseClient, creatorId: string): Promise<string[]> {
  const rates: string[] = [];
  const { error: delErr } = await sb.from("ig_accounts").delete().eq("creator_id", creatorId);
  if (delErr) rates.push(`jeton : ${delErr.message}`);

  const { data: c, error: cErr } = await sb.from("creators").select("name, ig").eq("id", creatorId).maybeSingle<{ name: string; ig: unknown }>();
  if (cErr) rates.push(`fiche : ${cErr.message}`);
  if (c) {
    const { error } = await sb.from("creators").update({ ig: igSansDonneesPrivees(c.ig) }).eq("id", creatorId);
    if (error) rates.push(`creators.ig : ${error.message}`);

    // Posts de ses collabs (ig-sync les rattache par le nom de la créatrice).
    const { data: cols, error: colErr } = await sb.from("collabs").select("id, ig").ilike("creator", exactName(c.name.trim()) || "∅");
    if (colErr) rates.push(`collabs : ${colErr.message}`);
    for (const col of (cols as { id: string; ig: unknown }[] | null) ?? []) {
      const ig = collabIgSansStatsPrivees(col.ig);
      if (!ig) continue;
      const { error: e } = await sb.from("collabs").update({ ig }).eq("id", col.id);
      if (e) rates.push(`collab ${col.id} : ${e.message}`);
    }
  }

  // Mesures d'engagement relevées avec son jeton (écriture partielle du blob).
  try {
    const ids = mesuresAutoInstagram((await readAppState(sb)).engagementHistory, creatorId);
    if (ids.length) {
      const { error } = await sb.rpc("app_state_list", { p_key: "engagementHistory", p_upsert: [], p_remove: ids, p_prepend: false });
      if (error) rates.push(`engagementHistory : ${error.message}`);
    }
  } catch (e) {
    rates.push(`engagementHistory : ${(e as Error).message}`);
  }

  // Journal des connexions : on garde les dates et les étapes, pas le @ ni le type de compte.
  const { error: logErr } = await sb.from("ig_connexions").update({ ig_username: null, account_type: null }).eq("creator_id", creatorId);
  if (logErr) rates.push(`ig_connexions : ${logErr.message}`);
  return rates;
}

/**
 * Meta envoie souvent l'annulation (ig-deauth, qui supprime la ligne de ig_accounts)
 * AVANT la demande de suppression : la créatrice est alors retrouvée par la ligne
 * « annulation » de ig_connexions, qui porte « (user_id <id>) » dans son message.
 */
async function creatriceAnnulee(sb: SupabaseClient, userId: string): Promise<{ creator_id: string } | null> {
  if (!/^\d+$/.test(userId)) return null;
  const { data, error } = await sb.from("ig_connexions").select("creator_id").eq("etape", "annulation").not("creator_id", "is", null)
    .ilike("message", `%(user_id ${userId})%`).order("at", { ascending: false }).limit(1);
  if (error) console.error("ig-data-deletion ig_connexions", error.message);
  const id = (data as { creator_id: string | null }[] | null)?.[0]?.creator_id;
  return id ? { creator_id: id } : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "methode" }, 405);
  const body = await req.text().catch(() => "");
  const lu = await lireSignedRequest(tidySecret(Deno.env.get("IG_APP_SECRET")), signedRequestDuCorps(body, req.headers.get("Content-Type") ?? ""));
  if (!lu.ok) {
    console.error("ig-data-deletion signed_request refusé", lu.raison);
    return json({ error: "signed_request_invalide" }, 400);
  }

  const sb = getServiceClient();
  const code = codeConfirmation();
  let { data: acc, error: accErr } = await sb.from("ig_accounts").select("creator_id").eq("ig_user_id", lu.userId).maybeSingle<{ creator_id: string }>();
  if (accErr) console.error("ig-data-deletion ig_accounts", accErr.message);
  if (!acc && !accErr) acc = await creatriceAnnulee(sb, lu.userId);

  let message = `Demande de suppression des données Instagram reçue de Meta (user_id ${lu.userId}), confirmation ${code}`;
  let rates: string[] = [];
  if (acc) {
    rates = await effacer(sb, acc.creator_id);
    message += rates.length ? ` ; À REPRENDRE : ${rates.join(" ; ")}` : " ; jeton, lien et statistiques privées effacés";
  } else if (accErr) {
    message += ` ; À REPRENDRE : lecture de ig_accounts impossible (${accErr.message})`;
  } else {
    message += " ; aucun compte connecté avec cet identifiant (rien à effacer)";
  }

  const { error: logErr } = await sb.from("ig_connexions").insert({
    creator_id: acc?.creator_id ?? null, via: "meta", etape: "suppression", ok: !accErr && rates.length === 0, raison: null,
    message: message.slice(0, 400), ig_username: null, account_type: null,
  });
  if (logErr) console.error("ig-data-deletion ig_connexions", logErr.message);
  console.log("ig-data-deletion", JSON.stringify({ creator: acc?.creator_id ?? null, code, rates }));
  return json({ url: urlStatutSuppression(code), confirmation_code: code });
});

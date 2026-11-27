// ============================================================================
// ig-callback/index.ts : connexion Instagram d'une créatrice, départ par lien et retour.
// ----------------------------------------------------------------------------
// 1. Départ par LIEN (envoyé par WhatsApp, préparé par l'agence ou Alfred) :
//    GET ?lien=<jeton signé, 7 jours, une créatrice> → vérifié (signature, date,
//    créatrice encore au roster) → 302 vers la page d'accord d'Instagram, avec un
//    state signé. Sans compte TTP, sans cookie ni localStorage.
// 2. Retour d'Instagram : GET ?code=…&state=<signé> (ou ?error=… si refus).
//    a. verifyState(state) → { origin, sub = id de la créatrice, via }. Temps accepté
//       depuis le départ : 30 min pour un lien, 10 min depuis l'app (_shared/igRetour.ts).
//    b. code → jeton + compte (id, @ ; un compte personnel est refusé). Connexion
//       unifiée (IG_CONFIG_ID posé) ou ancienne connexion Instagram : voir
//       _shared/instagram-login.ts.
//    c. Jeton rangé dans ig_accounts (jamais lisible depuis l'app) ; creators.ig.link
//       = { username, at, expires } pour l'affichage « Instagram connecté ».
//    d. Première synchro de ses chiffres (ig-sync, en arrière-plan).
// 3. CHAQUE tentative, réussie ou non, est notée dans ig_connexions (date, créatrice,
//    étape, raison, message brut de Meta) et l'agence (fondateurs) reçoit un push.
//    Après 2 essais ratés en 24 h : en plus, une tâche interne « Aider <prénom> à
//    connecter Instagram » (une seule ouverte), cochée toute seule à la réussite.
// 4. Sortie : depuis l'app → 302 <origin>?instagram=connected | error&raison=<code> ;
//    depuis un lien → page statique app.ttpcreators.pro/instagram-relie/ (aucune page
//    HTML servie ici : Supabase les affiche en texte brut).
//
// AUTH : verify_jwt = false (redirections du navigateur, sans JWT) ; l'authenticité
// tient au state signé (retour) et au jeton signé (lien).
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CRON_SECRET, getServiceClient, waitUntil } from "../_shared/google.ts";
import { genNonce, signState, type StatePayload, verifyState } from "../_shared/state.ts";
import { authorizeUrl, exchangeCode, loginReady, SCOPES } from "../_shared/instagram-login.ts";
import { type EssaiIg, type Etape, lireLien, messageBrut, PAGE_FIN_IG, type Raison, RAISON_AGENCE, raisonEchec, signerLien } from "../_shared/igConnexion.ts";
import { aideFaite, fautAide, FENETRE_AIDE_MS, ligneAide, messageExpire, ratesRecents, stateExpire, titreAide } from "../_shared/igRetour.ts";
import { sendTo } from "../_shared/push.ts";
import { deepLinkUrl, makePayload } from "../_shared/pushPayload.ts";

const SECRET = () => Deno.env.get("STATE_SIGNING_SECRET") ?? "";

/** Adresse de retour autorisée (APP_ALLOWED_ORIGINS) + paramètres ; null sinon. */
function retour(rawOrigin: string, params: Record<string, string>): string | null {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  try {
    const u = new URL(rawOrigin);
    if (!allowed.includes(u.origin)) return null;
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return null;
  }
}
/** Page de fin statique (lien, ou retour illisible). */
const pageFin = (params: Record<string, string>) => Response.redirect(`${PAGE_FIN_IG}?${new URLSearchParams(params)}`, 302);

type Essai = { creatorId: string | null; via: string; etape: Etape; ok: boolean; message?: string; username?: string; accountType?: string };

/** Note la tentative (ig_connexions + journal de la fonction) et prévient l'agence. */
async function noter(sb: SupabaseClient, e: Essai): Promise<Raison | null> {
  const raison = e.ok ? null : raisonEchec(e.etape, e.message ?? "");
  const message = e.message ? messageBrut(e.message) : null;
  console[e.ok ? "log" : "error"]("ig-callback", JSON.stringify({ creator: e.creatorId, via: e.via, etape: e.etape, raison, message }));
  const { error } = await sb.from("ig_connexions").insert({
    creator_id: e.creatorId, via: e.via, etape: e.etape, ok: e.ok, raison, message,
    ig_username: e.username || null, account_type: e.accountType || null,
  });
  if (error) console.error("ig-callback ig_connexions", error.message); // SQL pas encore passé : on continue
  if (e.creatorId) {
    waitUntil(prevenir(sb, e.creatorId, raison, e.username));
    waitUntil(suivreAide(sb, e.creatorId, e.ok));
  }
  return raison;
}

/**
 * Tâche interne « Aider <prénom> à connecter Instagram » (règles : _shared/igRetour.ts) :
 * créée après 2 essais ratés en 24 h, en plus du push ; une seule ouverte par créateur ;
 * cochée toute seule quand la connexion réussit. Ne bloque jamais le retour.
 */
async function suivreAide(sb: SupabaseClient, creatorId: string, ok: boolean) {
  try {
    const { data: c } = await sb.from("creators").select("name").eq("id", creatorId).maybeSingle<{ name: string }>();
    const nom = (c?.name ?? "").trim();
    if (!nom) return;
    const { data: ouvertes, error } = await sb.from("todos").select("id, descr").eq("text", titreAide(nom)).eq("creator", nom).eq("done", false).limit(1);
    if (error) return console.error("ig-callback tâche d'aide", error.message);
    const ouverte = ((ouvertes as { id: string; descr: string | null }[] | null) ?? [])[0];
    const now = new Date();
    if (ok) {
      if (!ouverte) return;
      const { error: e } = await sb.from("todos").update(aideFaite(ouverte.descr, now)).eq("id", ouverte.id).eq("done", false);
      if (e) console.error("ig-callback tâche d'aide faite", e.message);
      return;
    }
    if (ouverte) return;
    const { data: essais } = await sb.from("ig_connexions").select("at, ok")
      .eq("creator_id", creatorId).gte("at", new Date(now.getTime() - FENETRE_AIDE_MS).toISOString())
      .order("at", { ascending: false }).limit(20);
    const liste = (essais as EssaiIg[] | null) ?? [];
    if (!fautAide(liste, now.getTime())) return;
    const { error: e2 } = await sb.from("todos").insert(ligneAide({ nom, rates: ratesRecents(liste, now.getTime()), now }));
    if (e2) console.error("ig-callback tâche d'aide", e2.message);
  } catch (err) {
    console.error("ig-callback tâche d'aide", (err as Error).message);
  }
}

/** Push aux fondateurs : connexion ratée (avec la raison) ou réussie. */
async function prevenir(sb: SupabaseClient, creatorId: string, raison: Raison | null, username?: string) {
  try {
    const { data } = await sb.from("creators").select("name").eq("id", creatorId).maybeSingle<{ name: string }>();
    const nom = data?.name ?? "Une créatrice";
    await sendTo(sb, { agency: true, audience: "founders" }, makePayload({
      title: raison ? "Instagram : connexion ratée" : "Instagram connecté",
      body: raison ? `${nom} · ${RAISON_AGENCE[raison]}` : `${nom}${username ? ` · @${username}` : ""}`,
      url: deepLinkUrl({ open: "view", view: "roster", item: creatorId }),
      tag: `ig-connexion-${creatorId}`,
      kind: raison ? "error" : "creator-activity",
    }));
  } catch (err) {
    console.error("ig-callback push", (err as Error).message);
  }
}

/** Départ par lien : vérifie le jeton, puis envoie vers la page d'accord d'Instagram. */
async function depuisLien(sb: SupabaseClient, jeton: string): Promise<Response> {
  const l = await lireLien(SECRET(), jeton);
  if (!l.ok) {
    await noter(sb, { creatorId: null, via: "lien", etape: "lien", ok: false, message: `lien ${l.raison}${l.creatorId ? ` (créatrice ${l.creatorId})` : ""}` });
    return pageFin({ statut: "erreur", raison: "lien_invalide" });
  }
  const { data: c } = await sb.from("creators").select("id, status").eq("id", l.creatorId).maybeSingle<{ id: string; status: string | null }>();
  if (!c || (c.status ?? "").toLowerCase() === "inactif") {
    await noter(sb, { creatorId: null, via: "lien", etape: "lien", ok: false, message: `créatrice absente ou inactive (${l.creatorId})` });
    return pageFin({ statut: "erreur", raison: "lien_invalide" });
  }
  if (!loginReady()) {
    await noter(sb, { creatorId: c.id, via: "lien", etape: "configuration", ok: false, message: "secrets de connexion Instagram absents (IG_REDIRECT_URI, IG_CONFIG_ID + META_APP_SECRET ou IG_APP_ID + IG_APP_SECRET)" });
    return pageFin({ statut: "erreur", raison: "agence" });
  }
  // La date du lien voyage dans le state : un « Réessayer » garde la même fin de validité.
  const state = await signState({ origin: PAGE_FIN_IG, nonce: genNonce(), sub: c.id, via: `lien:${l.iat}` });
  return Response.redirect(authorizeUrl(state), 302);
}

/**
 * State du retour : valide, expiré (signature bonne, temps dépassé) ou illisible.
 * Signature et forme d'abord, sans limite de temps ; puis le temps selon le départ,
 * lu dans le state signé : 30 min pour un lien, 10 min depuis l'app (_shared/igRetour.ts).
 */
async function lireState(raw: string): Promise<{ payload: StatePayload; expire: boolean } | null> {
  try {
    const payload = await verifyState(raw, Number.POSITIVE_INFINITY);
    return { payload, expire: stateExpire(payload) };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const sb = getServiceClient();
  const lien = url.searchParams.get("lien");
  if (lien !== null) return await depuisLien(sb, lien);

  const st = await lireState(url.searchParams.get("state") ?? "");
  // Seuls les jetons émis pour Instagram (ig-connect ou un lien) sont acceptés ici.
  const viaOk = (v?: string) => v === "espace" || v === "agence" || v === "lien" || /^lien:\d+$/.test(v ?? "");
  if (!st?.payload.sub || !viaOk(st.payload.via)) {
    await noter(sb, { creatorId: null, via: "inconnu", etape: "etat", ok: false, message: "state absent ou signature invalide" });
    return pageFin({ statut: "erreur", raison: "expire" });
  }
  const { payload } = st;
  const creatorId = payload.sub!;
  const viaLien = payload.via === "lien" || payload.via!.startsWith("lien:");
  const via = viaLien ? "lien" : payload.via!;
  // Date du lien d'origine (absente des anciens jetons : pas de lien neuf pour eux).
  const lienIat = viaLien ? Number(payload.via!.split(":")[1]) || null : null;

  // Sortie : vers l'app (départ depuis l'app), ou vers la page de fin (départ par lien).
  const sortie = async (r: { ok: true; username: string } | { ok: false; raison: Raison }): Promise<Response> => {
    if (viaLien) {
      if (r.ok) return pageFin({ statut: "ok", ...(r.username ? { compte: r.username } : {}) });
      // « Réessayer » sur la page de fin : un lien neuf pour la même créatrice.
      // Il garde la date du lien de départ : refuser chez Instagram ne prolonge jamais le lien.
      const neuf = r.raison === "lien_invalide" || !lienIat ? null : await signerLien(SECRET(), creatorId, lienIat).catch(() => null);
      return pageFin({ statut: "erreur", raison: r.raison, ...(neuf ? { r: neuf } : {}) });
    }
    const to = retour(payload.origin, r.ok ? { instagram: "connected" } : { instagram: "error", raison: r.raison });
    return to ? Response.redirect(to, 302) : pageFin(r.ok ? { statut: "ok" } : { statut: "erreur", raison: r.raison });
  };
  const echec = async (etape: Etape, message: string, extra: Partial<Essai> = {}) =>
    sortie({ ok: false, raison: (await noter(sb, { creatorId, via, etape, ok: false, message, ...extra })) ?? "agence" });

  if (st.expire) return echec("etat", messageExpire(payload.via));

  const code = url.searchParams.get("code");
  if (!code) {
    // Refus de la créatrice, compte pas pro, ou erreur d'Instagram.
    const detail = ["error", "error_reason", "error_description"].map((k) => url.searchParams.get(k)).filter(Boolean).join(" · ");
    return echec("autorisation", detail || "retour sans code");
  }
  if (!loginReady()) return echec("configuration", "secrets de connexion Instagram absents (IG_REDIRECT_URI, IG_CONFIG_ID + META_APP_SECRET ou IG_APP_ID + IG_APP_SECRET)");

  const r = await exchangeCode(code.replace(/#_$/, ""));
  if (!r.ok) return echec(r.etape, r.message, { username: r.username, accountType: r.accountType });

  const now = new Date();
  // Connexion unifiée avec un jeton sans fin (configuration « Jamais ») : pas de date.
  const expires = r.expiresIn ? new Date(now.getTime() + r.expiresIn * 1000).toISOString() : null;
  const { error } = await sb.from("ig_accounts").upsert({
    creator_id: creatorId, ig_user_id: r.userId, username: r.username, token: r.token,
    expires_at: expires, scopes: SCOPES, connected_at: now.toISOString(), refreshed_at: now.toISOString(),
  });
  if (error) return echec("enregistrement", `ig_accounts : ${error.message}`, { username: r.username, accountType: r.accountType });
  const { data: c } = await sb.from("creators").select("ig").eq("id", creatorId).maybeSingle<{ ig: Record<string, unknown> | null }>();
  const { error: e2 } = await sb.from("creators").update({ ig: { ...(c?.ig ?? {}), link: { username: r.username, at: now.toISOString(), expires }, insightsWhy: null } }).eq("id", creatorId);
  if (e2) return echec("enregistrement", `creators.ig : ${e2.message}`, { username: r.username, accountType: r.accountType });
  await noter(sb, { creatorId, via, etape: "ok", ok: true, username: r.username, accountType: r.accountType });

  // Ses chiffres tout de suite, sans attendre le passage de la nuit.
  waitUntil(
    fetch("https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "creator", id: creatorId }),
    }),
  );
  return sortie({ ok: true, username: r.username });
});

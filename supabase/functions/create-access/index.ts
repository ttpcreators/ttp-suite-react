// ============================================================================
// create-access/index.ts
// ----------------------------------------------------------------------------
// Crée un VRAI compte de connexion (créateur ou membre agence) via l'API admin
// Supabase — SANS déconnecter l'agence (contrairement à un signUp côté client).
// La clé service_role reste côté serveur (getServiceClient).
//
// AUTH (config.toml -> verify_jwt = true) : réservé aux FONDATEURS.
// Entrée : { email, password, role: 'creator'|'agency', creator? }. Un compte créateur
// vise une fiche existante qui n'a pas encore de compte.
// « Nouveau mot de passe » : { action: 'reset', email, password } → remplace le mot
// de passe d'un compte existant (jamais celui d'un autre fondateur ni d'un compte sans
// profil) et coupe ses
// connexions Claude. Le mot de passe n'est JAMAIS stocké par l'app :
// il est seulement montré une fois au fondateur, pour le transmettre.
// Règles pures : _shared/comptes.ts (12 caractères au moins).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { MIN_MOT_DE_PASSE, rattachementCreateur, resetAutorise, type ProfilCible } from "../_shared/comptes.ts";

// La gestion des accès est réservée aux FONDATEURS (agence + agency_role='founder').
// Renvoie l'id du fondateur appelant, sinon null.
async function founderId(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<string | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return null;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return null;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role, agency_role").eq("user_id", data.user.id).maybeSingle<{ role: string; agency_role: string | null }>();
  if (profErr || !prof) return null; // fail-closed
  return prof.role === "agency" && (prof.agency_role ?? "member") === "founder" ? data.user.id : null;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  const appelant = await founderId(req, sb);
  if (!appelant) return jsonRes({ error: "unauthorized" }, 401);

  let body: { action?: string; email?: string; password?: string; role?: string; creator?: string; agencyRole?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = body.role === "agency" ? "agency" : "creator";
  const creator = (body.creator ?? "").trim();
  // Niveau agence du nouveau compte : 'founder' | 'member' (par défaut 'member').
  const agencyRole = role === "agency" && body.agencyRole === "founder" ? "founder" : "member";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonRes({ error: "email_invalide" }, 400);
  if (password.length < MIN_MOT_DE_PASSE) return jsonRes({ error: "mot_de_passe_trop_court" }, 400);

  // Nouveau mot de passe pour un compte qui existe déjà (perdu, oublié…).
  if (body.action === "reset") {
    let userId: string | null = null;
    for (let page = 1; page <= 25 && !userId; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return jsonRes({ error: "reset_echoue" }, 502);
      userId = data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (!userId) return jsonRes({ error: "compte_introuvable" }, 404);
    // Jamais le compte d'un autre fondateur, ni un compte sans profil sauf le sien
    // (profil illisible : refus).
    const { data: cible, error: cibleErr } = await sb.from("profiles").select("role, agency_role").eq("user_id", userId).maybeSingle<NonNullable<ProfilCible>>();
    if (cibleErr) return jsonRes({ error: "reset_echoue" }, 502);
    if (!resetAutorise(appelant, userId, cible ?? null)) return jsonRes({ error: cible ? "reset_fondateur_refuse" : "reset_profil_absent" }, 403);
    const { error: upErr } = await sb.auth.admin.updateUserById(userId, { password });
    if (upErr) return jsonRes({ error: "reset_echoue", detail: String(upErr.message).slice(0, 200) }, 400);
    // Nouveau mot de passe : les connexions Claude ouvertes avec l'ancien sont coupées.
    await sb.from("mcp_grants").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null).then(() => {}, () => {});
    return jsonRes({ ok: true, email });
  }

  if (role === "creator") {
    // La fiche doit exister, et ne pas être déjà reliée à un autre compte (le lien compte →
    // créateur passe par le nom : deux comptes liraient les mêmes données).
    const [{ data: fiche, error: ficheErr }, { count, error: lienErr }] = await Promise.all([
      sb.from("creators").select("name").eq("name", creator).limit(1),
      sb.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "creator").eq("creator_name", creator),
    ]);
    if (ficheErr || lienErr) return jsonRes({ error: "creation_echouee" }, 502);
    const refus = rattachementCreateur(creator, ((fiche as unknown[] | null) ?? []).length > 0, count ?? 0);
    if (refus) return jsonRes({ error: refus }, refus === "createur_requis" ? 400 : 409);
  }

  // Création du compte (email déjà confirmé → connexion immédiate).
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: creator ? { creator_name: creator } : {},
  });
  if (createErr || !created?.user) {
    const msg = String(createErr?.message ?? "");
    if (/registered|exists|already/i.test(msg)) return jsonRes({ error: "email_deja_utilise" }, 409);
    return jsonRes({ error: "creation_echouee", detail: msg.slice(0, 200) }, 400);
  }

  // Profil : le trigger pose role='creator' + creator_name=NULL (aucune confiance
  // aux métadonnées client — cf. handle_new_user). C'est ICI, côté serveur admin et
  // APRÈS vérification que l'appelant est bien l'agence, qu'on fixe le rôle et le
  // rattachement créatrice. C'est désormais le SEUL endroit qui lie un compte à une
  // créatrice → on vérifie que l'upsert a réussi (sinon le compte ne verrait rien).
  const { error: profErr2 } = await sb.from("profiles").upsert(
    { user_id: created.user.id, role, creator_name: creator || null, agency_role: agencyRole },
    { onConflict: "user_id" },
  );
  if (profErr2) {
    return jsonRes(
      { error: "profil_non_enregistre", detail: String(profErr2.message).slice(0, 200) },
      500,
    );
  }

  return jsonRes({ ok: true, userId: created.user.id, email, role, creator: creator || null, agencyRole });
});

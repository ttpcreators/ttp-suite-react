// ============================================================================
// create-access/index.ts
// ----------------------------------------------------------------------------
// Crée un VRAI compte de connexion (créateur ou membre agence) via l'API admin
// Supabase — SANS déconnecter l'agence (contrairement à un signUp côté client).
// La clé service_role reste côté serveur (getServiceClient).
//
// AUTH (config.toml -> verify_jwt = true) : réservé à l'AGENCE.
// Entrée : { email, password, role: 'creator'|'agency', creator? }.
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

async function isAgency(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  if (profErr || !prof) return false; // fail-closed
  return prof.role === "agency";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: { email?: string; password?: string; role?: string; creator?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = body.role === "agency" ? "agency" : "creator";
  const creator = (body.creator ?? "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonRes({ error: "email_invalide" }, 400);
  if (password.length < 6) return jsonRes({ error: "mot_de_passe_trop_court" }, 400);
  if (role === "creator" && !creator) return jsonRes({ error: "createur_requis" }, 400);

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

  // Profil : le trigger a posé role='creator'. Aligne le rôle/nom demandé.
  await sb.from("profiles").upsert(
    { user_id: created.user.id, role, creator_name: creator || null },
    { onConflict: "user_id" },
  );

  return jsonRes({ ok: true, userId: created.user.id, email, role, creator: creator || null });
});

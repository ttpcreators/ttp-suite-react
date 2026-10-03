// ============================================================================
// gmail-trash/index.ts
// ----------------------------------------------------------------------------
// Met une conversation Gmail à la CORBEILLE (ou l'en sort). Jamais de suppression
// définitive : le fil reste 30 jours dans la corbeille Gmail, récupérable.
// Réservé à l'AGENCE (verify_jwt=true + rôle agence). Scope gmail.modify.
//
// Entrée : { threadId, box?, undo? } (box = "partnerships" défaut | "talent" ;
//          undo = true → sort le fil de la corbeille).   Sortie : { ok: true }.
// Droits : partnerships@ = reconnecter Google dans l'app (scope gmail.modify) ;
//          talent@ = ajouter gmail.modify à la délégation (admin.google.com).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, parseBox } from "../_shared/gmailBox.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function isAgency(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  if (profErr || !prof) return false;
  return prof.role === "agency";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: { threadId?: string; box?: string; undo?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const threadId = String(body.threadId ?? "").trim();
  // Identifiant Gmail = hexadécimal : rien d'autre ne part dans l'URL.
  if (!/^[0-9a-f]{6,32}$/i.test(threadId)) return jsonRes({ error: "thread_requis" }, 400);

  let token: string;
  try {
    token = await boxToken(sb, parseBox(body.box), "modify");
  } catch (e) {
    const be = boxError(e);
    return jsonRes({ error: be.error }, be.status);
  }

  const r = await fetch(`${GMAIL}/threads/${threadId}/${body.undo ? "untrash" : "trash"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    // 403 = droit « modifier » pas encore accordé à cette boîte.
    if (r.status === 403) return jsonRes({ error: "gmail_scope_manquant" }, 403);
    if (r.status === 404) return jsonRes({ error: "introuvable" }, 404);
    return jsonRes({ error: "corbeille_echouee" }, 502);
  }
  return jsonRes({ ok: true });
});

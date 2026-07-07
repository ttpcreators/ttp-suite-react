// ============================================================================
// debrief-history/index.ts
// ----------------------------------------------------------------------------
// Renvoie les debriefs de campagne d'un CRÉATEUR connecté — filtrés côté serveur
// sur SON nom. Le blob __app_state__ (clé `debriefData`) est agence-only (RLS) ;
// cette fonction est le seul pont, sans jamais laisser fuiter les debriefs des
// autres créateurs ni le reste du blob.
//
// AUTH (config.toml -> verify_jwt = true) : JWT requis. Créateur → ses debriefs ;
// agence → tous.
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

type Debrief = { creator?: string } & Record<string, unknown>;

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return jsonRes({ error: "unauthorized" }, 401);

  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return jsonRes({ error: "unauthorized" }, 401);
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role,creator_name").eq("user_id", data.user.id)
    .maybeSingle<{ role: string; creator_name: string | null }>();
  if (profErr || !prof) return jsonRes({ error: "forbidden" }, 403); // fail-closed
  if (prof.role !== "agency" && prof.role !== "creator") return jsonRes({ debriefs: [] });

  const { data: rows } = await sb
    .from("module_rows").select("a").eq("module", "__app_state__")
    .order("created_at", { ascending: false }).limit(1);
  let debriefs: Debrief[] = [];
  try {
    const obj = JSON.parse((rows?.[0] as { a?: string } | undefined)?.a ?? "{}");
    debriefs = Array.isArray(obj?.debriefData) ? obj.debriefData : [];
  } catch {
    debriefs = [];
  }

  if (prof.role === "creator") {
    const me = (prof.creator_name ?? "").trim().toLowerCase();
    if (!me) return jsonRes({ debriefs: [] });
    debriefs = debriefs.filter((d) => String(d?.creator ?? "").trim().toLowerCase() === me);
  }

  return jsonRes({ debriefs });
});

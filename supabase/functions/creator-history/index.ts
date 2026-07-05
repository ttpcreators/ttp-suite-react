// ============================================================================
// creator-history/index.ts
// ----------------------------------------------------------------------------
// Renvoie l'historique d'engagement d'un CRÉATEUR connecté — filtré côté
// serveur sur SON nom uniquement. Le blob __app_state__ est agence-only (RLS) ;
// cette fonction est le seul pont, et elle ne laisse jamais fuiter les mesures
// des autres créateurs ni le reste du blob.
//
// AUTH (config.toml -> verify_jwt = true) : JWT requis. Créateur → ses mesures ;
// agence → tout l'historique (pratique, même si l'app agence lit le blob direct).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

type HistEntry = { creator?: string } & Record<string, unknown>;

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
  const { data: prof } = await sb
    .from("profiles").select("role,creator_name").eq("user_id", data.user.id)
    .maybeSingle<{ role: string; creator_name: string | null }>();

  // Blob agence (même sélection que le client : la ligne la plus récente).
  const { data: rows } = await sb
    .from("module_rows").select("a").eq("module", "__app_state__")
    .order("created_at", { ascending: false }).limit(1);
  let hist: HistEntry[] = [];
  try {
    const obj = JSON.parse((rows?.[0] as { a?: string } | undefined)?.a ?? "{}");
    hist = Array.isArray(obj?.engagementHistory) ? obj.engagementHistory : [];
  } catch {
    hist = [];
  }

  if (prof?.role === "creator") {
    const me = (prof.creator_name ?? "").trim().toLowerCase();
    if (!me) return jsonRes({ entries: [] });
    hist = hist.filter((h) => String(h?.creator ?? "").trim().toLowerCase() === me);
  }

  return jsonRes({ entries: hist });
});

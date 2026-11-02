// ============================================================================
// mediakit-publish/index.ts
// ----------------------------------------------------------------------------
// Bouton « Publier maintenant » des media kits : relance le déploiement du site
// (workflow deploy.yml de ttpcreators/websitettpcreators), qui régénère toutes les
// pages media kit et leurs PDF depuis les données live. Le passage automatique
// toutes les heures existe, mais GitHub le saute ou le retarde parfois de plusieurs heures.
//
// Si un déploiement attend ou tourne déjà, on n'en ajoute pas un second.
//
// AUTH : rôle agence (vérifié ici, verify_jwt=false dans config.toml).
// SECRET : GITHUB_SITE_TOKEN, jeton GitHub limité à ce dépôt (Actions : lecture et écriture).
// Sortie : { ok:true, already?:true } | { error }.
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";

const REPO = "ttpcreators/websitettpcreators";
const WORKFLOW = "deploy.yml";
const BUSY = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

async function requireAgency(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  if (profErr || !prof) return false; // fail-closed : profil absent/illisible → refus
  return prof.role === "agency";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!(await requireAgency(req))) return jsonRes({ error: "unauthorized" }, 401);

  const gh = Deno.env.get("GITHUB_SITE_TOKEN");
  if (!gh) return jsonRes({ error: "not_configured" }, 503);
  const headers = {
    Authorization: `Bearer ${gh}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ttp-suite",
  };
  const base = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;

  try {
    const runs = await fetch(`${base}/runs?per_page=5`, { headers, signal: AbortSignal.timeout(10_000) });
    if (runs.ok) {
      const body = await runs.json() as { workflow_runs?: { status?: string }[] };
      if ((body.workflow_runs ?? []).some((r) => BUSY.has(r.status ?? ""))) return jsonRes({ ok: true, already: true });
    }
    const res = await fetch(`${base}/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 204) return jsonRes({ ok: true });
    console.warn("mediakit-publish: GitHub a refusé", res.status, await res.text().catch(() => ""));
    return jsonRes({ error: res.status === 401 || res.status === 403 || res.status === 404 ? "token_refused" : "github_error" }, 502);
  } catch (e) {
    console.warn("mediakit-publish: GitHub injoignable", e);
    return jsonRes({ error: "github_unreachable" }, 502);
  }
});

// ============================================================================
// ttp-mcp : connecteur Claude de TTP Suite (serveur MCP, transport HTTP sans état).
// ----------------------------------------------------------------------------
// Adresse à ajouter dans Claude (Paramètres → Connecteurs → Ajouter un connecteur) :
//   https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ttp-mcp
// Connexion : OAuth 2.1 + PKCE avec le compte TTP Suite (voir oauth.ts), page
// d'accord sur app.ttpcreators.pro/connecteur/. Outils : tools.ts.
// verify_jwt = false (config.toml) : Claude n'a pas de session Supabase, l'accès est
// contrôlé ici par nos propres jetons (hachés, 1 h, révocables).
// ============================================================================

import { getServiceClient } from "../_shared/google.ts";
import { approve, asMetadata, authenticate, check, FN_URL, register, resourceMetadata, revoke, token } from "./oauth.ts";
import { callTool, toolList } from "./tools.ts";

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05", "2025-11-25"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, x-client-info, apikey",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const RESOURCE_META = `${FN_URL}/.well-known/oauth-protected-resource`;
const unauthorized = () =>
  json({ error: "invalid_token", error_description: "Connexion à TTP Suite requise." }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_META}", error="invalid_token"`,
  });

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const INSTRUCTIONS =
  "TTP Suite est l'outil de gestion de l'agence de talents TTP Creators (créateurs de contenu et sportifs). " +
  "Réponds en français. Commence par point_du_jour pour une question sur la journée, rechercher pour un nom ou une marque, " +
  "rechercher_mails puis lire_mail pour les mails. Les actions (tâche, rendez-vous, brouillon, contact, scouting, collab) " +
  "écrivent dans l'app : confirme toujours avec l'utilisateur avant. Les mails ne sont jamais envoyés, seulement préparés en brouillon.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/ttp-mcp/, "").replace(/\/+$/, "") || "/";
  const sb = getServiceClient();

  // ── Découverte (OAuth) ──
  if (req.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource")) return json(resourceMetadata());
  if (req.method === "GET" && (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration"))) return json(asMetadata());

  // ── OAuth ──
  if (req.method === "POST" && path === "/register") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await register(sb, body);
    return json(r.body, r.status);
  }
  if (req.method === "POST" && path === "/authorize/check") {
    const r = await check(sb, (await req.json().catch(() => ({}))) as Record<string, unknown>);
    return json(r.body, r.status);
  }
  if (req.method === "POST" && path === "/authorize/approve") {
    const authz = req.headers.get("Authorization") ?? "";
    const jwt = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
    if (!jwt) return json({ error: "access_denied", error_description: "Connecte-toi d'abord." }, 401);
    const r = await approve(sb, jwt, (await req.json().catch(() => ({}))) as Record<string, unknown>);
    return json(r.body, r.status);
  }
  if (req.method === "POST" && (path === "/token" || path === "/revoke")) {
    const ct = req.headers.get("Content-Type") ?? "";
    let form: URLSearchParams;
    if (ct.includes("application/json")) {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      form = new URLSearchParams(Object.entries(b).map(([k, v]) => [k, String(v)]));
    } else {
      form = new URLSearchParams(await req.text());
    }
    const authz = req.headers.get("Authorization") ?? "";
    const r = path === "/token" ? await token(sb, form, authz.startsWith("Basic ") ? authz.slice(6).trim() : null) : await revoke(sb, form);
    return json(r.body, r.status);
  }

  // ── MCP ──
  if (path !== "/" && path !== "/mcp") return json({ error: "introuvable" }, 404);
  if (req.method === "GET") return json({ error: "Flux non disponible : utiliser POST." }, 405, { Allow: "POST" });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "methode" }, 405);

  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const ctx = bearer ? await authenticate(sb, bearer) : null;
  if (!ctx) return unauthorized();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible" } }, 400);
  }

  const handle = async (m: Rpc): Promise<Record<string, unknown> | null> => {
    const id = m.id ?? null;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const error = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (m.id === undefined) return null; // notification : pas de réponse
    switch (m.method) {
      case "initialize": {
        const asked = String(m.params?.protocolVersion ?? "");
        return reply({
          protocolVersion: SUPPORTED.includes(asked) ? asked : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "ttp-suite", title: "TTP Suite", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: toolList(ctx) });
      case "tools/call": {
        const name = String(m.params?.name ?? "");
        const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
        const r = await callTool(sb, ctx, name, args);
        return reply({ content: [{ type: "text", text: r.text }], isError: !!r.isError });
      }
      case "resources/list":
        return reply({ resources: [] });
      case "prompts/list":
        return reply({ prompts: [] });
      default:
        return error(-32601, `Méthode non prise en charge : ${m.method}`);
    }
  };

  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handle(m as Rpc)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handle(payload as Rpc);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
});

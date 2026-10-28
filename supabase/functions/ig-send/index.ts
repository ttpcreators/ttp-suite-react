// ============================================================================
// ig-send/index.ts : envoyer un DM Instagram depuis la page « DM Instagram ».
// ----------------------------------------------------------------------------
// API officielle de Meta (Messenger pour Instagram), jeton de la Page liée au compte
// TTP, autorisation instagram_manage_messages (accès avancé validé le 2026-10-28).
// Règle de Meta : on ne peut répondre que dans les 24 h qui suivent le DERNIER message
// de la personne (sinon : erreur « hors_fenetre », il faut répondre depuis Instagram).
// Le message envoyé est ajouté tout de suite à la conversation (id « sent:… ») ; la
// lecture suivante (ig-inbox) le remplace par le message tel que Meta le renvoie.
//
// Entrée : { threadId, text } (1 000 caractères max). Agence seulement (JWT).
// Sortie : { ok, id, at } ou { error } : hors_fenetre, indisponible, destinataire_inconnu,
//          texte_invalide, meta_jeton, meta_limite, meta_autorisation, reseau…
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { metaReady, pageAccess, postGraph, saveUsage } from "../_shared/instagram.ts";
import { cleanDm, sendWhy } from "../_shared/igSend.ts";

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const { data: u } = bearer ? await sb.auth.getUser(bearer) : { data: null };
  if (!u?.user) return res({ error: "non_autorise" }, 401);
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", u.user.id).maybeSingle<{ role: string }>();
  if (prof?.role !== "agency") return res({ error: "non_autorise" }, 403);
  if (!metaReady()) return res({ error: "meta_non_configure" });

  let body: { threadId?: unknown; text?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const threadId = String(body.threadId ?? "").trim();
  const text = cleanDm(body.text);
  if (!text) return res({ error: "texte_invalide" }, 400);
  const { data: th } = await sb.from("ig_threads").select("id, igsid").eq("id", threadId).maybeSingle<{ id: string; igsid: string | null }>();
  if (!th?.igsid) return res({ error: "destinataire_inconnu" }, 404);

  const page = await pageAccess();
  if (!page.ok) return res({ error: page.why, detail: page.detail ?? null });
  const r = await postGraph(`${page.pageId}/messages`, {
    recipient: JSON.stringify({ id: th.igsid }),
    message: JSON.stringify({ text }),
  }, page.token);
  await saveUsage(sb);
  if (r.error) {
    const e = r.error as { code?: number; error_subcode?: number; message?: string };
    console.log("ig-send échec", e.code, e.error_subcode, e.message);
    return res({ error: sendWhy(e), detail: e.message ?? null });
  }

  const at = new Date().toISOString();
  const id = `sent:${String(r.message_id ?? crypto.randomUUID())}`;
  await sb.from("ig_messages").upsert({ id, thread_id: th.id, at, me: true, text });
  await sb.from("ig_threads").update({ updated_at: at, last_text: text.slice(0, 300), last_from_me: true }).eq("id", th.id);
  return res({ ok: true, id, at });
});

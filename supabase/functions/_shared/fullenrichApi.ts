// ============================================================================
// _shared/fullenrichApi.ts : appels à l'API FullEnrich v2 (réseau), partagés par la
// fonction `fullenrich` (page Contacts) et l'outil `trouver_email_personne` du
// connecteur Claude. Les règles pures (corps des demandes, lecture des réponses) sont
// dans fullenrich.ts. Clé : secret FULLENRICH_API_KEY (jamais dans le code ni dans l'app).
// ============================================================================

import { bestContact } from "./fullenrich.ts";

export const FULLENRICH_API = "https://app.fullenrich.com/api/v2";
export const FULLENRICH_KEY = (Deno.env.get("FULLENRICH_API_KEY") ?? "").trim();

export async function fe(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const r = await fetch(`${FULLENRICH_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${FULLENRICH_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(25_000),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, body: {} };
  }
}

/** Erreur FullEnrich → raison lisible pour l'app. */
export function why(status: number, body: Record<string, unknown>): string {
  if (status === 0) return "reseau";
  if (status === 401) return "cle_invalide";
  if (status === 402 || /credit/i.test(JSON.stringify(body))) return "credits_insuffisants";
  if (status === 429) return "limite";
  return `fullenrich_${status}`;
}

export type EnrichResult =
  | { ok: true; email: string; emailStatus: string; phone: string; credits: number }
  | { ok: true; pending: string }
  | { error: string };

/** Relit un enrichissement jusqu'à `waitMs` ; au-delà, renvoie { pending: id } (à relire plus tard). */
export async function result(id: string, waitMs: number): Promise<EnrichResult> {
  const until = Date.now() + waitMs;
  for (;;) {
    const r = await fe(`/contact/enrich/bulk/${encodeURIComponent(id)}`);
    const st = String(r.body.status ?? "");
    if (r.status === 200 && st === "FINISHED") return { ok: true, ...bestContact(r.body), credits: Number((r.body.cost as { credits?: number } | undefined)?.credits) || 0 };
    if (r.status === 200 && ["CANCELED", "CREDITS_INSUFFICIENT", "UNKNOWN"].includes(st)) return { error: st === "CREDITS_INSUFFICIENT" ? "credits_insuffisants" : "echec" };
    // En cours (200 IN_PROGRESS, ou 400 error.enrichment.in_progress) : on attend encore un peu.
    if (r.status !== 200 && !/in_progress/i.test(JSON.stringify(r.body))) return { error: why(r.status, r.body) };
    if (Date.now() > until) return { ok: true, pending: id };
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** Lance l'enrichissement d'une personne (corps fait par enrichContact) et attend le résultat jusqu'à `waitMs`. */
export async function enrichir(contact: Record<string, unknown>, waitMs: number): Promise<EnrichResult> {
  const r = await fe("/contact/enrich/bulk", { method: "POST", body: JSON.stringify({ name: "TTP Suite", data: [contact] }) });
  const id = String(r.body.enrichment_id ?? "");
  if (r.status !== 200 || !id) return { error: why(r.status, r.body) };
  return await result(id, waitMs);
}

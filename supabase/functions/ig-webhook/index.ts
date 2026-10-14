// ============================================================================
// ig-webhook/index.ts : réception en direct des messages privés Instagram de TTP.
// ----------------------------------------------------------------------------
// Meta appelle cette adresse à chaque message reçu ou envoyé sur @ttpcreators
// (Webhooks de l'app → objet « Instagram » → champ « messages »).
//   GET  : vérification de l'abonnement (hub.verify_token = IG_WEBHOOK_VERIFY).
//   POST : événement signé par Meta (X-Hub-Signature-256, clé = META_APP_SECRET,
//          la clé secrète de l'app Meta) → lecture ciblée de la conversation par
//          ig-inbox ({ users: [id] }), en tâche de fond : Meta attend une réponse
//          immédiate. Le texte n'est pas lu ici : ig-inbox relit la conversation
//          par l'API (même traitement que la lecture horaire).
// AUTH : verify_jwt = false (Meta n'envoie pas de JWT) ; signature vérifiée ici.
// ============================================================================

import { CRON_SECRET, timingSafeEqualStr } from "../_shared/google.ts";
import { tidySecret } from "../_shared/instagram.ts";

const VERIFY = tidySecret(Deno.env.get("IG_WEBHOOK_VERIFY"));
const APP_SECRET = tidySecret(Deno.env.get("META_APP_SECRET"));
const INBOX = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/ig-inbox`;

async function signed(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqualStr(hex, header.slice(7).toLowerCase());
}

type Event = { sender?: { id?: string }; recipient?: { id?: string }; message?: { is_echo?: boolean } };

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && !!VERIFY && timingSafeEqualStr(url.searchParams.get("hub.verify_token") ?? "", VERIFY);
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("refusé", { status: 403 });
  }
  if (req.method !== "POST") return new Response("méthode", { status: 405 });
  const raw = await req.text();
  if (!(await signed(raw, req.headers.get("x-hub-signature-256")))) return new Response("signature", { status: 401 });

  let body: { object?: string; entry?: { messaging?: Event[] }[] } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok");
  }
  // L'autre personne de la conversation : l'expéditeur, ou le destinataire si c'est TTP qui écrit.
  const users = new Set<string>();
  for (const e of body.entry ?? []) {
    for (const m of e.messaging ?? []) {
      const other = m.message?.is_echo ? m.recipient?.id : m.sender?.id;
      if (other) users.add(String(other));
    }
  }
  if (users.size && CRON_SECRET) {
    const work = fetch(INBOX, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ users: [...users].slice(0, 10) }),
    }).catch(() => undefined);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work);
    else await work;
  }
  return new Response("ok");
});

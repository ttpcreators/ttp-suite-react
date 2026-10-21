// ============================================================================
// _shared/push.ts : envoi des notifications Web Push (un seul endroit).
// ----------------------------------------------------------------------------
// • Clés VAPID (secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).
// • sendTo(sb, cible, charge) : cible = des comptes précis, l'AGENCE (rôle
//   'agency' uniquement : un compte créateur, sans profil ou au rôle inconnu
//   n'est jamais servi) ou UN créateur (profiles.creator_name).
// • Abonnements morts (404 / 410) supprimés au passage.
// Format des charges : _shared/pushPayload.ts (makePayload).
// ============================================================================

import webpush from "npm:web-push@3.6.7";
import type { getServiceClient } from "./google.ts";
import { pushTopic, type PushPayload } from "./pushPayload.ts";

export { makePayload, deepLinkUrl, type PushPayload } from "./pushPayload.ts";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marc@ttpcreators.pro";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

/** Push configuré (clé privée VAPID présente) ? */
export const pushReady = (): boolean => !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

type Sb = ReturnType<typeof getServiceClient>;
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string | null };

/** founders = fondateurs seuls (messages avec de l'argent), members = les autres comptes agence. */
export type Audience = "all" | "founders" | "members";
export type PushTarget =
  | { userIds: string[] }
  | { agency: true; audience?: Audience; exclude?: string }
  | { creator: string };

export type SendResult = { sent: number; removed: number; total: number; firstError: string | null };

/** Comptes visés (user_id). */
async function resolveUsers(sb: Sb, target: PushTarget): Promise<string[]> {
  if ("userIds" in target) return [...new Set(target.userIds.filter(Boolean))];
  if ("creator" in target) {
    const name = target.creator.trim();
    if (!name) return [];
    const { data } = await sb.from("profiles").select("user_id").eq("role", "creator").eq("creator_name", name);
    return [...new Set(((data ?? []) as { user_id: string | null }[]).map((p) => p.user_id).filter((x): x is string => !!x))];
  }
  // ALLOWLIST agence : rôle 'agency' explicite uniquement.
  const { data, error } = await sb.from("profiles").select("user_id,role,agency_role").eq("role", "agency");
  let rows = (data ?? []) as { user_id: string; role: string; agency_role?: string | null }[];
  if (error) {
    // Colonne agency_role absente (vieille base) : sans distinction fondateur / membre.
    const r = await sb.from("profiles").select("user_id,role").eq("role", "agency");
    rows = (r.data ?? []) as { user_id: string; role: string }[];
  }
  const audience = target.audience ?? "all";
  return rows
    .filter((p) => p.role === "agency" && p.user_id && p.user_id !== target.exclude)
    .filter((p) => audience === "all" || (audience === "founders") === (p.agency_role === "founder"))
    .map((p) => p.user_id);
}

/** Abonnements (appareils) des comptes visés. */
async function subscriptionsOf(sb: Sb, target: PushTarget): Promise<Sub[]> {
  const ids = await resolveUsers(sb, target);
  if (!ids.length) return [];
  const { data } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id").in("user_id", ids);
  return (data ?? []) as Sub[];
}

/**
 * Envoie une ou plusieurs notifications à la cible. Mails : urgence haute ; le
 * « topic » (mails seulement : il est tronqué à 32 caractères) remplace chez le
 * service de push un envoi pas encore livré du même fil.
 */
export async function sendTo(sb: Sb, target: PushTarget, payloads: PushPayload | PushPayload[]): Promise<SendResult> {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  const res: SendResult = { sent: 0, removed: 0, total: 0, firstError: null };
  if (!list.length || !pushReady()) return res;
  const subs = await subscriptionsOf(sb, target);
  res.total = subs.length;
  const dead = new Set<string>();
  await Promise.all(subs.map(async (s) => {
    for (const p of list) {
      if (dead.has(s.id)) return;
      const mail = p.kind.includes("mail");
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(p),
          {
            TTL: mail ? 2 * 86400 : 86400,
            urgency: mail || p.kind === "test" ? "high" : "normal",
            ...(mail ? { topic: pushTopic(p.tag) } : {}),
          },
        );
        res.sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (!res.firstError) res.firstError = `${code ?? ""} ${(e as Error)?.message ?? String(e)}`.trim().slice(0, 200);
        if (code === 404 || code === 410) {
          dead.add(s.id);
          await sb.from("push_subscriptions").delete().eq("id", s.id);
          res.removed++;
        }
      }
    }
  }));
  return res;
}

/** Blob agence (__app_state__, ligne la plus récente) : réglages des notifications. */
export async function loadAppBlob(sb: Sb): Promise<Record<string, unknown>> {
  try {
    const { data } = await sb.from("module_rows").select("a").eq("module", "__app_state__")
      .order("created_at", { ascending: false }).limit(1);
    const raw = (data?.[0] as { a?: unknown } | undefined)?.a;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    return obj && typeof obj === "object" ? obj as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Préférences notifPrefs (tout activé par défaut). */
export async function loadNotifPrefs(sb: Sb): Promise<Record<string, boolean | undefined>> {
  const blob = await loadAppBlob(sb);
  return (blob.notifPrefs as Record<string, boolean | undefined> | undefined) ?? {};
}

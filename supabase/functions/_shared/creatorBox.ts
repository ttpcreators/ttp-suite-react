// ============================================================================
// _shared/creatorBox.ts : les boîtes Gmail des créateurs connectées à TTP Suite
// (demande de Marc, 16 novembre 2026 : Alfred prépare ET envoie depuis la boîte de Léna,
// sur le « oui » de Marc, sans passer par Spark).
// ----------------------------------------------------------------------------
//   • Le créateur se connecte LUI MÊME à Google (lien envoyé par Marc, fonction
//     creator-box-callback) : jamais de mot de passe demandé ni saisi à sa place.
//   • Client OAuth : celui de la connexion YouTube des créateurs (YT_CLIENT_ID /
//     YT_CLIENT_SECRET), projet Google « TTP Creators », Externe et en production :
//     il accepte les adresses @gmail.com. Le client de partnerships@ (Interne) n'est pas touché.
//   • Droits : lire (gmail.readonly) et préparer ou envoyer des brouillons (gmail.compose).
//     Ni corbeille, ni suppression de mails.
//   • Jetons dans la table creator_mail_boxes, lue seulement par le serveur (RLS sans règle).
// Logique pure en haut (testée par creatorBox.test.ts), accès base et Google en bas.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const PROJECT_URL = "https://zizvggziggswhrbuyhuo.supabase.co";
export const CALLBACK_URL = `${PROJECT_URL}/functions/v1/creator-box-callback`;
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];
/** Le lien envoyé au créateur reste valable 7 jours. */
export const LIEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Adresse mail normalisée, ou null si ce n'en est pas une. */
export function normEmail(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[^@\s<>,;"']+@[^@\s<>,;"']+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** Une boîte de créateur se désigne par son adresse ; les boîtes de l'agence par leur nom. */
export const isCreatorBox = (box: string) => box.includes("@");

/** Adresse et nom du créateur lus dans un id_token Google (canal TLS direct avec Google). */
export function emailDuJeton(idToken: string): string | null {
  try {
    const part = idToken.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (json.email_verified === false) return null;
    return normEmail(json.email);
  } catch {
    return null;
  }
}

/** Les droits accordés couvrent la lecture et les brouillons. */
export function droitsComplets(scope: string): boolean {
  const s = new Set(String(scope ?? "").split(/\s+/));
  return s.has("https://www.googleapis.com/auth/gmail.readonly") && s.has("https://www.googleapis.com/auth/gmail.compose");
}

/** L'adresse Google d'autorisation (state = state signé de 10 minutes). */
export function urlAutorisation(clientId: string, state: string, email: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: email,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// ── Accès base et Google ────────────────────────────────────────────────────

export type CreatorBoxRow = {
  email: string;
  creator: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: string | null;
  scope: string | null;
  connected: boolean;
  connected_at: string | null;
  last_error: string | null;
};

const clientId = () => (Deno.env.get("YT_CLIENT_ID") ?? "").trim();
const clientSecret = () => (Deno.env.get("YT_CLIENT_SECRET") ?? "").trim();
export const creatorBoxReady = () => !!clientId() && !!clientSecret();
export const creatorBoxClientId = clientId;
export const creatorBoxClientSecret = clientSecret;

/** La boîte connectée de cette adresse, ou null. */
export async function connectedCreatorBox(sb: SupabaseClient, email: string): Promise<CreatorBoxRow | null> {
  const e = normEmail(email);
  if (!e) return null;
  const { data, error } = await sb.from("creator_mail_boxes").select("*").eq("email", e).maybeSingle<CreatorBoxRow>();
  if (error || !data || !data.connected || !data.refresh_token) return null;
  return data;
}

/** Les boîtes de créateurs connues (connectées ou non). Table absente : liste vide. */
export async function listCreatorBoxes(sb: SupabaseClient): Promise<CreatorBoxRow[]> {
  const { data, error } = await sb.from("creator_mail_boxes").select("*").order("creator");
  return error ? [] : ((data ?? []) as CreatorBoxRow[]);
}

/** Jeton d'accès Gmail d'une boîte de créateur (rafraîchi si besoin). */
export async function creatorBoxToken(sb: SupabaseClient, email: string): Promise<string> {
  const row = await connectedCreatorBox(sb, email);
  if (!row) throw new Error("boite_createur_non_connectee");
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - 120_000 > Date.now()) return row.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token", refresh_token: row.refresh_token ?? "" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    // Accès retiré par le créateur (ou jeton périmé) : la boîte est marquée déconnectée.
    if (j?.error === "invalid_grant") {
      await sb.from("creator_mail_boxes").update({ connected: false, last_error: "invalid_grant" }).eq("email", row.email);
      throw new Error("boite_createur_non_connectee");
    }
    throw new Error(`boite_createur_jeton:${j?.error ?? res.status}`);
  }
  await sb.from("creator_mail_boxes").update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString(),
    last_error: null,
  }).eq("email", row.email);
  return j.access_token as string;
}

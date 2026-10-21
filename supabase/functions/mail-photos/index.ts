// ============================================================================
// mail-photos/index.ts : photos de profil Google des expéditeurs (page Mails).
// ----------------------------------------------------------------------------
// Gmail affiche la photo d'un correspondant ; l'API Gmail, elle, ne la donne pas. On la
// prend dans l'API People : « Autres contacts » (toutes les personnes avec qui la boîte
// a échangé) + contacts enregistrés, pour les DEUX boîtes :
//   • partnerships@ : connexion Google de l'app (droits contacts.other.readonly et
//     contacts.readonly, demandés par google-connect-url : il faut RECONNECTER Google) ;
//   • talent@ : compte de service, les mêmes droits ajoutés à sa délégation dans
//     admin.google.com.
// Sans ces droits (ou API People désactivée), la fonction répond simplement sans photo :
// l'app garde les logos et les initiales.
// Entrée : { emails: string[] } (200 max). Sortie : { ok, photos: { email: url }, boxes }.
// Agence seulement. Cache mémoire 6 h par boîte (une seule lecture People par instance).
// ============================================================================

import { corsHeaders, getAccessToken, getServiceClient } from "../_shared/google.ts";
import { serviceAccountToken, talentAddress } from "../_shared/gmailBox.ts";
import { photoMapFrom, requestedEmails, type PeoplePerson } from "../_shared/peoplePhotos.ts";

const PEOPLE = "https://people.googleapis.com/v1";
const TTL = 6 * 3600_000;
const OTHER_SCOPE = "https://www.googleapis.com/auth/contacts.other.readonly";
type Box = "partnerships" | "talent";
type BoxState = "ok" | "droit_manquant" | "erreur" | "non_configure";
const cache = new Map<Box, { at: number; map: Map<string, string>; state: BoxState }>();

async function isAgency(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return prof?.role === "agency";
}

async function pages(token: string, first: string, key: "otherContacts" | "connections"): Promise<PeoplePerson[] | "droit_manquant"> {
  const out: PeoplePerson[] = [];
  let url = first;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 403 || r.status === 401) return "droit_manquant";
    if (!r.ok) throw new Error(`people_${r.status}`);
    const j = await r.json() as Record<string, unknown> & { nextPageToken?: string };
    out.push(...((j[key] as PeoplePerson[] | undefined) ?? []));
    if (!j.nextPageToken) break;
    url = `${first}&pageToken=${encodeURIComponent(j.nextPageToken)}`;
  }
  return out;
}

async function boxPhotos(sb: ReturnType<typeof getServiceClient>, box: Box) {
  const hit = cache.get(box);
  if (hit && Date.now() - hit.at < TTL) return hit;
  let state: BoxState = "ok";
  let map = new Map<string, string>();
  try {
    if (box === "talent" && !talentAddress()) state = "non_configure";
    else {
      const token = box === "talent" ? await serviceAccountToken(OTHER_SCOPE) : await getAccessToken(sb);
      const other = await pages(token, `${PEOPLE}/otherContacts?readMask=emailAddresses,photos&pageSize=1000`, "otherContacts");
      // Contacts enregistrés : en plus, s'ils sont lisibles (droit contacts.readonly).
      const saved = await pages(token, `${PEOPLE}/people/me/connections?personFields=emailAddresses,photos&pageSize=1000`, "connections").catch(() => [] as PeoplePerson[]);
      if (other === "droit_manquant") state = "droit_manquant";
      else map = photoMapFrom([...other, ...(saved === "droit_manquant" ? [] : saved)]);
    }
  } catch (e) {
    state = /droit_manquant|unauthorized_client/.test(String((e as Error)?.message)) ? "droit_manquant" : "erreur";
  }
  const entry = { at: Date.now(), map, state };
  // Un échec n'est gardé que 10 min (un droit accordé entre-temps est vite pris en compte).
  cache.set(box, state === "ok" ? entry : { ...entry, at: Date.now() - TTL + 600_000 });
  return entry;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return json({ error: "unauthorized" }, 401);
  let body: { emails?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const emails = requestedEmails(body.emails);
  const [p, t] = await Promise.all([boxPhotos(sb, "partnerships"), boxPhotos(sb, "talent")]);
  const photos: Record<string, string> = {};
  for (const e of emails) {
    const url = p.map.get(e) ?? t.map.get(e);
    if (url) photos[e] = url;
  }
  return json({ ok: true, photos, boxes: { partnerships: p.state, talent: t.state } });
});

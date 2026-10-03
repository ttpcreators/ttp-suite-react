import { supabase } from "@/lib/supabase";

/*
 * Équipe agence (Marc, Gianni…) : prénom de la personne connectée et
 * notifications « qui fait quoi ».
 *
 * La TRACE est écrite par la base elle-même (déclencheur → table agency_activity) :
 * l'app ne peut ni l'oublier ni la fausser. L'app se contente, après une action,
 * de demander à la fonction serveur de prévenir les AUTRES comptes de l'agence.
 */

/** Tables dont les actions sont notées dans le journal de l'équipe. */
const TRACKED = new Set([
  "todos", "todo_routines", "ideas", "events", "contacts", "creators", "collabs",
  "briefs", "invoices", "documents", "gifting", "creator_pool", "prospects",
]);
/** Modifications notées (les autres, comme un simple déplacement, ne le sont pas). */
const TRACKED_KEYS = ["status", "step", "done", "done_log", "deleted"];

let teamUid: string | null = null;
/** Appelé au chargement du profil : seule une session agence prévient l'équipe. */
export function setTeamSession(uid: string | null) {
  teamUid = uid;
  myName = null;
}

let pokeTimer: number | null = null;
/** Après une action : prévient l'équipe (actions rapprochées regroupées en une notification). */
export function pokeTeam(table: string, patch?: Record<string, unknown>) {
  if (!teamUid || !TRACKED.has(table)) return;
  if (patch && !TRACKED_KEYS.some((k) => k in patch)) return;
  if (pokeTimer) window.clearTimeout(pokeTimer);
  pokeTimer = window.setTimeout(() => {
    pokeTimer = null;
    supabase.functions.invoke("team-notify", { body: {} }).catch(() => {});
  }, 4000);
}

/** Prénom deviné depuis l'adresse : « gianni.valter@… » → « Gianni ». */
export function guessName(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (/gianni/i.test(local)) return "Gianni";
  if (/marc/i.test(local)) return "Marc";
  const first = local.split(/[._\-+0-9]/).find(Boolean) ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "";
}

let myName: string | null = null;
const nameListeners = new Set<() => void>();
/** Prévenu quand le prénom de la personne connectée change (barre de gauche). */
export function onMyNameChange(fn: () => void): () => void {
  nameListeners.add(fn);
  return () => {
    nameListeners.delete(fn);
  };
}
const nameChanged = () => {
  for (const fn of nameListeners) fn();
};

/** Prénom de la personne connectée (Paramètres → Ton prénom, sinon deviné depuis l'adresse). */
export async function myDisplayName(): Promise<string> {
  if (myName) return myName;
  const { data: s } = await supabase.auth.getSession();
  const u = s.session?.user;
  if (!u) return "";
  const { data } = await supabase.from("profiles").select("*").eq("user_id", u.id).maybeSingle();
  const dn = String((data as { display_name?: string | null } | null)?.display_name ?? "").trim();
  myName = dn || guessName(u.email ?? "") || "Agence";
  return myName;
}

/** Enregistre son prénom (affiché dans le journal et les notifications de l'équipe). */
export async function saveMyDisplayName(name: string): Promise<boolean> {
  const { error } = await supabase.rpc("set_my_display_name", { name: name.trim() });
  if (error) return false;
  myName = name.trim() || null;
  nameChanged();
  return true;
}

/**
 * Fondateur : change le nom affiché de n'importe quel compte agence.
 * Renvoie "ok", "sql" (SQL « nom fondateur » pas encore lancé) ou "erreur".
 */
export async function saveAgencyName(userId: string, name: string): Promise<"ok" | "sql" | "erreur"> {
  const { error } = await supabase.rpc("set_agency_display_name", { target: userId, name: name.trim() });
  if (error) return /set_agency_display_name|function|schema cache/i.test(error.message) ? "sql" : "erreur";
  if (userId === teamUid) {
    myName = name.trim() || null;
    nameChanged();
  }
  return "ok";
}

/** Prénoms connus des comptes agence (user_id → prénom), pour afficher le journal. */
export async function teamNames(): Promise<Map<string, string>> {
  const { data } = await supabase.from("profiles").select("*").eq("role", "agency");
  const m = new Map<string, string>();
  for (const p of (data ?? []) as { user_id: string; display_name?: string | null }[]) {
    if (p.display_name?.trim()) m.set(p.user_id, p.display_name.trim());
  }
  return m;
}

export type AgencyActivity = {
  id: string; actor_id: string | null; actor_name: string | null; verb: string; entity: string;
  label: string; detail: string | null; creator: string | null; created_at: string;
};

import { supabase } from "@/lib/supabase";
import { isMissingFunction } from "@/lib/appState";
import { lireConnexion, prenom, trierConnexions, type ConnexionClaude } from "../../supabase/functions/_shared/connexionsClaude.ts";

/**
 * Connexions du connecteur Claude de toute l'agence (fondateurs) : Paramètres › Connexions
 * Claude et page Agents (qui a fait une proposition). Tout passe par les fonctions SQL
 * réservées aux fondateurs connexions_claude() et connexion_claude_regler() (SECURITY
 * DEFINER, SQL 2026-11-27-verrou-connexions) : jamais d'accès direct aux connexions d'un autre
 * compte ni aux jetons. Avant ce SQL, rien ne s'affiche et rien ne casse. Logique pure :
 * supabase/functions/_shared/connexionsClaude.ts.
 */

export type LectureConnexions =
  | { etat: "ok"; liste: ConnexionClaude[] }
  /** Fonction SQL pas encore créée. */
  | { etat: "sql" }
  | { etat: "erreur"; message: string };

export async function lireConnexionsClaude(): Promise<LectureConnexions> {
  const { data, error } = await supabase.rpc("connexions_claude");
  if (error) return isMissingFunction(error) ? { etat: "sql" } : { etat: "erreur", message: error.message };
  const liste = ((data as unknown[] | null) ?? []).map(lireConnexion).filter((c): c is ConnexionClaude => !!c);
  return { etat: "ok", liste: trierConnexions(liste) };
}

/** Un réglage : case « agent autonome », valideur (null = tout fondateur), ou couper la connexion. */
export type ReglageConnexion = { agent: boolean } | { valideur: string | null } | { couper: true };

/** Applique un réglage (fondateurs, noté dans le journal des agents). null = fait ; sinon le message à montrer. */
export async function reglerConnexionClaude(id: string, reglage: ReglageConnexion): Promise<string | null> {
  const { error } = await supabase.rpc("connexion_claude_regler", { p_id: id, p_reglage: reglage });
  if (!error) return null;
  if (isMissingFunction(error)) return "Pas encore activé : une mise à jour est en attente.";
  if (error.code === "42501") return "Réservé aux fondateurs.";
  return error.message || "Erreur, réessaie";
}

/** Les comptes fondateurs, valideurs possibles d'une connexion d'agent (prénom affiché). */
export async function lireFondateurs(): Promise<{ id: string; nom: string }[]> {
  const { data, error } = await supabase.from("profiles").select("user_id, display_name, agency_role").eq("role", "agency");
  if (error) return [];
  return ((data as { user_id: string; display_name: string | null; agency_role: string | null }[] | null) ?? [])
    .filter((p) => p.agency_role === "founder")
    .map((p) => ({ id: p.user_id, nom: prenom(p.display_name) }));
}

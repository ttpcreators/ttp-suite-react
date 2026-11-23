import { supabase } from "./supabase";
import { isDuplicatePost, POST_COLS, postPlatform, postsTableMissing, type CollabPost, type PostMetric } from "./collabPosts";

/*
 * Accès base des posts déclarés par le créateur (logique pure : collabPosts.ts).
 * Avant le SQL 2026-11-23-espace-createur-collab.sql la table n'existe pas : la lecture
 * renvoie `missing` et l'app cache les boutons.
 */

export type PostsLoad = { posts: CollabPost[]; missing: boolean; error: boolean };

/** Posts d'un créateur (espace créateur) ou d'une collab (fiche collab agence). */
export async function loadCollabPosts(by: { creator?: string; collabId?: string }): Promise<PostsLoad> {
  let q = supabase.from("collab_posts").select(POST_COLS).order("created_at", { ascending: true });
  if (by.collabId) q = q.eq("collab_id", by.collabId);
  else if (by.creator) q = q.eq("creator", by.creator);
  const { data, error } = await q;
  if (error) return { posts: [], missing: postsTableMissing(error), error: !postsTableMissing(error) };
  return { posts: (data as CollabPost[] | null) ?? [], missing: false, error: false };
}

export type PostWrite = { ok: true; post: CollabPost } | { ok: false; reason: "missing" | "duplicate" | "error" };

/** Lien du post publié (le serveur fait passer la collab à l'étape 6). */
export async function addCollabPost(collabId: string, creator: string, url: string): Promise<PostWrite> {
  const { data, error } = await supabase
    .from("collab_posts")
    .insert({ collab_id: collabId, creator, url, platform: postPlatform(url) })
    .select(POST_COLS)
    .maybeSingle();
  if (error) return { ok: false, reason: postsTableMissing(error) ? "missing" : isDuplicatePost(error) ? "duplicate" : "error" };
  return data ? { ok: true, post: data as CollabPost } : { ok: false, reason: "error" };
}

/** Stats à 7 jours (le serveur date l'envoi et fait passer la collab à l'étape 7). */
export async function saveCollabPostStats(id: string, stats: Record<PostMetric, number | null>, capturePath?: string | null): Promise<PostWrite> {
  const patch: Record<string, unknown> = { ...stats };
  if (capturePath !== undefined) patch.capture_path = capturePath;
  const { data, error } = await supabase.from("collab_posts").update(patch).eq("id", id).select(POST_COLS).maybeSingle();
  if (error) return { ok: false, reason: postsTableMissing(error) ? "missing" : "error" };
  return data ? { ok: true, post: data as CollabPost } : { ok: false, reason: "error" };
}

/** Retire un lien envoyé par erreur. */
export async function deleteCollabPost(id: string): Promise<boolean> {
  const { data, error } = await supabase.from("collab_posts").delete().eq("id", id).select("id");
  return !error && (data?.length ?? 0) > 0;
}

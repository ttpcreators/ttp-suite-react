// ============================================================================
// _shared/igMedia.ts : photos, vidéos, vocaux et partages des DM Instagram.
// Meta ne met pas ces contenus dans le texte du message : ils sont dans `attachments`,
// `shares`, `story` et `sticker`. Leurs adresses Meta expirent : ig-inbox recopie les
// fichiers dans le stockage de l'app (bucket privé « ig-media »). Règles PURES, testées.
// ============================================================================

export type DmMedia = {
  kind: "image" | "video" | "audio" | "file" | "share" | "story" | "sticker";
  /** Adresse Meta (temporaire) d'un fichier à recopier. */
  src?: string;
  /** Fichier recopié dans le bucket « ig-media ». */
  path?: string;
  /** Lien à ouvrir (post ou reel partagé, story). */
  link?: string;
  name?: string;
};

type J = Record<string, unknown>;
const o = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const s = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): J[] => (Array.isArray(o(v).data) ? (o(v).data as J[]) : Array.isArray(v) ? (v as J[]) : []);

/** Contenus d'un message tel que renvoyé par l'API Graph (champs attachments, shares, story, sticker). */
export function mediaFromMessage(m: J): DmMedia[] {
  const out: DmMedia[] = [];
  for (const a of list(m.attachments)) {
    const img = o(a.image_data);
    const vid = o(a.video_data);
    const mime = s(a.mime_type);
    if (s(vid.url)) out.push({ kind: "video", src: s(vid.url) });
    else if (s(img.url)) out.push({ kind: "image", src: s(img.animated_gif_url) || s(img.url) });
    else if (s(a.file_url)) out.push({ kind: mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "file", src: s(a.file_url), name: s(a.name) || undefined });
  }
  for (const sh of list(m.shares)) {
    const link = s(sh.link);
    if (link) out.push({ kind: "share", link, name: s(sh.name) || s(sh.description) || undefined });
  }
  const story = o(m.story);
  const reply = s(o(story.reply_to).link);
  const mention = s(o(story.mention).link);
  if (reply) out.push({ kind: "story", link: reply, name: "Réponse à ta story" });
  else if (mention) out.push({ kind: "story", link: mention, name: "T'a mentionné en story" });
  if (s(m.sticker)) out.push({ kind: "sticker", src: s(m.sticker) });
  return out;
}

/** Adresse de fichier Meta acceptée (jamais un autre site). */
export function metaFileUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return /(^|\.)(cdninstagram\.com|fbcdn\.net|fbsbx\.com)$/.test(h);
  } catch {
    return false;
  }
}

/** Extension du fichier recopié, d'après son type. */
export function extFor(type: string): string {
  const t = type.split(";")[0].trim().toLowerCase();
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav" } as Record<string, string>)[t] ?? "bin";
}

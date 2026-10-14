import { useEffect, useState } from "react";
import { cn, initials } from "@/lib/utils";

/** Pastel stable par nom pour les initiales (pas le rouge, réservé à l'urgent). */
const TONES = [
  "bg-status-brief-bg text-status-brief",
  "bg-status-prog-bg text-status-prog",
  "bg-status-pos-bg text-status-pos",
  "bg-status-wait-bg text-status-wait",
];
export function initialsTone(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/**
 * Avatar créateur en lecture seule avec fallback robuste : si `photoUrl` est
 * vide OU si l'image ne charge pas (ex. ancienne URL de stockage bloquée en
 * 402), on affiche proprement les initiales au lieu d'une image cassée.
 */
export function CreatorAvatar({
  name,
  photoUrl,
  className,
  alt,
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
  alt?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photoUrl]);

  if (!photoUrl || broken) {
    return (
      <div className={cn("grid place-items-center font-semibold", initialsTone(name), className)}>
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      src={photoUrl}
      alt={alt ?? name}
      onError={() => setBroken(true)}
      className={cn("object-cover", className)}
    />
  );
}

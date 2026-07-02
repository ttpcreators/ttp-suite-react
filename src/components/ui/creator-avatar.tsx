import { useEffect, useState } from "react";
import { cn, initials } from "@/lib/utils";

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
      <div className={cn("grid place-items-center bg-muted font-semibold text-muted-foreground", className)}>
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

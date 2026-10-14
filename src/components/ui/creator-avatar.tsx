import { useEffect, useState } from "react";
import { cn, initials } from "@/lib/utils";


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

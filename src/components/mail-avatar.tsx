import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { emailOf, letterColor, resolveAvatar, type Avatar } from "@/lib/mailAvatar";

const SIZES = { sm: "h-8 w-8 text-[12px]", md: "h-9 w-9 text-[13px]", lg: "h-10 w-10 text-[14px]" } as const;

/**
 * Photo de profil d'un expéditeur, comme dans Gmail : photo de la créatrice,
 * logo TTP, photo Gravatar, logo de la marque, sinon lettre en couleur.
 * L'image n'est cherchée qu'une fois la pastille visible à l'écran.
 */
export function MailAvatar({
  name, email, agency, size = "md", className,
}: {
  name: string; email?: string | null; agency?: boolean; size?: keyof typeof SIZES; className?: string;
}) {
  const addr = emailOf(email);
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [found, setFound] = useState<{ key: string; avatar: Avatar } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const key = `${agency ? "a" : ""}:${addr}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || (!addr && !agency)) return;
    let alive = true;
    void resolveAvatar(addr, !!agency).then((avatar) => alive && setFound({ key, avatar }));
    return () => {
      alive = false;
    };
  }, [visible, addr, agency, key]);

  const avatar = found?.key === key ? found.avatar : null;
  const label = (name || addr).trim();
  const base = cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full", SIZES[size], className);

  if (avatar && broken !== avatar.url) {
    return (
      <span ref={ref} className={cn(base, avatar.kind === "logo" ? "bg-white ring-1 ring-black/[0.06]" : "bg-muted")}>
        <img
          src={avatar.url}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          draggable={false}
          onError={() => setBroken(avatar.url)}
          className={cn("h-full w-full", avatar.kind === "logo" ? "object-contain p-[3px]" : "object-cover")}
        />
      </span>
    );
  }
  return (
    <span ref={ref} aria-hidden className={cn(base, "font-semibold uppercase text-white")} style={{ backgroundColor: letterColor(addr || label || "?") }}>
      {label.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0) || "?"}
    </span>
  );
}

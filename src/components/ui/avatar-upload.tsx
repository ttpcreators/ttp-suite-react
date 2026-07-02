import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbUpdate } from "@/lib/db";
import { invalidateCreators } from "@/lib/useCreators";
import { initials } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Photo de profil éditable. Upload dans le bucket `avatars` (public) puis écrit
 * l'URL dans `creators.photo_url`. Comme l'agence ET le portail lisent ce même
 * champ, la nouvelle photo apparaît partout (cross-device) au prochain
 * rafraîchissement. Fallback initiales si l'image ne charge pas (ancienne URL
 * 402). Accessible au clavier (Entrée/Espace) quand éditable.
 */
export function AvatarUpload({
  creatorId,
  name,
  photoUrl,
  size = 56,
  rounded = "rounded-2xl",
  editable = true,
  onUploaded,
}: {
  creatorId: string | undefined;
  name: string;
  photoUrl: string | null;
  size?: number;
  rounded?: string;
  editable?: boolean;
  onUploaded?: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photoUrl]);

  const interactive = editable && !!creatorId;
  const pick = () => {
    if (!busy && interactive) inputRef.current?.click();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-choisir le même fichier
    if (!file || !creatorId) return;
    if (!file.type.startsWith("image/")) {
      toast("Choisis une image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("Image trop lourde (max 5 Mo)");
      return;
    }
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${slug(name) || "creator"}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
    if (upErr) {
      setBusy(false);
      toast("Échec de l'upload — réessaie");
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = data.publicUrl;
    const ok = await dbUpdate("creators", creatorId, { photo_url: url });
    setBusy(false);
    if (!ok) {
      toast("Photo envoyée mais non enregistrée");
      return;
    }
    setBroken(false);
    invalidateCreators();
    onUploaded?.(url);
    toast("Photo mise à jour ✓");
  };

  const px = { width: size, height: size };
  return (
    <div
      className={"group relative shrink-0 " + (interactive ? "cursor-pointer" : "")}
      style={px}
      onClick={pick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Changer la photo de ${name}` : undefined}
      aria-busy={busy || undefined}
      onKeyDown={
        interactive
          ? (ev: KeyboardEvent) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                pick();
              }
            }
          : undefined
      }
    >
      {photoUrl && !broken ? (
        <img
          src={photoUrl}
          alt={name}
          onError={() => setBroken(true)}
          className={"h-full w-full object-cover " + rounded}
          style={px}
        />
      ) : (
        <div
          className={"grid h-full w-full place-items-center bg-muted font-semibold text-muted-foreground " + rounded}
          style={px}
        >
          {initials(name)}
        </div>
      )}
      {interactive && (
        <div
          className={
            "absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 " +
            rounded +
            (busy ? " opacity-100" : "")
          }
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-[18px] w-[18px]" />}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" aria-label="Fichier photo" onChange={onFile} className="hidden" />
    </div>
  );
}

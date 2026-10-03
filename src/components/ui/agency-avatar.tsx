import { useRef, useState, type ChangeEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { useMyName } from "@/lib/useMyName";
import { toast } from "@/components/ui/toast";
import { downscaleImage } from "@/components/ui/image-field";

const BASE = import.meta.env.BASE_URL;

/**
 * Photo de profil PAR UTILISATEUR (chaque accès personnalise la sienne). Upload
 * dans le bucket `avatars` (public), URL enregistrée dans le blob app_state sous
 * la clé `avatar:<userId>` (atomique → pas de conflit entre membres). Repli : la
 * photo agence historique (`agencyPhoto`), puis le logo TTP. Sans `userId`, on
 * retombe sur l'ancien comportement partagé (`agencyPhoto`).
 */
export function AgencyAvatar({
  userId,
  className = "h-8 w-8",
  rounded = "rounded-lg",
  readOnly = false,
}: {
  userId?: string;
  className?: string;
  rounded?: string;
  /** Affichage seul (pas d'upload au clic) : pour un avatar posé DANS un bouton. */
  readOnly?: boolean;
}) {
  const key = userId ? `avatar:${userId}` : "agencyPhoto";
  const { data: saved } = useAppState<string | null>((s: AppState) => (s[key] as string) ?? (s["agencyPhoto"] as string) ?? null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const url = localUrl ?? saved ?? null;

  if (readOnly) {
    return (
      <div className={`shrink-0 overflow-hidden bg-[#14181E] ${className} ${rounded}`}>
        <img
          src={url && !broken ? url : `${BASE}cover.png`}
          alt={url && !broken ? "Profil" : "TTP"}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      toast("Choisis une image");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast("Image trop lourde (max 25 Mo)");
      return;
    }
    setBusy(true);
    // Photo réduite en JPEG 800 px (photos d'iPhone lourdes ou en HEIC) ; repli : le fichier tel quel.
    let blob: Blob = file;
    let ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    let contentType = file.type || "image/jpeg";
    try {
      blob = await downscaleImage(file, 800, "image/jpeg", 0.88);
      ext = "jpg";
      contentType = "image/jpeg";
    } catch {
      /* fichier d'origine */
    }
    const path = `${userId ? `user/${userId}` : "agency"}/${Date.now()}.${ext}`;
    // Chemin horodaté = toujours unique → INSERT pur (upsert:false) : « remplacer »
    // (upsert) exige un droit de lecture que le bucket n'accorde pas, d'où l'échec.
    const { error } = await supabase.storage.from("avatars").upload(path, blob, { upsert: false, cacheControl: "3600", contentType });
    if (error) {
      setBusy(false);
      console.warn("[avatar agence] upload", error);
      toast(`Échec de l'upload : ${(error.message || "réessaie").slice(0, 80)}`);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setBroken(false);
    setLocalUrl(data.publicUrl);
    const ok = await saveAppStateKey(key, data.publicUrl);
    setBusy(false);
    toast(ok ? "Photo de profil mise à jour ✓" : "Photo envoyée mais non enregistrée");
  };

  return (
    <div
      className={`group relative shrink-0 cursor-pointer overflow-hidden bg-[#14181E] ${className} ${rounded}`}
      onClick={() => !busy && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Changer la photo de profil"
      title="Changer la photo de profil"
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          if (!busy) inputRef.current?.click();
        }
      }}
    >
      {url && !broken ? (
        <img src={url} alt="Profil" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
      )}
      <div className={`absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100${busy ? " opacity-100" : ""}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
      </div>
      <input ref={inputRef} type="file" accept="image/*" aria-label="Fichier photo" onChange={onFile} className="hidden" />
    </div>
  );
}

/** Prénom de la personne connectée, en texte (pour les endroits sans hook, comme App). */
export function MyName({ userId, fallback }: { userId?: string; fallback: string }) {
  const name = useMyName(userId);
  return <>{name || fallback}</>;
}

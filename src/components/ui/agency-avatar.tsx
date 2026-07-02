import { useRef, useState, type ChangeEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";

const BASE = import.meta.env.BASE_URL;

/**
 * Photo de profil de la direction (agence). Upload dans le bucket `avatars`
 * (public) puis URL enregistrée dans le blob app_state `agencyPhoto` — donc
 * synchronisée sur tous les appareils (mobile + ordinateur). Fallback : logo TTP.
 */
export function AgencyAvatar({ className = "h-8 w-8", rounded = "rounded-lg" }: { className?: string; rounded?: string }) {
  const { data: saved } = useAppState<string | null>((s: AppState) => (s["agencyPhoto"] as string) ?? null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const url = localUrl ?? saved ?? null;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
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
    const path = `agency/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
    if (error) {
      setBusy(false);
      toast("Échec de l'upload — réessaie");
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setBroken(false);
    setLocalUrl(data.publicUrl);
    const ok = await saveAppStateKey("agencyPhoto", data.publicUrl);
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

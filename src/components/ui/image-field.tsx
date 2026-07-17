import { useRef, useState, type ChangeEvent } from "react";
import { Trash2, Camera, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";

/**
 * Champ image réutilisable (media kit créatrice ET media kit agence). Upload dans
 * le bucket public `avatars` (chemin `mediakit/<slug>/…`), renvoie l'URL publique
 * via onChange. Le blob qui référence l'URL est persisté au clic « Enregistrer » de
 * l'écran appelant. `kind="logo"` → PNG (transparence conservée) ; sinon JPEG.
 */

const LBL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint";

/** Charge un fichier image dans un <img> (respecte l'orientation EXIF sur les
 *  navigateurs modernes, y compris Safari iOS). */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error("load"));
    };
    img.src = objUrl;
  });
}

/** Redimensionne (côté le plus long ≤ maxDim) puis réencode l'image → Blob léger.
 *  Réduit ~5–10× le poids (2 Mo → ~200–400 Ko) : pages rapides + free tier Supabase
 *  préservé. Convertit aussi les HEIC iPhone en JPEG au passage. */
export async function downscaleImage(file: File, maxDim: number, mime: string, quality?: number): Promise<Blob> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) {
    URL.revokeObjectURL(img.src);
    throw new Error("dims");
  }
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(img.src);
    throw new Error("ctx");
  }
  ctx.drawImage(img, 0, 0, cw, ch);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality));
  if (!blob) throw new Error("encode");
  return blob;
}

export function ImageField({
  label,
  slug,
  field,
  url,
  onChange,
  boxClass = "h-20 w-16",
  kind = "photo",
}: {
  label: string;
  slug: string;
  field: string;
  url?: string | null;
  onChange: (url: string | null) => void;
  boxClass?: string;
  kind?: "photo" | "logo";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) return toast("Choisis une image");
    if (file.size > 12 * 1024 * 1024) return toast("Image trop lourde (max 12 Mo)");
    setBusy(true);
    // Compression fail-safe : logo → PNG 512px, photo/capture → JPEG 1600px.
    // Si le réencodage échoue (format exotique, canvas indispo), on uploade l'original.
    let blob: Blob = file;
    let ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    let contentType = file.type || "image/jpeg";
    try {
      if (kind === "logo") {
        blob = await downscaleImage(file, 512, "image/png");
        ext = "png";
        contentType = "image/png";
      } else {
        blob = await downscaleImage(file, 1600, "image/jpeg", 0.88);
        ext = "jpg";
        contentType = "image/jpeg";
      }
    } catch {
      blob = file; // repli : fichier d'origine tel quel
    }
    const s = (slug || "creator").replace(/[^a-z0-9-]/g, "") || "creator";
    const path = `mediakit/${s}/${field}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, blob, { upsert: false, cacheControl: "3600", contentType });
    setBusy(false);
    if (error) return toast("Échec de l'upload — réessaie");
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    onChange(data.publicUrl);
    toast("Image ajoutée ✓ — pense à Enregistrer");
  };
  return (
    <div>
      {label ? <label className={LBL}>{label}</label> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          className={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-surface text-faint transition-colors hover:border-primary hover:text-primary ${boxClass}`}
        >
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
        </button>
        {url ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
    </div>
  );
}

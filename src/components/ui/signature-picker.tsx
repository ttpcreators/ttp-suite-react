import { useEffect, useRef } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMailSignatures, type MailSignature } from "@/lib/useMailSignatures";

/**
 * Choix de la signature image d'un email. Se remonte via `key` à chaque
 * ouverture de modale pour re-présélectionner la signature par défaut.
 */
export function SignaturePicker({
  value,
  onChange,
}: {
  value: MailSignature | null;
  onChange: (s: MailSignature | null) => void;
}) {
  const { list, defaultId, busy, add, remove, setDefault } = useMailSignatures();
  const fileRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);

  // Présélectionne la signature par défaut à l'ouverture (si rien de choisi).
  useEffect(() => {
    if (seeded.current || value) return;
    const d = list.find((s) => s.id === defaultId);
    if (d) {
      seeded.current = true;
      onChange(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, defaultId]);

  const onFile = async (f: File) => {
    const created = await add(f, f.name.replace(/\.[^.]+$/, ""));
    if (created) onChange(created);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "grid h-14 min-w-[60px] place-items-center rounded-lg border px-3 text-[11px] font-medium transition-colors",
            value === null ? "border-primary text-foreground ring-1 ring-primary" : "border-border text-muted-foreground hover:bg-rowhover",
          )}
        >
          Aucune
        </button>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s)}
            title={s.name}
            className={cn(
              "relative grid h-14 w-24 place-items-center overflow-hidden rounded-lg border bg-white p-1 transition-colors",
              value?.id === s.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-rowhover",
            )}
          >
            <img src={s.url} alt={s.name} className="max-h-full max-w-full object-contain" />
            {defaultId === s.id && (
              <span className="absolute right-0.5 top-0.5 rounded bg-primary px-1 text-[7px] font-bold uppercase text-primary-foreground">déf.</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Ajouter une signature (PNG/JPEG)"
          className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-border text-faint transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
        >
          {busy ? "…" : <Plus className="h-4 w-4" />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {value && (
        <div className="flex items-center gap-3 text-[10px] text-faint">
          {defaultId !== value.id && (
            <button type="button" onClick={() => setDefault(value.id)} className="inline-flex items-center gap-1 hover:text-foreground">
              <Star className="h-3 w-3" /> Définir par défaut
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              remove(value.id);
              onChange(null);
            }}
            className="inline-flex items-center gap-1 text-[#E5484D] hover:underline"
          >
            <Trash2 className="h-3 w-3" /> Supprimer cette signature
          </button>
        </div>
      )}
    </div>
  );
}

import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { ATTACH_MAX_BYTES, ATTACH_MAX_LABEL, type OutAttachment } from "@/lib/mailSend";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/**
 * Garde seulement les fichiers qui tiennent sous la limite (18 Mo bruts au total,
 * comme Gmail côté serveur) ; prévient pour les autres.
 */
function withinLimit(list: FileList, total: number): FileList {
  let sum = total;
  const keep = new DataTransfer();
  for (const f of Array.from(list)) {
    if (sum + f.size > ATTACH_MAX_BYTES) {
      toast(`« ${f.name} » dépasse la limite de ${ATTACH_MAX_LABEL} au total`);
      continue;
    }
    sum += f.size;
    keep.items.add(f);
  }
  return keep.files;
}

/**
 * Bouton trombone : ouvre le sélecteur de fichiers (plusieurs à la fois).
 * `total` (octets déjà joints) : les fichiers au-delà de la limite sont écartés ici.
 */
export function AttachButton({ onFiles, label = "Joindre", className, total }: { onFiles: (f: FileList | null) => void; label?: string; className?: string; total?: number }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn("flex items-center gap-1 font-medium hover:text-foreground", className)}
      >
        <Paperclip className="h-3.5 w-3.5" /> {label}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          let picked: FileList | null = files;
          if (files && total != null && typeof DataTransfer !== "undefined") {
            try {
              picked = withinLimit(files, total);
            } catch {
              picked = files; // DataTransfer indisponible : la limite reste vérifiée à l'ajout
            }
          }
          onFiles(picked);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Fichiers joints, chacun retirable. */
export function AttachChips({ files, onRemove }: { files: OutAttachment[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span key={`${f.filename}-${i}`} className="flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/50 py-1 pl-2.5 pr-1 text-[12px]">
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium text-foreground">{f.filename}</span>
          <span className="shrink-0 text-faint">{fmtSize(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Retirer ${f.filename}`} className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

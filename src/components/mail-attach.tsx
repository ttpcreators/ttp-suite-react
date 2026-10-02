import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OutAttachment } from "@/lib/mailSend";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Bouton trombone : ouvre le sélecteur de fichiers (plusieurs à la fois). */
export function AttachButton({ onFiles, label = "Joindre", className }: { onFiles: (f: FileList | null) => void; label?: string; className?: string }) {
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
          onFiles(e.target.files);
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

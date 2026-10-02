import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { ATTACH_MAX_BYTES, readAttachment, type OutAttachment } from "@/lib/mailSend";

/** Pièces jointes d'un mail en cours d'écriture (20 Mo au total). */
export function useAttachments() {
  const [files, setFiles] = useState<OutAttachment[]>([]);
  const total = files.reduce((n, f) => n + f.size, 0);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    let sum = total;
    const next: OutAttachment[] = [];
    for (const f of Array.from(list)) {
      if (sum + f.size > ATTACH_MAX_BYTES) {
        toast(`« ${f.name} » dépasse la limite de 20 Mo au total`);
        continue;
      }
      try {
        next.push(await readAttachment(f));
        sum += f.size;
      } catch {
        toast(`Impossible de lire « ${f.name} »`);
      }
    }
    if (next.length) setFiles((cur) => [...cur, ...next]);
  };
  const remove = (i: number) => setFiles((cur) => cur.filter((_, k) => k !== i));
  const clear = () => setFiles([]);
  return { files, total, add, remove, clear, setFiles };
}

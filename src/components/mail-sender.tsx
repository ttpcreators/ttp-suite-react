import { cn } from "@/lib/utils";
import { Picker } from "@/components/ui/form";
import type { useSender } from "@/lib/useSendAs";
import { SEND_AS_HINT, type SendAs } from "../../supabase/functions/_shared/sendAs.ts";

/*
 * Menu « De : » du composeur (nouveau mail, réponse) : l'adresse principale de la boîte
 * ou un alias « Envoyer en tant que » réglé dans Gmail (ex. celui d'une créatrice).
 * Avec un alias, gmail-send revérifie l'adresse, met l'en-tête From et l'app ajoute la
 * signature Gmail de l'alias au lieu de celle de l'agence, comme Gmail.
 */

/** Liste déroulante des adresses (rien tant que la liste n'est pas lue). */
export function SenderSelect({ list, value, onChange, className }: {
  list: SendAs[]; value: string; onChange: (v: string) => void; className?: string;
}) {
  const primary = list.find((x) => x.primary) ?? list[0];
  if (!primary) return null;
  return (
    <Picker
      size="xs"
      pill
      ariaLabel="Adresse d'envoi"
      className={cn("min-w-0 max-w-[320px]", className)}
      value={value || primary.email}
      onChange={(v) => onChange(v === primary.email ? "" : v)}
      options={list.map((x) => ({ value: x.email, label: x.name && !x.primary ? `${x.name} (${x.email})` : x.email }))}
    />
  );
}

/**
 * Ligne « De : » complète. Avec des alias : le menu. Sans alias : l'adresse de la boîte en
 * clair et le conseil pour en régler un dans Gmail (rien tant que la liste n'est pas lue).
 */
export function SenderLine({ s, className, labelClassName }: {
  s: ReturnType<typeof useSender>; className?: string; labelClassName?: string;
}) {
  if (!s.list.length) {
    // Alias repris d'un brouillon, liste pas lue : visible, et on peut revenir à la boîte.
    if (!s.from || s.loading) return null;
    return (
      <div className={cn("flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground", className)}>
        <span className={cn("shrink-0", labelClassName)}>De</span>
        <span className="min-w-0 truncate">{s.from} (non vérifiée)</span>
        <button type="button" onClick={() => s.setFrom("")} className="shrink-0 font-medium hover:text-foreground">Adresse de la boîte</button>
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className={cn("shrink-0 text-[12.5px] text-muted-foreground", labelClassName)}>De</span>
      {s.aliases.length ? (
        <SenderSelect list={s.list} value={s.from} onChange={s.setFrom} />
      ) : (
        <span className="flex min-w-0 items-baseline gap-2" title={SEND_AS_HINT}>
          <span className="shrink-0 text-[12.5px] text-muted-foreground">{s.list[0].email}</span>
          <span className="min-w-0 truncate text-[11px] text-faint">{SEND_AS_HINT}</span>
        </span>
      )}
    </div>
  );
}

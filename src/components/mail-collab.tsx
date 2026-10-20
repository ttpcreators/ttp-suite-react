import { ArrowUpRight, Milestone } from "lucide-react";
import { cn, titleCase } from "@/lib/utils";
import { STEP_COUNT, stepDef } from "@/lib/collabs";
import { phaseTagCls, type CollabLite, type MailTag } from "@/lib/mailCollab";
import { CreatorAvatar } from "@/components/ui/creator-avatar";

/*
 * Page Mails (agence) : encart « Collab liée » à côté du mail ouvert et étiquettes
 * de statut sous les lignes de la liste. Rien n'est affiché sans donnée réelle.
 */

/** Petite étiquette colorée (étape de collab, statut du suivi créateur, relance). */
export function MailTagChip({ tag }: { tag: MailTag }) {
  return (
    <span title={tag.title} className={cn("inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10.5px] font-semibold leading-4", tag.cls)}>
      {tag.label}
    </span>
  );
}

/** Une collab de l'encart : Marque × Créateur, étape, cachet, livrables. */
function CollabBlock({ c, photoOf, onOpen, compact }: {
  c: CollabLite; photoOf: (name: string) => string | null; onOpen: (c: CollabLite) => void; compact?: boolean;
}) {
  const def = stepDef(c.step);
  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      <div className="flex min-w-0 items-center gap-2">
        {c.creator && <CreatorAvatar name={c.creator} photoUrl={photoOf(c.creator)} className="h-6 w-6 shrink-0 rounded-full text-[9px]" />}
        <p className="min-w-0 text-[14px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
          {c.brand}
          {c.creator && <span className="font-normal text-muted-foreground"> × </span>}
          {c.creator && titleCase(c.creator)}
        </p>
      </div>
      {c.title && !compact && <p className="text-[12px] leading-snug text-muted-foreground">{c.title}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", phaseTagCls(c.step))} title={def.label}>
          {def.short}
        </span>
        <span className="text-[11px] tabular-nums text-faint">Étape {def.n}/{STEP_COUNT}</span>
      </div>
      {(c.cachet || (c.deliverables && !compact)) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
          {c.cachet && (
            <>
              <dt className="text-muted-foreground">Cachet</dt>
              <dd className="min-w-0 font-medium tabular-nums text-foreground [overflow-wrap:anywhere]">{c.cachet}</dd>
            </>
          )}
          {c.deliverables && !compact && (
            <>
              <dt className="text-muted-foreground">Livrables</dt>
              <dd className="line-clamp-2 min-w-0 text-foreground [overflow-wrap:anywhere]">{c.deliverables}</dd>
            </>
          )}
        </dl>
      )}
      <button
        type="button"
        onClick={() => onOpen(c)}
        className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-primary underline-offset-2 hover:underline"
      >
        Ouvrir la collab <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Encart « Collab liée » : la collab active qui correspond au fil (ou les quelques
 * collabs possibles si le fil ne permet pas de trancher). Rien si aucune.
 */
export function LinkedCollabCard({ collabs, photoOf, onOpen, className }: {
  collabs: CollabLite[]; photoOf: (name: string) => string | null; onOpen: (c: CollabLite) => void; className?: string;
}) {
  if (!collabs.length) return null;
  const shown = collabs.slice(0, 3);
  const more = collabs.length - shown.length;
  return (
    <aside aria-label="Collab liée" className={cn("rounded-xl border border-border bg-muted/40 p-4 dark:bg-white/[0.03]", className)}>
      <p className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
        <Milestone className="h-3 w-3" />
        {collabs.length > 1 ? `${collabs.length} collabs possibles` : "Collab liée"}
      </p>
      <div className="flex flex-col divide-y divide-border">
        {shown.map((c, i) => (
          <div key={c.id} className={cn(i > 0 && "pt-3", i < shown.length - 1 && "pb-3")}>
            <CollabBlock c={c} photoOf={photoOf} onOpen={onOpen} compact={shown.length > 1} />
          </div>
        ))}
      </div>
      {more > 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">Et {more} autre{more > 1 ? "s" : ""} dans Collabs.</p>}
    </aside>
  );
}

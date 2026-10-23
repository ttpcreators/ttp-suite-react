import { useState } from "react";
import { SmilePlus } from "@/components/icons";
import { cn } from "@/lib/utils";
import { QUICK_REACTIONS, type ReactionPill } from "@/lib/mailReactions";

/**
 * Réactions sous un message (page Mails agence) : les pastilles déjà là (« ❤️ Julie »), puis
 * un bouton discret (sourire) qui ouvre la rangée de réactions rapides. Cibles de 44 px sur
 * téléphone (zone de toucher), plus petites à l'œil sur ordinateur.
 */
export function MailReactions({ pills, canReact, onReact }: {
  pills: ReactionPill[];
  canReact: boolean;
  onReact: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!pills.length && !canReact) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {pills.map((p) => (
        <span
          key={p.emoji}
          title={p.who}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[13px] text-foreground max-md:h-11 max-md:px-3",
            p.mine ? "border-primary/40 bg-primary/[0.08]" : "border-border bg-surface",
          )}
        >
          <span className="text-[15px] leading-none">{p.emoji}</span>
          <span className="max-w-[10rem] truncate text-muted-foreground">{p.count > 1 ? p.count : p.who}</span>
        </span>
      ))}
      {canReact && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Réagir"
            title="Réagir"
            className={cn(
              "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground max-md:h-11 max-md:w-11",
              open && "bg-rowhover text-foreground",
            )}
          >
            <SmilePlus className="h-4 w-4" />
          </button>
          {open && (
            <span role="group" aria-label="Réactions rapides" className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 shadow-sm">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onReact(e);
                  }}
                  aria-label={`Réagir avec ${e}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-[17px] leading-none transition-transform duration-200 ease-out hover:scale-110 hover:bg-rowhover active:scale-95 max-md:h-11 max-md:w-11 motion-reduce:transition-none"
                >
                  {e}
                </button>
              ))}
            </span>
          )}
        </>
      )}
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InPageHeaderContext } from "@/lib/navAction";
import { HelpTip } from "@/components/ui/help-tip";

/**
 * En-tête de page dans le langage de l'Aperçu : le titre à gauche, les actions
 * de la page (compteur, boutons, filtres de période…) à droite, sur LA MÊME ligne.
 *
 *   • `PageFrame` (posé par App autour de chaque page) rend le titre + un
 *     emplacement vide à droite, qu'il transmet par contexte ;
 *   • `PageHeaderRow` (dans chaque page) téléporte son contenu dans cet
 *     emplacement. Sans PageFrame (volet partagé, espace créateur…), il se
 *     rend simplement sur place, comme l'ancienne rangée.
 *
 * L'emplacement est posé via une ref de rappel : la mise à jour se fait pendant
 * le commit, avant l'affichage, donc aucun saut visible.
 */

const PageSlotContext = createContext<HTMLElement | null>(null);

/** `hideHead` : masque le titre sans démonter la page (ex. un échange ouvert en plein écran). */
export function PageFrame({ title, hint, hideHead, children }: { title: ReactNode; hint?: string; hideHead?: boolean; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Emplacement vide à l'écran (téléphone : ses actions sont montées dans la barre de titre) :
  // plus d'écart sous le titre, la page remonte.
  const [slotEmpty, setSlotEmpty] = useState(false);
  useEffect(() => {
    if (!slot || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSlotEmpty(slot.offsetHeight === 0));
    ro.observe(slot);
    return () => ro.disconnect();
  }, [slot]);
  return (
    <>
      <div className={hideHead ? "hidden" : `mb-4 flex flex-wrap items-center justify-between gap-x-4 md:mb-7 ${slotEmpty ? "gap-y-0" : "gap-y-3"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="page-title min-w-0 text-[28px] font-bold leading-tight tracking-[-0.025em] md:text-title">{title}</h1>
            {/* À quoi sert la page (src/lib/viewHints.ts) : derrière un « ? », jamais affiché en permanence. */}
            {hint && (
              <HelpTip title="À quoi sert cette page" className="page-hint h-5 w-5 text-[11px]">
                {hint}
              </HelpTip>
            )}
          </div>
        </div>
        {/* Mobile : pleine largeur sous le titre, compteur à gauche / actions à
            droite, et les groupes d'actions passent à la ligne au lieu de déborder.
            ≥ sm : collé à droite du titre. */}
        <div
          ref={setSlot}
          className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 empty:hidden sm:w-auto sm:justify-end [&>div]:flex-wrap [&>div]:gap-y-2"
        />
      </div>
      <PageSlotContext.Provider value={slot}>{children}</PageSlotContext.Provider>
    </>
  );
}

export function PageHeaderRow({ children }: { children: ReactNode }) {
  const slot = useContext(PageSlotContext);
  // Contexte « en-tête de page » : sur iPhone, le bouton « + » qui s'y trouve monte dans la barre de titre.
  const body = <InPageHeaderContext.Provider value>{children}</InPageHeaderContext.Provider>;
  if (slot) return createPortal(body, slot);
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3">{body}</div>;
}

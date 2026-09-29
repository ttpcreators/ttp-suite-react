import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

export function PageFrame({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-[24px] font-semibold tracking-tight md:text-[28px]">{title}</h1>
        <div ref={setSlot} className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 empty:hidden" />
      </div>
      <PageSlotContext.Provider value={slot}>{children}</PageSlotContext.Provider>
    </>
  );
}

export function PageHeaderRow({ children }: { children: ReactNode }) {
  const slot = useContext(PageSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3">{children}</div>;
}

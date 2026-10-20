import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Briques de l'éditeur de facture en page (Facturation) : des cartes de formulaire à
 * gauche et, à droite, la VRAIE facture (le HTML exact envoyé à l'impression PDF),
 * posée comme une feuille A4 réduite et mise à jour pendant la saisie. Ce qu'on voit
 * est donc exactement ce qui sortira en PDF.
 */

/** Largeur d'une page A4 à l'écran (210 mm à 96 ppp) : la feuille est réduite depuis cette largeur. */
const A4_PX = 794;

/** La facture en direct : feuille A4 réduite à la largeur de la colonne, défilable. */
export function InvoiceSheet({ html, title, className }: { html: string; title: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [shown, setShown] = useState(html);
  const [dim, setDim] = useState({ w: 0, h: 0 });

  // Saisie : courte pause avant de redessiner la feuille (pas de clignotement à chaque
  // lettre), et on garde l'endroit où l'on lisait au lieu de remonter en haut.
  useEffect(() => {
    if (html === shown) return;
    const t = window.setTimeout(() => {
      try {
        scrollY.current = frameRef.current?.contentWindow?.scrollY ?? 0;
      } catch {
        scrollY.current = 0;
      }
      setShown(html);
    }, 180);
    return () => window.clearTimeout(t);
  }, [html, shown]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setDim({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = dim.w ? Math.min(1, dim.w / A4_PX) : 0;

  return (
    // Le bureau (gris) et la feuille (toujours blanche, même en sombre : c'est le papier).
    <div className={cn("rounded-2xl border border-border bg-panel p-3 sm:p-4", className)}>
      <div
        ref={boxRef}
        className="relative mx-auto h-full w-full max-w-[794px] overflow-hidden rounded-[3px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_14px_40px_-16px_rgba(0,0,0,0.28)]"
      >
        {scale > 0 && (
          <iframe
            ref={frameRef}
            title={title}
            srcDoc={shown}
            // allow-same-origin : les polices du document (public/fonts) se chargent, et on
            // peut relire la position de lecture. Aucun script n'est autorisé.
            sandbox="allow-same-origin"
            onLoad={() => {
              try {
                frameRef.current?.contentWindow?.scrollTo(0, scrollY.current);
              } catch {
                /* rien : on reste en haut */
              }
            }}
            style={{ width: A4_PX, height: dim.h / scale, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }}
          />
        )}
      </div>
    </div>
  );
}

/** Carte de l'éditeur : sections séparées par des filets. */
export function EditorCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border rounded-2xl border border-border bg-surface", className)}>{children}</div>;
}

/** Section d'une carte : titre, phrase d'aide, élément à droite (ex. client). */
export function EditorSection({ title, hint, right, children }: { title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-tight text-foreground">{title}</h3>
          {hint && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Rappel du client facturé (nom + email), comme une carte de visite. Lecture seule. */
export function ClientChip({ name, email }: { name: string; email: string }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background">{initial}</span>
      <span className="min-w-0">
        <span className={cn("block truncate text-[13px] font-medium leading-tight", name.trim() ? "text-foreground" : "text-faint")}>
          {name.trim() || "Client à renseigner"}
        </span>
        <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">{email.trim() || "Email du client"}</span>
      </span>
    </div>
  );
}

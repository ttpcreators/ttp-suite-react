import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Briques de la page Contrats (Marque × Créateur, UGC, Représentation) : un panneau de
 * réglages à filets à gauche, et à droite le VRAI document (le HTML du PDF, cf.
 * src/lib/pdfDoc.ts) posé comme une feuille, mis à jour pendant la saisie. Ce qu'on
 * voit à l'écran est donc exactement ce qui sortira en PDF.
 */

/** Largeur d'une page A4 à l'écran (210 mm à 96 ppp) : la feuille est mise à l'échelle depuis cette largeur. */
const A4_PX = 794;

export const docBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50";
export const docIconBtn =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";
export const docPrimaryBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";

/** Le document en direct : la feuille A4 réduite à la largeur de la colonne, défilable. */
export function ContractDocument({ html, title, meta, actions }: { html: string; title: string; meta?: ReactNode; actions?: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [shown, setShown] = useState(html);
  const [dim, setDim] = useState({ w: 0, h: 0 });

  // Saisie : on attend une courte pause avant de redessiner la feuille, et on garde
  // l'endroit où l'on lisait (sinon chaque lettre ramènerait en haut du contrat).
  useEffect(() => {
    if (html === shown) return;
    const t = window.setTimeout(() => {
      try {
        scrollY.current = frameRef.current?.contentWindow?.scrollY ?? 0;
      } catch {
        scrollY.current = 0;
      }
      setShown(html);
    }, 260);
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
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">Document</div>
          {meta && <div className="truncate text-[12px] text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      {/* Le bureau (gris) et la feuille (toujours blanche, même en sombre : c'est le papier). */}
      <div className="bg-panel p-3 sm:p-5">
        <div
          ref={boxRef}
          className="relative mx-auto h-[68vh] w-full max-w-[794px] overflow-hidden rounded-[3px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_14px_40px_-16px_rgba(0,0,0,0.28)] lg:h-[calc(100dvh-230px)] lg:min-h-[560px]"
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
    </section>
  );
}

/** Panneau de réglages : un seul cadre, sections séparées par des filets. */
export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{children}</div>;
}

/** Section toujours ouverte du panneau. */
export function PanelSection({ title, hint, right, children }: { title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">{title}</div>
          {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Section repliable : le titre, un résumé des valeurs quand elle est fermée, la flèche. */
export function FoldSection({ title, summary, open, onToggle, right, children }: { title: string; summary?: ReactNode; open: boolean; onToggle: () => void; right?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 pr-3 sm:pr-4">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-rowhover/50 sm:px-5">
          <span className="shrink-0 text-[14px] font-semibold text-foreground">{title}</span>
          {summary && !open && <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground">{summary}</span>}
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-180")} />
        </button>
        {right}
      </div>
      {open && <div className="px-4 pb-5 sm:px-5">{children}</div>}
    </div>
  );
}

/** Interrupteur en ligne (même dessin que dans Réglages). */
export function SwitchRow({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-lg py-1.5 text-left">
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px]", checked ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        {help && <span className="mt-0.5 block text-[11.5px] text-faint">{help}</span>}
      </span>
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-faint/40")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition-all", checked ? "left-[18px] bg-primary-foreground" : "left-0.5 bg-white")} />
      </span>
    </button>
  );
}

/** Modèles (« cas ») enregistrés d'un créateur : on en charge un d'un clic, on enregistre la config sous un nom. */
export function CasesBar({
  cases,
  active,
  onLoad,
  onDelete,
  name,
  onName,
  onSave,
}: {
  cases: { id: string; name: string }[];
  active: string;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  name: string;
  onName: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-[12px] font-medium text-muted-foreground">Modèles enregistrés</div>
      {cases.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {cases.map((cs) => {
            const on = cs.name === active;
            return (
              <span key={cs.id} className={cn("flex h-7 items-center gap-1 rounded-full border pl-3 pr-1.5 text-[12px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted-foreground hover:text-foreground")}>
                <button type="button" onClick={() => onLoad(cs.id)}>{cs.name}</button>
                <button type="button" onClick={() => onDelete(cs.id)} title="Supprimer ce modèle" aria-label={`Supprimer le modèle ${cs.name}`} className={cn("grid h-5 w-5 place-items-center rounded-full transition-colors", on ? "text-background/70 hover:text-background" : "text-faint hover:text-rose-500")}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mb-3 text-[12px] text-faint">Aucun modèle pour cette créatrice. Règle le contrat puis enregistre-le sous un nom pour le retrouver.</p>
      )}
      <div className="flex items-center gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border bg-surface px-3 transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Nom du modèle (ex. Standard)" aria-label="Nom du modèle" className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint" />
        </div>
        <button type="button" onClick={onSave} className={docBtn}>
          <Save className="h-3.5 w-3.5" /> Enregistrer le modèle
        </button>
      </div>
    </div>
  );
}

/** Liste à filets (historique des contrats). */
export function HistoryPanel({ title, count, empty, children }: { title: string; count: number; empty?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <span className="text-[14px] font-semibold text-foreground">{title}</span>
        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{count} contrat{count > 1 ? "s" : ""}</span>
      </header>
      {count === 0 ? <div className="px-5 py-8 text-center text-[13px] text-faint">{empty}</div> : <div className="max-h-[420px] divide-y divide-border overflow-y-auto">{children}</div>}
    </section>
  );
}

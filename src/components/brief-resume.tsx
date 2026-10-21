import { useCallback, useEffect, useRef, useState } from "react";
import { AtSign, Ban, CalendarClock, Check, Sparkles } from "@/components/icons";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { briefResumePrompt, hasResume, parseResume, RESUME_BLOCKS, type BriefResume, type ResumeKey } from "@/lib/briefResume";
import { claudeUrl } from "@/lib/mailThreadContext";
import { cn } from "@/lib/utils";

const ICONS: Record<ResumeKey, typeof Check> = { faire: Check, eviter: Ban, livrables: CalendarClock, mentions: AtSign };

/**
 * « L'essentiel du brief » : les 4 listes du résumé, sobres (icônes grises).
 * `dense` (cartes de la page Briefs) : 3 points par liste au plus, le reste en « +N ».
 */
export function BriefResumeView({
  resume,
  dense = false,
  t = (s: string) => s,
  className,
}: {
  resume: BriefResume;
  dense?: boolean;
  t?: (fr: string, vars?: Record<string, string | number>) => string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", dense ? "gap-2.5" : "gap-3.5", className)}>
      {RESUME_BLOCKS.filter((b) => resume[b.key].length).map((b) => {
        const Icon = ICONS[b.key];
        const items = resume[b.key];
        const shown = dense ? items.slice(0, 3) : items;
        return (
          <section key={b.key}>
            <h3 className={cn("font-medium text-muted-foreground", dense ? "text-[11px]" : "text-[12px]")}>{t(b.label)}</h3>
            <ul className={cn("mt-1 flex flex-col", dense ? "gap-1" : "gap-1.5")}>
              {shown.map((x, i) => (
                <li key={i} className={cn("flex items-start gap-2 leading-snug text-foreground [overflow-wrap:anywhere]", dense ? "text-[12px]" : "text-[14px]")}>
                  <Icon className={cn("mt-0.5 shrink-0 text-faint", dense ? "h-3 w-3" : "h-3.5 w-3.5")} />
                  <span>{x}</span>
                </li>
              ))}
              {items.length > shown.length && <li className="pl-5 text-[11px] text-muted-foreground">+{items.length - shown.length}</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const WAIT_MS = 10 * 60 * 1000;

/**
 * « Résumer avec Claude » (page Briefs, agence), sans clé API : ouvre Claude avec la
 * demande écrite (aussi copiée) ; Claude lit le brief (lire_brief) et dépose le résumé
 * (resumer_brief). L'app guette son arrivée (retour sur l'onglet + toutes les 5 s, 10 min).
 */
export function useBriefResumeClaude(onResume: (id: string, r: BriefResume) => void) {
  const [waiting, setWaiting] = useState<{ id: string; since: string | undefined; until: number } | null>(null);
  const cb = useRef(onResume);
  useEffect(() => {
    cb.current = onResume;
  }, [onResume]);

  const check = useCallback(async () => {
    if (!waiting) return;
    if (Date.now() > waiting.until) return setWaiting(null);
    const { data, error } = await supabase.from("briefs").select("resume").eq("id", waiting.id).maybeSingle();
    if (error) return;
    const r = parseResume((data as { resume?: unknown } | null)?.resume);
    if (!r || r.maj_le === waiting.since) return;
    setWaiting(null);
    cb.current(waiting.id, r);
    toast("Résumé de Claude reçu ✓");
  }, [waiting]);

  useEffect(() => {
    if (!waiting) return;
    const onBack = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    const iv = window.setInterval(() => void check(), 5000);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.clearInterval(iv);
    };
  }, [waiting, check]);

  const ask = (b: { id: string; brand: string; creator?: string | null; resume?: BriefResume | null }) => {
    const prompt = briefResumePrompt(b);
    const { url } = claudeUrl(prompt);
    window.open(url, "_blank", "noopener");
    void navigator.clipboard?.writeText(prompt).catch(() => {});
    setWaiting({ id: b.id, since: hasResume(b.resume) ? b.resume.maj_le : undefined, until: Date.now() + WAIT_MS });
    toast("Claude lit le brief : le résumé arrive ici tout seul");
  };

  return { ask, waitingId: waiting?.id ?? null, cancel: () => setWaiting(null) };
}

/** Bouton discret « Résumer avec Claude » / « Refaire avec Claude ». */
export function ResumeClaudeButton({ has, waiting, onClick, onCancel }: { has: boolean; waiting: boolean; onClick: () => void; onCancel: () => void }) {
  if (waiting)
    return (
      <button type="button" onClick={onCancel} title="Ne plus attendre" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Claude rédige…
      </button>
    );
  return (
    <button type="button" onClick={onClick} title="Claude lit le brief et le PDF de la marque, puis écrit le résumé ici" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-primary transition-opacity hover:opacity-80">
      <Sparkles className="h-3.5 w-3.5" /> {has ? "Refaire avec Claude" : "Résumer avec Claude"}
    </button>
  );
}

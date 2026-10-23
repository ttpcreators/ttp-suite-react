import { Check } from "@/components/icons";
import { IconTile } from "@/components/ui/icon-tile";
import { NewDot } from "@/components/ui/new-dot";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { TONE_TEXT } from "@/lib/statusTone";
import { brandInitial, CREATOR_STAGES, creatorStage, missionAction, type Mission } from "@/lib/creatorMissions";
import { clip45 } from "@/lib/creatorTodos";
import type { BriefResume } from "@/lib/briefResume";

/*
 * Missions de l'espace créateur : une carte par collab (ou brief), dans l'esprit de la page
 * Collabs de l'agence mais en plus simple. Marque, livrable, date, frise en 5 étapes
 * créateur (src/lib/creatorMissions.ts : creatorStage) et UN bouton selon l'étape.
 */

/** Frise « Brief reçu → Contenu envoyé → Validé → Publié → Payé ». */
export function MissionStages({ stage, compact = false }: { stage: number; compact?: boolean }) {
  const t = useT();
  return (
    <ol className="grid grid-cols-5" aria-label={t("Où en est la mission")}>
      {CREATOR_STAGES.map((label, i) => {
        const done = i <= stage;
        const now = i === stage + 1;
        return (
          <li key={label} className="relative flex min-w-0 flex-col items-center gap-1.5" aria-current={now ? "step" : undefined}>
            {i < CREATOR_STAGES.length - 1 && (
              <span aria-hidden className={cn("absolute left-1/2 top-[9px] h-0.5 w-full", i < stage ? "bg-primary" : "bg-border")} />
            )}
            <span
              className={cn(
                "relative z-10 grid h-5 w-5 place-items-center rounded-full",
                done ? "bg-primary text-primary-foreground" : now ? "border-2 border-primary bg-surface" : "bg-field",
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : now ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
            </span>
            {!compact && (
              <span className={cn("px-0.5 text-center text-[11px] leading-tight", now ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground")}>
                {t(label)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Carte d'une mission : un clic ouvre la fiche, le bouton fait l'action du moment. */
export function MissionCard({ m, dateText, whenText, late, onOpen, onAction, isNew }: {
  m: Mission;
  /** Le brief a du nouveau de l'agence (repère « nouveau »). */
  isNew?: boolean;
  /** « 21 oct. », "" sans échéance. */
  dateText: string;
  /** « dans 3 j », « aujourd'hui »…, ou null. */
  whenText: string | null;
  late: boolean;
  onOpen: () => void;
  onAction: (key: NonNullable<ReturnType<typeof missionAction>>["key"]) => void;
}) {
  const t = useT();
  const stage = creatorStage(m);
  const action = m.done ? null : missionAction(m);
  const what = m.deliverables || m.title;
  return (
    <div className="flex flex-col gap-4 rounded-[20px] bg-surface p-4 shadow-sm">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-start gap-3 text-left">
        <IconTile tone="info"><span className="text-[17px] font-bold">{brandInitial(m.brand)}</span></IconTile>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[16px] font-semibold text-foreground">
            {isNew && <NewDot label={t("Du nouveau de ton agence")} />}
            <span className="truncate">{m.brand}</span>
          </span>
          <span className="block truncate text-[13px] text-muted-foreground" title={what ?? undefined}>{what ? clip45(what) : t("Livrables à préciser")}</span>
        </span>
        {dateText && (
          <span className="flex shrink-0 flex-col items-end">
            <span className={cn("text-[14px] font-semibold tabular-nums", late ? TONE_TEXT.wait : "text-foreground")}>{dateText}</span>
            {whenText && <span className={cn("text-[12px]", late ? TONE_TEXT.wait : "text-muted-foreground")}>{whenText}</span>}
          </span>
        )}
      </button>
      <MissionStages stage={stage} />
      {action && (
        <button
          type="button"
          onClick={() => onAction(action.key)}
          className={cn(
            "flex h-11 w-full items-center justify-center rounded-full px-4 text-[14px] font-semibold transition-opacity hover:opacity-90",
            action.key === "open" ? "bg-field text-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          {t(action.label)}
        </button>
      )}
    </div>
  );
}

/**
 * Le brief en 4 blocs courts (à faire, à dire, à éviter, date), 3 lignes au plus chacun.
 * Le résumé vient de `briefs.resume` (src/lib/briefResume.ts) ; le PDF complet est dessous.
 */
export function BriefBlocks({ resume, dateText }: { resume: BriefResume; dateText: string }) {
  const t = useT();
  const blocks: { key: string; title: string; items: string[] }[] = [
    { key: "faire", title: t("À faire"), items: resume.faire },
    { key: "dire", title: t("À dire"), items: resume.mentions },
    { key: "eviter", title: t("À éviter"), items: resume.eviter },
    { key: "date", title: t("Date"), items: [dateText, ...resume.livrables].filter(Boolean) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {blocks.map((b) => (
        <section key={b.key} className="min-w-0 rounded-[14px] bg-field p-3">
          <h3 className="text-[13px] font-semibold text-muted-foreground">{b.title}</h3>
          {b.items.length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {b.items.slice(0, 3).map((x, i) => (
                <li key={i} className="line-clamp-2 text-[14px] leading-snug text-foreground [overflow-wrap:anywhere]">{x}</li>
              ))}
              {b.items.length > 3 && <li className="text-[12px] text-muted-foreground">+{b.items.length - 3}</li>}
            </ul>
          ) : (
            <p className="mt-1 text-[14px] text-muted-foreground">{t("Aucun")}</p>
          )}
        </section>
      ))}
    </div>
  );
}

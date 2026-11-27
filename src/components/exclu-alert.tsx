import { AlertTriangle } from "@/components/icons";
import { titleCase } from "@/lib/utils";
import { todayParis, useBlockedCreators, useExclusivites } from "@/lib/useExclusivites";
import { fmtDay } from "@/lib/dates";
import { conflictsFor, estAVerifier, excluState, foldName } from "../../supabase/functions/_shared/exclusivites.ts";

/**
 * Au-dessus d'une réponse à une marque : les créateurs qu'on ne peut pas lui proposer
 * (exclusivité confirmée en cours ou à venir avec un concurrent), puis ceux à vérifier avant
 * (exclusivité pas confirmée, ou sans liste de concurrents). Rien si personne n'est concerné.
 * Une ligne « à confirmer » sans créateur reconnu ne vise personne : elle reste dans la page
 * Exclusivités (et dans verifier_exclusivite).
 */
export function ExcluAlert({ brand, className }: { brand: string | null | undefined; className?: string }) {
  const flagged = useBlockedCreators(brand);
  const blocked = [...flagged].filter(([, why]) => !estAVerifier(why));
  const check = [...flagged].filter(([, why]) => estAVerifier(why));
  if (!brand || (!blocked.length && !check.length)) return null;
  return (
    <div role="note" className={`flex flex-col gap-1.5 rounded-xl bg-wait-soft px-3.5 py-2.5 text-[12.5px] text-wait ${className ?? ""}`}>
      {blocked.length > 0 && (
        <span className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            Ne pas proposer à {brand} :{" "}
            {blocked.map(([name, why], i) => (
              <span key={name}>
                {i > 0 && ", "}
                <span className="font-semibold">{titleCase(name)}</span> ({why})
              </span>
            ))}
          </span>
        </span>
      )}
      {check.length > 0 && (
        <span className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1">
            À vérifier avant de proposer :{" "}
            {check.map(([name, why], i) => (
              <span key={name}>
                {i > 0 && ", "}
                <span className="font-semibold">{titleCase(name)}</span> ({why.replace(/^À vérifier : /, "")})
              </span>
            ))}
            {" "}(page Exclusivités)
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Fiche d'une collab : l'exclusivité signée avec cette marque (dates, concurrents, points
 * clés gardés en mémoire) et, en alerte, une exclusivité du créateur qui interdit cette marque.
 * Une ligne « à confirmer » est marquée « À vérifier » : elle n'est pas sûre.
 */
export function CollabExcluPanel({ creator, brand }: { creator: string | null | undefined; brand: string }) {
  const { list } = useExclusivites();
  if (!creator) return null;
  const today = todayParis();
  const mine = list.filter((e) => foldName(e.creator) === foldName(creator) && foldName(e.brand) === foldName(brand) && excluState(e, today) !== "terminee");
  const conflicts = conflictsFor(list, creator, brand, today);
  if (!mine.length && !conflicts.length) return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-[22px] bg-surface p-4 sm:p-5">
      <div className="text-[14px] font-semibold text-foreground">Exclusivité</div>
      {conflicts.map((e) => (
        <div key={e.id} role="note" className="flex items-start gap-2 rounded-xl bg-wait-soft px-3.5 py-2.5 text-[12.5px] text-wait">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {titleCase(e.creator)} est en exclusivité avec {e.brand}{e.end ? ` jusqu'au ${fmtDay(e.end)}` : ""}
            {e.competitors.length ? ` (concurrents : ${e.competitors.join(", ")})` : e.scope ? ` (secteur : ${e.scope})` : ""}.
          </span>
        </div>
      ))}
      {mine.map((e) => (
        <div key={e.id} className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
          <span>
            {e.pending && <span className="mr-1.5 rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-muted-foreground">À vérifier</span>}
            {fmtDay(e.start)} → {e.end ? fmtDay(e.end) : "sans fin connue"}
            {e.scope ? ` · ${e.scope}` : ""}
            {e.competitors.length ? ` · ${e.competitors.join(", ")}` : ""}
          </span>
          {e.points.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-[14px] bg-panel px-3.5 py-2.5">
              {e.points.map((p, i) => <li key={i} className="leading-snug">{p}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

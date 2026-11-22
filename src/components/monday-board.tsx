// ============================================================================
// monday-board.tsx : le tableau de bord du lundi (stratégie du 20 nov. 2026), en haut
// de la page Objectifs. Deux parties, Gianni (acquisition) et Marc (closing), pour la
// semaine dernière ou la semaine en cours, puis le mois face à la cible.
// Calcul et lecture : supabase/functions/_shared/tableauLundi.ts (les mêmes qu'Alfred,
// outil `tableau_lundi`). Incidents de conformité : clé `conformiteIncidents` du blob,
// remplie par ig-sync.
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/appState";
import { cn } from "@/lib/utils";
import { CANAUX, chargerTableau, tableauLundi, type Semaine, type Tableau } from "../../supabase/functions/_shared/tableauLundi.ts";
import { VOLUMES_SEMAINE } from "../../supabase/functions/_shared/strategie.ts";

const eur = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/ /g, " ")} €`;
const frJour = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });

/** Une ligne chiffrée, avec sa barre quand il y a une cible. */
function Ligne({ label, valeur, cible, note }: { label: string; valeur: number | null; cible?: number | null; note?: string }) {
  const pct = valeur != null && cible ? Math.min(100, Math.round((valeur / cible) * 100)) : null;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="text-[13px] font-semibold tabular-nums text-foreground">
          {valeur == null ? <span className="font-normal text-muted-foreground">non mesuré</span> : valeur}
          {valeur != null && cible ? <span className="font-normal text-muted-foreground"> / {cible}</span> : null}
          {note ? <span className="ml-1 font-normal text-muted-foreground">{note}</span> : null}
        </span>
      </div>
      {pct != null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-signal" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Colonne({ titre, sous, children }: { titre: string; sous: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[18px] border border-border p-4">
      <div className="text-[15px] font-semibold text-foreground">{titre}</div>
      <div className="text-[12px] text-muted-foreground">{sous}</div>
      <div className="mt-2 divide-y divide-border">{children}</div>
    </div>
  );
}

function Gianni({ s }: { s: Semaine }) {
  const g = s.gianni;
  return (
    <Colonne titre="Gianni" sous="Acquisition">
      {CANAUX.filter((c) => c.key !== "tel" || g.parCanal.tel.envois > 0).map((c) => (
        <Ligne key={c.key} label={`${c.label} envoyés`} valeur={g.parCanal[c.key].envois} cible={c.cible} />
      ))}
      <Ligne label="Réponses" valeur={g.reponses} note={g.tauxReponse != null ? `(${g.tauxReponse} %)` : undefined} />
      <Ligne label="Contacts passés à Marc" valeur={g.passesAMarc} />
      <Ligne label="Créatrices approchées" valeur={g.creatricesApprochees} cible={VOLUMES_SEMAINE.approchesCreatrices} />
    </Colonne>
  );
}

function Marc({ s }: { s: Semaine }) {
  const m = s.marc;
  return (
    <Colonne titre="Marc" sous="Relation et closing">
      <Ligne label="Visios faites" valeur={m.visios} cible={6} />
      <Ligne label="Devis envoyés" valeur={m.devisEnvoyes} />
      <Ligne label="Deals signés" valeur={m.dealsSignes} note={m.dealsSignes ? `(${m.dealsPayes} payés)` : undefined} />
      <div className="flex items-baseline justify-between gap-3 py-2">
        <span className="text-[13px] text-foreground">Montant HT signé</span>
        <span className="text-[13px] font-semibold tabular-nums text-foreground">{eur(m.montantHT)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 py-2">
        <span className="text-[13px] text-foreground">Montant moyen</span>
        <span className="text-[13px] font-semibold tabular-nums text-foreground">{m.montantMoyen != null ? eur(m.montantMoyen) : "—"}</span>
      </div>
    </Colonne>
  );
}

export function MondayBoard() {
  const { data: quotesRaw } = useAppState((s) => s["quotes"]);
  const { data: journalRaw } = useAppState((s) => s["conformiteIncidents"]);
  const [t, setT] = useState<Tableau | null>(null);
  const [erreur, setErreur] = useState(false);
  const [vue, setVue] = useState<"precedente" | "maintenant">(() => (new Date().getDay() === 1 ? "precedente" : "maintenant"));
  const quotes = Array.isArray(quotesRaw) ? (quotesRaw as Record<string, unknown>[]) : null;
  const quotesKey = quotes ? quotes.length : -1;
  const journalKey = journalRaw && typeof journalRaw === "object" ? Object.keys(journalRaw).length : -1;

  useEffect(() => {
    let vivant = true;
    const now = new Date();
    chargerTableau(supabase, now, quotes, journalRaw)
      .then((d) => vivant && setT(tableauLundi(d, now)))
      .catch(() => vivant && setErreur(true));
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotesKey, journalKey]);

  if (erreur) return <section className="rounded-[22px] bg-surface p-5 text-[13px] text-muted-foreground">Tableau du lundi indisponible pour l'instant.</section>;
  if (!t) return <section className="rounded-[22px] bg-surface p-5 text-[13px] text-muted-foreground">Tableau du lundi…</section>;
  const s = t[vue];
  const m = t.mois;
  const pct = m.cible ? Math.min(100, Math.round((m.montantHT / m.cible) * 100)) : null;
  const seg = (on: boolean) => cn("h-8 rounded-full px-3 text-[12px] font-medium transition-colors", on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground");
  return (
    <section className="rounded-[22px] bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-foreground">Tableau du lundi</h2>
          <p className="text-[12px] text-muted-foreground">
            Du {frJour(s.du)} au {frJour(s.au)}. Envois comptés d'après le journal de contact des fiches : note chaque message LinkedIn ou WhatsApp dans la fiche du contact.
          </p>
        </div>
        <div className="flex rounded-full bg-muted p-0.5">
          <button type="button" className={seg(vue === "precedente")} onClick={() => setVue("precedente")}>Semaine dernière</button>
          <button type="button" className={seg(vue === "maintenant")} onClick={() => setVue("maintenant")}>Cette semaine</button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Gianni s={s} />
        <Marc s={s} />
      </div>
      <div className="mt-3 rounded-[18px] border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold text-foreground">Ce mois-ci</span>
          <span className="text-[13px] tabular-nums text-foreground">
            <b>{eur(m.montantHT)}</b> HT signés{m.cible ? <span className="text-muted-foreground"> sur {eur(m.cible)}</span> : null}
          </span>
        </div>
        {pct != null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", pct >= 100 ? "bg-signal" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted-foreground sm:grid-cols-3">
          <span>{m.deals} deals ({m.dealsPayes} payés)</span>
          <span>Deal moyen {m.montantMoyen != null ? eur(m.montantMoyen) : "—"}</span>
          <span>Part de Léna {m.partLena != null ? `${m.partLena} %` : "—"}</span>
          <span>{m.creatricesQuiSignent} créatrices signent</span>
          <span>Carnet traité {m.carnetTraite} / {m.carnetTotal}</span>
          <span>{m.agencesActives} agences actives</span>
          <span>
            Conformité :{" "}
            {m.incidentsConformite == null ? "non mesurée" : `${m.incidentsConformite} incident${m.incidentsConformite > 1 ? "s" : ""} ce mois, ${s.incidentsConformite ?? 0} ${vue === "precedente" ? "semaine dernière" : "cette semaine"}`}
          </span>
        </div>
      </div>
    </section>
  );
}

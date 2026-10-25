import { useEffect, useMemo, useState } from "react";
import { Link2, Plus, Sparkles } from "@/components/icons";
import { SelectField, Picker } from "@/components/ui/form";
import { StatusPill } from "@/components/ui/status-pill";
import { HelpTip } from "@/components/ui/help-tip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { fmtDayAny } from "@/lib/dates";
import { useLiveKey } from "@/lib/useLive";
import { useRestrictedViews } from "@/lib/restrictedViews";
import { formatEuro, parseAmount, saveAppStateKey, useAppState } from "@/lib/appState";
import { collabChoices, collabLabel, linkGroups, type CollabLite, type LinkData, type LinkTable } from "@/lib/collabLinks";
import { collabIdReady, getCollabLink, loadCollabsLite, loadLinkData, openCollab, setCollabLink } from "@/lib/collabLinksDb";

/*
 * « La collab au centre » côté interface :
 *   • CollabField : champ « Collab » d'un formulaire (collabs du créateur choisi) ;
 *   • ObjectCollabLink : dans la fiche d'un objet existant, le lien vers sa collab ;
 *   • CollabLinkedPanel : dans la fiche collab, tout ce qui la concerne.
 * Avant le SQL 2026-10-23 : les champs et liens ne s'affichent pas, la fiche collab montre
 * seulement des suggestions (marque + créateur), sans bouton « Relier ».
 */

let collabsCache: CollabLite[] | null = null;

/** Collabs (id, marque, créateur, étape) rafraîchies comme le reste de l'app. */
export function useCollabsLite(): CollabLite[] {
  const [list, setList] = useState<CollabLite[]>(() => collabsCache ?? []);
  const live = useLiveKey();
  useEffect(() => {
    let alive = true;
    void loadCollabsLite().then((l) => {
      collabsCache = l;
      if (alive) setList(l);
    });
    return () => {
      alive = false;
    };
  }, [live]);
  return list;
}

/** La colonne `collab_id` existe (SQL lancé). `null` tant qu'on ne sait pas. */
export function useCollabLinkReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void collabIdReady().then((r) => alive && setReady(r));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/**
 * Relie un objet tout juste créé à la collab choisie dans son formulaire. L'objet est déjà
 * enregistré : en cas d'échec, on le dit (sinon le lien se perd sans bruit).
 */
export async function linkNewToCollab(table: LinkTable, id: string, collabId: string): Promise<void> {
  if (!collabId) return;
  if ((await setCollabLink(table, id, collabId)) === "error") toast("Ajouté, mais pas relié à la collab : relie-le depuis sa fiche");
}

/** Champ « Collab » d'un formulaire. Rien avant le SQL. */
export function CollabField({ value, onChange, creator, className }: { value: string; onChange: (v: string) => void; creator?: string | null; className?: string }) {
  const ready = useCollabLinkReady();
  const collabs = useCollabsLite();
  const options = useMemo(() => {
    const list = collabChoices(collabs, creator);
    const cur = value && !list.some((c) => c.id === value) ? collabs.find((c) => c.id === value) : undefined;
    return [{ value: "", label: "Aucune" }, ...[...(cur ? [cur] : []), ...list].map((c) => ({ value: c.id, label: collabLabel(c) }))];
  }, [collabs, creator, value]);
  if (!ready) return null;
  return <SelectField label="Collab" value={value} onChange={onChange} options={options} className={className} />;
}

/** Bouton « Collab Marque × Créateur » qui ouvre la fiche de la collab. */
export function CollabChip({ collab, className }: { collab: CollabLite; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => void openCollab(collab.id)}
      title="Ouvrir la collab"
      className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-field px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover", className)}
    >
      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">Collab {collabLabel(collab)}</span>
    </button>
  );
}

/** Dans la fiche d'un objet : sa collab (lien retour) et le choix de la collab. Rien avant le SQL. */
export function ObjectCollabLink({ table, id, creator, className, withLabel, asRow }: {
  table: LinkTable; id: string; creator?: string | null; className?: string;
  /** Libellé « Collab » au-dessus (formulaire). */
  withLabel?: boolean;
  /** Ligne « Collab » d'une fiche (même mise en page que les autres lignes : dt / dd). */
  asRow?: boolean;
}) {
  const ready = useCollabLinkReady();
  const collabs = useCollabsLite();
  const [collabId, setCollabId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getCollabLink(table, id).then((c) => alive && setCollabId(c));
    return () => {
      alive = false;
    };
  }, [table, id]);
  const current = collabId ? collabs.find((c) => c.id === collabId) : undefined;
  const options = useMemo(() => {
    const list = collabChoices(collabs, creator);
    return [{ value: "", label: "Aucune collab" }, ...[...(current && !list.includes(current) ? [current] : []), ...list].map((c) => ({ value: c.id, label: collabLabel(c) }))];
  }, [collabs, creator, current]);
  if (!ready) return null;
  const change = async (v: string) => {
    const prev = collabId;
    setCollabId(v || null);
    const r = await setCollabLink(table, id, v || null);
    if (r !== "ok") {
      setCollabId(prev);
      toast("Lien non enregistré, réessaie");
    }
  };
  const body = (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", !withLabel && !asRow && className)}>
      {current && <CollabChip collab={current} />}
      <Picker ariaLabel="Relier à une collab" size="sm" value={collabId ?? ""} onChange={(v) => void change(v)} options={options} className="min-w-[10rem]" />
    </div>
  );
  if (asRow) {
    return (
      <div className={cn("flex min-h-11 items-center justify-between gap-3 px-3.5 py-2", className)}>
        <dt className="shrink-0 text-[13px] text-muted-foreground">Collab</dt>
        <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-[13px] text-foreground">{body}</dd>
      </div>
    );
  }
  if (!withLabel) return body;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[12px] font-medium text-muted-foreground">Collab</span>
      {body}
    </div>
  );
}

const SECTIONS: { table: LinkTable; label: string }[] = [
  { table: "briefs", label: "Brief" },
  { table: "todos", label: "Tâches" },
  { table: "events", label: "Rendez-vous" },
  { table: "invoices", label: "Factures" },
  { table: "gifting", label: "Gifting" },
];

/** Réglage d'équipe : une tâche est créée à chaque étape franchie (blob `collabAutoTasks`, activé par défaut). */
export function useCollabAutoTasks(): [boolean, (v: boolean) => Promise<void>] {
  const { data } = useAppState<boolean>((s) => s["collabAutoTasks"] !== false);
  const [local, setLocal] = useState<boolean | null>(null);
  const on = local ?? data ?? true;
  const set = async (v: boolean) => {
    setLocal(v);
    if (!(await saveAppStateKey("collabAutoTasks", v))) {
      setLocal(null);
      toast("Réglage non enregistré, réessaie");
    }
  };
  return [on, set];
}

/** Fiche collab : brief, tâches, rendez-vous, factures et gifting reliés (et suggérés). */
export function CollabLinkedPanel({ collab, onCreateInvoice, onPrepareRecap }: { collab: CollabLite; onCreateInvoice?: () => void; onPrepareRecap?: () => void }) {
  const ready = useCollabLinkReady();
  const live = useLiveKey();
  const [data, setData] = useState<LinkData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadLinkData().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [live, tick, collab.id]);
  const groups = useMemo(() => (data ? linkGroups(collab, data, (v) => fmtDayAny(v)) : null), [data, collab]);
  const [autoTasks, setAutoTasks] = useCollabAutoTasks();

  const link = async (table: LinkTable, id: string) => {
    const r = await setCollabLink(table, id, collab.id);
    if (r === "ok") {
      toast("Relié ✓");
      setTick((t) => t + 1);
    } else toast(r === "missing" ? "Pas encore disponible" : "Erreur, réessaie");
  };

  // Membre (Facturation réservée aux fondateurs) : ni bouton facture (il mènerait à « Accès
  // réservé ») ni montants des factures reliées.
  const money = !useRestrictedViews().includes("facturation");
  const showInvoice = money && !!onCreateInvoice && collab.step >= 7;
  // Bilan pour la marque : proposé à l'étape 10, bouton principal à l'étape 11 « Bilan ».
  const showRecap = !!onPrepareRecap && collab.step >= 10;
  return (
    <div className="rounded-[20px] bg-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-foreground">
          Liés à la collab
          <HelpTip title="Liés à la collab">
            <p>Tout ce qui concerne cette collab : brief, tâches, rendez-vous, factures et gifting.</p>
            <p>« Suggéré » : même marque et même créateur, pas encore relié.</p>
          </HelpTip>
        </h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
        {showRecap && (
          <button
            type="button"
            onClick={onPrepareRecap}
            title="Bilan prérempli avec les livrables, les chiffres des posts et le montant, à envoyer à la marque"
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
              collab.step >= 11 ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover",
            )}
          >
            <Sparkles className="h-4 w-4" /> Préparer le bilan
          </button>
        )}
        {showInvoice && (
          <button
            type="button"
            onClick={onCreateInvoice}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
              collab.step >= 8 ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover",
            )}
          >
            <Plus className="h-4 w-4" /> Créer la facture
          </button>
        )}
        </div>
      </div>
      {!groups ? (
        <p className="text-[13px] text-muted-foreground">Chargement…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {SECTIONS.filter((s) => money || s.table !== "invoices").map(({ table, label }) => {
            const g = groups[table];
            const total = g.linked.length + g.suggested.length;
            return (
              <div key={table}>
                <div className="mb-1 flex items-baseline justify-between text-[12px] font-medium text-muted-foreground">
                  <span>{label}</span>
                  {total > 0 && <span className="tabular-nums">{g.linked.length}</span>}
                </div>
                {table === "todos" && (
                  <label className="mb-1.5 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[12px] bg-surface px-3 py-1.5 text-[13px] text-foreground">
                    <span className="flex items-center gap-1.5">
                      Tâche à chaque étape
                      <HelpTip title="Tâche à chaque étape">
                        <p>Quand la collab avance, l'app crée la tâche suivante. Exemple : « Résumer le brief pour Léna », à faire le lendemain.</p>
                        <p>Réglage commun à toute l'équipe.</p>
                      </HelpTip>
                    </span>
                    <input type="checkbox" role="switch" checked={autoTasks} onChange={(e) => void setAutoTasks(e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" />
                  </label>
                )}
                {total === 0 ? (
                  <p className="text-[13px] text-faint">Aucun</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {[...g.linked.map((i) => ({ ...i, sug: false })), ...g.suggested.map((i) => ({ ...i, sug: true }))].map((i) => (
                      <li key={`${i.table}:${i.id}`} className="flex min-h-11 items-center gap-2 rounded-[12px] bg-surface px-3 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-foreground" title={i.title}>{i.title}</div>
                          <div className="truncate text-[12px] text-muted-foreground">{i.meta}</div>
                        </div>
                        {i.amount && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{formatEuro(parseAmount(i.amount))}</span>}
                        {i.late && <StatusPill tone="late" size="xs">En retard</StatusPill>}
                        {i.sug && <StatusPill tone="closed" size="xs">Suggéré</StatusPill>}
                        {i.sug && ready && (
                          <button
                            type="button"
                            onClick={() => void link(i.table, i.id)}
                            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-field px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
                          >
                            <Link2 className="h-3.5 w-3.5" /> Relier
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

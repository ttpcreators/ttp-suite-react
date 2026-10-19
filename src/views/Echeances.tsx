import { useMemo, useState } from "react";
import { Pencil, CalendarClock, RefreshCw } from "lucide-react";
import { useAppState, listAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";
import { PageHeaderRow } from "@/components/ui/page-header";

/**
 * Alertes d'échéance de contrats : on enregistre les contrats actifs (créateur,
 * type, date de début, durée) et l'app calcule la date de fin + alerte à 30/60 j.
 * Stocké dans le blob agence `contractDeadlines`.
 */

type Deadline = { id: string; creator: string; type: string; start: string; months: number; note?: string };

const TYPE_OPTIONS = [
  { value: "représentation", label: "Représentation" },
  { value: "marque", label: "Marque" },
  { value: "ugc", label: "UGC" },
];

/** Même règle que listAppStateKey : remplace sur place, retire par id, ajoute le reste. */
function applyChange(cur: Deadline[], upsert: Deadline[], remove: string[], prepend: boolean): Deadline[] {
  const ups = new Map(upsert.map((u) => [u.id, u]));
  const kept = cur.filter((x) => !remove.includes(x.id)).map((x) => ups.get(x.id) ?? x);
  const added = upsert.filter((u) => !cur.some((x) => x.id === u.id));
  return prepend ? [...added, ...kept] : [...kept, ...added];
}

let _uid = 0;
/** Libellé lisible du type (« Représentation », « Marque », « UGC »). */
const typeLabel = (t: string) => TYPE_OPTIONS.find((o) => o.value === (t || "").toLowerCase())?.label ?? t;
/** Les notes posées automatiquement (« Auto — … ») s'affichent sous une forme lisible. */
const noteLabel = (n?: string) => (n && /^auto/i.test(n.trim()) ? "Ajouté depuis Contrats" : n);

const uid = () => `ct${Date.now().toString(36)}${(_uid += 1)}`;
// Date LOCALE (toISOString = UTC → la veille entre minuit et 2 h en France)
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => isoOf(new Date());

function endDate(start: string, months: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + (months || 0);
  // Jour borné à la fin du mois cible (31 janv. + 1 mois = fin février, pas 3 mars)
  const lastDay = new Date(y, mo + 1, 0).getDate();
  return new Date(y, mo, Math.min(Number(m[3]), lastDay));
}
function daysLeft(d: Date): number {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
/** "16/09/2026" ou "2026-09-16" → "2026-09-16" (ou "" si non reconnu). */
function toISOloose(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
/** Nombre de mois lu depuis un texte (« 12 mois », « 12 »). 0 si absent. */
function monthsOf(s: string | null | undefined): number {
  const n = parseInt(String(s ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

type Blank = { creator: string; type: string; start: string; months: string; note: string };
const blank = (): Blank => ({ creator: "", type: "représentation", start: todayISO(), months: "12", note: "" });

export function Echeances() {
  const { data: stored } = useAppState<Deadline[]>((s: AppState) => (s["contractDeadlines"] as Deadline[]) ?? []);
  const [local, setLocal] = useState<Deadline[] | null>(null);
  const list = local ?? stored ?? [];
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Blank>(blank());
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  const creatorOptions = creators.map((c) => ({ value: c.name, label: titleCase(c.name), img: c.photo_url }));

  const rows = useMemo(() => {
    return list
      .map((d) => {
        const end = endDate(d.start, d.months);
        return { d, end, left: end ? daysLeft(end) : null };
      })
      .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  }, [list]);

  // Mutation sûre : relit le blob FRAIS (pour l'affichage) et n'envoie QUE les échéances
  // touchées (la clé contractDeadlines est aussi écrite par la fiche créateur et les
  // contrats → deux postes qui enregistrent en même temps ne s'effacent plus).
  type Change = { upsert?: Deadline[]; remove?: string[]; prepend?: boolean };
  const mutate = async (fn: (fresh: Deadline[]) => Change): Promise<boolean> => {
    invalidateAppState();
    const fresh = ((await getAppState())["contractDeadlines"] as Deadline[]) ?? [];
    const { upsert = [], remove = [], prepend = false } = fn(fresh);
    const next = applyChange(fresh, upsert, remove, prepend);
    const before = local;
    setLocal(next);
    const ok = await listAppStateKey("contractDeadlines", upsert, remove, prepend);
    if (!ok) {
      setLocal(before); // rollback : l'écran reflète la base
      toast("Erreur, réessaie");
    }
    return ok;
  };

  const openAdd = () => {
    setEditId(null);
    setDraft(blank());
    setFormOpen(true);
  };
  const openEdit = (d: Deadline) => {
    setEditId(d.id);
    setDraft({ creator: d.creator, type: d.type, start: d.start, months: String(d.months), note: d.note ?? "" });
    setFormOpen(true);
  };
  const submit = async () => {
    if (!draft.creator) {
      toast("Choisis un créateur");
      return;
    }
    const months = Math.max(1, parseInt(draft.months, 10) || 0);
    const entry: Deadline = {
      id: editId ?? uid(),
      creator: draft.creator,
      type: draft.type,
      start: draft.start || todayISO(),
      months,
      note: draft.note.trim() || undefined,
    };
    const wasEdit = !!editId;
    let missing = false;
    const ok = await mutate((fresh) => {
      if (!wasEdit) return { upsert: [entry], prepend: true };
      const cur = fresh.find((x) => x.id === entry.id);
      missing = !cur;
      if (!cur) return {};
      // Garde les champs annexes (marque, id de contrat) posés par l'auto-échéance
      return { upsert: [{ ...cur, ...entry }] };
    });
    // Échec : le formulaire reste ouvert pour réessayer
    if (!ok) return;
    setFormOpen(false);
    setEditId(null);
    if (missing) toast("Ce contrat a été supprimé entre-temps, rien n'a été modifié");
    else toast(wasEdit ? "Contrat mis à jour ✓" : "Contrat ajouté ✓");
  };
  const remove = async (id: string) => {
    const ok = await mutate(() => ({ remove: [id] }));
    if (ok) toast("Contrat retiré du suivi");
  };

  // Synchronise les échéances depuis les contrats DÉJÀ enregistrés (historique) :
  //  - Représentation (blob `contractHistory`) : dates + durée depuis la config ;
  //  - Marque/UGC (blob `brandContractHistory`) : durée lue dans le HTML archivé.
  // N'ajoute que le MANQUANT (dédupe par créateur + type) → jamais de doublon.
  const [syncing, setSyncing] = useState(false);
  const syncFromContracts = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      invalidateAppState();
      const st = await getAppState();
      const existing = (st["contractDeadlines"] as Deadline[]) ?? [];
      const seen = new Set(existing.map((d) => `${(d.type || "").toLowerCase()}|${d.creator.trim().toLowerCase()}`));
      const added: Deadline[] = [];
      const push = (creator: string, type: string, start: string, months: number) => {
        const c = creator.trim();
        if (!c || c === "[Créateur]" || !start || months <= 0) return;
        const k = `${type.toLowerCase()}|${c.toLowerCase()}`;
        if (seen.has(k)) return;
        seen.add(k);
        added.push({ id: uid(), creator: c, type, start, months, note: "Auto — import contrat" });
      };
      // 1) Contrats de représentation (config structurée : dateDebut/dateSignature + dureeMois)
      const repr = (st["contractHistory"] as { creator?: string | null; config?: Record<string, string> }[]) ?? [];
      for (const c of repr) {
        const cfg = c.config ?? {};
        push((c.creator ?? cfg.talentNom ?? "").trim(), "représentation", toISOloose(cfg.dateDebut) || toISOloose(cfg.dateSignature), monthsOf(cfg.dureeMois));
      }
      // 2) Contrats Marque/UGC (durée lue dans le HTML archivé : « Durée … 12 mois »)
      const brand = (st["brandContractHistory"] as { ctType?: string; ctName?: string; ts?: number; html?: string }[]) ?? [];
      for (const b of brand) {
        const type = b.ctType === "ugc" ? "ugc" : "marque";
        const m = /Dur[ée]e[^0-9]{0,20}?([0-9]+)\s*mois/i.exec(b.html ?? "");
        const start = b.ts ? isoOf(new Date(b.ts)) : todayISO();
        push((b.ctName ?? "").trim(), type, start, m ? parseInt(m[1], 10) : 0);
      }
      if (!added.length) {
        toast("Rien à importer, tous les contrats sont déjà suivis ✓");
        return;
      }
      const next = [...added, ...existing];
      setLocal(next);
      // N'envoie QUE les échéances importées (ajoutées en tête, côté base).
      const ok = await listAppStateKey("contractDeadlines", added, [], true);
      toast(ok ? `${added.length} contrat${added.length > 1 ? "s" : ""} importé${added.length > 1 ? "s" : ""} ✓` : "Erreur, réessaie");
    } finally {
      setSyncing(false);
    }
  };

  const badgeFor = (left: number | null) => {
    if (left == null) return { cls: "bg-rowhover text-muted-foreground", label: "Date invalide" };
    if (left < 0) return { cls: "bg-danger/15 text-dangertext", label: `Expiré depuis ${-left} j` };
    if (left <= 30) return { cls: "bg-danger/15 text-dangertext", label: `Expire dans ${left} j` };
    if (left <= 60) return { cls: "bg-amber/15 text-amber", label: `Expire dans ${left} j` };
    return { cls: "bg-signal/15 text-signaltext", label: `${left} j restants` };
  };

  return (
    <div className="space-y-4">
      <PageHeaderRow>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="h-4 w-4 text-faint" />
          <span className="font-semibold text-foreground">{list.length}</span>
          <span>{list.length > 1 ? "contrats suivis" : "contrat suivi"}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={syncFromContracts}
            disabled={syncing}
            title="Ajoute les contrats déjà enregistrés qui ne sont pas encore suivis"
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={"h-3.5 w-3.5" + (syncing ? " animate-spin" : "")} />
            <span>{syncing ? "Import…" : "Importer depuis Contrats"}</span>
          </button>
          <AddButton label="Contrat à suivre" onClick={openAdd} />
        </div>
      </PageHeaderRow>

      <InlineForm
        open={formOpen}
        title={editId ? "Modifier le contrat" : "Nouveau contrat suivi"}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSubmit={submit}
        submitLabel={editId ? "Enregistrer" : "Ajouter"}
      >
        <SelectField label="Créateur" value={draft.creator} onChange={(v) => setDraft({ ...draft, creator: v })} options={creatorOptions} className="sm:min-w-[180px]" />
        <SelectField label="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={TYPE_OPTIONS} className="sm:min-w-[150px]" />
        <TextField label="Date de début" type="date" value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} className="sm:min-w-[150px]" />
        <TextField label="Durée (mois)" type="number" value={draft.months} onChange={(v) => setDraft({ ...draft, months: v })} className="sm:min-w-[110px]" />
        <TextField label="Note (optionnel)" value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} className="sm:min-w-[150px]" />
      </InlineForm>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-sm">
          Aucun contrat suivi. Ajoute un contrat (représentation, marque ou UGC) pour être alerté avant sa fin.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ d, end, left }) => {
            const badge = badgeFor(left);
            return (
              <div key={d.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{titleCase(d.creator)}</span>
                    <span className="rounded-full bg-rowhover px-2 py-0.5 text-[12px] font-medium text-muted-foreground">{typeLabel(d.type)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-faint">
                    {frDate(new Date(d.start.replace(/-/g, "/")))} → {end ? frDate(end) : "—"} · {d.months} mois
                    {d.note ? ` · ${noteLabel(d.note)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  <span className={"rounded-full px-3 py-1 text-[12px] font-bold " + badge.cls}>{badge.label}</span>
                  <button
                    type="button"
                    onClick={() => openEdit(d)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Modifier"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <DeleteButton onClick={() => setPendingDel({ message: `Ne plus suivre le contrat de ${titleCase(d.creator)} ? Les contrats enregistrés ne sont pas touchés.`, run: () => remove(d.id) })} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingDel && (
        <ConfirmDialog
          title="Ne plus suivre ce contrat"
          message={pendingDel.message}
          confirmLabel="Ne plus suivre"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </div>
  );
}

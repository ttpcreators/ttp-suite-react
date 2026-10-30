import { useStickyState } from "@/lib/useStickyState";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { SubtaskChecklist, type Subtask } from "@/components/ui/subtask-checklist";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  AutoGrowTextField,
  } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { useCreators } from "@/lib/useCreators";
import { notifyCreator, notifyCreatorsChange } from "@/lib/push";
import { markActivityRead, useActivityEvents } from "@/lib/useActivityEvents";
import { NewDot } from "@/components/ui/new-dot";
import { Trash2, MessageSquarePlus, Check, X, Pencil, UserRound, Sparkles } from "@/components/icons";
import { StatsBento } from "@/components/ui/stats-bento";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import { useEffect, useRef, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { useAppState, mergeAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { getCache, setCache } from "@/lib/viewCache";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { CreatorPickerField } from "@/components/ui/creator-picker";

type Row = {
  id: string;
  text: string;
  creator: string | null;
  status: string | null;
  source: string | null;
  sort_order: number | null;
  subtasks?: Subtask[] | null;
};

const STATUS_OPTS: StatusOption[] = [
  { value: "À explorer", label: "À explorer", dot: "bg-info" },
  { value: "À faire", label: "À faire", dot: "bg-wait" },
  { value: "En cours", label: "En cours", dot: "bg-progress" },
  { value: "Publiée", label: "Publiée", dot: "bg-ok" },
];

const STATUS_FILTERS = ["À explorer", "À faire", "En cours", "Publiée"];
const ALL_STATUS = "__all__";

export function Idees() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("ideas"));
  // Repères « nouveau » : idées sur lesquelles un créateur a écrit (activity_events).
  const activity = useActivityEvents("agency");
  const [error, setError] = useState<boolean>(false);
  const live = useLiveKey();

  const creators = useCreators();
  const creatorOptions = creators.map((c) => ({ value: c.name, label: titleCase(c.name), img: c.photo_url }));

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [formCreator, setFormCreator] = useState(""); // "" = idée générale (aucune créatrice)
  const [statusFilter, setStatusFilter] = useStickyState<string>("idees:statut", [ALL_STATUS, ...STATUS_OPTS.map((o) => o.value)], ALL_STATUS);
  const [creatorFilter, setCreatorFilter] = useState<string>(""); // "" = toutes ; "__general__" = non assignées
  // Édition inline du texte d'une idée.
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Commentaires (agence) stockés dans le blob __app_state__, indexés par id d'idée.
  const { data: notesData } = useAppState<Record<string, string>>(
    (s: AppState) => (s["itemNotes"] as Record<string, string>) ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (notesData) setNotes(notesData);
  }, [notesData]);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  // Renvoie true si enregistré ; ne lève jamais (échec de lecture compris).
  const saveNote = async (id: string, value: string): Promise<boolean> => {
    // Relit la map FRAÎCHE avant d'écrire (jamais depuis l'état local : on
    // écraserait les commentaires posés depuis un autre poste / pas encore chargés).
    const before = notes;
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["itemNotes"] as Record<string, string>) ?? {};
      const next = { ...fresh };
      if (value.trim()) next[id] = value.trim();
      else delete next[id];
      setNotes(next);
      // N'envoie QUE ce commentaire (posé ou retiré), fusionné côté base.
      const ok = value.trim()
        ? await mergeAppStateKey("itemNotes", { [id]: value.trim() })
        : await mergeAppStateKey("itemNotes", {}, [id]);
      if (ok) return true;
    } catch {
      /* traité ci-dessous */
    }
    setNotes(before);
    toast("Commentaire non enregistré, réessaie");
    return false;
  };

  useEffect(() => {
    let active = true;
    supabase
      .from("ideas")
      .select("id, text, creator, status, source, sort_order, subtasks")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = (data ?? []) as Row[];
        setCache("ideas", list);
        setRows(list);
      });
    return () => {
      active = false;
    };
  }, [live]);

  const submit = async () => {
    if (!text.trim()) {
      toast("Renseigne l'idée");
      return;
    }
    const row = {
      text: text.trim(),
      creator: formCreator || null,
      status: "À faire",
      source: "agency",
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("ideas", row);
    if (!created) {
      toast("Erreur, réessaie");
      return;
    }
    const createdRow = created as unknown as Row;
    const nextRows = [...(rows ?? []), createdRow];
    setRows(nextRows);
    setCache("ideas", nextRows);
    if (note.trim()) await saveNote(createdRow.id, note);
    if (formCreator) notifyCreator("idea", formCreator, `Nouvelle idée : ${row.text.slice(0, 80)}`);
    toast(formCreator ? `Idée envoyée à ${titleCase(formCreator)} ✓` : "Idée ajoutée ✓");
    setFormOpen(false);
    setText("");
    setNote("");
    setFormCreator("");
  };

  const startEdit = (row: Row) => {
    setEditId(row.id);
    setEditText(row.text);
  };
  const saveEdit = async (id: string) => {
    const t = editText.trim();
    if (!t) {
      toast("L'idée ne peut pas être vide");
      return;
    }
    const prev = rows;
    const next = (rows ?? []).map((r) => (r.id === id ? { ...r, text: t } : r));
    setRows(next);
    setCache("ideas", next);
    setEditId(null);
    if (await dbUpdate("ideas", id, { text: t })) {
      toast("Idée modifiée ✓");
      const c = (prev ?? []).find((r) => r.id === id)?.creator;
      if (c) notifyCreatorsChange("idea", [c], "text", t, id);
    } else {
      // Échec : retour à l'ancien texte, et le champ d'édition se rouvre.
      setRows(prev);
      if (prev) setCache("ideas", prev);
      setEditId(id);
      toast("Erreur, réessaie");
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const prev = rows;
    const next = (rows ?? []).map((r) => (r.id === id ? { ...r, status } : r));
    setRows(next);
    setCache("ideas", next);
    if (!(await dbUpdate("ideas", id, { status }))) {
      // Échec : on restaure l'état ET le cache pour ne pas afficher un faux statut.
      setRows(prev);
      if (prev) setCache("ideas", prev);
      toast("Erreur, réessaie");
    }
  };

  // Sous-tâches (checklist interne à l'idée) — persiste base + cache.
  // Même principe que Todo (todoQueue) : affichage optimiste depuis la DERNIÈRE version de
  // la ligne (ref à jour sans attendre le rendu), écritures d'une même idée sérialisées, et
  // retour arrière seulement si rien n'a bougé depuis → deux coches rapides ne se contredisent plus.
  const rowsRef = useRef<Row[] | null>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const subtaskQueue = useRef<Record<string, Promise<boolean>>>({});
  const saveSubtasks = (id: string, subtasks: Subtask[]): Promise<boolean> => {
    const cur = (rowsRef.current ?? []).find((r) => r.id === id);
    if (!cur) return Promise.resolve(false);
    const back = cur.subtasks ?? null;
    const apply = (fn: (r: Row) => Row) => {
      const next = (rowsRef.current ?? []).map((r) => (r.id === id ? fn(r) : r));
      rowsRef.current = next;
      setRows(next);
      setCache("ideas", next);
    };
    apply((r) => ({ ...r, subtasks }));
    // Une sous-tâche AJOUTÉE (pas une coche) : le créateur de l'idée est prévenu.
    const added = subtasks.length > (back?.length ?? 0);
    const run = async () => {
      if (await dbUpdate("ideas", id, { subtasks })) {
        if (added && cur.creator) notifyCreatorsChange("idea", [cur.creator], "subtask", cur.text, id);
        return true;
      }
      // Échec : retour arrière seulement si aucune coche plus récente n'a remplacé celle-ci
      apply((r) => (r.subtasks === subtasks ? { ...r, subtasks: back } : r));
      toast("Sous-tâche non enregistrée, réessaie");
      return false;
    };
    const p = (subtaskQueue.current[id] ?? Promise.resolve(true)).then(run, run);
    subtaskQueue.current[id] = p;
    return p;
  };

  const removeRow = async (id: string) => {
    const r = (rows ?? []).find((x) => x.id === id);
    if (await dbTrash("ideas", id, r?.text ?? "Idée", r?.creator ?? undefined)) {
      const next = (rows ?? []).filter((x) => x.id !== id);
      setRows(next);
      setCache("ideas", next);
      toast("Déplacée dans la corbeille");
    } else toast("Erreur, réessaie");
  };

  // Base : filtre créatrice seul → sert aussi aux compteurs des pastilles de statut.
  const creatorBase =
    rows === null
      ? null
      : rows.filter((r) =>
          creatorFilter === ""
            ? true
            : creatorFilter === "__general__"
              ? !r.creator
              : (r.creator ?? "").toLowerCase() === creatorFilter.toLowerCase(),
        );
  const filtered =
    creatorBase === null
      ? null
      : creatorBase.filter((r) => statusFilter === ALL_STATUS || (r.status ?? "À faire") === statusFilter);

  return (
    <div>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {rows === null
            ? "Chargement…"
            : `${rows.length} idée${rows.length > 1 ? "s" : ""}`}
        </div>
        <AddButton label="Idée" onClick={() => setFormOpen(true)} />
      </PageHeaderRow>

      {/* Synthèse (bento) */}
      {rows !== null && rows.length > 0 && (() => {
        const cnt = (s: string) => rows.filter((r) => (r.status ?? "À faire") === s).length;
        const explorer = cnt("À explorer"), aFaire = cnt("À faire"), enCours = cnt("En cours"), publiee = cnt("Publiée");
        return (
          <StatsBento phoneStrip
            className="mb-5"
            primary={{ eyebrow: "Idées publiées", value: String(publiee), caption: `sur ${rows.length} idée${rows.length > 1 ? "s" : ""} au total.` }}
            bars={{ label: "Par statut", value: `${enCours} en cours`, series: [explorer, aFaire, enCours, publiee] }}
            small={{ value: String(enCours), label: "En cours" }}
            accent={{ value: String(explorer), label: "À explorer", icon: Sparkles }}
          />
        );
      })()}

      {/* Panneau de filtres */}
      {rows !== null && rows.length > 0 && (() => {
        const activeCount =
          (statusFilter !== ALL_STATUS ? 1 : 0) + (creatorFilter !== "" ? 1 : 0);
        const groups: FilterGroup[] = [
          {
            id: "statut",
            label: "Statut",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: ALL_STATUS, label: "Tous", count: (creatorBase ?? []).length },
              ...STATUS_FILTERS.map((s) => ({
                value: s,
                label: s,
                count: (creatorBase ?? []).filter((r) => (r.status ?? "À faire") === s).length,
              })),
            ],
          },
        ];
        return (
          <FilterPanel
            className="mb-4"
            activeCount={activeCount}
            groups={groups}
            onClear={() => { setStatusFilter(ALL_STATUS); setCreatorFilter(""); }}
            extra={creators.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">Créateur</span>
                <Select value={creatorFilter} onValueChange={setCreatorFilter}>
                  <SelectTrigger icon={UserRound} className="h-10 w-full min-w-[220px] rounded-xl bg-surface sm:w-auto" placeholder="Tous les créateurs" />
                  <SelectContent>
                    <SelectItem index={0} value="">Tous les créateurs</SelectItem>
                    <SelectItem index={1} value="__general__">Idées générales (non assignées)</SelectItem>
                    {creatorOptions.map((o, i) => (
                      <SelectItem key={o.value} index={i + 2} value={o.value} img={o.img}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : undefined}
          />
        );
      })()}

      <InlineForm
        open={formOpen}
        title="Nouvelle idée"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <AutoGrowTextField label="Idée" value={text} onChange={setText} placeholder="Décris ton idée, le champ s'agrandit tout seul…" className="min-w-full" mentions={creators} />
        <CreatorPickerField label="Créateur" value={formCreator} onChange={setFormCreator} creators={creators} emptyLabel="Idée générale" />
        <TextField label="Commentaire (optionnel)" value={note} onChange={setNote} placeholder="Infos, rappel, lien…" />
      </InlineForm>

      {rows === null ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
        </div>
      ) : filtered !== null && filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">
          {error
            ? "Impossible de charger les idées."
            : rows.length > 0
              ? "Aucune idée pour ce filtre."
              : "Aucune idée pour le moment. Ajoute la première 💡"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(filtered ?? []).map((row) => (
            <div
              key={row.id}
              // Un clic sur l'idée efface son repère « nouveau ».
              onClickCapture={() => activity.keys.has(`idea:${row.id}`) && void markActivityRead("idea", row.id)}
              className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5 shadow-sm transition-colors hover:bg-rowhover"
            >
              {editId === row.id ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">Modifier l'idée</span>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="Ton idée de contenu…"
                    className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(row.id)}
                      className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" /> Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                      title="Annuler"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">
                      {activity.keys.has(`idea:${row.id}`) && <NewDot label="Du nouveau d'un créateur" className="mr-1.5 align-middle" />}
                      {row.text}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {row.creator ? titleCase(row.creator) : "Idée générale"} ·{" "}
                      {row.source === "creator" ? "Proposée par le créateur" : "Ajoutée par l'agence"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <div className="flex-1 sm:w-[160px] sm:flex-none">
                      <StatusSelect
                        value={row.status ?? "À faire"}
                        options={STATUS_OPTS}
                        onChange={(v) => updateStatus(row.id, v)}
                      />
                    </div>
                    <ActionMenu
                      items={[
                        {
                          key: "edit",
                          label: "Modifier l'idée",
                          icon: Pencil,
                          onClick: () => startEdit(row),
                        },
                        {
                          key: "delete",
                          label: "Mettre à la corbeille",
                          icon: Trash2,
                          danger: true,
                          onClick: () => removeRow(row.id),
                          confirm: { title: "Mettre à la corbeille", message: `Déplacer « ${row.text} » vers la corbeille ? Tu pourras la restaurer.`, confirmLabel: "Mettre à la corbeille" },
                        },
                      ]}
                    />
                  </div>
                </div>
              )}

              {/* Commentaire (agence) */}
              {editNoteId === row.id ? (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-panel p-3">
                  <span className="text-[11px] font-medium text-muted-foreground">Commentaire</span>
                  <textarea
                    value={editNoteText}
                    onChange={(e) => setEditNoteText(e.target.value)}
                    rows={2}
                    autoFocus
                    placeholder="Infos, rappel, lien…"
                    className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await saveNote(row.id, editNoteText))) return;
                        setEditNoteId(null);
                        toast("Commentaire enregistré ✓");
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" /> Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditNoteId(null)}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                      title="Annuler"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : notes[row.id] ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditNoteId(row.id);
                    setEditNoteText(notes[row.id]);
                  }}
                  className="mt-2 flex w-full items-start gap-2 rounded-xl bg-panel px-3 py-2 text-left transition-colors hover:bg-rowhover"
                  title="Modifier le commentaire"
                >
                  <MessageSquarePlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                  <span className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{notes[row.id]}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditNoteId(row.id);
                    setEditNoteText("");
                  }}
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-faint transition-colors hover:text-foreground"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" /> Ajouter un commentaire
                </button>
              )}

              {/* Sous-tâches (checklist repliable) */}
              <SubtaskChecklist
                className="mt-3"
                value={row.subtasks ?? []}
                onChange={(next) => saveSubtasks(row.id, next)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


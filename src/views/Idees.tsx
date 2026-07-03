import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
} from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { Trash2, MessageSquarePlus, Check, X } from "lucide-react";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import { useEffect, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { getCache, setCache } from "@/lib/viewCache";

type Row = {
  id: string;
  text: string;
  creator: string | null;
  status: string | null;
  source: string | null;
  sort_order: number | null;
};

const STATUS_OPTS: StatusOption[] = [
  { value: "À explorer", label: "À explorer", dot: "bg-indigo" },
  { value: "À faire", label: "À faire", dot: "bg-primary" },
  { value: "En cours", label: "En cours", dot: "bg-cyan" },
  { value: "Publiée", label: "Publiée", dot: "bg-signal" },
];

const STATUS_FILTERS = ["À explorer", "À faire", "En cours", "Publiée"];
const ALL_STATUS = "__all__";

export function Idees() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("ideas"));
  const [error, setError] = useState<boolean>(false);
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUS);

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
  const saveNote = async (id: string, value: string) => {
    const next = { ...notes };
    if (value.trim()) next[id] = value.trim();
    else delete next[id];
    setNotes(next);
    await saveAppStateKey("itemNotes", next);
  };

  useEffect(() => {
    let active = true;
    supabase
      .from("ideas")
      .select("id, text, creator, status, source, sort_order")
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
      creator: null,
      status: "À faire",
      source: "agency",
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("ideas", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    const createdRow = created as unknown as Row;
    setRows([...(rows ?? []), createdRow]);
    if (note.trim()) await saveNote(createdRow.id, note);
    toast("Idée ajoutée ✓");
    setFormOpen(false);
    setText("");
    setNote("");
  };

  const updateStatus = async (id: string, status: string) => {
    setRows((prev) =>
      (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)),
    );
    if (!(await dbUpdate("ideas", id, { status }))) {
      toast("Erreur — réessaie");
    }
  };

  const removeRow = async (id: string) => {
    const r = (rows ?? []).find((x) => x.id === id);
    if (await dbTrash("ideas", id, r?.text ?? "Idée", r?.creator ?? undefined)) {
      setRows((prev) => (prev ?? []).filter((x) => x.id !== id));
      toast("Déplacée dans la corbeille");
    }
  };

  const filtered =
    rows === null
      ? null
      : statusFilter === ALL_STATUS
        ? rows
        : rows.filter((r) => (r.status ?? "À faire") === statusFilter);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows === null
            ? "Chargement…"
            : `${rows.length} idée${rows.length > 1 ? "s" : ""}`}
        </div>
        <AddButton label="Idée" onClick={() => setFormOpen(true)} />
      </div>

      {/* Barre de filtres par statut */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter(ALL_STATUS)}
          className={cn(chipBase, statusFilter === ALL_STATUS ? chipActive : chipInactive)}
        >
          Tous
        </button>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(chipBase, statusFilter === s ? chipActive : chipInactive)}
          >
            {s}
          </button>
        ))}
      </div>

      <InlineForm
        open={formOpen}
        title="Nouvelle idée"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Idée" value={text} onChange={setText} />
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
              className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-rowhover"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{row.text}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.creator ? titleCase(row.creator) : "Toutes"} ·{" "}
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
                        key: "note",
                        label: notes[row.id] ? "Modifier le commentaire" : "Ajouter un commentaire",
                        icon: MessageSquarePlus,
                        onClick: () => {
                          setEditNoteId(row.id);
                          setEditNoteText(notes[row.id] ?? "");
                        },
                      },
                      {
                        key: "delete",
                        label: "Supprimer",
                        icon: Trash2,
                        danger: true,
                        onClick: () => removeRow(row.id),
                        confirm: { title: "Supprimer l'idée", message: `Supprimer « ${row.text} » ? Cette action est irréversible.` },
                      },
                    ]}
                  />
                </div>
              </div>

              {/* Commentaire (agence) */}
              {editNoteId === row.id ? (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-panel p-3">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Commentaire</span>
                  <textarea
                    value={editNoteText}
                    onChange={(e) => setEditNoteText(e.target.value)}
                    rows={2}
                    autoFocus
                    placeholder="Infos, rappel, lien…"
                    className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await saveNote(row.id, editNoteText);
                        setEditNoteId(null);
                        toast("Commentaire enregistré ✓");
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" /> Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditNoteId(null)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const chipBase =
  "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors";
const chipActive = "bg-primary text-primary-foreground";
const chipInactive = "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground";

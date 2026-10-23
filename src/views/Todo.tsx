import { supabase } from "@/lib/supabase";
import { TtpChecklist, TtpClock, TtpMission, TtpPlanning, TtpProgress, TtpRepeat } from "@/components/icons/ttp-icons";
import { cn, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddMenuButton,
  InlineForm,
  TextField,
  SelectField,
  AutoGrowTextField,
  Field,
} from "@/components/ui/form";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { Tabs } from "@/components/ui/animated-tabs";
import { IconTile } from "@/components/ui/icon-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { Kbd } from "@/components/ui/kbd";
import { CreatorMultiPicker, CreatorStack } from "@/components/ui/creator-multi-picker";
import { SwipeRow } from "@/components/mobile/swipe-row";
import { useCreators } from "@/lib/useCreators";
import { notifyCreator, notifyCreatorsChange } from "@/lib/push";
import type { ActivityWhat } from "@/lib/activityEvents";
import { markActivityRead, useActivityEvents } from "@/lib/useActivityEvents";
import { NewDot } from "@/components/ui/new-dot";
import { writeTodoStatus } from "@/lib/todoStatus";
import { useIntent } from "@/lib/openIntent";
import { useLiveKey } from "@/lib/useLive";
import { useIsPhone } from "@/lib/iosUi";
import { fmtDay, fmtDayTime, toISODate, todayISO } from "@/lib/dates";
import { useStickyState } from "@/lib/useStickyState";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { insertMention, mentionAt, mentionSuggestions, parseQuickAdd } from "@/lib/todoQuickAdd";
import { creatorsLabel, creatorsPatch, hasCreator, joinNames, todoCreators } from "@/lib/todoCreators";
import { CollabField, ObjectCollabLink } from "@/components/collab-links";
import { setCollabLink } from "@/lib/collabLinksDb";
import { noteCreatorsColumn, todosHaveCreators } from "@/lib/todoCreatorsDb";
import { appendPoint, latestPoint, parsePoints, progressColumnMissing } from "@/lib/todoProgress";
import { TONE_DOT, TONE_TEXT, type StatusTone } from "@/lib/statusTone";
import { useAppState, mergeAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { getCache, setCache } from "@/lib/viewCache";
import { openLater } from "@/lib/openLater";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { X, Pencil, Trash2, MessageSquarePlus, Check, List, Columns3, UserRound, Building2, Plus, Upload, Type, AlignLeft, CalendarClock, ArrowUp, Forward, RotateCcw, Paperclip } from "@/components/icons";
import { WeeklyRoutines } from "@/components/WeeklyRoutines";
import { FileCard, fileFormatOf } from "@/components/ui/file-card-collections";
import { PageHeaderRow } from "@/components/ui/page-header";
import { PhoneStrip } from "@/components/ui/phone-bar";
import { DoneCircle, InfoRow } from "@/components/todo-parts";
import { Overlay } from "@/components/mobile/ios-sheet";

type Priority = "haute" | "moyenne" | "basse";
type Source = "agency" | "creator";

type Subtask = { id: string; text: string; done: boolean };
type Attachment = { name: string; size: string; path: string };
type Row = {
  id: string;
  text: string;
  descr: string | null;
  tag: string | null;
  due: string | null;
  /** Premier créateur de la liste (gardé pour les anciens lecteurs). */
  creator: string | null;
  /** Tous les créateurs de la tâche (colonne ajoutée par le SQL 2026-10-21 ; absente avant). */
  creators?: string[] | null;
  priority: Priority;
  source: Source;
  done: boolean;
  status?: string | null;
  sort_order: number;
  created_at: string | null;
  subtasks?: Subtask[] | null;
  attachments?: Attachment[] | null;
  /** Traçabilité du « Fait » : quand et par qui (colonnes ajoutées par le SQL équipe). */
  done_at?: string | null;
  done_by?: string | null;
  /** Points d'avancement, visibles du créateur (SQL 2026-10-22 ; avant : blob `itemNotes`). */
  progress?: string | null;
};

let _stid = 0;
const stid = () => `st${Date.now().toString(36)}${(_stid += 1)}`;

const TODO_STATUS_OPTS: StatusOption[] = [
  { value: "À faire", label: "À faire", dot: TONE_DOT.wait },
  { value: "En cours", label: "En cours", dot: TONE_DOT.progress },
  { value: "Fait", label: "Fait", dot: TONE_DOT.ok },
];
/** Statut affiché : colonne status si présente, sinon dérivé de `done`. */
const todoStatus = (r: Row): string => r.status ?? (r.done ? "Fait" : "À faire");
/** Une tâche terminée est TOUJOURS « Fait » (le statut stocké peut être en retard sur `done`). */
const statusOf = (r: Row): string => (r.done ? "Fait" : todoStatus(r));

/** Libellé SÛR de la priorité. `todos.priority` n'a pas de contrainte CHECK en base →
 *  une valeur inconnue (legacy/import) est possible ; repli sur la valeur brute. */
const PRIO_LABEL: Record<Priority, string> = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" };
const prioLabel = (p: string): string => (Object.hasOwn(PRIO_LABEL, p) ? PRIO_LABEL[p as Priority] : p || "Aucune");
/** Couleur de la priorité : haute = attente (orange), le reste en gris clôturé. */
const prioTone = (p: string): StatusTone => (p === "haute" ? "wait" : "closed");

// Groupes de la liste, par priorité (une priorité inconnue tombe dans « Autre »).
const PRIO_GROUPS: { key: Priority | "autre"; label: string }[] = [
  { key: "haute", label: "Priorité haute" },
  { key: "moyenne", label: "Priorité moyenne" },
  { key: "basse", label: "Priorité basse" },
  { key: "autre", label: "Autre priorité" },
];

// ── Dates (toujours en date LOCALE, jamais d'UTC) ──
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** "YYYY-MM-DD" → minuit local. */
const localDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const plusDaysISO = (iso: string, n: number) => {
  const d = localDay(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
/** Jours de retard d'une tâche ouverte dont l'échéance est passée (0 sinon). */
function lateDays(r: Row): number {
  if (r.done) return 0;
  const iso = toISODate(r.due);
  const today = todayISO();
  if (!iso || iso >= today) return 0;
  return Math.round((localDay(today).getTime() - localDay(iso).getTime()) / 86400000);
}
/** Titre de ligne : 45 caractères au plus, le texte entier reste dans la fiche et au survol. */
const clip45 = (t: string) => (t.length > 45 ? `${t.slice(0, 44).trimEnd()}…` : t);
/** « 13 oct. » (ligne de la liste), null si aucune date. */
const shortDay = (iso: string | null | undefined): string | null => fmtDay(iso) || null;
/** Échéance lisible : « 14 oct. », texte libre gardé tel quel (« fin juin »), null si aucune. */
function dueLabel(due: string | null): string | null {
  const iso = toISODate(due);
  if (iso) return fmtDay(iso);
  const t = (due ?? "").trim();
  return t && t !== "—" ? t : null;
}
/** Point de départ d'un report : l'échéance si elle est à venir, sinon aujourd'hui. */
const postponeBase = (r: Row): string => {
  const iso = toISODate(r.due);
  const today = todayISO();
  return iso && iso > today ? iso : today;
};

/** « le 3 oct. à 14:32 · Marc » : quand et par qui une tâche a été faite. */
const formatDone = (r: Pick<Row, "done_at" | "done_by">): string | null =>
  r.done_at
    ? `le ${fmtDayTime(r.done_at)}${r.done_by ? ` · ${r.done_by}` : ""}`
    : null;

// Écran large (≥ 1024 px) : liste + fiche à droite. En dessous, la fiche s'ouvre en feuille.
const desktopMq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (fn) => {
      desktopMq?.addEventListener("change", fn);
      return () => desktopMq?.removeEventListener("change", fn);
    },
    () => !!desktopMq?.matches,
    () => true,
  );
}

/**
 * Fiche de droite : sa hauteur suit la place visible sous elle (de son haut jusqu'au bas
 * de l'écran, 20 px de marge). Sans ça, tant que la page n'a pas défilé, le bas de la
 * fiche (points d'avancement, boutons) sortait de l'écran.
 */
function useFitViewport(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = Math.max(el.getBoundingClientRect().top, 20);
        el.style.maxHeight = `${Math.max(320, Math.round(window.innerHeight - top - 20))}px`;
      });
    };
    fit();
    // Le défilement se fait dans le conteneur de l'app (pas la fenêtre) : écoute en capture.
    window.addEventListener("scroll", fit, { capture: true, passive: true });
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", fit, { capture: true });
      window.removeEventListener("resize", fit);
      el.style.maxHeight = "";
    };
  }, [ref, active]);
}

// Filtre créateur : null = tous, "__agency__" = agence, sinon nom du créateur.
type CreatorFilter = null | "__agency__" | string;
// Filtre priorité : null = toutes, sinon la priorité.
type PriorityFilter = null | Priority;

// Filtre de vue par statut (comme CreatorSpace) + « En retard » (échéance passée).
type TodoFilter = "encours" | "retard" | "terminees" | "toutes";
const TODO_FILTERS: { id: TodoFilter; label: string }[] = [
  { id: "encours", label: "Pas terminées" },
  { id: "retard", label: "En retard" },
  { id: "terminees", label: "Terminées" },
  { id: "toutes", label: "Toutes" },
];
const matchTodoFilter = (f: TodoFilter, r: Row) =>
  f === "encours" ? !r.done : f === "retard" ? lateDays(r) > 0 : f === "terminees" ? r.done : true;

// Tuiles du haut : chacune est un filtre de la liste.
type KpiId = "encours" | "retard" | "prioritaires" | "terminees";

export function Todo() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("todos"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();
  const isDesktop = useIsDesktop();
  const isPhone = useIsPhone();

  const [formOpen, setFormOpen] = useState(false);
  const [routineAdd, setRoutineAdd] = useState(0); // « + Tâche → Chaque semaine »
  const [text, setText] = useState("");
  const [descr, setDescr] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("moyenne");
  const [creatorList, setCreatorList] = useState<string[]>([]);
  const [collabId, setCollabId] = useState(""); // formulaire : collab à relier (après le SQL collab_id)
  // Bouton dédié « Tâche agence » : ouvre le formulaire verrouillé sur l'agence
  // (aucun créateur) et masque le champ « Pour qui » → tâche interne, sans créateur.
  const [forceAgency, setForceAgency] = useState(false);
  // « + » d'Aujourd'hui ou « Nouvelle tâche » de la palette ⌘K : ouvre le formulaire.
  useIntent("todo:new", () => {
    setForceAgency(false);
    setFormOpen(true);
  });
  // Repères « nouveau » : tâches sur lesquelles un créateur a écrit (activity_events).
  const activity = useActivityEvents("agency");
  // Notification « du nouveau sur une tâche » : ouvre la fiche de la tâche.
  const pickRef = useRef<(id: string) => void>(() => {});
  useIntent("todo:open", (id) => {
    if (id) pickRef.current(id);
  });

  // Points d'avancement : colonne `todos.progress` (le créateur les voit) ; avant le SQL
  // 2026-10-22, ou pour une tâche pas encore reprise, l'ancien blob agence `itemNotes`.
  const { data: notesData } = useAppState<Record<string, string>>(
    (s: AppState) => (s["itemNotes"] as Record<string, string>) ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (notesData) setNotes(notesData);
  }, [notesData]);
  const noteOf = (id: string): string => {
    const col = (rows ?? []).find((r) => r.id === id)?.progress;
    return col && col.trim() ? col : notes[id] ?? "";
  };
  // Ancien rangement (blob) : avant le SQL, ou si la colonne manque.
  const saveNoteBlob = async (id: string, value: string): Promise<boolean> => {
    try {
      // Relit la map FRAÎCHE avant d'écrire (jamais depuis l'état local : on
      // écraserait les commentaires posés depuis un autre poste / pas encore chargés).
      invalidateAppState();
      const fresh = ((await getAppState())["itemNotes"] as Record<string, string>) ?? {};
      const next = { ...fresh };
      if (value.trim()) next[id] = value.trim();
      else delete next[id];
      // N'envoie QUE ce commentaire (posé ou retiré), fusionné côté base.
      const ok = value.trim()
        ? await mergeAppStateKey("itemNotes", { [id]: value.trim() })
        : await mergeAppStateKey("itemNotes", {}, [id]);
      if (!ok) return false;
      setNotes(next);
      return true;
    } catch {
      return false; // lecture du blob impossible (réseau…)
    }
  };
  // Renvoie true si le commentaire est bien enregistré (les appelants affichent le toast).
  const saveNote = async (id: string, value: string): Promise<boolean> => {
    const v = value.trim();
    if (v === noteOf(id).trim()) return true; // rien de changé
    const { error } = await supabase.from("todos").update({ progress: v || null }).eq("id", id);
    if (error) return progressColumnMissing(error) ? saveNoteBlob(id, v) : false;
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, progress: v || null } : r)));
    // L'ancien point du blob ne doit pas revenir (ex. avancement vidé) : retiré, sans bloquer.
    if (notes[id]) void saveNoteBlob(id, "");
    return true;
  };
  // Édition du commentaire d'avancement (dans la fiche).
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteEditText, setNoteEditText] = useState("");
  const startNote = (id: string) => {
    setNoteEditId(id);
    setNoteEditText(noteOf(id));
  };
  // « Points d'avancement » : un nouveau point s'ajoute à la suite du commentaire.
  const [pointInput, setPointInput] = useState("");
  const pointRef = useRef<HTMLInputElement>(null);
  // « Où j'en suis » (haut de la fiche) : descend jusqu'au champ d'ajout d'un point.
  const focusPoint = (id: string) => {
    if (noteEditId === id) return;
    const el = pointRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const addPoint = async (row: Row) => {
    const t = pointInput.trim();
    if (!t) return;
    // Point daté (« 21/10/2026 · … ») ajouté à la suite des précédents.
    if (await saveNote(row.id, appendPoint(noteOf(row.id), t, new Date(), "Agence"))) {
      setPointInput("");
      toast("Point d'avancement ajouté ✓");
      notifyCreatorsChange("todo", todoCreators(row), "progress", row.text, row.id);
    } else {
      toast("Avancement non enregistré, réessaie");
    }
  };

  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>(null);
  // Filtres priorité et statut : retenus sur l'appareil (les tuiles du haut les pilotent).
  const [prioRaw, setPrioRaw] = useStickyState("todo:priorite", ["__all__", "haute", "moyenne", "basse"] as const, "__all__");
  const priorityFilter: PriorityFilter = prioRaw === "__all__" ? null : prioRaw;
  const setPriorityFilter = (p: PriorityFilter) => setPrioRaw(p ?? "__all__");
  const [todoFilter, setTodoFilter] = useStickyState<TodoFilter>("todo:statut", ["encours", "retard", "terminees", "toutes"], "encours");

  // Tâche ouverte dans la fiche (à droite sur grand écran, en feuille sinon).
  const [selId, setSelId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Panneaux de la fiche, liés à UNE tâche (changer de tâche les referme).
  const [pane, setPane] = useState<{ id: string; kind: "reporter" | "deleguer" } | null>(null);
  const [subsOpenId, setSubsOpenId] = useState<string | null>(null);
  const [confirmAtt, setConfirmAtt] = useState<{ todo: Row; att: Attachment } | null>(null); // confirmation retrait pièce jointe
  const [toTrash, setToTrash] = useState<Row | null>(null); // glisser « Supprimer » (iPhone)
  const [subInput, setSubInput] = useState(""); // saisie nouvelle sous-tâche
  const attFileRef = useRef<HTMLInputElement>(null);
  const [attUploading, setAttUploading] = useState(false);

  // Persiste un patch de tâche (sous-tâches / pièces jointes / échéance…) : base + local.
  // Optimiste : le patch est calculé depuis la DERNIÈRE version de la ligne (ref à jour
  // sans attendre le rendu) et les écritures d'une même tâche sont sérialisées → deux
  // coches rapides ne s'écrasent plus. Échec = retour arrière si rien n'a bougé depuis.
  const rowsRef = useRef<Row[] | null>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const todoQueue = useRef<Record<string, Promise<boolean>>>({});
  const patchTodo = (id: string, build: (r: Row) => Partial<Row>): Promise<boolean> => {
    const cur = (rowsRef.current ?? []).find((r) => r.id === id);
    if (!cur) return Promise.resolve(false);
    const patch = build(cur);
    const next = { ...cur, ...patch };
    const keys = Object.keys(patch) as (keyof Row)[];
    const back = Object.fromEntries(keys.map((k) => [k, cur[k]])) as Partial<Row>;
    rowsRef.current = (rowsRef.current ?? []).map((r) => (r.id === id ? next : r));
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const run = async () => {
      if (await dbUpdate("todos", id, patch)) return true;
      const untouched = (r: Row) => keys.every((k) => r[k] === next[k]);
      const revert = (r: Row) => (r.id === id && untouched(r) ? { ...r, ...back } : r);
      rowsRef.current = (rowsRef.current ?? []).map(revert);
      setRows((prev) => (prev ?? []).map(revert));
      toast("Modification non enregistrée, réessaie");
      return false;
    };
    const p = (todoQueue.current[id] ?? Promise.resolve(true)).then(run, run);
    todoQueue.current[id] = p;
    return p;
  };
  // Sous-tâches (checklist)
  const addSubtask = (todo: Row) => {
    const t = subInput.trim();
    if (!t) return;
    setSubInput("");
    patchTodo(todo.id, (r) => ({ subtasks: [...(r.subtasks ?? []), { id: stid(), text: t, done: false }] }));
    notifyCreatorsChange("todo", todoCreators(todo), "subtask", todo.text, todo.id);
  };
  const toggleSubtask = (todo: Row, sid: string) =>
    patchTodo(todo.id, (r) => ({ subtasks: (r.subtasks ?? []).map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) }));
  const delSubtask = (todo: Row, sid: string) =>
    patchTodo(todo.id, (r) => ({ subtasks: (r.subtasks ?? []).filter((s) => s.id !== sid) }));
  // Pièces jointes (bucket `documents`, chemin todo-attachments/<id>/…)
  const uploadAttachments = async (todo: Row, files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setAttUploading(true);
    try {
      const added: Attachment[] = [];
      for (const file of list) {
        if (file.size > 15 * 1024 * 1024) { toast(`« ${file.name} » trop lourd (max 15 Mo)`); continue; }
        const ext = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `todo-attachments/${todo.id}/${Date.now()}-${added.length}${ext ? "." + ext : ""}`;
        const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) { toast("Envoi échoué, réessaie"); continue; }
        added.push({ name: file.name, size: `${Math.max(1, Math.round(file.size / 1024))} Ko`, path });
      }
      if (added.length) await patchTodo(todo.id, (r) => ({ attachments: [...(r.attachments ?? []), ...added] }));
    } finally {
      setAttUploading(false);
      if (attFileRef.current) attFileRef.current.value = "";
    }
  };
  const openAttachment = async (att: Attachment) => {
    if (/^https?:\/\//i.test(att.path)) { window.open(att.path, "_blank"); return; }
    // Onglet ouvert dans le clic, avant l'await (sinon bloqué sur iPhone).
    const ok = await openLater(async () => {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(att.path, 3600);
      return error || !data?.signedUrl ? null : data.signedUrl;
    });
    if (!ok) toast("Lien indisponible, réessaie");
  };
  // Base d'abord, fichier ensuite : un échec ne laisse pas une pièce jointe pointant vers rien.
  const removeAttachment = async (todo: Row, path: string) => {
    const ok = await patchTodo(todo.id, (r) => ({ attachments: (r.attachments ?? []).filter((a) => a.path !== path) }));
    if (ok) await supabase.storage.from("documents").remove([path]).catch(() => {});
  };

  // Mode de vue : liste (+ fiche) ↔ colonnes par statut (kanban). Mémorisé (reprend
  // l'ancien réglage « ttp:todo-view » la première fois).
  const [viewMode, setViewMode] = useStickyState<"liste" | "colonnes">("todo:vue", ["liste", "colonnes"], () => {
    try {
      return localStorage.getItem("ttp:todo-view") === "colonnes" ? "colonnes" : "liste";
    } catch {
      return "liste"; // stockage indisponible
    }
  });

  // Prévient le créateur (si notifs activées) quand SA tâche/demande est terminée.
  const notifyTaskDone = (row: Row, status: string) => {
    if (status === "Fait") for (const name of todoCreators(row)) notifyCreator("task-done", name, `✅ Ta demande est faite : « ${row.text} »`);
  };

  /**
   * Écrit le statut d'une tâche + la trace du « Fait » (date et auteur). Repli sans la
   * trace tant que le SQL équipe n'est pas lancé. Renvoie ce qui a été enregistré.
   */
  const writeStatus = (id: string, status: string): Promise<Partial<Row> | null> => writeTodoStatus(id, status);

  // Statut d'une tâche (rond à cocher, fiche, colonnes, ou glisser « Fait » / « Rouvrir » sur iPhone).
  const setStatusTo = async (id: string, status: string) => {
    const row = (rows ?? []).find((r) => r.id === id);
    if (!row) return;
    const saved = await writeStatus(id, status);
    if (saved) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, ...saved } : r)));
      notifyTaskDone(row, status);
    } else {
      toast("Statut non enregistré, réessaie");
    }
  };
  /** Rond à cocher : faite ↔ à refaire. */
  const toggleDone = (row: Row) => void setStatusTo(row.id, row.done ? "À faire" : "Fait");

  // Édition de la tâche ouverte (dans la fiche) : liée à UNE tâche.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDescr, setEditDescr] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("moyenne");
  const [editCreators, setEditCreators] = useState<string[]>([]);

  // Ouvre le mode édition en pré-remplissant depuis la tâche.
  const openEdit = (row: Row) => {
    setEditText(row.text);
    setEditDescr(row.descr ?? "");
    setEditNote(noteOf(row.id));
    setEditDue(toISODate(row.due));
    setEditPriority(row.priority);
    setEditCreators(todoCreators(row));
    setEditingId(row.id);
  };

  const saveEdit = async (row: Row) => {
    if (!editText.trim()) {
      toast("Renseigne la tâche");
      return;
    }
    // Échéance : si l'ancienne valeur est un texte libre illisible (ex. « fin
    // juin ») le champ date arrive vide — on la PRÉSERVE au lieu de l'écraser.
    const oldDue = row.due ?? "";
    const dueVal = editDue.trim()
      ? editDue.trim()
      : oldDue && oldDue !== "—" && !toISODate(oldDue)
        ? oldDue
        : "—";
    const patch = {
      text: editText.trim(),
      descr: editDescr.trim() || null,
      due: dueVal,
      priority: editPriority,
      // creator (le premier), tag, et creators si la colonne existe.
      ...creatorsPatch(editCreators, await todosHaveCreators()),
    };
    if (!(await dbUpdate("todos", row.id, patch))) {
      toast("Erreur, réessaie");
      return;
    }
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.id === row.id ? { ...r, ...patch } : r
      )
    );
    const noteOk = await saveNote(row.id, editNote);
    // Du nouveau pour les créateurs de la tâche (texte ou description).
    const changed: ActivityWhat | null =
      (patch.descr ?? "") !== (row.descr ?? "") && patch.descr ? "description" : patch.text !== row.text ? "text" : null;
    if (changed) notifyCreatorsChange("todo", editCreators, changed, patch.text, row.id);
    setEditingId(null);
    toast(noteOk ? "Tâche modifiée ✓" : "Tâche modifiée, avancement non enregistré : réessaie");
  };

  // « Reporter » : déplace l'échéance (champ `due` existant).
  const postpone = async (row: Row, iso: string) => {
    setPane(null);
    if (await patchTodo(row.id, () => ({ due: iso }))) toast(`Échéance reportée au ${dueLabel(iso)} ✓`);
  };
  // « Déléguer » : change « Pour qui » (un ou plusieurs créateurs, comme dans « Modifier »).
  // Le panneau reste ouvert : on peut cocher plusieurs créateurs à la suite.
  const delegate = async (row: Row, list: string[]) => {
    const patch = creatorsPatch(list, await todosHaveCreators());
    const ok = await patchTodo(row.id, () => patch);
    if (ok) toast(patch.creator ? `Tâche confiée à ${creatorsLabel(list)} ✓` : "Tâche rendue à l'agence ✓");
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("*")
        .order("sort_order");
      if (!active) return;
      if (error) {
        // Rafraîchissement raté : on garde les tâches déjà affichées (l'erreur ne
        // s'affiche que s'il n'y a rien à montrer).
        setError(true);
        setRows((prev) => prev ?? []);
        return;
      }
      const list = (data as Row[]) ?? [];
      noteCreatorsColumn(list);
      setError(false);
      setCache("todos", list);
      setRows(list);
    })();
    return () => {
      active = false;
    };
  }, [live]);

  /** Création d'une tâche (formulaire complet ET barre d'ajout rapide). Renvoie la ligne créée. */
  const createTodo = async (f: { text: string; descr: string; note: string; due: string; priority: Priority; creators: string[] }): Promise<Row | null> => {
    const row = {
      text: f.text.trim(),
      descr: f.descr.trim() || null,
      due: f.due.trim() || "—",
      // creator (le premier), tag, et creators si la colonne existe.
      ...creatorsPatch(f.creators, await todosHaveCreators()),
      priority: f.priority,
      source: "agency" as Source,
      done: false,
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("todos", row);
    if (!created) {
      toast("Erreur, réessaie");
      return null;
    }
    const createdRow = created as unknown as Row;
    if (!("creators" in row) && f.creators.length > 1) toast("Un seul créateur enregistré : la mise à jour de la base (SQL) n'est pas encore faite");
    setRows((prev) => [createdRow, ...(prev ?? [])]);
    // Le commentaire ne bloque jamais la réinitialisation du formulaire (saveNote ne lève pas).
    if (f.note.trim() && !(await saveNote(createdRow.id, f.note))) toast("Avancement non enregistré, réessaie");
    // Push à chaque créateur concerné (s'il a activé les notifs sur son téléphone).
    for (const name of todoCreators({ creators: f.creators })) notifyCreator("task", name, f.text.trim());
    toast("Tâche ajoutée ✓");
    return createdRow;
  };

  const submit = async () => {
    if (!text.trim()) {
      toast("Renseigne la tâche");
      return;
    }
    const created = await createTodo({ text, descr, note, due, priority, creators: forceAgency ? [] : creatorList });
    if (!created) return;
    if (collabId) void setCollabLink("todos", created.id, collabId);
    setCollabId("");
    setFormOpen(false);
    setForceAgency(false);
    setText("");
    setDescr("");
    setNote("");
    setDue("");
    setPriority("moyenne");
    setCreatorList([]);
  };

  // ── Barre d'ajout rapide (« N » pour y aller) ──
  const [quick, setQuick] = useState("");
  // « @ » dans l'ajout rapide : liste des créateurs sous la barre (flèches, Entrée, clic).
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionList = mention ? mentionSuggestions(mention.query, creators) : [];
  const syncMention = (el: HTMLInputElement) => {
    const m = mentionAt(el.value, el.selectionStart ?? el.value.length);
    setMention(m);
    if (!m || m.query !== mention?.query) setMentionIdx(0);
  };
  const pickMention = (name: string) => {
    const el = quickRef.current;
    if (!el || !mention) return;
    const r = insertMention(quick, mention.start, el.selectionStart ?? quick.length, name, creators);
    setQuick(r.text);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(r.caret, r.caret);
    });
  };
  const [quickBusy, setQuickBusy] = useState(false);
  const quickRef = useRef<HTMLInputElement>(null);
  const submitQuick = async () => {
    if (quickBusy) return;
    const parsed = parseQuickAdd(quick, creators);
    if (!parsed.title) {
      toast("Renseigne la tâche");
      return;
    }
    setQuickBusy(true);
    try {
      const created = await createTodo({
        text: parsed.title,
        descr: "",
        note: "",
        due: parsed.due ?? "",
        priority: parsed.priority ?? "moyenne",
        creators: parsed.creators,
      });
      if (created) setQuick("");
    } catch {
      toast("Erreur, réessaie");
    } finally {
      // Jamais laissé bloqué après une erreur ; le champ garde le focus pour la suivante.
      setQuickBusy(false);
      quickRef.current?.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return; // une fenêtre est ouverte
      const input = quickRef.current;
      // Page gardée en mémoire mais cachée (autre onglet) : on ne vole pas la touche.
      if (!input || document.visibilityState !== "visible" || !input.getClientRects().length) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const removeRow = (id: string) => {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    if (selId === id) {
      setSelId(null);
      setSheetOpen(false);
    }
  };

  // Base : recherche + filtre créateur (les tuiles du haut comptent sur cette base).
  const scoped = (rows ?? []).filter((row) => {
    if (!matchQuery(query, row.text, row.descr, todoCreators(row).join(" "), row.tag)) return false;
    // Filtre créateur : une tâche partagée compte pour CHACUN de ses créateurs.
    if (creatorFilter === "__agency__") {
      if (todoCreators(row).length) return false;
    } else if (creatorFilter != null) {
      if (!hasCreator(row, creatorFilter)) return false;
    }
    return true;
  });
  // + filtre priorité (sans le filtre de statut) : base des colonnes.
  const filteredBase = scoped.filter((row) => priorityFilter == null || row.priority === priorityFilter);
  // Vue liste : on applique en plus le filtre En cours / En retard / Terminées / Toutes.
  const filtered = filteredBase.filter((row) => matchTodoFilter(todoFilter, row));
  // Liste groupée par priorité (ordre d'origine dans chaque groupe).
  const groups = PRIO_GROUPS.map((g) => ({
    ...g,
    rows: filtered.filter((r) => (g.key === "autre" ? !Object.hasOwn(PRIO_LABEL, r.priority) : r.priority === g.key)),
  })).filter((g) => g.rows.length > 0);
  const ordered = groups.flatMap((g) => g.rows);

  const noFilterMatch =
    rows !== null &&
    rows.length > 0 &&
    filtered.length === 0 &&
    !(query.trim() && filtered.length === 0);

  // Filtre créateur en Select : le Select ne manipule que des strings, on
  // encode donc null via le sentinel "__all__" (le state garde bien null).
  const ALL = "__all__";
  const creatorSelectValue =
    creatorFilter === null ? ALL : creatorFilter;
  const onCreatorSelect = (v: string) =>
    setCreatorFilter(v === ALL ? null : (v as CreatorFilter));

  const priorityPills: { label: string; value: PriorityFilter }[] = [
    { label: "Toutes", value: null },
    { label: "Haute", value: "haute" },
    { label: "Moyenne", value: "moyenne" },
    { label: "Basse", value: "basse" },
  ];

  // ── Tuiles (compteurs sur la recherche + le créateur choisi) ──
  const kpiCounts: Record<KpiId, number> = {
    encours: scoped.filter((r) => !r.done).length,
    retard: scoped.filter((r) => lateDays(r) > 0).length,
    prioritaires: scoped.filter((r) => !r.done && r.priority === "haute").length,
    terminees: scoped.filter((r) => r.done).length,
  };
  const activeKpi: KpiId | null =
    viewMode !== "liste"
      ? null
      : todoFilter === "retard" && priorityFilter == null
        ? "retard"
        : todoFilter === "encours" && priorityFilter === "haute"
          ? "prioritaires"
          : todoFilter === "encours" && priorityFilter == null
            ? "encours"
            : todoFilter === "terminees" && priorityFilter == null
              ? "terminees"
              : null;
  const pickKpi = (id: KpiId) => {
    setViewMode("liste");
    // Re-cliquer une tuile active (autre que « En cours ») revient à la vue par défaut.
    const target = activeKpi === id ? "encours" : id;
    setTodoFilter(target === "prioritaires" ? "encours" : target);
    setPriorityFilter(target === "prioritaires" ? "haute" : null);
  };
  const KPIS: { id: KpiId; label: string; tone: StatusTone; icon: ReactNode }[] = [
    { id: "encours", label: "En cours", tone: "progress", icon: <TtpProgress /> },
    { id: "retard", label: "En retard", tone: "wait", icon: <TtpClock /> },
    { id: "prioritaires", label: "Prioritaires", tone: "wait", icon: <TtpMission /> },
    { id: "terminees", label: "Terminées", tone: "ok", icon: <TtpChecklist /> },
  ];

  // ── Sélection (fiche) ──
  const creatorByName = new Map(creators.map((c) => [c.name, c]));
  const photoOf = (name: string) => creatorByName.get(name)?.photo_url ?? null;
  /** « Pour » d'une tâche : la liste, « Justine + 2 » (court) et « Justine, Léna et Inès » (complet). */
  const whoOf = (row: Row) => {
    const names = todoCreators(row);
    return { names, short: names.length ? creatorsLabel(names) : "Agence", full: names.length ? joinNames(names) : "Agence" };
  };
  const showInspector = isDesktop && viewMode === "liste" && rows !== null && rows.length > 0;
  const asideRef = useRef<HTMLElement>(null);
  useFitViewport(asideRef, showInspector);
  const inspected = ordered.find((r) => r.id === selId) ?? ordered[0] ?? null;
  const sheetRow = sheetOpen && (!isDesktop || viewMode === "colonnes") ? (rows ?? []).find((r) => r.id === selId) ?? null : null;
  const pick = (id: string) => {
    if (id !== selId) {
      setSubInput("");
      setPointInput("");
    }
    setSelId(id);
    if (!isDesktop || viewMode === "colonnes") setSheetOpen(true);
    void markActivityRead("todo", id);
  };
  pickRef.current = pick;
  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
  };

  // Supprimer = corbeille (restaurable), depuis le menu ⋯ ou en glissant la ligne.
  const trashTodo = async (row: Row) => {
    if (await dbTrash("todos", row.id, row.text, row.creator ?? undefined)) {
      removeRow(row.id);
      toast("Déplacé dans la corbeille");
    } else {
      toast("Erreur, réessaie");
    }
  };
  const trashConfirm = (row: Row) => ({
    title: "Mettre à la corbeille",
    message: `Déplacer « ${row.text} » vers la corbeille ? Tu pourras la restaurer.`,
    confirmLabel: "Mettre à la corbeille",
  });

  // ── Ligne de la liste ──
  const renderRow = (row: Row) => {
    const late = lateDays(row);
    const on = showInspector && inspected?.id === row.id;
    const subs = row.subtasks ?? [];
    const subDone = subs.filter((s) => s.done).length;
    const status = statusOf(row);
    const day = shortDay(row.created_at);
    const atts = row.attachments?.length ?? 0;
    const who = whoOf(row);
    return (
      <li key={row.id}>
        <SwipeRow
          actions={[
            row.done
              ? { key: "reopen", label: "Rouvrir", icon: RotateCcw, tone: "gray", onClick: () => void setStatusTo(row.id, "À faire") }
              : { key: "done", label: "Fait", icon: Check, tone: "green", onClick: () => void setStatusTo(row.id, "Fait") },
            { key: "delete", label: "Supprimer", icon: Trash2, tone: "red", onClick: () => setToTrash(row) },
          ]}
        >
          <div
            role="button"
            tabIndex={0}
            aria-current={on ? "true" : undefined}
            onClick={() => pick(row.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick(row.id);
              }
            }}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-[14px] px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 sm:px-3",
              on ? "bg-primary/[0.06] ring-[1.5px] ring-inset ring-primary" : "hover:bg-rowhover",
            )}
          >
            <DoneCircle done={row.done} high={row.priority === "haute"} onToggle={() => toggleDone(row)} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-[15px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere] max-md:line-clamp-2 md:truncate",
                  row.done && "text-muted-foreground line-through decoration-faint",
                )}
                title={row.text.length > 45 ? row.text : undefined}
              >
                {activity.keys.has(`todo:${row.id}`) && <NewDot label="Du nouveau d'un créateur" className="mr-1.5 align-middle" />}
                {clip45(row.text)}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
                <CreatorStack names={who.names} photoOf={photoOf} size="xs" />
                <span className="font-medium text-foreground/80" title={who.full}>{who.short}</span>
                {/* Trois infos au plus : qui · une date · pièces jointes. La date (déjà dans la fiche)
                    laisse la place au titre sur téléphone. */}
                {row.done && row.done_at ? (
                  <span className={TONE_TEXT.ok}>· faite le {shortDay(row.done_at)}</span>
                ) : row.source === "creator" ? (
                  <span>· demandée{day && <span className="max-sm:hidden"> le {day}</span>}</span>
                ) : (
                  day && <span className="max-sm:hidden">· créée le {day}</span>
                )}
                {atts > 0 && (
                  <span className="inline-flex items-center gap-0.5" title={`${atts} pièce${atts > 1 ? "s" : ""} jointe${atts > 1 ? "s" : ""}`}>
                    · <Paperclip className="h-3 w-3" /> {atts}
                  </span>
                )}
                {noteOf(row.id) && <MessageSquarePlus className="h-3 w-3" aria-label="Point d'avancement" />}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {subs.length > 0 && (
                <span className="inline-flex h-6 items-center rounded-full bg-field px-2 text-[12px] font-semibold tabular-nums text-muted-foreground" title="Sous-tâches faites">
                  {subDone} / {subs.length}
                </span>
              )}
              {late > 0 ? (
                <StatusPill tone="wait">
                  <span className="sm:hidden">{late} j</span>
                  <span className="max-sm:hidden">{late} j de retard</span>
                </StatusPill>
              ) : row.done ? (
                <StatusPill tone="ok" className="max-sm:hidden">Faite</StatusPill>
              ) : status === "En cours" ? (
                <StatusPill tone="progress">En cours</StatusPill>
              ) : null}
            </div>
          </div>
        </SwipeRow>
      </li>
    );
  };

  // ── Formulaire « Modifier » (dans la fiche) ──
  const renderEditForm = (row: Row) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void saveEdit(row);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Tâche" value={editText} onChange={setEditText} className="min-w-full" mentions={creators} />
        <AutoGrowTextField label="Description" value={editDescr} onChange={setEditDescr} className="min-w-full" mentions={creators} />
        <TextField label="Avancement" value={editNote} onChange={setEditNote} className="min-w-full" placeholder="Infos en plus, rappel, lien…" mentions={creators} />
        <TextField label="Échéance" type="date" value={editDue} onChange={setEditDue} />
        <SelectField
          label="Priorité"
          value={editPriority}
          onChange={(v) => setEditPriority(v as Priority)}
          options={[
            { value: "haute", label: "Haute" },
            { value: "moyenne", label: "Moyenne" },
            { value: "basse", label: "Basse" },
          ]}
        />
        <Field label="Pour qui">
          <CreatorMultiPicker ariaLabel="Pour qui" value={editCreators} onChange={setEditCreators} creators={creators} agencyLabel="L'agence (tâche interne)" />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditingId(null)}
          className="h-10 shrink-0 rounded-full bg-field px-5 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover"
        >
          Annuler
        </button>
        <button type="submit" className="h-10 shrink-0 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
          Enregistrer
        </button>
      </div>
    </form>
  );

  // ── Fiche de la tâche (colonne de droite, ou feuille sur petit écran) ──
  const renderInspector = (row: Row, inSheet: boolean) => {
    const late = lateDays(row);
    const subs = row.subtasks ?? [];
    const subDone = subs.filter((s) => s.done).length;
    const subsOpen = subsOpenId === row.id;
    const atts = row.attachments ?? [];
    const dueText = dueLabel(row.due);
    const created = row.created_at ? new Date(row.created_at) : null;
    const paneKind = pane?.id === row.id ? pane.kind : null;
    const who = whoOf(row);
    const points = parsePoints(noteOf(row.id));
    const last = latestPoint(noteOf(row.id));
    const closeBtn = inSheet && (
      <button
        type="button"
        onClick={closeSheet}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
        aria-label="Fermer"
      >
        <X className="h-5 w-5" />
      </button>
    );

    if (editingId === row.id) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [&>*]:shrink-0">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[20px] font-bold leading-tight tracking-[-0.02em] text-foreground">Modifier la tâche</h2>
            {closeBtn}
          </div>
          {renderEditForm(row)}
        </div>
      );
    }

    return (
      <>
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-1 pb-4 [&>*]:shrink-0">
          {/* Titre : rond à cocher + intitulé, menu ⋯ (toutes les actions) */}
          <div className="flex items-start gap-3">
            <DoneCircle done={row.done} high={row.priority === "haute"} onToggle={() => toggleDone(row)} size="lg" />
            <h2
              className={cn(
                "min-w-0 flex-1 pt-px text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground [overflow-wrap:anywhere]",
                row.done && "text-muted-foreground line-through decoration-faint",
              )}
            >
              {row.text}
            </h2>
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
              <ActionMenu
                items={[
                  { key: "edit", label: "Modifier", icon: Pencil, onClick: () => openEdit(row) },
                  { key: "file", label: "Ajouter un fichier", icon: Upload, onClick: () => attFileRef.current?.click() },
                  { key: "delete", label: "Mettre à la corbeille", icon: Trash2, danger: true, onClick: () => void trashTodo(row), confirm: trashConfirm(row) },
                ]}
              />
              {closeBtn}
            </div>
          </div>

          {row.descr && <p className="-mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-muted-foreground">{row.descr}</p>}

          {/* Où j'en suis : le dernier point d'avancement, visible sans faire défiler. */}
          <button
            type="button"
            onClick={() => focusPoint(row.id)}
            className="flex w-full flex-col gap-1 rounded-[14px] bg-panel px-3.5 py-3 text-left transition-colors hover:bg-rowhover"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold text-muted-foreground">Où j'en suis</span>
              {last?.date && <span className="text-[11px] tabular-nums text-faint">{last.who === "Créateur" ? "Le créateur, " : ""}le {last.date}</span>}
            </span>
            {last ? (
              <span className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-snug text-foreground [overflow-wrap:anywhere]">{last.text}</span>
            ) : (
              <span className="text-[13px] leading-snug text-muted-foreground">Aucun point pour l'instant. Ajoute où tu en es.</span>
            )}
          </button>

          {/* Infos groupées */}
          <dl className="divide-y divide-border overflow-hidden rounded-[14px] bg-panel">
            <InfoRow label="Pour">
              <CreatorStack names={who.names} photoOf={photoOf} size="sm" />
              <span className="min-w-0 truncate font-medium" title={who.full}>{who.full}</span>
            </InfoRow>
            <InfoRow label="Statut">
              {/* Segments plutôt qu'un menu : rien à ouvrir, marche aussi dans la feuille iPhone. */}
              <Tabs
                size="sm"
                label="Statut"
                items={TODO_STATUS_OPTS.map((o) => ({ value: o.value, label: o.label }))}
                value={statusOf(row)}
                onValueChange={(s) => {
                  if (s !== statusOf(row)) void setStatusTo(row.id, s);
                }}
              />
            </InfoRow>
            <InfoRow label="Priorité">
              <StatusPill tone={prioTone(row.priority)} className={row.priority === "haute" ? "text-priority" : undefined}>{prioLabel(row.priority)}</StatusPill>
            </InfoRow>
            <InfoRow label="Échéance">
              <span className={cn("font-medium", late > 0 ? TONE_TEXT.wait : !dueText && "text-muted-foreground")}>
                {dueText ?? "Aucune"}
                {late > 0 ? ` · ${late} j de retard` : ""}
              </span>
            </InfoRow>
            {created && !Number.isNaN(created.getTime()) && <InfoRow label="Créée le">{fmtDay(created)}</InfoRow>}
            <InfoRow label="Demandée par">{row.source === "creator" ? "Le créateur" : "L'agence"}</InfoRow>
            <ObjectCollabLink table="todos" id={row.id} creator={row.creator} asRow />
            {row.done && formatDone(row) && <InfoRow label="Faite">{formatDone(row)}</InfoRow>}
          </dl>

          {/* Sous-tâches */}
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-foreground">Sous-tâches</h3>
              <span className="text-[12px] tabular-nums text-muted-foreground">{subs.length ? `${subDone} sur ${subs.length}` : "Aucune"}</span>
            </div>
            {subs.length > 0 && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-field">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(subDone / subs.length) * 100}%` }} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setSubsOpenId(subsOpen ? null : row.id)}
              aria-expanded={subsOpen}
              className="self-start text-[13px] font-medium text-primary hover:underline"
            >
              {subsOpen
                ? "Masquer les sous-tâches"
                : subs.length > 1
                  ? `Afficher les ${subs.length} sous-tâches`
                  : subs.length === 1
                    ? "Afficher la sous-tâche"
                    : "Ajouter une sous-tâche"}
            </button>
            {subsOpen && (
              <div className="flex flex-col gap-1.5">
                {subs.map((s) => (
                  <div key={s.id} className="group flex items-center gap-2.5 rounded-[12px] bg-panel px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSubtask(row, s.id)}
                      aria-label={s.done ? "Décocher" : "Cocher"}
                      className={cn(
                        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] transition-colors",
                        s.done ? "bg-primary text-primary-foreground" : "border-2 border-faint hover:border-foreground/60",
                      )}
                    >
                      {s.done && <Check className="h-3 w-3" strokeWidth={3} />}
                    </button>
                    <span className={cn("min-w-0 flex-1 break-words text-[13px]", s.done ? "text-faint line-through" : "text-foreground")}>{s.text}</span>
                    <button
                      type="button"
                      onClick={() => delSubtask(row, s.id)}
                      aria-label="Supprimer la sous-tâche"
                      className="shrink-0 text-faint opacity-100 transition-opacity hover:text-destructive focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSubtask(row);
                  }}
                  className="flex h-10 items-center gap-2 rounded-full bg-field pl-3.5 pr-1"
                >
                  <input
                    value={subInput}
                    onChange={(e) => setSubInput(e.target.value)}
                    placeholder="Ajouter une sous-tâche…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
                  />
                  <button type="submit" disabled={!subInput.trim()} aria-label="Ajouter" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                  </button>
                </form>
              </div>
            )}
          </section>

          {/* Pièces jointes */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">
              Pièces jointes{atts.length ? <span className="font-normal text-muted-foreground"> · {atts.length}</span> : null}
            </h3>
            {atts.map((a) => (
              <div key={a.path} className="group flex items-center gap-3 rounded-[12px] bg-panel p-2.5">
                <button type="button" onClick={() => openAttachment(a)} className="shrink-0" title="Ouvrir"><FileCard formatFile={fileFormatOf(a.name)} /></button>
                <button type="button" onClick={() => openAttachment(a)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[13px] font-medium text-foreground hover:underline">{a.name}</div>
                  <div className="text-[11px] text-faint">{a.size}</div>
                </button>
                <button type="button" onClick={() => setConfirmAtt({ todo: row, att: a })} className="shrink-0 text-faint opacity-100 transition-opacity hover:text-destructive focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100" title="Retirer"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <input ref={attFileRef} type="file" multiple className="hidden" onChange={(e) => uploadAttachments(row, e.target.files)} />
            <button
              type="button"
              onClick={() => attFileRef.current?.click()}
              disabled={attUploading}
              className="flex items-center justify-center gap-2 rounded-full border-2 border-dashed border-border px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
            >
              <Upload className="h-4 w-4" /> {attUploading ? "Envoi…" : "Ajouter un fichier"}
            </button>
          </section>

          {/* Points d'avancement (commentaire de la tâche, visible de l'équipe) */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">Points d'avancement</h3>
            {noteEditId === row.id ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={noteEditText}
                  onChange={(e) => setNoteEditText(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Où en es-tu ? Note ton avancement, un blocage, un lien…"
                  className="w-full resize-y rounded-[12px] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (await saveNote(row.id, noteEditText)) {
                        setNoteEditId(null);
                        toast("Avancement enregistré ✓");
                      } else {
                        toast("Avancement non enregistré, réessaie");
                      }
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Check className="h-3.5 w-3.5" /> Enregistrer
                  </button>
                  <button type="button" onClick={() => setNoteEditId(null)} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground" aria-label="Annuler">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : points.length ? (
              <div className="rounded-[14px] bg-panel px-3.5 py-2.5">
                <ol className="flex flex-col gap-1.5">
                  {points.map((p, i) => (
                    <li key={i} className="flex flex-col">
                      {(p.date || p.who) && (
                        <span className="text-[11px] tabular-nums text-faint">
                          {[p.date, p.who === "Créateur" ? "Le créateur" : p.who === "Agence" ? "L'agence" : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <span className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{p.text}</span>
                    </li>
                  ))}
                </ol>
                <button type="button" onClick={() => startNote(row.id)} className="mt-1 text-[12px] font-medium text-primary hover:underline">
                  Modifier
                </button>
              </div>
            ) : (
              <p className="text-[13px] leading-snug text-muted-foreground">Aucun point pour l'instant. Note où tu en es, l'équipe le verra.</p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addPoint(row);
              }}
              className="flex h-11 items-center gap-2 rounded-full bg-field pl-4 pr-1.5"
            >
              <input
                ref={pointRef}
                value={pointInput}
                onChange={(e) => setPointInput(e.target.value)}
                placeholder="Où en es-tu ?"
                aria-label="Nouveau point d'avancement"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
              />
              <button
                type="submit"
                disabled={!pointInput.trim()}
                aria-label="Ajouter le point"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </form>
          </section>
        </div>

        {/* Actions, en bas de la fiche : hors de la zone qui défile (jamais par-dessus son contenu).
            La fiche tient dans l'écran (useFitViewport), donc elles restent visibles. */}
        <div className="mt-3 shrink-0">
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {paneKind === "reporter" && (
            <div className="flex flex-col gap-2 rounded-[14px] bg-panel p-3">
              <span className="text-[12px] font-medium text-muted-foreground">Nouvelle échéance</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "+ 1 jour", n: 1 },
                  { label: "+ 1 semaine", n: 7 },
                ].map((o) => (
                  <button
                    key={o.n}
                    type="button"
                    onClick={() => void postpone(row, plusDaysISO(postponeBase(row), o.n))}
                    className="h-8 rounded-full bg-surface px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
                  >
                    {o.label}
                  </button>
                ))}
                <input
                  type="date"
                  aria-label="Autre date"
                  defaultValue={toISODate(row.due)}
                  onChange={(e) => {
                    if (e.target.value) void postpone(row, e.target.value);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-full border border-border bg-surface px-3 text-[12px] text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>
          )}
          {paneKind === "deleguer" && (
            <div className="flex flex-col gap-2 rounded-[14px] bg-panel p-3">
              <span className="text-[12px] font-medium text-muted-foreground">Confier la tâche à</span>
              <CreatorMultiPicker
                size="sm"
                pill
                ariaLabel="Pour qui"
                value={todoCreators(row)}
                onChange={(list) => void delegate(row, list)}
                creators={creators}
                agencyLabel="L'agence (tâche interne)"
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => toggleDone(row)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {row.done ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
            {row.done ? "Rouvrir" : "Terminer"}
          </button>
          <div className="grid grid-cols-2 gap-2">
            {[
              { kind: "reporter" as const, label: "Reporter", icon: TtpPlanning },
              { kind: "deleguer" as const, label: "Déléguer", icon: Forward },
            ].map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => setPane(paneKind === b.kind ? null : { id: row.id, kind: b.kind })}
                aria-expanded={paneKind === b.kind}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-full bg-field px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover",
                  paneKind === b.kind && "ring-[1.5px] ring-inset ring-primary",
                )}
              >
                <b.icon className="h-4 w-4" /> {b.label}
              </button>
            ))}
          </div>
        </div>
        </div>
      </>
    );
  };

  // ── Colonnes (kanban) ──
  const renderColumns = () => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {TODO_STATUS_OPTS.map((col) => {
        const colRows = filteredBase.filter((r) => todoStatus(r) === col.value);
        return (
          <div key={col.value} className="flex flex-col gap-2 rounded-[20px] bg-surface p-2.5">
            <div className="flex items-center justify-between px-1.5 pt-1">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <span className="text-[13px] font-semibold text-foreground">{col.label}</span>
              </div>
              <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">{colRows.length}</span>
            </div>
            {colRows.length === 0 ? (
              <div className="px-2 py-8 text-center text-[12px] text-faint">Aucune tâche</div>
            ) : (
              colRows.map((row) => {
                const late = lateDays(row);
                const subs = row.subtasks ?? [];
                const who = whoOf(row);
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => pick(row.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pick(row.id);
                      }
                    }}
                    className="flex cursor-pointer flex-col gap-2 rounded-[14px] bg-panel p-3 transition-colors hover:bg-rowhover"
                  >
                    <div className="flex items-start gap-2">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", row.priority === "haute" ? "bg-priority" : "bg-faint")} title={`Priorité ${prioLabel(row.priority).toLowerCase()}`} />
                      <span className={cn("min-w-0 flex-1 text-[13px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]", row.done && "text-muted-foreground line-through")}>
                        {row.text}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                        <CreatorStack names={who.names} photoOf={photoOf} size="xs" />
                        <span className="truncate" title={who.full}>{who.short}</span>
                      </span>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {subs.length > 0 && (
                          <span className="inline-flex h-6 items-center rounded-full bg-field px-2 text-[11px] font-semibold tabular-nums text-muted-foreground">
                            {subs.filter((s) => s.done).length} / {subs.length}
                          </span>
                        )}
                        {late > 0 && <StatusPill tone="wait" size="xs">{late} j</StatusPill>}
                        <StatusSelect value={todoStatus(row)} options={TODO_STATUS_OPTS} onChange={(s) => void setStatusTo(row.id, s)} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Contenu principal ──
  let content: ReactNode;
  if (rows === null) {
    content = (
      <div className="rounded-[20px] bg-surface px-4 py-3">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  } else if (error && rows.length === 0) {
    content = (
      <div className="rounded-[20px] bg-surface px-4 py-3">
        <p className="text-sm text-muted-foreground">Impossible de charger les tâches.</p>
      </div>
    );
  } else if (rows.length === 0) {
    content = (
      <div className="rounded-[20px] bg-surface px-4 py-3">
        <p className="text-sm text-muted-foreground">Aucune tâche pour l'instant. Ajoute-en une avec « + Tâche » ou la barre d'ajout rapide.</p>
      </div>
    );
  } else if (viewMode === "colonnes") {
    content = renderColumns();
  } else if (query.trim() && filtered.length === 0) {
    content = <div className="rounded-[20px] bg-surface px-4 py-8 text-center text-sm text-muted-foreground">Aucun résultat pour « {query} »</div>;
  } else if (noFilterMatch) {
    content = <div className="rounded-[20px] bg-surface px-4 py-8 text-center text-sm text-muted-foreground">Aucune tâche pour ces filtres.</div>;
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="flex items-center gap-2 px-1 pb-2">
              <span aria-hidden className={cn("h-2 w-2 rounded-full", g.key === "haute" ? "bg-priority" : "bg-faint")} />
              <h3 className="text-[13px] font-semibold text-foreground">{g.label}</h3>
              <span className="ml-auto text-[12px] font-semibold tabular-nums text-muted-foreground">{g.rows.length}</span>
            </div>
            <ul className="flex flex-col gap-0.5 rounded-[20px] bg-surface p-1.5">{g.rows.map(renderRow)}</ul>
          </section>
        ))}
      </div>
    );
  }

  // Filtres : un simple bouton à côté de « Liste / Colonnes » (en-tête de page).
  const filterButton =
    rows !== null && rows.length > 0
      ? (() => {
          const activeCount =
            (creatorFilter != null ? 1 : 0) +
            (priorityFilter != null ? 1 : 0) +
            // Le filtre de statut n'existe (et ne s'applique) qu'en vue liste.
            (viewMode === "liste" && todoFilter !== "encours" ? 1 : 0);
          const groups: FilterGroup[] = [
            ...(viewMode === "liste"
              ? [{
                  id: "statut",
                  label: "Statut",
                  value: todoFilter,
                  onChange: (v: string) => setTodoFilter(v as TodoFilter),
                  options: TODO_FILTERS.map((f) => ({
                    value: f.id,
                    label: f.label,
                    count: filteredBase.filter((r) => matchTodoFilter(f.id, r)).length,
                  })),
                }]
              : []),
            {
              id: "priorite",
              label: "Priorité",
              value: priorityFilter ?? "__all__",
              onChange: (v: string) => setPriorityFilter(v === "__all__" ? null : (v as Priority)),
              options: priorityPills.map((p) => ({ value: p.value ?? "__all__", label: p.label })),
            },
          ];
          return (
            <FilterPanel
              activeCount={activeCount}
              groups={groups}
              onClear={() => { setCreatorFilter(null); setPriorityFilter(null); setTodoFilter("encours"); }}
              extra={
                <div className="flex flex-col gap-2">
                  <span className="text-[12px] font-medium text-muted-foreground">Périmètre</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tabs
                      size="sm"
                      label="Périmètre"
                      items={[
                        { value: "__all__", label: "Tous" },
                        { value: "__agency__", label: "Agence" },
                      ]}
                      value={creatorFilter ?? "__all__"}
                      onValueChange={(v) => setCreatorFilter(v === "__all__" ? null : "__agency__")}
                    />
                    <Select value={creatorSelectValue} onValueChange={onCreatorSelect}>
                      <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-full bg-surface" placeholder="Un créateur…" />
                      <SelectContent>
                        <SelectItem index={0} value={ALL}>Tous</SelectItem>
                        <SelectItem index={1} value="__agency__">Agence</SelectItem>
                        {creators.map((c, i) => (
                          <SelectItem key={c.id} index={i + 2} value={c.name} img={c.photo_url}>
                            {titleCase(c.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              }
            />
          );
        })()
      : null;

  return (
    <div>
      <PageHeaderRow>
        {filterButton}
        <Tabs
          size="sm"
          label="Affichage"
          items={[
            { value: "liste", label: "Liste", icon: <List className="h-3.5 w-3.5" />, hideLabel: "mobile" },
            { value: "colonnes", label: "Colonnes", icon: <Columns3 className="h-3.5 w-3.5" />, hideLabel: "mobile" },
          ]}
          value={viewMode}
          onValueChange={(v) => setViewMode(v as "liste" | "colonnes")}
        />
        <AddMenuButton
          label="Tâche"
          items={[
            {
              key: "creator",
              label: "Pour un créateur",
              hint: "Tu choisis qui dans le formulaire",
              icon: UserRound,
              onClick: () => {
                setForceAgency(false);
                setFormOpen(true);
              },
            },
            {
              key: "agency",
              label: "Pour l'agence",
              hint: "Tâche interne, sans créateur",
              icon: Building2,
              onClick: () => {
                setCreatorList([]);
                setForceAgency(true);
                setFormOpen(true);
              },
            },
            {
              key: "weekly",
              label: "Chaque semaine",
              hint: "Revient toute seule chaque semaine, le jour choisi",
              icon: TtpRepeat,
              onClick: () => setRoutineAdd((n) => n + 1),
            },
          ]}
        />
      </PageHeaderRow>

      <div className={cn(showInspector && "grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5")}>
        {/* Colonne principale */}
        <div className="min-w-0">
          {/* Tuiles : chacune filtre la liste (téléphone : bande compacte qui défile). */}
          {rows !== null && rows.length > 0 && isPhone && (
            <PhoneStrip
              className="mb-3"
              items={KPIS.map((k) => ({ label: k.label, value: String(kpiCounts[k.id]), active: activeKpi === k.id, onClick: () => pickKpi(k.id) }))}
            />
          )}
          {rows !== null && rows.length > 0 && !isPhone && (
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {KPIS.map((k) => {
                const on = activeKpi === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => pickKpi(k.id)}
                    aria-pressed={on}
                    className={cn(
                      "flex min-w-0 flex-col gap-3 rounded-[16px] p-4 text-left transition-colors",
                      on ? "bg-primary/[0.06] ring-[1.5px] ring-inset ring-primary" : "bg-surface hover:bg-rowhover",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <IconTile size="sm" tone={k.tone} className="rounded-full">{k.icon}</IconTile>
                      <span className="text-[26px] font-bold leading-none tracking-[-0.02em] text-foreground tabular-nums">{kpiCounts[k.id]}</span>
                    </span>
                    <span className="truncate text-[13px] font-medium text-muted-foreground">{k.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <InlineForm
            open={formOpen}
            title={forceAgency ? "Nouvelle tâche agence" : "Nouvelle tâche"}
            onClose={() => {
              setFormOpen(false);
              setForceAgency(false);
            }}
            onSubmit={submit}
          >
            <TextField label="Tâche" value={text} onChange={setText} icon={Type} placeholder="Ex : Contacter la marque…" mentions={creators} />
            <AutoGrowTextField label="Description" value={descr} onChange={setDescr} icon={AlignLeft} mentions={creators} placeholder="Détaille la tâche, le champ s'agrandit tout seul…" className="min-w-full" />
            <TextField label="Avancement (optionnel)" value={note} onChange={setNote} icon={MessageSquarePlus} placeholder="Infos en plus, rappel, lien…" mentions={creators} />
            <TextField label="Échéance" type="date" value={due} onChange={setDue} icon={CalendarClock} />
            <SelectField
              label="Priorité"
              value={priority}
              onChange={(v) => setPriority(v as Priority)}
              options={[
                { value: "haute", label: "Haute" },
                { value: "moyenne", label: "Moyenne" },
                { value: "basse", label: "Basse" },
              ]}
            />
            {forceAgency ? (
              <p className="text-[11px] text-faint">Tâche interne à l'agence (pas de créateur).</p>
            ) : (
              <Field label="Pour qui">
                <CreatorMultiPicker ariaLabel="Pour qui" value={creatorList} onChange={setCreatorList} creators={creators} agencyLabel="L'agence (tâche interne)" />
              </Field>
            )}
            <CollabField value={collabId} onChange={setCollabId} creator={forceAgency ? null : creatorList[0] ?? null} />
          </InlineForm>

          {/* Tâches qui reviennent chaque semaine (date et auteur de chaque « Fait ») */}
          <WeeklyRoutines addSignal={routineAdd} />


          {/* Ajout rapide, en haut de la liste (à sa place, ne flotte plus par-dessus les cartes).
              « N » y amène le curseur. Pendant l'envoi le champ passe en lecture seule (pas
              désactivé : il garde le focus pour enchaîner la tâche suivante). */}
          {rows !== null && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitQuick();
              }}
              className="relative mb-4"
            >
              <label className="flex h-11 w-full items-center gap-2.5 rounded-full border border-border bg-surface px-4 transition-colors focus-within:border-primary">
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  ref={quickRef}
                  value={quick}
                  onChange={(e) => {
                    setQuick(e.target.value);
                    syncMention(e.currentTarget);
                  }}
                  onSelect={(e) => syncMention(e.currentTarget)}
                  onBlur={() => window.setTimeout(() => setMention(null), 120)}
                  onKeyDown={(e) => {
                    if (mentionList.length) {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const d = e.key === "ArrowDown" ? 1 : -1;
                        setMentionIdx((i) => (i + d + mentionList.length) % mentionList.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        pickMention(mentionList[Math.min(mentionIdx, mentionList.length - 1)].name);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMention(null);
                        return;
                      }
                    }
                    if (e.key === "Escape") e.currentTarget.blur();
                  }}
                  role="combobox"
                  aria-expanded={mentionList.length > 0}
                  aria-controls="quick-mention-list"
                  aria-autocomplete="list"
                  readOnly={quickBusy}
                  aria-busy={quickBusy || undefined}
                  enterKeyHint="done"
                  aria-label="Nouvelle tâche (ajout rapide)"
                  placeholder={isPhone ? "Nouvelle tâche, ex. « Relancer demain @Léna »" : "Nouvelle tâche, ex. « Relancer Nutripure demain @Léna @Justine !haute »"}
                  className={cn("min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint", quickBusy && "opacity-60")}
                />
                <Kbd className="shrink-0 max-md:hidden">N</Kbd>
              </label>
              {mentionList.length > 0 && (
                <ul
                  id="quick-mention-list"
                  role="listbox"
                  aria-label="Créateurs"
                  className="absolute left-4 top-[calc(100%+6px)] z-30 w-[min(300px,calc(100%-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.3)]"
                >
                  {mentionList.map((c, i) => (
                    <li key={c.id ?? c.name} role="option" aria-selected={i === mentionIdx}>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setMentionIdx(i)}
                        onClick={() => pickMention(c.name)}
                        className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-foreground transition-colors", i === mentionIdx ? "bg-rowhover" : "hover:bg-rowhover")}
                      >
                        <CreatorAvatar name={c.name} photoUrl={c.photo_url} className="h-6 w-6 shrink-0 rounded-full text-[9px]" />
                        <span className="min-w-0 truncate">{titleCase(c.name)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          )}

          {content}
        </div>

        {/* Fiche de la tâche sélectionnée (grand écran, vue liste) */}
        {showInspector && (
          <aside
            aria-label="Fiche de la tâche"
            ref={asideRef}
            className="sticky top-5 flex max-h-[calc(100dvh-2.5rem)] flex-col rounded-[22px] bg-surface p-5"
          >
            {inspected ? (
              renderInspector(inspected, false)
            ) : (
              <p className="m-auto text-center text-[13px] text-muted-foreground">Aucune tâche à afficher.</p>
            )}
          </aside>
        )}
      </div>

      {/* Fiche en fenêtre : téléphone / tablette, et vue colonnes */}
      {sheetRow && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" label={sheetRow.text} onClose={closeSheet}>
          <div
            className="flex max-h-[88vh] max-h-[88dvh] w-full max-w-md flex-col rounded-[22px] bg-surface p-5 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {renderInspector(sheetRow, true)}
          </div>
        </Overlay>
      )}

      {/* Confirmation avant de mettre une tâche à la corbeille (glisser « Supprimer ») */}
      {toTrash && (
        <ConfirmDialog
          {...trashConfirm(toTrash)}
          danger
          onCancel={() => setToTrash(null)}
          onConfirm={() => {
            const row = toTrash;
            setToTrash(null);
            void trashTodo(row);
          }}
        />
      )}

      {/* Confirmation avant de retirer une pièce jointe (fichier supprimé du stockage) */}
      {confirmAtt && (
        <ConfirmDialog
          title="Retirer la pièce jointe"
          message={`Retirer « ${confirmAtt.att.name} » ? Le fichier sera supprimé.`}
          confirmLabel="Retirer"
          danger
          onCancel={() => setConfirmAtt(null)}
          onConfirm={() => {
            const c = confirmAtt;
            setConfirmAtt(null);
            removeAttachment(c.todo, c.att.path);
          }}
        />
      )}
    </div>
  );
}

import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { useLiveKey } from "@/lib/useLive";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, SelectField, DeleteButton } from "@/components/ui/form";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { useCreators } from "@/lib/useCreators";
import { getCache, setCache } from "@/lib/viewCache";
import { useEffect, useRef, useState } from "react";
import { PencilLine, LayoutGrid, ReceiptText, FileText, Download, type LucideIcon } from "lucide-react";

type Row = {
  id: string;
  name: string;
  type: string;
  size: string;
  creator: string;
  path: string;
  created_at: string;
  sort_order: number;
};

type TypeMeta = { label: string; icon: LucideIcon; className: string; tagClassName: string };

const DOC_TYPE_META: Record<string, TypeMeta> = {
  brief: { label: "Brief", icon: PencilLine, className: "bg-indigo/15 text-indigo", tagClassName: "bg-indigo/10 text-indigo" },
  mediakit: { label: "Media kit", icon: LayoutGrid, className: "bg-signal/15 text-signaltext", tagClassName: "bg-signal/10 text-signaltext" },
  facture: { label: "Facture", icon: ReceiptText, className: "bg-cyan/15 text-cyan", tagClassName: "bg-cyan/10 text-cyan" },
  autre: { label: "Document", icon: FileText, className: "bg-primary/15 text-primary", tagClassName: "bg-primary/10 text-primary" },
};
const metaFor = (type: string): TypeMeta => DOC_TYPE_META[type] ?? DOC_TYPE_META.autre;

const TYPE_OPTIONS = [
  { value: "brief", label: "Brief" },
  { value: "mediakit", label: "Media kit" },
  { value: "facture", label: "Facture" },
  { value: "autre", label: "Document" },
];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export function Documents() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("documents"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const live = useLiveKey();
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [docType, setDocType] = useState("autre");
  const [docCreator, setDocCreator] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, type, size, creator, path, created_at, sort_order")
        .order("sort_order");
      if (!active) return;
      if (error) {
        setError(true);
        setRows([]);
        return;
      }
      const list = (data as Row[]) ?? [];
      setCache("documents", list);
      setRows(list);
    })();
    return () => {
      active = false;
    };
  }, [live]);

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast("Choisis un fichier");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast("Fichier trop lourd (max 25 Mo)");
      return;
    }
    setBusy(true);
    const path = `${Date.now()}-${slug(file.name) || "doc"}`;
    const up = await supabase.storage.from("documents").upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (up.error) {
      setBusy(false);
      toast("Échec de l'upload — réessaie");
      return;
    }
    const row = {
      name: file.name,
      type: docType,
      size: humanSize(file.size),
      creator: docCreator || "",
      path,
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("documents", row);
    setBusy(false);
    if (!created) {
      toast("Fichier envoyé mais fiche non créée");
      return;
    }
    setRows([created as unknown as Row, ...(rows ?? [])]);
    toast("Document ajouté ✓");
    setFormOpen(false);
    setDocType("autre");
    setDocCreator("");
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const openDoc = async (row: Row) => {
    if (!row.path) {
      toast("Fichier indisponible");
      return;
    }
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 3600);
    if (error || !data?.signedUrl) {
      toast("Lien indisponible");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const del = async (row: Row) => {
    if (!(await dbDelete("documents", row.id))) return;
    if (row.path) supabase.storage.from("documents").remove([row.path]);
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
    toast("Supprimé");
  };

  const formatDate = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const filtered = (rows ?? []).filter((row) => matchQuery(query, row.name, row.type, row.creator));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows === null ? "Chargement…" : `${rows.length} document${rows.length > 1 ? "s" : ""}`}
        </div>
        <AddButton label="Document" onClick={() => setFormOpen(true)} />
      </div>

      <InlineForm open={formOpen} title="Ajouter un document" onClose={() => setFormOpen(false)} onSubmit={submit} submitLabel={busy ? "Envoi…" : "Téléverser"}>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Fichier</span>
          <input
            ref={fileRef}
            type="file"
            onChange={() => setFileName(fileRef.current?.files?.[0]?.name ?? "")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-primary-foreground hover:file:opacity-90"
          />
          {fileName && <span className="truncate text-[10px] text-faint">{fileName}</span>}
        </label>
        <SelectField label="Type" value={docType} onChange={setDocType} options={TYPE_OPTIONS} />
        <SelectField
          label="Créateur (optionnel)"
          value={docCreator}
          onChange={setDocCreator}
          options={[{ value: "", label: "—" }, ...creators.map((c) => ({ value: c.name, label: c.name }))]}
        />
      </InlineForm>

      <div className="rounded-2xl border border-border bg-card px-2 shadow-sm sm:px-5">
        {rows === null ? (
          <div className="px-2 py-3">
            <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
          </div>
        ) : error ? (
          <div className="px-2 py-3">
            <AnimatedBadge status="danger" size="sm">Erreur de chargement</AnimatedBadge>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-2 py-6 text-sm text-muted-foreground">Aucun document — ajoute le premier 📎</div>
        ) : query.trim() && filtered.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">Aucun résultat pour « {query} »</div>
        ) : (
          <ul>
            {filtered.map((row, index) => {
              const meta = metaFor(row.type);
              const Icon = meta.icon;
              const details = [row.size, formatDate(row.created_at)].filter(Boolean).join(" · ");
              return (
                <li key={row.id} className={cn("flex items-center gap-3.5 py-3.5", index > 0 && "border-t border-border")}>
                  <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", meta.className)}>
                    <Icon className="size-4" />
                  </div>

                  <button type="button" onClick={() => openDoc(row)} className="min-w-0 flex-1 text-left" title="Ouvrir / télécharger">
                    <div className="truncate text-[13px] font-semibold text-foreground hover:underline">{row.name}</div>
                    <div className="mt-0.5 truncate text-[10px] text-faint">{details}</div>
                  </button>

                  {row.creator ? (
                    <span className="hidden shrink-0 whitespace-nowrap rounded-md bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
                      {row.creator}
                    </span>
                  ) : null}

                  <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide", meta.tagClassName)}>
                    {meta.label}
                  </span>

                  {row.path && (
                    <button
                      type="button"
                      onClick={() => openDoc(row)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                      title="Télécharger"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  <DeleteButton onClick={() => del(row)} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

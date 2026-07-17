import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { useLiveKey } from "@/lib/useLive";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, SelectField } from "@/components/ui/form";
import { FilterBar, type FilterOpt } from "@/components/ui/filter-bar";
import { ActionMenu } from "@/components/ui/action-menu";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { useCreators } from "@/lib/useCreators";
import { notifyCreator } from "@/lib/push";
import { getCache, setCache } from "@/lib/viewCache";
import { useEffect, useRef, useState } from "react";
import { PencilLine, LayoutGrid, ReceiptText, FileText, Download, Eye, Share2, X, Trash2, type LucideIcon } from "lucide-react";

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

type FileKind = "image" | "pdf" | "html" | "other";

/** Fichier HTML (ex : contrats générés) — repéré à l'extension du chemin de stockage. */
const isHtmlPath = (p: string) => /\.html?$/i.test(p);

/** Tri de la liste (le tri par défaut « Plus récents » remplace l'ordre d'insertion). */
const SORT_OPTIONS: FilterOpt[] = [
  { value: "recent", label: "Plus récents" },
  { value: "ancien", label: "Plus anciens" },
  { value: "nom", label: "Nom A→Z" },
  { value: "type", label: "Type" },
];

function fileKind(name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "other";
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
  const [previewDoc, setPreviewDoc] = useState<{ name: string; url: string; kind: FileKind; html?: string } | null>(null);
  const [sort, setSort] = useState("recent");
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
    // Push au créateur concerné (s'il a activé les notifs sur son téléphone).
    if (docCreator) notifyCreator("document", docCreator, file.name);
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
    const html = isHtmlPath(row.path);
    // Pour un .html : on pré-ouvre l'onglet DANS le geste utilisateur (sinon le popup
    // est bloqué après l'await du fetch).
    const w = html ? window.open("", "_blank") : null;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 3600);
    if (error || !data?.signedUrl) {
      w?.close();
      toast("Lien indisponible");
      return;
    }
    if (!html) {
      window.open(data.signedUrl, "_blank");
      return;
    }
    // Supabase sert les .html en pièce/texte brut (sécurité anti-hébergement) → le
    // navigateur affiche la SOURCE, avec les accents cassés. On récupère les octets
    // (fetch.text() décode toujours en UTF-8 → règle le mojibake) et on écrit la page
    // dans l'onglet, rendue proprement comme du HTML.
    try {
      const res = await fetch(data.signedUrl);
      const src = await res.text();
      if (w) {
        w.document.open();
        w.document.write(src);
        w.document.close();
      }
    } catch {
      if (w) w.location.href = data.signedUrl; // repli
    }
  };

  const preview = async (row: Row) => {
    if (!row.path) {
      toast("Fichier indisponible");
      return;
    }
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 3600);
    if (error || !data?.signedUrl) {
      toast("Aperçu indisponible");
      return;
    }
    // HTML : on récupère le contenu et on l'affiche via `srcDoc` (rendu correct, quel
    // que soit le content-type servi par Supabase).
    if (isHtmlPath(row.path)) {
      try {
        const res = await fetch(data.signedUrl);
        const html = await res.text();
        setPreviewDoc({ name: row.name, url: data.signedUrl, kind: "html", html });
        return;
      } catch {
        /* repli : lien d'ouverture */
      }
    }
    setPreviewDoc({ name: row.name, url: data.signedUrl, kind: fileKind(row.name) });
  };

  const share = async (row: Row) => {
    if (!row.path) {
      toast("Fichier indisponible");
      return;
    }
    // Lien signé longue durée (7 j) — partageable
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      toast("Lien de partage indisponible");
      return;
    }
    const url = data.signedUrl;
    if (navigator.share) {
      try {
        await navigator.share({ title: row.name, url });
        return;
      } catch {
        /* annulé → on retombe sur le presse-papiers */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Lien copié (valable 7 j) ✓");
    } catch {
      window.prompt("Copie ce lien de partage :", url);
    }
  };

  const del = async (row: Row) => {
    if (!(await dbDelete("documents", row.id))) {
      toast("Erreur — réessaie");
      return;
    }
    if (row.path) {
      const { error: rmErr } = await supabase.storage.from("documents").remove([row.path]);
      if (rmErr) console.error("Suppression du fichier stocké échouée:", rmErr);
    }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
    toast("Supprimé");
  };

  const formatDate = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  // Horodatage sûr : un created_at illisible ne doit pas casser le tri (→ 0, en fin de liste).
  const timeOf = (r: Row) => {
    const t = new Date(r.created_at).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  // `.filter()` renvoie un nouveau tableau → le `.sort()` ne mute jamais `rows`.
  const filtered = (rows ?? [])
    .filter((row) => matchQuery(query, row.name, row.type, row.creator))
    .sort((a, b) => {
      if (sort === "ancien") return timeOf(a) - timeOf(b);
      if (sort === "nom") return (a.name || "").localeCompare(b.name || "", "fr", { sensitivity: "base" });
      if (sort === "type") return (a.type || "").localeCompare(b.type || "", "fr") || timeOf(b) - timeOf(a);
      return timeOf(b) - timeOf(a); // "recent" (défaut) : plus récents d'abord
    });

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

      {rows !== null && rows.length > 1 && (
        <div className="mb-3">
          <FilterBar value={sort} options={SORT_OPTIONS} onChange={setSort} placeholder="Trier" />
        </div>
      )}

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

                  <ActionMenu
                    items={[
                      ...(row.path
                        ? [
                            { key: "preview", label: "Prévisualiser", icon: Eye, onClick: () => preview(row) },
                            { key: "share", label: "Partager le lien", icon: Share2, onClick: () => share(row) },
                            { key: "download", label: "Télécharger", icon: Download, onClick: () => openDoc(row) },
                          ]
                        : []),
                      {
                        key: "delete",
                        label: "Supprimer",
                        icon: Trash2,
                        danger: true,
                        onClick: () => del(row),
                        confirm: { title: "Supprimer le document", message: `Supprimer « ${row.name} » ? Cette action est irréversible.` },
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {previewDoc && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <span className="truncate text-[13px] font-semibold text-foreground">{previewDoc.name}</span>
              <div className="flex shrink-0 items-center gap-1">
                {previewDoc.kind === "html" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const w = window.open("", "_blank");
                      if (w && previewDoc.html) {
                        w.document.open();
                        w.document.write(previewDoc.html);
                        w.document.close();
                      }
                    }}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Ouvrir dans un onglet"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                ) : (
                  <a
                    href={previewDoc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Ouvrir dans un onglet"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-panel p-3">
              {previewDoc.kind === "image" ? (
                <img src={previewDoc.url} alt={previewDoc.name} className="max-h-[74vh] w-auto rounded-lg object-contain" />
              ) : previewDoc.kind === "pdf" ? (
                <iframe title={previewDoc.name} src={previewDoc.url} className="h-[74vh] w-full rounded-lg bg-white" />
              ) : previewDoc.kind === "html" ? (
                <iframe title={previewDoc.name} srcDoc={previewDoc.html} sandbox="" className="h-[74vh] w-full rounded-lg bg-white" />
              ) : (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <FileText className="h-10 w-10 text-faint" />
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Aperçu non disponible pour ce type de fichier.
                  </p>
                  <a
                    href={previewDoc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Ouvrir le fichier
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

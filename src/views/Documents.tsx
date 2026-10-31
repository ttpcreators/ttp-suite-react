import { fmtDay } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useSearch, matchQuery, matchWords } from "@/lib/search";
import { PillSearch } from "@/components/ui/pill-search";
import { useLiveKey } from "@/lib/useLive";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, SelectField } from "@/components/ui/form";
import { FilterBar, type FilterOpt } from "@/components/ui/filter-bar";
import { PeriodFilter, periodsFrom, inPeriod } from "@/components/ui/period-filter";
import { isoDay } from "@/lib/dateRange";
import { FileCard, fileFormatOf, type FormatFileProps } from "@/components/ui/file-card-collections";
import { ActionMenu } from "@/components/ui/action-menu";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { useCreators } from "@/lib/useCreators";
import { notifyCreator } from "@/lib/push";
import { getCache, setCache } from "@/lib/viewCache";
import { goToTab } from "@/lib/openLater";
import { useEffect, useRef, useState } from "react";
import { PencilLine, LayoutGrid, ReceiptText, FileSignature, FileText, Download, Eye, Share2, X, Trash2, BarChart3, ChevronLeft, type LucideIcon } from "@/components/icons";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Overlay } from "@/components/mobile/ios-sheet";
import { CreatorPickerField } from "@/components/ui/creator-picker";

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
  brief: { label: "Brief", icon: PencilLine, className: "bg-info-soft text-info", tagClassName: "bg-info-soft text-info" },
  mediakit: { label: "Media kit", icon: LayoutGrid, className: "bg-progress-soft text-progress", tagClassName: "bg-progress-soft text-progress" },
  facture: { label: "Facture", icon: ReceiptText, className: "bg-ok-soft text-ok", tagClassName: "bg-ok-soft text-ok" },
  stats: { label: "Stats", icon: BarChart3, className: "bg-closed-soft text-closed", tagClassName: "bg-closed-soft text-closed" },
  contract: { label: "Contrat", icon: FileSignature, className: "bg-closed-soft text-closed", tagClassName: "bg-closed-soft text-closed" },
  autre: { label: "Document", icon: FileText, className: "bg-closed-soft text-closed", tagClassName: "bg-closed-soft text-closed" },
};
const metaFor = (type: string): TypeMeta => DOC_TYPE_META[type] ?? DOC_TYPE_META.autre;

// Format d'icône représentatif d'un DOSSIER (type de doc).
const TYPE_FMT: Record<string, FormatFileProps> = {
  stats: "img",
  facture: "pdf",
  mediakit: "pptx",
  brief: "doc",
  contract: "doc",
  autre: "txt",
};

const TYPE_OPTIONS = [
  { value: "brief", label: "Brief" },
  { value: "mediakit", label: "Media kit" },
  { value: "facture", label: "Facture" },
  { value: "contract", label: "Contrat" },
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

/** Media kit ajouté PAR LIEN (Drive, Canva…) : le `path` est une URL http(s),
 *  pas un fichier du bucket → on l'ouvre/partage tel quel, rien à supprimer. */
const isExternalUrl = (p: string) => /^https?:\/\//i.test(p);

/**
 * Rend du HTML dans un onglet, MAIS dans une iframe `sandbox` (scripts désactivés) :
 * un fichier HTML uploadé (média-kit d'une marque, etc.) ne doit jamais exécuter de
 * script dans NOTRE origine (il pourrait lire la session Supabase). Le document
 * extérieur qu'on écrit ne contient que l'iframe (aucun script) ; le contenu non fiable
 * vit à l'intérieur, neutralisé. L'attribut `srcdoc` est échappé pour rester valide.
 */
function renderHtmlInWindow(w: Window, html: string) {
  const srcdoc = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  w.document.open();
  w.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Document</title>` +
      `<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100vh;display:block}</style></head>` +
      `<body><iframe sandbox srcdoc="${srcdoc}"></iframe></body></html>`,
  );
  w.document.close();
}

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
  const [pageQ, setPageQ] = useState("");
  const live = useLiveKey();
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [docType, setDocType] = useState("autre");
  const [docCreator, setDocCreator] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ name: string; url: string; kind: FileKind; html?: string } | null>(null);
  const [sort, setSort] = useState("recent");
  const [period, setPeriod] = useState("");
  const [openType, setOpenType] = useState<string | null>(null); // dossier ouvert (null = grille)
  const [creatorFilter, setCreatorFilter] = useState(""); // "" = tous les créateurs
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
    if (busy) return; // double clic → pas de double upload
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
      toast("Échec de l'upload, réessaie");
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
      // Fiche non créée : on retire le fichier envoyé pour ne pas laisser d'orphelin.
      const { error: rmErr } = await supabase.storage.from("documents").remove([path]);
      if (rmErr) console.warn("[documents] nettoyage fichier orphelin", path, rmErr.message);
      toast("Échec de l'enregistrement, réessaie");
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
    if (isExternalUrl(row.path)) {
      window.open(row.path, "_blank", "noopener");
      return;
    }
    const html = isHtmlPath(row.path);
    // On pré-ouvre l'onglet DANS le geste utilisateur (sinon le popup est bloqué
    // après l'await, surtout sur iPhone) : pour un .html comme pour les autres fichiers.
    const w = window.open("", "_blank");
    if (html && !w) {
      // window.open a renvoyé null → bloqué par le navigateur. On prévient plutôt que
      // d'échouer en silence (l'utilisateur croirait que le bouton ne marche pas).
      toast("Autorise les pop-ups pour ouvrir le contrat");
      return;
    }
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 3600);
    if (error || !data?.signedUrl) {
      w?.close();
      toast("Lien indisponible");
      return;
    }
    if (!html) {
      goToTab(w, data.signedUrl); // onglet refusé : ouverture comme avant
      return;
    }
    // Supabase sert les .html en pièce/texte brut (sécurité anti-hébergement) → le
    // navigateur affiche la SOURCE, avec les accents cassés. On récupère les octets
    // (fetch.text() décode toujours en UTF-8 → règle le mojibake) et on écrit la page
    // dans l'onglet, rendue proprement comme du HTML.
    try {
      const res = await fetch(data.signedUrl);
      const src = await res.text();
      if (w) renderHtmlInWindow(w, src);
    } catch {
      if (w) w.location.href = data.signedUrl; // repli
    }
  };

  const preview = async (row: Row) => {
    if (!row.path) {
      toast("Fichier indisponible");
      return;
    }
    if (isExternalUrl(row.path)) {
      // Lien externe (Drive, Canva…) : souvent non intégrable en iframe → carte « Ouvrir ».
      setPreviewDoc({ name: row.name, url: row.path, kind: "other" });
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
    const external = isExternalUrl(row.path);
    let url = row.path;
    if (!external) {
      // Lien signé longue durée (7 j) — partageable
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 60 * 60 * 24 * 7);
      if (error || !data?.signedUrl) {
        toast("Lien de partage indisponible");
        return;
      }
      url = data.signedUrl;
    }
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
      toast(external ? "Lien copié ✓" : "Lien copié (valable 7 j) ✓");
    } catch {
      window.prompt("Copie ce lien de partage :", url);
    }
  };

  const del = async (row: Row) => {
    if (!(await dbDelete("documents", row.id))) {
      toast("Erreur, réessaie");
      return;
    }
    if (row.path && !isExternalUrl(row.path)) {
      const { error: rmErr } = await supabase.storage.from("documents").remove([row.path]);
      if (rmErr) console.error("Suppression du fichier stocké échouée:", rmErr);
    }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
    toast("Supprimé");
  };

  const formatDate = (value: string) => {
    return fmtDay(value) || value;
  };

  // Horodatage sûr : un created_at illisible ne doit pas casser le tri (→ 0, en fin de liste).
  const timeOf = (r: Row) => {
    const t = new Date(r.created_at).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  // `.filter()` renvoie un nouveau tableau → le `.sort()` ne mute jamais `rows`.
  // created_at est un horodatage UTC : on filtre sur le jour LOCAL (celui affiché), pas le jour UTC.
  const localDay = (r: Row) => {
    const d = new Date(r.created_at);
    return Number.isNaN(d.getTime()) ? r.created_at : isoDay(d);
  };
  const periods = periodsFrom((rows ?? []).map(localDay));
  const filtered = (rows ?? [])
    .filter((row) => matchQuery(query, row.name, row.type, row.creator) && matchWords(pageQ, row.name, row.type, row.creator) && inPeriod(localDay(row), period) && (!creatorFilter || (row.creator ?? "") === creatorFilter))
    .sort((a, b) => {
      if (sort === "ancien") return timeOf(a) - timeOf(b);
      if (sort === "nom") return (a.name || "").localeCompare(b.name || "", "fr", { sensitivity: "base" });
      if (sort === "type") return (a.type || "").localeCompare(b.type || "", "fr") || timeOf(b) - timeOf(a);
      return timeOf(b) - timeOf(a); // "recent" (défaut) : plus récents d'abord
    });

  // Créateurs ayant au moins un document (pour le sélecteur « par créateur »).
  const docCreators = [...new Set(((rows ?? []).map((r) => r.creator).filter(Boolean) as string[]))].sort((a, b) => a.localeCompare(b, "fr"));

  // Dossiers « portails » par type — pour ne pas se noyer dans la masse.
  const TYPE_ORDER = ["stats", "facture", "contract", "mediakit", "brief", "autre"];
  const normType = (t: string | null | undefined) => (t && t in DOC_TYPE_META && t !== "autre" ? t : "autre");
  const typeCount: Record<string, number> = {};
  for (const r of filtered) typeCount[normType(r.type)] = (typeCount[normType(r.type)] ?? 0) + 1;
  const folders = TYPE_ORDER.filter((t) => (typeCount[t] ?? 0) > 0);

  // Carte document réutilisable (liste plate en recherche + dans un dossier).
  const docCard = (row: Row) => {
    const meta = metaFor(row.type);
    const details = [row.size, formatDate(row.created_at)].filter(Boolean).join(" · ");
    return (
      <li key={row.id} className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm transition-colors hover:bg-rowhover">
        <div className="shrink-0 self-center pr-1"><FileCard formatFile={fileFormatOf(row.name, row.type)} /></div>
        <button type="button" onClick={() => openDoc(row)} className="min-w-0 flex-1 text-left" title="Ouvrir / télécharger">
          <div className="truncate text-[13px] font-semibold text-foreground hover:underline">{row.name}</div>
          <div className="mt-0.5 truncate text-[10px] text-faint">{details}</div>
        </button>
        {row.creator ? (
          <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-rowhover px-2.5 py-1 text-[10px] font-medium text-muted-foreground sm:inline">
            {row.creator}
          </span>
        ) : null}
        <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium", meta.tagClassName)}>{meta.label}</span>
        <ActionMenu
          items={[
            ...(row.path
              ? [
                  { key: "preview", label: "Prévisualiser", icon: Eye, onClick: () => preview(row) },
                  { key: "share", label: "Partager le lien", icon: Share2, onClick: () => share(row) },
                  { key: "download", label: "Télécharger", icon: Download, onClick: () => openDoc(row) },
                ]
              : []),
            { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => del(row), confirm: { title: "Supprimer le document", message: `Supprimer « ${row.name} » ? Cette action est irréversible.` } },
          ]}
        />
      </li>
    );
  };

  return (
    <div>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {rows === null ? "Chargement…" : `${rows.length} document${rows.length > 1 ? "s" : ""}`}
        </div>
        <AddButton label="Document" onClick={() => setFormOpen(true)} />
      </PageHeaderRow>

      <InlineForm open={formOpen} title="Ajouter un document" onClose={() => setFormOpen(false)} onSubmit={submit} submitLabel={busy ? "Envoi…" : "Téléverser"}>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Fichier</span>
          <input
            ref={fileRef}
            type="file"
            onChange={() => setFileName(fileRef.current?.files?.[0]?.name ?? "")}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-primary-foreground hover:file:opacity-90"
          />
          {fileName && <span className="truncate text-[10px] text-faint">{fileName}</span>}
        </label>
        <SelectField label="Type" value={docType} onChange={setDocType} options={TYPE_OPTIONS} />
        <CreatorPickerField label="Créateur" value={docCreator} onChange={setDocCreator} creators={creators} />
      </InlineForm>

      {rows !== null && rows.length > 1 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PillSearch size="md" value={pageQ} onChange={setPageQ} placeholder="Rechercher…" />
            <FilterBar value={sort} options={SORT_OPTIONS} onChange={setSort} placeholder="Trier" />
          </div>
          {/* Mobile : les deux filtres côte à côte, même largeur ; ≥ sm : à droite. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {docCreators.length > 0 && (
              <Select value={creatorFilter} onValueChange={setCreatorFilter}>
                <SelectTrigger className="h-10 w-full min-w-0 rounded-xl bg-surface sm:w-auto sm:min-w-[200px]" placeholder="Tous les créateurs" />
                <SelectContent>
                  <SelectItem index={0} value="">Tous les créateurs</SelectItem>
                  {docCreators.map((c, i) => (
                    <SelectItem key={c} index={i + 1} value={c}>{titleCase(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {periods.length > 0 && <PeriodFilter value={period} onChange={setPeriod} periods={periods} className="w-full sm:w-auto" />}
          </div>
        </div>
      )}

      <div>
        {rows === null ? (
          <div className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
            <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
            <AnimatedBadge status="danger" size="sm">Erreur de chargement</AnimatedBadge>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface px-4 py-6 text-sm text-muted-foreground shadow-sm">Aucun document. Ajoute le premier.</div>
        ) : query.trim() && filtered.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">Aucun résultat pour « {query} »</div>
        ) : !query.trim() && filtered.length === 0 ? (
          /* Période / Créateur ne laissent aucun document */
          <div className="rounded-2xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">Aucun document pour ces filtres.</div>
        ) : query.trim() ? (
          /* Recherche : liste plate transversale */
          <ul className="flex flex-col gap-2.5">{filtered.map(docCard)}</ul>
        ) : openType ? (
          /* Dossier ouvert */
          <div>
            <button
              type="button"
              onClick={() => setOpenType(null)}
              className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Tous les dossiers
            </button>
            <div className="mb-3 flex items-center gap-3 text-sm font-semibold text-foreground">
              <FileCard formatFile={TYPE_FMT[openType] ?? "doc"} />
              <span>{metaFor(openType).label} <span className="font-normal text-faint">· {typeCount[openType] ?? 0}</span></span>
            </div>
            <ul className="flex flex-col gap-2.5">{filtered.filter((r) => normType(r.type) === openType).map(docCard)}</ul>
          </div>
        ) : (
          /* Grille de dossiers par type (« portails ») */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((t) => {
              const M = metaFor(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOpenType(t)}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:bg-rowhover"
                >
                  <div className="shrink-0 pr-1"><FileCard formatFile={TYPE_FMT[t] ?? "doc"} /></div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">{M.label}</div>
                    <div className="text-[11px] text-faint">{typeCount[t]} document{typeCount[t] > 1 ? "s" : ""}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {previewDoc && (
        <Overlay className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClose={() => setPreviewDoc(null)}>
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
                      if (!w) {
                        toast("Autorise les pop-ups pour ouvrir ce fichier");
                        return;
                      }
                      if (previewDoc.html) renderHtmlInWindow(w, previewDoc.html);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Ouvrir dans un onglet"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                ) : (
                  <a
                    href={previewDoc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Ouvrir dans un onglet"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
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
                    className="rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Ouvrir le fichier
                  </a>
                </div>
              )}
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

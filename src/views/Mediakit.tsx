import { useEffect, useRef, useState } from "react";
import { Upload, FileText, ExternalLink, Trash2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbInsert, dbDelete } from "@/lib/db";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { useCreators } from "@/lib/useCreators";
import { titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

/**
 * Media kit = bibliothèque de fichiers. L'agence dépose les media kits qu'elle a
 * créés (PDF / images), rangés PAR CRÉATEUR et PAR MOIS. Stockés dans le bucket
 * privé `documents` (type "mediakit") → visibles par le créateur dans son espace.
 */

type ArchiveRow = {
  id: string;
  creator: string | null;
  name: string;
  type: string | null;
  size: string | null;
  path: string;
  created_at: string | null;
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const MAX_MB = 25;

function monthKey(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "?";
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function isImage(name: string) {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

export function Mediakit() {
  const creators = useCreators();
  const [selected, setSelected] = useState<string>(""); // "" = tous les créateurs
  const [archives, setArchives] = useState<ArchiveRow[] | null>(null);
  const [filterMonth, setFilterMonth] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [del, setDel] = useState<ArchiveRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("documents")
      .select("id,creator,name,type,size,path,created_at")
      .eq("type", "mediakit")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        setArchives(error ? [] : ((data as ArchiveRow[]) ?? []));
      });
    return () => {
      alive = false;
    };
  }, []);

  const upload = async (file: File) => {
    if (!selected) {
      toast("Choisis d'abord un créateur");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast(`Fichier trop lourd (max ${MAX_MB} Mo)`);
      return;
    }
    setUploading(true);
    try {
      const extMatch = /\.([a-z0-9]+)$/i.exec(file.name);
      const ext = (extMatch?.[1] ?? "pdf").toLowerCase();
      const slug = selected.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const path = `mediakits/${slug}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("documents").upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
      if (up.error) {
        toast("Échec de l'upload — réessaie");
        return;
      }
      const now = new Date();
      const ml = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      const row = {
        creator: selected,
        name: `Media kit — ${titleCase(selected)} — ${ml}`,
        type: "mediakit",
        size: `${Math.max(1, Math.round(file.size / 1024))} Ko`,
        path,
        sort_order: 0,
      };
      const created = await dbInsert("documents", row);
      if (!created) {
        toast("Fichier stocké mais fiche non créée — réessaie");
        return;
      }
      setArchives((prev) => [created as unknown as ArchiveRow, ...(prev ?? [])]);
      toast("Media kit ajouté ✓ — visible par le créateur");
    } finally {
      setUploading(false);
    }
  };

  const open = async (row: ArchiveRow) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 3600);
    if (error || !data?.signedUrl) {
      toast("Lien indisponible — réessaie");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (row: ArchiveRow) => {
    if (!(await dbDelete("documents", row.id))) {
      toast("Erreur — réessaie");
      return;
    }
    await supabase.storage.from("documents").remove([row.path]).catch(() => {});
    setArchives((prev) => (prev ?? []).filter((x) => x.id !== row.id));
    toast("Media kit supprimé");
  };

  const all = archives ?? [];
  const forCreator = selected ? all.filter((a) => (a.creator ?? "").toLowerCase() === selected.toLowerCase()) : all;
  const months = [...new Set(forCreator.map((a) => monthKey(a.created_at)))].filter((k) => k !== "?");
  const shown = forCreator.filter((a) => filterMonth === "all" || monthKey(a.created_at) === filterMonth);

  return (
    <div className="space-y-4">
      {/* Barre : créateur + upload */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          value={selected}
          onValueChange={(v) => {
            setSelected(v);
            setFilterMonth("all");
          }}
        >
          <SelectTrigger className="h-10 w-auto min-w-[220px] rounded-xl bg-surface" placeholder="Tous les créateurs" />
          <SelectContent>
            <SelectItem index={0} value="">
              Tous les créateurs
            </SelectItem>
            {creators.map((c, i) => (
              <SelectItem key={c.id} index={i + 1} value={c.name}>
                {titleCase(c.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="h-10 w-auto min-w-[160px] rounded-xl bg-surface" placeholder="Tous les mois" />
              <SelectContent>
                <SelectItem index={0} value="all">
                  Tous les mois
                </SelectItem>
                {months.map((k, i) => (
                  <SelectItem key={k} index={i + 1} value={k}>
                    {monthLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => (selected ? fileRef.current?.click() : toast("Choisis d'abord un créateur"))}
            disabled={uploading}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> {uploading ? "Ajout…" : "Ajouter un media kit"}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-faint">
        Dépose tes media kits (PDF ou image, max {MAX_MB} Mo){selected ? ` pour ${titleCase(selected)}` : ""}. Chaque fichier est
        daté automatiquement et visible par le créateur dans son espace « Documents ».
      </p>

      {/* Liste */}
      {archives === null ? (
        <div className="rounded-2xl border border-border bg-surface px-4 py-6 text-sm text-muted-foreground shadow-sm">
          Chargement…
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center shadow-sm">
          <ImageIcon className="mx-auto h-8 w-8 text-faint" />
          <div className="mt-3 text-sm font-medium text-foreground">Aucun media kit{selected ? ` pour ${titleCase(selected)}` : ""}</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {selected
              ? "Clique sur « Ajouter un media kit » pour déposer le premier fichier."
              : "Choisis un créateur puis dépose son media kit."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((row) => (
            <div key={row.id} className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo/15 text-indigo">
                  {isImage(row.path) ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-foreground">{titleCase(row.creator ?? "—")}</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {row.created_at ? new Date(row.created_at).toLocaleDateString("fr-FR") : "—"}
                    {row.size ? ` · ${row.size}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => open(row)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Ouvrir
                </button>
                <button
                  type="button"
                  onClick={() => setDel(row)}
                  title="Supprimer"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {del && (
        <ConfirmDialog
          title="Supprimer le media kit"
          message={`Supprimer « ${del.name} » ? Le créateur ne le verra plus. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setDel(null)}
          onConfirm={() => {
            remove(del);
            setDel(null);
          }}
        />
      )}
    </div>
  );
}

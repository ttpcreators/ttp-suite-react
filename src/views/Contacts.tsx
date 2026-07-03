import { supabase } from "@/lib/supabase";
import { Copy, X, Download, Upload, Trash2, Pencil } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { cn, initials } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
} from "@/components/ui/form";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

type Row = {
  id: string;
  brand: string;
  person: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  tone: string;
  tag: string;
  email: string;
  phone: string;
  sort_order: number;
};

const TAG_OPTIONS = [
  { value: "Marque", label: "Marque" },
  { value: "Agence", label: "Agence" },
  { value: "Média", label: "Média" },
  { value: "PME", label: "PME" },
  { value: "Autre", label: "Autre" },
];

const ALL_TAGS = "__all__";

// ─── CSV : export + import réels ─────────────────────────────────────────────

const CSV_HEADERS = ["Marque", "Personne", "Rôle", "Tag", "Email", "Téléphone"] as const;
type CsvField = "brand" | "person" | "role" | "tag" | "email" | "phone";
const CSV_FIELDS: CsvField[] = ["brand", "person", "role", "tag", "email", "phone"];

function normHeader(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const FIELD_ALIASES: Record<CsvField, string[]> = {
  brand: ["marque", "entreprise", "marque / entreprise", "brand", "company", "societe"],
  person: ["personne", "person", "nom", "contact", "name"],
  role: ["role", "poste", "fonction", "title", "titre"],
  tag: ["tag", "type", "categorie", "category"],
  email: ["email", "e-mail", "mail", "courriel"],
  phone: ["telephone", "phone", "tel", "mobile", "numero"],
};

/** Échappe une valeur pour une cellule CSV. */
function csvCell(v: string): string {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Génère le contenu CSV (avec BOM UTF-8 pour Excel). */
function buildCsv(rows: Row[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([r.brand, r.person, r.role, r.tag, r.email, r.phone].map((v) => csvCell(v ?? "")).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

/** Parse un CSV en lignes de cellules (gère guillemets, virgules, points-virgules, sauts de ligne). */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  // Détection du séparateur sur la 1re ligne (virgule / point-virgule / tabulation).
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts: [string, number][] = [
    [",", (firstLine.match(/,/g) || []).length],
    [";", (firstLine.match(/;/g) || []).length],
    ["\t", (firstLine.match(/\t/g) || []).length],
  ];
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Transforme les lignes CSV en objets contact (mappe l'entête si présent, sinon positionnel). */
function csvToContacts(text: string): Partial<Record<CsvField, string>>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(normHeader);
  // L'entête correspond-il à des champs connus ?
  const colMap: (CsvField | null)[] = header.map((h) => {
    for (const f of CSV_FIELDS) if (FIELD_ALIASES[f].includes(h)) return f;
    return null;
  });
  const hasHeader = colMap.some((c) => c !== null);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const map = hasHeader ? colMap : CSV_FIELDS.map((f) => f); // positionnel

  return dataRows.map((cells) => {
    const obj: Partial<Record<CsvField, string>> = {};
    cells.forEach((cell, i) => {
      const f = map[i];
      if (f) obj[f] = cell.trim();
    });
    return obj;
  });
}

function CopyField({ label, value }: { label: string; value: string }) {
  const v = value && value.trim() ? value.trim() : "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
        <div className="truncate text-sm text-foreground">{v || "—"}</div>
      </div>
      {v && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(v);
            toast(`${label} copié ✓`);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          title={`Copier ${label.toLowerCase()}`}
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Contacts() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("contacts"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const live = useLiveKey();

  const [selected, setSelected] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("");
  const [tag, setTag] = useState("Marque");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [tagFilter, setTagFilter] = useState<string>(ALL_TAGS);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("contacts")
          .select("*")
          .order("sort_order");
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = (data as Row[]) ?? [];
        setCache("contacts", list);
        setRows(list);
      } catch {
        if (active) {
          setError(true);
          setRows([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [live]);

  // Liste dynamique des tags réellement présents (préserve l'ordre des TAG_OPTIONS,
  // puis ajoute les tags custom découverts dans les rows).
  const tagList = useMemo(() => {
    const present = new Set(
      (rows ?? [])
        .map((r) => (r.tag ?? "").trim())
        .filter((t) => t.length > 0)
    );
    const ordered: string[] = [];
    for (const opt of TAG_OPTIONS) {
      if (present.has(opt.value)) {
        ordered.push(opt.value);
        present.delete(opt.value);
      }
    }
    for (const extra of present) ordered.push(extra);
    return ordered;
  }, [rows]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="danger" size="sm">
          Erreur de chargement
        </AnimatedBadge>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  const currentRows = rows;

  const resetForm = () => {
    setEditId(null);
    setBrand("");
    setFirstName("");
    setLastName("");
    setRole("");
    setTag("Marque");
    setEmail("");
    setPhone("");
  };
  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };
  const startEdit = (r: Row) => {
    setEditId(r.id);
    setBrand(r.brand === "—" ? "" : r.brand);
    const p = r.person && r.person !== "—" ? r.person : "";
    const parts = p.split(" ");
    setFirstName(r.first_name ?? parts[0] ?? "");
    setLastName(r.last_name ?? parts.slice(1).join(" "));
    setRole(r.role ?? "");
    setTag(r.tag || "Marque");
    setEmail(r.email ?? "");
    setPhone(r.phone ?? "");
    setFormOpen(true);
  };

  const submit = async () => {
    if (!brand.trim()) {
      toast("Renseigne la marque / entreprise");
      return;
    }
    const first = firstName.trim();
    const last = lastName.trim();
    const person = [first, last].filter(Boolean).join(" ");
    const payload = {
      brand: brand.trim(),
      person: person || "—",
      first_name: first || null,
      last_name: last || null,
      role: role.trim(),
      tag,
      email: email.trim(),
      phone: phone.trim(),
    };
    if (editId) {
      const ok = await dbUpdate("contacts", editId, payload);
      if (!ok) {
        toast("Erreur — réessaie");
        return;
      }
      setRows(currentRows.map((r) => (r.id === editId ? { ...r, ...payload } : r)));
      toast("Contact modifié ✓");
    } else {
      const created = await dbInsert("contacts", { ...payload, tone: "indigo", sort_order: nextOrder(currentRows) });
      if (!created) {
        toast("Erreur — réessaie");
        return;
      }
      setRows([created as unknown as Row, ...currentRows]);
      toast("Contact ajouté ✓");
    }
    setFormOpen(false);
    resetForm();
  };

  // Export : télécharge un vrai fichier .csv (respecte le filtre/recherche courants).
  const exportCsv = () => {
    const toExport = filtered.length ? filtered : currentRows;
    if (toExport.length === 0) {
      toast("Aucun contact à exporter");
      return;
    }
    const csv = buildCsv(toExport);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-ttp-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`${toExport.length} contact${toExport.length > 1 ? "s" : ""} exporté${toExport.length > 1 ? "s" : ""} ✓`);
  };

  // Import : lit un fichier .csv, crée réellement les contacts en base.
  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = csvToContacts(text).filter((c) => (c.brand ?? "").trim() || (c.person ?? "").trim());
      if (parsed.length === 0) {
        toast("Aucune ligne exploitable dans ce CSV");
        return;
      }
      let order = nextOrder(currentRows);
      const validTags = new Set(TAG_OPTIONS.map((t) => t.value));
      const payload = parsed.map((c) => {
        const rawTag = (c.tag ?? "").trim();
        return {
          brand: (c.brand ?? "").trim() || (c.person ?? "").trim() || "—",
          person: (c.person ?? "").trim() || "—",
          role: (c.role ?? "").trim(),
          tag: validTags.has(rawTag) ? rawTag : rawTag || "Autre",
          email: (c.email ?? "").trim(),
          phone: (c.phone ?? "").trim(),
          tone: "indigo",
          sort_order: order++,
        };
      });
      const { data, error } = await supabase
        .from("contacts")
        .insert(payload)
        .select("*");
      if (error) {
        toast("Échec de l'import — vérifie le fichier");
        return;
      }
      const inserted = (data as Row[]) ?? [];
      const merged = [...inserted, ...currentRows];
      setCache("contacts", merged);
      setRows(merged);
      toast(`${inserted.length} contact${inserted.length > 1 ? "s" : ""} importé${inserted.length > 1 ? "s" : ""} ✓`);
    } catch {
      toast("Fichier illisible");
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  // Le filtre par tag se combine avec la recherche existante.
  const filtered = currentRows.filter((row) => {
    const tagOk = tagFilter === ALL_TAGS || (row.tag ?? "").trim() === tagFilter;
    if (!tagOk) return false;
    return matchQuery(query, row.brand, row.person, row.role, row.email, row.tag);
  });

  const pillBase =
    "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors";
  const pillActive = "bg-primary text-primary-foreground";
  const pillInactive = "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {filtered.length} contact{filtered.length > 1 ? "s" : ""}
          {(tagFilter !== ALL_TAGS || query.trim()) && (
            <span className="text-faint"> / {currentRows.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importCsv(f);
            }}
          />
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
            title="Importer un fichier CSV"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{importing ? "Import…" : "Importer"}</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            title="Exporter en CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Exporter</span>
          </button>
          <AddButton label="Contact" onClick={openAdd} />
        </div>
      </div>

      {/* Barre de filtres par tag */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTagFilter(ALL_TAGS)}
          className={cn(pillBase, tagFilter === ALL_TAGS ? pillActive : pillInactive)}
        >
          Tous
        </button>
        {tagList.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTagFilter(t)}
            className={cn(pillBase, tagFilter === t ? pillActive : pillInactive)}
          >
            {t}
          </button>
        ))}
      </div>

      <InlineForm
        open={formOpen}
        title={editId ? "Modifier le contact" : "Nouveau contact"}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSubmit={submit}
        submitLabel={editId ? "Enregistrer" : "Ajouter"}
      >
        <TextField
          label="Marque / Entreprise"
          value={brand}
          onChange={setBrand}
        />
        <TextField label="Prénom" value={firstName} onChange={setFirstName} className="sm:min-w-[130px]" />
        <TextField label="Nom de famille" value={lastName} onChange={setLastName} className="sm:min-w-[130px]" />
        <TextField label="Rôle" value={role} onChange={setRole} />
        <SelectField
          label="Tag"
          value={tag}
          onChange={setTag}
          options={TAG_OPTIONS}
        />
        <TextField label="Email" value={email} onChange={setEmail} type="email" />
        <TextField label="Téléphone" value={phone} onChange={setPhone} />
      </InlineForm>

      <div className="rounded-xl border border-border bg-card px-5 shadow-sm">
        {currentRows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Aucun contact
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? `Aucun résultat pour « ${query} »`
              : "Aucun contact pour ce filtre"}
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              onClick={() => setSelected(row)}
              className="flex cursor-pointer items-center gap-3.5 border-b border-border py-3.5 last:border-b-0 hover:bg-rowhover"
            >
              {/* Avatar */}
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] bg-surface text-[11px] font-bold text-foreground">
                {initials(row.person)}
              </div>

              {/* Marque + person · role */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {row.brand}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-normal text-faint">
                  {row.person} · {row.role}
                </div>
              </div>

              {/* Email — masqué sur mobile */}
              <div className="hidden max-w-[200px] truncate text-[11px] font-medium text-muted-foreground sm:block">
                {row.email}
              </div>

              {/* Pastille tag */}
              <span className="shrink-0 whitespace-nowrap rounded-full bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                {row.tag}
              </span>

              {/* Actions */}
              <ActionMenu
                items={[
                  ...(row.email
                    ? [{ key: "copy", label: "Copier l'email", icon: Copy, onClick: () => { navigator.clipboard?.writeText(row.email); toast("Email copié ✓"); } }]
                    : []),
                  { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(row) },
                  {
                    key: "delete",
                    label: "Supprimer",
                    icon: Trash2,
                    danger: true,
                    onClick: async () => {
                      if (await dbTrash("contacts", row.id, row.brand, row.person)) {
                        setRows(currentRows.filter((r) => r.id !== row.id));
                        toast("Déplacé dans la corbeille");
                      }
                    },
                    confirm: { title: "Supprimer le contact", message: `Supprimer « ${row.brand} » ? Tu pourras le restaurer depuis la corbeille.` },
                  },
                ]}
              />
            </div>
          ))
        )}
      </div>

      {/* Fiche détail contact */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-sm font-bold text-foreground">
                {initials(selected.person)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">{selected.brand}</div>
                <div className="truncate text-xs text-faint">
                  {selected.person} · {selected.role}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                {selected.tag}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 text-faint transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <CopyField label="Marque / Entreprise" value={selected.brand} />
              {selected.first_name || selected.last_name ? (
                <>
                  {selected.first_name && <CopyField label="Prénom" value={selected.first_name} />}
                  {selected.last_name && <CopyField label="Nom de famille" value={selected.last_name} />}
                </>
              ) : (
                <CopyField label="Personne" value={selected.person} />
              )}
              <CopyField label="Rôle" value={selected.role} />
              <CopyField label="Email" value={selected.email} />
              <CopyField label="Téléphone" value={selected.phone} />
            </div>

            <button
              type="button"
              onClick={() => {
                const text = [
                  selected.brand,
                  `${selected.person} · ${selected.role}`,
                  selected.email,
                  selected.phone,
                ]
                  .filter((s) => s && s.trim() && s.trim() !== "·")
                  .join("\n");
                navigator.clipboard?.writeText(text);
                toast("Fiche copiée ✓");
              }}
              className="mt-4 w-full rounded-lg bg-primary py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
            >
              Copier toute la fiche
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { supabase } from "@/lib/supabase";
import { Copy, X } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
  DeleteButton,
} from "@/components/ui/form";
import { useEffect, useMemo, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

type Row = {
  id: string;
  brand: string;
  person: string;
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
  const [brand, setBrand] = useState("");
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const [tag, setTag] = useState("Marque");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [tagFilter, setTagFilter] = useState<string>(ALL_TAGS);

  useEffect(() => {
    let active = true;
    supabase
      .from("contacts")
      .select("id, brand, person, role, tone, tag, email, phone, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = (data as Row[]) ?? [];
        setCache("contacts", list);
        setRows(list);
      });
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

  const submit = async () => {
    if (!brand.trim()) {
      toast("Renseigne la marque / entreprise");
      return;
    }
    const row = {
      brand: brand.trim(),
      person: person.trim() || "—",
      role: role.trim(),
      tag,
      email: email.trim(),
      phone: phone.trim(),
      tone: "indigo",
      sort_order: nextOrder(currentRows),
    };
    const created = await dbInsert("contacts", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([created as unknown as Row, ...currentRows]);
    toast("Contact ajouté ✓");
    setFormOpen(false);
    setBrand("");
    setPerson("");
    setRole("");
    setTag("Marque");
    setEmail("");
    setPhone("");
  };

  // Le filtre par tag se combine avec la recherche existante.
  const filtered = currentRows.filter((row) => {
    const tagOk = tagFilter === ALL_TAGS || (row.tag ?? "").trim() === tagFilter;
    if (!tagOk) return false;
    return matchQuery(query, row.brand, row.person, row.role, row.email, row.tag);
  });

  const pillBase =
    "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {filtered.length} contact{filtered.length > 1 ? "s" : ""}
          {(tagFilter !== ALL_TAGS || query.trim()) && (
            <span className="text-faint"> / {currentRows.length}</span>
          )}
        </div>
        <AddButton label="Contact" onClick={() => setFormOpen(true)} />
      </div>

      {/* Barre de filtres par tag */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTagFilter(ALL_TAGS)}
          className={cn(
            pillBase,
            tagFilter === ALL_TAGS
              ? "bg-foreground text-background"
              : "border border-border bg-surface text-muted-foreground hover:bg-rowhover"
          )}
        >
          Tous
        </button>
        {tagList.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTagFilter(t)}
            className={cn(
              pillBase,
              tagFilter === t
                ? "bg-foreground text-background"
                : "border border-border bg-surface text-muted-foreground hover:bg-rowhover"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <InlineForm
        open={formOpen}
        title="Nouveau contact"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField
          label="Marque / Entreprise"
          value={brand}
          onChange={setBrand}
        />
        <TextField label="Personne" value={person} onChange={setPerson} />
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

              {/* Suppression */}
              <DeleteButton
                onClick={async () => {
                  if (await dbDelete("contacts", row.id)) {
                    setRows(currentRows.filter((r) => r.id !== row.id));
                    toast("Supprimé");
                  }
                }}
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
              <CopyField label="Personne" value={selected.person} />
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
              className="mt-4 w-full rounded-lg bg-signal py-2.5 text-[11px] font-semibold uppercase tracking-wide text-onsignal transition-opacity hover:opacity-90"
            >
              Copier toute la fiche
            </button>
          </div>
        </div>
      )}
    </>
  );
}

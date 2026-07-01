import { supabase } from "@/lib/supabase";
import { initials } from "@/lib/utils";
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
import { useEffect, useState } from "react";

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

export function Contacts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const [tag, setTag] = useState("Marque");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

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
        setRows((data as Row[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const filtered = currentRows.filter((row) =>
    matchQuery(query, row.brand, row.person, row.role, row.email, row.tag)
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {currentRows.length} contact{currentRows.length > 1 ? "s" : ""}
        </div>
        <AddButton label="Contact" onClick={() => setFormOpen(true)} />
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
        ) : query.trim() && filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
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
    </>
  );
}

import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
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
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

type Row = {
  id: string;
  brand: string;
  contact: string | null;
  value: string | null;
  stage: string | null;
  tone: "success" | "warning" | "danger" | "neutral" | "info" | null;
  sort_order: number | null;
};

// Ordre de colonnes fidèle à l'original (app.js : stages).
const STAGE_ORDER = ["Prospection", "Contact", "Négociation", "Signé"];

// Couleur de la pastille par tone (équivalents de toneHex de l'original).
const DOT_CLASS: Record<NonNullable<Row["tone"]>, string> = {
  success: "bg-signal",
  info: "bg-indigo",
  neutral: "bg-cyan",
  warning: "bg-amber",
  danger: "bg-signal",
};

const STAGE_OPTIONS = STAGE_ORDER.map((s) => ({ value: s, label: s }));

export function Prospection() {
  const [rows, setRows] = useState<Row[] | null>(() =>
    getCache<Row[]>("prospects"),
  );
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [contact, setContact] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState(STAGE_ORDER[0]);

  useEffect(() => {
    let active = true;
    supabase
      .from("prospects")
      .select("id, brand, contact, value, stage, tone, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = (data as Row[]) ?? [];
        setCache("prospects", list);
        setRows(list);
      });
    return () => {
      active = false;
    };
  }, [live]);

  const submit = async () => {
    if (!brand.trim()) {
      toast("Renseigne la marque");
      return;
    }
    const row = {
      brand: brand.trim(),
      contact: contact.trim() || null,
      value: value.trim() || "—",
      stage,
      tone: "neutral" as const,
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("prospects", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([created as unknown as Row, ...(rows ?? [])]);
    setError(false);
    toast("Prospect ajouté ✓");
    setFormOpen(false);
    setBrand("");
    setContact("");
    setValue("");
    setStage(STAGE_ORDER[0]);
  };

  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground">
        {rows === null
          ? "Pipeline de prospection"
          : `${rows.length} prospect${rows.length > 1 ? "s" : ""} au pipeline`}
      </div>
      <AddButton label="Prospect" onClick={() => setFormOpen(true)} />
    </div>
  );

  const form = (
    <InlineForm
      open={formOpen}
      title="Nouveau prospect"
      onClose={() => setFormOpen(false)}
      onSubmit={submit}
    >
      <TextField label="Marque" value={brand} onChange={setBrand} />
      <TextField label="Contact" value={contact} onChange={setContact} />
      <TextField
        label="Valeur"
        value={value}
        onChange={setValue}
        placeholder="ex 32 000 €"
      />
      <SelectField
        label="Étape"
        value={stage}
        onChange={setStage}
        options={STAGE_OPTIONS}
      />
    </InlineForm>
  );

  if (rows === null) {
    return (
      <div>
        {header}
        {form}
        <div className="flex items-center gap-2">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      </div>
    );
  }

  if (error || rows.length === 0) {
    return (
      <div>
        {header}
        {form}
        <div className="rounded-2xl border border-border bg-surface shadow-sm px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Pipeline vide</p>
          <p className="text-xs text-muted-foreground mt-1.5">
            {error
              ? "Impossible de charger les prospects."
              : "Ajoute ta première marque à prospecter avec « + Prospect »."}
          </p>
        </div>
      </div>
    );
  }

  const filtered = rows.filter((row) =>
    matchQuery(query, row.brand, row.contact, row.stage),
  );

  if (query.trim() && filtered.length === 0) {
    return (
      <div>
        {header}
        {form}
        <div className="rounded-2xl border border-border bg-surface shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        </div>
      </div>
    );
  }

  // Groupement par étape : d'abord l'ordre canonique du pipeline, puis toute
  // étape hors liste rencontrée dans les données (fallback "Sans étape").
  const present = new Set(filtered.map((row) => row.stage ?? "Sans étape"));
  const stages = [
    ...STAGE_ORDER.filter((s) => present.has(s)),
    ...[...present].filter((s) => !STAGE_ORDER.includes(s)),
  ];

  const removeCard = async (id: string) => {
    if (await dbDelete("prospects", id)) {
      setRows(rows.filter((r) => r.id !== id));
      toast("Supprimé");
    }
  };

  return (
    <div>
      {header}
      {form}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 items-start">
        {stages.map((stage) => {
          const cards = filtered.filter(
            (row) => (row.stage ?? "Sans étape") === stage,
          );
          return (
            <div key={stage}>
              <div className="flex items-center justify-between px-1.5 pb-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                  {stage}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {cards.length}
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className={cn(
                      "rounded-xl bg-surface p-3.5 transition-colors hover:bg-rowhover",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-[7px] w-[7px] shrink-0 rounded-full",
                          card.tone ? DOT_CLASS[card.tone] : "bg-cyan",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                        {card.brand}
                      </span>
                      <DeleteButton onClick={() => removeCard(card.id)} />
                    </div>
                    {card.contact && (
                      <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                        {card.contact}
                      </p>
                    )}
                    <p className="mt-2 text-[13px] font-semibold text-foreground">
                      {card.value ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

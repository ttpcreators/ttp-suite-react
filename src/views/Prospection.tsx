import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
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
import { ActionMenu } from "@/components/ui/action-menu";
import { ArrowRight, Handshake, Pencil, Trash2 } from "@/components/icons";
import { CreatorPickerField } from "@/components/ui/creator-picker";
import { useCreators } from "@/lib/useCreators";
import { cachetOf, collabFromProspect, type Proposal } from "@/lib/prospectProposal";
import { markProspectSigned, proposalColumnsReady } from "@/lib/prospectsDb";
import { openCollab } from "@/lib/collabLinksDb";
import { fmtDay } from "@/lib/dates";
import { titleCase } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { BrandIgInline } from "@/components/BrandInstagram";
import { useIgColumn, type IgBrand } from "@/lib/instagram";

type Row = {
  id: string;
  brand: string;
  contact: string | null;
  value: string | null;
  stage: string | null;
  tone: "success" | "warning" | "danger" | "neutral" | "info" | null;
  sort_order: number | null;
  // Colonnes du SQL 2026-10-23-prospects-proposition.sql (absentes avant lui).
  creator?: string | null;
  deliverables?: string | null;
  proposal?: Proposal | null;
  contact_id?: string | null;
  collab_id?: string | null;
};

// Ordre de colonnes fidèle à l'original (app.js : stages).
const STAGE_ORDER = ["Prospection", "Contact", "Négociation", "Signé"];
// Libellés affichés (les valeurs enregistrées restent celles de STAGE_ORDER).
const STAGE_LABEL: Record<string, string> = {
  Prospection: "Repérée",
  Contact: "Contactée",
  Négociation: "En négociation",
  Signé: "Signée",
};
const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;

// Couleur de la pastille par tone (équivalents de toneHex de l'original).
const DOT_CLASS: Record<NonNullable<Row["tone"]>, string> = {
  success: "bg-signal",
  info: "bg-indigo",
  neutral: "bg-cyan",
  warning: "bg-amber",
  danger: "bg-signal",
};

const STAGE_OPTIONS = STAGE_ORDER.map((s) => ({ value: s, label: stageLabel(s) }));

export function Prospection() {
  const [rows, setRows] = useState<Row[] | null>(() =>
    getCache<Row[]>("prospects"),
  );
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = création
  const [brand, setBrand] = useState("");
  const [contact, setContact] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState(STAGE_ORDER[0]);
  const [stageFilter, setStageFilter] = useState("Tous");
  // Chiffres Instagram de la marque (fiche contact du même nom, mis à jour par ig-sync).
  const [igByBrand] = useIgColumn<IgBrand>("contacts", "brand");

  // « Transformer en collab » : créateur, livrables et cachet repris de la proposition.
  const creators = useCreators();
  const [convert, setConvert] = useState<Row | null>(null);
  const [cvCreator, setCvCreator] = useState("");
  const [cvDeliv, setCvDeliv] = useState("");
  const [cvCachet, setCvCachet] = useState("");
  const startConvert = (r: Row) => {
    setConvert(r);
    setCvCreator(r.creator ?? r.proposal?.creator ?? "");
    setCvDeliv(r.deliverables ?? r.proposal?.deliverables ?? "");
    setCvCachet(cachetOf(r));
  };
  const submitConvert = async () => {
    const r = convert;
    if (!r) return;
    const { data: last } = await supabase.from("collabs").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 1;
    const created = await dbInsert("collabs", collabFromProspect(r, { creator: cvCreator, deliverables: cvDeliv, cachet: cvCachet }, order));
    if (!created) return toast("Erreur, réessaie");
    const collabId = (created as { id: string }).id;
    const ok = await markProspectSigned(r.id, collabId);
    setRows((rs) => (rs ?? []).map((x) => (x.id === r.id ? { ...x, stage: "Signé", ...(ok ? { collab_id: collabId } : {}) } : x)));
    setConvert(null);
    toast("Collab créée ✓");
    void openCollab(collabId);
  };

  useEffect(() => {
    let active = true;
    void proposalColumnsReady().then((full) => supabase
      .from("prospects")
      .select(full ? "id, brand, contact, value, stage, tone, sort_order, creator, deliverables, proposal, contact_id, collab_id" : "id, brand, contact, value, stage, tone, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        // Échec d'un rafraîchissement : on garde la liste déjà affichée (jamais vidée)
        if (error) {
          setError(true);
          setRows((r) => r ?? []);
          return;
        }
        const list = (data as unknown as Row[]) ?? [];
        setCache("prospects", list);
        setRows(list);
        setError(false); // un chargement réussi efface l'erreur précédente
      }));
    return () => {
      active = false;
    };
  }, [live]);

  const resetForm = () => {
    setFormOpen(false);
    setEditId(null);
    setBrand("");
    setContact("");
    setValue("");
    setStage(STAGE_ORDER[0]);
  };
  const startEdit = (r: Row) => {
    setEditId(r.id);
    setBrand(r.brand);
    setContact(r.contact ?? "");
    setValue(r.value && r.value !== "—" ? r.value : "");
    setStage(r.stage ?? STAGE_ORDER[0]);
    setFormOpen(true);
  };
  // Modification (marque, contact, valeur, étape) : optimiste avec retour arrière si échec.
  const saveEdit = async (id: string, patch: Partial<Row>) => {
    const before = rows ?? [];
    setRows(before.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (await dbUpdate("prospects", id, patch)) return true;
    setRows(before);
    toast("Erreur, réessaie");
    return false;
  };

  const submit = async () => {
    if (!brand.trim()) {
      toast("Renseigne la marque");
      return;
    }
    if (editId) {
      const ok = await saveEdit(editId, { brand: brand.trim(), contact: contact.trim() || null, value: value.trim() || "—", stage });
      if (ok) {
        toast("Prospect modifié ✓");
        resetForm();
      }
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
    resetForm();
  };

  // Erreur affichée seulement s'il n'y a rien à montrer
  const showError = error && !rows?.length;

  const header = (
    <PageHeaderRow>
      <div className="text-sm text-muted-foreground">
        {rows === null || showError
          ? null
          : `${rows.length} marque${rows.length > 1 ? "s" : ""} en cours`}
      </div>
      <AddButton label="Prospect" onClick={() => { resetForm(); setFormOpen(true); }} />
    </PageHeaderRow>
  );

  const convertForm = (
    <InlineForm
      open={!!convert}
      title={convert ? `Collab ${convert.brand}` : "Collab"}
      onClose={() => setConvert(null)}
      onSubmit={submitConvert}
      submitLabel="Créer"
    >
      <CreatorPickerField label="Créateur" value={cvCreator} onChange={setCvCreator} creators={creators} />
      <TextField label="Livrables" value={cvDeliv} onChange={setCvDeliv} placeholder="ex. 2 reels Instagram" />
      <TextField label="Cachet" value={cvCachet} onChange={setCvCachet} placeholder="ex. 950 €" />
    </InlineForm>
  );

  const form = (
    <InlineForm
      open={formOpen}
      title={editId ? "Modifier le prospect" : "Nouveau prospect"}
      onClose={resetForm}
      onSubmit={submit}
      submitLabel={editId ? "Enregistrer" : "Ajouter"}
    >
      <TextField label="Marque" value={brand} onChange={setBrand} />
      <TextField label="Contact" value={contact} onChange={setContact} />
      <TextField
        label="Budget estimé"
        value={value}
        onChange={setValue}
        placeholder="ex. 32 000 €"
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
        {convertForm}
        <div className="flex items-center gap-2">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      </div>
    );
  }

  if (showError || rows.length === 0) {
    return (
      <div>
        {header}
        {form}
        {convertForm}
        <div className="rounded-2xl border border-border bg-surface shadow-sm px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{showError ? "Chargement impossible" : "Pipeline vide"}</p>
          <p className="text-xs text-muted-foreground mt-1.5">
            {showError
              ? "Les marques n'ont pas pu être chargées. Réessaie dans un instant."
              : "Ajoute ta première marque à prospecter avec « + Prospect »."}
          </p>
        </div>
      </div>
    );
  }

  // Stages présents dans les données, dans l'ordre canonique du pipeline puis
  // toute étape hors liste (pour les chips de filtre).
  const presentStages = new Set(rows.map((row) => row.stage ?? "Sans étape"));
  const stageChips = [
    "Tous",
    ...STAGE_ORDER.filter((s) => presentStages.has(s)),
    ...[...presentStages].filter((s) => !STAGE_ORDER.includes(s)),
  ];
  // Étape filtrée disparue (dernière ligne déplacée/supprimée) → on retombe sur « Tous ».
  const effStage = stageChips.includes(stageFilter) ? stageFilter : "Tous";

  const stageBar = (
    <Tabs
      className="mb-4"
      label="Filtrer par étape"
      items={stageChips.map((chip) => ({ value: chip, label: stageLabel(chip) }))}
      value={effStage}
      onValueChange={setStageFilter}
    />
  );

  const filtered = rows.filter(
    (row) =>
      matchQuery(query, row.brand, row.contact, row.stage) &&
      (effStage === "Tous" || (row.stage ?? "Sans étape") === effStage),
  );

  if (query.trim() && filtered.length === 0) {
    return (
      <div>
        {header}
        {form}
        {convertForm}
        {stageBar}
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
    const r = rows.find((x) => x.id === id);
    if (await dbTrash("prospects", id, r?.brand ?? "Prospect", r?.contact ?? undefined)) {
      setRows(rows.filter((x) => x.id !== id));
      toast("Déplacé dans la corbeille");
    } else toast("Erreur, réessaie");
  };

  return (
    <div>
      {header}
      {form}
      {convertForm}
      {stageBar}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 items-start">
        {stages.map((stage) => {
          const cards = filtered.filter(
            (row) => (row.stage ?? "Sans étape") === stage,
          );
          return (
            <div key={stage}>
              <div className="flex items-center justify-between px-1.5 pb-3">
                <span className="text-[12px] font-medium text-foreground">
                  {stageLabel(stage)}
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
                      <ActionMenu
                        items={[
                          {
                            key: "edit",
                            label: "Modifier",
                            icon: Pencil,
                            onClick: () => startEdit(card),
                          },
                          card.collab_id
                            ? { key: "collab", label: "Ouvrir la collab", icon: Handshake, onClick: () => void openCollab(card.collab_id as string) }
                            : { key: "collab", label: "Signer", icon: Handshake, onClick: () => startConvert(card) },
                          // Changement d'étape direct depuis le menu de la carte.
                          ...STAGE_ORDER.filter((s) => s !== card.stage).map((s) => ({
                            key: `stage-${s}`,
                            label: `Passer en « ${stageLabel(s)} »`,
                            icon: ArrowRight,
                            onClick: () => {
                              void saveEdit(card.id, { stage: s }).then((ok) => ok && toast(`Passé en « ${stageLabel(s)} » ✓`));
                            },
                          })),
                          {
                            key: "delete",
                            label: "Supprimer",
                            icon: Trash2,
                            danger: true,
                            onClick: () => removeCard(card.id),
                            confirm: { title: "Supprimer le prospect", message: `Supprimer « ${card.brand} » ? Il ira dans la Corbeille, d'où tu pourras le restaurer.` },
                          },
                        ]}
                      />
                    </div>
                    {card.contact && (
                      <p className="mt-1.5 truncate pl-[15px] text-[10px] text-muted-foreground">
                        {card.contact}
                      </p>
                    )}
                    <BrandIgInline ig={igByBrand[card.brand.trim().toLowerCase()]} className="mt-1 block truncate pl-[15px] text-[10px] text-faint" />
                    <p className="mt-2 pl-[15px] text-[13px] font-semibold text-foreground">
                      {card.value ?? "—"}
                    </p>
                    {(card.creator || card.deliverables) && (
                      <p className="mt-1 truncate pl-[15px] text-[11px] text-muted-foreground" title={[card.creator ? titleCase(card.creator) : "", card.deliverables ?? ""].filter(Boolean).join(" · ")}>
                        {[card.creator ? titleCase(card.creator) : "", card.deliverables ?? "", card.proposal?.at ? fmtDay(card.proposal.at) : ""].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {!card.collab_id && (card.stage === "Négociation" || card.stage === "Signé") && (
                      <button
                        type="button"
                        title="La marque a dit oui : crée la collab avec la proposition"
                        onClick={() => startConvert(card)}
                        className="mt-2.5 ml-[15px] inline-flex h-8 items-center gap-1.5 rounded-full bg-field px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
                      >
                        <Handshake className="h-3.5 w-3.5" /> Signer
                      </button>
                    )}
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

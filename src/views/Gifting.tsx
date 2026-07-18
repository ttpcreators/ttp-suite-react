import { useEffect, useMemo, useState } from "react";
import { Gift, Mail, Package, CalendarClock, Pencil, Trash2, LayoutGrid, List as ListIcon, ShieldCheck, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, TextField, AutoGrowTextField, SelectField } from "@/components/ui/form";
import { StatusSelect } from "@/components/ui/status-select";
import { ActionMenu } from "@/components/ui/action-menu";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { notifyCreator } from "@/lib/push";
import { toISODate, frDate } from "@/lib/dates";
import { cn, titleCase } from "@/lib/utils";
import { GIFT_COLS, GIFT_STATUS, DEFAULT_MENTIONS, giftStatusMeta, type Gift as GiftRow } from "@/lib/gifting";

type GView = "cards" | "list";

/** Chip « contenu attendu / spontané ». */
function ContentChip({ expected }: { expected: boolean | null }) {
  return expected ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
      Contenu attendu
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
      Sans contrepartie
    </span>
  );
}

export function Gifting() {
  const creators = useCreators();
  const live = useLiveKey();
  const [rows, setRows] = useState<GiftRow[] | null>(() => getCache<GiftRow[]>("gifting"));
  const [error, setError] = useState(false);
  const [view, setView] = useState<GView>("list");

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [creator, setCreator] = useState("");
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [value, setValue] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [contentExpected, setContentExpected] = useState(false);
  const [deliverables, setDeliverables] = useState("");
  const [status, setStatus] = useState("recu");
  const [mentions, setMentions] = useState(DEFAULT_MENTIONS);
  const [note, setNote] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await supabase.from("gifting").select(GIFT_COLS).order("sort_order", { ascending: false });
      if (!active) return;
      if (err) {
        setError(true);
        setRows([]);
        return;
      }
      const list = (data as GiftRow[]) ?? [];
      setCache("gifting", list);
      setRows(list);
      setError(false);
    })();
    return () => {
      active = false;
    };
  }, [live]);

  const list = rows ?? [];
  const loading = rows === null;

  const creatorOptions = [
    { value: "", label: "— Choisir —" },
    ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) })),
  ];

  function resetForm() {
    setEditId(null);
    setCreator("");
    setBrand("");
    setProduct("");
    setValue("");
    setContactName("");
    setContactEmail("");
    setReceivedOn("");
    setContentExpected(false);
    setDeliverables("");
    setStatus("recu");
    setMentions(DEFAULT_MENTIONS);
    setNote("");
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function startEdit(g: GiftRow) {
    setEditId(g.id);
    setCreator(g.creator ?? "");
    setBrand(g.brand ?? "");
    setProduct(g.product ?? "");
    setValue(g.value ?? "");
    setContactName(g.contact_name ?? "");
    setContactEmail(g.contact_email ?? "");
    setReceivedOn(g.received_on ? toISODate(g.received_on) : "");
    setContentExpected(!!g.content_expected);
    setDeliverables(g.deliverables ?? "");
    setStatus(g.status ?? "recu");
    setMentions(g.mentions ?? DEFAULT_MENTIONS);
    setNote(g.note ?? "");
    setFormOpen(true);
  }

  async function save() {
    const b = brand.trim();
    const p = product.trim();
    if (!b && !p) {
      toast("Indique au moins la marque ou le produit");
      return;
    }
    const email = contactEmail.trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast("Email de l'interlocuteur invalide");
      return;
    }
    const patch = {
      creator: creator.trim() || null,
      brand: b || null,
      product: p || null,
      value: value.trim() || null,
      contact_name: contactName.trim() || null,
      contact_email: email || null,
      received_on: receivedOn || null,
      content_expected: contentExpected,
      deliverables: contentExpected ? deliverables.trim() || null : null,
      status,
      mentions: mentions.trim() || null,
      note: note.trim() || null,
    };
    if (editId) {
      const ok = await dbUpdate("gifting", editId, patch);
      if (!ok) return toast("Erreur — réessaie");
      setRows((prev) => (prev ?? []).map((r) => (r.id === editId ? { ...r, ...patch } : r)));
      toast("Gifting modifié ✓");
    } else {
      const created = await dbInsert("gifting", { ...patch, source: "agency", sort_order: nextOrder(list) });
      if (!created) return toast("Erreur — réessaie");
      setRows((prev) => [created as unknown as GiftRow, ...(prev ?? [])]);
      if (patch.creator) notifyCreator("gift", patch.creator, b || p);
      toast("Gifting ajouté ✓");
    }
    resetForm();
    setFormOpen(false);
  }

  async function changeStatus(g: GiftRow, next: string) {
    const prevStatus = g.status;
    setRows((prev) => (prev ?? []).map((r) => (r.id === g.id ? { ...r, status: next } : r)));
    if (!(await dbUpdate("gifting", g.id, { status: next }))) {
      // Échec (RLS/réseau) : on remet l'ancien statut, sinon l'UI ment jusqu'au refetch.
      setRows((prev) => (prev ?? []).map((r) => (r.id === g.id ? { ...r, status: prevStatus } : r)));
      toast("Erreur — réessaie");
    }
  }

  async function remove(g: GiftRow) {
    if (await dbTrash("gifting", g.id, g.brand || g.product || "Gifting", g.creator || undefined)) {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== g.id));
      toast("Déplacé dans la corbeille");
    } else toast("Erreur — réessaie");
  }

  // « En attente » = contenu attendu, pas encore publié/clos ET pas refusé (un cadeau
  // refusé n'a plus de contenu en attente).
  const attente = useMemo(
    () => list.filter((g) => g.content_expected && g.status !== "publie" && g.status !== "clos" && g.status !== "refuse").length,
    [list],
  );

  const actions = (g: GiftRow) => (
    <ActionMenu
      items={[
        { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(g) },
        {
          key: "del",
          label: "Supprimer",
          icon: Trash2,
          danger: true,
          onClick: () => remove(g),
          confirm: { title: "Supprimer le gifting", message: `Supprimer « ${g.brand || g.product || "ce gifting"} » ? Il ira dans la corbeille.` },
        },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {loading ? (
            <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
          ) : (
            <>
              <span className="font-semibold text-foreground">{list.length}</span>
              <span>{list.length > 1 ? "cadeaux suivis" : "cadeau suivi"}</span>
              {attente > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  {attente} contenu{attente > 1 ? "s" : ""} en attente
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <div className="flex items-center gap-1 rounded-xl border border-border bg-panel p-1">
              {([["cards", LayoutGrid, "Cartes"], ["list", ListIcon, "Liste"]] as [GView, typeof LayoutGrid, string][]).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  title={label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}
          <AddButton label="Gifting" onClick={openCreate} />
        </div>
      </div>

      <InlineForm
        open={formOpen}
        title={editId ? "Modifier le gifting" : "Nouveau gifting"}
        onClose={() => {
          setFormOpen(false);
          resetForm();
        }}
        onSubmit={save}
        submitLabel={editId ? "Enregistrer" : "Ajouter"}
      >
        <SelectField label="Créateur" value={creator} onChange={setCreator} options={creatorOptions} className="sm:min-w-[170px] flex-1" />
        <TextField label="Marque / expéditeur" value={brand} onChange={setBrand} placeholder="ex Sézane" className="sm:min-w-[170px] flex-1" />
        <TextField label="Produit / cadeau" value={product} onChange={setProduct} placeholder="ex Sac cuir + foulard" className="sm:min-w-[200px] flex-[2]" />
        <TextField label="Valeur estimée" value={value} onChange={setValue} placeholder="ex ≈ 220 €" className="sm:min-w-[120px] flex-1" />
        <TextField label="Interlocuteur" value={contactName} onChange={setContactName} placeholder="ex Julie (RP)" className="sm:min-w-[150px] flex-1" />
        <TextField label="Email interlocuteur" value={contactEmail} onChange={setContactEmail} type="email" placeholder="julie@marque.com" className="sm:min-w-[180px] flex-1" />
        <TextField label="Date de réception" value={receivedOn} onChange={setReceivedOn} type="date" className="sm:min-w-[150px] flex-1" />
        <SelectField label="Statut" value={status} onChange={setStatus} options={GIFT_STATUS.map((s) => ({ value: s.value, label: s.label }))} className="sm:min-w-[160px] flex-1" />

        {/* Contenu attendu ? */}
        <button
          type="button"
          onClick={() => setContentExpected((v) => !v)}
          className={cn(
            "flex min-w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-[12px] font-semibold transition-colors",
            contentExpected ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border border-border text-muted-foreground hover:bg-rowhover",
          )}
        >
          <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded", contentExpected ? "bg-amber-500 text-white" : "border border-border")}>
            {contentExpected && "✓"}
          </span>
          La marque attend du contenu en retour
        </button>
        {contentExpected && (
          <TextField label="Contenu attendu" value={deliverables} onChange={setDeliverables} placeholder="ex 1 story + 1 post" className="min-w-full flex-[2]" />
        )}

        <AutoGrowTextField label="Mentions à rappeler au créateur" value={mentions} onChange={setMentions} placeholder={DEFAULT_MENTIONS} className="min-w-full" minRows={2} />
        <AutoGrowTextField label="Note (infos libres)" value={note} onChange={setNote} placeholder="Contexte, historique, préférences…" className="min-w-full" minRows={2} />
      </InlineForm>

      {/* Contenu */}
      {error ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <AnimatedBadge status="danger" size="sm">Erreur de chargement</AnimatedBadge>
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-signalsoft text-signaltext">
            <Gift className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">Aucun gifting suivi</div>
          <div className="mt-1.5 text-xs text-faint">Ajoute un cadeau reçu pour tracer sa provenance et le contenu attendu.</div>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((g) => (
            <article key={g.id} className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {g.brand || "—"} {g.creator && <span className="text-faint">→ {titleCase(g.creator)}</span>}
                  </div>
                  {g.product && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <Package className="h-3.5 w-3.5 shrink-0 text-faint" /> <span className="truncate">{g.product}</span>
                      {g.value && <span className="shrink-0 text-faint">· {g.value}</span>}
                    </div>
                  )}
                </div>
                <div className="w-[168px] shrink-0">
                  <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={(v) => changeStatus(g, v)} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ContentChip expected={g.content_expected} />
                {g.received_on && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                    <CalendarClock className="h-3.5 w-3.5" /> {frDate(g.received_on)}
                  </span>
                )}
              </div>

              {g.content_expected && g.deliverables && (
                <div className="mt-2.5 rounded-lg bg-panel px-3 py-2 text-[12px] text-muted-foreground">Attendu : {g.deliverables}</div>
              )}

              {(g.contact_name || g.contact_email) && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-faint" />
                  {g.contact_email ? (
                    <a href={`mailto:${g.contact_email}`} className="truncate text-primary hover:underline">
                      {g.contact_name ? `${g.contact_name} · ` : ""}{g.contact_email}
                    </a>
                  ) : (
                    <span className="truncate">{g.contact_name}</span>
                  )}
                </div>
              )}

              {g.mentions && (
                <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{g.mentions}</span>
                </div>
              )}

              {g.note && <p className="mt-2.5 text-[12px] leading-relaxed text-faint">{g.note}</p>}

              <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2.5">{actions(g)}</div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {list.map((g) => (
            <div key={g.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-rowhover">
              <span className={cn("size-2 shrink-0 rounded-full", giftStatusMeta(g.status).dot)} title={giftStatusMeta(g.status).label} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {g.brand || g.product || "—"} {g.creator && <span className="text-faint">→ {titleCase(g.creator)}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  {g.product && g.brand && <span className="truncate">{g.product}</span>}
                  {g.value && <span>{g.value}</span>}
                  {g.received_on && <span>{frDate(g.received_on)}</span>}
                  {g.content_expected && <span className="text-amber-600 dark:text-amber-400">contenu attendu</span>}
                  {g.contact_email && (
                    <a href={`mailto:${g.contact_email}`} className="text-primary hover:underline">{g.contact_email}</a>
                  )}
                </div>
              </div>
              <div className="hidden w-[168px] shrink-0 sm:block">
                <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={(v) => changeStatus(g, v)} />
              </div>
              {actions(g)}
            </div>
          ))}
        </div>
      )}

      {/* Rappel légal discret */}
      {list.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-[11px] leading-relaxed text-faint">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Un cadeau reste une contrepartie : dès qu'il est mis en avant, le créateur doit le signaler comme communication commerciale
            (« Produit offert » / « Cadeau »), conformément à la loi n° 2023-451 encadrant l'influence commerciale.
          </span>
        </div>
      )}
    </div>
  );
}

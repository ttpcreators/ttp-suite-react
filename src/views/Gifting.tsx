import { useStickyState } from "@/lib/useStickyState";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Gift, Mail, Package, CalendarClock, Pencil, Trash2, LayoutGrid, List as ListIcon, ShieldCheck, Eye, X, PanelsTopLeft, ChevronLeft, Handshake } from "@/components/icons";
import { HelpTip } from "@/components/ui/help-tip";
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
import { toISODate, fmtDayAny } from "@/lib/dates";
import { cn, titleCase } from "@/lib/utils";
import { GIFT_COLS, GIFT_STATUS, DEFAULT_MENTIONS, giftStatusMeta, type Gift as GiftRow } from "@/lib/gifting";
import { PeriodFilter, periodsFrom, inPeriod } from "@/components/ui/period-filter";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { Overlay } from "@/components/mobile/ios-sheet";
import { CreatorPickerField } from "@/components/ui/creator-picker";
import { CollabField, ObjectCollabLink, useCollabLinkReady } from "@/components/collab-links";
import { getCollabLink, openCollab, setCollabLink } from "@/lib/collabLinksDb";
import { StatsBento } from "@/components/ui/stats-bento";
import { BrandTile, DetailRows, MasterList } from "@/components/brand-tile";
import { firstNameOf, giftCounts } from "@/lib/gifting";

type GView = "detail" | "cards" | "list";

/** Chip « contenu attendu / spontané ». */
function ContentChip({ expected }: { expected: boolean | null }) {
  return expected ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[12px] font-medium text-amber">
      Contenu attendu
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
      Sans contrepartie
    </span>
  );
}

/**
 * `embedded` : onglet « Gifting » de la page Collabs (classeur). Affichage maître-détail par
 * défaut, compteurs en tête ; la page Gifting autonome (anciens liens) reste identique.
 */
export function Gifting({ embedded = false }: { embedded?: boolean } = {}) {
  const creators = useCreators();
  const live = useLiveKey();
  const [rows, setRows] = useState<GiftRow[] | null>(() => getCache<GiftRow[]>("gifting"));
  const [error, setError] = useState(false);
  const [view, setView] = useStickyState<GView>(
    embedded ? "collabs:gifting-vue" : "gifting:vue",
    embedded ? ["detail", "cards", "list"] : ["cards", "list"],
    embedded ? "detail" : "list",
  );
  const [selId, setSelId] = useState<string | null>(null); // maître-détail : gifting ouvert
  const [phoneDetail, setPhoneDetail] = useState(false);
  const [linkKey, setLinkKey] = useState(0); // relit le lien collab après « Transformer »
  const [viewG, setViewG] = useState<GiftRow | null>(null); // fiche détail (clic sur une ligne)

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
  const [period, setPeriod] = useState("");
  const periods = periodsFrom(list.map((g) => g.received_on));
  const shown = period ? list.filter((g) => inPeriod(g.received_on, period)) : list;


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

  const [collabId, setCollabId] = useState(""); // formulaire : collab à relier (après le SQL collab_id)
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
      if (collabId) void setCollabLink("gifting", (created as { id: string }).id, collabId);
      if (patch.creator) notifyCreator("gift", patch.creator, b || p);
      toast("Gifting ajouté ✓");
    }
    resetForm();
    setCollabId("");
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
  // refusé n'a plus de contenu en attente). Compté sur la période affichée (shown).
  const attente = useMemo(
    () => shown.filter((g) => g.content_expected && g.status !== "publie" && g.status !== "clos" && g.status !== "refuse").length,
    [shown],
  );

  const actions = (g: GiftRow) => (
    <ActionMenu
      items={[
        { key: "view", label: "Voir la fiche", icon: Eye, onClick: () => setViewG(g) },
        { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(g) },
        {
          key: "del",
          label: "Mettre à la corbeille",
          icon: Trash2,
          danger: true,
          onClick: () => remove(g),
          confirm: { title: "Mettre à la corbeille", message: `Déplacer « ${g.brand || g.product || "ce gifting"} » vers la corbeille ? Tu pourras le restaurer.`, confirmLabel: "Mettre à la corbeille" },
        },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <PageHeaderRow>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {loading ? (
            <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
          ) : (
            <>
              <span className="font-semibold text-foreground">{shown.length}</span>
              <span>{shown.length > 1 ? "cadeaux suivis" : "cadeau suivi"}</span>
              <HelpTip title="Mention obligatoire">
                <p>Un cadeau reste une contrepartie : dès qu'il est mis en avant, le créateur doit le signaler comme communication commerciale (« Produit offert » ou « Cadeau »).</p>
                <p>C'est la loi n° 2023-451 sur l'influence commerciale.</p>
              </HelpTip>
              {attente > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-semibold text-amber">
                  {attente} contenu{attente > 1 ? "s" : ""} en attente
                </span>
              )}
            </>
          )}
        </div>
        <AddButton label="Gifting" onClick={openCreate} />
        </div>
      </PageHeaderRow>

      {/* Affichage + période : barre sous l'en-tête (comme Briefs et Collabs) */}
      {(list.length > 0 || periods.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {periods.length > 0 ? <PeriodFilter value={period} onChange={setPeriod} periods={periods} /> : <span />}
          {list.length > 0 && (
            <Tabs
              label="Affichage des giftings"
              value={view}
              onValueChange={(v) => setView(v as GView)}
              items={[
                ...(embedded ? [{ value: "detail", label: "Détail", icon: <PanelsTopLeft className="h-4 w-4" />, hideLabel: "mobile" as const }] : []),
                { value: "cards", label: "Cartes", icon: <LayoutGrid className="h-4 w-4" />, hideLabel: "mobile" },
                { value: "list", label: "Liste", icon: <ListIcon className="h-4 w-4" />, hideLabel: "mobile" },
              ]}
            />
          )}
        </div>
      )}

      {embedded && !loading && list.length > 0 && (() => {
        const c = giftCounts(shown);
        return (
          <StatsBento
            primary={{ eyebrow: "Cadeaux reçus", value: String(c.total), caption: period ? "sur la période choisie." : "au total." }}
            bars={{ label: "Contenus attendus", value: String(c.expected), series: GIFT_STATUS.map((st) => shown.filter((g) => (g.status ?? "recu") === st.value).length) }}
            small={{ value: String(c.waiting), label: "Contenus en attente" }}
            accent={{ value: String(c.published), label: "Contenus publiés", icon: ShieldCheck }}
          />
        );
      })()}

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
        <CreatorPickerField label="Créateur" value={creator} onChange={setCreator} creators={creators} className="sm:min-w-[170px] flex-1" />
        {editId ? (
          <ObjectCollabLink table="gifting" id={editId} creator={creator} withLabel className="sm:min-w-[170px] flex-1" />
        ) : (
          <CollabField value={collabId} onChange={setCollabId} creator={creator} className="sm:min-w-[170px] flex-1" />
        )}
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
            "flex min-w-full items-center gap-2 rounded-full px-3.5 py-2.5 text-[12px] font-semibold transition-colors",
            contentExpected ? "bg-foreground/[0.06] text-amber" : "border border-border text-muted-foreground hover:bg-rowhover",
          )}
        >
          <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded", contentExpected ? "bg-foreground text-background" : "border border-border")}>
            {contentExpected && "✓"}
          </span>
          La marque attend du contenu en retour
        </button>
        {contentExpected && (
          <TextField label="Contenu attendu" value={deliverables} onChange={setDeliverables} placeholder="ex 1 story + 1 post" className="min-w-full flex-[2]" />
        )}

        <AutoGrowTextField label="Mentions à rappeler au créateur" value={mentions} onChange={setMentions} placeholder={DEFAULT_MENTIONS} className="min-w-full" minRows={2} />
        <AutoGrowTextField label="Note (infos libres)" value={note} onChange={setNote} placeholder="Contexte, historique, préférences…" className="min-w-full" minRows={2} mentions={creators} />
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
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-signalsoft text-signaltext">
            <Gift className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">{period ? "Aucun gifting sur cette période" : "Aucun gifting suivi"}</div>
          <div className="mt-1.5 text-xs text-faint">{period ? "Change de période ou choisis « Toutes périodes »." : "Ajoute un cadeau reçu pour tracer sa provenance et le contenu attendu."}</div>
        </div>
      ) : view === "detail" ? (
        (() => {
          const sel = shown.find((g) => g.id === selId) ?? shown[0];
          const photoOf = (name?: string | null) => (name ? creators.find((c) => c.name.toLowerCase() === name.toLowerCase())?.photo_url ?? null : null);
          return (
            <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className={cn(phoneDetail && "max-lg:hidden")}>
                <MasterList
                  groups={GIFT_STATUS.map((st) => ({ key: st.value, label: st.label, items: shown.filter((g) => (g.status ?? "recu") === st.value) }))}
                  selectedId={sel?.id}
                  onPick={(id) => {
                    setSelId(id);
                    setPhoneDetail(true);
                  }}
                  row={(g, on) => ({
                    tile: <BrandTile brand={g.brand || g.product || "?"} email={g.contact_email} creator={g.creator} photoUrl={photoOf(g.creator)} onAccent={on} />,
                    title: `${g.brand || g.product || "Gifting"}${g.creator ? ` × ${firstNameOf(g.creator)}` : ""}`,
                    sub: [g.product && g.brand ? g.product : "", g.value ?? "", fmtDayAny(g.received_on)].filter(Boolean).slice(0, 3).join(" · "),
                  })}
                />
              </div>
              {sel && (
                <div className={cn("min-w-0", !phoneDetail && "max-lg:hidden")}>
                  <button type="button" onClick={() => setPhoneDetail(false)} className="mb-2 flex min-h-11 items-center gap-1 text-[16px] font-medium text-primary lg:hidden">
                    <ChevronLeft className="h-4 w-4" /> Gifting
                  </button>
                  <GiftPanel
                    key={`${sel.id}:${linkKey}`}
                    g={sel}
                    photoUrl={photoOf(sel.creator)}
                    onStatus={(v) => changeStatus(sel, v)}
                    onEdit={() => startEdit(sel)}
                    onRemove={() => void remove(sel)}
                    onLinked={() => setLinkKey((k) => k + 1)}
                  />
                </div>
              )}
            </div>
          );
        })()
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {shown.map((g) => (
            <article
              key={g.id}
              onClick={() => setViewG(g)}
              className="flex cursor-pointer flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm transition-colors hover:bg-rowhover/40"
            >
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
                <div className="w-[168px] shrink-0" onClick={(e) => e.stopPropagation()}>
                  <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={(v) => changeStatus(g, v)} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ContentChip expected={g.content_expected} />
                {g.received_on && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                    <CalendarClock className="h-3.5 w-3.5" /> {fmtDayAny(g.received_on)}
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
                    <a href={`mailto:${g.contact_email}`} onClick={(e) => e.stopPropagation()} className="truncate text-primary hover:underline">
                      {g.contact_name ? `${g.contact_name} · ` : ""}{g.contact_email}
                    </a>
                  ) : (
                    <span className="truncate">{g.contact_name}</span>
                  )}
                </div>
              )}

              {g.mentions && (
                <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-border bg-foreground/[0.06] px-3 py-2 text-[11px] leading-snug text-amber">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{g.mentions}</span>
                </div>
              )}

              {g.note && <p className="mt-2.5 text-[12px] leading-relaxed text-faint">{g.note}</p>}

              <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2.5" onClick={(e) => e.stopPropagation()}>{actions(g)}</div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
          {shown.map((g) => (
            <div
              key={g.id}
              onClick={() => setViewG(g)}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover"
            >
              <span className={cn("size-2 shrink-0 rounded-full", giftStatusMeta(g.status).dot)} title={giftStatusMeta(g.status).label} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {g.brand || g.product || "—"} {g.creator && <span className="text-faint">→ {titleCase(g.creator)}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  {g.product && g.brand && <span className="truncate">{g.product}</span>}
                  {g.value && <span>{g.value}</span>}
                  {g.received_on && <span>{fmtDayAny(g.received_on)}</span>}
                  {g.content_expected && <span className="text-amber">contenu attendu</span>}
                  {g.contact_email && (
                    <a href={`mailto:${g.contact_email}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{g.contact_email}</a>
                  )}
                </div>
              </div>
              <div className="hidden w-[168px] shrink-0 sm:block" onClick={(e) => e.stopPropagation()}>
                <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={(v) => changeStatus(g, v)} />
              </div>
              <div onClick={(e) => e.stopPropagation()}>{actions(g)}</div>
            </div>
          ))}
        </div>
      )}


      {/* Fiche détail (clic sur une carte/ligne) */}
      {viewG && (
        <GiftDetail
          g={viewG}
          onClose={() => setViewG(null)}
          onEdit={() => {
            const g = viewG;
            setViewG(null);
            startEdit(g);
          }}
        />
      )}
    </div>
  );
}

/** Fiche détaillée d'un gifting : tout ce qui est saisi, en lecture, dans une modale. */
function GiftDetail({ g, onClose, onEdit }: { g: GiftRow; onClose: () => void; onEdit: () => void }) {
  const st = giftStatusMeta(g.status);
  const rows: [string, ReactNode][] = [
    ["Créateur", g.creator ? titleCase(g.creator) : "—"],
    ["Marque / expéditeur", g.brand || "—"],
    ["Produit", g.product || "—"],
    ["Valeur estimée", g.value || "—"],
    ["Reçu le", fmtDayAny(g.received_on) || "—"],
    ["Interlocuteur", g.contact_name || "—"],
    [
      "Email",
      g.contact_email ? (
        <a href={`mailto:${g.contact_email}`} className="text-primary hover:underline">{g.contact_email}</a>
      ) : (
        "—"
      ),
    ],
    ["Contenu attendu", g.content_expected ? g.deliverables || "Oui" : "Non — sans contrepartie"],
  ];
  return (
    <Overlay className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6" onClose={onClose}>
      <div className="my-2 w-full max-w-lg rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              {g.brand || g.product || "Gifting"} {g.creator && <span className="text-faint">→ {titleCase(g.creator)}</span>}
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", st.dot)} /> {st.label}
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-2">
          <dl className="divide-y divide-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-[12px] text-faint">{k}</dt>
                <dd className="min-w-0 text-right text-[13px] font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

          {g.mentions && (
            <div className="mb-3 mt-1 flex items-start gap-1.5 rounded-lg border border-border bg-foreground/[0.06] px-3 py-2 text-[11px] leading-snug text-amber">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{g.mentions}</span>
            </div>
          )}
          {g.note && (
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Note</div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{g.note}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button type="button" onClick={onEdit} className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * Fiche d'un gifting dans le maître-détail (onglet Gifting de Collabs) : tout ce qui est
 * saisi, statut modifiable, collab liée (ou « Relier »), « Transformer en collab ».
 */
function GiftPanel({ g, photoUrl, onStatus, onEdit, onRemove, onLinked }: {
  g: GiftRow; photoUrl: string | null; onStatus: (v: string) => void; onEdit: () => void; onRemove: () => void; onLinked: () => void;
}) {
  const ready = useCollabLinkReady();
  const [linked, setLinked] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void getCollabLink("gifting", g.id).then((c) => alive && setLinked(c));
    return () => {
      alive = false;
    };
  }, [g.id]);
  // Crée la collab (marque, créateur, livrables, cachet vide) et y relie le gifting.
  const transform = async () => {
    if (busy || !g.creator) return;
    setBusy(true);
    const { data: last } = await supabase.from("collabs").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const order = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 1;
    const created = await dbInsert("collabs", {
      brand: (g.brand || g.product || "Gifting").trim(),
      creator: g.creator,
      contact: g.contact_name || null,
      deliverables: g.deliverables || null,
      cachet: null,
      step: 1,
      status: "active",
      sort_order: order,
    });
    if (!created) {
      setBusy(false);
      return toast("Erreur, réessaie");
    }
    const id = (created as { id: string }).id;
    await setCollabLink("gifting", g.id, id);
    setBusy(false);
    onLinked();
    toast("Collab créée ✓");
    void openCollab(id);
  };
  const rows: [string, ReactNode][] = [
    ["Produit", g.product || "—"],
    ["Valeur estimée", g.value || "—"],
    ["Reçu le", fmtDayAny(g.received_on) || "—"],
    ["Contenu attendu", g.content_expected ? g.deliverables || "Oui" : "Aucun"],
    ["Interlocuteur", g.contact_name || "—"],
    ["Email", g.contact_email ? <a href={`mailto:${g.contact_email}`} className="text-primary hover:underline">{g.contact_email}</a> : "—"],
  ];
  const title = `${g.brand || g.product || "Gifting"}${g.creator ? ` × ${titleCase(g.creator)}` : ""}`;
  return (
    <div className="flex flex-col gap-4 rounded-[22px] bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <BrandTile brand={g.brand || g.product || "?"} email={g.contact_email} creator={g.creator} photoUrl={photoUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground [overflow-wrap:anywhere]">{title}</h2>
          <div className="mt-2 w-[200px] max-w-full">
            <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={onStatus} />
          </div>
        </div>
        <ActionMenu
          items={[
            { key: "edit", label: "Modifier", icon: Pencil, onClick: onEdit },
            {
              key: "del",
              label: "Mettre à la corbeille",
              icon: Trash2,
              danger: true,
              onClick: onRemove,
              confirm: { title: "Mettre à la corbeille", message: `Déplacer « ${g.brand || g.product || "ce gifting"} » vers la corbeille ? Tu pourras le restaurer.`, confirmLabel: "Mettre à la corbeille" },
            },
          ]}
        />
      </div>

      <DetailRows rows={rows} />

      {ready && (
        <dl className="rounded-[16px] bg-panel">
          <ObjectCollabLink table="gifting" id={g.id} creator={g.creator} asRow />
        </dl>
      )}

      {g.mentions && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0" /> Mention à rappeler
          <HelpTip title="Mention à rappeler au créateur">
            <p>{g.mentions}</p>
          </HelpTip>
        </div>
      )}
      {g.note && (
        <div>
          <div className="mb-1 text-[13px] font-medium text-muted-foreground">Note</div>
          <p className="text-[14px] leading-relaxed text-foreground">{g.note}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="flex h-11 items-center gap-1.5 rounded-full bg-field px-4 text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover">
          <Pencil className="h-4 w-4" /> Modifier
        </button>
        {ready && linked === null && g.creator && (
          <button type="button" onClick={() => void transform()} disabled={busy} title="Crée la collab (marque, créateur, contenu attendu) et la relie à ce gifting" className="flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
            <Handshake className="h-4 w-4" /> Créer la collab
          </button>
        )}
      </div>
    </div>
  );
}

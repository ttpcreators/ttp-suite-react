import { useStickyState } from "@/lib/useStickyState";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Gift, Mail, Package, CalendarClock, Pencil, Trash2, LayoutGrid, List as ListIcon, ShieldCheck, Info, Eye, X, Copy, User } from "@/components/icons";
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
import { cn, initials, titleCase } from "@/lib/utils";
import {
  GIFT_COLS, GIFT_STATUS, GIFT_TABS, GIFT_TAB_META, DEFAULT_MENTIONS, giftGroup, giftKpis, giftSearchFields, giftStatusMeta, giftTabCounts, inGiftTab,
  type Gift as GiftRow, type GiftTab,
} from "@/lib/gifting";
import { matchWords } from "@/lib/search";
import { PillSearch } from "@/components/ui/pill-search";
import { PeriodFilter, periodsFrom, inPeriod } from "@/components/ui/period-filter";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { FolderTabs, type FolderTabItem } from "@/components/ui/folder-tabs";
import { MailAvatar } from "@/components/mail-avatar";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { Overlay } from "@/components/mobile/ios-sheet";

type GView = "cards" | "list";

/** Carte d'un cadeau : même habillage que les lignes du Roster (espacées, arrondies, ombre légère). */
const CARD =
  "cursor-pointer rounded-2xl bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-border/70 outline-none transition-[background-color,box-shadow] hover:bg-rowhover hover:shadow-[0_6px_18px_-10px_rgba(15,23,42,0.22)] focus-visible:ring-2 focus-visible:ring-primary dark:bg-white/[0.04]";
/** Bouton icône discret : 44 px au doigt, compact à la souris. */
const ICON_BTN =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground md:h-8 md:w-8";
/** Sélecteur de statut en pilule, 44 px de haut sur téléphone. */
const STATUS_PILL = "[&>button]:h-11 [&>button]:rounded-full md:[&>button]:h-9";

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Mois courant « aaaa-mm », calculé au rendu (l'app peut rester ouverte d'un mois à l'autre). */
const thisMonth = () => new Intl.DateTimeFormat("fr-CA", { year: "numeric", month: "2-digit" }).format(new Date());

async function copyEmail(email: string) {
  try {
    await navigator.clipboard.writeText(email);
    toast("Adresse copiée");
  } catch {
    toast("Copie impossible");
  }
}

/** Logo de la marque (trouvé par son nom ou l'adresse du contact), sinon monogramme gris. */
function BrandLogo({ g, className }: { g: GiftRow; className?: string }) {
  const label = g.brand || g.product || "Gifting";
  return (
    <MailAvatar
      name={label}
      email={g.contact_email}
      brand={g.brand}
      size="lg"
      className={cn("rounded-xl", className)}
      fallback={initials(label) || "?"}
      fallbackClassName="bg-muted font-semibold uppercase text-muted-foreground"
    />
  );
}

/** Créateur du cadeau : petite photo + nom. */
function CreatorLine({ name, photo }: { name: string | null; photo?: string | null }) {
  if (!name) return <span className="text-faint">Sans créateur</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <CreatorAvatar name={name} photoUrl={photo} className="h-5 w-5 shrink-0 rounded-full text-[8px]" />
      <span className="truncate font-medium text-foreground/80">{titleCase(name)}</span>
    </span>
  );
}

/** Copier l'adresse du contact / lui écrire, en icônes discrètes. */
function ContactActions({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <div className="flex shrink-0 items-center" onClick={stop}>
      <button type="button" onClick={() => void copyEmail(email)} title={`Copier ${email}`} aria-label={`Copier l'adresse ${email}`} className={ICON_BTN}>
        <Copy className="h-4 w-4" />
      </button>
      <a href={`mailto:${email}`} title={`Écrire à ${email}`} aria-label={`Écrire à ${email}`} className={ICON_BTN}>
        <Mail className="h-4 w-4" />
      </a>
    </div>
  );
}

/** « Contenu attendu » en orange tant qu'il n'est pas publié (état en attente), gris ensuite. */
function AwaitingTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-wait">
      <span className="size-1.5 rounded-full bg-wait" /> Contenu attendu
    </span>
  );
}

type CardProps = {
  g: GiftRow;
  photo?: string | null;
  onOpen: () => void;
  onStatus: (v: string) => void;
  actions: ReactNode;
};

const openOnKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/** Vue Cartes : une carte complète par cadeau. */
function GiftCard({ g, photo, onOpen, onStatus, actions }: CardProps) {
  const awaiting = giftGroup(g) === "attente";
  return (
    <article role="button" tabIndex={0} onClick={onOpen} onKeyDown={openOnKey(onOpen)} className={cn(CARD, "flex flex-col p-4 sm:p-5")}>
      <div className="flex items-start gap-3">
        <BrandLogo g={g} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight text-foreground">{g.brand || g.product || "Sans marque"}</div>
          <div className="mt-1 flex min-w-0 text-[12px]">
            <CreatorLine name={g.creator} photo={photo} />
          </div>
        </div>
        <div className="-mr-2 -mt-1" onClick={stop}>
          {actions}
        </div>
      </div>

      {(g.product || g.value || g.received_on || g.contact_name) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {g.product && g.brand && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Package className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="truncate">{g.product}</span>
            </span>
          )}
          {g.value && <span className="tabular-nums">{g.value}</span>}
          {g.received_on && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-faint" /> {frDate(g.received_on)}
            </span>
          )}
          {g.contact_name && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <User className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="truncate">{g.contact_name}</span>
            </span>
          )}
        </div>
      )}

      {g.content_expected ? (
        <div className="mt-3 rounded-xl bg-foreground/[0.04] px-3 py-2 text-[12px]">
          {awaiting ? <AwaitingTag /> : <span className="text-[11px] font-semibold text-muted-foreground">Contenu attendu</span>}
          {g.deliverables && <div className="mt-0.5 text-muted-foreground">{g.deliverables}</div>}
        </div>
      ) : (
        <div className="mt-3 text-[12px] text-faint">Sans contrepartie</div>
      )}

      {g.mentions && (
        <div className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-snug text-faint" title={g.mentions}>
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">{g.mentions}</span>
        </div>
      )}

      {g.note && <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-faint">{g.note}</p>}

      <div className="mt-auto pt-3">
        <div className="flex items-center gap-2 border-t border-border pt-3" onClick={stop}>
          <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={onStatus} className={cn("min-w-0 flex-1 sm:max-w-[200px]", STATUS_PILL)} />
          <div className="ml-auto">
            <ContactActions email={g.contact_email} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** Vue Liste : une ligne-carte compacte par cadeau. */
function GiftRowCard({ g, photo, onOpen, onStatus, actions }: CardProps) {
  const awaiting = giftGroup(g) === "attente";
  const meta = [g.product && g.brand ? g.product : null, g.value, g.received_on ? frDate(g.received_on) : null].filter(Boolean) as string[];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={openOnKey(onOpen)}
      className={cn(CARD, "flex flex-col gap-2 px-4 py-3 sm:px-5 md:flex-row md:items-center md:gap-4")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <BrandLogo g={g} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-[14px] font-semibold text-foreground">{g.brand || g.product || "Sans marque"}</span>
            {awaiting && <AwaitingTag />}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
            <CreatorLine name={g.creator} photo={photo} />
            {meta.map((m, i) => (
              <span key={i} className="inline-flex min-w-0 items-center gap-2">
                <span className="text-faint">·</span>
                <span className="truncate">{m}</span>
              </span>
            ))}
            {g.content_expected && g.deliverables && (
              <span className="hidden min-w-0 items-center gap-2 lg:inline-flex">
                <span className="text-faint">·</span>
                <span className="truncate">Attendu : {g.deliverables}</span>
              </span>
            )}
          </div>
        </div>
        <div className="-mr-2 md:hidden" onClick={stop}>
          {actions}
        </div>
      </div>
      <div className="flex items-center gap-1 md:shrink-0" onClick={stop}>
        <StatusSelect value={g.status ?? "recu"} options={GIFT_STATUS} onChange={onStatus} className={cn("min-w-0 flex-1 md:w-[184px] md:flex-none", STATUS_PILL)} />
        <ContactActions email={g.contact_email} />
        <div className="hidden md:block">{actions}</div>
      </div>
    </div>
  );
}

export function Gifting() {
  const creators = useCreators();
  const live = useLiveKey();
  const [rows, setRows] = useState<GiftRow[] | null>(() => getCache<GiftRow[]>("gifting"));
  const [error, setError] = useState(false);
  const [view, setView] = useStickyState<GView>("gifting:vue", ["cards", "list"], "list");
  const [tab, setTab] = useStickyState<GiftTab>("gifting:onglet", GIFT_TABS, "tous");
  const [pageQ, setPageQ] = useState("");
  const [viewG, setViewG] = useState<GiftRow | null>(null); // fiche détail (clic sur une carte)

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
  // Recherche de la page, puis onglet (étape) : les compteurs des onglets suivent la recherche.
  const searched = pageQ.trim() ? shown.filter((g) => matchWords(pageQ, ...giftSearchFields(g))) : shown;
  const counts = giftTabCounts(searched);
  const visible = searched.filter((g) => inGiftTab(g, tab));
  const month = thisMonth();
  const kpi = giftKpis(shown, list, month);

  const photoOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of creators) m.set(c.name.trim().toLowerCase(), c.photo_url);
    return m;
  }, [creators]);

  const creatorOptions = [
    { value: "", label: "Choisir un créateur" },
    ...creators.map((c) => ({ value: c.name, label: titleCase(c.name), img: c.photo_url })),
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
      if (!ok) return toast("Erreur, réessaie");
      setRows((prev) => (prev ?? []).map((r) => (r.id === editId ? { ...r, ...patch } : r)));
      toast("Gifting modifié ✓");
    } else {
      const created = await dbInsert("gifting", { ...patch, source: "agency", sort_order: nextOrder(list) });
      if (!created) return toast("Erreur, réessaie");
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
      toast("Erreur, réessaie");
    }
  }

  async function remove(g: GiftRow) {
    if (await dbTrash("gifting", g.id, g.brand || g.product || "Gifting", g.creator || undefined)) {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== g.id));
      toast("Déplacé dans la corbeille");
    } else toast("Erreur, réessaie");
  }

  const actions = (g: GiftRow) => (
    <ActionMenu
      buttonClassName="h-11 w-11 md:h-9 md:w-9"
      items={[
        { key: "view", label: "Voir la fiche", icon: Eye, onClick: () => setViewG(g) },
        { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(g) },
        {
          key: "del",
          label: "Mettre à la corbeille",
          icon: Trash2,
          danger: true,
          onClick: () => remove(g),
          confirm: { title: "Mettre à la corbeille", message: `Déplacer « ${g.brand || g.product || "ce gifting"} » vers la corbeille ? Tu pourras le restaurer.`, confirmLabel: "Mettre à la corbeille" },
        },
      ]}
    />
  );

  // Bandeau de chiffres (comme Roster et Contacts) : un clic filtre, un second clic rend tout.
  const toggleTab = (t: GiftTab) => setTab(tab === t ? "tous" : t);
  const kpis: { key: string; label: string; value: number; foot: string; active: boolean; onClick: (() => void) | null; tone?: string }[] = [
    {
      key: "attente",
      label: "Contenu attendu",
      value: kpi.attente,
      foot: kpi.attente ? "à publier par les créateurs" : "rien en attente",
      active: tab === "attente",
      onClick: kpi.attente || tab === "attente" ? () => toggleTab("attente") : null,
      tone: kpi.attente ? "text-wait" : undefined,
    },
    {
      key: "mois",
      label: "Reçus ce mois",
      value: kpi.recusMois,
      foot: `${list.length} cadeau${list.length > 1 ? "x" : ""} au total`,
      active: period === month,
      onClick:
        kpi.recusMois || period === month
          ? () => {
              setPeriod(period === month ? "" : month);
              setTab("tous");
            }
          : null,
    },
    {
      key: "publies",
      label: "Contenus publiés",
      value: kpi.publies,
      foot: kpi.publiesPct === null ? "aucun contenu attendu" : `${kpi.publiesPct} % des contenus attendus`,
      active: tab === "publies",
      onClick: kpi.publies || tab === "publies" ? () => toggleTab("publies") : null,
    },
    {
      key: "clos",
      label: "Clôturés",
      value: kpi.clos,
      foot: kpi.refuses ? `dont ${kpi.refuses} refusé${kpi.refuses > 1 ? "s" : ""}` : "cadeaux terminés",
      active: tab === "clos",
      onClick: kpi.clos || tab === "clos" ? () => toggleTab("clos") : null,
    },
  ];

  const tabItems: FolderTabItem[] = GIFT_TABS.map((t) => ({ value: t, label: GIFT_TAB_META[t].label, short: GIFT_TAB_META[t].short, count: counts[t] }));

  const empty = (title: string, hint: string) => (
    <div className="rounded-2xl px-6 py-12 text-center ring-1 ring-border/70">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-foreground/[0.05] text-muted-foreground">
        <Gift className="size-5" />
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1.5 text-xs text-faint">{hint}</div>
    </div>
  );

  const card = (g: GiftRow) => {
    const props: CardProps = {
      g,
      photo: g.creator ? photoOf.get(g.creator.trim().toLowerCase()) : null,
      onOpen: () => setViewG(g),
      onStatus: (v) => void changeStatus(g, v),
      actions: actions(g),
    };
    return view === "cards" ? <GiftCard key={g.id} {...props} /> : <GiftRowCard key={g.id} {...props} />;
  };

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
              </>
            )}
          </div>
          <AddButton label="Gifting" onClick={openCreate} />
        </div>
      </PageHeaderRow>

      {/* Chiffres clés : un clic filtre (onglet ou mois en cours) */}
      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
          {kpis.map((k) => (
            <button
              key={k.key}
              type="button"
              disabled={!k.onClick}
              onClick={k.onClick ?? undefined}
              aria-pressed={k.onClick ? k.active : undefined}
              className={cn(
                "flex min-w-0 flex-col bg-surface px-4 py-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5 sm:py-5",
                k.onClick && "hover:bg-rowhover",
                !k.onClick && "cursor-default",
                k.active && "ring-2 ring-inset ring-primary/60",
              )}
            >
              <span className="text-[12px] text-muted-foreground sm:text-[13px]">{k.label}</span>
              <span className={cn("mt-2 text-[22px] font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]", k.tone ?? "text-foreground")}>{k.value}</span>
              <span className="mt-3 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{k.foot}</span>
            </button>
          ))}
        </div>
      )}

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
            "flex min-w-full items-center gap-2 rounded-full px-3.5 py-2.5 text-[12px] font-semibold transition-colors",
            contentExpected ? "bg-foreground/[0.06] text-wait" : "border border-border text-muted-foreground hover:bg-rowhover",
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
        <AutoGrowTextField label="Note (infos libres)" value={note} onChange={setNote} placeholder="Contexte, historique, préférences…" className="min-w-full" minRows={2} />
      </InlineForm>

      {/* Classeur : un onglet par étape du cadeau (src/lib/gifting.ts) */}
      <FolderTabs label="Étapes des cadeaux" orderKey="gifting" maxTabWidth={220} items={tabItems} value={tab} onValueChange={(v) => setTab(v as GiftTab)}>
        {list.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <PillSearch value={pageQ} onChange={setPageQ} placeholder="Rechercher une marque, un créateur…" />
            {periods.length > 0 && <PeriodFilter value={period} onChange={setPeriod} periods={periods} />}
            <div className="ml-auto flex items-center gap-2">
              {pageQ.trim() && (
                <span className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">
                  {searched.length} cadeau{searched.length > 1 ? "x" : ""}
                  <span className="text-faint"> / {shown.length}</span>
                </span>
              )}
              <Tabs
                label="Affichage des giftings"
                value={view}
                onValueChange={(v) => setView(v as GView)}
                items={[
                  { value: "cards", label: "Cartes", icon: <LayoutGrid className="h-4 w-4" />, hideLabel: "mobile" },
                  { value: "list", label: "Liste", icon: <ListIcon className="h-4 w-4" />, hideLabel: "mobile" },
                ]}
              />
            </div>
          </div>
        )}

        {error ? (
          <div className="rounded-2xl p-5 ring-1 ring-border/70">
            <AnimatedBadge status="danger" size="sm">Erreur de chargement</AnimatedBadge>
          </div>
        ) : loading ? (
          <div className="rounded-2xl p-5 ring-1 ring-border/70">
            <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
          </div>
        ) : list.length === 0 ? (
          empty("Aucun gifting suivi", "Ajoute un cadeau reçu pour tracer sa provenance et le contenu attendu.")
        ) : visible.length === 0 ? (
          pageQ.trim() ? (
            empty(`Aucun résultat pour « ${pageQ.trim()} »`, tab !== "tous" ? `Dans l'onglet « ${GIFT_TAB_META[tab].label} ». Essaie l'onglet « Tous ».` : "Essaie un autre mot.")
          ) : tab !== "tous" ? (
            empty(`Aucun cadeau dans « ${GIFT_TAB_META[tab].label} »`, period ? "Sur cette période. Change de période ou ouvre l'onglet « Tous »." : "Ouvre l'onglet « Tous » pour voir tous les cadeaux.")
          ) : (
            empty("Aucun gifting sur cette période", "Change de période ou choisis « Toutes périodes ».")
          )
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">{visible.map(card)}</div>
        ) : (
          <div className="flex flex-col gap-2">{visible.map(card)}</div>
        )}

        {/* Rappel légal discret */}
        {list.length > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-foreground/[0.04] px-4 py-3 text-[11px] leading-relaxed text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Un cadeau reste une contrepartie : dès qu'il est mis en avant, le créateur doit le signaler comme communication commerciale
              (« Produit offert » / « Cadeau »), conformément à la loi n° 2023-451 encadrant l'influence commerciale.
            </span>
          </div>
        )}
      </FolderTabs>

      {/* Fiche détail (clic sur une carte) */}
      {viewG && (
        <GiftDetail
          g={viewG}
          photo={viewG.creator ? photoOf.get(viewG.creator.trim().toLowerCase()) : null}
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
function GiftDetail({ g, photo, onClose, onEdit }: { g: GiftRow; photo?: string | null; onClose: () => void; onEdit: () => void }) {
  const st = giftStatusMeta(g.status);
  const none = <span className="font-normal text-faint">Non renseigné</span>;
  const rows: [string, ReactNode][] = [
    ["Créateur", g.creator ? titleCase(g.creator) : none],
    ["Marque / expéditeur", g.brand || none],
    ["Produit", g.product || none],
    ["Valeur estimée", g.value || none],
    ["Reçu le", g.received_on ? frDate(g.received_on) : none],
    ["Interlocuteur", g.contact_name || none],
    [
      "Email",
      g.contact_email ? (
        <span key="email" className="inline-flex max-w-full items-center gap-1">
          <span className="truncate">{g.contact_email}</span>
          <ContactActions email={g.contact_email} />
        </span>
      ) : (
        none
      ),
    ],
    ["Contenu attendu", g.content_expected ? g.deliverables || "Oui" : "Non, sans contrepartie"],
  ];
  return (
    <Overlay className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6" onClose={onClose}>
      <div className="my-2 w-full max-w-lg rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo g={g} />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">{g.brand || g.product || "Gifting"}</div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                <CreatorLine name={g.creator} photo={photo} />
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", st.dot)} /> {st.label}
                </span>
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-2">
          <dl className="divide-y divide-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-[12px] text-faint">{k}</dt>
                <dd className="min-w-0 text-right text-[13px] font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

          {g.mentions && (
            <div className="mb-3 mt-1 flex items-start gap-1.5 rounded-xl bg-foreground/[0.04] px-3 py-2 text-[11px] leading-snug text-muted-foreground">
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

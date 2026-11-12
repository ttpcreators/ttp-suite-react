import { fmtDay } from "@/lib/dates";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Check, Plus, Trash2, FileText, FileDown, Eye, X, Maximize2 } from "@/components/icons";
import { cn, titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { printHtml } from "@/lib/printPdf";
import { useAppState, saveAppStateKey, listAppStateKey, getAppState, invalidateAppState, parseAmount, type AppState } from "@/lib/appState";
import { TextField } from "@/components/ui/form";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { FolderTabs } from "@/components/ui/folder-tabs";
import { contratsSubFromTab, contratsTabFromSub, type ContratsTab } from "@/lib/folderTabs";
import { CasesBar, ContractDocument, FoldSection, HistoryPanel, PanelSection, SettingsPanel, SwitchRow, docIconBtn, docPrimaryBtn } from "@/components/contracts/contract-ui";
import { RepresentationContract, type ContractHist } from "@/views/RepresentationContract";
import { ContractsHome } from "@/components/contracts/contracts-home";
import { TYPE_META as REG_TYPE_META, historyOverflow, type ContractRow, type ContractStatus } from "@/lib/contractRegistry";
import { useNavSub, useSetNavSub } from "@/lib/navSub";
import { useIsFounder } from "@/lib/useFounder";
import { Echeances } from "@/views/Echeances";
import { Exclusivites } from "@/views/Exclusivites";
import { Overlay } from "@/components/mobile/ios-sheet";
import { durationToMonths } from "@/lib/contractDuration";
import { CONTRACT_DRAFTS_KEY, type ContractDraft } from "../../supabase/functions/_shared/contractDraft.ts";
import {
  COLLAB_OPTS, DUR_OPTS, EXCL_OPTS, PAYMENT_OPTS, RIGHTS_OPTS, SCENARIO_DEFAULT, TERRITORY_OPTS, TVA_OPTS, TYPE_META,
  brandClauses, brandTerms, buildClauses, contractHTML, labelOf, refFor,
  type CtType, type Opt, type Scenario, type Term,
} from "@/lib/brandContract";


type Clause = { id: string; l: string; v: string };

/** Un « cas » de configuration réutilisable, enregistré par créateur. */
type ContractCase = {
  id: string;
  name: string;
  ctType: CtType;
  brand: string;
  value: string;
  commission: string;
  duration: string;
  deliverables: string;
  excl: boolean;
  extra: Clause[];
  // Cas de figure (optionnels → compat descendante avec les cas déjà enregistrés).
  collab?: string;
  rights?: string;
  rightsDuration?: string;
  territory?: string;
  payment?: string;
  tva?: string;
  exclScope?: string;
  defraiement?: boolean;
};
type ContractConfigs = Record<string, ContractCase[]>;

let _uid = 0;
const uid = () => `c${Date.now().toString(36)}${(_uid += 1)}`;


const primaryBtn = "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const ghostBtn = "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Overlay className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClose={onClose}>
      <div className={cn("my-2 w-full rounded-2xl border border-border bg-card shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </Overlay>
  );
}


function SelectField({ label, value, onChange, opts, className }: { label: string; value: string; onChange: (v: string) => void; opts: Opt[]; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-[42px] w-full rounded-lg bg-surface" placeholder={label} />
        <SelectContent>
          {opts.map((o, i) => (
            <SelectItem key={o.v} index={i} value={o.v}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Un contrat archivé (généré depuis cette page) — stocké dans le blob app_state
 *  `brandContractHistory` pour consultation rapide. On garde le HTML rendu → ré-ouverture
 *  et export PDF à l'identique, sans dépendre de la config du moment. */
type ContractHistoryEntry = {
  id: string;
  ts: number;
  ctType: CtType;
  ctName: string;
  brand: string;
  ref: string;
  title: string;
  html: string;
  /** Statut de signature (page d'arrivée). Absent sur les anciens contrats = « En attente ». */
  status?: ContractStatus;
  /** Réglages du formulaire au moment de l'archivage → « Modifier » recharge tout (absent sur les anciens contrats). */
  form?: BrandForm;
};
/** Réglages du formulaire Marque × Créateur / UGC (un « cas » sans son nom). */
type BrandForm = Omit<ContractCase, "id" | "name">;

/** « Modifier » depuis la page d'arrivée : ce qu'il faut recharger dans un générateur. */
type EditRequest =
  | { kind: "brand"; ctType: CtType; ctName: string | null; brand: string; form?: BrandForm; draftId?: string }
  | { kind: "repr"; entry: ContractHist; draftId?: string };

/** Brouillon de représentation préparé par Claude → contrat à recharger dans le générateur (rien n'est encore enregistré). */
function draftAsRepr(d: ContractDraft): ContractHist {
  const config = d.config ?? {};
  return { id: "", creator: d.externe ? null : d.ctName, title: "", variante: config.variante || "exclusif", config, createdAt: "", path: "" };
}

/**
 * Page Contrats : la page d'arrivée (liste des contrats, statuts, catégories) et, par
 * « Nouveau contrat », « Modifier » ou la sidebar (sous-pages Marque × Créateur /
 * Représentation / UGC), les générateurs. Le générateur reste monté (masqué) pendant
 * qu'on regarde la liste : une saisie en cours n'est jamais perdue.
 * Onglets « dossier » (comme Agents) : « Tous » = page d'arrivée (sous-page nulle), puis
 * un onglet par générateur, synchronisés avec les sous-pages de la sidebar.
 */
export function Contrats() {
  const navSub = useNavSub();
  const setNavSub = useSetNavSub();
  const genType: CtType | null = navSub === "marque" || navSub === "repr" || navSub === "ugc" ? navSub : null;
  // Fins de contrat (fondateurs seulement, comme l'ancienne page) et Exclusivités : onglets à part.
  const isFounder = useIsFounder() === true;
  const extra = navSub === "exclusivites" || (navSub === "echeances" && isFounder) ? navSub : null;
  // `seq` remonte le générateur (formulaire neuf) ; `req` = contrat chargé par « Modifier ».
  const [edit, setEdit] = useState<{ seq: number; req: EditRequest | null }>({ seq: 0, req: null });
  // Dernier générateur ouvert : proposé en « Reprendre » sur la page d'arrivée.
  const [lastGen, setLastGen] = useState<CtType | null>(null);
  useEffect(() => {
    if (genType) setLastGen(genType);
  }, [genType]);

  const openEdit = (row: ContractRow, raw: Record<string, unknown>) => {
    let req: EditRequest;
    if (row.key === "contractHistory") {
      req = { kind: "repr", entry: raw as unknown as ContractHist };
      toast("Contrat chargé : modifie-le puis enregistre-le à nouveau");
    } else {
      const form = raw.form && typeof raw.form === "object" ? (raw.form as BrandForm) : undefined;
      req = { kind: "brand", ctType: row.type, ctName: row.creator, brand: row.brand, form };
      toast(form ? "Contrat chargé : modifie-le puis enregistre le PDF" : "Créateur, marque et type repris. Les autres conditions de ce contrat n'étaient pas gardées : vérifie-les");
    }
    setEdit((e) => ({ seq: e.seq + 1, req }));
    setNavSub(row.type);
  };

  // Nombre de contrats enregistrés (compté par la page d'arrivée, déjà chargée).
  const [total, setTotal] = useState(0);
  const tabs: { value: ContratsTab; label: string; count?: number }[] = [
    { value: "tous", label: "Tous", count: total || undefined },
    { value: "marque", label: TYPE_META.marque.chip },
    { value: "repr", label: TYPE_META.repr.chip },
    { value: "ugc", label: TYPE_META.ugc.chip },
    ...(isFounder ? [{ value: "echeances" as const, label: "Fins de contrat" }] : []),
    { value: "exclusivites", label: "Exclusivités" },
  ];

  return (
    <FolderTabs
      label="Sous-pages Contrats"
      orderKey="contrats"
      items={tabs}
      value={contratsTabFromSub(navSub)}
      // Même effet qu'un clic sur la sous-page dans la sidebar.
      onValueChange={(v) => setNavSub(contratsSubFromTab(v as ContratsTab))}
    >
      {extra === "echeances" && <Echeances />}
      {extra === "exclusivites" && <Exclusivites />}
      <div hidden={!!genType || !!extra}>
        <ContractsHome
          active={!genType && !extra}
          onCount={setTotal}
          onNew={(t) => {
            // Après un « Modifier », « Nouveau contrat » repart d'un formulaire neuf.
            setEdit((e) => (e.req ? { seq: e.seq + 1, req: null } : e));
            setNavSub(t);
          }}
          onEdit={openEdit}
          onOpenDraft={(d: ContractDraft) => {
            const req: EditRequest =
              d.ctType === "repr"
                ? { kind: "repr", entry: draftAsRepr(d), draftId: d.id }
                : { kind: "brand", ctType: d.ctType, ctName: d.ctName, brand: d.brand, form: d.form, draftId: d.id };
            setEdit((e) => ({ seq: e.seq + 1, req }));
            setNavSub(d.ctType);
            toast(d.ctType === "repr" ? "Brouillon chargé : vérifie-le, puis enregistre le contrat" : "Brouillon chargé : vérifie-le, puis génère le PDF");
          }}
          resume={lastGen ? { label: REG_TYPE_META[lastGen].label, onClick: () => setNavSub(lastGen) } : null}
        />
      </div>
      {(genType || lastGen) && (
        <div hidden={!genType}>
          <ContractGenerator key={edit.seq} initial={edit.req} />
        </div>
      )}
    </FolderTabs>
  );
}

function ContractGenerator({ initial }: { initial: EditRequest | null }) {
  const brandInit = initial?.kind === "brand" ? initial : null;
  const form0 = brandInit?.form;
  const creators = useCreators();
  const { data: cfgData } = useAppState<ContractConfigs>((s: AppState) => (s["contractConfigs"] as ContractConfigs) ?? {});
  const [localCfg, setLocalCfg] = useState<ContractConfigs | null>(null);
  const configs = localCfg ?? cfgData ?? {};
  // Historique des contrats générés (blob app_state).
  const { data: histData } = useAppState<ContractHistoryEntry[]>((s: AppState) => (s["brandContractHistory"] as ContractHistoryEntry[]) ?? []);
  const [localHist, setLocalHist] = useState<ContractHistoryEntry[] | null>(null);
  const history = localHist ?? histData ?? [];
  // Copies locales (après une écriture réussie) : le blob live redevient la source dès qu'il change.
  useEffect(() => {
    setLocalCfg(null);
  }, [cfgData]);
  useEffect(() => {
    setLocalHist(null);
  }, [histData]);

  // Sous-page demandée depuis la sidebar (Contrats → Marque × Créateur / Représentation / UGC).
  const navSub = useNavSub();
  const [ctType, setCtType] = useState<CtType>(() =>
    initial?.kind === "repr" ? "repr" : brandInit ? brandInit.ctType : navSub === "repr" || navSub === "ugc" ? navSub : "marque",
  );
  const setNavSub = useSetNavSub();
  useEffect(() => {
    if (navSub === "marque" || navSub === "repr" || navSub === "ugc") setCtType(navSub);
  }, [navSub]);
  // « Modifier » : le formulaire repart des réglages archivés avec le contrat (sinon valeurs par défaut).
  const [creatorName, setCreatorName] = useState(brandInit?.ctName ?? "");
  const [brand, setBrand] = useState(form0?.brand ?? brandInit?.brand ?? "");
  const [value, setValue] = useState(form0?.value ?? "");
  const [commission, setCommission] = useState(form0?.commission ?? "20");
  const [duration, setDuration] = useState(form0?.duration ?? "");
  const [deliverables, setDeliverables] = useState(form0?.deliverables ?? "");
  const [extra, setExtra] = useState<Clause[]>(form0?.extra ?? []);
  // Cas de figure
  const [collab, setCollab] = useState(form0?.collab ?? SCENARIO_DEFAULT.collab);
  const [rights, setRights] = useState(form0?.rights ?? SCENARIO_DEFAULT.rights);
  const [rightsDuration, setRightsDuration] = useState(form0?.rightsDuration ?? SCENARIO_DEFAULT.rightsDuration);
  const [territory, setTerritory] = useState(form0?.territory ?? SCENARIO_DEFAULT.territory);
  const [payment, setPayment] = useState(form0?.payment ?? SCENARIO_DEFAULT.payment);
  const [tva, setTva] = useState(form0?.tva ?? SCENARIO_DEFAULT.tva);
  const [exclScope, setExclScope] = useState(form0?.exclScope ?? (form0 ? (form0.excl ? "cat30" : "non") : SCENARIO_DEFAULT.exclScope));
  const [defraiement, setDefraiement] = useState(form0?.defraiement ?? SCENARIO_DEFAULT.defraiement);
  const scenario: Scenario = { collab, rights, rightsDuration, territory, payment, tva, exclScope, defraiement };
  const [copied, setCopied] = useState(false);
  // `hist` : aperçu d'un contrat de l'historique (ne doit rien ré-archiver)
  const [preview, setPreview] = useState<{ html: string; hist: boolean } | null>(null);
  const [caseName, setCaseName] = useState("Standard");
  const [pendingDel, setPendingDel] = useState<null | { title?: string; message: string; run: () => void }>(null);

  const ctName = creatorName || creators[0]?.name || "[Créateur]";
  // Affichage seulement (contrat / aperçu) : la clé stockée reste ctName.
  const ctDisplay = ctName === "[Créateur]" ? ctName : titleCase(ctName);
  const cases: ContractCase[] = configs[ctName] ?? [];

  // Charge un cas dans le formulaire.
  const applyCase = (cs: ContractCase) => {
    setCtType(cs.ctType);
    if (navSub) setNavSub(cs.ctType); // garde la sidebar alignée sur le type chargé
    setBrand(cs.brand);
    setValue(cs.value);
    setCommission(cs.commission);
    setDuration(cs.duration);
    setDeliverables(cs.deliverables);
    setExtra(cs.extra ?? []);
    setCaseName(cs.name);
    // Cas de figure — replis pour les cas enregistrés avant cette fonctionnalité.
    setCollab(cs.collab ?? SCENARIO_DEFAULT.collab);
    setRights(cs.rights ?? SCENARIO_DEFAULT.rights);
    setRightsDuration(cs.rightsDuration ?? SCENARIO_DEFAULT.rightsDuration);
    setTerritory(cs.territory ?? SCENARIO_DEFAULT.territory);
    setPayment(cs.payment ?? SCENARIO_DEFAULT.payment);
    setTva(cs.tva ?? SCENARIO_DEFAULT.tva);
    setExclScope(cs.exclScope ?? (cs.excl ? "cat30" : "non"));
    setDefraiement(cs.defraiement ?? SCENARIO_DEFAULT.defraiement);
  };

  // Formulaire vierge (créateur sans modèle) : rien ne reste du créateur précédent.
  const resetForm = () => {
    setBrand("");
    setValue("");
    setCommission("20");
    setDuration("");
    setDeliverables("");
    setExtra([]);
    setCaseName("Standard");
    setCollab(SCENARIO_DEFAULT.collab);
    setRights(SCENARIO_DEFAULT.rights);
    setRightsDuration(SCENARIO_DEFAULT.rightsDuration);
    setTerritory(SCENARIO_DEFAULT.territory);
    setPayment(SCENARIO_DEFAULT.payment);
    setTva(SCENARIO_DEFAULT.tva);
    setExclScope(SCENARIO_DEFAULT.exclScope);
    setDefraiement(SCENARIO_DEFAULT.defraiement);
  };

  // Au changement de créateur (ou à l'arrivée des configs), charge son 1er cas s'il en a un,
  // une seule fois par créateur. Sans cas enregistré : on remet les valeurs par défaut.
  // Contrat chargé par « Modifier » : on ne remplace pas ses valeurs par le 1er modèle du créateur.
  const appliedFor = useRef<string | null>(brandInit?.ctName ?? null);
  const lastCt = useRef<string | null>(brandInit?.ctName ?? null);
  useEffect(() => {
    const switched = lastCt.current !== ctName;
    lastCt.current = ctName;
    if (switched) appliedFor.current = null;
    if (appliedFor.current === ctName) return;
    // Sous-page choisie dans la sidebar : on ne charge qu'un cas du MÊME type,
    // sinon le type repasserait sur celui du 1er cas (rebond vers « marque »).
    const list = configs[ctName] ?? [];
    const cs = navSub ? list.find((c) => c.ctType === ctType) : list[0];
    if (cs) {
      applyCase(cs);
      appliedFor.current = ctName;
    } else if (switched) {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctName, configs]);

  const meta = TYPE_META[ctType];
  const exclLabel = labelOf(EXCL_OPTS, exclScope);
  const ref = refFor(ctName);

  const { parties, terms } = useMemo(
    () => brandTerms({ ctType, brand, value, commission, duration, deliverables, collab, rights, rightsDuration, territory, payment, tva, exclScope, defraiement }, ctDisplay),
    [ctType, brand, ctDisplay, deliverables, value, exclScope, duration, commission, collab, rights, rightsDuration, territory, payment, tva, defraiement],
  );

  // Valeur HT (approx : en franchise 293 B, HT ≈ montant affiché) → déclenche la clause
  // de vigilance URSSAF au-delà de 5 000 € HT.
  const htNum = parseAmount(value);
  const allClauses: Term[] = brandClauses(scenario, value, extra);
  const nextClauseNo = buildClauses(scenario, htNum).length + 1 + extra.length;
  const isBrand = ctType !== "repr";

  const contractText = useMemo(() => {
    return [
      "CONTRAT DE COLLABORATION",
      meta.title.toUpperCase(),
      `Réf. ${ref}`,
      "",
      `Parties : TTP Creators & ${ctDisplay} × ${brand || "[Marque]"}`,
      "",
      parties,
      "",
      ...terms.map((t) => `• ${t.l} : ${t.v}`),
      "",
      "CLAUSES",
      ...allClauses.map((c) => `${c.l}\n${c.v}`),
      "",
      "Fait à Lyon — Pour TTP Creators / Pour " + ctDisplay,
    ].join("\n");
  }, [meta.title, ref, ctDisplay, brand, parties, terms, allClauses]);

  const buildHTML = () => contractHTML({ ref, meta, ctName: ctDisplay, brand, parties, terms, clauses: allClauses });

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(contractText);
      setCopied(true);
      toast("Contrat copié ✓");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Impossible de copier : presse-papier bloqué");
    }
  };

  const downloadPDF = async () => {
    // Ouvre la boîte d'impression → « Enregistrer au format PDF » (vrai PDF, texte net).
    const html = buildHTML();
    printHtml(html);
    // Annoncé seulement une fois l'archivage réussi (sinon mutateHistory a déjà signalé l'erreur)
    if (await archiveContract(html)) toast("PDF prêt, contrat ajouté aux contrats enregistrés ✓");
  };

  // ── Cas de configuration (par créateur) ──
  // Relecture fraîche avant merge : ne pas écraser les cas d'autres créateurs.
  // Copie locale appliquée SEULEMENT après écriture réussie (pas d'affichage fantôme).
  const mutateConfigs = async (fn: (fresh: ContractConfigs) => ContractConfigs) => {
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["contractConfigs"] as ContractConfigs) ?? {};
      const next = fn(fresh);
      const ok = await saveAppStateKey("contractConfigs", next);
      if (ok) setLocalCfg(next);
      else toast("Erreur, réessaie");
      return ok;
    } catch {
      toast("Erreur, réessaie");
      return false;
    }
  };

  const saveCase = async () => {
    const name = caseName.trim() || "Cas";
    const cs: ContractCase = { id: uid(), name, ctType, brand, value, commission, duration, deliverables, excl: exclScope !== "non", extra, collab, rights, rightsDuration, territory, payment, tva, exclScope, defraiement };
    let existed = false;
    const ok = await mutateConfigs((fresh) => {
      const list = fresh[ctName] ?? [];
      const idx = list.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
      existed = idx >= 0;
      const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? { ...cs, id: c.id } : c)) : [...list, cs];
      return { ...fresh, [ctName]: nextList };
    });
    if (ok) toast(existed ? `Modèle « ${name} » mis à jour ✓` : `Modèle « ${name} » enregistré ✓`);
  };

  const deleteCase = async (id: string) => {
    const ok = await mutateConfigs((fresh) => ({
      ...fresh,
      [ctName]: (fresh[ctName] ?? []).filter((c) => c.id !== id),
    }));
    if (ok) toast("Modèle supprimé");
  };

  // ── Historique des contrats (blob) — relecture fraîche (affichage) ; seules les
  // entrées ajoutées / retirées sont envoyées (deux postes ne s'effacent plus). ──
  type HistChange = { upsert?: ContractHistoryEntry[]; remove?: string[] };
  const mutateHistory = async (fn: (fresh: ContractHistoryEntry[]) => HistChange) => {
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["brandContractHistory"] as ContractHistoryEntry[]) ?? [];
      const { upsert = [], remove = [] } = fn(fresh);
      // Ajouts en tête (le plus récent d'abord), comme avant.
      const next = [...upsert.filter((u) => !fresh.some((h) => h.id === u.id)), ...fresh.filter((h) => !remove.includes(h.id)).map((h) => upsert.find((u) => u.id === h.id) ?? h)];
      const ok = await listAppStateKey("brandContractHistory", upsert, remove, true);
      if (ok) setLocalHist(next);
      else toast("Erreur, réessaie");
      return ok;
    } catch {
      toast("Erreur, réessaie");
      return false;
    }
  };
  /** Archive le contrat courant. Dédoublonne (même HTML que le dernier archivé) et
   *  borne la taille du blob sans jamais effacer un contrat signé ou envoyé (`historyOverflow`). Renvoie true si l'archivage a réussi. */
  const archiveContract = async (html: string): Promise<boolean> => {
    let entry: ContractHistoryEntry | null = null;
    const ok = await mutateHistory((fresh) => {
      if (fresh.some((h) => h.html === html)) return {}; // déjà archivé à l'identique
      const form: BrandForm = { ctType, brand, value, commission, duration, deliverables, excl: exclScope !== "non", extra, collab, rights, rightsDuration, territory, payment, tva, exclScope, defraiement };
      const e: ContractHistoryEntry = { id: uid(), ts: Date.now(), ctType, ctName, brand, ref, title: meta.title, html, status: "pending", form };
      entry = e;
      return { upsert: [e], remove: historyOverflow(fresh) };
    });
    const added = entry as ContractHistoryEntry | null;
    // Contrat généré depuis un brouillon de Claude : le brouillon a servi, on le retire.
    if (ok && brandInit?.draftId) void listAppStateKey(CONTRACT_DRAFTS_KEY, [], [brandInit.draftId]);
    // Réimpression d'un contrat déjà archivé : on ne touche pas à son échéance.
    if (!ok || !added) return ok;
    // Auto-échéance de FIN de contrat : renseigne la page Échéances sans saisie manuelle.
    // Début = date de génération (locale), durée = champ « Durée » lu avec son unité (an, mois, semaine, jour).
    const months = durationToMonths(duration);
    if (duration.trim() && months === null && ctName && ctName !== "[Créateur]") {
      toast(`Attention : durée « ${duration.trim()} » non comprise, aucune fin de contrat suivie (écris par ex. 12 mois ou 1 an)`);
    }
    if (ctName && ctName !== "[Créateur]" && months !== null) {
      type Dl = { id: string; creator: string; type: string; start: string; months: number; note?: string; brand?: string; contractId?: string };
      const dlBrand = ctType === "repr" ? "" : brand.trim();
      const sameContract = (d: Dl) =>
        d.contractId === added.id ||
        (d.type === ctType &&
          d.creator.trim().toLowerCase() === ctName.trim().toLowerCase() &&
          // Même marque ; les échéances auto anciennes (sans marque) sont remplacées aussi
          (d.brand != null ? d.brand.trim().toLowerCase() === dlBrand.toLowerCase() : !!d.note?.startsWith("Auto")));
      try {
        invalidateAppState();
        const fresh = ((await getAppState())["contractDeadlines"] as Dl[]) ?? [];
        // Remplace l'échéance de CE contrat : seules l'ancienne (retirée) et la nouvelle
        // (ajoutée en tête) sont envoyées, les autres échéances ne sont pas réécrites.
        const replaced = fresh.filter(sameContract).map((d) => d.id);
        const now = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const start = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
        const dl: Dl = { id: uid(), creator: ctName, type: ctType, start, months, note: `Auto · ${meta.label.toLowerCase()}${dlBrand ? ` · ${dlBrand}` : ""}`, brand: dlBrand, contractId: added.id };
        if (!(await listAppStateKey("contractDeadlines", [dl], replaced, true))) toast("Contrat enregistré, mais sa fin de contrat n'est pas suivie. Réessaie");
      } catch {
        toast("Contrat enregistré, mais sa fin de contrat n'est pas suivie. Réessaie");
      }
    }
    return ok;
  };
  const deleteHistory = (id: string) => mutateHistory(() => ({ remove: [id] }));

  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ conditions: true, figure: true, clauses: false });
  const toggleSec = (k: string) => setOpenSec((o) => ({ ...o, [k]: !o[k] }));

  if (ctType === "repr") {
    return (
      <RepresentationContract initial={initial?.kind === "repr" ? initial.entry : null} draftId={initial?.kind === "repr" ? initial.draftId : undefined} />
    );
  }

  const html = buildHTML();
  const figureSummary = [labelOf(RIGHTS_OPTS, rights), territory, exclLabel].filter(Boolean).join(" · ");

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
        {/* ============ RÉGLAGES ============ */}
        <SettingsPanel>
          <PanelSection title="Créateur" hint={meta.chip === "Contrat UGC" ? "Le créateur qui produit les contenus." : "Le créateur représenté par TTP dans ce contrat."}>
            {creators.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">Aucun créateur dans le roster : le contrat utilisera « [Créateur] ».</div>
            ) : (
              <Select value={ctName} onValueChange={setCreatorName}>
                <SelectTrigger className="h-[42px] w-full rounded-lg bg-surface" placeholder="Choisir un créateur" />
                <SelectContent>
                  {creators.map((c, i) => (
                    <SelectItem key={c.id} index={i} value={c.name} img={c.photo_url}>{titleCase(c.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <CasesBar
              cases={cases}
              active={caseName}
              onLoad={(id) => {
                const cs = cases.find((c) => c.id === id);
                if (cs) applyCase(cs);
              }}
              onDelete={(id) => {
                const cs = cases.find((c) => c.id === id);
                if (cs) setPendingDel({ message: `Supprimer définitivement le modèle « ${cs.name} » ? Cette action est irréversible.`, run: () => deleteCase(cs.id) });
              }}
              name={caseName}
              onName={setCaseName}
              onSave={saveCase}
            />
          </PanelSection>

          <FoldSection title="Conditions" summary={[isBrand ? brand : "", isBrand ? value : "", duration].filter(Boolean).join(" · ")} open={!!openSec.conditions} onToggle={() => toggleSec("conditions")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {isBrand && (
                <>
                  <TextField label="Marque" value={brand} onChange={setBrand} placeholder="ex Sephora" />
                  <TextField label="Valeur" value={value} onChange={setValue} placeholder="ex 32 000 €" />
                  <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" className="sm:col-span-2" />
                </>
              )}
              <TextField label="Commission (%)" value={commission} onChange={setCommission} type="number" placeholder="ex 20" />
              <TextField label="Durée" value={duration} onChange={setDuration} placeholder="ex 12 mois" />
            </div>
          </FoldSection>

          <FoldSection title="Cas de figure" summary={figureSummary} open={!!openSec.figure} onToggle={() => toggleSec("figure")}>
            <p className="-mt-1 mb-3 text-[12px] text-muted-foreground">Chaque choix réécrit les clauses du contrat.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ctType === "marque" && <SelectField label="Type de collab" value={collab} onChange={setCollab} opts={COLLAB_OPTS} className="sm:col-span-2" />}
              <SelectField label="Cession de droits" value={rights} onChange={setRights} opts={RIGHTS_OPTS} className="sm:col-span-2" />
              {rights !== "organic" && <SelectField label="Durée de cession" value={rightsDuration} onChange={setRightsDuration} opts={DUR_OPTS} />}
              <SelectField label="Territoire" value={territory} onChange={setTerritory} opts={TERRITORY_OPTS} />
              <SelectField label="Exclusivité" value={exclScope} onChange={setExclScope} opts={EXCL_OPTS} />
              <SelectField label="Paiement" value={payment} onChange={setPayment} opts={PAYMENT_OPTS} />
              <SelectField label="TVA" value={tva} onChange={setTva} opts={TVA_OPTS} />
            </div>
            <div className="mt-3 border-t border-border pt-2">
              <SwitchRow label="Frais et produits pris en charge (défraiement)" checked={defraiement} onChange={setDefraiement} />
            </div>
          </FoldSection>

          <FoldSection
            title="Clauses additionnelles"
            summary={extra.length ? `${extra.length} clause${extra.length > 1 ? "s" : ""}` : "Aucune"}
            open={!!openSec.clauses}
            onToggle={() => toggleSec("clauses")}
            right={
              <button
                type="button"
                onClick={() => {
                  setExtra([...extra, { id: uid(), l: `Art. ${nextClauseNo} — Clause`, v: "" }]);
                  setOpenSec((o) => ({ ...o, clauses: true }));
                }}
                className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </button>
            }
          >
            {extra.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Ajoute une clause sur mesure : elle s'insère à la suite des articles du contrat.</p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {extra.map((e) => (
                  <div key={e.id} className="p-3">
                    <div className="flex items-center gap-2">
                      <input value={e.l} onChange={(ev) => setExtra(extra.map((x) => (x.id === e.id ? { ...x, l: ev.target.value } : x)))} placeholder="Titre de la clause" aria-label="Titre de la clause" className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium outline-none focus:border-primary" />
                      <button type="button" onClick={() => setExtra(extra.filter((x) => x.id !== e.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-dangertext" title="Supprimer la clause" aria-label="Supprimer la clause"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <textarea value={e.v} onChange={(ev) => setExtra(extra.map((x) => (x.id === e.id ? { ...x, v: ev.target.value } : x)))} rows={3} placeholder="Contenu de la clause…" aria-label="Contenu de la clause" className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-primary" />
                  </div>
                ))}
              </div>
            )}
          </FoldSection>
        </SettingsPanel>

        {/* ============ DOCUMENT (le vrai PDF, en direct) ============ */}
        <div className="lg:sticky lg:top-4">
          <ContractDocument
            html={html}
            title={`Contrat ${ref}`}
            meta={`${meta.chip} · ${ctDisplay}${isBrand && brand ? ` × ${brand}` : ""} · Réf. ${ref}`}
            actions={
              <>
                <button type="button" onClick={copyContract} className={docIconBtn} title="Copier le texte du contrat" aria-label="Copier le texte du contrat">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => setPreview({ html, hist: false })} className={docIconBtn} title="Ouvrir en grand" aria-label="Ouvrir en grand">
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={downloadPDF} className={docPrimaryBtn}>
                  <FileDown className="h-4 w-4" /> PDF
                </button>
              </>
            }
          />
        </div>
      </div>

      {/* ============ HISTORIQUE ============ */}
      {history.length > 0 && (
        <div className="mt-4">
          <HistoryPanel title="Contrats enregistrés" count={history.length}>
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover/50 sm:px-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><FileText className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{h.title}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{TYPE_META[h.ctType]?.chip ?? h.ctType}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {titleCase(h.ctName)}{h.brand ? ` × ${h.brand}` : ""} · {h.ref} · {fmtDay(h.ts)}
                  </div>
                </div>
                <button type="button" onClick={() => setPreview({ html: h.html, hist: true })} title="Ouvrir" aria-label="Ouvrir" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                  <Eye className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => printHtml(h.html)} title="Enregistrer en PDF" aria-label="Enregistrer en PDF" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                  <FileDown className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setPendingDel({ title: "Supprimer définitivement", message: `Retirer « ${h.title} » (${h.ref}) des contrats enregistrés ? Cette action est irréversible.`, run: () => deleteHistory(h.id) })} title="Supprimer définitivement" aria-label="Supprimer définitivement" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-dangertext">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </HistoryPanel>
        </div>
      )}

      {preview && (
        <Modal
          title={`Contrat · ${ref}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
              <button
                type="button"
                className={cn(primaryBtn, "flex items-center gap-1.5")}
                onClick={() => {
                  // Contrat de l'historique : simple réimpression, sans ré-archiver ni toucher aux Échéances
                  if (!preview.hist) void archiveContract(preview.html);
                  printHtml(preview.html);
                }}
              >
                <FileDown className="h-3.5 w-3.5" /> Enregistrer en PDF
              </button>
            </>
          }
        >
          <iframe title={`Contrat ${ref}`} srcDoc={preview.html} sandbox="allow-same-origin" className="h-[70vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}
      {pendingDel && (
        <ConfirmDialog
          title={pendingDel.title ?? "Supprimer définitivement le modèle"}
          message={pendingDel.message}
          confirmLabel="Supprimer définitivement"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </>
  );
}

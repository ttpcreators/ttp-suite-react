import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Check, Plus, Trash2, Save, FileText, Eye, X } from "lucide-react";
import { cn, initials, titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { TextField } from "@/components/ui/form";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { RepresentationContract } from "@/views/RepresentationContract";

type CtType = "marque" | "repr" | "ugc";

const TYPE_META: Record<CtType, { chip: string; label: string; title: string }> = {
  marque: { chip: "Marque × Créateur", label: "MARQUE × CRÉATEUR", title: "Contrat de partenariat commercial" },
  repr: { chip: "Représentation", label: "AGENCE × CRÉATEUR", title: "Contrat de représentation" },
  ugc: { chip: "Contrat UGC", label: "CONTRAT UGC", title: "Cession de droits — UGC" },
};

type Term = { l: string; v: string };

const CLAUSES: Term[] = [
  { l: "Art. 1 — Objet", v: "Le présent contrat définit les conditions de la prestation et les engagements réciproques des parties." },
  { l: "Art. 2 — Rémunération & paiement", v: "Les sommes sont versées par virement à 30 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.)." },
  { l: "Art. 3 — Propriété intellectuelle", v: "La cession des droits d'exploitation est limitée aux supports, territoires et durée stipulés. Toute réutilisation hors périmètre fait l'objet d'un avenant." },
  { l: "Art. 4 — Données personnelles (RGPD)", v: "Les parties traitent les données conformément au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés. Finalité limitée à l'exécution du contrat." },
  { l: "Art. 5 — Transparence publicitaire", v: "Tout contenu sponsorisé est identifié comme tel (« Publicité » / « Partenariat rémunéré »), conformément aux lignes directrices ARPP et au droit de la consommation UE." },
  { l: "Art. 6 — Droit de rétractation", v: "Conformément à la Directive 2011/83/UE, un délai de rétractation de 14 jours s'applique sauf renonciation expresse pour exécution immédiate." },
  { l: "Art. 7 — Confidentialité & résiliation", v: "Obligation de confidentialité réciproque. Résiliation possible pour manquement grave après mise en demeure restée infructueuse sous 15 jours." },
  { l: "Art. 8 — Droit applicable & litiges", v: "Contrat régi par le droit français. À défaut d'accord amiable (médiation préalable), compétence exclusive des tribunaux de Lyon." },
];

const PAY_TERMS: Term[] = [
  { l: "Modalités", v: "Virement · 30 j fin de mois" },
  { l: "TVA", v: "Non assujetti (art. 293 B CGI)" },
];

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
};
type ContractConfigs = Record<string, ContractCase[]>;

let _uid = 0;
const uid = () => `c${Date.now().toString(36)}${(_uid += 1)}`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

function refFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 900;
  return `TTP-${new Date().getFullYear()}-${String(90 + h).padStart(3, "0")}`;
}

const primaryBtn = "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const ghostBtn = "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className={cn("my-2 w-full rounded-2xl border border-border bg-card shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

function contractHTML(o: {
  ref: string;
  meta: { label: string; title: string };
  ctName: string;
  brand: string;
  parties: string;
  terms: Term[];
  clauses: Term[];
}): string {
  const { ref, meta, ctName, brand, parties, terms, clauses } = o;
  const termRows = terms.map((t) => `<tr><th>${esc(t.l)}</th><td>${esc(t.v)}</td></tr>`).join("");
  const clauseBlocks = clauses.map((c) => `<div class="cl"><div class="cl-t">${esc(c.l)}</div><div class="muted">${esc(c.v)}</div></div>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contrat ${esc(ref)}</title>
<style>
*{box-sizing:border-box}
body{font-family:'Inter',-apple-system,Arial,sans-serif;color:#18181b;max-width:820px;margin:0 auto;padding:44px 40px;background:#fff;font-size:13px;line-height:1.55}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0069FE;padding-bottom:18px}
.brand{font-size:15px;font-weight:800}
.muted{color:#71717a}
.faint{color:#a1a1aa;font-size:11px}
.kind{margin-top:22px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#0069FE;font-weight:700}
h1{font-size:23px;letter-spacing:-.4px;margin:4px 0 0}
.parties{margin-top:14px}
table{width:100%;border-collapse:collapse;margin-top:18px}
th{text-align:left;color:#71717a;font-weight:600;width:190px;padding:9px 0;border-bottom:1px solid #ececef;vertical-align:top}
td{padding:9px 0;border-bottom:1px solid #ececef;font-weight:600}
.clauses{margin-top:24px}
.cl{margin-bottom:12px}
.cl-t{font-weight:700;font-size:12px}
.sign{display:flex;gap:40px;margin-top:44px}
.sign>div{flex:1}
.line{height:40px;border-bottom:1px solid #18181b}
.legal{margin-top:28px;border-top:1px solid #ececef;padding-top:12px;font-size:10.5px;color:#a1a1aa}
@media print{body{padding:0}}
</style></head><body>
<div class="top">
  <div><div class="brand">TTP CREATORS</div><div class="faint">Lyon · France · partnerships@ttpcreators.pro</div></div>
  <div style="text-align:right"><div class="faint">Réf. ${esc(ref)}</div></div>
</div>
<div class="kind">${esc(meta.label)}</div>
<h1>${esc(meta.title)}</h1>
<div class="parties muted">Parties : TTP Creators &amp; ${esc(ctName)} × ${esc(brand || "[Marque]")}</div>
<div class="parties muted">${esc(parties)}</div>
<table>${termRows}</table>
<div class="clauses">${clauseBlocks}</div>
<div class="sign">
  <div><div class="line"></div><div class="faint" style="margin-top:6px">Pour TTP Creators</div></div>
  <div><div class="line"></div><div class="faint" style="margin-top:6px">Pour ${esc(ctName)}</div></div>
</div>
<div class="legal">Contrat régi par le droit français · Conforme RGPD (UE 2016/679) · Directive 2011/83/UE · Fait à Lyon. Document généré par TTP Suite.</div>
</body></html>`;
}

export function Contrats() {
  const creators = useCreators();
  const { data: cfgData } = useAppState<ContractConfigs>((s: AppState) => (s["contractConfigs"] as ContractConfigs) ?? {});
  const [localCfg, setLocalCfg] = useState<ContractConfigs | null>(null);
  const configs = localCfg ?? cfgData ?? {};

  const [ctType, setCtType] = useState<CtType>("marque");
  const [creatorName, setCreatorName] = useState("");
  const [brand, setBrand] = useState("Sephora");
  const [value, setValue] = useState("32 000 €");
  const [commission, setCommission] = useState("20");
  const [duration, setDuration] = useState("12 mois");
  const [deliverables, setDeliverables] = useState("3 posts · 1 reel");
  const [excl, setExcl] = useState(true);
  const [extra, setExtra] = useState<Clause[]>([]);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [caseName, setCaseName] = useState("Standard");
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  const ctName = creatorName || creators[0]?.name || "[Créateur]";
  const cases: ContractCase[] = configs[ctName] ?? [];

  // Charge un cas dans le formulaire.
  const applyCase = (cs: ContractCase) => {
    setCtType(cs.ctType);
    setBrand(cs.brand);
    setValue(cs.value);
    setCommission(cs.commission);
    setDuration(cs.duration);
    setDeliverables(cs.deliverables);
    setExcl(cs.excl);
    setExtra(cs.extra ?? []);
    setCaseName(cs.name);
  };

  // Au changement de créateur, charge automatiquement son 1er cas s'il en a un.
  useEffect(() => {
    const cs = (configs[ctName] ?? [])[0];
    if (cs) applyCase(cs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctName]);

  const meta = TYPE_META[ctType];
  const exclLabel = excl ? "Oui · 30 jours" : "Non";
  const commClean = String(commission).replace(/[^0-9.]/g, "") || "20";
  const ref = refFor(ctName);

  const { parties, terms } = useMemo<{ parties: string; terms: Term[] }>(() => {
    if (ctType === "marque") {
      return {
        parties: `ENTRE ${brand || "[Annonceur]"} (l'Annonceur) ET ${ctName}, représenté(e) par TTP Creators (l'Agent).`,
        terms: [
          { l: "Objet", v: `Campagne ${brand || "—"}` },
          { l: "Livrables", v: deliverables || "—" },
          { l: "Montant", v: value || "—" },
          { l: "Exclusivité", v: exclLabel },
          { l: "Durée", v: duration || "—" },
          { l: "Commission TTP", v: `${commClean}% du montant` },
          ...PAY_TERMS,
        ],
      };
    }
    if (ctType === "repr") {
      return {
        parties: `ENTRE ${ctName} (le Créateur) ET TTP Creators (l'Agent), pour la gestion de sa carrière.`,
        terms: [
          { l: "Objet", v: "Représentation exclusive" },
          { l: "Commission", v: `${commClean}%` },
          { l: "Exclusivité", v: exclLabel },
          { l: "Durée", v: duration || "—" },
          { l: "Périmètre", v: "Négo · contrats · facturation" },
          ...PAY_TERMS,
        ],
      };
    }
    return {
      parties: `ENTRE ${brand || "[Client]"} (le Client) ET ${ctName} (Créateur UGC), via TTP Creators.`,
      terms: [
        { l: "Objet", v: `Contenus UGC pour ${brand || "—"}` },
        { l: "Livrables", v: deliverables || "—" },
        { l: "Montant", v: value || "—" },
        { l: "Cession de droits", v: "12 mois · paid media" },
        { l: "Exclusivité", v: exclLabel },
        { l: "Durée", v: duration || "—" },
        ...PAY_TERMS,
      ],
    };
  }, [ctType, brand, ctName, deliverables, value, exclLabel, duration, commClean]);

  const allClauses: Term[] = [...CLAUSES, ...extra.map((e) => ({ l: e.l, v: e.v }))];
  const isBrand = ctType !== "repr";

  const contractText = useMemo(() => {
    return [
      "CONTRAT DE COLLABORATION",
      meta.title.toUpperCase(),
      `Réf. ${ref}`,
      "",
      `Parties : TTP Creators & ${ctName} × ${brand || "[Marque]"}`,
      "",
      parties,
      "",
      ...terms.map((t) => `• ${t.l} : ${t.v}`),
      "",
      "CLAUSES",
      ...allClauses.map((c) => `${c.l}\n${c.v}`),
      "",
      "Fait à Lyon — Pour TTP Creators / Pour " + ctName,
    ].join("\n");
  }, [meta.title, ref, ctName, brand, parties, terms, allClauses]);

  const buildHTML = () => contractHTML({ ref, meta, ctName, brand, parties, terms, clauses: allClauses });

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(contractText);
      setCopied(true);
      toast("Contrat copié ✓");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Impossible de copier — presse-papier bloqué");
    }
  };

  const downloadPDF = () => {
    const blob = new Blob([buildHTML()], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contrat-${ctName.toLowerCase().replace(/\s+/g, "-")}-${ref}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Contrat téléchargé ✓ (ouvre-le puis Imprimer → PDF)");
  };

  // ── Cas de configuration (par créateur) ──
  const persistConfigs = async (next: ContractConfigs) => {
    setLocalCfg(next);
    await saveAppStateKey("contractConfigs", next);
  };

  const saveCase = () => {
    const name = caseName.trim() || "Cas";
    const cs: ContractCase = { id: uid(), name, ctType, brand, value, commission, duration, deliverables, excl, extra };
    const list = configs[ctName] ?? [];
    const idx = list.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? { ...cs, id: c.id } : c)) : [...list, cs];
    persistConfigs({ ...configs, [ctName]: nextList });
    toast(idx >= 0 ? `Cas « ${name} » mis à jour ✓` : `Cas « ${name} » enregistré ✓`);
  };

  const deleteCase = (id: string) => {
    const nextList = (configs[ctName] ?? []).filter((c) => c.id !== id);
    persistConfigs({ ...configs, [ctName]: nextList });
    toast("Cas supprimé");
  };

  const typeToggle = (
    <>
      <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-faint">Type de contrat</div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TYPE_META) as CtType[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setCtType(k)}
            className={cn(
              "whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[10px] font-semibold transition-colors",
              k === ctType ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-rowhover",
            )}
          >
            {TYPE_META[k].chip}
          </button>
        ))}
      </div>
    </>
  );

  if (ctType === "repr") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">{typeToggle}</div>
        <RepresentationContract />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.15fr]">
      {/* ============ FORMULAIRE ============ */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        {typeToggle}

        {/* Créateur */}
        <div className="mb-2 mt-5 text-[9px] font-semibold uppercase tracking-wider text-faint">Créateur</div>
        {creators.length === 0 ? (
          <div className="text-xs text-faint">Aucun créateur dans le roster — le contrat utilisera « [Créateur] ».</div>
        ) : (
          <Select value={ctName} onValueChange={setCreatorName}>
            <SelectTrigger className="h-9 w-auto min-w-[190px] rounded-full bg-surface" placeholder="Choisir un créateur" />
            <SelectContent>
              {creators.map((c, i) => (
                <SelectItem key={c.id} index={i} value={c.name}>{titleCase(c.name)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Cas de configuration */}
        <div className="mt-5 rounded-xl border border-border bg-panel p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">Cas de configuration · {titleCase(ctName)}</span>
          </div>
          {cases.length > 0 ? (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {cases.map((cs) => (
                <span key={cs.id} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium", cs.name === caseName ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground")}>
                  <button type="button" onClick={() => applyCase(cs)} className="transition-colors hover:text-foreground">{cs.name}</button>
                  <button type="button" onClick={() => setPendingDel({ message: `Supprimer le cas « ${cs.name} » ? Cette action est irréversible.`, run: () => deleteCase(cs.id) })} className="text-faint transition-colors hover:text-rose-500" title="Supprimer le cas"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : (
            <div className="mb-2.5 text-[11px] text-faint">Aucun cas enregistré pour ce créateur. Configure puis enregistre un cas.</div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField label="Nom du cas" value={caseName} onChange={setCaseName} placeholder="ex Standard, Exclusif, UGC…" />
            </div>
            <button type="button" onClick={saveCase} className={cn(primaryBtn, "flex h-[42px] shrink-0 items-center gap-1.5")}>
              <Save className="h-3.5 w-3.5" /> Enregistrer
            </button>
          </div>
        </div>

        {/* Champs */}
        {isBrand && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <TextField label="Marque" value={brand} onChange={setBrand} placeholder="ex Sephora" />
              <TextField label="Valeur" value={value} onChange={setValue} placeholder="ex 32 000 €" />
            </div>
            <div className="mt-3">
              <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
            </div>
          </>
        )}
        <div className="mt-3">
          <TextField label="Commission (%)" value={commission} onChange={setCommission} type="number" placeholder="ex 20" />
        </div>
        <div className="mt-3 grid grid-cols-1 items-end gap-3 md:grid-cols-2">
          <TextField label="Durée" value={duration} onChange={setDuration} placeholder="ex 12 mois" />
          <div className="flex min-w-[150px] flex-1 flex-col gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Exclusivité</span>
            <button
              type="button"
              onClick={() => setExcl((v) => !v)}
              className={cn("flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[11px] font-semibold transition-colors", excl ? "bg-signalsoft text-signaltext" : "border border-border text-muted-foreground hover:bg-rowhover")}
            >
              <span className={cn("grid h-4 w-4 place-items-center rounded", excl ? "bg-primary text-primary-foreground" : "border border-border")}>{excl && <Check className="h-3 w-3" />}</span>
              {exclLabel}
            </button>
          </div>
        </div>

        {/* Clauses additionnelles */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">Clauses additionnelles</span>
            <button type="button" onClick={() => setExtra([...extra, { id: uid(), l: `Art. ${9 + extra.length} — Clause`, v: "" }])} className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover">
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </button>
          </div>
          {extra.length === 0 ? (
            <div className="text-[11px] text-faint">Ajoute des clauses spécifiques (options) pour un contrat sur-mesure.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {extra.map((e) => (
                <div key={e.id} className="rounded-lg border border-border bg-panel p-2.5">
                  <div className="flex items-center gap-2">
                    <input value={e.l} onChange={(ev) => setExtra(extra.map((x) => (x.id === e.id ? { ...x, l: ev.target.value } : x)))} placeholder="Titre de la clause" className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium outline-none focus:border-primary" />
                    <button type="button" onClick={() => setExtra(extra.filter((x) => x.id !== e.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500" title="Supprimer"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <textarea value={e.v} onChange={(ev) => setExtra(extra.map((x) => (x.id === e.id ? { ...x, v: ev.target.value } : x)))} rows={2} placeholder="Contenu de la clause…" className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ APERÇU ============ */}
      <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-7">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#14181E] text-[10px] font-bold text-white">{initials(ctName) || "TTP"}</div>
            <div>
              <div className="text-xs font-bold text-foreground">TTP CREATORS</div>
              <div className="text-[9px] text-faint">Lyon · France</div>
            </div>
          </div>
          <div className="text-[9px] font-semibold text-faint">RÉF. {ref}</div>
        </div>

        <div className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-signaltext">{meta.label}</div>
        <div className="mt-1 text-[13px] font-semibold uppercase tracking-wider text-foreground">Contrat de collaboration</div>
        <div className="mt-1.5 text-xl font-semibold tracking-tight text-foreground">{meta.title}</div>

        <div className="mt-3 text-xs leading-relaxed text-muted-foreground">Parties : TTP Creators &amp; {ctName} × {brand || "[Marque]"}</div>
        <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{parties}</div>

        <div className="my-4 h-px bg-border" />

        <div>
          {terms.map((t, i) => (
            <div key={i} className="flex justify-between gap-4 border-b border-border py-2.5 last:border-0">
              <span className="text-xs font-medium text-muted-foreground">{t.l}</span>
              <span className="text-right text-xs font-semibold text-foreground">{t.v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 self-start">
          <AnimatedBadge status="info" size="sm">Conforme RGPD · Dir. 2011/83/UE · Droit FR</AnimatedBadge>
        </div>

        <div className="mt-4 space-y-2.5">
          {allClauses.map((c, i) => (
            <div key={i}>
              <div className="text-[10px] font-semibold text-foreground">{c.l}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{c.v || "—"}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-4">
          <div className="flex-1"><div className="h-8 border-b border-border" /><div className="mt-1.5 text-[10px] font-medium text-faint">Pour TTP Creators</div></div>
          <div className="flex-1"><div className="h-8 border-b border-border" /><div className="mt-1.5 text-[10px] font-medium text-faint">Pour {ctName}</div></div>
        </div>

        {/* Actions */}
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" onClick={copyContract} className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copié ✓" : "Copier"}
          </button>
          <button type="button" onClick={() => setPreview(buildHTML())} className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Eye className="h-3.5 w-3.5" /> Aperçu
          </button>
          <button type="button" onClick={downloadPDF} className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90">
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>

      {preview && (
        <Modal
          title={`Aperçu · ${ref}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
              <button
                type="button"
                className={cn(ghostBtn, "flex items-center gap-1.5")}
                onClick={() => {
                  const w = window.open("", "_blank");
                  if (w) { w.document.write(preview); w.document.close(); w.focus(); w.print(); } else toast("Autorise les pop-ups pour imprimer");
                }}
              >
                <FileText className="h-3.5 w-3.5" /> Imprimer / PDF
              </button>
            </>
          }
        >
          <iframe title={`Contrat ${ref}`} srcDoc={preview} className="h-[64vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}
      {pendingDel && (
        <ConfirmDialog
          title="Supprimer le cas"
          message={pendingDel.message}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </div>
  );
}

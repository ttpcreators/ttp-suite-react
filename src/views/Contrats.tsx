import { useMemo, useState } from "react";
import { Copy, Check, Building2 } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { TextField } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";

type CtType = "marque" | "repr" | "ugc";

const TYPE_META: Record<CtType, { chip: string; label: string; title: string }> = {
  marque: {
    chip: "Marque × Créateur",
    label: "MARQUE × CRÉATEUR",
    title: "Contrat de partenariat commercial",
  },
  repr: {
    chip: "Représentation",
    label: "AGENCE × CRÉATEUR",
    title: "Contrat de représentation",
  },
  ugc: {
    chip: "Contrat UGC",
    label: "CONTRAT UGC",
    title: "Cession de droits — UGC",
  },
};

type Term = { l: string; v: string };

const CLAUSES: Term[] = [
  {
    l: "Art. 1 — Objet",
    v: "Le présent contrat définit les conditions de la prestation et les engagements réciproques des parties.",
  },
  {
    l: "Art. 2 — Rémunération & paiement",
    v: "Les sommes sont versées par virement à 30 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).",
  },
  {
    l: "Art. 3 — Propriété intellectuelle",
    v: "La cession des droits d'exploitation est limitée aux supports, territoires et durée stipulés. Toute réutilisation hors périmètre fait l'objet d'un avenant.",
  },
  {
    l: "Art. 4 — Données personnelles (RGPD)",
    v: "Les parties traitent les données conformément au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés. Finalité limitée à l'exécution du contrat.",
  },
  {
    l: "Art. 5 — Transparence publicitaire",
    v: "Tout contenu sponsorisé est identifié comme tel (« Publicité » / « Partenariat rémunéré »), conformément aux lignes directrices ARPP et au droit de la consommation UE.",
  },
  {
    l: "Art. 6 — Droit de rétractation",
    v: "Conformément à la Directive 2011/83/UE, un délai de rétractation de 14 jours s'applique sauf renonciation expresse pour exécution immédiate.",
  },
  {
    l: "Art. 7 — Confidentialité & résiliation",
    v: "Obligation de confidentialité réciproque. Résiliation possible pour manquement grave après mise en demeure restée infructueuse sous 15 jours.",
  },
  {
    l: "Art. 8 — Droit applicable & litiges",
    v: "Contrat régi par le droit français. À défaut d'accord amiable (médiation préalable), compétence exclusive des tribunaux de Lyon.",
  },
];

const PAY_TERMS: Term[] = [
  { l: "Modalités", v: "Virement · 30 j fin de mois" },
  { l: "TVA", v: "Non assujetti (art. 293 B CGI)" },
];

export function Contrats() {
  const creators = useCreators();

  const [ctType, setCtType] = useState<CtType>("marque");
  const [creatorName, setCreatorName] = useState("");
  const [brand, setBrand] = useState("Sephora");
  const [value, setValue] = useState("32 000 €");
  const [commission, setCommission] = useState("20");
  const [duration, setDuration] = useState("12 mois");
  const [deliverables, setDeliverables] = useState("3 posts · 1 reel");
  const [excl, setExcl] = useState(true);
  const [copied, setCopied] = useState(false);

  // Créateur affiché : sélection explicite, sinon premier du roster, sinon placeholder.
  const ctName = creatorName || creators[0]?.name || "[Créateur]";
  const meta = TYPE_META[ctType];
  const exclLabel = excl ? "Oui · 30 jours" : "Non";
  const commClean = String(commission).replace(/[^0-9.]/g, "") || "20";

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

  const isBrand = ctType !== "repr";
  const isRepr = ctType === "repr";

  const contractText = useMemo(() => {
    const lines = [
      "CONTRAT DE COLLABORATION",
      meta.title.toUpperCase(),
      "",
      `Parties : TTP Creators & ${ctName} × ${brand || "[Marque]"}`,
      "",
      parties,
      "",
      ...terms.map((t) => `• ${t.l} : ${t.v}`),
      "",
      "CLAUSES STANDARD",
      ...CLAUSES.map((c) => `${c.l}\n${c.v}`),
      "",
      "Fait à Lyon — Pour TTP Creators / Pour " + ctName,
    ];
    return lines.join("\n");
  }, [meta.title, ctName, brand, parties, terms]);

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

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.15fr]">
      {/* ============ FORMULAIRE ============ */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        {/* Type de contrat */}
        <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-faint">
          Type de contrat
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_META) as CtType[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCtType(k)}
              className={cn(
                "whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[10px] font-semibold transition-colors",
                k === ctType
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-rowhover",
              )}
            >
              {TYPE_META[k].chip}
            </button>
          ))}
        </div>

        {/* Créateur */}
        <div className="mb-2 mt-5 text-[9px] font-semibold uppercase tracking-wider text-faint">
          Créateur
        </div>
        {creators.length === 0 ? (
          <div className="text-xs text-faint">
            Aucun créateur dans le roster — le contrat utilisera « [Créateur] ».
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {creators.map((c) => {
              const first = c.name.split(" ")[0];
              const active = c.name === ctName;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCreatorName(c.name)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[9px] font-semibold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
                  )}
                >
                  {first}
                </button>
              );
            })}
          </div>
        )}

        {/* Champs marque / montant / livrables (marque & ugc) */}
        {isBrand && (
          <>
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              <TextField label="Marque" value={brand} onChange={setBrand} placeholder="ex Sephora" />
              <TextField label="Valeur" value={value} onChange={setValue} placeholder="ex 32 000 €" />
            </div>
            <div className="mt-3">
              <TextField
                label="Livrables"
                value={deliverables}
                onChange={setDeliverables}
                placeholder="ex 3 posts · 1 reel"
              />
            </div>
          </>
        )}

        {/* Commission (représentation) */}
        {isRepr && (
          <div className="mt-5">
            <TextField
              label="Commission (%)"
              value={commission}
              onChange={setCommission}
              type="number"
              placeholder="ex 20"
            />
          </div>
        )}

        {/* Durée + Exclusivité */}
        <div className="mt-3 grid grid-cols-1 items-end gap-3 md:grid-cols-2">
          <TextField label="Durée" value={duration} onChange={setDuration} placeholder="ex 12 mois" />
          <div className="flex min-w-[150px] flex-1 flex-col gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">
              Exclusivité
            </span>
            <button
              type="button"
              onClick={() => setExcl((v) => !v)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[11px] font-semibold transition-colors",
                excl
                  ? "bg-signalsoft text-signaltext"
                  : "border border-border text-muted-foreground hover:bg-rowhover",
              )}
            >
              <span
                className={cn(
                  "grid h-4 w-4 place-items-center rounded",
                  excl ? "bg-primary text-primary-foreground" : "border border-border",
                )}
              >
                {excl && <Check className="h-3 w-3" />}
              </span>
              {exclLabel}
            </button>
          </div>
        </div>
      </div>

      {/* ============ APERÇU DU CONTRAT ============ */}
      <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-7">
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#14181E] text-[10px] font-bold text-white">
              {initials(ctName) || "TTP"}
            </div>
            <div>
              <div className="text-xs font-bold text-foreground">TTP CREATORS</div>
              <div className="text-[9px] text-faint">Lyon · France</div>
            </div>
          </div>
          <div className="text-[9px] font-semibold text-faint">RÉF. TTP-2026-091</div>
        </div>

        {/* Titre */}
        <div className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-signaltext">
          {meta.label}
        </div>
        <div className="mt-1 text-[13px] font-semibold uppercase tracking-wider text-foreground">
          Contrat de collaboration
        </div>
        <div className="mt-1.5 text-xl font-semibold tracking-tight text-foreground">
          {meta.title}
        </div>

        {/* Parties */}
        <div className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Parties : TTP Creators &amp; {ctName} × {brand || "[Marque]"}
        </div>
        <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{parties}</div>

        <div className="my-4 h-px bg-border" />

        {/* Termes clés */}
        <div>
          {terms.map((t, i) => (
            <div
              key={i}
              className="flex justify-between gap-4 border-b border-border py-2.5 last:border-0"
            >
              <span className="text-xs font-medium text-muted-foreground">{t.l}</span>
              <span className="text-right text-xs font-semibold text-foreground">{t.v}</span>
            </div>
          ))}
        </div>

        {/* Badge conformité */}
        <div className="mt-4 self-start">
          <AnimatedBadge status="info" size="sm">
            Conforme RGPD · Dir. 2011/83/UE · Droit FR
          </AnimatedBadge>
        </div>

        {/* Clauses standard */}
        <div className="mt-4 space-y-2.5">
          {CLAUSES.map((c, i) => (
            <div key={i}>
              <div className="text-[10px] font-semibold text-foreground">{c.l}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{c.v}</div>
            </div>
          ))}
        </div>

        {/* Signatures */}
        <div className="mt-5 flex gap-4">
          <div className="flex-1">
            <div className="h-8 border-b border-border" />
            <div className="mt-1.5 text-[10px] font-medium text-faint">Pour TTP Creators</div>
          </div>
          <div className="flex-1">
            <div className="h-8 border-b border-border" />
            <div className="mt-1.5 text-[10px] font-medium text-faint">Pour {ctName}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={copyContract}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copié ✓" : "Copier le contrat"}
          </button>
          <div className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Généré en local
          </div>
        </div>
      </div>
    </div>
  );
}

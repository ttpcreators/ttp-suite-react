import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Check, FileText, FileDown, Eye, X, Save, Maximize2, Link2, PenLine, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { printHtml } from "@/lib/printPdf";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { TextField, SelectField } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import {
  RC_FIELDS,
  RC_GROUPS,
  RC_VARIANTS,
  representationText,
  representationHTML,
} from "@/lib/representationContract";
import { Overlay } from "@/components/mobile/ios-sheet";
import { CasesBar, ContractDocument, FoldSection, HistoryPanel, PanelSection, SettingsPanel, SwitchRow, docBtn, docIconBtn, docPrimaryBtn } from "@/components/contracts/contract-ui";

type Cfg = Record<string, string>;
type SavedCase = { id: string; name: string; config: Cfg };
type Configs = Record<string, SavedCase[]>;

/** Sentinelle « créateur externe » (hors roster) : on ne préremplit rien. */
const EXT = "__ext__";

/** Contrat enregistré (historique agence). Le fichier vit aussi dans `documents`
 *  (type='contract') → visible sur le portail du créateur concerné. */
type ContractHist = { id: string; creator: string | null; title: string; variante: string; config: Cfg; createdAt: string; path: string };

let _uid = 0;
const uid = () => `rc${Date.now().toString(36)}${(_uid += 1)}`;

const primaryBtn = "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const ghostBtn = "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

/** "16/09/2002" ou "2002-09-16" → "2002-09-16" (ou "" si non reconnu). */
function toISO(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

function defaultConfig(variant: string): Cfg {
  const base: Cfg = {};
  for (const f of RC_FIELDS) base[f.key] = f.default;
  const v = RC_VARIANTS.find((x) => x.key === variant) ?? RC_VARIANTS[0];
  return { ...base, ...v.defaults };
}

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Overlay className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClose={onClose}>
      <div className={cn("my-2 w-full rounded-2xl border border-border bg-card shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </Overlay>
  );
}

export function RepresentationContract() {
  const creators = useCreators();
  const { data: cfgData } = useAppState<Configs>((s: AppState) => (s["representationConfigs"] as Configs) ?? {});
  const [localCfg, setLocalCfg] = useState<Configs | null>(null);
  const configs = localCfg ?? cfgData ?? {};

  const [creatorName, setCreatorName] = useState("");
  const [config, setConfig] = useState<Cfg>(() => defaultConfig("exclusif"));
  const [caseName, setCaseName] = useState("Standard");
  const [pendingDel, setPendingDel] = useState<null | { title?: string; message: string; run: () => void }>(null);
  // « Modifier » depuis l'historique : le préremplissage créateur ne doit pas écraser le contrat chargé
  const skipPrefillRef = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Général: true, Talent: true });

  // Historique des contrats enregistrés (blob agence ; le fichier va aussi dans documents).
  const { data: histData } = useAppState<ContractHist[]>((s: AppState) => (s["contractHistory"] as ContractHist[]) ?? []);
  const [localHist, setLocalHist] = useState<ContractHist[] | null>(null);
  // Défensif : n'affiche que les entrées BIEN formées (le blob a pu contenir un temps
  // des entrées d'un autre format — cf. fix collision brandContractHistory).
  const hist = (localHist ?? histData ?? []).filter((e): e is ContractHist => !!e && typeof e.path === "string" && !!e.config);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const ctName = creatorName || creators[0]?.name || "";
  const cases = configs[ctName] ?? [];
  const isExternal = ctName === EXT;

  // Au changement de créateur : préremplit les infos Talent + charge le 1er cas enregistré.
  useEffect(() => {
    if (!ctName) return;
    if (skipPrefillRef.current) {
      skipPrefillRef.current = false;
      return;
    }
    if (ctName === EXT) {
      // Externe : aucun préremplissage roster (tout se saisit dans « Talent »).
      const saved = (configs[EXT] ?? [])[0];
      if (saved) {
        setConfig((prev) => ({ ...defaultConfig(prev.variante), ...saved.config }));
        setCaseName(saved.name);
      }
      return;
    }
    let alive = true;
    supabase.from("creators").select("name,birth,address,siren,email_pro").eq("name", ctName).limit(1).then(({ data }) => {
      if (!alive) return;
      const row = (data?.[0] as { name: string; birth: string | null; address: string | null; siren: string | null; email_pro: string | null }) ?? null;
      const saved = (configs[ctName] ?? [])[0];
      setConfig((prev) => {
        if (saved) {
          // Cas enregistré pour ce créateur : ses valeurs priment, roster en repli.
          const base = { ...defaultConfig(prev.variante), ...saved.config };
          return {
            ...base,
            talentNom: base.talentNom || (row ? titleCase(row.name) : ""),
            talentDateNaissance: base.talentDateNaissance || toISO(row?.birth),
            talentAdresse: base.talentAdresse || (row?.address ?? ""),
            talentSiret: base.talentSiret || (row?.siren ?? ""),
            talentEmailPro: base.talentEmailPro || (row?.email_pro ?? ""),
          };
        }
        // Pas de cas enregistré → on préremplit DEPUIS LE ROSTER et on ÉCRASE les
        // infos de l'ancien créateur (sinon elles restaient, ex. Candice au lieu de Lucie).
        return {
          ...prev,
          talentNom: row ? titleCase(row.name) : "",
          talentDateNaissance: toISO(row?.birth),
          talentAdresse: row?.address ?? "",
          talentSiret: row?.siren ?? "",
          talentEmailPro: row?.email_pro ?? "",
        };
      });
      if (saved) setCaseName(saved.name);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctName]);

  const set = (k: string, v: string) => setConfig((c) => ({ ...c, [k]: v }));
  const changeVariant = (variant: string) => setConfig((c) => ({ ...c, ...RC_VARIANTS.find((x) => x.key === variant)?.defaults, variante: variant }));

  const variantMeta = RC_VARIANTS.find((x) => x.key === config.variante) ?? RC_VARIANTS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(representationText(config));
      setCopied(true);
      toast("Contrat copié ✓");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Copie impossible");
    }
  };
  const downloadPDF = () => {
    // Ouvre la boîte d'impression → « Enregistrer au format PDF » (vrai PDF, texte net).
    printHtml(representationHTML(config));
    toast("Dans la fenêtre : choisis « Enregistrer au format PDF »");
  };

  // Relecture fraîche avant merge : ne pas écraser les cas d'autres créateurs.
  const mutateConfigs = async (fn: (fresh: Configs) => Configs) => {
    invalidateAppState();
    const fresh = ((await getAppState())["representationConfigs"] as Configs) ?? {};
    const next = fn(fresh);
    setLocalCfg(next);
    const ok = await saveAppStateKey("representationConfigs", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
  };
  const saveCase = async () => {
    if (!ctName) {
      toast("Choisis d'abord un créateur");
      return;
    }
    const name = caseName.trim() || "Cas";
    const cs: SavedCase = { id: uid(), name, config };
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
  const loadCase = (cs: SavedCase) => {
    setConfig({ ...defaultConfig(cs.config.variante || "exclusif"), ...cs.config });
    setCaseName(cs.name);
  };
  const deleteCase = async (id: string) => {
    const ok = await mutateConfigs((fresh) => ({
      ...fresh,
      [ctName]: (fresh[ctName] ?? []).filter((c) => c.id !== id),
    }));
    if (ok) toast("Modèle supprimé");
  };

  // ── Historique des contrats : enregistrer / charger / partager / supprimer ──
  const saveContract = async () => {
    if (saving) return;
    if (!config.talentNom?.trim()) {
      toast("Renseigne le nom du Talent avant d'enregistrer");
      return;
    }
    setSaving(true);
    try {
      const html = representationHTML(config);
      const title = `Contrat de représentation — ${config.talentNom.trim()}`;
      const slug = (config.talentNom.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "talent").replace(/^-|-$/g, "");
      const path = `contracts/${slug}-${Date.now()}.html`;
      const up = await supabase.storage.from("documents").upload(path, new Blob([html], { type: "text/html;charset=utf-8" }), {
        contentType: "text/html;charset=utf-8",
        upsert: false,
      });
      if (up.error) {
        toast("Enregistrement échoué — réessaie");
        return;
      }
      const creator = isExternal ? null : ctName || null;
      const size = `${Math.max(1, Math.round(html.length / 1024))} Ko`;
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({ creator, name: title, type: "contract", size, path, sort_order: 0 })
        .select("id")
        .single();
      if (docErr || !doc) {
        await supabase.storage.from("documents").remove([path]).catch(() => {});
        toast("Enregistrement échoué — réessaie");
        return;
      }
      const entry: ContractHist = {
        id: (doc as { id: string }).id,
        creator,
        title,
        variante: config.variante,
        config,
        createdAt: new Date().toISOString(),
        path,
      };
      invalidateAppState();
      const fresh = ((await getAppState())["contractHistory"] as ContractHist[]) ?? [];
      const ok = await saveAppStateKey("contractHistory", [entry, ...fresh]);
      if (!ok) {
        toast("Contrat stocké, mais pas ajouté aux contrats enregistrés. Réessaie");
        return;
      }
      setLocalHist([entry, ...hist]);

      // Auto-échéance : crée/actualise le suivi d'échéance (Marc risque d'oublier).
      // Bonus best-effort : n'empêche JAMAIS l'enregistrement du contrat s'il échoue.
      let deadlineOk = false;
      try {
        const dlCreator = (creator ?? config.talentNom.trim()) || "";
        if (dlCreator) {
          const start = toISO(config.dateDebut) || toISO(config.dateSignature) || new Date().toISOString().slice(0, 10);
          const months = Math.max(1, parseInt(config.dureeMois, 10) || 12);
          type Dl = { id: string; creator: string; type: string; start: string; months: number; note?: string };
          invalidateAppState();
          const freshDl = ((await getAppState())["contractDeadlines"] as Dl[]) ?? [];
          // Remplace l'éventuelle échéance « représentation » existante du même créateur (pas de doublon).
          const kept = freshDl.filter((d) => !(d.type === "représentation" && d.creator.trim().toLowerCase() === dlCreator.trim().toLowerCase()));
          const dl: Dl = { id: uid(), creator: dlCreator, type: "représentation", start, months, note: "Auto — contrat de représentation" };
          deadlineOk = await saveAppStateKey("contractDeadlines", [dl, ...kept]);
        }
      } catch { /* échéance = bonus, on ignore l'erreur */ }

      toast(
        creator
          ? `Contrat enregistré ✓ — portail du créateur${deadlineOk ? " · échéance suivie" : ""}`
          : `Contrat enregistré ✓${deadlineOk ? " · échéance suivie" : ""}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const loadContract = (e: ContractHist) => {
    setConfig({ ...defaultConfig(e.variante || "exclusif"), ...e.config });
    // Le changement de créateur déclenche le préremplissage : on le saute une fois
    if ((e.creator ?? EXT) !== ctName) skipPrefillRef.current = true;
    setCreatorName(e.creator ?? EXT);
    setCaseName("Modifié");
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Contrat chargé : modifie-le puis enregistre-le à nouveau");
  };
  const shareContract = async (e: ContractHist) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(e.path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      toast("Lien indisponible — réessaie");
      return;
    }
    const url = data.signedUrl;
    // Après un await, iOS refuse souvent le presse-papiers : repli partage natif puis affichage du lien
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      toast("Lien du contrat copié ✓ (valable 7 jours)");
      return;
    } catch { /* repli ci-dessous */ }
    if (navigator.share) {
      try {
        await navigator.share({ title: e.title, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return; // partage annulé par l'utilisateur
      }
    }
    window.prompt("Copie le lien du contrat (valable 7 jours) :", url);
  };
  const deleteContract = async (e: ContractHist) => {
    invalidateAppState();
    const fresh = ((await getAppState())["contractHistory"] as ContractHist[]) ?? [];
    const ok = await saveAppStateKey("contractHistory", fresh.filter((x) => x.id !== e.id));
    if (!ok) {
      toast("Erreur — réessaie");
      return;
    }
    setLocalHist(hist.filter((x) => x.id !== e.id));
    const { error: docErr } = await supabase.from("documents").delete().eq("id", e.id);
    await supabase.storage.from("documents").remove([e.path]).catch(() => {});
    toast(docErr ? "Contrat retiré des contrats enregistrés, mais toujours visible dans Documents. Supprime-le là-bas" : "Contrat supprimé");
  };

  // Champs courts (nombre, date, petit menu) côte à côte par deux ; un champ court sans
  // voisin court prend toute la ligne (pas de demi-ligne vide).
  const isShort = (f?: (typeof RC_FIELDS)[number]) =>
    !!f && (f.type === "number" || f.type === "date" || (f.type === "select" && !(f.options ?? []).some((o) => o.label.length > 26))) && f.label.length <= 34;
  const halfKeys = new Set<string>();
  for (const g of RC_GROUPS) {
    const list = RC_FIELDS.filter((f) => f.group === g);
    for (let k = 0; k < list.length; k++) {
      if (isShort(list[k]) && isShort(list[k + 1])) {
        halfKeys.add(list[k].key);
        halfKeys.add(list[k + 1].key);
        k++;
      }
    }
  }
  const fieldWide = (f: (typeof RC_FIELDS)[number]) => !halfKeys.has(f.key);

  const renderField = (key: string) => {
    const f = RC_FIELDS.find((x) => x.key === key);
    if (!f) return null;
    const val = config[f.key] ?? f.default;
    if (f.type === "bool") {
      return (
        <div key={f.key} className="sm:col-span-2">
          <SwitchRow label={f.label} help={f.help} checked={val === "true"} onChange={(on) => set(f.key, on ? "true" : "false")} />
        </div>
      );
    }
    const field =
      f.type === "select" ? (
        <SelectField label={f.label} value={val} onChange={(v) => set(f.key, v)} options={f.options ?? []} />
      ) : (
        <TextField label={f.label} value={val} onChange={(v) => set(f.key, v)} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} />
      );
    return (
      <div key={f.key} className={cn("min-w-0", fieldWide(f) && "sm:col-span-2")}>
        {field}
        {f.help && <p className="mt-1 text-[11.5px] text-faint">{f.help}</p>}
      </div>
    );
  };

  // Résumé affiché sur une section repliée.
  const optLabel = (key: string) => {
    const f = RC_FIELDS.find((x) => x.key === key);
    const v = config[key] ?? f?.default ?? "";
    return f?.options?.find((o) => o.value === v)?.label ?? v;
  };
  const groupSummary = (g: string): string => {
    if (g === "Talent") return config.talentNom?.trim() || "À compléter";
    if (g === "Général") return [optLabel("variante"), config.lieuSignature].filter(Boolean).join(" · ");
    if (g === "Durée") return [config.dureeMois ? `${config.dureeMois} mois` : "", optLabel("modeDuree")].filter(Boolean).join(" · ");
    if (g === "Commission") return optLabel("modeCommission");
    const bools = RC_FIELDS.filter((f) => f.group === g && f.type === "bool");
    if (!bools.length) return "";
    const on = bools.filter((f) => (config[f.key] ?? f.default) === "true").length;
    return `${on} sur ${bools.length} activé${on > 1 ? "s" : ""}`;
  };
  const [variantName, ...variantRest] = variantMeta.label.split(/\s+—\s+/);
  const html = representationHTML(config);

  return (
    <div ref={rootRef} className="scroll-mt-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
        {/* ── Réglages ── */}
        <SettingsPanel>
          <PanelSection title="Formule">
            <div role="radiogroup" aria-label="Formule du contrat" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RC_VARIANTS.map((v) => {
                const on = config.variante === v.key;
                const [name, ...rest] = v.label.split(/\s+—\s+/);
                return (
                  <button
                    key={v.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => changeVariant(v.key)}
                    className={cn("rounded-xl border px-3.5 py-3 text-left transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-rowhover")}
                  >
                    <span className="block text-[13px] font-semibold">{name}</span>
                    {rest.length > 0 && <span className={cn("mt-0.5 block text-[12px]", on ? "text-background/70" : "text-muted-foreground")}>{rest.join(" · ")}</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">{variantMeta.commissionSummary}</p>
          </PanelSection>

          <PanelSection title="Créateur" hint={isExternal ? "Créateur hors roster : son nom et ses coordonnées se remplissent dans la section Talent." : "Ses coordonnées sont reprises de sa fiche."}>
            <Select value={ctName} onValueChange={setCreatorName}>
              <SelectTrigger className="h-[42px] w-full rounded-lg bg-surface" placeholder="Choisir un créateur" />
              <SelectContent>
                {creators.map((c, i) => (
                  <SelectItem key={c.id} index={i} value={c.name} img={c.photo_url}>{titleCase(c.name)}</SelectItem>
                ))}
                <SelectItem index={creators.length} value={EXT}>Externe (hors roster)</SelectItem>
              </SelectContent>
            </Select>
            <CasesBar
              cases={cases}
              active={caseName}
              onLoad={(id) => {
                const cs = cases.find((c) => c.id === id);
                if (cs) loadCase(cs);
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

          {RC_GROUPS.map((g) => {
            const fields = RC_FIELDS.filter((f) => f.group === g);
            if (fields.length === 0) return null;
            const open = openGroups[g] ?? false;
            return (
              <FoldSection key={g} title={g} summary={groupSummary(g)} open={open} onToggle={() => setOpenGroups((o) => ({ ...o, [g]: !open }))}>
                <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">{fields.map((f) => renderField(f.key))}</div>
              </FoldSection>
            );
          })}
        </SettingsPanel>

        {/* ── Document (le vrai PDF, en direct) ── */}
        <div className="lg:sticky lg:top-4">
          <ContractDocument
            html={html}
            title="Contrat de représentation"
            meta={[variantName, ...variantRest].join(" · ") + (config.talentNom?.trim() ? ` · ${config.talentNom.trim()}` : "")}
            actions={
              <>
                <button type="button" onClick={copy} className={docIconBtn} title="Copier le texte du contrat" aria-label="Copier le texte du contrat">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => setPreview(html)} className={docIconBtn} title="Ouvrir en grand" aria-label="Ouvrir en grand">
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={saveContract} disabled={saving} className={docBtn} title="Le contrat est rangé ici et envoyé sur l'espace du créateur">
                  <Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button type="button" onClick={downloadPDF} className={docPrimaryBtn}>
                  <FileDown className="h-4 w-4" /> PDF
                </button>
              </>
            }
          />
        </div>
      </div>

      {/* ── Contrats enregistrés ── */}
      <div className="mt-4">
        <HistoryPanel title="Contrats enregistrés" count={hist.length} empty="Aucun contrat enregistré. « Enregistrer » le range ici et l'envoie sur l'espace du créateur concerné.">
          {hist.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover/50 sm:px-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">{e.title}</div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {e.creator ? titleCase(e.creator) : "Externe"} · {new Date(e.createdAt).toLocaleDateString("fr-FR")}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPreview(representationHTML(e.config))} title="Ouvrir" aria-label="Ouvrir" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"><Eye className="h-4 w-4" /></button>
                <button type="button" onClick={() => loadContract(e)} title="Modifier" aria-label="Modifier" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"><PenLine className="h-4 w-4" /></button>
                <button type="button" onClick={() => shareContract(e)} title="Copier un lien de partage (7 jours)" aria-label="Partager" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"><Link2 className="h-4 w-4" /></button>
                <button
                  type="button"
                  onClick={() => setPendingDel({ title: "Supprimer définitivement", message: `Supprimer « ${e.title} » ?${e.creator ? " Il sera aussi retiré de l'espace du créateur." : ""} Cette action est irréversible.`, run: () => deleteContract(e) })}
                  title="Supprimer définitivement"
                  aria-label="Supprimer définitivement"
                  className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-rose-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </HistoryPanel>
      </div>

      {preview && (
        <Modal title="Contrat de représentation" onClose={() => setPreview(null)} wide footer={
          <>
            <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
            <button type="button" className={cn(primaryBtn, "flex items-center gap-1.5")} onClick={() => printHtml(preview)}>
              <FileDown className="h-3.5 w-3.5" /> Enregistrer en PDF
            </button>
          </>
        }>
          <iframe title="Contrat de représentation" srcDoc={preview} sandbox="allow-same-origin" className="h-[70vh] w-full rounded-lg border border-border bg-white" />
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
    </div>
  );
}

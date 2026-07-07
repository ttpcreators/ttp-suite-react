import { useEffect, useState, type ReactNode } from "react";
import { Copy, Check, FileText, Eye, X, Save, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { TextField, SelectField } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import {
  RC_FIELDS,
  RC_GROUPS,
  RC_VARIANTS,
  buildRepresentation,
  representationText,
  representationHTML,
} from "@/lib/representationContract";

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
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className={cn("my-2 w-full rounded-2xl border border-border bg-card shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

function renderBody(body: string): ReactNode[] {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (bullets.length) {
      out.push(<ul key={`u${k}`} className="my-1 list-disc space-y-0.5 pl-5">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
      bullets = [];
    }
  };
  lines.forEach((l, i) => {
    if (l.startsWith("• ")) bullets.push(l.slice(2));
    else {
      flush(i);
      if (l.trim()) out.push(<p key={`p${i}`} className="my-1">{l}</p>);
    }
  });
  flush(lines.length);
  return out;
}

export function RepresentationContract() {
  const creators = useCreators();
  const { data: cfgData } = useAppState<Configs>((s: AppState) => (s["representationConfigs"] as Configs) ?? {});
  const [localCfg, setLocalCfg] = useState<Configs | null>(null);
  const configs = localCfg ?? cfgData ?? {};

  const [creatorName, setCreatorName] = useState("");
  const [config, setConfig] = useState<Cfg>(() => defaultConfig("exclusif"));
  const [caseName, setCaseName] = useState("Standard");
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Général: true, Talent: true, Durée: true, Commission: true });

  // Historique des contrats enregistrés (blob agence ; le fichier va aussi dans documents).
  const { data: histData } = useAppState<ContractHist[]>((s: AppState) => (s["contractHistory"] as ContractHist[]) ?? []);
  const [localHist, setLocalHist] = useState<ContractHist[] | null>(null);
  const hist = localHist ?? histData ?? [];
  const [saving, setSaving] = useState(false);
  const [showHist, setShowHist] = useState(false);

  const ctName = creatorName || creators[0]?.name || "";
  const cases = configs[ctName] ?? [];
  const isExternal = ctName === EXT;
  const ctLabel = isExternal ? "Externe" : titleCase(ctName);

  // Au changement de créateur : préremplit les infos Talent + charge le 1er cas enregistré.
  useEffect(() => {
    if (!ctName) return;
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
        const base = saved ? { ...defaultConfig(prev.variante), ...saved.config } : { ...prev };
        return {
          ...base,
          talentNom: base.talentNom || (row ? titleCase(row.name) : ""),
          talentDateNaissance: base.talentDateNaissance || toISO(row?.birth),
          talentAdresse: base.talentAdresse || (row?.address ?? ""),
          talentSiret: base.talentSiret || (row?.siren ?? ""),
          talentEmailPro: base.talentEmailPro || (row?.email_pro ?? ""),
        };
      });
      if (saved) setCaseName(saved.name);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctName]);

  const set = (k: string, v: string) => setConfig((c) => ({ ...c, [k]: v }));
  const changeVariant = (variant: string) => setConfig((c) => ({ ...c, ...RC_VARIANTS.find((x) => x.key === variant)?.defaults, variante: variant }));

  const built = buildRepresentation(config);
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
    const blob = new Blob([representationHTML(config)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contrat-representation-${(config.talentNom || "talent").toLowerCase().replace(/\s+/g, "-")}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Contrat téléchargé ✓ (ouvre-le puis Imprimer → PDF)");
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
    if (ok) toast(existed ? `Cas « ${name} » mis à jour ✓` : `Cas « ${name} » enregistré ✓`);
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
    if (ok) toast("Cas supprimé");
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
        toast("Contrat stocké mais historique non enregistré — réessaie");
        return;
      }
      setLocalHist([entry, ...hist]);
      toast(creator ? "Contrat enregistré ✓ — visible dans le portail du créateur" : "Contrat enregistré ✓");
    } finally {
      setSaving(false);
    }
  };

  const loadContract = (e: ContractHist) => {
    setConfig({ ...defaultConfig(e.variante || "exclusif"), ...e.config });
    setCreatorName(e.creator ?? EXT);
    setCaseName("Modifié");
    setShowHist(false);
    toast("Contrat chargé — modifie puis ré-enregistre");
  };
  const shareContract = async (e: ContractHist) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(e.path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      toast("Lien indisponible — réessaie");
      return;
    }
    await navigator.clipboard?.writeText(data.signedUrl).catch(() => {});
    toast("Lien du contrat copié ✓ (valable 7 jours)");
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
    await supabase.from("documents").delete().eq("id", e.id);
    await supabase.storage.from("documents").remove([e.path]).catch(() => {});
    toast("Contrat supprimé");
  };

  const renderField = (key: string) => {
    const f = RC_FIELDS.find((x) => x.key === key);
    if (!f) return null;
    const val = config[f.key] ?? f.default;
    if (f.type === "bool") {
      const on = val === "true";
      return (
        <button key={f.key} type="button" onClick={() => set(f.key, on ? "false" : "true")} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[11px] font-medium transition-colors", on ? "border-primary/40 bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-rowhover")}>
          <span className="flex-1">{f.label}</span>
          <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded", on ? "bg-primary text-primary-foreground" : "border border-border")}>{on && <Check className="h-3 w-3" />}</span>
        </button>
      );
    }
    if (f.type === "select") {
      return <SelectField key={f.key} label={f.label} value={val} onChange={(v) => set(f.key, v)} options={f.options ?? []} />;
    }
    return <TextField key={f.key} label={f.label} value={val} onChange={(v) => set(f.key, v)} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} />;
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.15fr]">
      {/* ── Config ── */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        {/* Variante */}
        <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-faint">Variante</div>
        <div className="flex flex-wrap gap-2">
          {RC_VARIANTS.map((v) => (
            <button key={v.key} type="button" onClick={() => changeVariant(v.key)} className={cn("rounded-xl px-3.5 py-2.5 text-left text-[10px] font-semibold transition-colors", config.variante === v.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-rowhover")}>
              {v.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">{variantMeta.commissionSummary}</p>

        {/* Créateur */}
        <div className="mb-2 mt-5 text-[9px] font-semibold uppercase tracking-wider text-faint">Créateur</div>
        <Select value={ctName} onValueChange={setCreatorName}>
          <SelectTrigger className="h-9 w-auto min-w-[190px] rounded-full bg-surface" placeholder="Choisir un créateur" />
          <SelectContent>
            {creators.map((c, i) => (
              <SelectItem key={c.id} index={i} value={c.name}>{titleCase(c.name)}</SelectItem>
            ))}
            <SelectItem index={creators.length} value={EXT}>✎ Externe (hors roster)</SelectItem>
          </SelectContent>
        </Select>
        {isExternal && (
          <p className="mt-2 text-[11px] text-faint">
            Créateur hors roster : renseigne son nom et ses infos dans la section <span className="font-medium text-foreground">Talent</span> ci-dessous.
          </p>
        )}

        {/* Cas de configuration */}
        <div className="mt-5 rounded-xl border border-border bg-panel p-3.5">
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-faint">Cas enregistrés · {ctName ? ctLabel : "—"}</div>
          {cases.length > 0 ? (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {cases.map((cs) => (
                <span key={cs.id} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium", cs.name === caseName ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground")}>
                  <button type="button" onClick={() => loadCase(cs)} className="transition-colors hover:text-foreground">{cs.name}</button>
                  <button type="button" onClick={() => setPendingDel({ message: `Supprimer le cas « ${cs.name} » ? Cette action est irréversible.`, run: () => deleteCase(cs.id) })} className="text-faint transition-colors hover:text-rose-500" title="Supprimer"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : (
            <div className="mb-2.5 text-[11px] text-faint">Aucun cas pour ce créateur.</div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1"><TextField label="Nom du cas" value={caseName} onChange={setCaseName} placeholder="ex Standard, Exclusif test…" /></div>
            <button type="button" onClick={saveCase} className={cn(primaryBtn, "flex h-[42px] shrink-0 items-center gap-1.5")}><Save className="h-3.5 w-3.5" /> Enregistrer</button>
          </div>
        </div>

        {/* Champs groupés */}
        <div className="mt-4 flex flex-col gap-2">
          {RC_GROUPS.map((g) => {
            const fields = RC_FIELDS.filter((f) => f.group === g);
            if (fields.length === 0) return null;
            const open = openGroups[g] ?? false;
            return (
              <div key={g} className="rounded-xl border border-border">
                <button type="button" onClick={() => setOpenGroups((o) => ({ ...o, [g]: !open }))} className="flex w-full items-center justify-between px-3.5 py-2.5 text-left">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</span>
                  <ChevronDown className={cn("h-4 w-4 text-faint transition-transform", open && "rotate-180")} />
                </button>
                {open && <div className="flex flex-col gap-3 border-t border-border p-3.5">{fields.map((f) => renderField(f.key))}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Aperçu ── */}
      <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-7">
        <div className="border-b-2 border-[#b8933f] pb-3 text-center">
          <div className="text-lg font-extrabold tracking-wide text-foreground">TTP AGENCY</div>
          <div className="text-[11px] font-medium text-[#b8933f]">Talent Management &amp; Influence Commerciale</div>
        </div>
        <div className="mt-1 text-right text-[8px] font-semibold uppercase tracking-widest text-faint">Confidentiel</div>

        <h1 className="mt-4 text-center text-base font-semibold tracking-tight text-foreground">{built.title}</h1>
        {built.subtitle && <div className="mt-1 text-center text-xs font-semibold text-[#b8933f]">{built.subtitle}</div>}

        <div className="mt-4 self-center">
          <AnimatedBadge status="info" size="sm">Conforme RGPD · Loi 2023-451 · Droit FR</AnimatedBadge>
        </div>

        <div className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground">Préambule</div>
          {renderBody(built.preambule)}
        </div>

        <div className="mt-3 space-y-3">
          {built.articles.map((a, i) => (
            <div key={i}>
              <div className="text-[11px] font-bold text-foreground">{[a.number, a.title].filter(Boolean).join(" — ")}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{renderBody(a.body)}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 whitespace-pre-line border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">Signatures</div>
          {built.signatures}
        </div>

        {/* Actions */}
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" onClick={copy} className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copié ✓" : "Copier"}
          </button>
          <button type="button" onClick={() => setPreview(representationHTML(config))} className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Eye className="h-3.5 w-3.5" /> Aperçu
          </button>
          <button type="button" onClick={downloadPDF} className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90">
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={saveContract}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 py-3 text-[10px] font-semibold uppercase tracking-wide text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer le contrat"}
          </button>
          <button
            type="button"
            onClick={() => setShowHist(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" /> Historique{hist.length ? ` (${hist.length})` : ""}
          </button>
        </div>
      </div>

      {preview && (
        <Modal title="Aperçu du contrat" onClose={() => setPreview(null)} wide footer={
          <>
            <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
            <button type="button" className={cn(ghostBtn, "flex items-center gap-1.5")} onClick={() => {
              const w = window.open("", "_blank");
              if (w) { w.document.write(preview); w.document.close(); w.focus(); w.print(); } else toast("Autorise les pop-ups");
            }}>
              <FileText className="h-3.5 w-3.5" /> Imprimer / PDF
            </button>
          </>
        }>
          <iframe title="Contrat de représentation" srcDoc={preview} sandbox="" className="h-[64vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}

      {showHist && (
        <Modal
          title="Historique des contrats"
          onClose={() => setShowHist(false)}
          wide
          footer={<button type="button" className={ghostBtn} onClick={() => setShowHist(false)}>Fermer</button>}
        >
          {hist.length === 0 ? (
            <div className="py-8 text-center text-sm text-faint">
              Aucun contrat enregistré. Clique « Enregistrer le contrat » — il sera stocké ici et poussé sur le portail du créateur concerné.
            </div>
          ) : (
            <div className="space-y-2">
              {hist.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">{e.title}</div>
                    <div className="truncate text-[11px] text-faint">
                      {e.creator ? titleCase(e.creator) : "Externe"} · {new Date(e.createdAt).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <button type="button" onClick={() => setPreview(representationHTML(e.config))} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Eye className="h-3.5 w-3.5" /> Aperçu
                  </button>
                  <button type="button" onClick={() => loadContract(e)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    Modifier
                  </button>
                  <button type="button" onClick={() => shareContract(e)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    Partager
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDel({ message: `Supprimer « ${e.title} » ?${e.creator ? " (retiré aussi du portail du créateur)" : ""}`, run: () => deleteContract(e) })}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500"
                    title="Supprimer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
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

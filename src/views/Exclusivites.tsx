import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Pencil, Search, ShieldAlert } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { AddButton, InlineForm, TextField, TextAreaField, DeleteButton } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { CreatorPickerField } from "@/components/ui/creator-picker";
import { PageHeaderRow } from "@/components/ui/page-header";
import { PhoneMenu } from "@/components/ui/phone-bar";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { useAppState, type AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { fmtDay } from "@/lib/dates";
import { cn, titleCase } from "@/lib/utils";
import { openLater } from "@/lib/openLater";
import { pdfText } from "@/lib/pdfText";
import { freshExclusivites, saveExclusivites, todayParis, useExclusivites } from "@/lib/useExclusivites";
import {
  blockedCreators, daysLeft, excluState, fromAppContract, readContract, type Exclusivite, type ExcluState,
} from "../../supabase/functions/_shared/exclusivites.ts";
import { durationToMonths } from "@/lib/contractDuration";

/**
 * EXCLUSIVITÉS : qui est engagé en exclusivité avec quelle marque, jusqu'à quand, contre
 * quels concurrents, et les points clés de chaque collab. L'app s'en sert partout : un
 * créateur bloqué n'est jamais suggéré en premier (prospection, collab, brief, gifting) et
 * une alerte s'affiche au-dessus d'une réponse à une marque concurrente ; Claude le voit
 * aussi (connecteur). Sources : saisie, contrats faits dans l'app (Contrats → Marque ×
 * Créateur), ou contrat PDF lu par l'app (texte extrait dans le navigateur, règles fixes).
 * Stockage : blob agence `exclusivites` (src/lib/useExclusivites.ts).
 */

type Draft = { id: string | null; creator: string; brand: string; scope: string; competitors: string; start: string; end: string; points: string; source: Exclusivite["source"]; contractRef: string | null; docPath: string | null; quote: string };
const EMPTY_DRAFT: Draft = { id: null, creator: "", brand: "", scope: "", competitors: "", start: "", end: "", points: "", source: "manuel", contractRef: null, docPath: null, quote: "" };

type AppContract = { id: string; ts: number; ctType: string; ctName: string; brand: string; ref: string; status?: string; form?: { exclScope?: string; excl?: boolean; duration?: string; deliverables?: string; value?: string; rights?: string; rightsDuration?: string } };

const STATE_LABEL: Record<ExcluState, string> = { en_cours: "En cours", a_venir: "À venir", terminee: "Terminée" };
const uid = () => `ex${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const splitList = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export function Exclusivites() {
  const creators = useCreators();
  const { list: loaded, loading } = useExclusivites();
  const [local, setLocal] = useState<Exclusivite[] | null>(null);
  const list = local ?? loaded;
  const { data: contracts } = useAppState<AppContract[]>((s: AppState) => (Array.isArray(s["brandContractHistory"]) ? (s["brandContractHistory"] as AppContract[]) : []));
  const [brands, setBrands] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDel, setConfirmDel] = useState<Exclusivite | null>(null);
  const [reading, setReading] = useState(false);
  const [check, setCheck] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayParis();

  // Marques connues (collabs + contacts) : pour reconnaître la marque dans un contrat PDF.
  useEffect(() => {
    let alive = true;
    void Promise.all([supabase.from("collabs").select("brand"), supabase.from("contacts").select("brand")]).then(([a, b]) => {
      if (!alive) return;
      const all = [...((a.data as { brand: string | null }[] | null) ?? []), ...((b.data as { brand: string | null }[] | null) ?? [])].map((r) => (r.brand ?? "").trim()).filter(Boolean);
      setBrands([...new Set(all)]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const by: Record<ExcluState, Exclusivite[]> = { en_cours: [], a_venir: [], terminee: [] };
    for (const e of list) by[excluState(e, today)].push(e);
    by.en_cours.sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999"));
    by.a_venir.sort((a, b) => a.start.localeCompare(b.start));
    by.terminee.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
    return by;
  }, [list, today]);

  // Contrats faits dans l'app avec une exclusivité, pas encore suivis.
  const fromContracts = useMemo(() => {
    const tracked = new Set(list.map((e) => e.contractRef).filter(Boolean));
    return (contracts ?? [])
      .filter((c) => c.ctType !== "repr" && c.ref && !tracked.has(c.ref) && c.status !== "changes")
      .map((c) => ({ c, d: fromAppContract(c, durationToMonths(c.form?.duration ?? "")) }))
      .filter((x): x is { c: AppContract; d: NonNullable<typeof x.d> } => !!x.d && excluState(x.d, today) !== "terminee");
  }, [contracts, list, today]);

  const checkResult = useMemo(() => (check.trim() ? blockedCreators(list, check, today, [], (d) => fmtDay(d)) : null), [check, list, today]);

  const persist = async (upsert: Exclusivite[], remove: string[] = []) => {
    const ok = await saveExclusivites(upsert, remove);
    if (!ok) {
      toast("Erreur, réessaie");
      return false;
    }
    const fresh = await freshExclusivites().catch(() => null);
    setLocal(fresh ?? [...upsert, ...list.filter((e) => !remove.includes(e.id) && !upsert.some((u) => u.id === e.id))]);
    return true;
  };

  const openNew = (d: Partial<Draft> = {}) => {
    setDraft({ ...EMPTY_DRAFT, start: today, ...d });
    setFormOpen(true);
  };
  const openEdit = (e: Exclusivite) => {
    setDraft({
      id: e.id, creator: e.creator, brand: e.brand, scope: e.scope, competitors: e.competitors.join(", "), start: e.start, end: e.end ?? "",
      points: e.points.join("\n"), source: e.source, contractRef: e.contractRef ?? null, docPath: e.docPath ?? null, quote: "",
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!draft.creator.trim() || !draft.brand.trim()) return toast("Renseigne le créateur et la marque");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.start)) return toast("Date de début manquante");
    if (draft.end && draft.end < draft.start) return toast("La fin est avant le début");
    const prev = list.find((e) => e.id === draft.id);
    const row: Exclusivite = {
      id: draft.id ?? uid(), creator: draft.creator.trim(), brand: draft.brand.trim(), scope: draft.scope.trim(),
      competitors: splitList(draft.competitors), start: draft.start, end: draft.end || null, points: draft.points.split("\n").map((p) => p.trim()).filter(Boolean),
      source: draft.source, contractRef: draft.contractRef, docPath: draft.docPath, collabId: prev?.collabId ?? null, createdAt: prev?.createdAt ?? Date.now(),
    };
    if (await persist([row])) {
      toast(prev ? "Exclusivité enregistrée ✓" : "Exclusivité suivie ✓");
      setFormOpen(false);
    }
  };

  const follow = async (c: AppContract, d: Omit<Exclusivite, "id" | "createdAt">) => {
    if (await persist([{ ...d, id: uid(), createdAt: Date.now() }])) toast(`Exclusivité ${c.brand} suivie ✓`);
  };

  // « Lire un contrat » : texte du PDF (navigateur), lecture par règles, fiche pré-remplie à vérifier.
  const onPdf = async (files: FileList | null) => {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return toast("Choisis un fichier PDF");
    if (file.size > 20 * 1024 * 1024) return toast("PDF trop lourd (max 20 Mo)");
    setReading(true);
    try {
      const text = await pdfText(file);
      if (text.replace(/\s/g, "").length < 200) {
        toast("Ce PDF n'a pas de texte lisible (scan) : remplis la fiche à la main");
        openNew({ source: "pdf", contractRef: file.name });
        return;
      }
      const r = readContract(text, { creators: creators.map((c) => c.name), brands }, today);
      const slug = (r.brand || "contrat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contrat";
      const path = `contrats/${slug}-${Date.now()}.pdf`;
      const up = await supabase.storage.from("documents").upload(path, file, { contentType: "application/pdf", upsert: false });
      openNew({
        creator: r.creator ?? "", brand: r.brand ?? "", source: "pdf", contractRef: file.name, docPath: up.error ? null : path,
        scope: r.exclusivity?.scope ?? "", competitors: (r.exclusivity?.competitors ?? []).join(", "),
        start: r.exclusivity?.start ?? today, end: r.exclusivity?.end ?? "", points: r.points.join("\n"),
        quote: r.exclusivity?.quote ?? "",
      });
      toast(r.exclusivity ? "Contrat lu : vérifie la fiche puis enregistre" : "Aucune clause d'exclusivité trouvée : vérifie le contrat");
    } catch {
      toast("Lecture du PDF impossible, réessaie");
    } finally {
      setReading(false);
    }
  };

  const openPdf = (path: string) => {
    void openLater(async () => {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
      return error || !data?.signedUrl ? null : data.signedUrl;
    }).then((ok) => !ok && toast("Lien indisponible, réessaie"));
  };

  const del = async (e: Exclusivite) => {
    setConfirmDel(null);
    if (await persist([], [e.id])) toast("Exclusivité retirée");
  };

  const card = (e: Exclusivite) => {
    const st = excluState(e, today);
    const left = daysLeft(e, today);
    return (
      <div key={e.id} className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5", st === "terminee" && "opacity-70")}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-foreground">{titleCase(e.creator)} × {e.brand}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", st === "en_cours" ? "bg-wait-soft text-wait" : "bg-field text-muted-foreground")}>
                {STATE_LABEL[st]}{st === "en_cours" && left !== null ? ` · ${left} j` : ""}
              </span>
            </div>
            <div className="mt-1 text-[12.5px] text-muted-foreground">
              {fmtDay(e.start)} → {e.end ? fmtDay(e.end) : "sans fin connue"}{e.scope ? ` · ${e.scope}` : ""}
            </div>
          </div>
          <button type="button" onClick={() => openEdit(e)} title="Modifier" aria-label="Modifier" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <Pencil className="h-4 w-4" />
          </button>
          <DeleteButton onClick={() => setConfirmDel(e)} />
        </div>
        {e.competitors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {e.competitors.map((c) => <span key={c} className="rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-foreground">{c}</span>)}
          </div>
        )}
        {e.points.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-[14px] bg-panel px-3.5 py-2.5 text-[13px] text-muted-foreground">
            {e.points.map((p, i) => <li key={i} className="leading-snug">{p}</li>)}
          </ul>
        )}
        {e.docPath && (
          <button type="button" onClick={() => openPdf(e.docPath as string)} className="flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" /> Voir le contrat
          </button>
        )}
      </div>
    );
  };

  const section = (title: string, items: Exclusivite[]) =>
    items.length > 0 && (
      <section className="flex flex-col gap-2.5">
        <h3 className="px-1 text-[13px] font-semibold text-muted-foreground">{title} · {items.length}</h3>
        {items.map(card)}
      </section>
    );

  return (
    <div className="space-y-5">
      <PageHeaderRow>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-faint" />
          <span className="font-semibold text-foreground">{groups.en_cours.length}</span>
          <span>en cours</span>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(ev) => void onPdf(ev.target.files)} />
          <PhoneMenu items={[{ key: "pdf", label: reading ? "Lecture…" : "Lire un contrat", icon: FileText, onClick: () => fileRef.current?.click() }]} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="ios-phone-hide flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
          >
            {reading ? <Spin size={14} /> : <FileText className="h-3.5 w-3.5" />} <span>{reading ? "Lecture…" : "Lire un contrat"}</span>
          </button>
          <AddButton label="Exclusivité" onClick={() => openNew()} />
        </div>
      </PageHeaderRow>

      {/* Vérifier une marque avant de proposer un créateur */}
      <label className="flex items-center gap-2 rounded-[16px] bg-surface px-4 py-1.5 ring-1 ring-transparent focus-within:ring-primary/40">
        <Search className="h-4 w-4 shrink-0 text-faint" />
        <input
          value={check}
          onChange={(ev) => setCheck(ev.target.value)}
          placeholder="Vérifier une marque"
          aria-label="Marque à vérifier"
          className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-faint sm:text-[14px]"
        />
      </label>
      {checkResult && (
        <div className={cn("rounded-[16px] px-4 py-3 text-[13px]", checkResult.size ? "bg-wait-soft text-wait" : "bg-panel text-muted-foreground")}>
          {checkResult.size
            ? [...checkResult].map(([n, why]) => `${titleCase(n)} (${why})`).join(", ")
            : `Aucun créateur en exclusivité contre ${check.trim()}.`}
        </div>
      )}

      <InlineForm open={formOpen} title={draft.id ? "Modifier l'exclusivité" : "Nouvelle exclusivité"} onClose={() => setFormOpen(false)} onSubmit={submit} submitLabel={draft.id ? "Enregistrer" : "Suivre"}>
        {draft.quote && (
          <p className="rounded-[14px] bg-panel px-3.5 py-2.5 text-[12.5px] leading-snug text-muted-foreground sm:basis-full">
            Lu dans le contrat : « {draft.quote} »
          </p>
        )}
        <CreatorPickerField label="Créateur" value={draft.creator} onChange={(v) => setDraft({ ...draft, creator: v })} creators={creators} className="sm:min-w-[180px]" />
        <TextField label="Marque" value={draft.brand} onChange={(v) => setDraft({ ...draft, brand: v })} />
        <TextField label="Secteur interdit" value={draft.scope} onChange={(v) => setDraft({ ...draft, scope: v })} placeholder="ex. vêtements de sport" />
        <TextField label="Concurrents" value={draft.competitors} onChange={(v) => setDraft({ ...draft, competitors: v })} placeholder="ex. Adidas, Puma" />
        <TextField label="Début" type="date" value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
        <TextField label="Fin" type="date" value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
        <TextAreaField label="Points clés (un par ligne)" value={draft.points} onChange={(v) => setDraft({ ...draft, points: v })} rows={4} placeholder="ex. Droits d'usage : 6 mois, réseaux de la marque" />
      </InlineForm>

      {fromContracts.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="px-1 text-[13px] font-semibold text-muted-foreground">Dans tes contrats · {fromContracts.length}</h3>
          {fromContracts.map(({ c, d }) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border bg-surface px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-foreground">{titleCase(c.ctName)} × {c.brand}</div>
                <div className="text-[12px] text-muted-foreground">{d.scope} · {fmtDay(d.start)} → {d.end ? fmtDay(d.end) : "durée du contrat"}</div>
              </div>
              <button type="button" onClick={() => void follow(c, d)} className="h-10 shrink-0 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                Suivre
              </button>
            </div>
          ))}
        </section>
      )}

      {loading && !list.length ? (
        <div className="flex justify-center py-10"><Spin size={18} /></div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">Aucune exclusivité suivie.</div>
      ) : (
        <>
          {section("En cours", groups.en_cours)}
          {section("À venir", groups.a_venir)}
          {groups.terminee.length > 0 && (
            <button type="button" onClick={() => setShowEnded((v) => !v)} className="px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              {showEnded ? "Masquer les terminées" : `Terminées · ${groups.terminee.length}`}
            </button>
          )}
          {showEnded && section("Terminées", groups.terminee)}
        </>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Retirer cette exclusivité ?"
          message={`${titleCase(confirmDel.creator)} × ${confirmDel.brand} ne sera plus vérifiée.`}
          confirmLabel="Retirer"
          danger
          onConfirm={() => void del(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

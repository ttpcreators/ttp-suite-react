import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Target, GripVertical, CalendarRange, AlertTriangle, MessageSquare } from "lucide-react";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { cn } from "@/lib/utils";
import {
  norm, normProfile, emptyProfile, PROFILES_KEY, CADENCE_FIELDS, cadenceTotal,
  PLATFORMS_PRIO, platPrioLabel, MONTHLY_KEY, emptyMonth, monthLabel, currentMonth,
  JOURNAL_KEY, EXCHANGE_META,
  type EditorialProfile, type PlatPrio, type Cadence, type MonthEntry, type JournalEntry, type ExchangeType,
} from "@/lib/creatorTracking";

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";
const LBL = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint";

/**
 * Fiche ÉDITORIALE d'un créateur (piliers, tonalité, objectifs 90 j, plateformes
 * prioritaires, CADENCE RECOMMANDÉE, date d'entrée, conformité). Composant autonome :
 * lit/écrit son propre blob agence `creatorProfiles`, clé = nom en minuscules.
 */
export function EditorialProfileCard({ name }: { name: string }) {
  const key = norm(name);
  const { data, loading } = useAppState<Record<string, EditorialProfile>>(
    (s: AppState) => (s[PROFILES_KEY] as Record<string, EditorialProfile>) ?? {},
  );
  const [p, setP] = useState<EditorialProfile | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Copie locale initialisée UNE fois par créateur (ne pas écraser une édition en cours
  // à chaque tick de rafraîchissement). Se ré-initialise quand on change de créateur.
  useEffect(() => {
    if (!loading && loadedKey !== key) {
      setP(normProfile(data?.[key]));
      setLoadedKey(key);
    }
  }, [loading, data, key, loadedKey]);

  const cur = p ?? emptyProfile();
  const set = (patch: Partial<EditorialProfile>) => setP({ ...cur, ...patch });
  const setCad = (k: keyof Cadence, v: number) => set({ cadenceReco: { ...cur.cadenceReco, [k]: Math.max(0, v || 0) } });
  const togglePlat = (pl: PlatPrio) => set({ plateformes: cur.plateformes.includes(pl) ? cur.plateformes.filter((x) => x !== pl) : [...cur.plateformes, pl] });

  const save = async () => {
    if (saving || loadedKey !== key) return;
    setSaving(true);
    // Relit FRAIS avant de fusionner : ne jamais réécrire la map complète depuis un
    // état local (sinon on efface les fiches des autres créateurs). Écriture atomique.
    invalidateAppState();
    const fresh = ((await getAppState())[PROFILES_KEY] as Record<string, EditorialProfile>) ?? {};
    const ok = await saveAppStateKey(PROFILES_KEY, { ...fresh, [key]: cur });
    setSaving(false);
    toast(ok ? "Fiche éditoriale enregistrée ✓" : "Erreur — réessaie");
  };

  const recoTotal = cadenceTotal(cur.cadenceReco);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="h-4 w-4 text-muted-foreground" /> Fiche éditoriale
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || loadedKey !== key}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Piliers */}
        <div>
          <label className={LBL}>Piliers de contenu</label>
          <div className="flex flex-col gap-2">
            {cur.piliers.map((pil, i) => (
              <div key={i} className="flex items-center gap-2">
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-faint" />
                <input
                  value={pil}
                  onChange={(e) => set({ piliers: cur.piliers.map((x, j) => (j === i ? e.target.value : x)) })}
                  placeholder={`Pilier ${i + 1} (ex : routine sport, coulisses…)`}
                  className={IN}
                />
                <button type="button" onClick={() => set({ piliers: cur.piliers.filter((_, j) => j !== i) })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => set({ piliers: [...cur.piliers, ""] })} className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Ajouter un pilier
          </button>
        </div>

        {/* Positionnement + tonalité + plateformes + date */}
        <div className="flex flex-col gap-3">
          <div>
            <label className={LBL}>Niche & positionnement</label>
            <input value={cur.positionnement} onChange={(e) => set({ positionnement: e.target.value })} placeholder="Ex : Fitness premium, esthétique épurée" className={IN} />
          </div>
          <div>
            <label className={LBL}>Tonalité / ton de voix</label>
            <input value={cur.tonalite} onChange={(e) => set({ tonalite: e.target.value })} placeholder="Ex : Bienveillant, direct, expert accessible" className={IN} />
          </div>
          <div>
            <label className={LBL}>Plateformes prioritaires</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS_PRIO.map((pl) => {
                const on = cur.plateformes.includes(pl);
                return (
                  <button key={pl} type="button" onClick={() => togglePlat(pl)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors", on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-rowhover")}>
                    <PlatformIcon platform={pl} className="h-3.5 w-3.5" /> {platPrioLabel[pl]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className={LBL}>Date d'entrée dans l'agence</label>
            <input type="date" value={cur.dateEntree} onChange={(e) => set({ dateEntree: e.target.value })} className={IN} />
          </div>
        </div>
      </div>

      {/* Objectifs 90 jours */}
      <div className="mt-4">
        <label className={LBL}>Objectifs 90 jours</label>
        <textarea value={cur.objectifs90} onChange={(e) => set({ objectifs90: e.target.value })} rows={3} placeholder="Ex : Passer de 45K à 60K abonnés, stabiliser 3 %+ d'engagement, lancer une série signature…" className={IN + " resize-y leading-relaxed"} />
      </div>

      {/* Cadence recommandée (cible mesurable) */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <label className={LBL + " mb-0"}>Cadence recommandée / mois</label>
          <span className="text-[11px] text-faint">{recoTotal} contenus/mois</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CADENCE_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{f.label}</span>
              <input type="number" min={0} value={cur.cadenceReco[f.key]} onChange={(e) => setCad(f.key, parseInt(e.target.value, 10) || 0)} className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-center text-sm tabular-nums outline-none focus:border-primary" />
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Sert de référence : le suivi mensuel compare le réel à cette cadence (et déclenche l'alerte sous-performance).</p>
      </div>

      {/* Conformité */}
      <div className="mt-4">
        <label className={LBL}>Conformité (loi 2023-451)</label>
        <input value={cur.conformite} onChange={(e) => set({ conformite: e.target.value })} placeholder="Ex : OK / à vérifier — mentions « Publicité » systématiques ?" className={IN} />
        <p className="mt-1.5 text-[11px] text-faint">Écris « OK » quand c'est à jour ; tout autre texte lève une alerte de conformité.</p>
      </div>
    </section>
  );
}

/**
 * SUIVI MENSUEL : un enregistrement par mois — cadence RÉELLE publiée comparée à la
 * cadence recommandée (fiche éditoriale), ER Insta/TikTok, vues moyennes, faits
 * marquants, dérive éditoriale. Blob agence `creatorMonthly`, clé = nom.
 */
export function MonthlyTracking({ name }: { name: string }) {
  const key = norm(name);
  const { data: monthlyMap, loading } = useAppState<Record<string, MonthEntry[]>>((s: AppState) => (s[MONTHLY_KEY] as Record<string, MonthEntry[]>) ?? {});
  const { data: profileMap } = useAppState<Record<string, EditorialProfile>>((s: AppState) => (s[PROFILES_KEY] as Record<string, EditorialProfile>) ?? {});
  const reco = normProfile(profileMap?.[key]).cadenceReco;

  const [local, setLocal] = useState<MonthEntry[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!loading && loadedKey !== key) {
      setLocal((monthlyMap?.[key] ?? []).map((m) => ({ ...emptyMonth(m.month), ...m })));
      setLoadedKey(key);
    }
  }, [loading, monthlyMap, key, loadedKey]);

  const list = local ?? [];
  const sorted = [...list].sort((a, b) => b.month.localeCompare(a.month)); // récent d'abord
  const editMonth = (month: string, patch: Partial<MonthEntry>) => setLocal((l) => (l ?? []).map((m) => (m.month === month ? { ...m, ...patch } : m)));
  const editCad = (month: string, k: keyof Cadence, v: number) => setLocal((l) => (l ?? []).map((m) => (m.month === month ? { ...m, cadence: { ...m.cadence, [k]: Math.max(0, v || 0) } } : m)));
  const addMonth = () => {
    const m = currentMonth();
    if (list.some((x) => x.month === m)) return toast("Le mois en cours existe déjà");
    setLocal((l) => [emptyMonth(m), ...(l ?? [])]);
  };

  const save = async () => {
    if (saving || loadedKey !== key) return;
    setSaving(true);
    invalidateAppState();
    const fresh = ((await getAppState())[MONTHLY_KEY] as Record<string, MonthEntry[]>) ?? {};
    const ok = await saveAppStateKey(MONTHLY_KEY, { ...fresh, [key]: list });
    setSaving(false);
    toast(ok ? "Suivi mensuel enregistré ✓" : "Erreur — réessaie");
  };

  const recoTotal = cadenceTotal(reco);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarRange className="h-4 w-4 text-muted-foreground" /> Suivi mensuel
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={addMonth} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Ajouter le mois
          </button>
          <button type="button" onClick={save} disabled={saving || loading || loadedKey !== key} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucun mois suivi. « Ajouter le mois » crée l'enregistrement du mois en cours.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((m) => {
            const realTotal = cadenceTotal(m.cadence);
            const ratio = recoTotal > 0 ? realTotal / recoTotal : 1;
            const badge = recoTotal === 0 ? "bg-panel text-faint" : ratio >= 1 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : ratio >= 0.7 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400";
            return (
              <div key={m.month} className="rounded-xl border border-border bg-panel/40 p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{monthLabel(m.month)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums", badge)}>
                      {realTotal}{recoTotal > 0 ? ` / ${recoTotal}` : ""} contenus
                    </span>
                    {m.derive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" /> Dérive
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => setLocal((l) => (l ?? []).filter((x) => x.month !== m.month))} className="grid h-7 w-7 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Cadence réelle vs recommandée */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {CADENCE_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1">
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">
                        {f.short} <span className="text-faint/70">/ {reco[f.key]}</span>
                      </span>
                      <input type="number" min={0} value={m.cadence[f.key]} onChange={(e) => editCad(m.month, f.key, parseInt(e.target.value, 10) || 0)} className={cn("w-full rounded-lg border bg-surface px-2 py-1.5 text-center text-sm tabular-nums outline-none focus:border-primary", reco[f.key] > 0 && m.cadence[f.key] < reco[f.key] ? "border-amber-400/50" : "border-border")} />
                    </label>
                  ))}
                </div>

                {/* ER + vues */}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Field label="ER Instagram"><input value={m.erInsta} onChange={(e) => editMonth(m.month, { erInsta: e.target.value })} placeholder="3,5 %" className={IN} /></Field>
                  <Field label="ER TikTok"><input value={m.erTiktok} onChange={(e) => editMonth(m.month, { erTiktok: e.target.value })} placeholder="6 %" className={IN} /></Field>
                  <Field label="Vues moyennes"><input value={m.vuesMoy} onChange={(e) => editMonth(m.month, { vuesMoy: e.target.value })} placeholder="45 K" className={IN} /></Field>
                </div>

                {/* Faits marquants */}
                <div className="mt-2">
                  <label className={LBL}>Faits marquants du mois</label>
                  <textarea value={m.faits} onChange={(e) => editMonth(m.month, { faits: e.target.value })} rows={2} placeholder="Ex : Reel viral 300K, collab Sephora signée, baisse de régularité mi-mois…" className={IN + " resize-y leading-relaxed"} />
                </div>

                {/* Dérive éditoriale */}
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                  <button type="button" onClick={() => editMonth(m.month, { derive: !m.derive })} className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors", m.derive ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border border-border text-muted-foreground hover:bg-rowhover")}>
                    <span className={cn("grid h-4 w-4 place-items-center rounded", m.derive ? "bg-amber-500 text-white" : "border border-border")}>{m.derive && "!"}</span>
                    Dérive éditoriale
                  </button>
                  {m.derive && (
                    <input value={m.deriveNote} onChange={(e) => editMonth(m.month, { deriveNote: e.target.value })} placeholder="Décris l'écart à la ligne éditoriale…" className={IN} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LBL + " mb-0"}>{label}</span>
      {children}
    </label>
  );
}

let _jid = 0;
const jid = () => `j${Date.now().toString(36)}${(_jid += 1)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * JOURNAL D'ACCOMPAGNEMENT : timeline chronologique des échanges (appel/message/
 * réunion), décisions, actions à suivre et prochain point. Blob agence `creatorJournal`.
 */
export function JournalCard({ name }: { name: string }) {
  const key = norm(name);
  const { data: map, loading } = useAppState<Record<string, JournalEntry[]>>((s: AppState) => (s[JOURNAL_KEY] as Record<string, JournalEntry[]>) ?? {});
  const [local, setLocal] = useState<JournalEntry[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!loading && loadedKey !== key) {
      setLocal((map?.[key] ?? []).slice());
      setLoadedKey(key);
    }
  }, [loading, map, key, loadedKey]);

  const list = local ?? [];
  const sorted = [...list].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const edit = (id: string, patch: Partial<JournalEntry>) => setLocal((l) => (l ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => setLocal((l) => [{ id: jid(), date: todayISO(), type: "appel", resume: "", decisions: "", actions: "", prochainPoint: "" }, ...(l ?? [])]);

  const save = async () => {
    if (saving || loadedKey !== key) return;
    setSaving(true);
    invalidateAppState();
    const fresh = ((await getAppState())[JOURNAL_KEY] as Record<string, JournalEntry[]>) ?? {};
    const ok = await saveAppStateKey(JOURNAL_KEY, { ...fresh, [key]: list });
    setSaving(false);
    toast(ok ? "Journal enregistré ✓" : "Erreur — réessaie");
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquare className="h-4 w-4 text-muted-foreground" /> Journal d'accompagnement
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={add} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Échange
          </button>
          <button type="button" onClick={save} disabled={saving || loading || loadedKey !== key} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucun échange noté. « Échange » ajoute un point (appel, message, réunion).
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((e) => (
            <div key={e.id} className="relative rounded-xl border border-border bg-panel/40 p-3.5 pl-4">
              <span className="absolute left-0 top-3.5 h-[calc(100%-1.75rem)] w-[3px] rounded-full bg-primary/40" />
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input type="date" value={e.date} onChange={(ev) => edit(e.id, { date: ev.target.value })} className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-primary" />
                <select value={e.type} onChange={(ev) => edit(e.id, { type: ev.target.value as ExchangeType })} className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] font-semibold outline-none focus:border-primary">
                  {(Object.keys(EXCHANGE_META) as ExchangeType[]).map((t) => <option key={t} value={t}>{EXCHANGE_META[t].label}</option>)}
                </select>
                <div className="flex-1" />
                <button type="button" onClick={() => setLocal((l) => (l ?? []).filter((x) => x.id !== e.id))} className="grid h-7 w-7 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Field label="Résumé de l'échange"><textarea value={e.resume} onChange={(ev) => edit(e.id, { resume: ev.target.value })} rows={2} placeholder="Ce qui s'est dit…" className={IN + " resize-y"} /></Field>
                <Field label="Décisions prises"><textarea value={e.decisions} onChange={(ev) => edit(e.id, { decisions: ev.target.value })} rows={2} placeholder="Ce qui a été décidé…" className={IN + " resize-y"} /></Field>
                <Field label="Actions à suivre"><textarea value={e.actions} onChange={(ev) => edit(e.id, { actions: ev.target.value })} rows={2} placeholder="Qui fait quoi…" className={IN + " resize-y"} /></Field>
                <Field label="Prochain point prévu"><input type="date" value={e.prochainPoint} onChange={(ev) => edit(e.id, { prochainPoint: ev.target.value })} className={IN} /></Field>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

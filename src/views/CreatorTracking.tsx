import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Target, GripVertical, CalendarRange, AlertTriangle, MessageSquare, Pencil, X, Phone, MessageCircle, Users, Compass, Mic, Sparkles, Film, GalleryHorizontalEnd, CircleDashed, Music2, MonitorPlay, Check, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { cn, titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import {
  norm, normProfile, emptyProfile, PROFILES_KEY, CADENCE_FIELDS, cadenceTotal, emptyCadence,
  PLATFORMS_PRIO, platPrioLabel, MONTHLY_KEY, emptyMonth, monthLabel, currentMonth,
  JOURNAL_KEY, EXCHANGE_META, computeAlerts, trajectoryOf, TRAJECTORY_META,
  contractDaysLeft, lastMonthOf, lastContact, nextPoint,
  ROADMAP_TABLE, roadmapFrom, normRoadmap, normSelfCadence,
  type EditorialProfile, type PlatPrio, type Cadence, type MonthEntry, type JournalEntry, type ExchangeType, type SelfCadence,
} from "@/lib/creatorTracking";

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";
const LBL = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint";

type Mode = "view" | "edit";

/** Un profil est-il vide (→ ouvrir directement en édition) ? */
function profileIsEmpty(p: EditorialProfile): boolean {
  return p.piliers.filter(Boolean).length === 0 && !p.positionnement && !p.tonalite && !p.objectifs90 && p.plateformes.length === 0 && cadenceTotal(p.cadenceReco) === 0 && !p.conformite && !p.dateEntree;
}
const frDMY = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const EXCHANGE_ICON: Record<ExchangeType, typeof Phone> = { appel: Phone, message: MessageCircle, reunion: Users };

/** Bouton « Modifier » (passe une carte en édition) — homogène sur les 3 cartes. */
function EditBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
      <Pencil className="h-3.5 w-3.5" /> Modifier
    </button>
  );
}
/** Bloc lecture « label + valeur » (rien si vide). */
function ReadBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={LBL}>{label}</div>
      <div className="text-[13px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}
/** Tuiles de cadence (réel + éventuel /reco), lecture seule. */
function CadenceTiles({ cadence, reco }: { cadence: Cadence; reco?: Cadence }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {CADENCE_FIELDS.map((f) => {
        const r = reco?.[f.key] ?? 0;
        const below = r > 0 && cadence[f.key] < r;
        return (
          <div key={f.key} className={cn("rounded-xl border bg-panel/50 px-2.5 py-2.5 text-center", below ? "border-amber-400/50" : "border-border")}>
            <div className={cn("text-lg font-bold tabular-nums", below ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
              {cadence[f.key]}{r > 0 && <span className="text-[11px] font-medium text-faint"> / {r}</span>}
            </div>
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">{f.short}</div>
          </div>
        );
      })}
    </div>
  );
}

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
  const [mode, setMode] = useState<Mode>("view");
  const [step, setStep] = useState(0); // étape du wizard d'édition
  const enterEdit = () => { setStep(0); setMode("edit"); };

  // Copie locale initialisée UNE fois par créateur (ne pas écraser une édition en cours
  // à chaque tick de rafraîchissement). Se ré-initialise quand on change de créateur.
  // Ouvre en LECTURE si la fiche a du contenu, sinon directement en édition.
  useEffect(() => {
    if (!loading && loadedKey !== key) {
      const np = normProfile(data?.[key]);
      setP(np);
      setLoadedKey(key);
      setMode(profileIsEmpty(np) ? "edit" : "view");
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
    // Miroir best-effort : recopie le partageable dans la table lue par le créateur.
    // `creator` = nom EXACT (= my_creator()), pas normalisé. N'écrase pas self_cadence
    // (upsert ne touche que les colonnes fournies). Une erreur ici (ex : SQL pas encore
    // lancé) ne bloque pas l'agence — le blob reste la source de vérité.
    if (ok) {
      const { error } = await supabase.from(ROADMAP_TABLE).upsert({ creator: name, roadmap: roadmapFrom(cur) }, { onConflict: "creator" });
      setSaving(false);
      setMode("view");
      toast(error ? "Fiche enregistrée ✓ (partage créateur indispo — SQL creator-roadmap ?)" : "Fiche éditoriale enregistrée ✓");
      return;
    }
    setSaving(false);
    toast("Erreur — réessaie");
  };
  // Annuler l'édition : recharge la copie depuis le blob et repasse en lecture.
  const cancel = () => { setP(normProfile(data?.[key])); setMode("view"); };

  const recoTotal = cadenceTotal(cur.cadenceReco);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="h-4 w-4 text-muted-foreground" /> Fiche éditoriale
        </div>
        {mode === "view" ? (
          <EditBtn onClick={enterEdit} />
        ) : (
          <button type="button" onClick={cancel} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover">
            <X className="h-3.5 w-3.5" /> Annuler
          </button>
        )}
      </div>

      {/* ─────────── LECTURE ─────────── */}
      {mode === "view" && (
        profileIsEmpty(cur) ? (
          <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
            Fiche éditoriale vide. <button type="button" onClick={enterEdit} className="font-semibold text-primary underline-offset-2 hover:underline">La remplir</button> pour cadrer la ligne du créateur.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {cur.piliers.filter(Boolean).length > 0 && (
                <ReadBlock label="Piliers de contenu">
                  <div className="flex flex-wrap gap-1.5">
                    {cur.piliers.filter(Boolean).map((p2, i) => <span key={i} className="rounded-lg bg-panel px-2.5 py-1 text-[12px] font-medium text-foreground">{p2}</span>)}
                  </div>
                </ReadBlock>
              )}
              {cur.plateformes.length > 0 && (
                <ReadBlock label="Plateformes prioritaires">
                  <div className="flex flex-wrap gap-1.5">
                    {cur.plateformes.map((pl) => (
                      <span key={pl} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] font-semibold text-foreground">
                        <PlatformIcon platform={pl} className="h-3.5 w-3.5" /> {platPrioLabel[pl]}
                      </span>
                    ))}
                  </div>
                </ReadBlock>
              )}
              {cur.positionnement && <ReadBlock label="Niche & positionnement">{cur.positionnement}</ReadBlock>}
              {cur.tonalite && <ReadBlock label="Ton de voix">{cur.tonalite}</ReadBlock>}
            </div>
            {cur.objectifs90 && (
              <ReadBlock label="Objectifs 90 jours">
                <p className="whitespace-pre-wrap rounded-xl bg-panel/50 px-3.5 py-3 leading-relaxed">{cur.objectifs90}</p>
              </ReadBlock>
            )}
            {recoTotal > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className={LBL + " mb-0"}>Cadence recommandée / mois</span>
                  <span className="text-[11px] text-faint">{recoTotal} contenus/mois</span>
                </div>
                <CadenceTiles cadence={cur.cadenceReco} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3">
              {cur.dateEntree && <ReadBlock label="Entrée agence">{frDMY(cur.dateEntree)}</ReadBlock>}
              {cur.conformite && (
                <ReadBlock label="Conformité (loi 2023-451)">
                  {(() => { const ok = ["ok", "conforme", "à jour", "a jour"].includes(norm(cur.conformite)); return (
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>
                      {ok ? "✓ " : <AlertTriangle className="h-3 w-3" />} {cur.conformite}
                    </span>
                  ); })()}
                </ReadBlock>
              )}
            </div>
          </div>
        )
      )}

      {/* ─────────── ÉDITION (wizard multi-étapes) ─────────── */}
      {mode === "edit" && (() => {
        const STEPS = ["Positionnement", "Piliers", "Plateformes", "Objectifs", "Agence"];
        const lastStep = STEPS.length - 1;
        const s = Math.min(step, lastStep);
        return (
          <div>
            {/* Indicateur de progression */}
            <div className="mb-5">
              <div className="mb-2 flex justify-between">
                {STEPS.map((title, i) => (
                  <button key={i} type="button" onClick={() => { if (i <= s) setStep(i); }} className="flex flex-1 flex-col items-center gap-1.5" aria-label={title}>
                    <span className={cn("h-3.5 w-3.5 rounded-full transition-colors", i < s ? "bg-primary" : i === s ? "bg-primary ring-4 ring-primary/20" : "bg-muted")} />
                    <span className={cn("hidden text-[10px] font-medium sm:block", i === s ? "text-primary" : "text-faint")}>{title}</span>
                  </button>
                ))}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(s / lastStep) * 100}%` }} />
              </div>
            </div>

            {/* Contenu de l'étape */}
            <div className="min-h-[190px]">
              {s === 0 && (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className={LBL}>Niche & positionnement</label>
                    <input value={cur.positionnement} onChange={(e) => set({ positionnement: e.target.value })} placeholder="Ex : Fitness premium, esthétique épurée" className={IN} />
                  </div>
                  <div>
                    <label className={LBL}>Tonalité / ton de voix</label>
                    <input value={cur.tonalite} onChange={(e) => set({ tonalite: e.target.value })} placeholder="Ex : Bienveillant, direct, expert accessible" className={IN} />
                  </div>
                </div>
              )}

              {s === 1 && (
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
              )}

              {s === 2 && (
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
              )}

              {s === 3 && (
                <div className="flex flex-col gap-4">
                  <div>
                    <label className={LBL}>Objectifs 90 jours</label>
                    <textarea value={cur.objectifs90} onChange={(e) => set({ objectifs90: e.target.value })} rows={3} placeholder="Ex : Passer de 45K à 60K abonnés, stabiliser 3 %+ d'engagement, lancer une série signature…" className={IN + " resize-y leading-relaxed"} />
                  </div>
                  <div>
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
                </div>
              )}

              {s === 4 && (
                <div className="flex flex-col gap-4">
                  <div>
                    <label className={LBL}>Date d'entrée dans l'agence</label>
                    <input type="date" value={cur.dateEntree} onChange={(e) => set({ dateEntree: e.target.value })} className={IN} />
                  </div>
                  <div>
                    <label className={LBL}>Conformité (loi 2023-451)</label>
                    <input value={cur.conformite} onChange={(e) => set({ conformite: e.target.value })} placeholder="Ex : OK / à vérifier — mentions « Publicité » systématiques ?" className={IN} />
                    <p className="mt-1.5 text-[11px] text-faint">Écris « OK » quand c'est à jour ; tout autre texte lève une alerte de conformité.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation du wizard */}
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
              <button type="button" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={s === 0} className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover disabled:pointer-events-none disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" /> Précédent
              </button>
              <span className="text-[11px] text-faint">Étape {s + 1} / {STEPS.length}</span>
              {s < lastStep ? (
                <button type="button" onClick={() => setStep((x) => Math.min(lastStep, x + 1))} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                  Suivant <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" onClick={save} disabled={saving || loading || loadedKey !== key} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Check className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              )}
            </div>
          </div>
        );
      })()}
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
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    if (!loading && loadedKey !== key) {
      const arr = (monthlyMap?.[key] ?? []).map((m) => ({ ...emptyMonth(m.month), ...m }));
      setLocal(arr);
      setLoadedKey(key);
      setMode(arr.length === 0 ? "edit" : "view");
    }
  }, [loading, monthlyMap, key, loadedKey]);

  // Cadence RÉELLE auto-déclarée par le créateur (table creator_roadmap) — lecture seule
  // ici, pour la comparer à l'évaluation de l'agence. Best-effort (table peut manquer).
  const [selfCad, setSelfCad] = useState<SelfCadence>({});
  useEffect(() => {
    let alive = true;
    supabase.from("creator_roadmap").select("self_cadence").eq("creator", name).maybeSingle()
      .then(({ data }) => { if (alive) setSelfCad(normSelfCadence((data?.self_cadence as SelfCadence) ?? {})); });
    return () => { alive = false; };
  }, [name]);

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
    if (ok) setMode("view");
    toast(ok ? "Suivi mensuel enregistré ✓" : "Erreur — réessaie");
  };
  const cancel = () => { setLocal((monthlyMap?.[key] ?? []).map((m) => ({ ...emptyMonth(m.month), ...m }))); setMode("view"); };

  const recoTotal = cadenceTotal(reco);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarRange className="h-4 w-4 text-muted-foreground" /> Suivi mensuel
        </div>
        {mode === "view" ? (
          <EditBtn onClick={() => setMode("edit")} />
        ) : (
          <div className="flex items-center gap-2">
            {sorted.length > 0 && (
              <button type="button" onClick={cancel} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover">
                <X className="h-3.5 w-3.5" /> Annuler
              </button>
            )}
            <button type="button" onClick={addMonth} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Ajouter le mois
            </button>
            <button type="button" onClick={save} disabled={saving || loading || loadedKey !== key} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? "…" : "Enregistrer"}
            </button>
          </div>
        )}
      </div>

      {/* ─────────── LECTURE ─────────── */}
      {mode === "view" && (
        sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
            Aucun mois suivi. <button type="button" onClick={() => setMode("edit")} className="font-semibold text-primary underline-offset-2 hover:underline">Ajouter un mois</button> pour suivre la cadence réelle.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((m) => {
              const realTotal = cadenceTotal(m.cadence);
              const ratio = recoTotal > 0 ? realTotal / recoTotal : 1;
              const badge = recoTotal === 0 ? "bg-panel text-faint" : ratio >= 1 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : ratio >= 0.7 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400";
              return (
                <div key={m.month} className="rounded-xl border border-border bg-panel/40 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{monthLabel(m.month)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums", badge)}>{realTotal}{recoTotal > 0 ? ` / ${recoTotal}` : ""} contenus</span>
                    {m.derive && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Dérive</span>}
                  </div>
                  <CadenceTiles cadence={m.cadence} reco={reco} />
                  {selfCad[m.month] && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-border bg-panel/40 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="font-semibold uppercase tracking-wide text-faint">Déclaré par le créateur</span>
                      {CADENCE_FIELDS.map((f) => <span key={f.key} className="tabular-nums">{f.short} <span className="font-semibold text-foreground">{selfCad[m.month][f.key]}</span></span>)}
                    </div>
                  )}
                  {(m.erInsta || m.erTiktok || m.vuesMoy) && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[{ l: "ER Instagram", v: m.erInsta }, { l: "ER TikTok", v: m.erTiktok }, { l: "Vues moyennes", v: m.vuesMoy }].map((x) => (
                        <div key={x.l} className="rounded-xl bg-panel/60 px-3 py-2.5">
                          <div className="text-[15px] font-bold text-foreground">{x.v || "—"}</div>
                          <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">{x.l}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.faits && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-panel/50 px-3.5 py-3 text-[13px] leading-relaxed text-foreground">{m.faits}</p>}
                  {m.derive && m.deriveNote && (
                    <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-500/5 px-3.5 py-3 text-[13px] leading-relaxed text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{m.deriveNote}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ─────────── ÉDITION ─────────── */}
      {mode === "edit" && (sorted.length === 0 ? (
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

                {/* Cadence auto-déclarée par le créateur (rappel, lecture seule) */}
                {selfCad[m.month] && (
                  <button
                    type="button"
                    onClick={() => editMonth(m.month, { cadence: { ...selfCad[m.month] } })}
                    title="Cliquer pour reprendre ces chiffres dans ton évaluation"
                    className="mt-2 flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-border bg-panel/40 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-rowhover"
                  >
                    <span className="font-semibold uppercase tracking-wide text-faint">Déclaré par le créateur</span>
                    {CADENCE_FIELDS.map((f) => (
                      <span key={f.key} className="tabular-nums">{f.short} <span className="font-semibold text-foreground">{selfCad[m.month][f.key]}</span></span>
                    ))}
                    <span className="ml-auto text-[10px] text-faint">↳ reprendre</span>
                  </button>
                )}

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
      ))}
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
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    if (!loading && loadedKey !== key) {
      const arr = (map?.[key] ?? []).slice();
      setLocal(arr);
      setLoadedKey(key);
      setMode(arr.length === 0 ? "edit" : "view");
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
    if (ok) setMode("view");
    toast(ok ? "Journal enregistré ✓" : "Erreur — réessaie");
  };
  const cancel = () => { setLocal((map?.[key] ?? []).slice()); setMode("view"); };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquare className="h-4 w-4 text-muted-foreground" /> Journal d'accompagnement
        </div>
        {mode === "view" ? (
          <EditBtn onClick={() => setMode("edit")} />
        ) : (
          <div className="flex items-center gap-2">
            {sorted.length > 0 && (
              <button type="button" onClick={cancel} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover">
                <X className="h-3.5 w-3.5" /> Annuler
              </button>
            )}
            <button type="button" onClick={add} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Échange
            </button>
            <button type="button" onClick={save} disabled={saving || loading || loadedKey !== key} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? "…" : "Enregistrer"}
            </button>
          </div>
        )}
      </div>

      {/* ─────────── LECTURE ─────────── */}
      {mode === "view" && (
        sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
            Aucun échange noté. <button type="button" onClick={() => setMode("edit")} className="font-semibold text-primary underline-offset-2 hover:underline">Ajouter un échange</button> (appel, message, réunion).
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((e) => {
              const Icon = EXCHANGE_ICON[e.type];
              return (
                <div key={e.id} className="relative rounded-xl border border-border bg-panel/40 p-4 pl-5">
                  <span className="absolute left-0 top-4 h-[calc(100%-2rem)] w-[3px] rounded-full bg-primary/40" />
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      <Icon className="h-3.5 w-3.5" /> {EXCHANGE_META[e.type].label}
                    </span>
                    <span className="text-[12px] font-medium text-muted-foreground">{frDMY(e.date)}</span>
                    {e.prochainPoint && <span className="ml-auto text-[11px] text-faint">Prochain point : <span className="font-semibold text-foreground">{frDMY(e.prochainPoint)}</span></span>}
                  </div>
                  {e.resume && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{e.resume}</p>}
                  {(e.decisions || e.actions) && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {e.decisions && <div className="rounded-lg bg-panel/60 px-3 py-2"><div className={LBL}>Décisions</div><p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">{e.decisions}</p></div>}
                      {e.actions && <div className="rounded-lg bg-panel/60 px-3 py-2"><div className={LBL}>Actions à suivre</div><p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">{e.actions}</p></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ─────────── ÉDITION ─────────── */}
      {mode === "edit" && (sorted.length === 0 ? (
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
      ))}
    </section>
  );
}

// ───────────────────────── alertes + roster trajectoire ─────────────────────

type CtDeadline = { id: string; creator: string; start: string; months: number };
const frShort = (iso: string | null): string => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Lit tous les blobs de suivi (profils, mensuel, journal, échéances) en une fois. */
function useTracking() {
  const { data: profiles } = useAppState<Record<string, EditorialProfile>>((s: AppState) => (s[PROFILES_KEY] as Record<string, EditorialProfile>) ?? {});
  const { data: monthly } = useAppState<Record<string, MonthEntry[]>>((s: AppState) => (s[MONTHLY_KEY] as Record<string, MonthEntry[]>) ?? {});
  const { data: journal } = useAppState<Record<string, JournalEntry[]>>((s: AppState) => (s[JOURNAL_KEY] as Record<string, JournalEntry[]>) ?? {});
  const { data: deadlines } = useAppState<CtDeadline[]>((s: AppState) => (s["contractDeadlines"] as CtDeadline[]) ?? []);
  return { profiles: profiles ?? {}, monthly: monthly ?? {}, journal: journal ?? {}, deadlines: deadlines ?? [] };
}
function deadlineDaysFor(name: string, deadlines: CtDeadline[]): number | null {
  const e = deadlines.find((d) => norm(d.creator) === norm(name));
  return e ? contractDaysLeft(e.start, e.months) : null;
}

/** Bandeau d'alertes d'un créateur (haut de sa fiche). */
export function CreatorAlerts({ name }: { name: string }) {
  const { profiles, monthly, deadlines } = useTracking();
  const k = norm(name);
  const alerts = computeAlerts({ profile: normProfile(profiles[k]), lastMonth: lastMonthOf(monthly[k]), deadlineInDays: deadlineDaysFor(name, deadlines) });
  const traj = trajectoryOf(alerts);
  const meta = TRAJECTORY_META[traj];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <span className={cn("size-2.5 rounded-full", meta.dot)} /> {meta.label}
      </span>
      {alerts.length > 0 && <span className="text-faint">·</span>}
      {alerts.map((a, i) => (
        <span key={i} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", a.level === "danger" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>
          <AlertTriangle className="h-3 w-3" /> {a.label}
        </span>
      ))}
    </div>
  );
}

/** Tableau de bord ROSTER : trajectoire, dernier contact, prochain point, alertes. */
export function RosterTracking({ onOpen }: { onOpen?: (name: string) => void }) {
  const creators = useCreators();
  const t = useTracking();
  const rows = creators
    .map((c) => {
      const k = norm(c.name);
      const alerts = computeAlerts({ profile: normProfile(t.profiles[k]), lastMonth: lastMonthOf(t.monthly[k]), deadlineInDays: deadlineDaysFor(c.name, t.deadlines) });
      return { name: c.name, traj: trajectoryOf(alerts), alerts, last: lastContact(t.journal[k]), next: nextPoint(t.journal[k]) };
    })
    .sort((a, b) => (a.traj === "difficulte" ? -2 : a.traj === "surveiller" ? -1 : 0) - (b.traj === "difficulte" ? -2 : b.traj === "surveiller" ? -1 : 0) || b.alerts.length - a.alerts.length);

  const counts = { difficulte: rows.filter((r) => r.traj === "difficulte").length, surveiller: rows.filter((r) => r.traj === "surveiller").length, bonne: rows.filter((r) => r.traj === "bonne").length };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {(["bonne", "surveiller", "difficulte"] as const).map((tr) => (
          <div key={tr} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
              <span className={cn("size-2 rounded-full", TRAJECTORY_META[tr].dot)} /> {TRAJECTORY_META[tr].label}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{counts[tr]}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate [border-spacing:0_10px] text-left">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-wide text-faint">
              <th className="px-4 pb-1">Créateur</th>
              <th className="px-4 pb-1">Trajectoire</th>
              <th className="px-4 pb-1">Dernier contact</th>
              <th className="px-4 pb-1">Prochain point</th>
              <th className="px-4 pb-1">Alertes actives</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} onClick={() => onOpen?.(r.name)} className={cn("bg-surface shadow-sm transition-colors hover:bg-rowhover [&>td]:border-y [&>td]:border-border [&>td:first-child]:rounded-l-2xl [&>td:first-child]:border-l [&>td:last-child]:rounded-r-2xl [&>td:last-child]:border-r", onOpen && "cursor-pointer")}>
                <td className="px-4 py-3 text-[13px] font-semibold text-foreground">{titleCase(r.name)}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                    <span className={cn("size-2 rounded-full", TRAJECTORY_META[r.traj].dot)} /> {TRAJECTORY_META[r.traj].label}
                  </span>
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">{frShort(r.last)}</td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">{frShort(r.next)}</td>
                <td className="px-4 py-3">
                  {r.alerts.length === 0 ? (
                    <span className="text-[11px] text-faint">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.alerts.map((a, i) => (
                        <span key={i} className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", a.level === "danger" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>
                          {a.label}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────── côté CRÉATEUR : ma feuille de route ───────────────────

// Icône par format de contenu (report de cadence + cadence recommandée).
const FMT_ICON: Record<keyof Cadence, LucideIcon> = {
  reels: Film,
  carrousels: GalleryHorizontalEnd,
  stories: CircleDashed,
  tiktoks: Music2,
  youtube: MonitorPlay,
};

/**
 * Vue CRÉATEUR de sa feuille de route (lecture seule : piliers, positionnement,
 * ton, plateformes, objectifs 90 j, cadence recommandée) + report de SA cadence
 * réelle du mois. Lit/écrit UNIQUEMENT sa ligne `creator_roadmap` (RLS) ; le
 * journal, les alertes et l'évaluation de l'agence lui restent invisibles.
 */
export function CreatorRoadmap({ name }: { name: string }) {
  const [roadmap, setRoadmap] = useState<Record<string, unknown> | null>(null);
  const [selfCad, setSelfCad] = useState<SelfCadence>({});
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>(currentMonth());
  const [draft, setDraft] = useState<Cadence>(emptyCadence());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.from("creator_roadmap").select("roadmap, self_cadence").eq("creator", name).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setRoadmap((data?.roadmap as Record<string, unknown>) ?? null);
        setSelfCad(normSelfCadence((data?.self_cadence as SelfCadence) ?? {}));
        setLoading(false);
      });
    return () => { alive = false; };
  }, [name]);

  // À chaque changement de mois sélectionné, précharge la cadence déjà déclarée.
  useEffect(() => { setDraft(selfCad[month] ? { ...selfCad[month] } : emptyCadence()); }, [month, selfCad]);

  const rm = normRoadmap(roadmap as never);
  const hasRoadmap = roadmap != null;

  const saveCadence = async () => {
    if (saving) return;
    setSaving(true);
    const next = { ...selfCad, [month]: draft };
    const { error } = await supabase.from("creator_roadmap").upsert({ creator: name, self_cadence: next }, { onConflict: "creator" });
    setSaving(false);
    if (error) return toast("Erreur — réessaie");
    setSelfCad(next);
    toast("Cadence du mois envoyée à l'agence ✓");
  };

  if (loading) return <div className="rounded-2xl border border-border bg-surface p-8 text-center text-[13px] text-muted-foreground shadow-sm">Chargement…</div>;

  const recoTot = cadenceTotal(rm.cadenceReco);
  const draftTot = cadenceTotal(draft);

  return (
    <div className="flex flex-col gap-4">
      {/* Feuille de route (lecture seule) — carte premium */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {/* En-tête façon héros */}
        <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/12 via-primary/5 to-transparent px-5 py-4">
          <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
              <Target className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-foreground">Ma feuille de route</div>
              <div className="text-[11px] text-muted-foreground">Ta stratégie de contenu, définie avec ton agence</div>
            </div>
          </div>
        </div>

        {!hasRoadmap ? (
          <div className="p-5">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-panel/40 px-4 py-10 text-center">
              <Compass className="h-6 w-6 text-faint" />
              <p className="text-[13px] text-muted-foreground">Ta feuille de route n'est pas encore définie.<br />Ton agence la partagera ici prochainement.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            {/* Niche + Ton : 2 bento */}
            {(rm.positionnement || rm.tonalite) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {rm.positionnement && <BentoField icon={Compass} label="Niche & positionnement">{rm.positionnement}</BentoField>}
                {rm.tonalite && <BentoField icon={Mic} label="Ton de voix">{rm.tonalite}</BentoField>}
              </div>
            )}

            {/* Piliers de contenu — pastilles teintées primary */}
            {rm.piliers.length > 0 && (
              <div>
                <div className={LBL}>Piliers de contenu</div>
                <div className="flex flex-wrap gap-2">
                  {rm.piliers.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.07] px-3 py-1.5 text-[12px] font-semibold text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Plateformes prioritaires */}
            {rm.plateformes.length > 0 && (
              <div>
                <div className={LBL}>Plateformes prioritaires</div>
                <div className="flex flex-wrap gap-2">
                  {rm.plateformes.map((pl) => (
                    <span key={pl} className="inline-flex items-center gap-2 rounded-xl border border-border bg-panel/60 px-3.5 py-2 text-[12.5px] font-semibold text-foreground shadow-sm">
                      <PlatformIcon platform={pl} className="h-4 w-4" /> {platPrioLabel[pl]}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Objectifs 90 jours — « north star » mis en avant */}
            {rm.objectifs90 && (
              <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> Objectifs 90 jours
                </div>
                <p className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-foreground">{rm.objectifs90}</p>
              </div>
            )}

            {/* Cadence recommandée — tuiles par format */}
            {recoTot > 0 && (
              <div>
                <div className={LBL}>Cadence recommandée / mois</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {CADENCE_FIELDS.map((f) => {
                    const Icon = FMT_ICON[f.key];
                    return (
                      <div key={f.key} className="flex flex-col items-center gap-1 rounded-xl border border-border bg-panel/50 px-2 py-3">
                        <Icon className="h-4 w-4 text-primary" />
                        <div className="text-xl font-bold tabular-nums text-foreground">{rm.cadenceReco[f.key]}</div>
                        <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{f.short}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Reporter ma cadence du mois */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-panel text-primary">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-foreground">Reporter ma cadence</div>
              <div className="text-[11px] text-muted-foreground">Ce que tu as réellement publié — pour suivre ta régularité</div>
            </div>
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium outline-none focus:border-primary" />
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {CADENCE_FIELDS.map((f) => {
              const Icon = FMT_ICON[f.key];
              const reco = rm.cadenceReco[f.key];
              const val = draft[f.key];
              const pct = reco > 0 ? Math.min(100, (val / reco) * 100) : 0;
              const reached = reco > 0 && val >= reco;
              return (
                <label key={f.key} className="flex flex-col gap-1.5 rounded-xl border border-border bg-panel/40 p-2.5 transition-colors focus-within:border-primary">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {f.short}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={draft[f.key]}
                    onChange={(e) => setDraft({ ...draft, [f.key]: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-center text-lg font-bold tabular-nums text-foreground outline-none focus:border-primary"
                  />
                  {reco > 0 && (
                    <>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
                        <div className={cn("h-full rounded-full transition-all", reached ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="flex items-center justify-center gap-1 text-center text-[9px] text-faint">
                        {reached && <Check className="h-3 w-3 text-emerald-500" />}objectif {reco}
                      </span>
                    </>
                  )}
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[12px] text-muted-foreground">Total :</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{draftTot}</span>
              <span className="text-[12px] text-muted-foreground">contenu{draftTot > 1 ? "s" : ""}</span>
              {recoTot > 0 && <span className="text-[11px] text-faint">/ {recoTot} recommandés</span>}
            </div>
            <button type="button" onClick={saveCadence} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm shadow-primary/25 transition-opacity hover:opacity-90 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? "Envoi…" : "Envoyer ma cadence"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Bento pour un champ texte de la feuille de route (niche, ton…). */
function BentoField({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel/40 p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
      </div>
      <p className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

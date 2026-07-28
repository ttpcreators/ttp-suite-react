import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Target, GripVertical } from "lucide-react";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { cn } from "@/lib/utils";
import {
  norm, normProfile, emptyProfile, PROFILES_KEY, CADENCE_FIELDS, cadenceTotal,
  PLATFORMS_PRIO, platPrioLabel, type EditorialProfile, type PlatPrio, type Cadence,
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

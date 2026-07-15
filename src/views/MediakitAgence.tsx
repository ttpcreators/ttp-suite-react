import { useEffect, useState } from "react";
import { Plus, Trash2, Save, ExternalLink, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";

/**
 * Éditeur du MEDIA KIT AGENCE (deck global ttpcreators.pro/mediakit/agence/).
 * Écrit le contenu ÉDITABLE de l'agence (intro, piliers, KPIs statiques, contact)
 * dans la table singleton `agency_mediakit` (id=1, blob `data` jsonb). La vue anon
 * `public_agency_mediakit` l'expose au site → enregistrer ici met le deck à jour.
 *
 * Ce qui N'est PAS ici (géré ailleurs) : les créatrices (chacune remplit son media
 * kit → elles apparaissent automatiquement) et le mur de marques (liste curée côté
 * site). Ici = uniquement le texte de cadrage de l'agence.
 */

type Pillar = { title: string; text: string };
type AgencyKit = {
  intro?: { title?: string; lead?: string };
  pillars?: Pillar[];
  kpis?: { universes?: string; universesLabel?: string; platforms?: string; platformsLabel?: string };
  contact?: { instagram?: string; phone?: string; email?: string };
};

// Valeurs par défaut = contenu ACTUEL du deck (miroir de AG_DEFAULTS côté site,
// mediakit-agence.js) → l'éditeur pré-remplit ce qui est en ligne, on ajuste, on enregistre.
const DEF = {
  intro: {
    title: "Talent management\nstratégique",
    lead: "TTP Creators accompagne une sélection de créatrices Sport & Lifestyle : stratégie de carrière, production de contenu et négociation, tout en interne. On construit des identités qui durent — pas des pics de vues.",
  },
  pillars: [
    { title: "Talent d'abord", text: "Une créatrice n'est pas une audience : c'est une marque. On construit une identité qui dure, pas des pics de vues." },
    { title: "Studio intégré", text: "Stratégie, production, négociation : tout se passe en interne. Une seule équipe, aucune perte en ligne." },
    { title: "Résultats mesurés", text: "Pas de feeling : des KPIs clairs et un reporting précis, à chaque collaboration." },
  ] as Pillar[],
  kpis: { universes: "02", universesLabel: "Univers · Sport & Lifestyle", platforms: "05", platformsLabel: "Plateformes couvertes" },
  contact: { instagram: "ttp.creators", phone: "07 66 25 98 03", email: "partnerships@ttpcreators.pro" },
};

/** Pré-remplit les champs vides avec les valeurs par défaut (affichage). */
function withDefaults(blob: AgencyKit): Required<AgencyKit> {
  return {
    intro: { ...DEF.intro, ...(blob.intro ?? {}) },
    pillars: blob.pillars && blob.pillars.length ? blob.pillars : DEF.pillars,
    kpis: { ...DEF.kpis, ...(blob.kpis ?? {}) },
    contact: { ...DEF.contact, ...(blob.contact ?? {}) },
  };
}

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const LBL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint";
const CARD = "rounded-2xl border border-border bg-surface p-4 shadow-sm";
const PUBLIC_URL = "https://ttpcreators.pro/mediakit/agence/";

export function MediakitAgence() {
  const [kit, setKit] = useState<Required<AgencyKit>>(() => withDefaults({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Garde-fou anti-écrasement : on n'autorise l'enregistrement QUE si le blob a été
  // LU avec succès. Un échec de lecture (réseau/RLS) ne doit pas laisser « enregistrer »
  // un contenu par défaut par-dessus ce qui est déjà en ligne.
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    setLoaded(false);
    supabase
      .from("agency_mediakit")
      .select("data")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setLoadError(true);
          setLoading(false);
          return;
        }
        const blob = ((data?.data as AgencyKit | null) ?? {}) as AgencyKit;
        setKit(withDefaults(blob));
        setLoaded(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const patchIntro = (p: Partial<NonNullable<AgencyKit["intro"]>>) =>
    setKit((k) => ({ ...k, intro: { ...k.intro, ...p } }));
  const patchKpis = (p: Partial<NonNullable<AgencyKit["kpis"]>>) =>
    setKit((k) => ({ ...k, kpis: { ...k.kpis, ...p } }));
  const patchContact = (p: Partial<NonNullable<AgencyKit["contact"]>>) =>
    setKit((k) => ({ ...k, contact: { ...k.contact, ...p } }));
  const setPillars = (pillars: Pillar[]) => setKit((k) => ({ ...k, pillars }));

  const save = async () => {
    if (saving || loading || loadError || !loaded) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("agency_mediakit")
        .upsert({ id: 1, data: kit, updated_at: new Date().toISOString() })
        .select("id");
      if (error || !(data && data.length)) {
        toast("Enregistrement échoué — réessaie");
        return;
      }
      toast("Media kit agence enregistré ✓ — le deck se met à jour en ligne");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* En-tête : voir + enregistrer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Le contenu de cadrage du deck agence.{" "}
          <span className="text-faint">Les créatrices s'ajoutent seules (chacune remplit son media kit) ; le mur de marques est géré sur le site.</span>
        </p>
        <div className="flex items-center gap-2">
          <a
            href={PUBLIC_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Voir le deck</span>
          </a>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading || loadError || !loaded}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`${CARD} text-sm text-muted-foreground`}>Chargement…</div>
      ) : loadError ? (
        <div className={`${CARD} text-sm`}>
          <div className="font-medium text-foreground">Impossible de charger le media kit agence.</div>
          <p className="mt-1 text-muted-foreground">
            Vérifie ta connexion. L'enregistrement est <strong>bloqué</strong> pour ne pas risquer d'écraser le contenu
            déjà en ligne.
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-xl bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* ---------------- INTRO ---------------- */}
          <section className={CARD}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Présentation de l'agence</h3>
            <div className="space-y-3">
              <div>
                <label className={LBL}>Titre (une ligne par saut de ligne)</label>
                <textarea
                  value={kit.intro.title ?? ""}
                  onChange={(e) => patchIntro({ title: e.target.value })}
                  rows={2}
                  placeholder={"Talent management\nstratégique"}
                  className={`${IN} resize-y`}
                />
              </div>
              <div>
                <label className={LBL}>Accroche</label>
                <textarea
                  value={kit.intro.lead ?? ""}
                  onChange={(e) => patchIntro({ lead: e.target.value })}
                  rows={4}
                  placeholder="TTP Creators accompagne une sélection de créatrices…"
                  className={`${IN} resize-y`}
                />
              </div>
            </div>
          </section>

          {/* ---------------- KPIs ---------------- */}
          <section className={CARD}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Chiffres clés</h3>
            <p className="mb-3 text-[11px] text-faint">
              Le nombre de créatrices et les followers cumulés sont calculés automatiquement. Ces deux-là sont fixes :
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <input
                  value={kit.kpis.universes ?? ""}
                  onChange={(e) => patchKpis({ universes: e.target.value })}
                  placeholder="02"
                  className={`${IN} text-center`}
                />
                <input
                  value={kit.kpis.universesLabel ?? ""}
                  onChange={(e) => patchKpis({ universesLabel: e.target.value })}
                  placeholder="Univers · Sport & Lifestyle"
                  className={IN}
                />
              </div>
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <input
                  value={kit.kpis.platforms ?? ""}
                  onChange={(e) => patchKpis({ platforms: e.target.value })}
                  placeholder="05"
                  className={`${IN} text-center`}
                />
                <input
                  value={kit.kpis.platformsLabel ?? ""}
                  onChange={(e) => patchKpis({ platformsLabel: e.target.value })}
                  placeholder="Plateformes couvertes"
                  className={IN}
                />
              </div>
            </div>
          </section>

          {/* ---------------- PILIERS ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Piliers ({kit.pillars.length})
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {kit.pillars.map((p, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      value={p.title}
                      onChange={(e) => setPillars(kit.pillars.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      placeholder="Titre du pilier"
                      className={`${IN} font-semibold`}
                    />
                    <button
                      type="button"
                      onClick={() => setPillars(kit.pillars.filter((_, j) => j !== i))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                      aria-label="Supprimer le pilier"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    value={p.text}
                    onChange={(e) => setPillars(kit.pillars.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    rows={3}
                    placeholder="Une phrase qui explique ce pilier."
                    className={`${IN} resize-y`}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPillars([...kit.pillars, { title: "", text: "" }])}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter un pilier
            </button>
            <p className="mt-2 text-[11px] text-faint">3 piliers conseillés (ils s'affichent sur une ligne dans le deck).</p>
          </section>

          {/* ---------------- CONTACT ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Contact
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={LBL}>Instagram (sans @)</label>
                <input
                  value={kit.contact.instagram ?? ""}
                  onChange={(e) => patchContact({ instagram: e.target.value.replace(/^@/, "") })}
                  placeholder="ttp.creators"
                  className={IN}
                />
              </div>
              <div>
                <label className={LBL}>Téléphone</label>
                <input
                  value={kit.contact.phone ?? ""}
                  onChange={(e) => patchContact({ phone: e.target.value })}
                  placeholder="07 66 25 98 03"
                  className={IN}
                />
              </div>
              <div>
                <label className={LBL}>Email</label>
                <input
                  value={kit.contact.email ?? ""}
                  onChange={(e) => patchContact({ email: e.target.value })}
                  placeholder="partnerships@ttpcreators.pro"
                  className={IN}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

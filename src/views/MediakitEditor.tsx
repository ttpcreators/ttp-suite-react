import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2, Save, ExternalLink, Wand2, Image as ImageIcon, Check, Sparkles, Euro, UserRound, Users, BarChart3, Share2, ListChecks, Store, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ImageField } from "@/components/ui/image-field";
import { dbUpdate } from "@/lib/db";
import { useCreators } from "@/lib/useCreators";
import { getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { titleCase, cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { MediakitThemePicker } from "@/components/ui/mediakit-theme-picker";

/**
 * Éditeur du MEDIA KIT EN LIGNE (par créatrice). Tout est écrit dans la colonne
 * JSONB `creators.mediakit` ; la vue anon `public_mediakit` l'expose au site
 * (ttpcreators.pro/mediakit/<slug>) qui la lit en direct → remplir ici met le
 * site à jour. NE contient que du contenu public (aucune donnée sensible).
 */

type PctRow = { label: string; pct: string };
type CountryRow = { name: string; pct: string };
type PlatformBlock = {
  key: string;
  followers?: string;
  er?: string;
  ageBracket?: string;
  impressions30j?: string;
  nonFollowersPct?: string;
  bestFormatPct?: string;
  likesTotal?: string;
  views30j?: string;
  newViewers30j?: string;
  watchHours?: string;
  reach?: string;
  avgViews?: string;
  avgStoryViews?: string;
  avgLikes?: string;
};
/** Une prestation tarifée (ex. « Story Instagram » — 1500 € HT). */
type RateRow = { label: string; price: string; detail?: string };
type BrandRow = { name: string; logo?: string | null };
type MediaKit = {
  slug?: string;
  bio?: string;
  tags?: string[];
  audience?: {
    age?: PctRow[];
    gender?: { femmes?: string; hommes?: string };
    pays?: CountryRow[];
    villes?: CountryRow[];
    formats?: PctRow[];
  };
  platforms?: PlatformBlock[];
  brands?: BrandRow[];
  photos?: Record<string, string | null>; // hero, contact, + une capture par plateforme (clé = instagram/tiktok/…)
  /** Captures d'insights affichées sur le media kit public (6 max). URLs publiques. */
  statsShots?: string[];
  /** Grille tarifaire (€ HT) affichée sur le media kit et dans le deck agence. */
  rates?: RateRow[];
  /** Mention sous la grille (packages, dispositifs…). */
  ratesNote?: string;
  /** Masque les tarifs sur le media kit public (ils restent saisis ici). */
  hideRates?: boolean;
  /** Thème de couleurs du media kit public (ids : lib/mediakitThemes). Absent = « minuit ». */
  theme?: string;
  /** Profil casting (tableau comparatif du deck agence) : clé critère → "oui" ou une précision. Absent = non. */
  casting?: Record<string, string>;
  /** Media kit UGC — format à part (personnalité, quotidien, matériel, portfolio),
   *  page publique séparée `/mediakit/<slug>/ugc/`. Ne remplace PAS le kit chiffré. */
  ugc?: UgcKit;
};

/** Contenu du media kit UGC (orienté personne, pas audience). */
type UgcKit = {
  enabled?: boolean;
  intro?: string; // qui il est, personnalité, univers
  region?: string; // ex « Sud de la France »
  home?: string; // ex « Maison », « Appartement »
  pets?: string; // ex « Chien », « Chat », « Chien + chat »
  sports?: string; // sports / activités régulières
  gear?: string[]; // matériel : DJI, appareil photo, iPhone, ringlight…
  collabs?: string[]; // anciennes collaborations UGC
  portfolio?: string[]; // URLs d'images d'anciens contenus UGC
  handle?: string; // @ (indicatif)
  followers?: string; // abonnés (indicatif)
};

/** Nombre max de captures de stats sur un media kit. */
const MAX_STATS_SHOTS = 6;
/** Nombre max de visuels dans le portfolio UGC. */
const MAX_UGC_PORTFOLIO = 12;

// Champs SUPPLÉMENTAIRES par plateforme (en plus de followers / ER / tranche d'âge).
const PLATFORM_FIELDS: Record<string, { key: keyof PlatformBlock; label: string }[]> = {
  // Alignés sur l'export de l'app Edits (ce que les créatrices envoient réellement).
  instagram: [
    { key: "impressions30j", label: "Comptes touchés / spectateurs (30 j)" },
    { key: "views30j", label: "Vues de reels (30 j)" },
    { key: "avgViews", label: "Moyenne vues par réel" },
    { key: "avgStoryViews", label: "Moyenne vues par story" },
  ],
  tiktok: [
    { key: "likesTotal", label: "J'aime cumulés" },
    { key: "views30j", label: "Vues (30 j)" },
    { key: "newViewers30j", label: "Nouveaux spectateurs (30 j)" },
    { key: "avgViews", label: "Moyenne vues par vidéo" },
    { key: "avgLikes", label: "Moyenne likes par vidéo" },
  ],
  youtube: [
    { key: "views30j", label: "Vues (30 j)" },
    { key: "avgViews", label: "Moyenne vues par vidéo" },
    { key: "watchHours", label: "Heures de visionnage" },
    { key: "newViewers30j", label: "Abonnés gagnés (30 j)" },
  ],
  snapchat: [
    { key: "views30j", label: "Vues de story (30 j)" },
    { key: "reach", label: "Portée" },
    { key: "newViewers30j", label: "Abonnés gagnés (30 j)" },
  ],
  x: [{ key: "impressions30j", label: "Impressions (30 j)" }],
};
const PLATFORM_OPTIONS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "snapchat", label: "Snapchat" },
  { key: "x", label: "X" },
];
const platLabel = (k: string) => PLATFORM_OPTIONS.find((p) => p.key === k)?.label ?? titleCase(k);

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/15";
const LBL = "mb-1 block text-[12px] font-medium text-muted-foreground";
const CARD = "rounded-2xl border border-border bg-surface p-5";
// Listes éditables : UN cadre, lignes séparées par des filets, champs sans bordure.
const LIST = "overflow-hidden rounded-xl border border-border divide-y divide-border";
const BARE = "min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-faint hover:bg-rowhover/50 focus:bg-rowhover/70";
const DEL = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]";
const ADD = "mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

/** Titre de section façon Aperçu : icône grise + intitulé, aide et action optionnelles. */
function SectionHead({ icon: Icon, title, hint, right }: { icon: LucideIcon; title: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> {title}
        </h3>
        {hint && <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Cellule « nombre + % » d'une ligne de liste. */
function PctCell({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex shrink-0 items-center border-l border-border">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal" className="w-14 bg-transparent py-2 pl-2 text-right text-[13px] tabular-nums outline-none transition-colors placeholder:text-faint hover:bg-rowhover/50 focus:bg-rowhover/70" />
      <span className="pl-1 pr-3 text-[12px] text-muted-foreground">%</span>
    </div>
  );
}

function slugify(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/** "04/07/2026" → timestamp (pour la dernière mesure par plateforme). */
function frTime(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec((s ?? "").trim());
  if (!m) return 0;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return new Date(Number(y), Number(m[2]) - 1, Number(m[1])).getTime();
}

type HistLike = { creator?: string; platform?: string; date?: string; followers?: string; er?: string };

/**
 * Éditeur du media kit d'une créatrice. `mode` choisit les sections affichées :
 *  - "standard" (défaut) : profil, audience, photos, captures, plateformes, marques ;
 *  - "ugc" : uniquement le kit UGC (personnalité, quotidien, matériel, portfolio).
 * Les DEUX modes partagent le même chargement/sauvegarde du blob `creators.mediakit`
 * (mêmes garde-fous) → un onglet « UGC » réutilise ce composant sans rien dupliquer.
 */
export function MediakitEditor({ mode = "standard" }: { mode?: "standard" | "ugc" }) {
  const creators = useCreators();
  const [selId, setSelId] = useState("");
  const selected = creators.find((c) => c.id === selId) ?? null;
  const [mk, setMk] = useState<MediaKit>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // ID de la créatrice dont le blob a été LU AVEC SUCCÈS. Le save n'est autorisé
  // que si loadedId === selId : sinon un échec de lecture (réseau/RLS/quota)
  // afficherait un kit vide qui, une fois « enregistré », écraserait le vrai
  // media kit en base. Garde-fou anti perte de données silencieuse.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Instantané (JSON) du kit tel que chargé / dernièrement enregistré : sert à
  // détecter les modifications non enregistrées.
  const [savedSnap, setSavedSnap] = useState<string | null>(null);
  const dirty = useMemo(
    () => !!selId && loadedId === selId && savedSnap !== null && JSON.stringify(mk) !== savedSnap,
    [mk, savedSnap, selId, loadedId],
  );
  // Créatrice courante, lue par les callbacks d'upload asynchrones : si elle a
  // changé pendant l'upload, le résultat est ignoré (sinon il atterrirait dans
  // le kit d'une autre créatrice).
  const selIdRef = useRef(selId);
  useEffect(() => {
    selIdRef.current = selId;
  }, [selId]);
  const forSel = <A extends unknown[]>(fn: (...args: A) => void) => {
    const at = selId;
    return (...args: A) => {
      if (selIdRef.current !== at) {
        toast("Image ignorée : la créatrice a changé pendant l'envoi");
        return;
      }
      fn(...args);
    };
  };

  // Garde-fou onglet : prévient avant de quitter la page avec des modifs en cours.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const changeCreator = (id: string) => {
    if (id === selId) return;
    if (dirty && !window.confirm("Des modifications ne sont pas enregistrées. Changer de créatrice et les perdre ?")) return;
    setSelId(id);
  };

  // Charge le blob mediakit de la créatrice choisie.
  useEffect(() => {
    if (!selId) {
      setMk({});
      setLoadedId(null);
      setSavedSnap(null);
      setLoadError(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(false);
    setLoadedId(null);
    setSavedSnap(null);
    supabase
      .from("creators")
      .select("mediakit")
      .eq("id", selId)
      .limit(1)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          // Lecture échouée : NE PAS vider mk, NE PAS marquer chargé → save bloqué.
          setLoadError(true);
          setLoading(false);
          return;
        }
        const blob = (data?.[0]?.mediakit as MediaKit | null) ?? {};
        // slug par défaut = prénom de la créatrice
        if (!blob.slug && selected) blob.slug = slugify((selected.name || "").split(/\s+/)[0]);
        setMk(blob);
        setSavedSnap(JSON.stringify(blob));
        setLoadedId(selId);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, reloadKey]);

  // ---- helpers d'édition immuables ----
  const patch = (p: Partial<MediaKit>) => setMk((m) => ({ ...m, ...p }));
  const patchAudience = (p: Partial<NonNullable<MediaKit["audience"]>>) =>
    setMk((m) => ({ ...m, audience: { ...m.audience, ...p } }));
  const setPhoto = (key: string, url: string | null) =>
    setMk((m) => ({ ...m, photos: { ...(m.photos ?? {}), [key]: url } }));

  const save = async () => {
    if (!selId || saving) return;
    // Garde-fou : ne jamais écrire tant que le blob courant n'a pas été LU avec
    // succès, sinon on remplacerait le vrai media kit par un objet vide.
    if (loadedId !== selId) return toast("Media kit pas encore chargé — patiente ou recharge");
    setSaving(true);
    try {
      const desired = (mk.slug || "").trim() || slugify((selected?.name || "").split(/\s+/)[0]) || "createur";
      // Slug UNIQUE entre créatrices : le générateur du site déduplique les
      // collisions (-2/-3). On garantit l'unicité ici pour que le lien « Voir le
      // media kit » et l'URL publique pointent bien sur la page de CETTE créatrice.
      let slug = desired;
      try {
        const { data: others } = await supabase.from("creators").select("id, mediakit").neq("id", selId);
        const used = new Set(
          (others ?? [])
            .map((o) => (o.mediakit as MediaKit | null)?.slug)
            .filter((s): s is string => !!s),
        );
        let n = 2;
        while (used.has(slug)) slug = `${desired}-${n++}`;
      } catch {
        /* si la vérif d'unicité échoue, on garde le slug désiré (le site dédupliquera au pire) */
      }
      // Retire les lignes vides laissées dans les listes (étiquette vide, marque
      // sans nom, prestation sans intitulé ni prix, plateforme sans clé).
      const mkAtSave = mk;
      const clean: MediaKit = {
        ...mk,
        slug,
        ...(mk.tags ? { tags: mk.tags.map((t) => t.trim()).filter(Boolean) } : {}),
        ...(mk.brands ? { brands: mk.brands.filter((b) => (b.name ?? "").trim()) } : {}),
        ...(mk.rates ? { rates: mk.rates.filter((r) => (r.label ?? "").trim() || (r.price ?? "").trim()) } : {}),
        ...(mk.platforms ? { platforms: mk.platforms.filter((p) => (p.key ?? "").trim()) } : {}),
      };
      const ok = await dbUpdate("creators", selId, { mediakit: clean });
      if (!ok) return toast("Enregistrement échoué — réessaie");
      // Si rien n'a bougé pendant l'enregistrement → on affiche la version nettoyée ;
      // sinon on garde les nouvelles saisies (elles restent « non enregistrées »).
      if (selIdRef.current !== selId) return;
      setMk((m) => (m === mkAtSave ? clean : { ...m, slug }));
      setSavedSnap(JSON.stringify(clean));
      toast("Media kit enregistré ✓");
    } finally {
      setSaving(false);
    }
  };

  // Importe followers + ER (dernière mesure par plateforme) depuis le calculateur.
  const importFromCalculator = async () => {
    if (!selected) return;
    invalidateAppState();
    let st: AppState;
    try {
      st = (await getAppState()) as AppState;
    } catch {
      return toast("Import impossible — réessaie");
    }
    const hist = ((st["engagementHistory"] as HistLike[]) ?? []).filter(
      (h) => (h.creator || "").toLowerCase() === (selected.name || "").toLowerCase(),
    );
    if (hist.length === 0) return toast("Aucune mesure dans le calculateur pour cette créatrice");
    const latest = new Map<string, HistLike>();
    for (const h of hist) {
      if (!h.platform) continue;
      const cur = latest.get(h.platform);
      if (!cur || frTime(h.date ?? "") > frTime(cur.date ?? "")) latest.set(h.platform, h);
    }
    setMk((m) => {
      const platforms = [...(m.platforms ?? [])];
      for (const [key, h] of latest) {
        let i = platforms.findIndex((p) => p.key === key);
        if (i === -1) {
          platforms.push({ key });
          i = platforms.length - 1;
        }
        platforms[i] = {
          ...platforms[i],
          // La dernière mesure du calculateur REMPLACE l'existant (sinon on garde la valeur actuelle).
          followers: h.followers || platforms[i].followers,
          er: (h.er ?? "").replace(/\s/g, "") || platforms[i].er,
        };
      }
      return { ...m, platforms };
    });
    toast(`Followers + ER importés (${latest.size} plateforme${latest.size > 1 ? "s" : ""}) ✓`);
  };

  // ---- petites listes éditables ----
  const setTags = (tags: string[]) => patch({ tags });
  const setBrands = (brands: BrandRow[]) => patch({ brands });
  const ugc = mk.ugc ?? {};
  const patchUgc = (p: Partial<UgcKit>) => setMk((m) => ({ ...m, ugc: { ...(m.ugc ?? {}), ...p } }));
  // Liste texte (matériel, collabs) éditée en une ligne par entrée.
  const ugcLines = (v: string[] | undefined) => (v ?? []).join("\n");
  const setUgcLines = (key: "gear" | "collabs", raw: string) =>
    patchUgc({ [key]: raw.split("\n").map((s) => s.trim()).filter(Boolean) } as Partial<UgcKit>);
  const setPlatforms = (platforms: PlatformBlock[]) => patch({ platforms });
  const setRates = (rates: RateRow[]) => patch({ rates });
  const setCasting = (casting: Record<string, string>) => patch({ casting });

  const publicUrl = mk.slug ? `https://ttpcreators.pro/mediakit/${mk.slug}/` : null;

  return (
    <div className="space-y-4">
      {/* En-tête : créatrice + voir + enregistrer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={selId} onValueChange={changeCreator}>
          <SelectTrigger className="h-9 w-auto min-w-[220px] rounded-lg bg-surface" placeholder="Choisir une créatrice" />
          <SelectContent>
            {creators.map((c, i) => (
              <SelectItem key={c.id} index={i} value={c.id}>
                {titleCase(c.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selId && (
          <div className="flex items-center gap-2">
            {publicUrl && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
              >
                <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Voir le media kit</span>
              </a>
            )}
            {publicUrl && mk.ugc?.enabled && (
              <a
                href={`${publicUrl}ugc/`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
              >
                <Sparkles className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Voir le kit UGC</span>
              </a>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || loading || loadError || loadedId !== selId}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        )}
      </div>

      {!selId ? (
        <div className="rounded-2xl border border-border bg-surface p-10 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-faint" />
          <div className="mt-3 text-sm font-medium text-foreground">Choisis une créatrice</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Remplis son media kit — il se met à jour en ligne sur ttpcreators.pro/mediakit/&lt;lien&gt;.
          </p>
        </div>
      ) : loading ? (
        <div className={`${CARD} text-sm text-muted-foreground`}>Chargement…</div>
      ) : loadError ? (
        <div className={`${CARD} text-sm`}>
          <div className="font-medium text-foreground">Impossible de charger ce media kit.</div>
          <p className="mt-1 text-muted-foreground">
            Vérifie ta connexion. L'enregistrement est <strong>bloqué</strong> pour ne pas risquer d'écraser les
            données déjà en ligne.
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {mode === "standard" && (
          <>
          {/* Couleurs du media kit (web + PDF, aussi la page UGC) */}
          <section className={`${CARD} xl:col-span-2`}>
            <MediakitThemePicker kind="creator" value={mk.theme} onChange={(theme) => patch({ theme })} previewBase={publicUrl} />
          </section>

          {/* Colonne gauche : profil + photos (colonnes équilibrées, plus de vide sous « Profil ») */}
          <div className="flex min-w-0 flex-col gap-4">
          {/* ---------------- PROFIL ---------------- */}
          <section className={CARD}>
            <SectionHead icon={UserRound} title="Profil" />
            <div className="space-y-4">
              <div>
                <label className={LBL}>Lien (adresse de la page)</label>
                {/* Préfixe accolé au champ (un seul bloc bordé) */}
                <div className="flex overflow-hidden rounded-lg border border-border bg-surface text-[13px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                  <span className="flex shrink-0 items-center border-r border-border bg-muted px-3 text-muted-foreground">ttpcreators.pro/mediakit/</span>
                  <input
                    value={mk.slug ?? ""}
                    onChange={(e) => patch({ slug: slugify(e.target.value) })}
                    placeholder="candice"
                    className={BARE}
                  />
                </div>
              </div>
              <div>
                <label className={LBL}>Bio (2 phrases)</label>
                <textarea
                  value={mk.bio ?? ""}
                  onChange={(e) => patch({ bio: e.target.value })}
                  rows={6}
                  placeholder="Candice est une créatrice lifestyle & blogging basée à Paris…"
                  className={`${IN} min-h-[140px] resize-y leading-relaxed`}
                />
              </div>
              <TagEditor tags={mk.tags ?? []} onChange={setTags} />
            </div>
          </section>

          {/* ---------------- PHOTOS ---------------- */}
          <section className={CARD}>
            <SectionHead icon={ImageIcon} title="Photos" />
            <div className="flex flex-wrap gap-6">
              <ImageField
                label="Portrait principal (page d'accueil)"
                slug={mk.slug ?? ""}
                field="hero"
                url={mk.photos?.hero}
                onChange={forSel((u: string | null) => setPhoto("hero", u))}
                boxClass="h-44 w-36"
              />
              <ImageField
                label="Portrait secondaire (page contact)"
                slug={mk.slug ?? ""}
                field="contact"
                url={mk.photos?.contact}
                onChange={forSel((u: string | null) => setPhoto("contact", u))}
                boxClass="h-44 w-36"
              />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Portraits verticaux conseillés (ils remplissent toute la hauteur). Les captures de profil s'ajoutent dans
              chaque bloc « Plateforme » ci-dessous. Les images sont optimisées automatiquement — après un upload, clique
              « Enregistrer » en haut.
            </p>
          </section>

          </div>

          {/* Colonne droite : audience + captures de stats */}
          <div className="flex min-w-0 flex-col gap-4">
          {/* ---------------- AUDIENCE ---------------- */}
          <section className={CARD}>
            <SectionHead icon={Users} title="Audience" />
            <div className="space-y-5">
              <PctList
                title="Tranches d'âge"
                rows={mk.audience?.age ?? []}
                onChange={(age) => patchAudience({ age })}
                placeholderLabel="18–24 ans"
              />
              <div>
                <label className={LBL}>Genre</label>
                {/* Même cadre que les autres listes : libellé fixe + % aligné */}
                <div className={LIST}>
                  {(["femmes", "hommes"] as const).map((g) => (
                    <div key={g} className="flex items-center pr-1">
                      <span className="flex-1 px-3 py-2 text-[13px] text-muted-foreground">{g === "femmes" ? "Femmes" : "Hommes"}</span>
                      <PctCell
                        value={mk.audience?.gender?.[g] ?? ""}
                        onChange={(v) => patchAudience({ gender: { ...mk.audience?.gender, [g]: v } })}
                        placeholder={g === "femmes" ? "29" : "71"}
                      />
                      <span className="w-8 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
              <CountryList
                title="Pays principaux"
                placeholder="France"
                rows={mk.audience?.pays ?? []}
                onChange={(pays) => patchAudience({ pays })}
              />
              <CountryList
                title="Villes principales"
                placeholder="Paris"
                rows={mk.audience?.villes ?? []}
                onChange={(villes) => patchAudience({ villes })}
              />
              <PctList
                title="Formats (Réels / Story / Publication…)"
                rows={mk.audience?.formats ?? []}
                onChange={(formats) => patchAudience({ formats })}
                placeholderLabel="Réels"
              />
            </div>
          </section>

          {/* ---------------- CAPTURES DE STATS ---------------- */}
          <section className={CARD}>
            <SectionHead
              icon={BarChart3}
              title="Captures de stats"
              right={<span className="text-[12px] tabular-nums text-muted-foreground">{(mk.statsShots ?? []).length}/{MAX_STATS_SHOTS}</span>}
            />
            <div className="flex flex-wrap gap-4">
              {(mk.statsShots ?? []).map((u, i) => (
                <ImageField
                  key={`${i}-${u}`}
                  label=""
                  slug={mk.slug ?? ""}
                  field={`stat-${i}`}
                  url={u}
                  // La corbeille de l'ImageField renvoie null → on retire la capture de la liste.
                  onChange={forSel((nu: string | null) =>
                    setMk((m) => {
                      const next = [...(m.statsShots ?? [])];
                      if (nu) next[i] = nu;
                      else next.splice(i, 1);
                      return { ...m, statsShots: next };
                    }),
                  )}
                  boxClass="h-40 w-[104px]"
                />
              ))}
              {(mk.statsShots ?? []).length < MAX_STATS_SHOTS && (
                <ImageField
                  label=""
                  slug={mk.slug ?? ""}
                  field={`stat-${(mk.statsShots ?? []).length}`}
                  url={null}
                  onChange={forSel((nu: string | null) => {
                    if (nu) setMk((m) => ({ ...m, statsShots: [...(m.statsShots ?? []), nu].slice(0, MAX_STATS_SHOTS) }));
                  })}
                  boxClass="h-40 w-[104px]"
                />
              )}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Jusqu'à {MAX_STATS_SHOTS} captures d'insights (portée, audience, vues…). Elles s'affichent sur le media kit
              public et dans le PDF. Après un upload, clique « Enregistrer » en haut.
            </p>
          </section>

          </div>

          {/* ---------------- PLATEFORMES ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <SectionHead
              icon={Share2}
              title="Plateformes"
              right={
                <button
                  type="button"
                  onClick={importFromCalculator}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Importer followers + ER (calculateur)
                </button>
              }
            />
            <div className="space-y-3">
              {(mk.platforms ?? []).map((p, i) => (
                <PlatformEditor
                  key={i}
                  block={p}
                  slug={mk.slug ?? ""}
                  photo={mk.photos?.[p.key]}
                  onPhotoChange={forSel((u: string | null) => setPhoto(p.key, u))}
                  onChange={(next) => setPlatforms((mk.platforms ?? []).map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setPlatforms((mk.platforms ?? []).filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                onClick={() => setPlatforms([...(mk.platforms ?? []), { key: "instagram" }])}
                className={ADD}
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter une plateforme
              </button>
            </div>
          </section>

          {/* ---------------- TARIFS ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <SectionHead
              icon={Euro}
              title="Tarifs"
              hint={
                <>
                  Prix HT par prestation. Ils s'affichent sur une page « Tarifs » du media kit (web + PDF) et le deck agence
                  indique « à partir de ». Le media kit est une page publique : masque les prix si tu préfères les donner
                  au cas par cas.
                </>
              }
              right={
              <button
                type="button"
                onClick={() => patch({ hideRates: !mk.hideRates })}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-medium transition-colors",
                  !mk.hideRates ? "border border-border bg-muted text-foreground" : "border border-border text-muted-foreground hover:bg-rowhover",
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded", !mk.hideRates ? "bg-foreground text-background" : "border border-border")}>
                  {!mk.hideRates && <Check className="h-3 w-3" />}
                </span>
                {mk.hideRates ? "Prix masqués" : "Prix affichés"}
              </button>
              }
            />
            <RatesEditor rates={mk.rates ?? []} onChange={setRates} />
            <div className="mt-3">
              <label className={LBL}>Mention sous la grille</label>
              <input
                value={mk.ratesNote ?? ""}
                onChange={(e) => patch({ ratesNote: e.target.value })}
                placeholder={DEFAULT_RATES_NOTE}
                className={IN}
              />
            </div>
          </section>

          {/* ---------------- PROFIL CASTING ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <SectionHead
              icon={ListChecks}
              title="Profil casting"
              hint="Alimente le tableau comparatif du deck agence (« qui fait quoi »). Coche ce que la créatrice traite, et précise si utile (ex : Quotidien, Peau sèche, 1 chien)."
            />
            <CastingEditor value={mk.casting ?? {}} onChange={setCasting} />
          </section>

          {/* ---------------- MARQUES ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <SectionHead
              icon={Store}
              title="Marques"
              right={<span className="text-[12px] tabular-nums text-muted-foreground">{(mk.brands ?? []).length} collaboration{(mk.brands ?? []).length > 1 ? "s" : ""}</span>}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(mk.brands ?? []).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ImageField
                    label=""
                    slug={mk.slug ?? ""}
                    field={`logo-${i}`}
                    url={b.logo}
                    kind="logo"
                    onChange={forSel((u: string | null) =>
                      setMk((m) => ({ ...m, brands: (m.brands ?? []).map((x, j) => (j === i ? { ...x, logo: u } : x)) })),
                    )}
                    boxClass="h-10 w-10 shrink-0"
                  />
                  <input
                    value={b.name}
                    onChange={(e) => setBrands((mk.brands ?? []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder="Nom de la marque"
                    className={IN}
                  />
                  <button
                    type="button"
                    onClick={() => setBrands((mk.brands ?? []).filter((_, j) => j !== i))}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setBrands([...(mk.brands ?? []), { name: "" }])}
              className={ADD}
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une marque
            </button>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Ajoute le logo de chaque marque (PNG à fond transparent idéal) — il s'affiche dans le mur de logos du media
              kit ; sans logo, le nom s'affiche en toutes lettres.
            </p>
          </section>
          </>
          )}

          {/* ---------------- MEDIA KIT UGC (format à part) ---------------- */}
          {mode === "ugc" && (
          <section className={`${CARD} xl:col-span-2`}>
            <SectionHead
              icon={Sparkles}
              title="Media kit UGC"
              hint={
                <>
                  Un format à part, orienté <span className="text-foreground">personne</span> (personnalité, quotidien, matériel, portfolio) plutôt
                  que chiffres. Page publique séparée : /mediakit/{mk.slug || "…"}/ugc/.
                </>
              }
              right={
              <button
                type="button"
                onClick={() => patchUgc({ enabled: !ugc.enabled })}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-medium transition-colors",
                  ugc.enabled ? "border border-border bg-muted text-foreground" : "border border-border text-muted-foreground hover:bg-rowhover",
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded", ugc.enabled ? "bg-foreground text-background" : "border border-border")}>
                  {ugc.enabled && <Check className="h-3 w-3" />}
                </span>
                {ugc.enabled ? "Activé" : "Activer pour ce créateur"}
              </button>
              }
            />

            {ugc.enabled && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className={LBL}>Présentation (qui il est, sa personnalité, son univers)</label>
                  <textarea
                    value={ugc.intro ?? ""}
                    onChange={(e) => patchUgc({ intro: e.target.value })}
                    rows={4}
                    placeholder="Ex : Créateur lifestyle basé dans le sud, passionné de rando et de café de spécialité…"
                    className={IN + " resize-y leading-relaxed"}
                  />
                </div>

                {/* Cadre de vie */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className={LBL}>Région</label>
                    <input value={ugc.region ?? ""} onChange={(e) => patchUgc({ region: e.target.value })} placeholder="Sud de la France" className={IN} />
                  </div>
                  <div>
                    <label className={LBL}>Logement</label>
                    <input value={ugc.home ?? ""} onChange={(e) => patchUgc({ home: e.target.value })} placeholder="Maison / Appartement" className={IN} />
                  </div>
                  <div>
                    <label className={LBL}>Animaux</label>
                    <input value={ugc.pets ?? ""} onChange={(e) => patchUgc({ pets: e.target.value })} placeholder="Chien, chat…" className={IN} />
                  </div>
                  <div>
                    <label className={LBL}>Sports / activités</label>
                    <input value={ugc.sports ?? ""} onChange={(e) => patchUgc({ sports: e.target.value })} placeholder="Yoga, surf, running…" className={IN} />
                  </div>
                </div>

                {/* Matériel + anciennes collabs */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className={LBL}>Matériel (un par ligne)</label>
                    <textarea
                      value={ugcLines(ugc.gear)}
                      onChange={(e) => setUgcLines("gear", e.target.value)}
                      rows={4}
                      placeholder={"DJI Osmo Pocket 3\nAppareil photo Sony\niPhone 15 Pro\nRinglight"}
                      className={IN + " resize-y leading-relaxed"}
                    />
                  </div>
                  <div>
                    <label className={LBL}>Anciennes collaborations UGC (une par ligne)</label>
                    <textarea
                      value={ugcLines(ugc.collabs)}
                      onChange={(e) => setUgcLines("collabs", e.target.value)}
                      rows={4}
                      placeholder={"Sephora\nRespire\nGymshark"}
                      className={IN + " resize-y leading-relaxed"}
                    />
                  </div>
                </div>

                {/* @ + abonnés (indicatif) */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LBL}>@ (indicatif)</label>
                    <input value={ugc.handle ?? ""} onChange={(e) => patchUgc({ handle: e.target.value.replace(/^@/, "") })} placeholder="pseudo" className={IN} />
                  </div>
                  <div>
                    <label className={LBL}>Abonnés (indicatif)</label>
                    <input value={ugc.followers ?? ""} onChange={(e) => patchUgc({ followers: e.target.value })} placeholder="Ex : 25 K" className={IN} />
                  </div>
                </div>

                {/* Portfolio visuel */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className={LBL + " mb-0"}>Portfolio — anciens contenus UGC</label>
                    <span className="text-[11px] font-medium text-faint">{(ugc.portfolio ?? []).length}/{MAX_UGC_PORTFOLIO}</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {(ugc.portfolio ?? []).map((u, i) => (
                      <ImageField
                        key={`${i}-${u}`}
                        label=""
                        slug={mk.slug ?? ""}
                        field={`ugc-${i}`}
                        url={u}
                        onChange={forSel((nu: string | null) =>
                          setMk((m) => {
                            const next = [...(m.ugc?.portfolio ?? [])];
                            if (nu) next[i] = nu;
                            else next.splice(i, 1);
                            return { ...m, ugc: { ...(m.ugc ?? {}), portfolio: next } };
                          }),
                        )}
                        boxClass="h-40 w-[104px]"
                      />
                    ))}
                    {(ugc.portfolio ?? []).length < MAX_UGC_PORTFOLIO && (
                      <ImageField
                        label=""
                        slug={mk.slug ?? ""}
                        field={`ugc-${(ugc.portfolio ?? []).length}`}
                        url={null}
                        onChange={forSel((nu: string | null) => {
                          if (nu)
                            setMk((m) => ({
                              ...m,
                              ugc: { ...(m.ugc ?? {}), portfolio: [...(m.ugc?.portfolio ?? []), nu].slice(0, MAX_UGC_PORTFOLIO) },
                            }));
                        })}
                        boxClass="h-40 w-[104px]"
                      />
                    )}
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                    Jusqu'à {MAX_UGC_PORTFOLIO} visuels d'anciens contenus. Après un upload, clique « Enregistrer » en haut.
                  </p>
                </div>
              </div>
            )}
          </section>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sous-éditeurs

/** Critères du tableau comparatif — MÊME liste (clés + ordre) que CASTING dans mediakit-agence.js (site). */
const CASTING_CRITERIA: { key: string; label: string; hint: string }[] = [
  { key: "sport", label: "Sport", hint: "Quotidien, running, Hyrox…" },
  { key: "mode", label: "Mode", hint: "Streetwear, chic…" },
  { key: "beaute", label: "Beauté / skincare", hint: "Peau sèche, experte…" },
  { key: "food", label: "Food", hint: "Healthy, recettes…" },
  { key: "wellness", label: "Bien-être", hint: "Yoga, santé mentale…" },
  { key: "voyage", label: "Voyage", hint: "Europe, long-courrier…" },
  { key: "deco", label: "Déco / maison", hint: "Appartement, maison…" },
  { key: "famille", label: "Famille", hint: "Maman, en couple…" },
  { key: "animaux", label: "Animaux", hint: "1 chien, 2 chats…" },
  { key: "pedago", label: "Contenu pédagogique", hint: "Tutos, conseils…" },
];

function CastingEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const setKey = (k: string, v: string | null) => {
    const next = { ...value };
    if (v === null) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
      {CASTING_CRITERIA.map((c) => {
        const v = value[c.key] ?? "";
        const on = v !== "";
        return (
          <div key={c.key} className="grid grid-cols-[minmax(0,9rem)_auto_minmax(0,1fr)] items-center gap-3 px-3 py-2">
            <span className="truncate text-[13px] font-medium text-foreground">{c.label}</span>
            <button
              type="button"
              onClick={() => setKey(c.key, on ? null : "oui")}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                on ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:bg-rowhover",
              )}
            >
              <Check className={cn("h-3 w-3", !on && "opacity-30")} /> {on ? "Oui" : "Non"}
            </button>
            <input
              value={v === "oui" ? "" : v}
              onChange={(e) => setKey(c.key, e.target.value.trim() ? e.target.value : on ? "oui" : null)}
              placeholder={`Précision (optionnel) — ${c.hint}`}
              className={IN}
            />
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_RATES_NOTE = "Tarifs indicatifs HT — des packages sont proposés selon le dispositif.";
const RATE_PRESETS = ["Story Instagram", "Post Instagram", "Réel Instagram", "Vidéo TikTok", "Contenu UGC", "Pack sur mesure"];

function RatesEditor({ rates, onChange }: { rates: RateRow[]; onChange: (r: RateRow[]) => void }) {
  const set = (i: number, p: Partial<RateRow>) => onChange(rates.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const used = new Set(rates.map((r) => r.label.trim().toLowerCase()));
  const presets = RATE_PRESETS.filter((p) => !used.has(p.toLowerCase()));
  const chip = "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";
  return (
    <div>
      {rates.length > 0 && (
        <div className={LIST}>
          {rates.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center sm:grid-cols-[minmax(0,1.1fr)_150px_minmax(0,1.3fr)_auto]">
              <input value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Réel Instagram" className={BARE} />
              <div className="flex items-center border-l border-border">
                <input
                  value={r.price}
                  onChange={(e) => set(i, { price: e.target.value })}
                  placeholder="1500"
                  inputMode="numeric"
                  className="w-full min-w-0 bg-transparent py-2 pl-3 text-right text-[13px] tabular-nums outline-none placeholder:text-faint focus:bg-rowhover/60"
                />
                <span className="shrink-0 pl-1 pr-3 text-[12px] text-muted-foreground">€ HT</span>
              </div>
              <input
                value={r.detail ?? ""}
                onChange={(e) => set(i, { detail: e.target.value })}
                placeholder="Précision (optionnel), ex : + 2 repartages en story"
                className={cn(BARE, "order-last col-span-3 border-t border-border sm:order-none sm:col-span-1 sm:border-l sm:border-t-0")}
              />
              <button type="button" onClick={() => onChange(rates.filter((_, j) => j !== i))} className={cn(DEL, "mr-1")} aria-label="Supprimer la prestation">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => onChange([...rates, { label: p, price: "" }])} className={chip}>
            <Plus className="h-3 w-3" /> {p}
          </button>
        ))}
        <button type="button" onClick={() => onChange([...rates, { label: "", price: "" }])} className={chip}>
          <Euro className="h-3 w-3" /> Autre prestation
        </button>
      </div>
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  return (
    <div>
      <label className={LBL}>Étiquettes (niche, ville, cible…)</label>
      {tags.length > 0 && (
        <div className={LIST}>
          {tags.map((t, i) => (
            <div key={i} className="flex items-center pr-1">
              <input
                value={t}
                onChange={(e) => onChange(tags.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="Lifestyle & Blogging"
                className={BARE}
              />
              <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))} className={DEL} aria-label="Supprimer l'étiquette">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...tags, ""])} className={ADD}>
        <Plus className="h-3.5 w-3.5" /> Ajouter une étiquette
      </button>
    </div>
  );
}

function PctList({
  title,
  rows,
  onChange,
  placeholderLabel,
}: {
  title: string;
  rows: PctRow[];
  onChange: (r: PctRow[]) => void;
  placeholderLabel: string;
}) {
  return (
    <div>
      <label className={LBL}>{title}</label>
      {rows.length > 0 && (
        <div className={LIST}>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center pr-1">
              <input
                value={r.label}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder={placeholderLabel}
                className={BARE}
              />
              <PctCell value={r.pct} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, pct: v } : x)))} placeholder="49" />
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className={DEL} aria-label="Supprimer la ligne">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...rows, { label: "", pct: "" }])} className={ADD}>
        <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
      </button>
    </div>
  );
}

function CountryList({ rows, onChange, title = "Localisation (pays)", placeholder = "France" }: { rows: CountryRow[]; onChange: (r: CountryRow[]) => void; title?: string; placeholder?: string }) {
  return (
    <div>
      <label className={LBL}>{title}</label>
      {rows.length > 0 && (
        <div className={LIST}>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center pr-1">
              <input
                value={r.name}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder={placeholder}
                className={BARE}
              />
              <PctCell value={r.pct} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, pct: v } : x)))} placeholder="77" />
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className={DEL} aria-label="Supprimer la ligne">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...rows, { name: "", pct: "" }])} className={ADD}>
        <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
      </button>
    </div>
  );
}

function PlatformEditor({
  block,
  slug,
  photo,
  onPhotoChange,
  onChange,
  onRemove,
}: {
  block: PlatformBlock;
  slug: string;
  photo?: string | null;
  onPhotoChange: (url: string | null) => void;
  onChange: (b: PlatformBlock) => void;
  onRemove: () => void;
}) {
  const extras = PLATFORM_FIELDS[block.key] ?? [];
  const set = (k: keyof PlatformBlock, v: string) => onChange({ ...block, [k]: v });
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-foreground">
          <PlatformIcon platform={block.key} className="h-4 w-4" />
        </span>
        <Select value={block.key} onValueChange={(v) => onChange({ ...block, key: v })}>
          <SelectTrigger className="h-9 w-auto min-w-[150px] rounded-lg bg-surface" placeholder="Plateforme" />
          <SelectContent>
            {PLATFORM_OPTIONS.map((p, i) => (
              <SelectItem key={p.key} index={i} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRemove}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={LBL}>Followers</label>
          <input value={block.followers ?? ""} onChange={(e) => set("followers", e.target.value)} placeholder="10,3K" className={IN} />
        </div>
        <div>
          <label className={LBL}>Taux d'engagement</label>
          <input value={block.er ?? ""} onChange={(e) => set("er", e.target.value)} placeholder="0,89%" className={IN} />
        </div>
        <div>
          <label className={LBL}>Tranche d'âge principale</label>
          <input value={block.ageBracket ?? ""} onChange={(e) => set("ageBracket", e.target.value)} placeholder="18–24" className={IN} />
        </div>
        {extras.map((f) => (
          <div key={String(f.key)}>
            <label className={LBL}>{f.label}</label>
            <input
              value={(block[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder="—"
              className={IN}
            />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <ImageField label="Capture du profil" slug={slug} field={block.key} url={photo} onChange={onPhotoChange} boxClass="h-40 w-24" />
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">Bloc « {platLabel(block.key)} », page « Plateforme » du media kit.</p>
    </div>
  );
}


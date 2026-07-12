import { useEffect, useState } from "react";
import { Plus, Trash2, Save, ExternalLink, Wand2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbUpdate } from "@/lib/db";
import { useCreators } from "@/lib/useCreators";
import { getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { titleCase } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PlatformIcon } from "@/components/ui/platform-icon";

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
};
type BrandRow = { name: string; logo?: string | null };
type MediaKit = {
  slug?: string;
  bio?: string;
  tags?: string[];
  audience?: {
    age?: PctRow[];
    gender?: { femmes?: string; hommes?: string };
    pays?: CountryRow[];
    formats?: PctRow[];
  };
  platforms?: PlatformBlock[];
  brands?: BrandRow[];
  photos?: { hero?: string | null; contact?: string | null; instagram?: string | null; tiktok?: string | null };
};

// Champs SUPPLÉMENTAIRES par plateforme (en plus de followers / ER / tranche d'âge).
const PLATFORM_FIELDS: Record<string, { key: keyof PlatformBlock; label: string }[]> = {
  instagram: [
    { key: "impressions30j", label: "Impressions / comptes touchés (30 j)" },
    { key: "nonFollowersPct", label: "Non-followers touchés (%)" },
    { key: "bestFormatPct", label: "Meilleur format — % (ex. Réels)" },
  ],
  tiktok: [
    { key: "likesTotal", label: "J'aime cumulés" },
    { key: "views30j", label: "Vues (30 j)" },
    { key: "newViewers30j", label: "Nouveaux spectateurs (30 j)" },
  ],
  youtube: [
    { key: "views30j", label: "Vues (30 j)" },
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

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const LBL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint";
const CARD = "rounded-2xl border border-border bg-surface p-4 shadow-sm";

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

export function MediakitEditor() {
  const creators = useCreators();
  const [selId, setSelId] = useState("");
  const selected = creators.find((c) => c.id === selId) ?? null;
  const [mk, setMk] = useState<MediaKit>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Charge le blob mediakit de la créatrice choisie.
  useEffect(() => {
    if (!selId) {
      setMk({});
      return;
    }
    let alive = true;
    setLoading(true);
    supabase
      .from("creators")
      .select("mediakit")
      .eq("id", selId)
      .limit(1)
      .then(({ data }) => {
        if (!alive) return;
        const blob = (data?.[0]?.mediakit as MediaKit | null) ?? {};
        // slug par défaut = prénom de la créatrice
        if (!blob.slug && selected) blob.slug = slugify((selected.name || "").split(/\s+/)[0]);
        setMk(blob);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  // ---- helpers d'édition immuables ----
  const patch = (p: Partial<MediaKit>) => setMk((m) => ({ ...m, ...p }));
  const patchAudience = (p: Partial<NonNullable<MediaKit["audience"]>>) =>
    setMk((m) => ({ ...m, audience: { ...m.audience, ...p } }));

  const save = async () => {
    if (!selId || saving) return;
    setSaving(true);
    try {
      const clean: MediaKit = { ...mk, slug: (mk.slug || "").trim() || slugify((selected?.name || "").split(/\s+/)[0]) };
      const ok = await dbUpdate("creators", selId, { mediakit: clean });
      if (!ok) return toast("Enregistrement échoué — réessaie");
      setMk(clean);
      toast("Media kit enregistré ✓");
    } finally {
      setSaving(false);
    }
  };

  // Importe followers + ER (dernière mesure par plateforme) depuis le calculateur.
  const importFromCalculator = async () => {
    if (!selected) return;
    invalidateAppState();
    const st = (await getAppState()) as AppState;
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
          followers: platforms[i].followers || (h.followers ?? ""),
          er: platforms[i].er || (h.er ?? "").replace(/\s/g, ""),
        };
      }
      return { ...m, platforms };
    });
    toast(`Followers + ER importés (${latest.size} plateforme${latest.size > 1 ? "s" : ""}) ✓`);
  };

  // ---- petites listes éditables ----
  const setTags = (tags: string[]) => patch({ tags });
  const setBrands = (brands: BrandRow[]) => patch({ brands });
  const setPlatforms = (platforms: PlatformBlock[]) => patch({ platforms });

  const publicUrl = mk.slug ? `https://ttpcreators.pro/mediakit/${mk.slug}/` : null;

  return (
    <div className="space-y-4">
      {/* En-tête : créatrice + voir + enregistrer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={selId} onValueChange={setSelId}>
          <SelectTrigger className="h-10 w-auto min-w-[220px] rounded-xl bg-surface" placeholder="Choisir une créatrice" />
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
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Voir le media kit</span>
              </a>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        )}
      </div>

      {!selId ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center shadow-sm">
          <ImageIcon className="mx-auto h-8 w-8 text-faint" />
          <div className="mt-3 text-sm font-medium text-foreground">Choisis une créatrice</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Remplis son media kit — il se met à jour en ligne sur ttpcreators.pro/mediakit/&lt;lien&gt;.
          </p>
        </div>
      ) : loading ? (
        <div className={`${CARD} text-sm text-muted-foreground`}>Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* ---------------- PROFIL ---------------- */}
          <section className={CARD}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Profil</h3>
            <div className="space-y-3">
              <div>
                <label className={LBL}>Lien (adresse de la page)</label>
                <div className="flex items-center gap-1 text-sm">
                  <span className="shrink-0 text-faint">ttpcreators.pro/mediakit/</span>
                  <input
                    value={mk.slug ?? ""}
                    onChange={(e) => patch({ slug: slugify(e.target.value) })}
                    placeholder="candice"
                    className={IN}
                  />
                </div>
              </div>
              <div>
                <label className={LBL}>Bio (2 phrases)</label>
                <textarea
                  value={mk.bio ?? ""}
                  onChange={(e) => patch({ bio: e.target.value })}
                  rows={4}
                  placeholder="Candice est une créatrice lifestyle & blogging basée à Paris…"
                  className={`${IN} resize-y`}
                />
              </div>
              <TagEditor tags={mk.tags ?? []} onChange={setTags} />
            </div>
          </section>

          {/* ---------------- AUDIENCE ---------------- */}
          <section className={CARD}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Audience</h3>
            <div className="space-y-4">
              <PctList
                title="Tranches d'âge"
                rows={mk.audience?.age ?? []}
                onChange={(age) => patchAudience({ age })}
                placeholderLabel="18–24 ans"
              />
              <div>
                <label className={LBL}>Genre (%)</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs text-muted-foreground">Femmes</span>
                    <input
                      value={mk.audience?.gender?.femmes ?? ""}
                      onChange={(e) => patchAudience({ gender: { ...mk.audience?.gender, femmes: e.target.value } })}
                      placeholder="29"
                      className={IN}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs text-muted-foreground">Hommes</span>
                    <input
                      value={mk.audience?.gender?.hommes ?? ""}
                      onChange={(e) => patchAudience({ gender: { ...mk.audience?.gender, hommes: e.target.value } })}
                      placeholder="71"
                      className={IN}
                    />
                  </div>
                </div>
              </div>
              <CountryList
                rows={mk.audience?.pays ?? []}
                onChange={(pays) => patchAudience({ pays })}
              />
              <PctList
                title="Formats (Réels / Story / Publication…)"
                rows={mk.audience?.formats ?? []}
                onChange={(formats) => patchAudience({ formats })}
                placeholderLabel="Réels"
              />
            </div>
          </section>

          {/* ---------------- PLATEFORMES ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Plateformes</h3>
              <button
                type="button"
                onClick={importFromCalculator}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <Wand2 className="h-3.5 w-3.5" /> Importer followers + ER (calculateur)
              </button>
            </div>
            <div className="space-y-3">
              {(mk.platforms ?? []).map((p, i) => (
                <PlatformEditor
                  key={i}
                  block={p}
                  onChange={(next) => setPlatforms((mk.platforms ?? []).map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setPlatforms((mk.platforms ?? []).filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                onClick={() => setPlatforms([...(mk.platforms ?? []), { key: "instagram" }])}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter une plateforme
              </button>
            </div>
          </section>

          {/* ---------------- MARQUES ---------------- */}
          <section className={`${CARD} xl:col-span-2`}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Marques ({(mk.brands ?? []).length} collaboration{(mk.brands ?? []).length > 1 ? "s" : ""})
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(mk.brands ?? []).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
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
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une marque
            </button>
            <p className="mt-2 text-[11px] text-faint">Les logos s'ajouteront à l'étape suivante (upload d'images).</p>
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sous-éditeurs

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  return (
    <div>
      <label className={LBL}>Étiquettes (niche, ville, cible…)</label>
      <div className="space-y-2">
        {tags.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={t}
              onChange={(e) => onChange(tags.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="Lifestyle & Blogging"
              className={IN}
            />
            <button
              type="button"
              onClick={() => onChange(tags.filter((_, j) => j !== i))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...tags, ""])}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter une étiquette
        </button>
      </div>
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
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={r.label}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              placeholder={placeholderLabel}
              className={IN}
            />
            <div className="flex w-24 shrink-0 items-center gap-1">
              <input
                value={r.pct}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                placeholder="49"
                className={`${IN} text-right`}
              />
              <span className="text-xs text-faint">%</span>
            </div>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...rows, { label: "", pct: "" }])}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
        </button>
      </div>
    </div>
  );
}

function CountryList({ rows, onChange }: { rows: CountryRow[]; onChange: (r: CountryRow[]) => void }) {
  return (
    <div>
      <label className={LBL}>Localisation (pays)</label>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={r.name}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              placeholder="France"
              className={IN}
            />
            <div className="flex w-24 shrink-0 items-center gap-1">
              <input
                value={r.pct}
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                placeholder="77"
                className={`${IN} text-right`}
              />
              <span className="text-xs text-faint">%</span>
            </div>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...rows, { name: "", pct: "" }])}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter un pays
        </button>
      </div>
    </div>
  );
}

function PlatformEditor({
  block,
  onChange,
  onRemove,
}: {
  block: PlatformBlock;
  onChange: (b: PlatformBlock) => void;
  onRemove: () => void;
}) {
  const extras = PLATFORM_FIELDS[block.key] ?? [];
  const set = (k: keyof PlatformBlock, v: string) => onChange({ ...block, [k]: v });
  return (
    <div className="rounded-xl border border-border bg-card p-3">
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
      <p className="mt-2 text-[10px] text-faint">Bloc « {platLabel(block.key)} » — page « Plateforme » du media kit.</p>
    </div>
  );
}

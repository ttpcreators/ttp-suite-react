import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Plus, Trash2, Camera, Loader2, Calculator, ArrowUp, Rows3, Layers } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";
import { downscaleImage } from "@/components/ui/image-field";
import { cn } from "@/lib/utils";
import {
  totalsOf,
  parseNum,
  fmtCompact,
  fmtPct,
  emptyStat,
  erVerdict,
  type PostStat,
  type EngTotals,
} from "@/lib/engagement";

export type Shot = { path: string; name: string };
export type ErBasis = "reach" | "followers";
export type CalcMode = "global" | "detail";

/* ─────────────────────────── Captures d'écran ───────────────────────────
 * Bucket `documents` (PRIVÉ), pas `avatars` (public) : les insights d'une créatrice
 * sont de la donnée d'affaires interne. On stocke le CHEMIN dans le debrief, jamais
 * l'URL — une URL signée expire, un chemin non. On resigne à l'affichage.
 */
const SIGN_TTL = 60 * 60 * 24 * 7; // 7 j : couvre l'aperçu, le PDF et l'email envoyé.
const signCache = new Map<string, { url: string; exp: number }>();

export async function signShot(path: string): Promise<string | null> {
  const hit = signCache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, SIGN_TTL);
  if (error || !data?.signedUrl) return null;
  signCache.set(path, { url: data.signedUrl, exp: Date.now() + SIGN_TTL * 1000 });
  return data.signedUrl;
}

/** Résout les URL signées d'une liste de captures (map chemin → URL). */
export async function resolveShots(shots: Shot[] | undefined): Promise<Record<string, string>> {
  const pairs = await Promise.all((shots ?? []).map(async (s) => [s.path, await signShot(s.path)] as const));
  const out: Record<string, string> = {};
  for (const [p, u] of pairs) if (u) out[p] = u;
  return out;
}

/** Version hook de `resolveShots`, pour l'affichage. */
export function useShotUrls(shots: Shot[] | undefined): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = (shots ?? []).map((s) => s.path).join("|");
  useEffect(() => {
    let alive = true;
    if (!key) return;
    void resolveShots(key.split("|").map((path) => ({ path, name: "" }))).then((next) => {
      if (alive) setUrls(next);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return urls;
}

/** Bandeau de vignettes en lecture seule (carte de debrief). */
export function ShotStrip({ shots }: { shots: Shot[] | undefined }) {
  const urls = useShotUrls(shots);
  if (!shots || shots.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {shots.map((s) => {
        const url = urls[s.path];
        return url ? (
          <a
            key={s.path}
            href={url}
            target="_blank"
            rel="noreferrer"
            title={`Ouvrir ${s.name}`}
            className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-border transition-opacity hover:opacity-80"
          >
            <img src={url} alt={s.name} className="h-full w-full object-cover" />
          </a>
        ) : (
          <div key={s.path} className="h-14 w-11 shrink-0 animate-pulse rounded-md border border-border bg-panel" />
        );
      })}
    </div>
  );
}

function Thumb({ shot, url, onRemove }: { shot: Shot; url?: string; onRemove: () => void }) {
  return (
    <div className="group relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-panel">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title={`Ouvrir ${shot.name}`}>
          <img src={url} alt={shot.name} className="h-full w-full object-cover" />
        </a>
      ) : (
        <div className="grid h-full w-full place-items-center text-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Retirer la capture"
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-md bg-black/55 text-white opacity-0 transition-opacity hover:bg-[#E5484D] group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ─────────────────────────── Petit champ nombre ─────────────────────────── */
function NumField({
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", wide && "col-span-2")}>
      <span className="truncate text-[8px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] tabular-nums outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );
}

/** Une ligne = une publication (mode détaillé). Les valeurs restent en TEXTE tant que
 *  l'utilisateur tape (« 12,3 K » doit pouvoir s'écrire), la conversion est faite au calcul. */
type Row = { id: string; kind: string; reach: string; likes: string; comments: string; saves: string; shares: string; views: string };

const KINDS = ["Reel", "Post", "Carrousel", "Story", "TikTok", "Short", "YouTube"];

const rowToStat = (r: Row): PostStat => ({
  ...emptyStat(r.id, r.kind),
  reach: parseNum(r.reach),
  likes: parseNum(r.likes),
  comments: parseNum(r.comments),
  saves: parseNum(r.saves),
  shares: parseNum(r.shares),
  views: parseNum(r.views),
});

const statToRow = (s: PostStat): Row => ({
  id: s.id,
  kind: s.kind,
  reach: s.reach ? String(s.reach) : "",
  likes: s.likes ? String(s.likes) : "",
  comments: s.comments ? String(s.comments) : "",
  saves: s.saves ? String(s.saves) : "",
  shares: s.shares ? String(s.shares) : "",
  views: s.views ? String(s.views) : "",
});

let _rid = 0;
const rid = () => `p${Date.now().toString(36)}${(_rid += 1)}`;
const blankRow = (kind = "Reel"): Row => ({ id: rid(), kind, reach: "", likes: "", comments: "", saves: "", shares: "", views: "" });

export type CalcState = {
  mode: CalcMode;
  stats: PostStat[];
  followers: string;
  postsCount: string;
  basis: ErBasis;
  shots: Shot[];
};

export function DebriefCalculator({
  slug,
  state,
  onChange,
  onApply,
}: {
  slug: string;
  state: CalcState;
  onChange: (s: CalcState) => void;
  /** Renvoie couverture + taux formatés vers les indicateurs du debrief. */
  onApply: (v: { reach: string; engagement: string }) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    state.stats.length ? state.stats.map(statToRow) : [blankRow()],
  );
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shotUrls = useShotUrls(state.shots);

  const { mode, followers, postsCount, basis, shots } = state;
  const set = (patch: Partial<CalcState>) => onChange({ ...state, ...patch });

  // Les lignes sont l'état de saisie ; on remonte les stats normalisées au parent à
  // chaque frappe pour qu'un enregistrement du debrief capture bien la dernière valeur.
  const pushRows = (next: Row[]) => {
    setRows(next);
    onChange({ ...state, stats: next.map(rowToStat) });
  };
  const patchRow = (id: string, patch: Partial<Row>) => pushRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const stats = rows.map(rowToStat);
  const override = mode === "global" ? parseNum(postsCount) : undefined;
  const t: EngTotals = totalsOf(stats, parseNum(followers), override);
  const er = basis === "reach" ? t.erReach : t.erFollowers;
  const verdict = erVerdict(t.erReach);
  const hasData = t.reach > 0 || t.interactions > 0;

  const apply = () => {
    if (!hasData) return toast("Renseigne au moins la couverture ou les interactions");
    if (er === null) {
      toast(basis === "followers" ? "Indique le nombre d'abonnés" : "Indique la couverture");
      return;
    }
    onApply({ reach: t.reach > 0 ? fmtCompact(t.reach) : "", engagement: fmtPct(er) });
    toast("Indicateurs mis à jour ✓");
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    const added: Shot[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) continue;
      if (file.size > 12 * 1024 * 1024) {
        toast(`« ${file.name} » trop lourde (max 12 Mo)`);
        continue;
      }
      // Une capture d'insights est un écran de téléphone : 1600 px de côté long
      // gardent les chiffres parfaitement lisibles pour ~10× moins de poids.
      let blob: Blob = file;
      try {
        blob = await downscaleImage(file, 1600, "image/jpeg", 0.9);
      } catch {
        blob = file; // repli : l'original tel quel
      }
      const s = (slug || "debrief").replace(/[^a-z0-9-]/g, "") || "debrief";
      const path = `debrief/${s}/${Date.now()}-${added.length}.jpg`;
      const { error } = await supabase.storage.from("documents").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) {
        toast(`Échec de l'envoi de « ${file.name} »`);
        continue;
      }
      added.push({ path, name: file.name });
    }
    setBusy(false);
    if (added.length) {
      set({ shots: [...shots, ...added] });
      toast(`${added.length} capture${added.length > 1 ? "s" : ""} jointe${added.length > 1 ? "s" : ""} ✓ — pense à enregistrer`);
    }
  };

  const removeShot = async (path: string) => {
    set({ shots: shots.filter((s) => s.path !== path) });
    signCache.delete(path);
    // Best-effort : si la suppression du fichier échoue, le debrief ne le référence
    // plus de toute façon — on ne bloque pas l'utilisateur là-dessus.
    await supabase.storage.from("documents").remove([path]).catch(() => {});
  };

  const modeBtn = (m: CalcMode, Icon: typeof Rows3, label: string, hint: string) => (
    <button
      key={m}
      type="button"
      onClick={() => set({ mode: m })}
      title={hint}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
        mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="min-w-full rounded-xl border border-border bg-panel p-3.5">
      {/* En-tête */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-faint">
          <Calculator className="h-3.5 w-3.5" /> Calculateur d'engagement
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          {modeBtn("global", Layers, "Global", "Les totaux + le nombre de publications")}
          {modeBtn("detail", Rows3, "Par publication", "Une ligne par publication")}
        </div>
      </div>

      {/* Base de compte */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumField label="Abonnés du compte" value={followers} onChange={(v) => set({ followers: v })} placeholder="45 000" />
        {mode === "global" && (
          <NumField label="Nb de publications" value={postsCount} onChange={(v) => set({ postsCount: v })} placeholder="4" />
        )}
      </div>

      {/* Saisie */}
      <div className="flex flex-col gap-2">
        {(mode === "global" ? rows.slice(0, 1) : rows).map((r, i) => (
          <div key={r.id} className="rounded-lg border border-border bg-surface p-2.5">
            <div className="mb-2 flex items-center gap-2">
              {mode === "detail" ? (
                <>
                  <select
                    value={r.kind}
                    onChange={(e) => patchRow(r.id, { kind: e.target.value })}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold outline-none focus:border-primary"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-faint">Publication {i + 1}</span>
                  <div className="flex-1" />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => pushRows(rows.filter((x) => x.id !== r.id))}
                      title="Retirer cette publication"
                      className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Totaux de la campagne — additionne les captures
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <NumField label="Couverture" value={r.reach} onChange={(v) => patchRow(r.id, { reach: v })} placeholder="120 K" />
              <NumField label="J'aime" value={r.likes} onChange={(v) => patchRow(r.id, { likes: v })} placeholder="8 400" />
              <NumField label="Comment." value={r.comments} onChange={(v) => patchRow(r.id, { comments: v })} placeholder="210" />
              <NumField label="Enregistr." value={r.saves} onChange={(v) => patchRow(r.id, { saves: v })} placeholder="640" />
              <NumField label="Partages" value={r.shares} onChange={(v) => patchRow(r.id, { shares: v })} placeholder="180" />
              <NumField label="Vues" value={r.views} onChange={(v) => patchRow(r.id, { views: v })} placeholder="210 K" />
            </div>
          </div>
        ))}
      </div>

      {mode === "detail" && (
        <button
          type="button"
          onClick={() => pushRows([...rows, blankRow()])}
          className="mt-2 flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover"
        >
          <Plus className="h-3.5 w-3.5" /> Publication
        </button>
      )}

      {/* Résultat */}
      <div className="mt-3 rounded-lg border border-border bg-surface p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Publications", String(t.posts)],
            ["Couverture", fmtCompact(t.reach)],
            ["Interactions", fmtCompact(t.interactions)],
            ["Vues", fmtCompact(t.views)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-panel px-2.5 py-2">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-faint">{l}</div>
              <div className="mt-0.5 text-[15px] font-bold leading-none tabular-nums text-foreground">{v}</div>
            </div>
          ))}
        </div>

        {/* Les deux taux, côte à côte : celui sélectionné part dans le debrief. */}
        <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["reach", "Sur la couverture", t.erReach, "interactions ÷ comptes touchés — le taux que regarde la marque"],
              ["followers", "Sur les abonnés", t.erFollowers, "interactions par publication ÷ abonnés — le taux « media kit »"],
            ] as [ErBasis, string, number | null, string][]
          ).map(([b, label, val, hint]) => (
            <button
              key={b}
              type="button"
              onClick={() => set({ basis: b })}
              title={hint}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                basis === b ? "border-primary bg-primary/5" : "border-border hover:bg-rowhover",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</span>
                {basis === b && <span className="text-[8px] font-bold uppercase tracking-wide text-primary">Retenu</span>}
              </div>
              <div className="mt-0.5 text-xl font-bold leading-none tabular-nums text-foreground">{fmtPct(val)}</div>
            </button>
          ))}
        </div>

        {verdict && t.erReach !== null && (
          <div className="mt-2 text-[10px] text-faint">
            Repère : {verdict.label.toLowerCase()} — sur la couverture, le secteur situe un bon taux au-dessus de 4 %.
          </div>
        )}

        <button
          type="button"
          onClick={apply}
          disabled={!hasData}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-3.5 w-3.5" /> Reprendre dans les indicateurs
        </button>
      </div>

      {/* Captures */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">
            Captures des stats {shots.length > 0 && <span className="text-muted-foreground">· {shots.length}</span>}
          </span>
          <button
            type="button"
            onClick={() => !busy && fileRef.current?.click()}
            className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover disabled:opacity-50"
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Joindre
          </button>
        </div>
        {shots.length === 0 ? (
          <div className="text-[11px] text-faint">
            Joins les captures d'insights reçues du créateur — elles restent privées, en pièce jointe du debrief.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shots.map((s) => (
              <Thumb key={s.path} shot={s} url={shotUrls[s.path]} onRemove={() => removeShot(s.path)} />
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles} className="hidden" />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/appState";
import type { AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

/** Ligne `creators` (colonnes utiles au média kit). */
type Creator = {
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  followers: string | null;
  er: string | null;
  reach: string | null;
  ca: string | null;
  photo_url: string | null;
};

/** Override éditable stocké dans le blob `mediaKitData` (indexé par position roster). */
type MkOverride = {
  bio?: string;
  age?: string;
  agePct?: string;
  gender?: string;
};
type MediaKitData = Record<number, MkOverride>;

const DEFAULT_AGE = "18–34 ans";
const DEFAULT_AGE_PCT = "64%";
const DEFAULT_GENDER = "Femmes 65% · Hommes 35%";

/** _mkGet : override non vide, sinon défaut. */
function mkGet<K extends keyof MkOverride>(
  ov: MkOverride,
  key: K,
  def: string,
): string {
  const v = ov[key];
  return v !== undefined && v !== "" ? v : def;
}

export function Mediakit() {
  const creators = useCreators();
  const { data: mkData } = useAppState<MediaKitData>(
    (s: AppState) => (s["mediaKitData"] as MediaKitData) ?? {},
  );

  // Sélecteur créateur : défaut le 1er.
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected == null && creators.length > 0) setSelected(creators[0].name);
  }, [creators, selected]);

  // Fiche complète du créateur choisi.
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true);
    supabase
      .from("creators")
      .select("*")
      .eq("name", selected)
      .limit(1)
      .then(({ data }) => {
        if (!alive) return;
        setCreator((data?.[0] as Creator) ?? null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Overrides éventuels (indexés par position dans le roster).
  const selIndex = creators.findIndex((c) => c.name === selected);
  const ov: MkOverride = (mkData && selIndex >= 0 && mkData[selIndex]) || {};

  // État de chargement.
  if (creators.length === 0 || (selected && loading && !creator)) {
    return (
      <div className="grid place-items-center rounded-2xl border border-border bg-surface p-16 text-sm text-muted-foreground shadow-sm">
        Chargement du média kit…
      </div>
    );
  }

  // État vide (aucun créateur trouvé en base pour la sélection).
  if (!creator) {
    return (
      <div>
        <CreatorPicker
          creators={creators}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="grid place-items-center rounded-2xl border border-border bg-surface p-16 text-sm text-muted-foreground shadow-sm">
          Aucune fiche créateur pour cette sélection.
        </div>
      </div>
    );
  }

  const fn = creator.name.split(" ")[0];
  const bio = mkGet(
    ov,
    "bio",
    `${fn}, créateur ${(creator.niche ?? "lifestyle").toLowerCase()} représenté(e) par TTP Agency. Contenus premium, audience engagée et collaborations à forte conversion.`,
  );
  const age = mkGet(ov, "age", DEFAULT_AGE);
  const agePct = mkGet(ov, "agePct", DEFAULT_AGE_PCT);
  const gender = mkGet(ov, "gender", DEFAULT_GENDER);
  const femM = /(\d+)%/.exec(gender);
  const fem = femM ? Number(femM[1]) : 65;

  const stats: { label: string; value: string }[] = [
    { label: "Abonnés", value: creator.followers || "—" },
    { label: "Engagement", value: creator.er || "—" },
    { label: "Reach / mois", value: creator.reach || "—" },
    { label: "CA / mois", value: creator.ca || "—" },
  ];

  const copyKit = async () => {
    const meta = [creator.handle, creator.niche, creator.platform]
      .filter(Boolean)
      .join(" · ");
    const summary = [
      `MEDIA KIT · ${titleCase(creator.name)}`,
      meta,
      "",
      stats.map((s) => `${s.label} : ${s.value}`).join("\n"),
      "",
      `Audience : ${age} · ${agePct}`,
      gender,
      "",
      bio,
      "",
      "— TTP Agency · Trust the process",
    ]
      .filter((l) => l !== undefined)
      .join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      toast("Média kit copié ✓");
    } catch {
      toast("Copie impossible — réessaie");
    }
  };

  return (
    <div>
      <CreatorPicker
        creators={creators}
        selected={selected}
        onSelect={setSelected}
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <CreatorAvatar
              name={creator.name}
              photoUrl={creator.photo_url}
              className="h-[76px] w-[76px] rounded-2xl text-xl"
            />
            <div className="min-w-0">
              <div className="text-2xl font-semibold tracking-tight md:text-3xl">
                {titleCase(creator.name)}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <span className="text-sm text-muted-foreground">
                  {creator.handle || "—"}
                </span>
                {creator.niche && (
                  <span className="rounded-full bg-signalsoft px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-signaltext">
                    {creator.niche}
                  </span>
                )}
                {creator.platform && (
                  <span className="text-xs text-faint">{creator.platform}</span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold tracking-tight text-foreground">
              TTP AGENCY
            </div>
            <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
              Media kit · 2026
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-panel p-[18px]">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">
                {s.label}
              </div>
              <div className="mt-2 whitespace-nowrap text-2xl font-bold tracking-tight">
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Audience + Bio */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-panel p-[22px]">
            <div className="mb-4 text-sm font-semibold text-foreground">
              Audience
            </div>
            <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-faint">
              Répartition
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-md bg-border">
              <div className="bg-signal" style={{ width: `${fem}%` }} />
              <div className="bg-muted-foreground" style={{ width: `${100 - fem}%` }} />
            </div>
            <div className="mt-2 text-[11px] font-medium text-muted-foreground">
              {gender}
            </div>
            <div className="mb-1.5 mt-4 text-[9px] font-semibold uppercase tracking-wide text-faint">
              Âge dominant
            </div>
            <div className="text-sm font-semibold text-foreground">
              {age} · {agePct}
            </div>
          </div>

          <div className="rounded-xl bg-panel p-[22px]">
            <div className="mb-3 text-sm font-semibold text-foreground">Bio</div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {bio}
            </p>
          </div>
        </div>

        {/* Footer + action */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div className="text-[11px] font-medium text-faint">
            Contact agence · partnerships@ttpcreators.pro · Lyon, France
          </div>
          <button
            onClick={copyKit}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Copy className="h-3.5 w-3.5" /> Copier le média kit
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sélecteur déroulant compact de créateur (picker : valeur = créateur sélectionné). */
function CreatorPicker({
  creators,
  selected,
  onSelect,
}: {
  creators: { id: string; name: string; photo_url: string | null }[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const value = selected ?? creators[0]?.name ?? "";
  return (
    <div className="mb-4 w-fit max-w-full">
      <Select value={value} onValueChange={onSelect}>
        <SelectTrigger
          className="h-9 w-auto min-w-[190px] rounded-full bg-surface"
          placeholder="Choisir un créateur"
        />
        <SelectContent>
          {creators.map((c, i) => (
            <SelectItem key={c.id} index={i} value={c.name}>
              {titleCase(c.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

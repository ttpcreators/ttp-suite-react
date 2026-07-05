import { useEffect, useState, type ReactNode } from "react";
import { Copy, Pencil, Eye, FileText, Plus, Trash2, X, ExternalLink, Archive } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbInsert, dbDelete } from "@/lib/db";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { useAppState, saveAppStateKey } from "@/lib/appState";
import type { AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { TextField } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

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
  instagram: string | null;
  tiktok: string | null;
};

type ContentLink = { id: string; title: string; platform: string; url: string; views: string };
type Package = { id: string; name: string; price: string; desc: string };

/** Media kit archivé : fichier HTML dans le bucket privé `documents` +
 *  fiche `documents` (type "mediakit") → visible par le créateur dans son espace. */
type ArchiveRow = {
  id: string;
  creator: string | null;
  name: string;
  size: string | null;
  path: string;
  created_at: string | null;
};
function archMonthKey(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "?";
}
function archMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Override éditable stocké dans le blob `mediaKitData` (indexé par position roster). */
type MkOverride = {
  bio?: string;
  age?: string;
  agePct?: string;
  gender?: string;
  location?: string;
  avgViews?: string;
  growth?: string;
  formats?: string;
  collabs?: string;
  services?: string;
  content?: ContentLink[];
  packages?: Package[];
};
type MediaKitData = Record<number, MkOverride>;

const DEFAULT_AGE = "18–34 ans";
const DEFAULT_AGE_PCT = "64%";
const DEFAULT_GENDER = "Femmes 65% · Hommes 35%";
const DEFAULT_LOCATION = "France 72% · Belgique 11% · Suisse 7%";
const DEFAULT_FORMATS = "Reels · Stories · UGC · Post collab · YouTube intégration";
const DEFAULT_PACKAGES: Package[] = [
  { id: "pk-reel", name: "Reel dédié", price: "sur devis", desc: "Concept + tournage + montage, publication feed + story de rappel." },
  { id: "pk-story", name: "Pack Stories", price: "sur devis", desc: "3 à 5 stories avec lien / sticker et call-to-action." },
  { id: "pk-ugc", name: "UGC", price: "sur devis", desc: "Contenu livré à la marque, droits d'usage inclus (sans diffusion)." },
];

let _uid = 0;
const uid = () => `mk${Date.now().toString(36)}${(_uid += 1)}`;

function mkGet<K extends keyof MkOverride>(ov: MkOverride, key: K, def: string): string {
  const v = ov[key];
  return typeof v === "string" && v !== "" ? v : def;
}

function splitList(s: string): string[] {
  return s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

// ─── Média kit HTML (exportable / imprimable en PDF) ─────────────────────────

function mediaKitHTML(o: {
  creator: Creator;
  bio: string;
  stats: { label: string; value: string }[];
  age: string;
  agePct: string;
  gender: string;
  location: string;
  avgViews: string;
  formats: string[];
  brands: string[];
  services: string;
  packages: Package[];
  content: ContentLink[];
  fem: number;
}): string {
  const { creator, bio, stats, age, agePct, gender, location, avgViews, formats, brands, services, packages, content, fem } = o;
  const meta = [creator.handle, creator.niche, creator.platform].filter(Boolean).map(esc).join(" · ");

  const statCells = stats
    .map(
      (s) =>
        `<div class="stat"><div class="stat-l">${esc(s.label)}</div><div class="stat-v">${esc(s.value)}</div></div>`,
    )
    .join("");

  const formatsRow =
    formats.length > 0
      ? `<div class="block"><div class="block-t">Formats de contenu</div><div class="chips">${formats
          .map((f) => `<span class="chip fmt">${esc(f)}</span>`)
          .join("")}</div></div>`
      : "";

  const contentRows =
    content.length > 0
      ? `<div class="block"><div class="block-t">Contenus & réalisations</div><div class="content">${content
          .map(
            (c) =>
              `<a class="cl" href="${esc(c.url)}" target="_blank" rel="noreferrer"><div class="cl-t">${esc(
                c.title || "Contenu",
              )}</div><div class="cl-m">${[c.platform, c.views].filter(Boolean).map(esc).join(" · ")}</div><div class="cl-u">${esc(
                c.url,
              )}</div></a>`,
          )
          .join("")}</div></div>`
      : "";

  const brandsRow =
    brands.length > 0
      ? `<div class="block"><div class="block-t">Ils ont collaboré</div><div class="chips">${brands
          .map((b) => `<span class="chip">${esc(b)}</span>`)
          .join("")}</div></div>`
      : "";

  const packagesRow =
    packages.length > 0
      ? `<div class="block"><div class="block-t">Offres & tarifs</div><div class="pkgs">${packages
          .map(
            (p) =>
              `<div class="pkg"><div class="pkg-h"><span class="pkg-n">${esc(p.name || "Offre")}</span><span class="pkg-p">${esc(
                p.price || "sur devis",
              )}</span></div>${p.desc ? `<div class="pkg-d">${esc(p.desc)}</div>` : ""}</div>`,
          )
          .join("")}</div></div>`
      : services && services.trim()
        ? `<div class="block"><div class="block-t">Offres</div><div class="muted">${esc(services)}</div></div>`
        : "";

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Media kit — ${esc(creator.name)}</title>
<style>
*{box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#18181b;max-width:820px;margin:0 auto;padding:44px 40px;background:#fff;font-size:13px;line-height:1.5}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #0069FE;padding-bottom:20px}
h1{font-size:30px;letter-spacing:-.6px;margin:0}
.meta{color:#71717a;margin-top:6px;font-size:13px}
.right{text-align:right}
.tag{font-size:13px;font-weight:800;letter-spacing:.02em}
.faint{color:#a1a1aa;font-size:10px;text-transform:uppercase;letter-spacing:.14em;margin-top:6px;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:24px}
.stat{background:#f4f4f5;border-radius:12px;padding:16px}
.stat-l{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;font-weight:700}
.stat-v{font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:6px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.card{background:#f4f4f5;border-radius:12px;padding:20px}
.card-t{font-size:14px;font-weight:700;margin-bottom:12px}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:#e4e4e7}
.bar>i{display:block}
.muted{color:#71717a}
.block{margin-top:22px}
.block-t{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;font-weight:700;margin-bottom:8px}
.content{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cl{display:block;border:1px solid #ececef;border-radius:10px;padding:12px 14px;text-decoration:none;color:inherit}
.cl-t{font-weight:600;font-size:13px}
.cl-m{color:#71717a;font-size:11px;margin-top:2px}
.cl-u{color:#0069FE;font-size:11px;margin-top:6px;word-break:break-all}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:#eef2ff;color:#3730a3;border-radius:20px;padding:5px 12px;font-size:12px;font-weight:600}
.chip.fmt{background:#f4f4f5;color:#3f3f46}
.pkgs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.pkg{border:1px solid #ececef;border-radius:12px;padding:14px 16px;background:#fafafa}
.pkg-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pkg-n{font-weight:700;font-size:13px}
.pkg-p{font-weight:800;color:#0069FE;font-size:13px;white-space:nowrap}
.pkg-d{color:#71717a;font-size:11px;margin-top:6px;line-height:1.45}
.legal{margin-top:32px;border-top:1px solid #ececef;padding-top:14px;font-size:11px;color:#a1a1aa}
@media print{body{padding:0}.cl,.pkg,.chip{-webkit-print-color-adjust:exact;print-color-adjust:exact}.pkgs{grid-template-columns:repeat(3,1fr)}}
</style></head><body>
<div class="top">
  <div><h1>${esc(titleCase(creator.name))}</h1><div class="meta">${meta}</div></div>
  <div class="right"><div class="tag">TTP AGENCY</div><div class="faint">Media kit · 2026</div></div>
</div>

<div class="stats">${statCells}</div>

<div class="cols">
  <div class="card"><div class="card-t">Audience</div>
    <div class="bar"><i style="width:${fem}%;background:#0069FE"></i><i style="width:${100 - fem}%;background:#c7c7cc"></i></div>
    <div class="muted" style="margin-top:8px">${esc(gender)}</div>
    <div style="margin-top:14px"><span class="block-t" style="display:block">Âge dominant</span><b>${esc(age)} · ${esc(agePct)}</b></div>
    <div style="margin-top:12px"><span class="block-t" style="display:block">Localisation</span><b>${esc(location)}</b></div>
    ${avgViews ? `<div style="margin-top:12px"><span class="block-t" style="display:block">Vues moyennes</span><b>${esc(avgViews)}</b></div>` : ""}
  </div>
  <div class="card"><div class="card-t">Bio</div><p class="muted">${esc(bio)}</p></div>
</div>

${formatsRow}
${contentRows}
${brandsRow}
${packagesRow}

<div class="legal">Contact agence · partnerships@ttpcreators.pro · Lyon, France · TTP Agency — Trust the Process</div>
</body></html>`;
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className={cn("my-2 w-full rounded-2xl border border-border bg-card shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

const primaryBtn = "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const ghostBtn = "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

// ─── Vue ─────────────────────────────────────────────────────────────────────

export function Mediakit() {
  const creators = useCreators();
  const { data: mkData } = useAppState<MediaKitData>((s: AppState) => (s["mediaKitData"] as MediaKitData) ?? {});
  const [localData, setLocalData] = useState<MediaKitData | null>(null);
  const data = localData ?? mkData ?? {};

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected == null && creators.length > 0) setSelected(creators[0].name);
  }, [creators, selected]);

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
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) console.error("Chargement du média kit échoué:", error);
        setCreator((data?.[0] as Creator) ?? null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const selIndex = creators.findIndex((c) => c.name === selected);
  const ov: MkOverride = (data && selIndex >= 0 && data[selIndex]) || {};

  const [editDraft, setEditDraft] = useState<MkOverride | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // ── Archives des media kits (fichiers datés, filtrables par mois) ──
  const [archives, setArchives] = useState<ArchiveRow[] | null>(null);
  const [archMonth, setArchMonth] = useState<string>("all");
  const [archiving, setArchiving] = useState(false);
  const [archDel, setArchDel] = useState<ArchiveRow | null>(null);
  useEffect(() => {
    let alive = true;
    supabase
      .from("documents")
      .select("id,creator,name,size,path,created_at")
      .eq("type", "mediakit")
      .order("created_at", { ascending: false })
      .then(({ data: rows, error }) => {
        if (!alive) return;
        setArchives(error ? [] : (((rows as ArchiveRow[]) ?? [])));
      });
    return () => {
      alive = false;
    };
  }, []);
  const archMonths = [...new Set((archives ?? []).map((a) => archMonthKey(a.created_at)))].filter((k) => k !== "?");
  const shownArchives = (archives ?? []).filter((a) => archMonth === "all" || archMonthKey(a.created_at) === archMonth);

  if (creators.length === 0 || (selected && loading && !creator)) {
    return (
      <div className="grid place-items-center rounded-2xl border border-border bg-surface p-16 text-sm text-muted-foreground shadow-sm">
        Chargement du média kit…
      </div>
    );
  }

  if (!creator) {
    return (
      <div>
        <CreatorPicker creators={creators} selected={selected} onSelect={setSelected} />
        <div className="grid place-items-center rounded-2xl border border-border bg-surface p-16 text-sm text-muted-foreground shadow-sm">
          Aucune fiche créateur pour cette sélection.
        </div>
      </div>
    );
  }

  const fn = creator.name.split(" ")[0];
  const bio = mkGet(ov, "bio", `${fn}, créateur ${(creator.niche ?? "lifestyle").toLowerCase()} représenté(e) par TTP Agency. Contenus premium, audience engagée et collaborations à forte conversion.`);
  const age = mkGet(ov, "age", DEFAULT_AGE);
  const agePct = mkGet(ov, "agePct", DEFAULT_AGE_PCT);
  const gender = mkGet(ov, "gender", DEFAULT_GENDER);
  const location = mkGet(ov, "location", DEFAULT_LOCATION);
  const avgViews = mkGet(ov, "avgViews", "");
  const growth = mkGet(ov, "growth", "");
  const services = mkGet(ov, "services", "");
  const brands = splitList(mkGet(ov, "collabs", ""));
  const formats = splitList(mkGet(ov, "formats", DEFAULT_FORMATS));
  const content: ContentLink[] = ov.content ?? [];
  const packages: Package[] =
    ov.packages && ov.packages.length ? ov.packages : services.trim() ? [] : DEFAULT_PACKAGES;
  const femM = /(\d+)%/.exec(gender);
  const fem = femM ? Number(femM[1]) : 65;

  const stats: { label: string; value: string }[] = [
    { label: "Abonnés", value: creator.followers || "—" },
    { label: "Engagement", value: creator.er || "—" },
    { label: avgViews ? "Vues moy." : "Reach / mois", value: avgViews || creator.reach || "—" },
    { label: growth ? "Croissance" : "CA / mois", value: growth || creator.ca || "—" },
  ];

  const buildHTML = () =>
    mediaKitHTML({ creator, bio, stats, age, agePct, gender, location, avgViews, formats, brands, services, packages, content, fem });

  const copyKit = async () => {
    const summary = [
      `MEDIA KIT · ${titleCase(creator.name)}`,
      [creator.handle, creator.niche, creator.platform].filter(Boolean).join(" · "),
      "",
      stats.map((s) => `${s.label} : ${s.value}`).join("\n"),
      "",
      `Audience : ${age} · ${agePct}`,
      gender,
      `Localisation : ${location}`,
      "",
      bio,
      formats.length ? "\nFormats : " + formats.join(", ") : "",
      content.length ? "\nContenus :\n" + content.map((c) => `• ${c.title} — ${c.url}`).join("\n") : "",
      brands.length ? "\nCollaborations : " + brands.join(", ") : "",
      packages.length ? "\nOffres & tarifs :\n" + packages.map((p) => `• ${p.name} — ${p.price || "sur devis"}`).join("\n") : "",
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

  const downloadPDF = () => {
    const blob = new Blob([buildHTML()], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `media-kit-${creator.name.toLowerCase().replace(/\s+/g, "-")}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Média kit téléchargé ✓ (ouvre-le puis Imprimer → PDF)");
  };

  /** Archive la version ACTUELLE : fichier daté dans le bucket privé + fiche
   *  documents (le créateur la voit dans son espace ; base du partage mail à venir). */
  const archiveKit = async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      const html = buildHTML();
      const now = new Date();
      const monthLabel = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      const slug = creator.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const path = `mediakits/${slug}-${now.getTime()}.html`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const up = await supabase.storage.from("documents").upload(path, blob, { upsert: false, contentType: "text/html" });
      if (up.error) {
        toast("Échec de l'archivage — réessaie");
        return;
      }
      const row = {
        creator: creator.name,
        name: `Media kit — ${titleCase(creator.name)} — ${monthLabel}`,
        type: "mediakit",
        size: `${Math.max(1, Math.round(blob.size / 1024))} Ko`,
        path,
        sort_order: 0,
      };
      const created = await dbInsert("documents", row);
      if (!created) {
        toast("Fichier stocké mais fiche non créée — réessaie");
        return;
      }
      setArchives((prev) => [created as unknown as ArchiveRow, ...(prev ?? [])]);
      toast("Media kit archivé ✓ — visible par le créateur dans ses documents");
    } finally {
      setArchiving(false);
    }
  };

  const openArchive = async (row: ArchiveRow) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, 3600);
    if (error || !data?.signedUrl) {
      toast("Lien indisponible — réessaie");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const delArchive = async (row: ArchiveRow) => {
    const { error: rmErr } = await supabase.storage.from("documents").remove([row.path]);
    if (rmErr) {
      toast("Suppression du fichier échouée — réessaie");
      return;
    }
    if (await dbDelete("documents", row.id)) {
      setArchives((prev) => (prev ?? []).filter((x) => x.id !== row.id));
      toast("Archive supprimée");
    }
  };

  const openEdit = () =>
    setEditDraft({
      bio,
      age,
      agePct,
      gender,
      location,
      avgViews,
      growth,
      formats: mkGet(ov, "formats", DEFAULT_FORMATS),
      collabs: mkGet(ov, "collabs", ""),
      services,
      content: [...content],
      packages: packages.map((p) => ({ ...p })),
    });

  const saveEdit = async () => {
    if (!editDraft || selIndex < 0) return;
    const cleaned: MkOverride = {
      ...editDraft,
      content: (editDraft.content ?? []).filter((c) => c.title.trim() || c.url.trim()),
      packages: (editDraft.packages ?? []).filter((p) => p.name.trim() || p.price.trim() || p.desc.trim()),
    };
    const next = { ...data, [selIndex]: cleaned };
    setLocalData(next);
    setEditDraft(null);
    const ok = await saveAppStateKey("mediaKitData", next);
    toast(ok ? "Média kit enregistré ✓" : "Erreur — réessaie");
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CreatorPicker creators={creators} selected={selected} onSelect={setSelected} />
        <div className="flex items-center gap-2">
          <button type="button" onClick={openEdit} className={cn(ghostBtn, "flex items-center gap-1.5")}>
            <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Modifier</span>
          </button>
          <button type="button" onClick={() => setPreview(buildHTML())} className={cn(ghostBtn, "flex items-center gap-1.5")}>
            <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Aperçu</span>
          </button>
          <button
            type="button"
            onClick={archiveKit}
            disabled={archiving}
            title="Fige la version actuelle (datée) — visible par le créateur"
            className={cn(ghostBtn, "flex items-center gap-1.5 disabled:opacity-50")}
          >
            <Archive className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{archiving ? "Archivage…" : "Archiver"}</span>
          </button>
          <button type="button" onClick={downloadPDF} className={cn(primaryBtn, "flex items-center gap-1.5")}>
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <CreatorAvatar name={creator.name} photoUrl={creator.photo_url} className="h-[76px] w-[76px] rounded-2xl text-xl" />
            <div className="min-w-0">
              <div className="text-2xl font-semibold tracking-tight md:text-3xl">{titleCase(creator.name)}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <span className="text-sm text-muted-foreground">{creator.handle || "—"}</span>
                {creator.niche && (
                  <span className="rounded-full bg-signalsoft px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-signaltext">{creator.niche}</span>
                )}
                {creator.platform && <span className="text-xs text-faint">{creator.platform}</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold tracking-tight text-foreground">TTP AGENCY</div>
            <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">Media kit · 2026</div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-panel p-[18px]">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{s.label}</div>
              <div className="mt-2 whitespace-nowrap text-2xl font-bold tracking-tight">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Audience + Bio */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-panel p-[22px]">
            <div className="mb-4 text-sm font-semibold text-foreground">Audience</div>
            <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-faint">Répartition</div>
            <div className="flex h-2.5 overflow-hidden rounded-md bg-border">
              <div className="bg-primary" style={{ width: `${fem}%` }} />
              <div className="bg-muted-foreground" style={{ width: `${100 - fem}%` }} />
            </div>
            <div className="mt-2 text-[11px] font-medium text-muted-foreground">{gender}</div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Âge dominant</div>
                <div className="text-sm font-semibold text-foreground">{age} · {agePct}</div>
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Localisation</div>
                <div className="text-sm font-semibold text-foreground">{location}</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-panel p-[22px]">
            <div className="mb-3 text-sm font-semibold text-foreground">Bio</div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{bio}</p>
            {formats.length > 0 && (
              <>
                <div className="mb-2 mt-4 text-[9px] font-semibold uppercase tracking-wide text-faint">Formats de contenu</div>
                <div className="flex flex-wrap gap-1.5">
                  {formats.map((f, i) => (
                    <span key={i} className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{f}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Contenus (liens cliquables) */}
        {content.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-foreground">Contenus &amp; réalisations</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {content.map((c) => (
                <a
                  key={c.id}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-primary hover:bg-rowhover"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">{c.title || "Contenu"}</div>
                    <div className="mt-0.5 truncate text-[11px] text-faint">{[c.platform, c.views].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1 truncate text-[11px] text-primary">{c.url}</div>
                  </div>
                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-primary" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Marques */}
        {brands.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-foreground">Ils ont collaboré</div>
            <div className="flex flex-wrap gap-2">
              {brands.map((b, i) => (
                <span key={i} className="rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-muted-foreground">{b}</span>
              ))}
            </div>
          </div>
        )}

        {/* Offres & tarifs */}
        {packages.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-foreground">Offres &amp; tarifs</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {packages.map((p) => (
                <div key={p.id} className="rounded-xl border border-border bg-panel p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[13px] font-semibold text-foreground">{p.name || "Offre"}</div>
                    <div className="whitespace-nowrap text-[13px] font-bold text-primary">{p.price || "sur devis"}</div>
                  </div>
                  {p.desc && <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{p.desc}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : services ? (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-foreground">Offres</div>
            <p className="text-[13px] text-muted-foreground">{services}</p>
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div className="text-[11px] font-medium text-faint">Contact agence · partnerships@ttpcreators.pro · Lyon, France</div>
          <button onClick={copyKit} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Copy className="h-3.5 w-3.5" /> Copier le texte
          </button>
        </div>
      </div>

      {/* ── Éditeur ── */}
      {editDraft && (
        <Modal
          title={`Média kit · ${titleCase(creator.name)}`}
          onClose={() => setEditDraft(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setEditDraft(null)}>Annuler</button>
              <button type="button" className={primaryBtn} onClick={saveEdit}>Enregistrer</button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Bio</span>
              <textarea
                value={editDraft.bio ?? ""}
                onChange={(e) => setEditDraft({ ...editDraft, bio: e.target.value })}
                rows={3}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>

            <div className="flex flex-wrap items-end gap-3">
              <TextField label="Genre (audience)" value={editDraft.gender ?? ""} onChange={(v) => setEditDraft({ ...editDraft, gender: v })} className="min-w-[200px] flex-1" />
              <TextField label="Âge dominant" value={editDraft.age ?? ""} onChange={(v) => setEditDraft({ ...editDraft, age: v })} className="min-w-[130px] flex-1" />
              <TextField label="% âge" value={editDraft.agePct ?? ""} onChange={(v) => setEditDraft({ ...editDraft, agePct: v })} className="min-w-[90px] flex-none" />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="Localisation" value={editDraft.location ?? ""} onChange={(v) => setEditDraft({ ...editDraft, location: v })} className="min-w-[180px] flex-[2]" />
              <TextField label="Vues moyennes" value={editDraft.avgViews ?? ""} onChange={(v) => setEditDraft({ ...editDraft, avgViews: v })} className="min-w-[110px] flex-1" />
              <TextField label="Croissance (ex : +12% / mois)" value={editDraft.growth ?? ""} onChange={(v) => setEditDraft({ ...editDraft, growth: v })} className="min-w-[110px] flex-1" />
            </div>
            <TextField label="Formats de contenu (séparés par des virgules)" value={editDraft.formats ?? ""} onChange={(v) => setEditDraft({ ...editDraft, formats: v })} className="w-full" />
            <label className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Marques (séparées par des virgules ou retours ligne)</span>
              <textarea
                value={editDraft.collabs ?? ""}
                onChange={(e) => setEditDraft({ ...editDraft, collabs: e.target.value })}
                rows={2}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>

            {/* Contenus */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Contenus (liens)</span>
                <button
                  type="button"
                  onClick={() => setEditDraft({ ...editDraft, content: [...(editDraft.content ?? []), { id: uid(), title: "", platform: "", url: "", views: "" }] })}
                  className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover"
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter un lien
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {(editDraft.content ?? []).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
                    <input value={c.title} onChange={(e) => setEditDraft({ ...editDraft, content: (editDraft.content ?? []).map((x) => (x.id === c.id ? { ...x, title: e.target.value } : x)) })} placeholder="Titre" className="min-w-[120px] flex-[2] rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <input value={c.platform} onChange={(e) => setEditDraft({ ...editDraft, content: (editDraft.content ?? []).map((x) => (x.id === c.id ? { ...x, platform: e.target.value } : x)) })} placeholder="Plateforme" className="min-w-[100px] flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <input value={c.views} onChange={(e) => setEditDraft({ ...editDraft, content: (editDraft.content ?? []).map((x) => (x.id === c.id ? { ...x, views: e.target.value } : x)) })} placeholder="Vues" className="w-20 shrink-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <input value={c.url} onChange={(e) => setEditDraft({ ...editDraft, content: (editDraft.content ?? []).map((x) => (x.id === c.id ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" className="min-w-full flex-[3] rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <button type="button" onClick={() => setEditDraft({ ...editDraft, content: (editDraft.content ?? []).filter((x) => x.id !== c.id) })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500" title="Supprimer">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Offres & tarifs */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Offres &amp; tarifs</span>
                <button
                  type="button"
                  onClick={() => setEditDraft({ ...editDraft, packages: [...(editDraft.packages ?? []), { id: uid(), name: "", price: "", desc: "" }] })}
                  className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover"
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter une offre
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {(editDraft.packages ?? []).map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
                    <input value={p.name} onChange={(e) => setEditDraft({ ...editDraft, packages: (editDraft.packages ?? []).map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) })} placeholder="Offre (ex : Reel dédié)" className="min-w-[140px] flex-[2] rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <input value={p.price} onChange={(e) => setEditDraft({ ...editDraft, packages: (editDraft.packages ?? []).map((x) => (x.id === p.id ? { ...x, price: e.target.value } : x)) })} placeholder="Prix (800€ · sur devis)" className="w-36 shrink-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <input value={p.desc} onChange={(e) => setEditDraft({ ...editDraft, packages: (editDraft.packages ?? []).map((x) => (x.id === p.id ? { ...x, desc: e.target.value } : x)) })} placeholder="Description" className="min-w-full flex-[3] rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                    <button type="button" onClick={() => setEditDraft({ ...editDraft, packages: (editDraft.packages ?? []).filter((x) => x.id !== p.id) })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500" title="Supprimer">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Media kits archivés (filtrables par mois, visibles côté créateur) ── */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Media kits archivés</div>
            <div className="mt-0.5 text-[11px] text-faint">
              Chaque archive est datée automatiquement et visible par le créateur dans ses documents.
            </div>
          </div>
          {archMonths.length > 0 && (
            <Select value={archMonth} onValueChange={setArchMonth}>
              <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-full bg-surface" placeholder="Tous les mois" />
              <SelectContent>
                <SelectItem index={0} value="all">
                  Tous les mois
                </SelectItem>
                {archMonths.map((k, i) => (
                  <SelectItem key={k} index={i + 1} value={k}>
                    {archMonthLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {archives === null ? (
          <div className="px-1 py-3 text-xs text-muted-foreground">Chargement…</div>
        ) : shownArchives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Aucun media kit archivé{archMonth !== "all" ? " pour ce mois" : ""}. Clique sur « Archiver » pour figer la version actuelle.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shownArchives.map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{row.name}</div>
                  <div className="text-[10px] text-faint">
                    {row.creator ? titleCase(row.creator) : "—"} ·{" "}
                    {row.created_at ? new Date(row.created_at).toLocaleDateString("fr-FR") : "—"}
                    {row.size ? ` · ${row.size}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openArchive(row)}
                  title="Ouvrir (puis Imprimer → PDF si besoin)"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setArchDel(row)}
                  title="Supprimer l'archive"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {archDel && (
        <ConfirmDialog
          title="Supprimer l'archive"
          message={`Supprimer « ${archDel.name} » ? Le créateur ne la verra plus. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setArchDel(null)}
          onConfirm={() => {
            delArchive(archDel);
            setArchDel(null);
          }}
        />
      )}

      {/* ── Aperçu ── */}
      {preview && (
        <Modal
          title={`Aperçu · ${titleCase(creator.name)}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
              <button
                type="button"
                className={cn(ghostBtn, "flex items-center gap-1.5")}
                onClick={() => {
                  const w = window.open("", "_blank");
                  if (w) {
                    w.document.write(preview);
                    w.document.close();
                    w.focus();
                    w.print();
                  } else toast("Autorise les pop-ups pour imprimer");
                }}
              >
                <FileText className="h-3.5 w-3.5" /> Imprimer / PDF
              </button>
            </>
          }
        >
          <iframe title={`Media kit ${creator.name}`} srcDoc={preview} className="h-[64vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}
    </div>
  );
}

/** Sélecteur déroulant compact de créateur. */
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
    <div className="w-fit max-w-full">
      <Select value={value} onValueChange={onSelect}>
        <SelectTrigger className="h-9 w-auto min-w-[190px] rounded-full bg-surface" placeholder="Choisir un créateur" />
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

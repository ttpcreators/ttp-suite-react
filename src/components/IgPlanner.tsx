import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, CalendarClock, Clapperboard, ExternalLink, GalleryHorizontal, Handshake, Image as ImageIcon, ImagePlus, Loader2, Pencil,
  Plus, RefreshCw, RotateCcw, Send, Smartphone, Trash2, UserPlus, X, ArrowLeft, ArrowRight, Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Overlay } from "@/components/mobile/ios-sheet";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { HelpTip } from "@/components/ui/help-tip";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLiveKey } from "@/lib/useLive";
import { myDisplayName } from "@/lib/team";
import { fmtCompact } from "@/lib/timeSeries";
import {
  KIND_HELP, KIND_LABEL, LIMITS, STATUS_LABEL, cleanHandle, collabCaption, countHashtags, countMentions, cropBox, fromLocalInput, nextSlot, planProblems,
  signatureCaption, targetRatio, toLocalInput, type PlanKind, type PlanMedia, type PlanStatus, type Planned,
} from "@/lib/igPlanner";

/**
 * PLANNING → POSTS INSTAGRAM : programmer les posts, carrousels, reels et stories du
 * compte Instagram de TTP (nouvelle créatrice signée, collab réussie…). Les fichiers
 * vont dans le bucket public ig-posts, la ligne dans ig_planned ; la fonction
 * ig-publish publie à l'heure (cron chaque minute) ou tout de suite.
 */

const IN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary";
const BUCKET = "ig-posts";
const KIND_ICON: Record<PlanKind, typeof ImageIcon> = { post: ImageIcon, carrousel: GalleryHorizontal, reel: Clapperboard, story: Smartphone };
const STATUS_CLS: Record<PlanStatus, string> = {
  brouillon: "bg-panel text-muted-foreground",
  programme: "bg-primary/10 text-primary",
  en_cours: "bg-amber/15 text-amber",
  publie: "bg-emerald-500/10 text-emerald-600",
  erreur: "bg-rose-500/10 text-rose-500",
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Pas de date";

type Account = { username: string; name: string; picture: string; followers: number; posts: number };
type Recent = { id: string; caption: string; type: string; product: string; image: string; url: string; at: string };
type Status = {
  account: Account | null; recent: Recent[]; limit: { used: number; total: number | null } | null; limitError: string | null;
  perms: string[] | null; page: string; pageDetail: string | null; error?: string;
};
type CreatorOpt = { id: string; name: string; handle: string };
type CollabOpt = { id: string; brand: string; creator: string };

/** Lit la ligne telle que renvoyée par Supabase (tableaux et booléens jamais null). */
function toPlanned(r: Record<string, unknown>): Planned {
  return {
    ...(r as Planned),
    media: Array.isArray(r.media) ? (r.media as PlanMedia[]) : [],
    collaborators: Array.isArray(r.collaborators) ? (r.collaborators as string[]) : [],
    caption: String(r.caption ?? ""),
    share_to_feed: r.share_to_feed !== false,
  };
}

async function invokePublish<T>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await supabase.functions.invoke("ig-publish", { body });
  if (error) return { error: "reseau" } as T & { error?: string };
  return (data ?? { error: "reseau" }) as T & { error?: string };
}

// ─── Fichiers : photo → JPEG au bon format, vidéo telle quelle ───────────────

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Photo recadrée au format accepté par Instagram, 1440 px de large max, en JPEG. */
async function toJpeg(file: File, ratio: number | null): Promise<{ blob: Blob; w: number; h: number }> {
  const img = await loadImage(file);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const box = ratio ? cropBox(W, H, ratio) : { sx: 0, sy: 0, sw: W, sh: H };
  const scale = Math.min(1, 1440 / box.sw);
  const w = Math.round(box.sw * scale);
  const h = Math.round(box.sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error("jpeg");
  return { blob, w, h };
}

function videoInfo(file: File): Promise<{ w: number; h: number; dur: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve({ w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration * 10) / 10 });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve({ w: 0, h: 0, dur: NaN });
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

async function upload(folder: string, blob: Blob, ext: string, type: string): Promise<{ url: string; path: string } | null> {
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
  if (error) {
    toast(/size|large|exceed/i.test(error.message) ? "Fichier trop lourd pour le stockage (compresse la vidéo)" : "Envoi du fichier impossible, réessaie");
    return null;
  }
  return { url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path };
}

// ─── Aperçus ────────────────────────────────────────────────────────────────

function Thumb({ m, className }: { m?: PlanMedia; className?: string }) {
  if (!m) return <div className={cn("grid place-items-center bg-panel text-faint", className)}><ImageIcon className="h-5 w-5" /></div>;
  return m.type === "video" ? (
    <video src={`${m.url}#t=0.5`} muted playsInline preload="metadata" className={cn("bg-black object-cover", className)} />
  ) : (
    <img src={m.url} alt="" loading="lazy" className={cn("bg-panel object-cover", className)} />
  );
}

function StatusPill({ s }: { s: PlanStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_CLS[s])}>
      {s === "en_cours" && <Loader2 className="h-3 w-3 animate-spin" />}
      {STATUS_LABEL[s]}
    </span>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function IgPlanner({ focusId, onFocused }: { focusId?: string | null; onFocused?: () => void }) {
  const [rows, setRows] = useState<Planned[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [editing, setEditing] = useState<Planned | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; danger?: boolean; run: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    void supabase.from("ig_planned").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }).then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        setMissing(true);
        setRows([]);
        return;
      }
      setRows(((data as Record<string, unknown>[] | null) ?? []).map(toPlanned));
    });
    return () => {
      alive = false;
    };
  }, [reload, live]);

  const loadStatus = async () => {
    setStatusBusy(true);
    const r = await invokePublish<Status>({ mode: "status" });
    setStatusBusy(false);
    setStatus(r);
  };
  useEffect(() => {
    void loadStatus();
  }, []);

  // Pendant qu'un post part (ou va partir), on rafraîchit la liste toutes les 20 s.
  const pending = (rows ?? []).some((r) => r.status === "en_cours" || (r.status === "programme" && r.scheduled_at && Date.parse(r.scheduled_at) < Date.now() + 120_000));
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setReload((n) => n + 1), 20_000);
    return () => window.clearInterval(t);
  }, [pending]);

  // Ouverture demandée depuis l'agenda (clic sur une puce « Post Instagram »).
  useEffect(() => {
    if (!focusId || !rows) return;
    const r = rows.find((x) => x.id === focusId);
    if (r) setEditing(r);
    onFocused?.();
  }, [focusId, rows, onFocused]);

  const groups = useMemo(() => {
    const list = rows ?? [];
    const by = (s: PlanStatus[]) => list.filter((r) => s.includes(r.status));
    return {
      upcoming: by(["programme", "en_cours"]),
      errors: by(["erreur"]),
      drafts: by(["brouillon"]),
      published: by(["publie"]).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 12),
    };
  }, [rows]);

  const publishNow = async (r: Planned) => {
    setBusy(r.id);
    const res = await invokePublish<{ result?: string; row?: { status: PlanStatus; error: string | null; permalink: string | null } }>({ mode: "now", id: r.id });
    setBusy(null);
    setReload((n) => n + 1);
    if (res.error) return toast(res.error === "deja_en_cours" ? "Ce post est déjà en cours d'envoi" : res.error === "migration_manquante" ? "La publication n'est pas encore activée." : "Publication impossible pour l'instant, réessaie");
    if (res.row?.status === "publie") return toast("Publié sur Instagram ✓");
    if (res.row?.status === "erreur") return toast(res.row.error ?? "Instagram a refusé le post");
    toast("Instagram prépare le post : il sera en ligne dans quelques minutes");
  };
  const setDraft = async (r: Planned) => {
    const { error } = await supabase.from("ig_planned").update({ status: "brouillon" }).eq("id", r.id).in("status", ["programme", "erreur"]);
    if (error) return toast("Erreur, réessaie");
    setReload((n) => n + 1);
  };
  const remove = async (r: Planned) => {
    const { error } = await supabase.from("ig_planned").delete().eq("id", r.id);
    if (error) return toast("Suppression impossible");
    const paths = r.media.map((m) => m.path).filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id));
    toast(r.status === "publie" ? "Retiré de la liste (le post reste sur Instagram)" : "Supprimé");
  };

  if (rows === null) return <AnimatedBadge status="loading" size="sm">Chargement des posts…</AnimatedBadge>;
  if (missing) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center text-sm text-muted-foreground">
        La programmation des posts n'est pas encore activée.
      </div>
    );
  }

  const acc = status?.account;
  const canPublish = status?.perms ? status.perms.includes("instagram_content_publish") : null;
  const card = (r: Planned) => (
    <PlanCard
      key={r.id}
      r={r}
      busy={busy === r.id}
      onEdit={() => setEditing(r)}
      onNow={() => setConfirm({ title: "Publier maintenant ?", message: `Le ${KIND_LABEL[r.kind].toLowerCase()} part tout de suite sur ${acc ? `@${acc.username}` : "le compte Instagram de TTP"}.`, label: "Publier", run: () => void publishNow(r) })}
      onDraft={() => void setDraft(r)}
      onDelete={() => setConfirm({ title: r.status === "publie" ? "Retirer de la liste ?" : "Supprimer définitivement ?", message: r.status === "publie" ? "Le post reste en ligne sur Instagram : il disparaît seulement de cette liste." : "Le post et ses fichiers sont supprimés définitivement. Rien n'est publié.", label: r.status === "publie" ? "Retirer" : "Supprimer définitivement", danger: true, run: () => void remove(r) })}
    />
  );

  return (
    <div>
      {/* Compte TTP + quota Meta + bouton principal */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3.5">
        <div className="flex min-w-[220px] flex-1 items-center gap-3">
          <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-panel text-[12px] font-bold text-foreground ring-2 ring-primary/20">
            {initials(acc?.name || "TTP")}
            {acc?.picture && <img src={acc.picture} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-foreground">{acc ? `@${acc.username}` : "Compte Instagram de TTP"}</div>
            <div className="truncate text-[12px] text-muted-foreground">
              {acc ? `${fmtCompact(acc.followers)} abonnés · ${acc.posts} posts` : statusBusy ? "Connexion à Instagram…" : "Pas encore relié"}
              {status?.limit && (
                <>
                  {" · "}
                  <span title="Instagram autorise un nombre limité de publications par l'app sur 24 h glissantes">
                    {status.limit.used}/{status.limit.total ?? 100} publications sur 24 h
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => void loadStatus()} disabled={statusBusy} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50" aria-label="Actualiser le compte">
          <RefreshCw className={cn("h-4 w-4", statusBusy && "animate-spin")} />
        </button>
        <button type="button" onClick={() => setEditing("new")} className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" /> Nouveau post
        </button>
      </div>

      {status && !statusBusy && (status.page !== "ok" || canPublish === false) && <SetupNotice status={status} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {groups.errors.length > 0 && <Section title="À corriger" hint="Instagram a refusé ces posts : la raison est indiquée. Corrige puis reprogramme." tone="text-rose-500">{groups.errors.map(card)}</Section>}
          <Section title="À venir" hint="Publiés tout seuls à l'heure prévue, même app fermée.">
            {groups.upcoming.length ? groups.upcoming.map(card) : (
              <Empty onNew={() => setEditing("new")} />
            )}
          </Section>
          {groups.drafts.length > 0 && <Section title="Brouillons" hint="Pas encore programmés : rien ne part tant qu'il n'y a pas de date.">{groups.drafts.map(card)}</Section>}
          {groups.published.length > 0 && <Section title="Publiés depuis l'app">{groups.published.map(card)}</Section>}
        </div>
        <FeedPreview planned={groups.upcoming} recent={status?.recent ?? []} account={acc ?? null} onOpen={(r) => setEditing(r)} />
      </div>

      {editing && (
        <PlanEditor
          initial={editing === "new" ? null : editing}
          account={acc ?? null}
          onClose={() => setEditing(null)}
          onSaved={(id, now) => {
            setEditing(null);
            setReload((n) => n + 1);
            if (now) {
              const r = (rows ?? []).find((x) => x.id === id);
              void publishNow(r ?? ({ id } as Planned));
            }
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run();
          }}
        />
      )}
    </div>
  );
}

function Section({ title, hint, tone, children }: { title: string; hint?: string; tone?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className={cn("text-[13px] font-semibold text-foreground", tone)}>{title}</h3>
        {hint && <span className="hidden text-[11px] text-muted-foreground sm:inline">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
      <CalendarClock className="mx-auto h-7 w-7 text-faint" />
      <p className="mt-2 text-[13px] font-medium text-foreground">Rien de programmé pour l'instant</p>
      <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">Un créateur vient de signer, une collab a cartonné ? Prépare le post maintenant et choisis l'heure : l'app le publie toute seule.</p>
      <button type="button" onClick={onNew} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
        <Sparkles className="h-3.5 w-3.5 text-primary" /> Préparer un post
      </button>
    </div>
  );
}

function PlanCard({ r, busy, onEdit, onNow, onDraft, onDelete }: { r: Planned; busy: boolean; onEdit: () => void; onNow: () => void; onDraft: () => void; onDelete: () => void }) {
  const Icon = KIND_ICON[r.kind];
  const locked = r.status === "en_cours" || busy;
  return (
    <div className={cn("flex gap-3 rounded-2xl border bg-surface p-3", r.status === "erreur" ? "border-rose-500/40" : "border-border")}>
      <button type="button" onClick={onEdit} disabled={locked || r.status === "publie"} className="relative h-[84px] w-[68px] shrink-0 overflow-hidden rounded-xl">
        <Thumb m={r.media[0]} className="h-full w-full" />
        {r.media.length > 1 && <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{r.media.length}</span>}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-foreground"><Icon className="h-3 w-3" />{KIND_LABEL[r.kind]}</span>
          <StatusPill s={r.status} />
          <span className="text-[12px] font-medium text-foreground">{r.status === "publie" ? fmtWhen(r.published_at) : fmtWhen(r.scheduled_at)}</span>
        </div>
        <p className="mt-1 line-clamp-2 whitespace-pre-line text-[12px] leading-snug text-muted-foreground">{r.kind === "story" ? "Story (sans légende)" : r.caption || "Sans légende"}</p>
        {r.collaborators.length > 0 && <p className="mt-1 truncate text-[11px] text-faint">Avec {r.collaborators.map((c) => `@${c}`).join(", ")}</p>}
        {r.status === "erreur" && r.error && <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-rose-500"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{r.error}</p>}
        {r.status === "en_cours" && <p className="mt-1 text-[11px] text-amber">Instagram prépare le fichier (une vidéo peut prendre quelques minutes).</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.status === "publie" ? (
            r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" className={BTN}><ExternalLink className="h-3 w-3" /> Voir sur Instagram</a>
          ) : !locked && (
            <>
              <button type="button" onClick={onEdit} className={BTN}><Pencil className="h-3 w-3" /> Modifier</button>
              <button type="button" onClick={onNow} className={BTN}><Send className="h-3 w-3" /> {r.status === "erreur" ? "Réessayer maintenant" : "Publier maintenant"}</button>
              {(r.status === "programme" || r.status === "erreur") && <button type="button" onClick={onDraft} className={BTN}><RotateCcw className="h-3 w-3" /> En brouillon</button>}
            </>
          )}
          {busy && <span className={cn(BTN, "pointer-events-none")}><Loader2 className="h-3 w-3 animate-spin" /> Envoi…</span>}
          {!locked && <button type="button" onClick={onDelete} className={cn(BTN, "text-muted-foreground hover:text-rose-500")} aria-label="Supprimer"><Trash2 className="h-3 w-3" /></button>}
        </div>
      </div>
    </div>
  );
}
const BTN = "inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover";

/** Aperçu de la grille : les prochains posts programmés, puis les derniers posts en ligne. */
function FeedPreview({ planned, recent, account, onOpen }: { planned: Planned[]; recent: Recent[]; account: Account | null; onOpen: (r: Planned) => void }) {
  const feed = planned.filter((r) => r.kind !== "story" && (r.kind !== "reel" || r.share_to_feed)).sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""));
  const cells = [...feed.map((r) => ({ kind: "plan" as const, r })), ...recent.map((m) => ({ kind: "live" as const, m }))].slice(0, 15);
  return (
    <aside className="h-fit rounded-2xl border border-border bg-surface p-3 lg:sticky lg:top-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-foreground">Aperçu de ta grille</div>
        <HelpTip title="Aperçu de ta grille" align="end">
          <p>Les posts programmés (encadrés, avec leur date) s'affichent avant tes derniers posts en ligne, comme ils apparaîtront sur {account ? `@${account.username}` : "ton profil"}.</p>
          <p>Pratique pour vérifier que les couleurs et les formats s'enchaînent bien.</p>
        </HelpTip>
      </div>
      {cells.length ? (
        <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl">
          {cells.map((c) =>
            c.kind === "plan" ? (
              <button key={c.r.id} type="button" onClick={() => onOpen(c.r)} className="relative aspect-[3/4] overflow-hidden outline outline-2 -outline-offset-2 outline-primary">
                <Thumb m={c.r.media[0]} className="h-full w-full" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 text-left text-[9px] font-semibold leading-tight text-white">
                  {c.r.scheduled_at ? new Date(c.r.scheduled_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </button>
            ) : (
              <a key={c.m.id} href={c.m.url} target="_blank" rel="noreferrer" className="relative aspect-[3/4] overflow-hidden bg-panel">
                {c.m.image && <img src={c.m.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
              </a>
            ),
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-panel/60 px-3 py-6 text-center text-[12px] text-muted-foreground">La grille s'affichera ici dès que le compte sera relié.</p>
      )}
    </aside>
  );
}

/** Réglage restant côté Meta (une fois) : message clair pour Marc. */
function SetupNotice({ status }: { status: Status }) {
  const missingPerm = status.perms && !status.perms.includes("instagram_content_publish");
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber/40 bg-amber/[0.06] p-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
      <div className="min-w-0 text-[12px] leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">Publication pas encore activée</p>
        {status.error === "migration_manquante" ? (
          <p>La publication n'est pas encore activée. Détails dans Réglages › Diagnostic.</p>
        ) : status.page !== "ok" || missingPerm ? (
          <p>Instagram n'autorise pas encore l'app à publier. Un réglage technique est à faire une seule fois (voir Réglages › Diagnostic).</p>
        ) : null}
        <p className="mt-1">Tu peux déjà préparer et programmer tes posts : ils partiront dès que ce sera réglé.</p>
      </div>
    </div>
  );
}

// ─── Création / modification ────────────────────────────────────────────────

type Draft = {
  kind: PlanKind; caption: string; media: PlanMedia[]; cover_url: string | null; collaborators: string[]; share_to_feed: boolean;
  template: string | null; ref: Planned["ref"]; when: string;
};

function PlanEditor({ initial, account, onClose, onSaved }: { initial: Planned | null; account: Account | null; onClose: () => void; onSaved: (id: string, publishNow: boolean) => void }) {
  const [d, setD] = useState<Draft>(() => ({
    kind: initial?.kind ?? "post",
    caption: initial?.caption ?? "",
    media: initial?.media ?? [],
    cover_url: initial?.cover_url ?? null,
    collaborators: initial?.collaborators ?? [],
    share_to_feed: initial?.share_to_feed ?? true,
    template: initial?.template ?? null,
    ref: initial?.ref ?? null,
    when: toLocalInput(initial?.scheduled_at ?? nextSlot()),
  }));
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const folder = useRef(initial?.id ?? crypto.randomUUID());
  const fresh = useRef(new Set<string>()); // fichiers envoyés pendant cette modification
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [collabInput, setCollabInput] = useState("");
  const [confirmNow, setConfirmNow] = useState(false);
  const [creators, setCreators] = useState<CreatorOpt[]>([]);
  const [collabs, setCollabs] = useState<CollabOpt[]>([]);
  const [brandIg, setBrandIg] = useState<Map<string, string>>(new Map());
  const [tpl, setTpl] = useState<"signature" | "collab" | null>(null);
  const lastTemplate = useRef<string>(initial?.template ? initial.caption : "");
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([
      supabase.from("creators").select("id, name, handle, instagram, platform, status").order("sort_order"),
      supabase.from("collabs").select("id, brand, creator, step, created_at").order("created_at", { ascending: false }).limit(60),
      supabase.from("contacts").select("brand, instagram").not("instagram", "is", null),
    ]).then(([cr, co, ct]) => {
      type C = { id: string; name: string; handle: string | null; instagram: string | null; platform: string | null; status: string | null };
      setCreators(((cr.data as C[] | null) ?? [])
        .filter((c) => (c.status ?? "actif").toLowerCase() !== "inactif")
        .map((c) => ({ id: c.id, name: c.name, handle: cleanHandle(c.instagram ?? "") || ((c.platform ?? "").toLowerCase().includes("insta") ? cleanHandle(c.handle ?? "") : "") })));
      setCollabs(((co.data as { id: string; brand: string; creator: string | null }[] | null) ?? []).filter((c) => c.creator).map((c) => ({ id: c.id, brand: c.brand, creator: c.creator ?? "" })));
      const m = new Map<string, string>();
      for (const c of (ct.data as { brand: string; instagram: string | null }[] | null) ?? []) {
        const h = cleanHandle(c.instagram ?? "");
        if (h && c.brand) m.set(norm(c.brand), h);
      }
      setBrandIg(m);
    });
  }, []);

  const problems = planProblems(d);
  const isStory = d.kind === "story";

  const applyCaption = (caption: string, extra: Partial<Draft>) => {
    const typed = d.caption.trim() && d.caption !== lastTemplate.current;
    if (typed && !window.confirm("Remplacer ta légende par le modèle ?")) return;
    lastTemplate.current = caption;
    set({ caption, ...extra });
    toast("Légende remplie : modifie-la librement");
  };
  const pickCreator = (id: string) => {
    const c = creators.find((x) => x.id === id);
    if (!c) return;
    applyCaption(signatureCaption(c.name, c.handle), { template: "signature", ref: { creator: c.name }, collaborators: c.handle ? [c.handle] : [] });
  };
  const pickCollab = (id: string) => {
    const c = collabs.find((x) => x.id === id);
    if (!c) return;
    const cr = creators.find((x) => norm(x.name) === norm(c.creator));
    const bh = brandIg.get(norm(c.brand)) ?? "";
    const ch = cr?.handle ?? "";
    applyCaption(collabCaption(cr?.name ?? c.creator, ch, c.brand, bh), { template: "collab", ref: { creator: c.creator, brand: c.brand, collab_id: c.id }, collaborators: [ch, bh].filter(Boolean) });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, d.kind === "carrousel" ? 10 - d.media.length : 1);
    setUploading((n) => n + list.length);
    const added: PlanMedia[] = [];
    let firstRatio = d.kind === "carrousel" && d.media[0]?.w && d.media[0]?.h ? d.media[0].w / d.media[0].h : undefined;
    for (const f of list) {
      try {
        if (f.type.startsWith("video/")) {
          if (!/^video\/(mp4|quicktime)$/.test(f.type)) {
            toast("Vidéo en MP4 ou MOV seulement");
            continue;
          }
          const info = await videoInfo(f);
          const up = await upload(folder.current, f, f.type === "video/mp4" ? "mp4" : "mov", f.type);
          if (up) {
            fresh.current.add(up.path);
            added.push({ ...up, type: "video", w: info.w, h: info.h, dur: Number.isFinite(info.dur) ? info.dur : undefined });
          }
        } else if (f.type.startsWith("image/")) {
          const img = await loadImage(f);
          const ratio = targetRatio(d.kind, img.naturalWidth, img.naturalHeight, firstRatio);
          const { blob, w, h } = await toJpeg(f, ratio);
          firstRatio = firstRatio ?? w / h;
          const up = await upload(folder.current, blob, "jpg", "image/jpeg");
          if (up) {
            fresh.current.add(up.path);
            added.push({ ...up, type: "image", w, h });
          }
        } else toast("Photo ou vidéo seulement");
      } catch {
        toast(`Impossible de lire ${f.name} (essaie en JPEG ou PNG)`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    setD((cur) => ({ ...cur, media: cur.kind === "carrousel" ? [...cur.media, ...added].slice(0, 10) : added.length ? [added[0]] : cur.media }));
  };
  const addCover = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setUploading((n) => n + 1);
    try {
      const { blob } = await toJpeg(f, null);
      const up = await upload(folder.current, blob, "jpg", "image/jpeg");
      if (up) {
        fresh.current.add(up.path);
        set({ cover_url: up.url });
      }
    } catch {
      toast("Couverture illisible");
    } finally {
      setUploading((n) => n - 1);
    }
  };
  const dropFresh = async (paths: string[]) => {
    const mine = paths.filter((p) => fresh.current.has(p));
    if (mine.length) await supabase.storage.from(BUCKET).remove(mine);
  };
  const removeMedia = (i: number) => {
    const m = d.media[i];
    set({ media: d.media.filter((_, j) => j !== i) });
    if (m) void dropFresh([m.path]);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.media.length) return;
    const next = [...d.media];
    [next[i], next[j]] = [next[j], next[i]];
    set({ media: next });
  };
  const addCollab = () => {
    const h = cleanHandle(collabInput);
    if (!h) return toast("@ invalide");
    if (d.collaborators.includes(h)) return setCollabInput("");
    if (d.collaborators.length >= LIMITS.collaborators) return toast("3 collaborateurs maximum");
    set({ collaborators: [...d.collaborators, h] });
    setCollabInput("");
  };
  const changeKind = (k: PlanKind) => {
    // Un seul fichier pour post / reel / story : on garde le 1er compatible.
    const keep = k === "carrousel" ? d.media : d.media.filter((m) => (k === "reel" ? m.type === "video" : k === "post" ? m.type === "image" : true)).slice(0, 1);
    void dropFresh(d.media.filter((m) => !keep.includes(m)).map((m) => m.path));
    set({ kind: k, media: keep });
  };
  const close = () => {
    // Fichiers envoyés puis abandonnés : on ne les garde pas.
    const kept = new Set((initial?.media ?? []).map((m) => m.path));
    void dropFresh([...fresh.current].filter((p) => !kept.has(p)));
    onClose();
  };

  const save = async (mode: "draft" | "schedule" | "now") => {
    if (mode !== "draft" && problems.length) return toast(problems[0]);
    if (mode === "draft" && !d.media.length && !d.caption.trim()) return toast("Ajoute au moins une photo ou une légende");
    const at = fromLocalInput(d.when);
    if (mode === "schedule") {
      if (!at) return toast("Choisis la date et l'heure");
      if (Date.parse(at) < Date.now() - 60_000) return toast("Cette heure est passée : choisis plus tard, ou « Publier maintenant »");
    }
    setSaving(true);
    const row = {
      kind: d.kind, caption: isStory ? "" : d.caption, media: d.media, cover_url: d.kind === "reel" ? d.cover_url : null,
      collaborators: isStory ? [] : d.collaborators, share_to_feed: d.share_to_feed, template: d.template, ref: d.ref,
      scheduled_at: mode === "now" ? new Date().toISOString() : at,
      status: mode === "draft" ? "brouillon" : "programme",
      error: null, attempts: 0, container_id: null, children: null, started_at: null,
    };
    let id = initial?.id ?? "";
    if (initial) {
      const { error } = await supabase.from("ig_planned").update(row).eq("id", initial.id).in("status", ["brouillon", "programme", "erreur"]);
      if (error) {
        setSaving(false);
        return toast("Enregistrement impossible, réessaie");
      }
      // Anciens fichiers retirés pendant la modification : supprimés du stockage.
      const now = new Set(d.media.map((m) => m.path));
      const gone = initial.media.map((m) => m.path).filter((p) => p && !now.has(p));
      if (gone.length) await supabase.storage.from(BUCKET).remove(gone);
    } else {
      const created_by = await myDisplayName().catch(() => "");
      const { data, error } = await supabase.from("ig_planned").insert({ ...row, id: folder.current, created_by: created_by || null }).select("id").single();
      if (error || !data) {
        setSaving(false);
        return toast("Enregistrement impossible, réessaie");
      }
      id = String((data as { id: string }).id);
    }
    setSaving(false);
    fresh.current.clear();
    if (mode === "schedule") toast(`Programmé pour ${fmtWhen(at)} ✓`);
    if (mode === "draft") toast("Brouillon enregistré");
    onSaved(id, mode === "now");
  };

  const quick = (label: string, dayOffset: number, hour: number) => {
    const t = new Date();
    t.setDate(t.getDate() + dayOffset);
    t.setHours(hour, 0, 0, 0);
    if (t.getTime() < Date.now()) return null;
    return (
      <button key={label} type="button" onClick={() => set({ when: toLocalInput(t.toISOString()) })} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover">
        {label}
      </button>
    );
  };

  return (
    <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClose={close} label="Post Instagram">
      <div className="my-auto w-full max-w-4xl rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
          <div className="text-[15px] font-semibold text-foreground">{initial ? "Modifier le post" : "Nouveau post Instagram"}</div>
          <button type="button" onClick={close} className="text-faint transition-colors hover:text-foreground" aria-label="Fermer"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-4">
            {/* 1. Type */}
            <Step n={1} title="Quel format ?">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(KIND_LABEL) as PlanKind[]).map((k) => {
                  const Icon = KIND_ICON[k];
                  const on = d.kind === k;
                  return (
                    <button key={k} type="button" onClick={() => changeKind(k)} className={cn("flex items-center justify-center gap-1.5 rounded-full border px-2 py-2.5 text-[12px] font-semibold transition-colors", on ? "border-primary bg-primary/[0.06] text-primary" : "border-border text-foreground hover:bg-rowhover")}>
                      <Icon className="h-4 w-4" /> {KIND_LABEL[k]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{KIND_HELP[d.kind]}</p>
            </Step>

            {/* 2. Modèle */}
            {!isStory && (
              <Step n={2} title="Un modèle pour aller vite ?" optional>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setTpl(tpl === "signature" ? null : "signature")} className={cn(CHIP, tpl === "signature" && CHIP_ON)}><UserPlus className="h-3.5 w-3.5" /> Nouveau créateur signé</button>
                  <button type="button" onClick={() => setTpl(tpl === "collab" ? null : "collab")} className={cn(CHIP, tpl === "collab" && CHIP_ON)}><Handshake className="h-3.5 w-3.5" /> Collab réussie</button>
                </div>
                {tpl === "signature" && (
                  <select className={cn(IN, "mt-2")} defaultValue="" onChange={(e) => pickCreator(e.target.value)}>
                    <option value="" disabled>Quel créateur ?</option>
                    {creators.map((c) => <option key={c.id} value={c.id}>{c.name}{c.handle ? ` (@${c.handle})` : ""}</option>)}
                  </select>
                )}
                {tpl === "collab" && (
                  <select className={cn(IN, "mt-2")} defaultValue="" onChange={(e) => pickCollab(e.target.value)}>
                    <option value="" disabled>Quelle collab ?</option>
                    {collabs.map((c) => <option key={c.id} value={c.id}>{c.brand} × {c.creator}</option>)}
                  </select>
                )}
                {tpl && <p className="mt-1.5 text-[11px] text-muted-foreground">La légende et les collaborateurs se remplissent : tout reste modifiable.</p>}
              </Step>
            )}

            {/* 3. Fichiers */}
            <Step n={isStory ? 2 : 3} title={d.kind === "reel" ? "La vidéo" : d.kind === "carrousel" ? "Les photos et vidéos (dans l'ordre)" : "La photo ou la vidéo"}>
              <div className="flex flex-wrap gap-2">
                {d.media.map((m, i) => (
                  <div key={m.path || i} className="group relative h-[110px] w-[88px] overflow-hidden rounded-xl border border-border">
                    <Thumb m={m} className="h-full w-full" />
                    <button type="button" onClick={() => removeMedia(i)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white" aria-label="Retirer"><X className="h-3.5 w-3.5" /></button>
                    {d.kind === "carrousel" && d.media.length > 1 && (
                      <div className="absolute inset-x-1 bottom-1 flex justify-between">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white disabled:opacity-30" aria-label="Avant"><ArrowLeft className="h-3 w-3" /></button>
                        <span className="self-center rounded bg-black/60 px-1 text-[10px] font-bold text-white">{i + 1}</span>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === d.media.length - 1} className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white disabled:opacity-30" aria-label="Après"><ArrowRight className="h-3 w-3" /></button>
                      </div>
                    )}
                  </div>
                ))}
                {(d.kind === "carrousel" ? d.media.length < 10 : !d.media.length) && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void addFiles(e.dataTransfer.files);
                    }}
                    className="grid h-[110px] w-[88px] place-items-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="flex flex-col items-center gap-1 text-[10px] font-medium"><ImagePlus className="h-5 w-5" />Ajouter</span>}
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  multiple={d.kind === "carrousel"}
                  accept={d.kind === "reel" ? "video/mp4,video/quicktime" : d.kind === "post" ? "image/*" : "image/*,video/mp4,video/quicktime"}
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {d.kind === "reel" ? "MP4 ou MOV, vertical 9:16 de préférence." : d.kind === "story" ? "Format vertical 9:16 conseillé." : "Les photos sont mises au format accepté par Instagram (entre 4:5 et 1,91:1) automatiquement."}
              </p>
              {d.kind === "reel" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {d.cover_url ? (
                    <span className="inline-flex items-center gap-2 text-[11px] text-foreground">
                      <img src={d.cover_url} alt="" className="h-10 w-8 rounded object-cover" /> Couverture choisie
                      <button type="button" onClick={() => set({ cover_url: null })} className="text-faint hover:text-rose-500" aria-label="Retirer la couverture"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => coverRef.current?.click()} className={CHIP}><ImagePlus className="h-3.5 w-3.5" /> Couverture (facultatif)</button>
                  )}
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-foreground">
                    <input type="checkbox" checked={d.share_to_feed} onChange={(e) => set({ share_to_feed: e.target.checked })} /> Aussi dans la grille
                  </label>
                  <input ref={coverRef} type="file" hidden accept="image/*" onChange={(e) => { void addCover(e.target.files); e.target.value = ""; }} />
                </div>
              )}
            </Step>

            {/* 4. Légende + collaborateurs */}
            {!isStory && (
              <Step n={4} title="La légende">
                <textarea value={d.caption} onChange={(e) => set({ caption: e.target.value })} rows={7} maxLength={LIMITS.caption + 200} placeholder="Écris la légende… (@ pour citer, # pour les hashtags)" className={cn(IN, "resize-y leading-relaxed")} />
                <p className={cn("mt-1 text-[11px]", d.caption.length > LIMITS.caption ? "text-rose-500" : "text-muted-foreground")}>
                  {d.caption.length} / {LIMITS.caption} caractères · {countHashtags(d.caption)} / {LIMITS.hashtags} # · {countMentions(d.caption)} @
                </p>
                <div className="mt-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                    Collaborateurs (3 max)
                    <HelpTip title="Post en collaboration">
                      <p>Chaque @ reçoit une invitation sur Instagram. S'il accepte, le post s'affiche aussi sur son profil, avec ses abonnés en plus.</p>
                      <p>Idéal pour un nouveau créateur ou une collab : le créateur et la marque.</p>
                    </HelpTip>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.collaborators.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                        @{c}
                        <button type="button" onClick={() => set({ collaborators: d.collaborators.filter((x) => x !== c) })} aria-label={`Retirer @${c}`}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                    {d.collaborators.length < LIMITS.collaborators && (
                      <input
                        value={collabInput}
                        onChange={(e) => setCollabInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addCollab();
                          }
                        }}
                        onBlur={() => collabInput.trim() && addCollab()}
                        placeholder="@compte puis Entrée"
                        className="min-w-[140px] flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
                      />
                    )}
                  </div>
                </div>
              </Step>
            )}

            {/* 5. Quand */}
            <Step n={isStory ? 3 : 5} title="Quand ?">
              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" value={d.when} onChange={(e) => set({ when: e.target.value })} className={cn(IN, "w-auto")} />
                {quick("Ce soir 18 h", 0, 18)}
                {quick("Demain 12 h", 1, 12)}
                {quick("Demain 18 h", 1, 18)}
              </div>
            </Step>
          </div>

          {/* Aperçu façon téléphone */}
          <div className="md:sticky md:top-4 md:h-fit">
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Aperçu</div>
            <div className="overflow-hidden rounded-2xl border border-border bg-background">
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-panel text-[9px] font-bold">
                  TTP
                  {account?.picture && <img src={account.picture} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 truncate text-[12px] font-semibold text-foreground">
                  {account?.username ?? "ttp.creators"}
                  {d.collaborators.length > 0 && <span className="font-normal text-muted-foreground"> et {d.collaborators.length === 1 ? `@${d.collaborators[0]}` : `${d.collaborators.length} autres`}</span>}
                </div>
              </div>
              <div className={cn("relative bg-panel", isStory || d.kind === "reel" ? "aspect-[9/16]" : "")} style={!isStory && d.kind !== "reel" && d.media[0]?.w && d.media[0]?.h ? { aspectRatio: `${d.media[0].w} / ${d.media[0].h}` } : !isStory && d.kind !== "reel" ? { aspectRatio: "4 / 5" } : undefined}>
                <Thumb m={d.media[0]} className="absolute inset-0 h-full w-full" />
                {d.kind === "carrousel" && d.media.length > 1 && (
                  <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                    {d.media.map((m, i) => <span key={m.path || i} className={cn("h-1.5 w-1.5 rounded-full", i === 0 ? "bg-white" : "bg-white/50")} />)}
                  </div>
                )}
              </div>
              {!isStory && (
                <p className="line-clamp-4 whitespace-pre-line px-3 py-2 text-[11px] leading-snug text-foreground">
                  <span className="font-semibold">{account?.username ?? "ttp.creators"}</span> {d.caption || <span className="text-faint">Ta légende…</span>}
                </p>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{fromLocalInput(d.when) ? `Prévu : ${fmtWhen(fromLocalInput(d.when))}` : "Pas encore de date"}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[18px] text-[11px]">
            {problems.length > 0 ? <span className="flex items-start gap-1 font-medium text-rose-500"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{problems[0]}</span> : <span className="text-emerald-600">Prêt à partir ✓</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" disabled={saving || uploading > 0} onClick={() => void save("draft")} className="h-9 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50">Brouillon</button>
            <button type="button" disabled={saving || uploading > 0 || problems.length > 0} onClick={() => setConfirmNow(true)} className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Publier maintenant</button>
            <button type="button" disabled={saving || uploading > 0 || problems.length > 0} onClick={() => void save("schedule")} className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Programmer
            </button>
          </div>
        </div>
      </div>
      {confirmNow && (
        <ConfirmDialog
          title="Publier maintenant ?"
          message={`Le ${KIND_LABEL[d.kind].toLowerCase()} part tout de suite sur ${account ? `@${account.username}` : "le compte Instagram de TTP"}.`}
          confirmLabel="Publier"
          onCancel={() => setConfirmNow(false)}
          onConfirm={() => {
            setConfirmNow(false);
            void save("now");
          }}
        />
      )}
    </Overlay>
  );
}
const CHIP = "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover";
const CHIP_ON = "border-primary bg-primary/[0.06] text-primary";

function Step({ n, title, optional, children }: { n: number; title: string; optional?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-[10px] font-bold text-background">{n}</span>
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        {optional && <span className="text-[11px] text-faint">facultatif</span>}
      </div>
      {children}
    </div>
  );
}

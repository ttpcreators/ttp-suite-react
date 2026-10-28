import { useEffect, useState } from "react";
import { Check, Copy, Search, UserPlus, X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { Overlay } from "@/components/mobile/ios-sheet";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { fmtAgo, fmtEr, igWhyText, noteQuota } from "@/lib/instagram";
import { fmtCompact } from "@/lib/timeSeries";
import { cn, initials } from "@/lib/utils";

/** Un post de collab (ig-sourcing mode « collabs ») et le résumé par marque. */
type CollabPost = { id: string; url: string; at: string; kind: string; likes: number | null; comments: number; er: number | null; paid: boolean; brands: string[]; caption: string };
type BrandRow = { brand: string; posts: number; paid: number; last: string; er: number | null };
type Collabs = { scanned: number; posts: CollabPost[]; brands: BrandRow[] };
const fmtPct = (n: number) => `${n.toFixed(n < 10 ? 2 : 1).replace(".", ",")} %`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" });

/**
 * « Ses collabs » : les posts de ses 50 derniers où elle cite une marque ou signale un
 * partenariat (#ad, code promo…). Filtres : marque, payés seulement, période. Export Excel.
 */
function CreatorCollabs({ u }: { u: string }) {
  const [data, setData] = useState<Collabs | null>(null);
  const [err, setErr] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [paidOnly, setPaidOnly] = useState(false);
  const [days, setDays] = useState<30 | 90 | 0>(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    void supabase.functions.invoke("ig-sourcing", { body: { mode: "collabs", creator: u } }).then(({ data: d, error }) => {
      if (!alive) return;
      noteQuota(d);
      const r = (d ?? {}) as Collabs & { error?: string };
      if (error || r.error || !Array.isArray(r.posts)) return setErr(r.error ? igWhyText(r.error) || "lecture impossible" : "lecture impossible pour le moment");
      setData({ scanned: r.scanned ?? 0, posts: r.posts, brands: r.brands ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [u]);

  if (err) return <p className="mt-5 rounded-[14px] bg-field px-4 py-3 text-[13px] text-muted-foreground">Collabs : {err}.</p>;
  if (!data) {
    return (
      <div className="mt-6 flex flex-col gap-2">
        <div className="h-4 w-40 animate-pulse rounded bg-field" />
        {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-[16px] bg-panel" />)}
      </div>
    );
  }
  const since = days ? Date.now() - days * 86400e3 : 0;
  const shown = data.posts.filter((p) => (!brand || p.brands.includes(brand)) && (!paidOnly || p.paid) && (!since || Date.parse(p.at) >= since));
  const paidCount = data.posts.filter((p) => p.paid).length;
  const exportCsv = () => {
    const cell = (v: unknown) => {
      const t = String(v ?? "");
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [["Date", "Marques", "Format", "Payé", "Likes", "Commentaires", "Engagement %", "Lien", "Texte"], ...shown.map((p) => [
      fmtDate(p.at), p.brands.map((b) => `@${b}`).join(" "), p.kind, p.paid ? "oui" : "non", p.likes ?? "masqués", p.comments, p.er ?? "", p.url, p.caption,
    ])].map((l) => l.map(cell).join(";"));
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `collabs-${u}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const seg = (on: boolean) => cn("h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors", on ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-foreground">Ses collabs</h3>
        <span className="text-[12px] text-muted-foreground">
          {data.posts.length} post{data.posts.length > 1 ? "s" : ""} avec une marque sur ses {data.scanned} derniers · {paidCount} payé{paidCount > 1 ? "s" : ""}
        </span>
      </div>
      {data.posts.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Aucune marque citée dans ses derniers posts.</p>
      ) : (
        <>
          {/* Marques : un clic filtre les posts */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.brands.map((b) => {
              const on = brand === b.brand;
              return (
                <button key={b.brand} type="button" onClick={() => setBrand(on ? null : b.brand)} aria-pressed={on}
                  title={`${b.posts} post${b.posts > 1 ? "s" : ""}, dont ${b.paid} payé${b.paid > 1 ? "s" : ""} · dernier le ${fmtDate(b.last)}${b.er != null ? ` · engagement moyen ${fmtPct(b.er)}` : ""}`}
                  className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors", on ? "bg-foreground text-background" : "bg-field text-foreground hover:bg-rowhover")}>
                  @{b.brand}
                  <span className={cn("tabular-nums", on ? "opacity-70" : "text-faint")}>{b.posts}</span>
                  {b.paid > 0 && <span className={cn("rounded-full px-1.5 text-[10.5px] font-semibold", on ? "bg-background/20" : "bg-surface text-muted-foreground")}>payé</span>}
                </button>
              );
            })}
          </div>
          {/* Filtres */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Type" className="flex rounded-full bg-field p-0.5">
              <button type="button" aria-pressed={!paidOnly} onClick={() => setPaidOnly(false)} className={seg(!paidOnly)}>Toutes</button>
              <button type="button" aria-pressed={paidOnly} onClick={() => setPaidOnly(true)} className={seg(paidOnly)}>Payées</button>
            </div>
            <div role="group" aria-label="Période" className="flex rounded-full bg-field p-0.5">
              {([[30, "30 j"], [90, "90 j"], [0, "Tout"]] as const).map(([d, l]) => (
                <button key={l} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={seg(days === d)}>{l}</button>
              ))}
            </div>
            <span className="flex-1" />
            <button type="button" onClick={exportCsv} disabled={!shown.length} className="h-8 rounded-full bg-field px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-40">Exporter (Excel)</button>
          </div>
          {/* Posts */}
          <div className="mt-3 flex flex-col gap-2">
            {shown.length ? shown.map((p) => {
              const long = p.caption.length > 140;
              const isOpen = open.has(p.id);
              return (
                <div key={p.id} className="rounded-[16px] bg-panel p-3.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    <span className="font-semibold text-foreground">{fmtDate(p.at)}</span>
                    <span className="text-muted-foreground">· {p.kind}</span>
                    {p.paid && <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">Partenariat payé</span>}
                    <span className="flex-1" />
                    <a href={p.url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-primary hover:underline">Voir le post ↗</a>
                  </div>
                  {p.brands.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.brands.map((b) => <span key={b} className="rounded-full bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground">@{b}</span>)}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] tabular-nums text-muted-foreground">
                    <span><span className="font-semibold text-foreground">{p.likes != null ? fmtCompact(p.likes) : "masqués"}</span> likes</span>
                    <span><span className="font-semibold text-foreground">{fmtCompact(p.comments)}</span> commentaires</span>
                    {p.er != null && <span>engagement <span className="font-semibold text-foreground">{fmtPct(p.er)}</span></span>}
                  </div>
                  {p.caption && (
                    <p className={cn("mt-2 text-[13px] leading-relaxed text-muted-foreground", !isOpen && "line-clamp-2")}>
                      {p.caption}
                      {long && (
                        <button type="button" onClick={() => setOpen((cur) => { const n = new Set(cur); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} className="ml-1 font-medium text-foreground underline-offset-2 hover:underline">
                          {isOpen ? "moins" : "plus"}
                        </button>
                      )}
                    </p>
                  )}
                </div>
              );
            }) : <p className="py-4 text-center text-[13px] text-muted-foreground">Aucun post pour ces filtres.</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** Chiffres d'un compte Instagram (fonction ig-sourcing, mode « list »). */
export type IgStats = {
  name?: string; followers?: number; following?: number; posts?: number; er?: number | null; perWeek?: number | null;
  lastPost?: string | null; bio?: string; website?: string; email?: string; emailFrom?: "bio" | "lien" | "";
  agency?: string | null; deals?: string[]; cites?: string[]; picture?: string;
};

/** « @lena », « lena », « instagram.com/lena/ » → « lena ». */
export const cleanHandle = (h: string) => h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();

/**
 * Scouting : « tape un @ et vois ses stats ». Barre de recherche (même style que « Trouver
 * des contacts »), puis une fiche : abonnés, engagement, rythme, dernier post, bio, email
 * public, agence éventuelle, marques déjà en partenariat. « Ajouter au Scouting » en un clic.
 * Seuls les comptes Instagram pro ou créateur ont des chiffres (règle de Meta).
 */
export function CreatorLookup({ inScouting, onAdd }: {
  /** @ déjà dans le Scouting (minuscules, sans @). */
  inScouting: Set<string>;
  /** Ajoute le compte au Scouting ; true si c'est enregistré. */
  onAdd: (u: string, s: IgStats) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ u: string; s: IgStats; roster: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const look = async () => {
    const u = cleanHandle(q);
    if (!/^[a-z0-9._]{1,30}$/.test(u)) return toast("Indique un @ Instagram (ex. @lena.mrchd)");
    setBusy(true);
    try {
      const [{ data, error }, roster] = await Promise.all([
        supabase.functions.invoke("ig-sourcing", { body: { mode: "list", handles: [u] } }),
        supabase.from("creators").select("name").or(`instagram.ilike.%${u}%,handle.ilike.%${u}%`).limit(1),
      ]);
      noteQuota(data);
      const c = ((data as { candidates?: { username: string; data: IgStats | null; why: string | null }[] } | null)?.candidates ?? [])[0];
      if (error || !c) return toast("Lecture impossible pour le moment, réessaie");
      if (!c.data) return toast(c.why ? `@${u} : ${igWhyText(c.why)}` : `@${u} : aucun chiffre`);
      setOpen({ u, s: c.data, roster: ((roster.data as { name: string }[] | null) ?? [])[0]?.name ?? null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); void look(); }} className="mb-4 flex items-center gap-2 rounded-[16px] bg-surface p-1.5 pl-4 shadow-sm shadow-black/[0.03] ring-1 ring-transparent transition-shadow focus-within:ring-primary/40">
        <PlatformIcon platform="instagram" className="h-4 w-4 shrink-0 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Analyser un créateur : tape son @ Instagram"
          aria-label="@ Instagram d'un créateur"
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint max-md:text-[16px]"
        />
        <button type="submit" disabled={!q.trim() || busy} className="flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? <Spin size={14} /> : <Search className="h-4 w-4" />} <span className="max-sm:hidden">Voir ses stats</span>
        </button>
      </form>
      {open && (
        <StatsSheet
          u={open.u} s={open.s} roster={open.roster}
          inScouting={inScouting.has(open.u) || added.has(open.u)}
          adding={adding}
          onClose={() => setOpen(null)}
          onAdd={async () => {
            setAdding(true);
            const ok = await onAdd(open.u, open.s);
            setAdding(false);
            if (ok) setAdded((cur) => new Set(cur).add(open.u));
          }}
        />
      )}
    </>
  );
}

function StatsSheet({ u, s, roster, inScouting, adding, onClose, onAdd }: {
  u: string; s: IgStats; roster: string | null; inScouting: boolean; adding: boolean; onClose: () => void; onAdd: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const tiles: [string, string][] = [
    ["Abonnés", s.followers != null ? fmtCompact(s.followers) : "—"],
    ["Engagement", s.er != null ? fmtEr(s.er) : "—"],
    ["Posts / semaine", s.perWeek != null ? String(Math.round(s.perWeek * 10) / 10).replace(".", ",") : "—"],
    ["Dernier post", s.lastPost ? fmtAgo(s.lastPost) : "—"],
  ];
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié");
    } catch {
      toast("Copie impossible");
    }
  };
  return (
    <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={onClose} label={`Stats de @${u}`}>
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[22px] bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {/* En-tête : photo, nom, @ */}
          <div className="flex items-start gap-4">
            <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-field text-[18px] font-semibold text-muted-foreground">
              {initials(s.name || u)}
              {s.picture && imgOk && <img src={s.picture} alt="" onError={() => setImgOk(false)} className="absolute inset-0 h-full w-full object-cover" />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[20px] font-bold tracking-[-0.01em] text-foreground">{s.name || `@${u}`}</h2>
              <a href={`https://www.instagram.com/${u}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground">
                <PlatformIcon platform="instagram" className="h-3.5 w-3.5" />@{u}
              </a>
              {(roster || s.agency) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {roster && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-primary">Dans ton roster ({roster})</span>}
                  {s.agency && <span className="rounded-full bg-field px-2.5 py-0.5 text-[12px] font-medium text-foreground">Déjà en agence : {s.agency}</span>}
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-field text-muted-foreground transition-colors hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>

          {/* Chiffres */}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(([k, v]) => (
              <div key={k} className="rounded-[16px] bg-panel px-3.5 py-3">
                <div className="text-[20px] font-bold leading-none tracking-[-0.01em] tabular-nums text-foreground">{v}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">{k}</div>
              </div>
            ))}
          </div>
          {s.posts != null && <p className="mt-2 text-[12px] text-faint">{fmtCompact(s.posts)} publications · {s.following != null ? `${fmtCompact(s.following)} abonnements` : ""}</p>}

          {/* Bio, site, email */}
          {s.bio && <p className="mt-5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">{s.bio}</p>}
          {s.website && <a href={/^https?:\/\//i.test(s.website) ? s.website : `https://${s.website}`} target="_blank" rel="noreferrer" className="mt-1 inline-block max-w-full truncate text-[13px] text-primary hover:underline">{s.website.replace(/^https?:\/\/(www\.)?/i, "")}</a>}
          <div className="mt-4 flex items-center gap-3 rounded-[14px] bg-field px-3.5 py-3">
            <span className="text-[13px] text-muted-foreground">Email</span>
            {s.email ? (
              <>
                <span className="min-w-0 flex-1 truncate text-right text-[14px] font-medium text-foreground">{s.email}</span>
                <span className="shrink-0 text-[11.5px] text-faint">{s.emailFrom === "lien" ? "sur son site" : "dans sa bio"}</span>
                <button type="button" onClick={() => void copy(s.email!)} aria-label="Copier l'email" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-rowhover hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
              </>
            ) : (
              <span className="min-w-0 flex-1 text-right text-[13px] text-muted-foreground">Pas d'email public</span>
            )}
          </div>

          <CreatorCollabs u={u} />

        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row">
          <a href={`https://www.instagram.com/${u}/`} target="_blank" rel="noreferrer" className="flex h-11 min-h-11 shrink-0 flex-1 items-center justify-center gap-2 rounded-full bg-field text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover">
            <PlatformIcon platform="instagram" className="h-4 w-4" /> Ouvrir sur Instagram
          </a>
          <button type="button" onClick={onAdd} disabled={inScouting || adding} className={inScouting ? "flex h-11 min-h-11 shrink-0 flex-1 items-center justify-center gap-2 rounded-full bg-ok/10 text-[14px] font-semibold text-ok" : "flex h-11 min-h-11 shrink-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"}>
            {adding ? <Spin size={15} /> : inScouting ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {inScouting ? "Dans le Scouting" : "Ajouter au Scouting"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

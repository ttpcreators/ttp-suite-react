import { useEffect, useState } from "react";
import { Check, Copy, Search, UserPlus, X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { Overlay } from "@/components/mobile/ios-sheet";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { fmtAgo, fmtEr, igWhyText, noteQuota } from "@/lib/instagram";
import { fmtCompact } from "@/lib/timeSeries";
import { initials } from "@/lib/utils";

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
  const tag = (x: string) => (
    <a key={x} href={`https://www.instagram.com/${x}/`} target="_blank" rel="noreferrer" className="rounded-full bg-field px-2.5 py-1 text-[12.5px] font-medium text-foreground transition-colors hover:bg-rowhover">@{x}</a>
  );
  return (
    <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={onClose} label={`Stats de @${u}`}>
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-[22px] bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
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

          {/* Marques */}
          {!!s.deals?.length && (
            <div className="mt-5">
              <div className="mb-2 text-[13px] font-semibold text-foreground">Partenariats payés repérés</div>
              <div className="flex flex-wrap gap-1.5">{s.deals.map(tag)}</div>
            </div>
          )}
          {!!s.cites?.filter((x) => !s.deals?.includes(x)).length && (
            <div className="mt-4">
              <div className="mb-2 text-[13px] font-semibold text-foreground">Marques et comptes cités</div>
              <div className="flex flex-wrap gap-1.5">{s.cites.filter((x) => !s.deals?.includes(x)).slice(0, 10).map(tag)}</div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row">
          <a href={`https://www.instagram.com/${u}/`} target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-field text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover">
            <PlatformIcon platform="instagram" className="h-4 w-4" /> Ouvrir sur Instagram
          </a>
          <button type="button" onClick={onAdd} disabled={inScouting || adding} className={inScouting ? "flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-ok/10 text-[14px] font-semibold text-ok" : "flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"}>
            {adding ? <Spin size={15} /> : inScouting ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {inScouting ? "Dans le Scouting" : "Ajouter au Scouting"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

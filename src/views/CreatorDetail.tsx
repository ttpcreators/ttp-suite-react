import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, Copy, Pencil, Check, X, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { frDate, toISODate, todayISO } from "@/lib/dates";
import { isMainPlatform } from "@/lib/platform";
import { dbUpdate } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLiveKey } from "@/lib/useLive";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { parseAmount, formatEuro } from "@/lib/money";

type CtDeadline = { id?: string; creator: string; start: string; months: number; type?: string; note?: string };
function ctEndDate(start: string, months: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1 + (months || 0), Number(m[3]));
}
function daysUntil(d: Date): number {
  const t = new Date();
  return Math.round((d.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
}
function frDateShort(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

/** Historique d'engagement (mesures du calculateur) — pour le bloc « par plateforme ». */
type EngEntry = {
  creator: string;
  platform: string;
  platformLabel: string;
  er: string;
  followers: string;
  date: string; // date du calcul (jj/mm/aaaa), posée automatiquement à l'enregistrement
  vals?: Record<string, string>;
};
function frTime(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec((s ?? "").trim());
  if (!m) return 0;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return new Date(Number(y), Number(m[2]) - 1, Number(m[1])).getTime();
}
function numOf(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
import { AvatarUpload } from "@/components/ui/avatar-upload";

type Creator = {
  id: string;
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  followers: string | null;
  reach: string | null;
  er: string | null;
  ca: string | null;
  status: string | null;
  photo_url: string | null;
  ville: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  siren: string | null;
  birth: string | null;
  commission: string | null;
  instagram: string | null;
  tiktok: string | null;
  email_pro: string | null;
};
type Inv = { ref: string; party: string; amount: string; date: string; status?: string | null };
type Td = { id: string; text: string; done: boolean };
type Br = { brand: string; deliverables: string | null; due: string | null };
type Idea = { text: string };

type Coord = Pick<Creator, "ville" | "phone" | "email" | "address" | "siren" | "birth" | "email_pro" | "instagram" | "tiktok" | "commission" | "handle" | "niche" | "platform">;

/** Construit l'objet de formulaire éditable à partir d'une fiche (ou vide). */
function coordOf(c: Creator | null): Coord {
  return {
    ville: c?.ville ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    address: c?.address ?? "",
    siren: c?.siren ?? "",
    email_pro: c?.email_pro ?? "",
    instagram: c?.instagram ?? "",
    tiktok: c?.tiktok ?? "",
    commission: c?.commission ?? "",
    handle: c?.handle ?? "",
    niche: c?.niche ?? "",
    platform: c?.platform ?? "",
    birth: toISODate(c?.birth),
  };
}

const statusBadge = (s: string | null) =>
  s === "pause" ? "warning" : s === "inactif" ? "neutral" : "success";

/** Icônes réseaux en SVG inline (lucide a retiré les logos de marque). */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.59c.27 0 .53.04.77.12v-3.2a5.67 5.67 0 0 0-.77-.05A5.68 5.68 0 1 0 15.54 15.4V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.28 4.28 0 0 1-3.24-1.48z" />
    </svg>
  );
}
function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" stroke="none" />
    </svg>
  );
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.9 1.5h3.3l-7.2 8.2L23.7 22.5h-6.6l-5.2-6.8-6 6.8H2.6l7.7-8.8L2.3 1.5h6.8l4.7 6.2 5.1-6.2zm-1.2 18.9h1.8L7.4 3.4H5.5l12.2 17z" />
    </svg>
  );
}

/** Construit une URL de profil à partir d'un @handle ou d'une URL déjà complète. */
function socialUrl(base: string, raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return base + v.replace(/^@/, "").replace(/\s+/g, "");
}

export function CreatorDetail({
  name,
  onBack,
  onOpenPortal,
}: {
  name: string;
  onBack: () => void;
  onOpenPortal: (n: string) => void;
}) {
  const [c, setC] = useState<Creator | null>(null);
  const [inv, setInv] = useState<Inv[]>([]);
  const [td, setTd] = useState<Td[]>([]);
  const [br, setBr] = useState<Br[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [form, setForm] = useState<Coord>(() => coordOf(null));
  const [editing, setEditing] = useState(false);
  const [exclusive, setExclusive] = useState(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Édition inline du contrat (écrit dans le blob `contractDeadlines`, partagé avec Échéances).
  const [ctEditing, setCtEditing] = useState(false);
  const [ctStart, setCtStart] = useState("");
  const [ctMonths, setCtMonths] = useState("12");
  const [ctType, setCtType] = useState("représentation");

  const live = useLiveKey();
  const { data: deadlinesRemote } = useAppState<CtDeadline[]>((s: AppState) => (s["contractDeadlines"] as CtDeadline[]) ?? []);
  // Copie locale prioritaire après enregistrement du contrat (le blob ne se
  // resynchronise qu'au prochain tick live, ~20 s) — effacée dès que le remote arrive.
  const [deadlinesLocal, setDeadlinesLocal] = useState<CtDeadline[] | null>(null);
  useEffect(() => {
    setDeadlinesLocal(null);
  }, [deadlinesRemote]);
  const deadlines = deadlinesLocal ?? deadlinesRemote;
  const { data: exclusiveMap } = useAppState<Record<string, boolean>>(
    (s: AppState) => (s["creatorExclusive"] as Record<string, boolean>) ?? {},
  );
  // Dernière mesure PAR PLATEFORME (la fiche principale n'affiche que la
  // plateforme principale — ce bloc montre toutes celles mesurées, datées).
  const { data: engHist } = useAppState<EngEntry[]>(
    (s: AppState) => (s["engagementHistory"] as EngEntry[]) ?? [],
  );
  const perPlatform = (() => {
    const mine = (engHist ?? []).filter((h) => (h.creator ?? "").toLowerCase() === name.toLowerCase());
    const byPlat = new Map<string, EngEntry>();
    // `mine` est dans l'ordre du blob (plus récent en tête) ; à date ÉGALE on
    // garde donc la première rencontrée (`>` strict) = la plus récente.
    for (const h of mine) {
      const cur = byPlat.get(h.platform);
      if (!cur || frTime(h.date) > frTime(cur.date)) byPlat.set(h.platform, h);
    }
    return [...byPlat.values()];
  })();
  const exKey = name.toLowerCase();
  // Reflète l'exclusivité stockée (sauf en cours d'édition, où l'utilisateur la modifie).
  useEffect(() => {
    if (!editingRef.current && exclusiveMap) setExclusive(exclusiveMap[exKey] === true);
  }, [exclusiveMap, exKey]);

  // Date de fin du dernier contrat suivi (connecté à la page Échéances).
  let contractEnd: Date | null = null;
  let contractType = "";
  let contractEntry: CtDeadline | null = null;
  for (const d of deadlines ?? []) {
    if ((d.creator ?? "").toLowerCase() !== name.toLowerCase()) continue;
    const e = ctEndDate(d.start, d.months);
    if (e && (!contractEnd || e > contractEnd)) {
      contractEnd = e;
      contractType = d.type ?? "";
      contractEntry = d;
    }
  }
  const contractLeft = contractEnd ? daysUntil(contractEnd) : null;

  useEffect(() => {
    let alive = true;
    supabase.from("creators").select("*").eq("name", name).limit(1).then(({ data, error }) => {
      if (!alive) return;
      if (error) console.error("Chargement de la fiche créateur échoué:", error);
      const row = (data?.[0] as Creator) ?? null;
      setC(row);
      if (row && !editingRef.current) setForm(coordOf(row));
    });
    supabase.from("invoices").select("ref,party,amount,date,status").eq("creator", name).then(({ data, error }) => { if (error) console.error("Factures créateur:", error); if (alive) setInv((data as Inv[]) ?? []); });
    supabase.from("todos").select("id,text,done").eq("creator", name).then(({ data, error }) => { if (error) console.error("À faire créateur:", error); if (alive) setTd((data as Td[]) ?? []); });
    supabase.from("briefs").select("brand,deliverables,due").eq("creator", name).then(({ data, error }) => { if (error) console.error("Briefs créateur:", error); if (alive) setBr((data as Br[]) ?? []); });
    supabase.from("ideas").select("text").eq("creator", name).then(({ data, error }) => { if (error) console.error("Idées créateur:", error); if (alive) setIdeas((data as Idea[]) ?? []); });
    return () => {
      alive = false;
    };
  }, [name, live]);

  const save = async () => {
    if (!c) return;
    const patch: Partial<Creator> = { ...form };
    // Date de naissance legacy en texte libre illisible : le champ date arrive
    // vide (toISODate a renvoyé "") → on la PRÉSERVE au lieu de l'effacer.
    if (!form.birth && c.birth && !toISODate(c.birth)) delete patch.birth;
    const ok = await dbUpdate("creators", c.id, patch);
    if (!ok) {
      toast("Erreur — réessaie");
      return;
    }
    // Exclusivité : blob agence — relu FRAIS avant écriture (ne jamais réécrire
    // la map depuis un état local potentiellement périmé → flags des autres perdus).
    invalidateAppState();
    const freshEx = ((await getAppState())["creatorExclusive"] as Record<string, boolean>) ?? {};
    const okEx = await saveAppStateKey("creatorExclusive", { ...freshEx, [exKey]: exclusive });
    if (!okEx) toast("Exclusivité non enregistrée — réessaie");
    setC({ ...c, ...patch });
    setEditing(false);
    toast("Infos enregistrées ✓");
  };

  const cancel = () => {
    if (c) setForm(coordOf(c));
    setExclusive(exclusiveMap?.[exKey] === true);
    setEditing(false);
  };

  // Ouvre l'éditeur de contrat en pré-remplissant depuis l'échéance existante.
  const openCtEdit = () => {
    setCtStart(contractEntry?.start || todayISO());
    setCtMonths(String(contractEntry?.months ?? 12));
    setCtType(contractEntry?.type || "représentation");
    setCtEditing(true);
  };
  const saveContract = async () => {
    const months = Math.max(1, parseInt(ctMonths, 10) || 0);
    const start = ctStart || todayISO();
    // Relit le blob FRAIS : si `deadlines` n'était pas encore chargé, écrire
    // depuis l'état local effacerait toutes les échéances des autres créateurs.
    invalidateAppState();
    const list = (((await getAppState())["contractDeadlines"] as CtDeadline[]) ?? []).slice();
    const idx = contractEntry?.id ? list.findIndex((d) => d.id === contractEntry!.id) : -1;
    if (idx >= 0) list[idx] = { ...list[idx], creator: list[idx].creator || name, type: ctType, start, months };
    else list.push({ id: uid(), creator: name, type: ctType, start, months });
    const ok = await saveAppStateKey("contractDeadlines", list);
    if (!ok) {
      toast("Erreur — réessaie");
      return;
    }
    setDeadlinesLocal(list); // reflète immédiatement (évite le doublon et l'affichage périmé)
    setCtEditing(false);
    toast("Contrat mis à jour ✓");
  };

  const copyAll = () => {
    const text = [
      titleCase(name),
      [c?.handle, c?.niche].filter(Boolean).join(" · "),
      form.email && `Email perso : ${form.email}`,
      form.email_pro && `Email pro : ${form.email_pro}`,
      form.instagram && `Instagram : ${form.instagram}`,
      form.tiktok && `TikTok : ${form.tiktok}`,
      form.phone && `Tél : ${form.phone}`,
      form.ville && `Ville : ${form.ville}`,
      form.address && `Adresse : ${form.address}`,
      form.siren && `SIREN : ${form.siren}`,
      form.birth && `Naissance : ${frDate(form.birth)}`,
      c?.commission && `Commission : ${c.commission}`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard?.writeText(text);
    toast("Infos copiées ✓");
  };

  const field = (label: string, key: keyof Coord, type?: string) => (
    <div>
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <input
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder="—"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </div>
  );

  const copyRow = (label: string, value: string) => {
    const v = value?.trim() ?? "";
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
          <div className="truncate text-sm">{v || "—"}</div>
        </div>
        {v && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(v);
              toast(`${label} copié ✓`);
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            title={`Copier ${label.toLowerCase()}`}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  const stat = (label: string, val: string | null, sub?: string) => (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-2 whitespace-nowrap text-2xl font-bold tracking-tight">{val || "—"}</div>
      {sub && <div className="mt-1 truncate text-[10px] text-faint">{sub}</div>}
    </div>
  );

  // Liens réseaux cliquables (depuis les @handles ou la plateforme principale).
  const platform = (c?.platform ?? "").toLowerCase();
  const socialLinks: { label: string; url: string; icon: ReactNode }[] = [];
  const ig = socialUrl("https://instagram.com/", c?.instagram || (platform.includes("insta") ? c?.handle : null));
  if (ig) socialLinks.push({ label: "Instagram", url: ig, icon: <InstagramIcon className="h-4 w-4" /> });
  const tt = socialUrl("https://www.tiktok.com/@", c?.tiktok || (platform.includes("tiktok") ? c?.handle : null));
  if (tt) socialLinks.push({ label: "TikTok", url: tt, icon: <TikTokIcon className="h-4 w-4" /> });
  if (platform.includes("youtube") && c?.handle) {
    const yt = socialUrl("https://youtube.com/@", c.handle);
    if (yt) socialLinks.push({ label: "YouTube", url: yt, icon: <YoutubeIcon className="h-4 w-4" /> });
  }
  if ((platform.includes("twitter") || platform === "x" || platform.includes(" x")) && c?.handle) {
    const xu = socialUrl("https://x.com/", c.handle);
    if (xu) socialLinks.push({ label: "X", url: xu, icon: <XIcon className="h-4 w-4" /> });
  }

  // Carte « Plateformes » : réunit lien du profil (logo cliquable) + abonnés/taux
  // issus de la DERNIÈRE mesure d'engagement (datée automatiquement au jour du calcul).
  const platCards = (() => {
    const map = new Map<string, { key: string; label: string; url: string | null; entry: EngEntry | null }>();
    for (const s of socialLinks) {
      const k = s.label.toLowerCase();
      map.set(k, { key: k, label: s.label, url: s.url, entry: null });
    }
    for (const e of perPlatform) {
      const cur = map.get(e.platform);
      if (cur) cur.entry = e;
      else map.set(e.platform, { key: e.platform, label: e.platformLabel, url: null, entry: e });
    }
    return [...map.values()];
  })();
  const platIcon = (k: string) =>
    k === "instagram" ? (
      <InstagramIcon className="h-4 w-4" />
    ) : k === "tiktok" ? (
      <TikTokIcon className="h-4 w-4" />
    ) : k === "youtube" ? (
      <YoutubeIcon className="h-4 w-4" />
    ) : (
      <XIcon className="h-4 w-4" />
    );

  // Cartes du haut CONNECTÉES aux dernières mesures :
  // Abonnés = cumul des dernières mesures de chaque plateforme (comme le portail) ;
  // Engagement = dernière mesure de la plateforme principale (sinon la plus récente).
  const totalFollowers = perPlatform.reduce((a, p) => a + numOf(p.followers), 0);
  // CA encaissé = somme des factures payées de ce créateur (auto, plus de saisie manuelle).
  const caEncaisse = inv.filter((i) => i.status === "payee").reduce((a, i) => a + parseAmount(i.amount), 0);
  const latestMeasure = perPlatform.slice().sort((a, b) => frTime(b.date) - frTime(a.date))[0] ?? null;
  const mainEntry =
    perPlatform.length === 0
      ? null
      : (perPlatform.find((p) => isMainPlatform(c?.platform, p.platform)) ?? latestMeasure);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Roster
      </button>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AvatarUpload
            creatorId={c?.id}
            name={name}
            photoUrl={c?.photo_url ?? null}
            size={64}
            onUploaded={(url) => setC((prev) => (prev ? { ...prev, photo_url: url } : prev))}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <div className="text-xl font-semibold tracking-tight sm:text-2xl">{titleCase(name)}</div>
              <AnimatedBadge status={statusBadge(c?.status ?? null)} size="sm">
                {c?.status ? titleCase(c.status) : "Actif"}
              </AnimatedBadge>
              {exclusive && (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">
                  Exclusif
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-faint">
              {[c?.handle, c?.niche, c?.platform].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
        <button
          onClick={() => onOpenPortal(name)}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 sm:w-auto"
        >
          <ExternalLink className="h-4 w-4" /> Voir le portail
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stat(
          "Abonnés",
          totalFollowers > 0 ? fmtCompact(totalFollowers) : (c?.followers ?? null),
          totalFollowers > 0
            ? perPlatform.length > 1
              ? `cumul ${perPlatform.length} plateformes · au ${latestMeasure?.date}`
              : `${perPlatform[0]?.platformLabel} · au ${latestMeasure?.date}`
            : undefined,
        )}
        {stat(
          "Engagement",
          mainEntry ? mainEntry.er : (c?.er ?? null),
          mainEntry ? `${mainEntry.platformLabel} · au ${mainEntry.date}` : undefined,
        )}
        {stat("CA · encaissé", caEncaisse > 0 ? formatEuro(caEncaisse) : null)}
        {stat("Reach", c?.reach ?? null)}
      </div>

      {/* Plateformes — logo cliquable (ouvre le profil) + abonnés/taux de la
          dernière mesure d'engagement, datée automatiquement au jour du calcul */}
      {platCards.length > 0 && (
        <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Plateformes</div>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "suivi" }))}
              className="group flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary"
              title="Courbes d'évolution"
            >
              Voir l'évolution
              <ArrowUpRight className="h-3.5 w-3.5 text-faint transition-colors group-hover:text-primary" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {platCards.map((p) => (
              <div key={p.key} className="flex items-center gap-3 rounded-xl border border-border bg-panel px-4 py-3">
                {p.url ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Ouvrir le ${p.label} de ${titleCase(name)}`}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {platIcon(p.key)}
                  </a>
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-faint">
                    {platIcon(p.key)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{p.label}</span>
                    {p.entry && <span className="shrink-0 text-[9px] text-faint">au {p.entry.date}</span>}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-3">
                    <span className="whitespace-nowrap text-lg font-bold tracking-tight">
                      {p.entry && numOf(p.entry.followers) > 0 ? fmtCompact(numOf(p.entry.followers)) : "—"}
                      <span className="ml-1 text-[10px] font-medium text-faint">abonnés</span>
                    </span>
                    {p.entry && <span className="text-[11px] font-semibold text-signaltext">{p.entry.er}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Coordonnées &amp; informations</div>
          <div className="flex items-center gap-2">
            {c?.commission && (
              <div className="hidden rounded-lg bg-signalsoft px-3 py-1.5 text-xs font-semibold text-signaltext sm:block">
                Commission {c.commission}
              </div>
            )}
            {contractEnd && (
              <div
                className={
                  "hidden rounded-lg px-3 py-1.5 text-xs font-semibold sm:block " +
                  (contractLeft != null && contractLeft < 0
                    ? "bg-rose-500/12 text-rose-500"
                    : contractLeft != null && contractLeft <= 30
                      ? "bg-rose-500/12 text-rose-500"
                      : contractLeft != null && contractLeft <= 60
                        ? "bg-amber/15 text-amber"
                        : "bg-rowhover text-muted-foreground")
                }
                title={contractType ? `Contrat ${contractType}` : "Contrat"}
              >
                Contrat → {frDateShort(contractEnd)}
                {contractLeft != null && (contractLeft < 0 ? " · expiré" : contractLeft <= 60 ? ` · ${contractLeft} j` : "")}
              </div>
            )}
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" /> Enregistrer
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  title="Annuler"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" /> Modifier
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            {/* Exclusivité (stockée côté agence) */}
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-panel px-3 py-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={exclusive}
                onClick={() => setExclusive((x) => !x)}
                className={"relative h-5 w-9 shrink-0 rounded-full transition-colors " + (exclusive ? "bg-primary" : "bg-faint/40")}
                title="Basculer l'exclusivité"
              >
                <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " + (exclusive ? "left-[18px]" : "left-0.5")} />
              </button>
              <span className="text-sm font-medium text-foreground">Créateur en exclusivité</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {field("Pseudo (@)", "handle")}
              {field("Niche", "niche")}
              {field("Plateforme", "platform")}
              {field("Ville", "ville")}
              {field("Téléphone", "phone")}
              {field("Email perso", "email")}
              {field("Email pro", "email_pro")}
              {field("Instagram", "instagram")}
              {field("TikTok", "tiktok")}
              {field("Adresse", "address")}
              {field("SIREN", "siren")}
              {field("Naissance", "birth", "date")}
              {field("Commission (%)", "commission")}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {copyRow("Ville", form.ville ?? "")}
              {copyRow("Téléphone", form.phone ?? "")}
              {copyRow("Email perso", form.email ?? "")}
              {copyRow("Email pro", form.email_pro ?? "")}
              {copyRow("Instagram", form.instagram ?? "")}
              {copyRow("TikTok", form.tiktok ?? "")}
              {copyRow("Adresse", form.address ?? "")}
              {copyRow("SIREN", form.siren ?? "")}
              {copyRow("Naissance", frDate(form.birth))}
            </div>
            <button
              type="button"
              onClick={copyAll}
              className="mt-3 flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" /> Copier toutes les infos
            </button>
          </>
        )}
      </div>

      {/* Contrat — date de fin, connecté à la page Échéances */}
      <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Contrat</div>
          {!ctEditing && (
            <button
              type="button"
              onClick={openCtEdit}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" /> {contractEnd ? "Modifier" : "Définir"}
            </button>
          )}
        </div>

        {ctEditing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Date de début</div>
                <input
                  type="date"
                  value={ctStart}
                  onChange={(e) => setCtStart(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Durée (mois)</div>
                <input
                  type="number"
                  value={ctMonths}
                  onChange={(e) => setCtMonths(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Type</div>
                <input
                  value={ctType}
                  onChange={(e) => setCtType(e.target.value)}
                  placeholder="représentation"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveContract}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" /> Enregistrer
              </button>
              <button
                type="button"
                onClick={() => setCtEditing(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                title="Annuler"
              >
                <X className="h-4 w-4" />
              </button>
              <span className="text-[11px] text-faint">Synchronisé avec la page Échéances.</span>
            </div>
          </div>
        ) : contractEnd ? (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Se termine le</div>
              <div className="mt-0.5 text-2xl font-bold tracking-tight">{frDateShort(contractEnd)}</div>
            </div>
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Échéance</div>
              <div
                className={
                  "mt-0.5 text-sm font-semibold " +
                  (contractLeft != null && contractLeft <= 30
                    ? "text-rose-500"
                    : contractLeft != null && contractLeft <= 60
                      ? "text-amber"
                      : "text-foreground")
                }
              >
                {contractLeft == null
                  ? "—"
                  : contractLeft < 0
                    ? `Expiré depuis ${-contractLeft} j`
                    : contractLeft === 0
                      ? "Se termine aujourd'hui"
                      : `Dans ${contractLeft} j`}
              </div>
            </div>
            {contractType && (
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Type</div>
                <div className="mt-0.5 text-sm font-semibold capitalize">{contractType}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Aucun contrat renseigné. Clique sur « Définir » pour ajouter la date de fin (visible aussi dans Échéances).
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Facturation</div>
          {inv.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucune facture.</div>
          ) : (
            inv.map((v, i) => (
              <div key={`${v.ref}-${i}`} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{v.party}</div>
                  <div className="text-[10px] text-faint">#{v.ref} · {v.date}</div>
                </div>
                <span className="text-xs font-semibold">{v.amount}</span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">À faire</div>
          {td.length === 0 ? (
            <div className="text-xs text-muted-foreground">Rien à faire.</div>
          ) : (
            td.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5 py-1.5">
                <span className={"h-4 w-4 shrink-0 rounded-[5px] border " + (t.done ? "border-primary bg-primary" : "border-faint")} />
                <span className={"text-xs " + (t.done ? "text-faint line-through" : "")}>{t.text}</span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Briefs</div>
          {br.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucun brief.</div>
          ) : (
            br.map((b, i) => (
              <div key={`${b.brand}-${i}`} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{b.brand}</div>
                  <div className="truncate text-[10px] text-faint">{b.deliverables} · {frDate(b.due)}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Idées de contenu</div>
          {ideas.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucune idée.</div>
          ) : (
            ideas.map((x, i) => (
              <div key={`${x.text}-${i}`} className="flex items-center gap-2.5 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-indigo" />
                <span className="text-xs">{x.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

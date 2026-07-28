/**
 * Modèle de données du SUIVI CRÉATEURS (interne agence) — fiche éditoriale, suivi
 * mensuel, journal d'accompagnement, alertes. Tout vit dans le blob agence
 * (`app_state`, écriture atomique par clé), donc AUCUN SQL et cloisonné agence.
 * Clé = nom du créateur en minuscules (même convention que creatorExclusive / engagement).
 */

export const norm = (name: string): string => String(name ?? "").trim().toLowerCase();

// ─────────────────────────────── cadence ───────────────────────────────

export type Cadence = { reels: number; carrousels: number; stories: number; tiktoks: number; youtube: number };
export const emptyCadence = (): Cadence => ({ reels: 0, carrousels: 0, stories: 0, tiktoks: 0, youtube: 0 });
export const CADENCE_FIELDS: { key: keyof Cadence; label: string; short: string }[] = [
  { key: "reels", label: "Reels", short: "Reels" },
  { key: "carrousels", label: "Carrousels", short: "Carr." },
  { key: "stories", label: "Stories", short: "Stories" },
  { key: "tiktoks", label: "TikToks", short: "TikTok" },
  { key: "youtube", label: "Vidéos YouTube", short: "YT" },
];
export const cadenceTotal = (c: Cadence): number => CADENCE_FIELDS.reduce((s, f) => s + (Math.max(0, c[f.key] || 0)), 0);

// ─────────────────────────── fiche éditoriale ───────────────────────────

export const PLATFORMS_PRIO = ["instagram", "tiktok", "youtube"] as const;
export type PlatPrio = (typeof PLATFORMS_PRIO)[number];
export const platPrioLabel: Record<PlatPrio, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

export type EditorialProfile = {
  piliers: string[]; // piliers de contenu éditoriaux
  tonalite: string; // tonalité / ton de voix
  positionnement: string; // niche & positionnement (complément de la fiche)
  plateformes: PlatPrio[]; // plateformes prioritaires
  objectifs90: string; // objectifs fixés sur 90 jours (qualitatif)
  cadenceReco: Cadence; // cadence recommandée de référence (cible mesurable)
  dateEntree: string; // date d'entrée dans l'agence (ISO)
  conformite: string; // note de conformité loi 2023-451 (statut / rappel)
};
export const PROFILES_KEY = "creatorProfiles"; // Record<norm(name), EditorialProfile>

export const emptyProfile = (): EditorialProfile => ({
  piliers: [],
  tonalite: "",
  positionnement: "",
  plateformes: [],
  objectifs90: "",
  cadenceReco: emptyCadence(),
  dateEntree: "",
  conformite: "",
});

/** Forme garantie (un blob legacy/partiel ne casse pas le rendu). */
export function normProfile(p: Partial<EditorialProfile> | undefined): EditorialProfile {
  const e = emptyProfile();
  return {
    piliers: Array.isArray(p?.piliers) ? p!.piliers.filter(Boolean) : [],
    tonalite: p?.tonalite ?? "",
    positionnement: p?.positionnement ?? "",
    plateformes: Array.isArray(p?.plateformes) ? (p!.plateformes.filter((x) => (PLATFORMS_PRIO as readonly string[]).includes(x)) as PlatPrio[]) : [],
    objectifs90: p?.objectifs90 ?? "",
    cadenceReco: { ...e.cadenceReco, ...(p?.cadenceReco ?? {}) },
    dateEntree: p?.dateEntree ?? "",
    conformite: p?.conformite ?? "",
  };
}

// ─────────────────────────────── suivi mensuel ───────────────────────────

export type MonthEntry = {
  month: string; // "AAAA-MM"
  cadence: Cadence; // cadence RÉELLE publiée
  erInsta: string;
  erTiktok: string;
  vuesMoy: string;
  faits: string; // faits marquants (texte libre)
  derive: boolean; // dérive éditoriale détectée ?
  deriveNote: string;
};
export const MONTHLY_KEY = "creatorMonthly"; // Record<norm(name), MonthEntry[]>
export const emptyMonth = (month: string): MonthEntry => ({ month, cadence: emptyCadence(), erInsta: "", erTiktok: "", vuesMoy: "", faits: "", derive: false, deriveNote: "" });
export const monthLabel = (m: string): string => {
  const [y, mo] = String(m).split("-").map(Number);
  if (!y || !mo) return m;
  const s = new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const currentMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ───────────────────────── journal d'accompagnement ─────────────────────

export type ExchangeType = "appel" | "message" | "reunion";
export const EXCHANGE_META: Record<ExchangeType, { label: string }> = {
  appel: { label: "Appel" },
  message: { label: "Message" },
  reunion: { label: "Réunion" },
};
export type JournalEntry = {
  id: string;
  date: string; // ISO
  type: ExchangeType;
  resume: string;
  decisions: string;
  actions: string;
  prochainPoint: string; // ISO
};
export const JOURNAL_KEY = "creatorJournal"; // Record<norm(name), JournalEntry[]>

// ───────────────────────────────── alertes ───────────────────────────────

export type Trajectory = "bonne" | "surveiller" | "difficulte";
export const TRAJECTORY_META: Record<Trajectory, { label: string; dot: string }> = {
  bonne: { label: "Sur la bonne trajectoire", dot: "bg-emerald-500" },
  surveiller: { label: "À surveiller", dot: "bg-amber-500" },
  difficulte: { label: "En difficulté", dot: "bg-rose-500" },
};

export type Alert = { kind: "sousperf" | "derive" | "renouvellement" | "conformite"; label: string; level: "warn" | "danger" };

/** Alertes calculées pour un créateur, à partir de son profil + son dernier mois + échéances. */
export function computeAlerts(opts: {
  profile: EditorialProfile;
  lastMonth?: MonthEntry;
  deadlineInDays?: number | null; // jours avant renouvellement de deal (null si aucun)
}): Alert[] {
  const out: Alert[] = [];
  const { profile, lastMonth, deadlineInDays } = opts;
  // Sous-performance : cadence réelle du dernier mois < 70 % de la cadence recommandée.
  if (lastMonth) {
    const reco = cadenceTotal(profile.cadenceReco);
    const real = cadenceTotal(lastMonth.cadence);
    if (reco > 0 && real < reco * 0.7) out.push({ kind: "sousperf", label: `Cadence ${real}/${reco} vs objectif`, level: "danger" });
    if (lastMonth.derive) out.push({ kind: "derive", label: "Dérive éditoriale détectée", level: "warn" });
  }
  // Renouvellement de deal qui approche (≤ 30 jours).
  if (deadlineInDays != null && deadlineInDays <= 30) {
    out.push({ kind: "renouvellement", label: deadlineInDays <= 0 ? "Deal échu" : `Renouvellement dans ${deadlineInDays} j`, level: deadlineInDays <= 7 ? "danger" : "warn" });
  }
  // Conformité loi 2023-451 : à vérifier tant que le champ n'est pas marqué « ok ».
  const conf = norm(profile.conformite);
  if (profile.conformite && conf !== "ok" && conf !== "conforme" && conf !== "à jour" && conf !== "a jour") {
    out.push({ kind: "conformite", label: "Conformité à vérifier (loi 2023-451)", level: "warn" });
  }
  return out;
}

/** Statut de trajectoire global dérivé des alertes (le plus grave l'emporte). */
export function trajectoryOf(alerts: Alert[]): Trajectory {
  if (alerts.some((a) => a.level === "danger")) return "difficulte";
  if (alerts.length > 0) return "surveiller";
  return "bonne";
}

// ───────────────────── dérivés pour le tableau de bord ──────────────────

/** Jours restants avant la fin d'un deal (début + durée en mois). null si date invalide. */
export function contractDaysLeft(start: string, months: number): number | null {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + (months || 0));
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Dernier mois suivi (le plus récent). */
export function lastMonthOf(entries: MonthEntry[] | undefined): MonthEntry | undefined {
  if (!entries?.length) return undefined;
  return [...entries].sort((a, b) => b.month.localeCompare(a.month))[0];
}

/** Date du dernier échange noté (journal), ou null. */
export function lastContact(journal: JournalEntry[] | undefined): string | null {
  if (!journal?.length) return null;
  return [...journal].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0].date || null;
}

/** Prochaine date de « prochain point » à venir (>= aujourd'hui), ou null. */
export function nextPoint(journal: JournalEntry[] | undefined): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (journal ?? []).map((j) => j.prochainPoint).filter((d) => d && d >= today).sort();
  return upcoming[0] ?? null;
}

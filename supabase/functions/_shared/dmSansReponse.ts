// ============================================================================
// _shared/dmSansReponse.ts : les conversations Instagram restées sans réponse
// (outil dm_sans_reponse du connecteur Claude, ttp-mcp/autonomie.ts).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M12). L'agence a écrit à des centaines de marques et de
// créateurs en DM : quand le dernier message est le nôtre et que rien n'est revenu, on
// reprend le contact par e-mail. L'outil dit pour chaque compte ce qu'on sait déjà (marque
// ou créateur, abonnés, site, e-mail du profil, e-mail donné en DM, agence) et s'il est
// déjà au carnet, pour ne pas chercher deux fois.
// Règles PURES, testées par dmSansReponse.test.ts.
// ============================================================================

export type FilDm = {
  id: string;
  username: string | null;
  name: string | null;
  followers: number | null;
  updated_at: string | null;
  emails: string[] | null;
  contact_id: string | null;
};

/** Ce qu'on a déjà lu du profil (table ig_profiles), null si le profil n'a jamais été lu. */
export type ProfilDm = {
  username: string;
  isBrand: boolean | null;
  website: string | null;
  email: string | null;
  followers: number | null;
  agency: string | null;
  agence: string | null;
  agence_nom: string | null;
};

export type GenreCompte = "marque" | "createur" | "inconnu";
export type TypeDemande = "marques" | "createurs" | "inconnus" | "tous";

export type LigneSansReponse = {
  compte: string;
  nom: string;
  genre: GenreCompte;
  abonnes: number | null;
  jours: number;
  dernier: string;
  site: string;
  emailProfil: string;
  emailsDm: string[];
  agence: string;
  auCarnet: boolean;
};

export type Demande = {
  now: Date;
  /** Jours écoulés au moins depuis notre dernier message. */
  joursMin: number;
  type: TypeDemande;
  abonnesMin: number;
  /** Laisser de côté les comptes déjà au carnet de contacts. */
  sansContact: boolean;
  /** Laisser de côté les créateurs déjà en agence. */
  sansAgence: boolean;
};

const compte = (v: unknown) => String(v ?? "").trim().replace(/^@+/, "").toLowerCase();
const texte = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** « @Nova.Paris » ou un lien Instagram → « nova.paris » (clé de comparaison avec le carnet). */
export function cleCompte(v: unknown): string {
  const t = String(v ?? "").trim();
  const m = /instagram\.com\/([^/?#\s]+)/i.exec(t);
  return compte(m ? m[1] : t);
}

/** L'agence connue d'un profil, "" s'il n'y en a pas. */
export function agenceDuProfil(p: ProfilDm | undefined): string {
  if (!p) return "";
  if (texte(p.agence).toLowerCase() === "oui") return texte(p.agence_nom) || "oui";
  const indice = texte(p.agency);
  return indice && !/^(non|null|false)$/i.test(indice) ? indice : "";
}

/** « 12 oct. » à Paris. */
export function jourCourt(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }) : "";
}

/**
 * Les conversations où nous avons écrit en dernier, triées : les plus gros comptes d'abord,
 * puis les messages les plus anciens. `fils` = seulement des conversations dont le dernier
 * message est le nôtre.
 */
export function sansReponse(fils: readonly FilDm[], profils: readonly ProfilDm[], comptesDuCarnet: ReadonlySet<string>, d: Demande): LigneSansReponse[] {
  const parCompte = new Map(profils.map((p) => [compte(p.username), p]));
  const vus = new Set<string>();
  const out: LigneSansReponse[] = [];
  for (const f of fils) {
    const c = compte(f.username);
    if (!c || vus.has(c)) continue;
    vus.add(c);
    const quand = Date.parse(String(f.updated_at ?? ""));
    if (!Number.isFinite(quand)) continue;
    const jours = Math.floor((d.now.getTime() - quand) / 86_400_000);
    if (jours < d.joursMin) continue;
    const p = parCompte.get(c);
    const genre: GenreCompte = !p || p.isBrand === null || p.isBrand === undefined ? "inconnu" : p.isBrand ? "marque" : "createur";
    if (d.type === "marques" && genre !== "marque") continue;
    if (d.type === "createurs" && genre !== "createur") continue;
    if (d.type === "inconnus" && genre !== "inconnu") continue;
    const abonnes = [p?.followers, f.followers].map(Number).find((n) => Number.isFinite(n) && n > 0) ?? null;
    if (d.abonnesMin > 0 && (abonnes ?? 0) < d.abonnesMin) continue;
    const auCarnet = !!f.contact_id || comptesDuCarnet.has(c);
    if (d.sansContact && auCarnet) continue;
    const agence = agenceDuProfil(p);
    if (d.sansAgence && genre === "createur" && agence) continue;
    out.push({
      compte: `@${c}`,
      nom: texte(f.name),
      genre,
      abonnes,
      jours,
      dernier: jourCourt(new Date(quand).toISOString()),
      site: texte(p?.website),
      emailProfil: texte(p?.email).toLowerCase(),
      emailsDm: [...new Set((f.emails ?? []).map((e) => texte(e).toLowerCase()).filter(Boolean))].slice(0, 3),
      agence,
      auCarnet,
    });
  }
  return out.sort((a, b) => (b.abonnes ?? -1) - (a.abonnes ?? -1) || b.jours - a.jours);
}

const fr = (n: number) => n.toLocaleString("fr-FR");

/** Un compte sur une ligne, avec tout ce qu'on sait déjà pour le joindre par e-mail. */
export function ligneSansReponse(l: LigneSansReponse): string {
  return [
    `- ${l.compte}${l.nom ? ` (${l.nom})` : ""}`,
    l.genre === "inconnu" ? "profil jamais lu" : l.genre === "marque" ? "marque" : "créateur",
    l.abonnes ? `${fr(l.abonnes)} abonnés` : "",
    `notre dernier message : ${l.dernier}, il y a ${fr(l.jours)} j`,
    l.emailsDm.length ? `e-mail donné en DM : ${l.emailsDm.join(", ")}` : "",
    l.emailProfil ? `e-mail du profil : ${l.emailProfil}` : "",
    l.site ? `site : ${l.site}` : "",
    l.agence ? `agence : ${l.agence}` : "",
    l.auCarnet ? "déjà au carnet" : "",
  ].filter(Boolean).join(" · ");
}

/** Le décompte par genre, pour l'en-tête de la réponse. */
export function decompte(lignes: readonly LigneSansReponse[]): string {
  const n = (g: GenreCompte) => lignes.filter((l) => l.genre === g).length;
  return `${fr(n("marque"))} marque(s), ${fr(n("createur"))} créateur(s), ${fr(n("inconnu"))} profil(s) jamais lu(s)`;
}

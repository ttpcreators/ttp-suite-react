// ============================================================================
// equipeClaude.ts : ce que les autres membres de l'équipe ont fait par leur propre Claude
// (connecteur TTP Suite), lu dans mcp_log (demande de Marc, 25 novembre 2026 : Gianni prospecte
// avec son Claude, et Alfred doit reconnaître son travail au lieu de le prendre pour une anomalie).
// Une ligne courte par action qui écrit, tirée des arguments gardés dans mcp_log.summary.
// ============================================================================

/** Les outils qui écrivent et qui comptent pour l'équipe (le reste n'est que lecture). */
export const OUTILS_EQUIPE = [
  "creer_brouillon_mail", "envoyer_brouillon", "envoyer_mail", "programmer_envoi", "ajouter_contact", "ajouter_contacts",
  "noter_echange_contact", "ne_plus_contacter", "creer_tache", "cocher_tache", "creer_element", "modifier_element",
  "sequence_contact", "proposer_action", "ajouter_au_scouting", "changer_statut_scouting", "noter_contact_createur",
  "creer_evenement",
] as const;

const court = (v: unknown, n = 70) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Les valeurs entières d'une clé, dans l'ordre (le résumé peut être coupé). */
const valeurs = (brut: string, k: string) => [...brut.matchAll(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`, "g"))].map((m) => m[1]);

/** Une liste des arguments : combien d'éléments, et si elle se lit en entier (résumé coupé sinon). null si elle manque. */
function liste(a: Record<string, unknown>, brut: string, k: string, objets = false): { n: number; entiere: boolean } | null {
  const v = a[k];
  if (Array.isArray(v)) return { n: v.length, entiere: true };
  const m = new RegExp(`"${k}"\\s*:\\s*\\[([^\\]]*)(\\])?`).exec(brut);
  if (!m) return null;
  return { n: (m[1].match(objets ? /\{/g : /"[^"]*"/g) ?? []).length, entiere: !!m[2] };
}

/** « 12 mails », ou « 4 fiches ou plus » quand le résumé coupé n'en montre qu'une partie. */
const combien = (l: { n: number; entiere: boolean }, mot: string) => `${l.n} ${mot}${l.n > 1 || !l.entiere ? "s" : ""}${l.entiere ? "" : " ou plus"}`;

const RAISONS = new Map([["refus", "refus"], ["arret", "demande d'arrêt"], ["rebond", "rebond"], ["autre", "autre"]]);

/** « brouillon (partnerships) à adele@exemple.fr : Hello Adèle, J'espère que… » */
export function ligneActionEquipe(tool: string, summary: string | null | undefined): string {
  const brut = String(summary ?? "");
  let a: Record<string, unknown> = {};
  try {
    const o: unknown = JSON.parse(brut || "{}");
    if (o && typeof o === "object" && !Array.isArray(o)) a = o as Record<string, unknown>;
  } catch {
    // résumé coupé à la longueur maximale : on garde ce qu'on peut lire
    const m = (k: string) => new RegExp(`"${k}"\\s*:\\s*"([^"]*)`).exec(brut)?.[1];
    const cles = ["a", "boite", "objet", "nom", "marque", "texte", "message", "lot", "action", "email", "domaine", "raison", "profil", "canal"];
    a = Object.fromEntries(cles.map((k) => [k, m(k)]));
  }
  const qui = court(a.a ?? a.email ?? a.contact ?? a.nom ?? a.marque, 60);
  switch (tool) {
    case "creer_brouillon_mail":
      return `brouillon${a.boite ? ` (${court(a.boite, 40)})` : ""}${qui ? ` à ${qui}` : ""}${a.objet ? ` · « ${court(a.objet, 60)} »` : a.message ? ` · ${court(a.message, 60)}…` : ""}`;
    case "envoyer_brouillon":
    case "envoyer_mail":
      return `mail envoyé${a.boite ? ` (${court(a.boite, 40)})` : ""}${qui ? ` à ${qui}` : ""}`;
    case "programmer_envoi": {
      const l = liste(a, brut, "brouillons");
      return `envoi programmé${a.boite ? ` (${court(a.boite, 40)})` : ""}${l ? ` : ${combien(l, "mail")}` : ""}${a.lot ? ` · lot « ${court(a.lot, 40)} »` : ""}`;
    }
    case "ajouter_contact":
      return `contact ajouté : ${court([a.nom, a.marque ?? a.entreprise].filter(Boolean).join(", "), 80) || "?"}`;
    case "ajouter_contacts": {
      const l = liste(a, brut, "contacts", true);
      const marques = Array.isArray(a.contacts)
        ? a.contacts.map((c) => court(c && typeof c === "object" ? (c as Record<string, unknown>).marque : "", 30)).filter(Boolean)
        : valeurs(brut, "marque").map((x) => court(x, 30)).filter(Boolean);
      const suite = marques.length > 3 || (l !== null && !l.entiere) ? "…" : "";
      return `contacts ajoutés en lot${l ? ` : ${combien(l, "fiche")}` : ""}${marques.length ? ` (${marques.slice(0, 3).join(", ")}${suite})` : ""}`;
    }
    case "noter_echange_contact":
      return `échange noté${qui ? ` avec ${qui}` : ""}${a.resume ?? a.texte ? ` : ${court(a.resume ?? a.texte, 60)}` : ""}`;
    case "ne_plus_contacter": {
      if (a.action === "lister") return "liste « ne plus contacter » consultée";
      const cible = court(a.email || (a.domaine ? `@${String(a.domaine).replace(/^@/, "")}` : ""), 60) || "?";
      if (a.action === "retirer") return `retiré de « ne plus contacter » : ${cible}`;
      const raison = RAISONS.get(String(a.raison ?? "")) ?? "";
      return `ne plus contacter : ${cible}${raison ? ` (${raison})` : ""}`;
    }
    case "noter_contact_createur": {
      const p = court(a.profil, 60);
      const fiche = /^[0-9a-f-]{36}$/i.test(p) ? `fiche Scouting ${p}` : p;
      return `contact créateur noté${a.canal ? ` (${a.canal === "email" ? "mail" : "DM"})` : ""} : ${fiche || "?"}`;
    }
    case "creer_tache":
      return `tâche créée : ${court(a.texte ?? a.titre ?? a.text, 80)}`;
    case "cocher_tache":
      return "tâche cochée";
    default:
      return `${tool.replace(/_/g, " ")}${qui ? ` · ${qui}` : ""}`;
  }
}

/** Les arguments d'une ligne de mcp_log, même quand le résumé a été coupé. */
function argsDe(summary: string | null | undefined): Record<string, string> {
  try {
    const o = JSON.parse(String(summary ?? "{}"));
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  } catch {
    const m = (k: string) => new RegExp(`"${k}"\\s*:\\s*"([^"]*)`).exec(String(summary ?? ""))?.[1] ?? "";
    return { a: m("a"), fil: m("fil"), boite: m("boite"), objet: m("objet") };
  }
}

export type LigneMail = { tool: string; summary: string | null; at: string; qui: string };

/**
 * Un mail qu'un autre membre de l'équipe a déjà préparé ou envoyé (demande de Marc, 25 novembre
 * 2026 : pas de doublon de message entre Alfred et Gianni) : pour un nouveau mail, le même
 * destinataire ; pour une réponse, le même fil. Renvoie la ligne trouvée, ou null.
 */
export function doublonEquipe(lignes: LigneMail[], adresses: string[], fil: string): LigneMail | null {
  const voulues = new Set(adresses.map((x) => x.trim().toLowerCase()).filter(Boolean));
  for (const l of lignes) {
    const a = argsDe(l.summary);
    if (fil) {
      if (a.fil && a.fil === fil) return l;
      continue;
    }
    if (a.fil) continue; // une réponse dans un fil de l'autre n'empêche pas un premier mail ailleurs
    const leurs = String(a.a ?? "").toLowerCase().split(/[,;\s]+/).filter((x) => x.includes("@"));
    if (leurs.some((x) => voulues.has(x))) return l;
  }
  return null;
}

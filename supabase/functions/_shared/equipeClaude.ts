// ============================================================================
// equipeClaude.ts : ce que les autres membres de l'équipe ont fait par leur propre Claude
// (connecteur TTP Suite), lu dans mcp_log (demande de Marc, 25 novembre 2026 : Gianni prospecte
// avec son Claude, et Alfred doit reconnaître son travail au lieu de le prendre pour une anomalie).
// Une ligne courte par action qui écrit, tirée des arguments gardés dans mcp_log.summary.
// ============================================================================

/** Les outils qui écrivent et qui comptent pour l'équipe (le reste n'est que lecture). */
export const OUTILS_EQUIPE = [
  "creer_brouillon_mail", "envoyer_brouillon", "envoyer_mail", "ajouter_contact", "noter_echange_contact",
  "creer_tache", "cocher_tache", "creer_element", "modifier_element", "sequence_contact", "proposer_action",
  "ajouter_au_scouting", "changer_statut_scouting", "creer_evenement",
] as const;

const court = (v: unknown, n = 70) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** « brouillon (partnerships) à adele@187com.fr : Hello Adèle, J'espère que… » */
export function ligneActionEquipe(tool: string, summary: string | null | undefined): string {
  let a: Record<string, unknown> = {};
  try {
    a = JSON.parse(String(summary ?? "{}"));
  } catch {
    // résumé coupé à la longueur maximale : on garde ce qu'on peut lire
    const m = (k: string) => new RegExp(`"${k}"\\s*:\\s*"([^"]*)`).exec(String(summary ?? ""))?.[1];
    a = { a: m("a"), boite: m("boite"), objet: m("objet"), nom: m("nom"), marque: m("marque"), texte: m("texte"), message: m("message") };
  }
  const qui = court(a.a ?? a.email ?? a.contact ?? a.nom ?? a.marque, 60);
  switch (tool) {
    case "creer_brouillon_mail":
      return `brouillon${a.boite ? ` (${court(a.boite, 40)})` : ""}${qui ? ` à ${qui}` : ""}${a.objet ? ` · « ${court(a.objet, 60)} »` : a.message ? ` · ${court(a.message, 60)}…` : ""}`;
    case "envoyer_brouillon":
    case "envoyer_mail":
      return `mail envoyé${a.boite ? ` (${court(a.boite, 40)})` : ""}${qui ? ` à ${qui}` : ""}`;
    case "ajouter_contact":
      return `contact ajouté : ${court([a.nom, a.marque ?? a.entreprise].filter(Boolean).join(", "), 80) || "?"}`;
    case "noter_echange_contact":
      return `échange noté${qui ? ` avec ${qui}` : ""}${a.resume ?? a.texte ? ` : ${court(a.resume ?? a.texte, 60)}` : ""}`;
    case "creer_tache":
      return `tâche créée : ${court(a.texte ?? a.titre ?? a.text, 80)}`;
    case "cocher_tache":
      return "tâche cochée";
    default:
      return `${tool.replace(/_/g, " ")}${qui ? ` · ${qui}` : ""}`;
  }
}

// ============================================================================
// _shared/activityText.ts : phrase lisible d'une ligne du journal de l'équipe
// (table agency_activity). Code PUR, partagé par l'app (cloche, page Activité)
// et la fonction team-notify (notifications). Testé par src/lib/team.test.ts.
// ============================================================================

export type ActivityRow = { verb: string; entity: string; label: string; detail?: string | null };

/** Nom de chaque type d'élément : [indéfini, défini]. */
const NOUN: Record<string, [string, string]> = {
  todos: ["une tâche", "la tâche"],
  todo_routines: ["une tâche hebdo", "la tâche hebdo"],
  ideas: ["une idée", "l'idée"],
  events: ["un évènement", "l'évènement"],
  contacts: ["un contact", "le contact"],
  creators: ["une créatrice", "la créatrice"],
  collabs: ["une collab", "la collab"],
  briefs: ["un brief", "le brief"],
  invoices: ["une facture", "la facture"],
  documents: ["un document", "le document"],
  gifting: ["un cadeau", "le cadeau"],
  creator_pool: ["un profil au scouting", "le profil"],
  prospects: ["un prospect", "le prospect"],
};

const COLLAB_STATUS: Record<string, string> = {
  gagnee: "a marqué gagnée la collab",
  perdue: "a marqué perdue la collab",
  archivee: "a archivé la collab",
  active: "a remis en cours la collab",
};
const STATUS_LABEL: Record<string, string> = {
  payee: "payée", attente: "en attente", retard: "en retard", brouillon: "brouillon",
  valider: "à valider", cours: "en cours", "terminé": "terminé", recu: "reçu", publie: "publié",
};

/** « a terminé la tâche » + « Relancer Nike ». */
export function activityText(r: ActivityRow): { action: string; what: string } {
  const [a, the] = NOUN[r.entity] ?? ["un élément", "l'élément"];
  const what = r.label;
  switch (r.verb) {
    case "add": return { action: `a ajouté ${a}`, what };
    case "delete": return { action: `a supprimé ${the}`, what };
    case "done": return { action: r.entity === "todo_routines" ? "a fait la tâche hebdo" : `a terminé ${the}`, what };
    case "reopen": return { action: `a rouvert ${the}`, what };
    case "step": return { action: `a fait avancer ${the} (étape ${r.detail ?? "?"})`, what };
    case "status":
      if (r.entity === "collabs" && r.detail && COLLAB_STATUS[r.detail]) return { action: COLLAB_STATUS[r.detail], what };
      return { action: `a passé ${the} en « ${STATUS_LABEL[r.detail ?? ""] ?? r.detail ?? "?"} »`, what };
    default: return { action: `a modifié ${the}`, what };
  }
}

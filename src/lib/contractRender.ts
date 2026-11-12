/**
 * Contrat rendu hors de l'app, pour Alfred : à partir des mêmes entrées que l'outil
 * `preparer_contrat` (marque, montant, livrables… ou `representation`), le HTML exact que la
 * page Contrats aurait fait (même moteur, mêmes clauses, même mise en page). Alfred le reçoit
 * tout fait dans `agents/alfred/contrats.mjs` (généré par `npm run alfred:contrats`) et
 * l'envoie en PDF sur Telegram. La signature de l'agence n'y est pas : elle se pose quand Marc
 * génère le contrat dans l'app.
 */
import { estRepresentation, normaliserBrouillon } from "../../supabase/functions/_shared/contractDraft.ts";
import { brandContractDoc } from "./brandContract";
import { rcDefaultConfig, representationHTML } from "./representationContract";

type Json = Record<string, unknown>;

export function renderContract(a: Json): { html: string; titre: string } | { erreur: string } {
  const ctName = typeof a.createur === "string" ? a.createur.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!ctName) return { erreur: "Indique le créateur (createur)." };
  const r = normaliserBrouillon(a, { id: "alfred", ts: Date.now(), ctName, externe: estRepresentation(a) });
  if ("erreur" in r) return r;
  const d = r.brouillon;
  if (d.ctType === "repr") {
    const config = { ...rcDefaultConfig(d.config?.variante ?? "exclusif"), ...d.config };
    return { html: representationHTML(config), titre: `Contrat de représentation · ${config.talentNom}` };
  }
  if (!d.form) return { erreur: "Contrat incomplet." };
  const doc = brandContractDoc({ ...d.form, extra: d.form.extra.map((c) => ({ l: c.l, v: c.v })) }, d.ctName);
  return { html: doc.html, titre: `${doc.title} · ${d.brand} × ${d.ctName}` };
}

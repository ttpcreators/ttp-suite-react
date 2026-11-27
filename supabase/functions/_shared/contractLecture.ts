/**
 * lire_contrat (connecteur) : le texte COMPLET d'un contrat de représentation, tel que l'app
 * l'imprime (même moteur, _shared/representation.ts), pour qu'Alfred relise ce qui part
 * vraiment à la signature : un brouillon (avec les modifications faites dans l'app) ou un
 * contrat enregistré. Logique pure, testée par contractLecture.test.ts.
 */
import { lireBrouillons, type ContractDraft } from "./contractDraft.ts";
import { rcDefaultConfig, representationText } from "./representation.ts";

export type ContratEnregistre = { id: string; creator: string | null; title: string; variante: string; config: Record<string, string>; createdAt: string; status?: string };

export type ContratTrouve =
  | { kind: "brouillon"; id: string; qui: string; date: string; brouillon: ContractDraft }
  | { kind: "enregistre"; id: string; qui: string; date: string; contrat: ContratEnregistre };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Contrats enregistrés bien formés (historique de l'app, clé `contractHistory`). */
export function lireEnregistres(v: unknown): ContratEnregistre[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is ContratEnregistre => !!e && typeof e === "object" && typeof (e as ContratEnregistre).id === "string" && !!(e as ContratEnregistre).config && typeof (e as ContratEnregistre).config === "object");
}

/** Brouillons puis contrats enregistrés (plus récents d'abord), filtrés par id ou par créateur. */
export function trouverContrats(drafts: unknown, history: unknown, f: { id?: string; createur?: string }): ContratTrouve[] {
  const id = (f.id ?? "").trim();
  const who = fold(f.createur ?? "");
  const match = (names: (string | null | undefined)[]) => !who || names.some((n) => n && fold(n).includes(who));
  const b: ContratTrouve[] = lireBrouillons(drafts)
    .filter((d) => (id ? d.id === id : match([d.ctName, d.config?.talentNom])))
    .sort((x, y) => y.ts - x.ts)
    .map((d) => ({ kind: "brouillon", id: d.id, qui: d.ctName, date: new Date(d.ts).toISOString().slice(0, 10), brouillon: d }));
  const e: ContratTrouve[] = lireEnregistres(history)
    .filter((c) => (id ? c.id === id : match([c.creator, c.config?.talentNom])))
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
    .map((c) => ({ kind: "enregistre", id: c.id, qui: c.creator ?? c.config?.talentNom ?? "Externe", date: String(c.createdAt).slice(0, 10), contrat: c }));
  return [...b, ...e];
}

/** Réglages complets : ceux par défaut de la variante, puis ceux du contrat. */
export function configComplete(config: Record<string, string>): Record<string, string> {
  return { ...rcDefaultConfig(config.variante === "nonexclusif" ? "nonexclusif" : "exclusif"), ...config };
}

const STATUT: Record<string, string> = { signed: "signé", pending: "en attente de signature", changes: "modifications demandées" };

/** Une ligne de la liste. */
export function ligneContrat(c: ContratTrouve): string {
  if (c.kind === "brouillon") {
    const d = c.brouillon;
    const quoi = d.ctType === "repr" ? `représentation ${d.config?.variante === "nonexclusif" ? "non exclusif" : "exclusif"}` : `${d.ctType === "ugc" ? "UGC" : "marque"} ${d.brand}`;
    return `- Brouillon · ${c.qui} · ${quoi} · ${c.date} · id ${c.id}`;
  }
  return `- Enregistré · ${c.qui} · représentation ${c.contrat.variante === "nonexclusif" ? "non exclusif" : "exclusif"} · ${c.date} · ${STATUT[c.contrat.status ?? "pending"] ?? "en attente de signature"} · id ${c.id}`;
}

/** Texte complet d'un contrat (représentation), ou le résumé d'un brouillon Marque / UGC. */
export function texteContrat(c: ContratTrouve): string {
  // Contrat marqué signé : le texte tel qu'imprimé, sans la mention « CONTRAT TEST ».
  if (c.kind === "enregistre") return representationText(configComplete(c.contrat.config), { signe: c.contrat.status === "signed" });
  const d = c.brouillon;
  if (d.ctType === "repr") return representationText(configComplete(d.config ?? {}));
  const f = d.form;
  if (!f) return "Brouillon sans formulaire.";
  return [
    `Brouillon ${d.ctType === "ugc" ? "UGC" : "Marque × Créateur"} : ${d.brand} × ${d.ctName}`,
    `Montant ${f.value || "à compléter"} · livrables ${f.deliverables || "à compléter"} · droits ${f.rights} ${f.rightsDuration} · paiement ${f.payment} · TVA ${f.tva} · commission ${f.commission} %`,
    ...(f.extra.length ? ["", "Clauses en plus :", ...f.extra.map((x) => `- ${x.l} : ${x.v}`)] : []),
    ...(d.note ? ["", `Note : ${d.note}`] : []),
  ].join("\n");
}

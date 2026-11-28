// ============================================================================
// _shared/collabAutoDb.ts : écritures des étapes automatiques (règles : collabAuto.ts).
// ----------------------------------------------------------------------------
// Utilisé par l'app (src/lib/collabAutoDb.ts, client de l'utilisateur, RLS agence) et par le
// connecteur Claude (ttp-mcp, client serveur). Chaque fonction est idempotente (relancée, elle
// ne fait rien de plus) et ne lève jamais : un échec réseau renvoie null ou [], et l'action
// principale (facture payée, versement noté, collab créée) reste faite.
//   • la collab avance par une mise à jour conditionnelle (`step < cible`, ni perdue ni
//     archivée) : deux postes en même temps ne la font avancer qu'une fois ;
//   • l'historique (`collab_steps`) est daté par le trigger `collabs_log_step` ; s'il manque,
//     la ligne est écrite ici, à la date du paiement quand on la connaît.
// ============================================================================

import { foldName } from "./exclusivites.ts";
import {
  ETAPE_CREATEUR_PAYE, ETAPE_PAIEMENT_MARQUE, collabDeFacture, collabsSoldees, etapeAAtteindre, prospectASigner,
  type CollabAuto, type LigneDue, type ProspectAuto,
} from "./collabAuto.ts";

// deno-lint-ignore no-explicit-any
type Sb = { from: (table: string) => any };
type DbError = { code?: string; message?: string } | null;

const colonneAbsente = (e: DbError, cols: RegExp) => !!e && (e.code === "42703" || e.code === "PGRST204" || cols.test(e.message ?? ""));

/** Une collab qui vient d'avancer toute seule. */
export type Avance = { collabId: string; brand: string; creator: string | null; step: number };

/** Date valable et pas dans le futur (ISO), sinon maintenant. */
function dateOuMaintenant(v: unknown): string {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) && t <= Date.now() ? new Date(t).toISOString() : new Date().toISOString();
}

/**
 * La collab atteint l'étape `cible` (jamais en arrière, jamais perdue ni archivée).
 * null : rien à faire (déjà plus loin, un collègue l'a fait) ou échec.
 */
export async function atteindreEtape(sb: Sb, collabId: string, cible: number, quand?: unknown): Promise<Avance | null> {
  try {
    if (!collabId) return null;
    const { data: c, error } = await sb.from("collabs").select("id, brand, creator, step, status").eq("id", collabId).maybeSingle();
    if (error || !c || etapeAAtteindre(c as CollabAuto, cible) == null) return null;
    const { data: up, error: e2 } = await sb.from("collabs").update({ step: cible })
      .eq("id", collabId).lt("step", cible).not("status", "in", "(perdue,archivee)").select("id");
    if (e2 || !(up as unknown[] | null)?.length) return null;
    const { data: h, error: e3 } = await sb.from("collab_steps").select("id").eq("collab_id", collabId).eq("step", cible).limit(1);
    if (!e3 && !(h as unknown[] | null)?.length) {
      await sb.from("collab_steps").insert({ collab_id: collabId, step: cible, reached_at: dateOuMaintenant(quand) }).then(() => {}, () => {});
    }
    const row = c as CollabAuto;
    return { collabId, brand: String(row.brand ?? ""), creator: row.creator ?? null, step: cible };
  } catch {
    return null;
  }
}

async function collabsLegeres(sb: Sb): Promise<Pick<CollabAuto, "id" | "brand" | "creator">[] | null> {
  const { data, error } = await sb.from("collabs").select("id, brand, creator").limit(5000);
  return error ? null : ((data as Pick<CollabAuto, "id" | "brand" | "creator">[] | null) ?? []);
}

/**
 * Facture passée « payée » : sa collab (lien, `indice` donné par l'écran, sinon le
 * rapprochement marque + créateur s'il est sans doute) atteint l'étape 9.
 * Facture sans lien : le lien vers cette collab est écrit AVANT d'avancer l'étape, pour que la
 * base (collabs_step_task) voie une facture payée de la collab et pose « Reverser ».
 */
export async function apresFacturePayee(sb: Sb, factureId: string, indice?: string | null): Promise<Avance | null> {
  try {
    let lien = true;
    let r = await sb.from("invoices").select("id, status, party, creator, collab_id, paid_at").eq("id", factureId).maybeSingle();
    if (r.error && colonneAbsente(r.error, /collab_id|paid_at/)) {
      lien = false;
      r = await sb.from("invoices").select("id, status, party, creator").eq("id", factureId).maybeSingle();
    }
    const f = r.data as { status?: string; party?: string; creator?: string; collab_id?: string; paid_at?: string } | null;
    if (r.error || !f || f.status !== "payee") return null;
    const dejaLiee = String(f.collab_id ?? "").trim() || null;
    let collabId = String(indice ?? "").trim() || dejaLiee;
    if (!collabId) {
      const collabs = await collabsLegeres(sb);
      collabId = collabs ? collabDeFacture(f, collabs) : null;
    }
    if (!collabId) return null;
    if (lien && !dejaLiee) {
      // Seulement une facture encore sans lien ; un échec (colonne absente, réseau) n'arrête rien.
      await sb.from("invoices").update({ collab_id: collabId }).eq("id", factureId).is("collab_id", null).select("id").then(() => {}, () => {});
    }
    return await atteindreEtape(sb, collabId, ETAPE_PAIEMENT_MARQUE, f.paid_at);
  } catch {
    return null;
  }
}

/** Ligne due au créateur, avec le libellé de la facture (« Nike × Léna ») pour le rapprochement. */
export type LigneVersement = LigneDue & { party?: string | null };

/**
 * Versement noté pour un créateur : les collabs que ce versement solde (ou la collab
 * désignée, si elle est bien à ce créateur) atteignent l'étape 10. `dejaVerse` = total
 * versé AVANT ce versement. Doute : rien.
 */
export async function apresVersement(sb: Sb, v: { createur: string; lignes: readonly LigneVersement[]; dejaVerse: number; montant: number; collab?: string | null }): Promise<Avance[]> {
  try {
    const designee = String(v.collab ?? "").trim();
    if (designee) {
      const { data: c } = await sb.from("collabs").select("creator").eq("id", designee).maybeSingle();
      if (!c || foldName((c as { creator?: string }).creator) !== foldName(v.createur)) return [];
      const a = await atteindreEtape(sb, designee, ETAPE_CREATEUR_PAYE);
      return a ? [a] : [];
    }
    let lignes: LigneDue[] = v.lignes.map((l) => ({ id: l.id, collabId: l.collabId, paidOn: l.paidOn, du: l.du }));
    if (v.lignes.some((l) => !l.collabId)) {
      const collabs = await collabsLegeres(sb);
      if (collabs) lignes = v.lignes.map((l) => ({ id: l.id, paidOn: l.paidOn, du: l.du, collabId: collabDeFacture({ collab_id: l.collabId, party: l.party, creator: v.createur }, collabs) }));
    }
    const out: Avance[] = [];
    for (const id of collabsSoldees(lignes, v.dejaVerse, v.montant)) {
      const a = await atteindreEtape(sb, id, ETAPE_CREATEUR_PAYE);
      if (a) out.push(a);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Collab créée ou gagnée : le prospect ouvert de la marque passe « Signé » et garde le lien
 * vers la collab (colonne `collab_id`, si elle existe). Jamais un prospect perdu.
 */
export async function apresCollabSignee(sb: Sb, collabId: string): Promise<{ id: string; brand: string } | null> {
  try {
    // La collab relue en base : sa date de création (le prospect doit être plus ancien).
    const { data: c, error: ec } = await sb.from("collabs").select("id, brand, creator, cachet, created_at").eq("id", collabId).maybeSingle();
    if (ec || !c) return null;
    const collab = c as CollabAuto;
    let full = true;
    let r = await sb.from("prospects").select("id, brand, stage, created_at, creator, collab_id").limit(2000);
    if (r.error && colonneAbsente(r.error, /creator|collab_id/)) {
      full = false;
      r = await sb.from("prospects").select("id, brand, stage, created_at").limit(2000);
    }
    if (r.error) return null;
    const p = prospectASigner((r.data as ProspectAuto[] | null) ?? [], collab);
    if (!p) return null;
    const ecrire = (patch: Record<string, unknown>) => sb.from("prospects").update(patch).eq("id", p.id).select("id");
    let w = await ecrire(full ? { stage: "Signé", collab_id: collab.id } : { stage: "Signé" });
    if (w.error && full && colonneAbsente(w.error, /collab_id/)) w = await ecrire({ stage: "Signé" });
    return !w.error && (w.data as unknown[] | null)?.length ? { id: p.id, brand: String(p.brand ?? collab.brand ?? "") } : null;
  } catch {
    return null;
  }
}

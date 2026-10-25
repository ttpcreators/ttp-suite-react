import { supabase } from "./supabase";
import { getAppState, invalidateAppState, mergeAppStateKey } from "./appState";
import type { InvoiceForPast, InvoiceItemForPast } from "./pricingTTP";

/*
 * Méthode TARIF (logique pure : pricingTTP.ts). Barème dans le blob agence
 * `pricingRates.ttp`, plancher par créateur dans `pricingRates.ttpFloors` (clé = id de la
 * fiche) : écritures partielles, les autres entrées de `pricingRates` ne bougent pas.
 * Les tarifs déjà facturés ne sont lus que par les fondateurs, comme la page Facturation.
 */

export type InvoiceHistory = { invoices: (InvoiceForPast & { status: string | null })[]; items: Record<string, InvoiceItemForPast[]> };

async function isFounder(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return false;
  const { data: p, error } = await supabase.from("profiles").select("agency_role").eq("user_id", uid).maybeSingle<{ agency_role: string | null }>();
  return !error && p?.agency_role === "founder";
}

/** Factures (de la plus récente à la plus ancienne) et leurs lignes ; null pour un membre ou si illisible. */
export async function loadInvoiceHistory(): Promise<InvoiceHistory | null> {
  if (!(await isFounder())) return null;
  const { data, error } = await supabase.from("invoices").select("id,ref,party,amount,date,status,creator").order("created_at", { ascending: false }).limit(1000);
  if (error) return null;
  let details: Record<string, { items?: InvoiceItemForPast[] } | undefined> = {};
  try {
    details = ((await getAppState()).invoiceDetails ?? {}) as typeof details;
  } catch {
    return null;
  }
  const invoices = (data as InvoiceHistory["invoices"]) ?? [];
  const items: Record<string, InvoiceItemForPast[]> = {};
  for (const inv of invoices) {
    const its = details[inv.id]?.items;
    items[inv.id] = Array.isArray(its) ? its : [];
  }
  return { invoices, items };
}

/** Barème de la méthode : seules les valeurs qui diffèrent de celles de départ (vide = départ). */
export function saveTarifGrid(diff: Record<string, unknown>): Promise<boolean> {
  return Object.keys(diff).length ? mergeAppStateKey("pricingRates", { ttp: diff }) : mergeAppStateKey("pricingRates", {}, ["ttp"]);
}

/** Plancher d'un créateur (0 = revenir au plancher du barème), fusionné dans les planchers relus. */
export async function saveCreatorFloor(creatorId: string, value: number): Promise<boolean> {
  try {
    invalidateAppState();
    const raw = ((await getAppState()).pricingRates ?? {}) as Record<string, unknown>;
    const cur = raw.ttpFloors && typeof raw.ttpFloors === "object" && !Array.isArray(raw.ttpFloors) ? { ...(raw.ttpFloors as Record<string, number>) } : {};
    if (value > 0) cur[creatorId] = value;
    else delete cur[creatorId];
    return await mergeAppStateKey("pricingRates", { ttpFloors: cur });
  } catch {
    return false;
  }
}

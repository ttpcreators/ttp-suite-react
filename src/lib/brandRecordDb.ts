import { supabase } from "./supabase";
import { getAppState } from "./appState";
import { invoiceHT, type InvoiceDetailLike } from "./invoice";
import { parseAmount } from "./money";
import { collabIdMissing } from "./collabLinks";
import type { ActivityRow, BrandCollab, BrandGift, BrandInvoice } from "./brandRecord";

/*
 * Lectures de la fiche marque (logique pure : brandRecord.ts). Tout est lu une fois par
 * visite de la page Contacts ; l'historique `email_activity` est lu par contact.
 * L'argent (factures) n'est montré qu'aux fondateurs, comme la page Facturation : pour un
 * membre, `invoices` vaut null et la fiche n'affiche pas de chiffre d'affaires.
 */

export type BrandData = { collabs: BrandCollab[]; invoices: BrandInvoice[] | null; gifting: BrandGift[] };

async function isFounder(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return false;
  const { data: p, error } = await supabase.from("profiles").select("agency_role").eq("user_id", uid).maybeSingle<{ agency_role: string | null }>();
  return !error && p?.agency_role === "founder";
}

/** Montant HT de chaque facture (lignes du blob agence) : le CA s'affiche hors taxes. */
async function withHT(list: BrandInvoice[]): Promise<BrandInvoice[]> {
  const app = await getAppState().catch(() => null);
  const details = (app?.invoiceDetails as Record<string, InvoiceDetailLike> | undefined) ?? {};
  return list.map((iv) => ({ ...iv, ht: invoiceHT(parseAmount(iv.amount), details[iv.id]) }));
}

async function loadInvoices(): Promise<BrandInvoice[] | null> {
  const list = await loadInvoicesRaw();
  return list ? withHT(list) : null;
}

async function loadInvoicesRaw(): Promise<BrandInvoice[] | null> {
  if (!(await isFounder())) return null;
  const withLink = await supabase.from("invoices").select("id,party,amount,status,date,collab_id");
  if (!withLink.error) return (withLink.data as BrandInvoice[]) ?? [];
  if (!collabIdMissing(withLink.error)) return null;
  const plain = await supabase.from("invoices").select("id,party,amount,status,date");
  return plain.error ? null : ((plain.data as BrandInvoice[]) ?? []);
}

export async function loadBrandData(): Promise<BrandData> {
  const [col, gif, invoices] = await Promise.all([
    supabase.from("collabs").select("id,brand,creator,step,status,cachet,created_at"),
    supabase.from("gifting").select("id,brand,creator,product,value,received_on"),
    loadInvoices(),
  ]);
  return {
    collabs: col.error ? [] : ((col.data as BrandCollab[]) ?? []),
    invoices,
    gifting: gif.error ? [] : ((gif.data as BrandGift[]) ?? []),
  };
}

/** Lignes `email_activity` d'un contact (journal des envois et réceptions), 50 au plus. */
export async function loadEmailActivity(email: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("email_activity")
    .select("id,gmail_message_id,subject,snippet,direction,created_at")
    .ilike("contact_email", email.trim().replace(/[\\%_]/g, (m) => `\\${m}`))
    .order("created_at", { ascending: false })
    .limit(50);
  return error ? [] : ((data as ActivityRow[]) ?? []);
}

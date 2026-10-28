/*
 * FullEnrich côté app (fonction serveur « fullenrich » ; la clé reste sur le serveur).
 * Trouver les bons contacts d'une marque, leur email pro (et leur téléphone sur demande).
 */
import { supabase } from "./supabase";

export type FePerson = { id: string; name: string; first: string; last: string; title: string; company: string; domain: string; linkedin: string; location: string };
export type FeFound = { email: string; emailStatus: string; phone: string };

const WHY: Record<string, string> = {
  cle_absente: "FullEnrich n'est pas encore branché (clé à enregistrer sur le serveur).",
  cle_invalide: "La clé FullEnrich est refusée : à vérifier.",
  credits_insuffisants: "Plus assez de crédits FullEnrich.",
  limite: "FullEnrich freine les demandes : réessaie dans une minute.",
  reseau: "FullEnrich ne répond pas : réessaie.",
  infos_manquantes: "Il faut le prénom, le nom et la marque (ou le profil LinkedIn).",
  marque_manquante: "Indique la marque ou son site.",
};
export const feWhy = (code: string) => WHY[code] ?? "FullEnrich indisponible pour le moment.";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("fullenrich", { body });
  let r = data as (T & { error?: string }) | null;
  if (error && !r) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    r = ctx?.json ? ((await ctx.json().catch(() => null)) as typeof r) : null;
  }
  if (!r) throw new Error(feWhy(error ? "fonction" : ""));
  if (r.error) throw new Error(feWhy(r.error));
  return r;
}

export const feCredits = () => call<{ balance: number }>({ action: "credits" }).then((r) => r.balance);
export const feSearch = (company: string, opts: { titles?: string[]; country?: string; limit?: number; offset?: number } = {}) =>
  call<{ people: FePerson[]; total: number; credits: number }>({ action: "search", company, ...opts });

/** Email pro (et téléphone si `phone`) : attend le résultat jusqu'à ~2 min. */
export async function feEnrich(p: { first?: string; last?: string; company?: string; domain?: string; linkedin?: string; phone?: boolean }): Promise<FeFound> {
  let r = await call<FeFound & { pending?: string }>({ action: "enrich", ...p });
  for (let i = 0; r.pending && i < 6; i++) r = await call<FeFound & { pending?: string }>({ action: "result", id: r.pending });
  if (r.pending) throw new Error("FullEnrich met du temps : réessaie dans quelques minutes.");
  return { email: r.email ?? "", emailStatus: r.emailStatus ?? "", phone: r.phone ?? "" };
}

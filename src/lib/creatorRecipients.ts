/*
 * « @lena » dans les champs À / Cc / Cci d'un mail : propose les adresses des créateurs
 * (leur alias @ttpcreators.pro d'abord, puis leurs autres adresses et l'adresse pro de
 * la fiche Roster). Règles PURES testées par creatorRecipients.test.ts ; la lecture
 * (une fois par visite) est en bas du fichier.
 */
import { supabase } from "./supabase";
import { allAddresses, normAddress } from "./mailAddresses";
import { SHARED_BOXES } from "./mailAvatar";

export type CreatorRecipient = { name: string; photo: string | null; emails: string[] };
export type RecipientOption = { name: string; photo: string | null; email: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Mot en cours de saisie (après la dernière virgule ou point-virgule, avant le curseur).
 * `query` : ce qu'il faut chercher, ou null s'il n'y a rien à proposer :
 *   « @lena » → « lena » (« @ » seul → tous) ; « lena » (2 lettres et plus, sans @) → « lena » ;
 *   une adresse en cours (« lena@ttp… ») → null.
 */
export function recipientToken(value: string, caret = value.length): { start: number; query: string | null } {
  const before = value.slice(0, caret);
  const cut = Math.max(before.lastIndexOf(","), before.lastIndexOf(";")) + 1;
  let start = cut;
  while (start < before.length && /\s/.test(before[start])) start++;
  const word = before.slice(start);
  if (word.startsWith("@")) return { start, query: word.slice(1).includes("@") ? null : word.slice(1) };
  if (word.includes("@") || fold(word).replace(/[^a-z]/g, "").length < 2) return { start, query: null };
  return { start, query: word };
}

/** Adresses qui correspondent (prénom, nom ou début de l'adresse), 8 au plus, sans celles déjà saisies. */
export function matchRecipients(list: readonly CreatorRecipient[], query: string, already = ""): RecipientOption[] {
  const q = fold(query);
  const taken = new Set(already.toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g) ?? []);
  const out: RecipientOption[] = [];
  for (const c of list) {
    const words = fold(c.name).split(/[\s-]+/);
    const byName = !q || words.some((w) => w.startsWith(q)) || fold(c.name).startsWith(q);
    for (const email of c.emails) {
      if (taken.has(email)) continue;
      if (byName || email.startsWith(q)) out.push({ name: c.name, photo: c.photo, email });
    }
  }
  return out.slice(0, 8);
}

/** Remplace le mot en cours par l'adresse choisie, suivie de « , » pour enchaîner. */
export function insertRecipient(value: string, caret: number, email: string): { value: string; caret: number } {
  const { start } = recipientToken(value, caret);
  const rest = value.slice(caret).replace(/^[^,;]*[,;]?\s*/, "");
  const head = value.slice(0, start) + email + ", ";
  return { value: head + rest, caret: head.length };
}

/** Adresses d'un créateur : alias de l'agence d'abord, puis les autres ; jamais une boîte commune. */
export function recipientEmails(alias: string | null, aliases: readonly string[] | null | undefined, emailPro: string | null): string[] {
  const list = allAddresses(alias, [...(aliases ?? []), emailPro ?? ""]).filter((e) => !SHARED_BOXES.test(e));
  return [...list.filter((e) => e.endsWith("@ttpcreators.pro")), ...list.filter((e) => !e.endsWith("@ttpcreators.pro"))];
}

let load: Promise<CreatorRecipient[]> | null = null;
/** Créateurs du Roster (sauf inactifs) avec au moins une adresse. Lu une fois par visite. */
export function getCreatorRecipients(): Promise<CreatorRecipient[]> {
  load ??= (async () => {
    const [{ data: cs }, { data: st }] = await Promise.all([
      supabase.from("creators").select("name,email_pro,photo_url,status").order("sort_order"),
      // « * » : avec `aliases` quand la colonne existe, sans sinon.
      supabase.from("creator_mail_settings").select("*"),
    ]);
    const settings = new Map(((st ?? []) as { creator: string; alias: string | null; aliases?: string[] | null }[]).map((s) => [fold(s.creator), s]));
    const out: CreatorRecipient[] = [];
    for (const c of (cs ?? []) as { name: string; email_pro: string | null; photo_url: string | null; status: string | null }[]) {
      if (c.status === "inactif") continue;
      const s = settings.get(fold(c.name));
      const emails = recipientEmails(s?.alias ?? null, s?.aliases ?? null, normAddress(c.email_pro) || null);
      if (emails.length) out.push({ name: c.name, photo: c.photo_url, emails });
    }
    if (!out.length) load = null; // session pas prête : on relira
    return out;
  })().catch(() => {
    load = null;
    return [];
  });
  return load;
}

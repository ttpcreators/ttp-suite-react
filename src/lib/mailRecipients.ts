/*
 * « @lena » dans les champs À / Cc / Cci d'un mail : propose des adresses connues de l'app.
 *   • les créateurs du Roster (leur alias @ttpcreators.pro d'abord, puis leurs autres
 *     adresses et l'adresse pro de la fiche) ;
 *   • les contacts (page Contacts) : personne et marque.
 * Règles PURES testées par mailRecipients.test.ts ; la lecture (une fois par visite) est
 * en bas du fichier.
 */
import { supabase } from "./supabase";
import { allAddresses, normAddress } from "./mailAddresses";
import { SHARED_BOXES } from "./mailAvatar";

/** `hint` : ce qui s'affiche après le nom (« Créateur », la marque d'un contact). */
export type Recipient = { name: string; hint: string; photo: string | null; emails: string[] };
export type RecipientOption = { name: string; hint: string; photo: string | null; email: string };

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

/**
 * Adresses qui correspondent (prénom, nom, marque ou début de l'adresse), 8 au plus, dans
 * l'ordre de la liste (créateurs d'abord), sans celles déjà saisies ni doublon.
 */
export function matchRecipients(list: readonly Recipient[], query: string, already = ""): RecipientOption[] {
  const q = fold(query);
  const taken = new Set(already.toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g) ?? []);
  const out: RecipientOption[] = [];
  for (const r of list) {
    const words = fold(`${r.name} ${r.hint}`).split(/[\s\-'.&]+/);
    const byName = !q || words.some((w) => w.startsWith(q)) || fold(r.name).startsWith(q) || fold(r.hint).startsWith(q);
    for (const email of r.emails) {
      if (taken.has(email)) continue;
      if (byName || email.startsWith(q)) {
        out.push({ name: r.name, hint: r.hint, photo: r.photo, email });
        taken.add(email);
      }
      if (out.length >= 8) return out;
    }
  }
  return out;
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

/** Contact de la page Contacts → destinataire (nom = la personne, sinon la marque). */
export function contactRecipient(c: { brand: string | null; person: string | null; email: string | null }): Recipient | null {
  const email = normAddress(c.email);
  if (!email || SHARED_BOXES.test(email)) return null;
  const clean = (s: string | null) => (s && s.trim() !== "—" ? s.trim() : "");
  const person = clean(c.person);
  const brand = clean(c.brand);
  return { name: person || brand || email, hint: person ? brand : "", photo: null, emails: [email] };
}

/** « Nom <adresse> » d'un en-tête → { nom, adresse }, sur les virgules hors guillemets et chevrons. */
export function addressParts(value: string): { name: string; email: string }[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const c of value) {
    if (c === '"') quoted = !quoted;
    else if (c === "<" && !quoted) angle = true;
    else if (c === ">" && !quoted) angle = false;
    if (c === "," && !quoted && !angle) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((p) => {
    const m = /^"?(.*?)"?\s*<([^>]+)>$/.exec(p);
    return m ? { name: m[1].trim(), email: m[2].trim() } : { name: "", email: p.replace(/^<|>$/g, "") };
  });
}

let load: Promise<Recipient[]> | null = null;
/** Créateurs du Roster (sauf inactifs) puis contacts, avec au moins une adresse. Lu une fois par visite. */
export function getRecipients(): Promise<Recipient[]> {
  load ??= (async () => {
    const [{ data: cs }, { data: st }, { data: ct }] = await Promise.all([
      supabase.from("creators").select("name,email_pro,photo_url,status").order("sort_order"),
      // « * » : avec `aliases` quand la colonne existe, sans sinon.
      supabase.from("creator_mail_settings").select("*"),
      supabase.from("contacts").select("brand,person,email").neq("email", "").limit(5000),
    ]);
    const settings = new Map(((st ?? []) as { creator: string; alias: string | null; aliases?: string[] | null }[]).map((s) => [fold(s.creator), s]));
    const out: Recipient[] = [];
    for (const c of (cs ?? []) as { name: string; email_pro: string | null; photo_url: string | null; status: string | null }[]) {
      if (c.status === "inactif") continue;
      const s = settings.get(fold(c.name));
      const emails = recipientEmails(s?.alias ?? null, s?.aliases ?? null, normAddress(c.email_pro) || null);
      if (emails.length) out.push({ name: c.name, hint: "Créateur", photo: c.photo_url, emails });
    }
    for (const c of (ct ?? []) as { brand: string | null; person: string | null; email: string | null }[]) {
      const r = contactRecipient(c);
      if (r) out.push(r);
    }
    if (!out.length) load = null; // session pas prête : on relira
    return out;
  })().catch(() => {
    load = null;
    return [];
  });
  return load;
}

/** Après l'ajout d'un contact ou d'un créateur : relire la liste à la prochaine saisie. */
export function invalidateRecipients() {
  load = null;
}

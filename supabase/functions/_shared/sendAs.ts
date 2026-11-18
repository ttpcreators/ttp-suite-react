/**
 * Adresses « Envoyer en tant que » d'une boîte Gmail (users.settings.sendAs), pour que
 * Claude envoie depuis l'alias d'une créatrice (ex. anamilanovic@ttpcreators.pro) comme on
 * le fait à la main dans Gmail. Règles PURES, testées par sendAs.test.ts.
 *
 * Seules les adresses DÉJÀ réglées dans Gmail sont acceptées : l'adresse principale de la
 * boîte et les alias validés (une adresse « en attente de validation » est refusée).
 */
export type RawSendAs = {
  sendAsEmail?: string;
  displayName?: string;
  signature?: string;
  isPrimary?: boolean;
  verificationStatus?: string;
};

export type SendAs = { email: string; name: string; signature: string; primary: boolean };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Adresses utilisables pour l'envoi, l'adresse principale en premier. */
export function usableSendAs(raw: readonly RawSendAs[] | null | undefined): SendAs[] {
  const out: SendAs[] = [];
  for (const r of raw ?? []) {
    const email = norm(r.sendAsEmail);
    if (!/^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/.test(email)) continue;
    // Alias d'une autre adresse : Gmail exige une validation ; « pending » ne peut pas envoyer.
    if (!r.isPrimary && r.verificationStatus && r.verificationStatus !== "accepted") continue;
    if (out.some((x) => x.email === email)) continue;
    out.push({ email, name: String(r.displayName ?? "").trim(), signature: String(r.signature ?? ""), primary: !!r.isPrimary });
  }
  return out.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** L'adresse demandée parmi celles de la boîte, ou null. */
export function findSendAs(list: readonly SendAs[], address: string): SendAs | null {
  const want = norm(address).replace(/^.*<([^>]+)>.*$/, "$1");
  return list.find((x) => x.email === want) ?? null;
}

/** Adresse e-mail d'un en-tête « Nom <a@b.fr> » (minuscules), "" sinon. */
export function addressOf(v: string): string {
  return norm(v.match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/)?.[0] ?? "");
}

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** En-tête « From » avec le nom affiché de l'alias (accents encodés, guillemets si besoin). */
export function fromHeader(s: SendAs): string {
  const name = s.name.replace(/[\r\n"\\]+/g, " ").trim();
  if (!name) return `From: <${s.email}>`;
  const shown = /^[\x20-\x7e]*$/.test(name) ? `"${name}"` : `=?UTF-8?B?${b64Utf8(name)}?=`;
  return `From: ${shown} <${s.email}>`;
}

/** Message clair quand l'adresse n'est pas un alias de la boîte. */
export function refusSendAs(address: string, box: string, list: readonly SendAs[], other?: { box: string; found: boolean }): string {
  if (other?.found) return `${address} est un alias de la boîte ${other.box}@, pas de ${box}@ : relance avec boite « ${other.box} ».`;
  const aliases = list.filter((x) => !x.primary).map((x) => x.email);
  return `${address} n'est pas dans les adresses « Envoyer en tant que » de ${box}@ dans Gmail, rien n'est parti. ` +
    (aliases.length ? `Alias disponibles : ${aliases.join(", ")}.` : "Aucun alias n'est réglé dans cette boîte.") +
    " Pour en ajouter un : Gmail → Paramètres → Comptes → Envoyer des e-mails en tant que.";
}

// ── Page Mails de l'app : menu « De : » du composeur (gmail-send) ───────────

/** Conseil affiché quand la boîte n'a aucun alias réglé dans Gmail. */
export const SEND_AS_HINT = "Pour écrire au nom d'une créatrice : Gmail › Paramètres › Comptes › Envoyer des e-mails en tant que";

/**
 * Expéditeur demandé à l'envoi, vérifié contre la liste de Gmail (jamais celle du client).
 * Vide ou adresse principale → `from: null` (le mail part de la boîte, comme avant).
 * Alias validé → `from` (en-tête From + nom affiché). Sinon → `refus` (rien ne part).
 */
export function pickSender(list: readonly SendAs[], requested: unknown, box: string): { from: SendAs | null } | { refus: string } {
  const want = String(requested ?? "").trim();
  if (!want) return { from: null };
  const hit = findSendAs(list, want);
  if (hit) return { from: hit.primary ? null : hit };
  return { refus: refusSendAs(addressOf(want) || want.toLowerCase().slice(0, 200), box, list) };
}

/** Réponse JSON de gmail-send (action « sendas ») relue côté app : mêmes règles que Gmail. */
export function sendAsFromJson(v: unknown): SendAs[] {
  if (!Array.isArray(v)) return [];
  return usableSendAs(
    v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map((x) => ({
      sendAsEmail: typeof x.email === "string" ? x.email : "",
      displayName: typeof x.name === "string" ? x.name : "",
      signature: typeof x.signature === "string" ? x.signature : "",
      isPrimary: x.primary === true,
    })),
  );
}

/** Signature à ajouter : celle de l'alias choisi (comme Gmail), sinon celle de l'agence. */
export function senderSignature(from: SendAs | null | undefined, agencySignature: string): string {
  return from && !from.primary ? from.signature : agencySignature;
}

// ============================================================================
// _shared/peoplePhotos.ts : photos de profil Google des correspondants (logique pure,
// testée). Source : API People de Google, « Autres contacts » (les personnes avec qui
// la boîte a échangé, que Gmail retient toute seule) et contacts enregistrés.
// ============================================================================

export type PeoplePerson = {
  emailAddresses?: { value?: string }[];
  photos?: { url?: string; default?: boolean }[];
};

/** Adresse → photo (jamais l'avatar par défaut à initiale que Google génère). */
export function photoMapFrom(people: readonly PeoplePerson[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of people) {
    const photo = (p.photos ?? []).find((x) => x.url && !x.default)?.url;
    if (!photo) continue;
    // Taille raisonnable pour une pastille (le suffixe « =s100 » de Google se remplace).
    const url = /=s\d+(-[a-z]+)?$/.test(photo) ? photo.replace(/=s\d+(-[a-z]+)?$/, "=s96") : photo;
    for (const e of p.emailAddresses ?? []) {
      const v = String(e.value ?? "").trim().toLowerCase();
      if (v && v.includes("@") && !out.has(v)) out.set(v, url);
    }
  }
  return out;
}

/** Adresses demandées par l'app : valides, minuscules, sans doublon, 200 au plus. */
export function requestedEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const v = String(x ?? "").trim().toLowerCase();
    if (/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= 200) break;
  }
  return out;
}

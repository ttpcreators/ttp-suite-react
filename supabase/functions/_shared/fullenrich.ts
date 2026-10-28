// ============================================================================
// _shared/fullenrich.ts : FullEnrich (trouver les bons contacts d'une marque, leur
// email pro, leur téléphone). Règles PURES, testées par fullenrich.test.ts.
// API v2 : https://docs.fullenrich.com (recherche synchrone ; enrichissement en
// tâche de fond, résultat relu par son id).
// Coûts FullEnrich : 0,25 crédit par personne trouvée en recherche ; email pro 1 crédit,
// téléphone 10 crédits, seulement s'ils sont trouvés.
// ============================================================================

type J = Record<string, unknown>;
const o = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const f = (value: string, exact = false) => ({ value, exact_match: exact, exclude: false });

/** Postes cherchés par défaut chez une marque (influence, partenariats, marketing…). */
export const DEFAULT_TITLES = ["influence", "partnership", "partenariat", "marketing", "communication", "brand manager", "relations presse", "social media"];

/** Corps de la recherche de personnes chez une marque (site ou nom). */
export function searchBody(o2: { company: string; titles?: string[]; country?: string; limit?: number; offset?: number }): J {
  const c = o2.company.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const isDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(c);
  const titles = (o2.titles?.length ? o2.titles : DEFAULT_TITLES).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  return {
    limit: Math.max(1, Math.min(25, o2.limit ?? 10)),
    offset: Math.max(0, o2.offset ?? 0),
    ...(isDomain ? { current_company_domains: [f(c, true)] } : { current_company_names: [f(o2.company.trim())] }),
    ...(titles.length ? { current_position_titles: titles.map((t) => f(t)) } : {}),
    ...(o2.country ? { person_locations: [f(o2.country)] } : {}),
  };
}

export type Person = { id: string; name: string; first: string; last: string; title: string; company: string; domain: string; linkedin: string; location: string };

/** Personnes de la réponse de recherche, au format de l'app. */
export function parsePeople(res: J): { people: Person[]; total: number; credits: number } {
  const people = (Array.isArray(res.people) ? res.people : []).map((p0) => {
    const p = o(p0);
    const job = o(o(p.employment).current);
    const co = o(job.company);
    const loc = o(p.location);
    return {
      id: s(p.id), name: s(p.full_name) || `${s(p.first_name)} ${s(p.last_name)}`.trim(), first: s(p.first_name), last: s(p.last_name),
      title: s(job.title), company: s(co.name), domain: s(co.domain), linkedin: s(o(o(p.social_profiles).professional_network).url),
      location: [s(loc.city), s(loc.country)].filter(Boolean).join(", "),
    };
  }).filter((p) => p.name);
  const meta = o(res.metadata);
  return { people, total: Number(meta.total) || people.length, credits: Number(meta.credits) || 0 };
}

/** Une personne à enrichir : nom + entreprise, ou profil LinkedIn. null si incomplet. */
export function enrichContact(i: { first?: string; last?: string; company?: string; domain?: string; linkedin?: string; phone?: boolean }): J | null {
  const fields = ["contact.work_emails", ...(i.phone ? ["contact.phones"] : [])];
  const linkedin = s(i.linkedin);
  if (/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(linkedin)) return { linkedin_url: linkedin, enrich_fields: fields };
  const first = s(i.first), last = s(i.last), domain = s(i.domain), company = s(i.company);
  if (!first || !last || (!domain && !company)) return null;
  return { first_name: first, last_name: last, ...(domain ? { domain } : { company_name: company }), enrich_fields: fields };
}

export type Found = { email: string; emailStatus: string; phone: string };
/** Meilleur email pro (jamais une adresse « invalide ») et meilleur téléphone. */
export function bestContact(res: J): Found {
  const item = o(Array.isArray(res.data) ? res.data[0] : null);
  const info = o(item.contact_info);
  const w = o(info.most_probable_work_email);
  const ok = !/INVALID/.test(s(w.status));
  return { email: ok ? s(w.email).toLowerCase() : "", emailStatus: s(w.status), phone: s(o(info.most_probable_phone).number) };
}

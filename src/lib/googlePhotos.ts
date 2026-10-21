import { supabase } from "./supabase";

/**
 * Photo de profil Google d'un correspondant (fonction mail-photos : « Autres contacts »
 * des boîtes partnerships@ et talent@). Les adresses demandées au même moment partent
 * ensemble (une requête par paquet de 100) ; réponses gardées 3 jours sur l'appareil
 * (« rien » : 1 jour). Hors agence, fonction absente ou droit Google manquant → null,
 * sans erreur : l'avatar passe à la source suivante (Gravatar, logo, initiale).
 */
const STORE = "ttp:google-photos:v1";
const DAY = 86_400_000;
type Stored = Record<string, [string, number]>;
const memory = new Map<string, string | null>();
let pending = new Map<string, ((url: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let disabled = false; // fonction absente ou pas agence : on n'insiste pas pendant la visite

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Stored;
  } catch {
    return {};
  }
}
function save(results: Record<string, string | null>) {
  try {
    const s = read();
    const now = Date.now();
    for (const [k, v] of Object.entries(results)) s[k] = [v ?? "", now];
    const keys = Object.keys(s);
    if (keys.length > 1500) for (const k of keys.slice(0, keys.length - 1500)) delete s[k];
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}

async function flush() {
  timer = null;
  const batch = pending;
  pending = new Map();
  const emails = [...batch.keys()];
  for (let i = 0; i < emails.length; i += 100) {
    const part = emails.slice(i, i + 100);
    let photos: Record<string, string> = {};
    if (!disabled) {
      try {
        const { data, error } = await supabase.functions.invoke("mail-photos", { body: { emails: part } });
        if (error) disabled = true;
        else photos = ((data ?? {}) as { photos?: Record<string, string> }).photos ?? {};
      } catch {
        disabled = true;
      }
    }
    const results: Record<string, string | null> = {};
    for (const e of part) {
      const url = photos[e] ?? null;
      results[e] = url;
      memory.set(e, url);
      for (const fn of batch.get(e) ?? []) fn(url);
    }
    if (!disabled) save(results);
  }
}

export function googlePhoto(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e || disabled) return Promise.resolve(null);
  if (memory.has(e)) return Promise.resolve(memory.get(e) ?? null);
  const hit = read()[e];
  if (hit && Date.now() - hit[1] < (hit[0] ? 3 : 1) * DAY) {
    memory.set(e, hit[0] || null);
    return Promise.resolve(hit[0] || null);
  }
  return new Promise((resolve) => {
    const list = pending.get(e) ?? [];
    list.push(resolve);
    pending.set(e, list);
    if (!timer) timer = setTimeout(() => void flush(), 60);
  });
}

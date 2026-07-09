import { createClient } from "@supabase/supabase-js";

// Nouveau projet Supabase (migration egress). La clé anon est publique par
// design (sécurité via les policies RLS). Ne jamais mettre la clé service_role ici.
const SUPABASE_URL = "https://zizvggziggswhrbuyhuo.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppenZnZ3ppZ2dzd2hyYnV5aHVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5Mzk2NjcsImV4cCI6MjA5ODUxNTY2N30.5nB-lhwwasTyKKYAyO0m79gcu6xAg5b0oH2uobUcvQU";

// « Se souvenir » (écran de connexion) : coché → la session vit en localStorage
// (persistante entre les visites) ; décoché → sessionStorage (effacée à la
// fermeture). Le choix est posé par setRemember() juste avant la connexion.
// Défaut = se souvenir. Tout est défensif : en cas d'erreur de stockage, on ne
// casse jamais l'auth (au pire, pas de persistance).
const REMEMBER_KEY = "ttp:remember";

function authStore(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REMEMBER_KEY) === "0"
      ? window.sessionStorage
      : window.localStorage;
  } catch {
    return null;
  }
}

const authStorage = {
  getItem: (key: string): string | null => {
    try {
      return authStore()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      authStore()?.setItem(key, value);
    } catch {
      /* stockage indisponible → session non persistée, mais pas de crash */
    }
  },
  removeItem: (key: string): void => {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      /* rien */
    }
  },
};

/** Mémorise le choix « Se souvenir » AVANT la connexion (routera le stockage). */
export function setRemember(remember: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {
    /* rien */
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
});

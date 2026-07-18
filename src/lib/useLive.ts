import { useEffect, useRef, useState } from "react";

/**
 * Synchronisation temps quasi-réel, sans backend supplémentaire.
 *
 * Toutes les données de l'app vivent dans la même base Supabase : une saisie
 * faite sur mobile / ordinateur / espace créateur est donc *déjà* partagée. Le
 * seul souci est l'affichage : une page ouverte charge les données une fois et
 * devient périmée. Ce module déclenche un rafraîchissement global :
 *   - quand la fenêtre reprend le focus (on revient sur l'onglet / l'app) ;
 *   - quand l'onglet redevient visible (mobile : retour depuis l'arrière-plan) ;
 *   - à la reconnexion réseau ;
 *   - périodiquement (poll léger) tant que l'onglet est visible.
 *
 * Résultat : ce qu'un créateur ajoute apparaît côté agence (et inversement)
 * en quelques secondes, sur tous les appareils.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let started = false;
const POLL_MS = 20000;
// Anti-rebond : au retour d'onglet, `focus` ET `visibilitychange` se déclenchent
// coup sur coup → sans garde, chaque vue re-fetchait DEUX fois. On ignore tout tick
// qui suit le précédent de moins de MIN_GAP_MS (le poll de 20 s n'est pas affecté).
const MIN_GAP_MS = 5000;
let lastFire = 0;

function fireAll() {
  // On ne rafraîchit que si l'onglet est visible (économise la bande passante).
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastFire < MIN_GAP_MS) return;
  lastFire = now;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* une vue en erreur ne doit pas casser les autres */
    }
  });
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("focus", fireAll);
  window.addEventListener("online", fireAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fireAll();
  });
  setInterval(fireAll, POLL_MS);
}

/**
 * Enregistre `cb` pour qu'il s'exécute à chaque « tick » de rafraîchissement.
 * `cb` peut changer à chaque rendu sans se ré-abonner (on garde la dernière
 * version via une ref).
 */
export function useLive(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    ensureStarted();
    const l = () => ref.current();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

/**
 * Renvoie un compteur qui s'incrémente à chaque rafraîchissement global.
 * À ajouter dans le tableau de dépendances d'un `useEffect` de chargement pour
 * re-fetch automatiquement les données. Ex :
 *
 *   const live = useLiveKey();
 *   useEffect(() => { fetchData(); }, [live]);
 */
export function useLiveKey(): number {
  const [k, setK] = useState(0);
  useLive(() => setK((x) => x + 1));
  return k;
}

import { supabase } from "@/lib/supabase";

/*
 * Remontée des bugs (n'importe lequel) : journal `error_log` + notif push agence
 * (fonction report-error). Trois sources :
 *   - plantage d'un écran (ErrorBoundary) ;
 *   - erreur JavaScript non rattrapée (window « error ») ;
 *   - action asynchrone qui échoue sans être gérée (« unhandledrejection »).
 * Best-effort : ne lève JAMAIS, ne bloque jamais l'app.
 */

// Anti-répétition (session) : on n'envoie pas 10× la même erreur au serveur.
const reported = new Set<string>();

/** Bruit connu, pas des bugs de l'app (extensions, navigateur, réseau coupé). */
const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /AbortError|The operation was aborted|signal is aborted/i,
  /NetworkError when attempting|Load failed$|Failed to fetch$/i,
  /Non-Error promise rejection captured/i,
];

/** Erreur de chargement d'un ancien fichier après un déploiement (rechargement, pas un bug). */
const CHUNK = /dynamically imported module|Importing a module script failed|module script failed|ChunkLoadError|error loading dynamically|_result\.default|\._result\b/i;

/** Page affichée au moment du bug (titre de la page, sinon l'adresse). */
function currentPage(): string {
  try {
    const h1 = document.querySelector("main h1, h1")?.textContent?.trim();
    return (h1 || location.pathname || "").slice(0, 80);
  } catch {
    return "";
  }
}

export function reportError(err: unknown, opts: { componentStack?: string; page?: string; source?: string } = {}) {
  try {
    const e = err as { message?: string; stack?: string } | null;
    const raw = String(e?.message ?? err ?? "Erreur inconnue").trim();
    if (!raw || CHUNK.test(raw) || NOISE.some((r) => r.test(raw))) return;
    const message = (opts.source ? `[${opts.source}] ` : "") + raw.slice(0, 480);
    const page = (opts.page ?? currentPage()).slice(0, 80);
    const sig = `${page}|${message}`;
    if (reported.has(sig)) return;
    reported.add(sig);
    if (reported.size > 50) reported.clear(); // borne mémoire
    void supabase.functions
      .invoke("report-error", {
        body: {
          message,
          page,
          stack: String(e?.stack ?? "").slice(0, 4000),
          componentStack: String(opts.componentStack ?? "").slice(0, 4000),
          url: typeof location !== "undefined" ? location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        },
      })
      .catch(() => {});
  } catch {
    /* reporter une erreur ne doit jamais en provoquer une */
  }
}

/** À appeler une fois au démarrage : capte les erreurs non rattrapées. */
export function installGlobalErrorReporting() {
  window.addEventListener("error", (ev) => {
    // Erreur de chargement d'une ressource (image…) : pas un bug de code.
    if (!(ev instanceof ErrorEvent)) return;
    reportError(ev.error ?? ev.message, { source: "js" });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    reportError(ev.reason, { source: "action" });
  });
}

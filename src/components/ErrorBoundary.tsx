import { Component, type ErrorInfo, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

// Anti-répétition (session) : on n'envoie pas 10× la même erreur au serveur.
const _reported = new Set<string>();

/** Remonte le crash au serveur (journal + notif agence). Best-effort : ne lève JAMAIS. */
function reportError(error: Error, componentStack: string, page: string) {
  try {
    const message = String(error?.message ?? error ?? "Erreur inconnue").slice(0, 500);
    const sig = `${page}|${message}`;
    if (_reported.has(sig)) return;
    _reported.add(sig);
    if (_reported.size > 50) _reported.clear(); // borne mémoire
    void supabase.functions
      .invoke("report-error", {
        body: {
          message,
          page: page.slice(0, 80),
          stack: String(error?.stack ?? "").slice(0, 4000),
          componentStack: String(componentStack ?? "").slice(0, 4000),
          url: typeof location !== "undefined" ? location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        },
      })
      .catch(() => {}); // la remontée ne doit jamais casser le boundary
  } catch {
    /* rien : reporter une erreur ne doit jamais en provoquer une */
  }
}

// Erreur de chargement d'un chunk (module dynamique) : arrive quand l'app est
// restée ouverte pendant un déploiement et demande un ancien fichier au hash
// remplacé. Ce n'est PAS un bug de code → on recharge, on ne remonte pas.
export function isChunkError(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err ?? "");
  return /dynamically imported module|Importing a module script failed|module script failed|Failed to fetch|ChunkLoadError|error loading dynamically/i.test(m);
}

/** Recharge la page au plus une fois par ~20 s (évite toute boucle si vraiment cassé). */
export function reloadOnce(): boolean {
  try {
    const KEY = "ttp:chunk-reload";
    const last = Number(sessionStorage.getItem(KEY) || "0");
    if (Date.now() - last < 20000) return false; // déjà rechargé récemment → stop
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* pas de sessionStorage → on tente quand même un reload */
  }
  location.reload();
  return true;
}

// Clés d'UI (non critiques) qu'on peut effacer sans danger pour se ré-parer.
// IMPORTANT : ne JAMAIS toucher la session Supabase (clé `sb-*-auth-token`),
// sinon l'utilisateur serait déconnecté. On ne vise que nos clés `ttp:*` d'UI.
const RESET_KEYS = ["ttp:tabs", "ttp:split"];

function selfHeal() {
  try {
    for (const k of RESET_KEYS) localStorage.removeItem(k);
    localStorage.setItem("ttp:view", "apercu"); // revient sur une page sûre
  } catch {
    /* localStorage indisponible — on recharge quand même */
  }
  location.reload();
}

type Props = {
  children: ReactNode;
  /** "full" = écran plein (racine de l'app) ; "inline" = carte dans une zone. */
  variant?: "full" | "inline";
  /** Libellé de la zone qui a planté (mode inline), ex. "Cette page". */
  label?: string;
  /** Réinitialise la limite quand cette valeur change (ex. la vue active). */
  resetKey?: unknown;
};

type State = { error: Error | null };

/**
 * Barrière d'erreur : empêche qu'un crash de rendu (une vue, une fonctionnalité)
 * fasse tomber toute l'app en page blanche. Affiche un écran de récupération.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Trace pour le débogage (visible dans la console navigateur).
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Chunk introuvable après un déploiement → recharge auto (1×), pas un bug de
    // code : on NE le remonte PAS au journal (sinon spam après chaque déploiement).
    if (isChunkError(error) && reloadOnce()) return;
    // + remontée serveur : journal + notif push à l'agence.
    reportError(error, info.componentStack ?? "", String(this.props.resetKey ?? this.props.label ?? ""));
  }

  componentDidUpdate(prev: Props) {
    // Quand on change de vue/onglet, on retente le rendu (efface l'erreur).
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Chunk manquant (déploiement) : on est en train de recharger → écran neutre,
    // pas de message d'erreur alarmant.
    if (isChunkError(error)) {
      return (
        <div className="grid min-h-[40vh] place-items-center">
          <div className="text-sm text-muted-foreground">Mise à jour de l'app…</div>
        </div>
      );
    }

    const { variant = "full", label } = this.props;
    const msg = error?.message ? String(error.message).slice(0, 300) : "Erreur inconnue";

    if (variant === "inline") {
      return (
        <div className="grid min-h-[40vh] place-items-center rounded-xl border border-dashed border-border bg-surface/50 p-6">
          <div className="max-w-sm text-center">
            <div className="text-sm font-semibold text-foreground">
              {label ?? "Cette section"} n'a pas pu s'afficher
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Le reste de l'app fonctionne. Tu peux réessayer.
            </div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-rowhover"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={selfHeal}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
              >
                Recharger l'app
              </button>
            </div>
            <div className="mt-3 truncate text-[10px] text-faint" title={msg}>
              {msg}
            </div>
          </div>
        </div>
      );
    }

    // variant "full" — écran plein (racine)
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <div className="text-lg font-semibold text-foreground">Oups — un souci d'affichage</div>
          <div className="mt-2 text-sm text-muted-foreground">
            L'app a rencontré une erreur. Tes données sont en sécurité (rien n'est perdu).
            Recharge pour repartir sur une base saine.
          </div>
          <button
            type="button"
            onClick={selfHeal}
            className="mt-5 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            Recharger l'app
          </button>
          <div className="mt-4 truncate text-[10px] text-faint" title={msg}>
            {msg}
          </div>
        </div>
      </div>
    );
  }
}

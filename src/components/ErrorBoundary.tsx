import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError as report } from "@/lib/errorReport";

// Erreur de chargement d'un chunk (module dynamique) : arrive quand l'app est
// restée ouverte pendant un déploiement et demande un ancien fichier au hash
// remplacé. Ce n'est PAS un bug de code → on recharge, on ne remonte pas.
export function isChunkError(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err ?? "");
  // `_result.default` / `._result` = internes de React.lazy quand un chunk périmé
  // n'a pas pu se charger (iOS Safari remonte ce TypeError au lieu du "Failed to
  // fetch"). On le traite comme une erreur de chunk → rechargement, pas un bug.
  return /dynamically imported module|Importing a module script failed|module script failed|Failed to fetch|ChunkLoadError|error loading dynamically|_result\.default|\._result\b/i.test(m);
}

const RELOAD_KEY = "ttp:chunk-reload";

/**
 * Remet à jour une app restée sur une ancienne version (fichiers remplacés par une
 * mise en ligne). 1er essai : simple rechargement. 2e essai : on vide d'abord les
 * fichiers gardés sur l'appareil (caches du service worker ; jamais la session ni
 * les notifications). Au-delà (dans la minute), on s'arrête et on renvoie false :
 * l'écran propose alors un bouton au lieu de rester bloqué sur « Mise à jour… ».
 */
export function recoverStaleApp(): boolean {
  let tries = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || "null") as { n?: number; at?: number } | null;
    if (saved?.n && saved.at && Date.now() - saved.at < 60000) tries = saved.n;
    if (tries >= 2) return false;
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ n: tries + 1, at: Date.now() }));
  } catch {
    /* pas de sessionStorage → on tente quand même un reload */
  }
  if (tries === 0) location.reload();
  else void clearAppCaches().finally(() => location.reload());
  return true;
}

/** Vide les fichiers de l'app gardés sur l'appareil et redemande le service worker à jour. */
async function clearAppCaches() {
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("ttp-")).map((n) => caches.delete(n)));
    }
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* on recharge quand même */
  }
}

/** Bouton « Recharger l'app » de l'écran de mise à jour : repart de zéro. */
function forceUpdate() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* rien à effacer */
  }
  void clearAppCaches().finally(() => location.reload());
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

type State = { error: Error | null; stuck: boolean };

/**
 * Barrière d'erreur : empêche qu'un crash de rendu (une vue, une fonctionnalité)
 * fasse tomber toute l'app en page blanche. Affiche un écran de récupération.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stuck: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Trace pour le débogage (visible dans la console navigateur).
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Chunk introuvable après un déploiement → remise à jour auto, pas un bug de
    // code : on NE le remonte PAS au journal (sinon spam après chaque déploiement).
    if (isChunkError(error)) {
      if (!recoverStaleApp()) this.setState({ stuck: true });
      return;
    }
    // + remontée serveur : journal + notif push à l'agence.
    report(error, { componentStack: info.componentStack ?? "", page: String(this.props.resetKey ?? this.props.label ?? "") || undefined, source: "écran" });
  }

  componentDidUpdate(prev: Props) {
    // Quand on change de vue/onglet, on retente le rendu (efface l'erreur).
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, stuck: false });
    }
  }

  render() {
    const { error, stuck } = this.state;
    if (!error) return this.props.children;

    // Chunk manquant (déploiement) : on est en train de recharger → écran neutre,
    // pas de message d'erreur alarmant. Si les rechargements n'ont pas suffi, un
    // bouton plutôt qu'un écran bloqué pour toujours.
    if (isChunkError(error)) {
      return (
        <div className="grid min-h-[40vh] place-items-center p-6">
          {stuck ? (
            <div className="max-w-sm text-center">
              <div className="text-sm font-semibold text-foreground">L'app n'a pas pu se mettre à jour</div>
              <div className="mt-1 text-xs text-muted-foreground">Vérifie ta connexion internet, puis recharge.</div>
              <button
                type="button"
                onClick={forceUpdate}
                className="mt-4 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
              >
                Recharger l'app
              </button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Mise à jour de l'app…</div>
          )}
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
                className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-rowhover"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={selfHeal}
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
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
            className="mt-5 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
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

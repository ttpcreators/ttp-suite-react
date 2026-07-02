/**
 * google-connect.tsx — Carte « Google Agenda » du Planning.
 *
 * Rôle : bouton « Connecter Google Agenda » (déconnecté) ou, une fois connecté,
 * l'email du compte + date de dernière sync + boutons « Synchroniser maintenant »
 * et « Déconnecter ». DA : bouton principal en `primary` bleu.
 *
 * Toute la logique réseau vit dans `@/lib/googleCalendar` ; ce composant ne fait
 * qu'orchestrer l'UI et gérer les états de chargement / erreurs.
 *
 * Sécurité : aucun secret ici. Les appels passent par les Edge Functions
 * (JWT agence auto via supabase.functions.invoke). Le refresh_token / client_secret
 * ne transitent jamais côté navigateur.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  ReloadIcon,
  UpdateIcon,
  Link2Icon,
  LinkBreak2Icon,
} from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import {
  connect,
  disconnect,
  getStatus,
  triggerSync,
  consumeOAuthReturn,
  type GoogleStatus,
} from "@/lib/googleCalendar";

/** Formate une date ISO en libellé court FR, ou « — » si absente. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function GoogleConnect() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  /** Recharge le statut de connexion depuis l'Edge Function `google-status`. */
  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await getStatus();
    setStatus(s);
    setLoading(false);
  }, []);

  // Montage : consomme le retour OAuth (?google=connected) puis charge le statut.
  useEffect(() => {
    const { justConnected } = consumeOAuthReturn();
    void refresh();
    if (justConnected) {
      toast("Google Agenda connecté");
    }
  }, [refresh]);

  /** Lance le flux OAuth (redirige le navigateur). */
  const onConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await connect(); // redirige — ne revient pas en cas de succès
    } catch (e) {
      setConnecting(false);
      toast(
        e instanceof Error && e.message.includes("VITE_GOOGLE_CLIENT_ID")
          ? "Configuration Google manquante (CLIENT_ID)"
          : "Impossible de démarrer la connexion Google",
      );
    }
  }, []);

  /** Déclenche une synchronisation manuelle. */
  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await triggerSync();
      if (r.skipped === "locked") {
        toast("Synchro déjà en cours…");
      } else {
        toast(
          `Synchro OK — ${r.pulled} reçu(s), ${r.pushed} envoyé(s), ${r.deleted} supprimé(s)`,
        );
      }
      await refresh();
    } catch {
      toast("Échec de la synchronisation");
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  /** Déconnecte le compte Google. */
  const onDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      toast("Google Agenda déconnecté");
      await refresh();
    } catch {
      toast("Échec de la déconnexion");
    } finally {
      setDisconnecting(false);
    }
  }, [refresh]);

  const connected = status?.connected === true;
  // « invalid_grant » = refresh_token révoqué → reconnexion requise.
  const needsReconnect = connected === false && status?.lastError === "invalid_grant";

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      {/* En-tête : titre + badge d'état */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">Google Agenda</h3>
          <p className="text-xs text-muted-foreground">
            Synchronisation bidirectionnelle du planning
          </p>
        </div>
        <StatusBadge
          loading={loading}
          connected={connected}
          needsReconnect={needsReconnect}
        />
      </div>

      {/* Corps : dépend de l'état de connexion */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ReloadIcon className="h-3.5 w-3.5 animate-spin" />
          Vérification du statut…
        </div>
      ) : connected ? (
        <>
          <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <dt className="text-muted-foreground">Compte</dt>
              <dd className="truncate font-medium text-foreground">
                {status?.email ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <dt className="text-muted-foreground sm:ml-4">Dernière synchro</dt>
              <dd className="font-medium text-foreground">
                {formatDate(status?.lastSyncAt ?? null)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={onSync}
              disabled={syncing || disconnecting}
            >
              <UpdateIcon
                className={`mr-1.5 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onDisconnect}
              disabled={syncing || disconnecting}
            >
              <LinkBreak2Icon className="mr-1.5 h-4 w-4" />
              {disconnecting ? "Déconnexion…" : "Déconnecter"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {needsReconnect && (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              Accès Google expiré ou révoqué. Reconnecte le compte pour reprendre
              la synchronisation.
            </p>
          )}
          <Button
            variant="default"
            size="sm"
            className="w-full sm:w-auto"
            onClick={onConnect}
            disabled={connecting}
          >
            <Link2Icon className="mr-1.5 h-4 w-4" />
            {connecting
              ? "Redirection…"
              : needsReconnect
                ? "Reconnecter Google Agenda"
                : "Connecter Google Agenda"}
          </Button>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Badge d'état                                                        *
 * ------------------------------------------------------------------ */

function StatusBadge({
  loading,
  connected,
  needsReconnect,
}: {
  loading: boolean;
  connected: boolean;
  needsReconnect: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <ReloadIcon className="h-3 w-3 animate-spin" />
        …
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircledIcon className="h-3.5 w-3.5" />
        Connecté
      </span>
    );
  }
  if (needsReconnect) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <ExclamationTriangleIcon className="h-3.5 w-3.5" />
        Reconnexion requise
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <CrossCircledIcon className="h-3.5 w-3.5" />
      Déconnecté
    </span>
  );
}

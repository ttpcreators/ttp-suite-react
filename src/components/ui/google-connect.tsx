/**
 * google-connect.tsx — Carte « Google Agenda » du Planning.
 * Bouton « Connecter Google Agenda » (déconnecté) ou, une fois connecté,
 * l'email du compte + dernière sync + « Synchroniser maintenant » / « Déconnecter ».
 * Toute la logique réseau vit dans `@/lib/googleCalendar` (aucun secret côté front).
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, AlertTriangle, RefreshCw, Link2, Unlink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { connect, disconnect, getStatus, triggerSync, consumeOAuthReturn, type GoogleStatus } from "@/lib/googleCalendar";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

const primaryBtn = "flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";
const ghostBtn = "flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-60";

export function GoogleConnect() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(await getStatus());
    setLoading(false);
  }, []);

  useEffect(() => {
    const { justConnected, error } = consumeOAuthReturn();
    void refresh();
    if (justConnected) toast("Google Agenda connecté ✓");
    else if (error) toast("Échec de la connexion Google — réessaie");
  }, [refresh]);

  const onConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await connect();
    } catch {
      setConnecting(false);
      toast("Impossible de démarrer la connexion Google");
    }
  }, []);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await triggerSync();
      if (r.skipped === "locked") toast("Synchro déjà en cours…");
      else toast(`Synchro OK — ${r.pulled} reçu(s), ${r.pushed} envoyé(s), ${r.deleted} supprimé(s)`);
      await refresh();
    } catch {
      toast("Échec de la synchronisation");
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

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
  const needsReconnect = !connected && status?.lastError === "invalid_grant";

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Google Agenda</div>
            <div className="text-[11px] text-faint">Synchronisation bidirectionnelle du planning</div>
          </div>
        </div>
        {/* Badge d'état */}
        {loading ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rowhover px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> …
          </span>
        ) : connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-signal/15 px-2.5 py-1 text-[10px] font-semibold text-signaltext">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connecté
          </span>
        ) : needsReconnect ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-2.5 py-1 text-[10px] font-semibold text-amber">
            <AlertTriangle className="h-3.5 w-3.5" /> Reconnexion requise
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-rowhover px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
            Déconnecté
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vérification du statut…
        </div>
      ) : connected ? (
        <>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div><span className="text-faint">Compte : </span><span className="font-medium text-foreground">{status?.email ?? "—"}</span></div>
            <div><span className="text-faint">Dernière synchro : </span><span className="font-medium text-foreground">{formatDate(status?.lastSyncAt ?? null)}</span></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onSync} disabled={syncing || disconnecting} className={primaryBtn}>
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
            </button>
            <button type="button" onClick={onDisconnect} disabled={syncing || disconnecting} className={ghostBtn}>
              <Unlink className="h-4 w-4" /> {disconnecting ? "Déconnexion…" : "Déconnecter"}
            </button>
          </div>
        </>
      ) : (
        <>
          {needsReconnect && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber/10 p-2.5 text-xs text-amber">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Accès Google expiré ou révoqué. Reconnecte le compte pour reprendre la synchronisation.
            </p>
          )}
          <div className="mt-4">
            <button type="button" onClick={onConnect} disabled={connecting} className={primaryBtn}>
              <Link2 className="h-4 w-4" />
              {connecting ? "Redirection…" : needsReconnect ? "Reconnecter Google Agenda" : "Connecter Google Agenda"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

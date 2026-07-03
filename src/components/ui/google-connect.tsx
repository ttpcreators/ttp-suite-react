/**
 * google-connect.tsx — Carte « Google Agenda » du Planning.
 * Bouton « Connecter Google Agenda » (déconnecté) ou, une fois connecté,
 * l'email du compte + dernière sync + « Synchroniser maintenant » / « Déconnecter ».
 * Toute la logique réseau vit dans `@/lib/googleCalendar` (aucun secret côté front).
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Unlink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { connect, disconnect, getStatus, triggerSync, consumeOAuthReturn, type GoogleStatus } from "@/lib/googleCalendar";
import { ConfirmDialog } from "@/components/ui/action-menu";

/** Logo Google officiel multicolore (« G »). */
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

const primaryBtn = "flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";
const ghostBtn = "flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-60";
/** Bouton « Google » officiel : fond blanc, texte foncé, quel que soit le thème. */
const googleBtn = "flex items-center gap-2.5 rounded-lg border border-[#dadce0] bg-white px-4 py-2 text-[13px] font-semibold text-[#3c4043] shadow-sm transition-colors hover:bg-[#f8f9fa] disabled:opacity-60";

export function GoogleConnect() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisc, setConfirmDisc] = useState(false);

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
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-white shadow-sm">
            <GoogleLogo className="h-5 w-5" />
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
            <button type="button" onClick={() => setConfirmDisc(true)} disabled={syncing || disconnecting} className={ghostBtn}>
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
            <button type="button" onClick={onConnect} disabled={connecting} className={googleBtn}>
              <GoogleLogo className="h-4 w-4" />
              {connecting ? "Redirection…" : needsReconnect ? "Reconnecter Google Agenda" : "Connecter Google Agenda"}
            </button>
          </div>
        </>
      )}

      {confirmDisc && (
        <ConfirmDialog
          title="Déconnecter Google Agenda ?"
          message="La synchronisation avec Google Agenda sera coupée. Tu devras te reconnecter et réautoriser l'accès Google pour la relancer."
          confirmLabel="Déconnecter"
          cancelLabel="Annuler"
          danger
          onCancel={() => setConfirmDisc(false)}
          onConfirm={() => {
            setConfirmDisc(false);
            onDisconnect();
          }}
        />
      )}
    </div>
  );
}

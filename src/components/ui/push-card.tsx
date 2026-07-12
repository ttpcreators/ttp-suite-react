import { useState } from "react";
import { BellRing } from "lucide-react";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";

/**
 * Carte « Activer les notifications » — pensée pour le portail créateur.
 * Gère tous les états (iOS écran d'accueil requis, refusé, activé + test).
 */
export function PushCard() {
  const { state, busy, enable, disable, sendTest } = usePush();
  const [testing, setTesting] = useState(false);
  if (state === "unsupported") return null;

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const r = await sendTest();
      if (!r.ok) toast(`Échec${r.detail ? ` : ${r.detail}` : " — réessaie"}`);
      else if (r.total === 0) toast("Aucun appareil abonné — active d'abord ici");
      else if (r.sent === 0) toast("Envoi refusé");
      else toast("Notification test envoyée 🎉");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <BellRing className="h-4 w-4 text-primary" /> Notifications
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Reçois une alerte sur ton téléphone quand ton agence t'ajoute une tâche, un document, un brief…
      </p>
      <div className="mt-3">
        {state === "enabled" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-signaltext">
                Activées sur ce téléphone
              </span>
              <button
                type="button"
                onClick={disable}
                disabled={busy}
                className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground disabled:opacity-50"
              >
                Désactiver
              </button>
            </div>
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="w-full rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
            >
              {testing ? "Envoi…" : "Envoyer un test"}
            </button>
          </div>
        ) : state === "needs-install" ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            📲 Sur iPhone : <span className="font-medium text-foreground">Partager → Ajouter à l'écran d'accueil</span>, puis ouvre l'app depuis son icône et reviens ici pour activer.
          </p>
        ) : state === "denied" ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            🔕 Notifications bloquées. Autorise-les dans Réglages → Notifications → TTP Suite.
          </p>
        ) : (
          <button
            type="button"
            onClick={async () => {
              const ok = await enable();
              if (!ok && Notification.permission === "granted") toast("Activation échouée — réessaie");
            }}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <BellRing className="h-3.5 w-3.5" /> {busy ? "Activation…" : "Activer sur ce téléphone"}
          </button>
        )}
      </div>
    </div>
  );
}

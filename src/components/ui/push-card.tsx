import { useState } from "react";
import { BellRing, HelpCircle, Check, Smartphone, Bell, Shield } from "@/components/icons";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";
import { WelcomeModal } from "@/components/ui/welcome-modal";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/**
 * Notifications (portail créateur) — compact : une barre + DEUX modales
 * (activation & « comment recevoir »), pour ne pas occuper tout l'écran.
 * Toute la logique d'états (iOS écran d'accueil, refus, activé + test) est
 * préservée via usePush.
 * `mails` : le Mail du créateur est activé → ses nouveaux mails sont notifiés aussi
 * (gmail-poll ; pas de réglage à part pour l'instant, activé par défaut).
 */
export function PushCard({ mails = false }: { mails?: boolean }) {
  const { state, busy, enable, disable, sendTest } = usePush();
  const [testing, setTesting] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const t = useT();
  if (state === "unsupported") return null;

  const enabled = state === "enabled";

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const r = await sendTest();
      if (!r.ok) toast(r.detail ? t("Échec : {detail}", { detail: r.detail }) : t("Échec — réessaie"));
      else if (r.total === 0) toast(t("Aucun appareil abonné — active d'abord ici"));
      else if (r.sent === 0) toast(t("Envoi refusé"));
      else toast(t("Notification test envoyée 🎉"));
    } finally {
      setTesting(false);
    }
  };
  const doEnable = async () => {
    const ok = await enable();
    if (ok) setActOpen(false);
    else if (Notification.permission === "granted") toast(t("Activation échouée — réessaie"));
  };

  // Label + action du bouton principal de la modale d'activation, selon l'état.
  const primaryLabel = enabled ? (testing ? t("Envoi…") : t("Envoyer un test")) : state === "default" ? (busy ? t("Activation…") : t("Activer sur ce téléphone")) : undefined;
  const onPrimary = enabled ? runTest : doEnable;

  return (
    <>
      {/* Barre compacte */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3.5 shadow-sm">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <BellRing className="h-4 w-4 text-primary" /> {t("Notifications")}
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", enabled ? "bg-signal/10 text-signaltext" : "bg-panel text-faint")}>
            {enabled ? t("Activées") : t("Désactivées")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setHelpOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <HelpCircle className="h-3.5 w-3.5" /> {t("Comment ça marche ?")}
          </button>
          <button type="button" onClick={() => setActOpen(true)} className="rounded-full bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            {enabled ? t("Gérer") : t("Activer")}
          </button>
        </div>
      </div>

      {/* Modale 1 — activation */}
      <WelcomeModal
        open={actOpen}
        onClose={() => setActOpen(false)}
        icon={<BellRing className="h-5 w-5 text-primary" />}
        title={t("Reste au courant en temps réel")}
        description={t("Reçois une alerte sur ton téléphone dès que ton agence t'ajoute une tâche, un brief, un gifting ou un document.")}
        primaryLabel={primaryLabel}
        onPrimary={onPrimary}
        primaryDisabled={busy || testing}
      >
        <ul className="flex flex-col gap-2">
          {[...(mails ? ["Nouveaux mails des marques"] : []), "Nouveaux briefs & deals", "Cadeaux / gifting reçus", "Tâches et documents ajoutés"].map((line) => (
            <li key={line} className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Check className="h-4 w-4 shrink-0 text-signaltext" /> {t(line)}
            </li>
          ))}
        </ul>
        {enabled && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-panel/50 px-3 py-2.5">
            <span className="text-[12px] font-medium text-signaltext">✓ {t("Activées sur ce téléphone")}</span>
            <button type="button" onClick={disable} disabled={busy} className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
              {t("Désactiver")}
            </button>
          </div>
        )}
        {state === "needs-install" && (
          <p className="mt-4 rounded-lg bg-foreground/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-amber">
            📲 {t("Sur iPhone :")} <span className="font-semibold">{t("Partager → Ajouter à l'écran d'accueil")}</span>{t(", puis ouvre l'app depuis son icône et reviens ici pour activer.")}
          </p>
        )}
        {state === "denied" && (
          <p className="mt-4 rounded-lg bg-foreground/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-amber">
            🔕 {t("Notifications bloquées. Autorise-les dans")} <span className="font-semibold">{t("Réglages → Notifications → TTP Suite")}</span>{t(", puis reviens.")}
          </p>
        )}
      </WelcomeModal>

      {/* Modale 2 — comment recevoir */}
      <WelcomeModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        icon={<HelpCircle className="h-5 w-5 text-primary" />}
        title={t("Comment recevoir mes notifications")}
        description={t("En 3 étapes selon ton appareil.")}
        primaryLabel={t("J'ai compris")}
        onPrimary={() => setHelpOpen(false)}
      >
        <ol className="flex flex-col gap-3">
          <li className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Smartphone className="h-4 w-4" /></span>
            <div><span className="font-semibold text-foreground">{t("iPhone d'abord :")}</span> {t("Partager → « Ajouter à l'écran d'accueil », puis ouvre l'app")} <span className="font-medium text-foreground">{t("depuis son icône")}</span> {t("(obligatoire pour les notifs iOS).")}</div>
          </li>
          <li className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Bell className="h-4 w-4" /></span>
            <div>{t("Reviens ici")} → <span className="font-semibold text-foreground">{t("Activer")}</span> → <span className="font-medium text-foreground">{t("Autoriser")}</span> {t("quand le téléphone le demande.")}</div>
          </li>
          <li className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Shield className="h-4 w-4" /></span>
            <div>{t("Si tu avais refusé :")} <span className="font-medium text-foreground">{t("Réglages → Notifications → TTP Suite")}</span> → {t("autorise. (Sur Android / ordinateur : clique « Activer » et autorise.)")}</div>
          </li>
        </ol>
      </WelcomeModal>
    </>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { BellRing, Smartphone, Sunrise, Sun, Users, Mail, CalendarDays } from "lucide-react";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Préférences de notifications (agence) — stockées dans le blob `notifPrefs`.
 * Tout est activé par défaut ; un interrupteur éteint = catégorie coupée.
 * Lues par : l'Edge Function daily-digest (résumé du matin + activité créateur)
 * et par la cloche (useNotifications).
 */
export type NotifPrefs = {
  pushCreatorActivity?: boolean; // push immédiat quand un créateur ajoute qqch
  bellCreatorActivity?: boolean; // activité créateurs dans la cloche
  digestEvents?: boolean; // résumé matin : évènements du jour
  digestTasks?: boolean; // résumé matin : tâches & briefs à échéance
  digestContracts?: boolean; // résumé matin : contrats ≤ 60 j
  digestInvoices?: boolean; // résumé matin : factures en retard
  digestWeekly?: boolean; // résumé du lundi : tâches & évènements de la semaine
  digestAfternoon?: boolean; // point de mi-journée (14h) : ce qu'il reste à traiter
  emailReceivedBell?: boolean; // cloche : mail reçu sur la boîte agence
  emailReceivedPush?: boolean; // push : mail reçu sur la boîte agence
};

const on = (v: boolean | undefined) => v !== false; // défaut = activé

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-faint/40")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function PrefRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {hint && <div className="text-[11px] text-faint">{hint}</div>}
        </div>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function Parametres() {
  const { data: stored } = useAppState<NotifPrefs>((s: AppState) => (s["notifPrefs"] as NotifPrefs) ?? {});
  const [prefs, setPrefs] = useState<NotifPrefs>({});
  useEffect(() => {
    if (stored) setPrefs(stored);
  }, [stored]);

  const setPref = async (key: keyof NotifPrefs, value: boolean) => {
    // Relecture FRAÎCHE avant fusion : ne pas réécrire la map depuis un état local
    // périmé (sinon une préférence modifiée sur un autre appareil serait perdue).
    invalidateAppState();
    const fresh = ((await getAppState())["notifPrefs"] as NotifPrefs) ?? {};
    const next = { ...fresh, [key]: value };
    setPrefs(next);
    const ok = await saveAppStateKey("notifPrefs", next);
    if (!ok) toast("Erreur d'enregistrement — réessaie");
  };

  // Notifications push de CET appareil
  const { state, busy, enable, disable, sendTest } = usePush();
  const [testing, setTesting] = useState(false);
  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const r = await sendTest();
      if (!r.ok) toast(`Échec de l'appel${r.detail ? ` : ${r.detail}` : ""}`);
      else if (r.total === 0) toast("Aucun appareil abonné — active d'abord ci-dessus");
      else if (r.sent === 0) toast(`Envoi refusé${r.detail ? ` : ${r.detail}` : ""}`);
      else toast(`Notification test envoyée (${r.sent}) 🎉`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Cet appareil */}
      <Section
        icon={<Smartphone className="h-4 w-4" />}
        title="Cet appareil"
        hint="Réception des notifications push sur l'appareil que tu utilises en ce moment."
      >
        {state === "enabled" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-signaltext">
              <BellRing className="h-4 w-4" /> Notifications activées
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runTest}
                disabled={testing}
                className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
              >
                {testing ? "Envoi…" : "Envoyer un test"}
              </button>
              <button
                type="button"
                onClick={disable}
                disabled={busy}
                className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
              >
                Désactiver
              </button>
            </div>
          </div>
        ) : state === "needs-install" ? (
          <p className="py-2 text-[12px] leading-relaxed text-muted-foreground">
            📲 Sur iPhone : ouvre l'app depuis son <span className="font-medium text-foreground">icône sur l'écran d'accueil</span> pour
            pouvoir activer les notifications (Partager → Ajouter à l'écran d'accueil si ce n'est pas fait).
          </p>
        ) : state === "denied" ? (
          <p className="py-2 text-[12px] leading-relaxed text-muted-foreground">
            🔕 Notifications bloquées pour cette app. Autorise-les dans les réglages de l'appareil (Réglages → Notifications → TTP Suite).
          </p>
        ) : state === "unsupported" ? (
          <p className="py-2 text-[12px] leading-relaxed text-muted-foreground">
            Ce navigateur ne prend pas en charge les notifications push.
          </p>
        ) : (
          <button
            type="button"
            onClick={async () => {
              const ok = await enable();
              if (!ok && Notification.permission === "granted") toast("Activation échouée — réessaie");
            }}
            disabled={busy}
            className="my-1 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <BellRing className="h-3.5 w-3.5" /> {busy ? "Activation…" : "Activer sur cet appareil"}
          </button>
        )}
      </Section>

      {/* Résumé du matin */}
      <Section
        icon={<Sunrise className="h-4 w-4" />}
        title="Résumé du matin"
        hint="Chaque matin à 8h, une notification groupée — envoyée seulement s'il y a quelque chose à signaler."
      >
        <PrefRow
          label="Évènements du jour"
          hint="Tes rendez-vous du Planning prévus aujourd'hui."
          checked={on(prefs.digestEvents)}
          onChange={(v) => setPref("digestEvents", v)}
        />
        <PrefRow
          label="Tâches & briefs à échéance"
          hint="Ceux qui tombent aujourd'hui ou déjà en retard."
          checked={on(prefs.digestTasks)}
          onChange={(v) => setPref("digestTasks", v)}
        />
        <PrefRow
          label="Contrats à surveiller"
          hint="Contrats qui se terminent dans moins de 60 jours (ou expirés)."
          checked={on(prefs.digestContracts)}
          onChange={(v) => setPref("digestContracts", v)}
        />
        <PrefRow
          label="Factures en retard"
          hint="Les factures passées en statut « retard »."
          checked={on(prefs.digestInvoices)}
          onChange={(v) => setPref("digestInvoices", v)}
        />
      </Section>

      {/* Point de mi-journée */}
      <Section
        icon={<Sun className="h-4 w-4" />}
        title="Point de mi-journée"
        hint="Chaque jour à 14h — un rappel de ce qu'il reste à traiter (coupe la journée en deux)."
      >
        <PrefRow
          label="Rappel de 14h"
          hint="Tâches & briefs encore à faire aujourd'hui, et évènements du jour."
          checked={on(prefs.digestAfternoon)}
          onChange={(v) => setPref("digestAfternoon", v)}
        />
      </Section>

      {/* Résumé de la semaine */}
      <Section
        icon={<CalendarDays className="h-4 w-4" />}
        title="Résumé de la semaine"
        hint="Chaque lundi à 8h — un aperçu des tâches et évènements de la semaine à venir."
      >
        <PrefRow
          label="Résumé du lundi"
          hint="Tâches, briefs et évènements prévus du lundi au dimanche."
          checked={on(prefs.digestWeekly)}
          onChange={(v) => setPref("digestWeekly", v)}
        />
      </Section>

      {/* Activité des créateurs */}
      <Section
        icon={<Users className="h-4 w-4" />}
        title="Activité des créateurs"
        hint="Quand un créateur ajoute une tâche, une idée ou un évènement depuis son espace."
      >
        <PrefRow
          label="Notification immédiate sur le téléphone"
          hint="Un push dès qu'un créateur ajoute quelque chose."
          checked={on(prefs.pushCreatorActivity)}
          onChange={(v) => setPref("pushCreatorActivity", v)}
        />
        <PrefRow
          label="Afficher dans la cloche"
          hint="L'activité des 7 derniers jours en haut des notifications de l'app."
          checked={on(prefs.bellCreatorActivity)}
          onChange={(v) => setPref("bellCreatorActivity", v)}
        />
      </Section>

      {/* Emails reçus */}
      <Section
        icon={<Mail className="h-4 w-4" />}
        title="Emails"
        hint="Quand un email arrive sur la boîte de l'agence (Gmail connecté)."
      >
        <PrefRow
          label="Notification sur le téléphone"
          hint="Un push dès qu'un nouvel email arrive."
          checked={on(prefs.emailReceivedPush)}
          onChange={(v) => setPref("emailReceivedPush", v)}
        />
        <PrefRow
          label="Afficher dans la cloche"
          hint="Les nouveaux emails en haut des notifications de l'app."
          checked={on(prefs.emailReceivedBell)}
          onChange={(v) => setPref("emailReceivedBell", v)}
        />
      </Section>
    </div>
  );
}

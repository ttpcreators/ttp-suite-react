import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, Smartphone, Sunrise, Sun, Moon, Users, Mail, CalendarDays, Bug, LogOut, RefreshCw, Palette, Check, MessageCircle, History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { ACCENT_PRESETS, ACCENT_GRADIENTS, getAccent, setAccent, isHex, parseGradient, getDarkStyle, setDarkStyle, type DarkStyle } from "@/lib/accent";
import { NOTIF_TEXTS_CREATOR, NOTIF_TEXTS_AGENCY, type NotifTextField } from "@/lib/notifTexts";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { RELANCE_DAYS, type ProspectSettings, type WaMode } from "@/lib/touches";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Tabs } from "@/components/ui/animated-tabs";
import { myDisplayName, saveMyDisplayName } from "@/lib/team";

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
  digestRdvTomorrow?: boolean; // résumé matin : RDV prévus demain (rappel la veille)
  digestPayouts?: boolean; // résumé matin : reversements à faire aux créateurs
  digestBirthdays?: boolean; // résumé matin : anniversaires créateurs du jour
  digestMonthly?: boolean; // résumé matin du 1er : récap CA du mois précédent
  digestWeekly?: boolean; // résumé du lundi : tâches & évènements de la semaine
  digestAfternoon?: boolean; // point de mi-journée (14h) : ce qu'il reste à traiter
  digestStats?: boolean; // rappel quotidien : données créateurs à mettre à jour ce mois
  emailReceivedBell?: boolean; // cloche : mail reçu sur la boîte agence
  emailReceivedPush?: boolean; // push : mail reçu sur la boîte agence
  pushErrors?: boolean; // push : un bug (crash de rendu) est survenu dans l'app
  pushTeamActivity?: boolean; // push : un autre compte agence a ajouté / terminé / supprimé qqch
  bellTeamActivity?: boolean; // cloche : actions des autres comptes agence
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
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition-all", checked ? "left-[18px] bg-primary-foreground" : "left-0.5 bg-white")} />
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

/** « Ton prénom » : affiché dans l'activité de l'équipe et ses notifications. */
function TeamNameField() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void myDisplayName().then((n) => {
      setName(n);
      setSaved(n);
    });
  }, []);
  const save = async () => {
    const v = name.trim();
    if (!v || v === saved || busy) return;
    setBusy(true);
    const ok = await saveMyDisplayName(v);
    setBusy(false);
    if (ok) {
      setSaved(v);
      toast("Prénom enregistré ✓");
    } else toast("Prénom non enregistré : lance d'abord le SQL « équipe, activité, routines ».");
  };
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">Ton prénom</div>
        <div className="text-[11px] text-faint">Affiché dans l'activité et les notifications : « {saved || "Marc"} a terminé la tâche… ».</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          className="h-9 w-40 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none focus:border-primary"
          placeholder="Ton prénom"
        />
        <button type="button" onClick={() => void save()} disabled={busy || !name.trim() || name.trim() === saved}
          className="h-9 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {hint && <div className="text-[11px] text-faint">{hint}</div>}
        </div>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function NotifTextRow({ field, value, onChange, onSave }: { field: NotifTextField; value: string; onChange: (v: string) => void; onSave: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-foreground">{field.label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        placeholder={field.def}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
      {field.hint && <span className="text-[10px] leading-snug text-faint">{field.hint}</span>}
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

  const { dark, toggle: toggleTheme } = useTheme();

  // Style du thème sombre (propre à cet appareil) : Minuit (défaut) ou Classique.
  const [darkStyle, setDarkStyleState] = useState<DarkStyle>(() => getDarkStyle());
  const chooseDarkStyle = (s: DarkStyle) => {
    setDarkStyle(s);
    setDarkStyleState(s);
  };

  // Couleur d'accent (propre à cet appareil, comme le thème).
  const [accent, setAccentState] = useState<string>(() => getAccent());
  const chooseAccent = (color: string) => {
    setAccent(color);
    setAccentState(color);
  };

  // Textes personnalisables des notifications (blob agence `notifTexts`).
  const { data: storedTexts } = useAppState<Record<string, string>>((s: AppState) => (s["notifTexts"] as Record<string, string>) ?? {});
  const [texts, setTexts] = useState<Record<string, string>>({});
  // Champs en cours de saisie : le tick live ne doit pas écraser ce qui est tapé.
  const dirtyTexts = useRef<Set<string>>(new Set());
  const mergeTexts = (stored: Record<string, string>, prev: Record<string, string>) => {
    const next = { ...stored };
    for (const k of dirtyTexts.current) next[k] = prev[k] ?? "";
    return next;
  };
  useEffect(() => {
    if (storedTexts) setTexts((prev) => mergeTexts(storedTexts, prev));
  }, [storedTexts]);
  const editText = (key: string, v: string) => {
    dirtyTexts.current.add(key);
    setTexts((t) => ({ ...t, [key]: v }));
  };
  const saveText = async (key: string, value: string) => {
    invalidateAppState();
    const fresh = ((await getAppState())["notifTexts"] as Record<string, string>) ?? {};
    const next = { ...fresh };
    if (value.trim()) next[key] = value.trim();
    else delete next[key]; // vide = revient au texte par défaut
    const ok = await saveAppStateKey("notifTexts", next);
    if (!ok) {
      toast("Erreur d'enregistrement, réessaie"); // saisie conservée (toujours « dirty »)
      return;
    }
    dirtyTexts.current.delete(key);
    setTexts((prev) => mergeTexts(next, prev));
  };

  // Prospection (blob agence `prospectSettings`) : rythme de relance + mode WhatsApp.
  const { data: storedProspect } = useAppState<ProspectSettings>((s: AppState) => (s["prospectSettings"] as ProspectSettings) ?? {});
  const [prospect, setProspect] = useState<ProspectSettings>({});
  const [relanceInput, setRelanceInput] = useState<string>("");
  const relanceDirty = useRef(false); // saisie en cours → pas de resync live
  useEffect(() => {
    if (storedProspect) {
      setProspect(storedProspect);
      if (!relanceDirty.current) setRelanceInput(storedProspect.relanceDays ? String(storedProspect.relanceDays) : "");
    }
  }, [storedProspect]);
  const saveProspect = async (patch: Partial<ProspectSettings>) => {
    invalidateAppState();
    const fresh = ((await getAppState())["prospectSettings"] as ProspectSettings) ?? {};
    const next = { ...fresh, ...patch };
    setProspect(next);
    const ok = await saveAppStateKey("prospectSettings", next);
    if (!ok) toast("Erreur d'enregistrement — réessaie");
  };
  const saveRelanceDays = () => {
    relanceDirty.current = false;
    const n = Math.round(Number(relanceInput));
    if (!relanceInput.trim() || !Number.isFinite(n) || n < 1) {
      setRelanceInput("");
      void saveProspect({ relanceDays: undefined });
      return;
    }
    const clamped = Math.min(365, Math.max(1, n));
    setRelanceInput(String(clamped));
    void saveProspect({ relanceDays: clamped });
  };
  const waMode: WaMode = prospect.waMode === "web" ? "web" : "app";

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
      {/* Apparence (thème) — pratique surtout sur mobile où l'icône a quitté le bandeau */}
      <Section
        icon={dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        title="Apparence"
        hint="Thème clair ou sombre de l'application (propre à cet appareil)."
      >
        <PrefRow
          label="Mode sombre"
          hint="Bascule toute l'app en thème sombre."
          checked={dark}
          onChange={() => toggleTheme()}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">Style sombre</div>
            <div className="text-[11px] leading-snug text-faint">
              Minuit : noir profond et monochrome. Classique : l'ancien sombre bleuté.
            </div>
          </div>
          <Tabs
            size="sm"
            className="shrink-0"
            label="Style sombre"
            items={[
              { value: "minuit", label: "Minuit" },
              { value: "classic", label: "Classique" },
            ]}
            value={darkStyle}
            onValueChange={(v) => chooseDarkStyle(v as DarkStyle)}
          />
        </div>
      </Section>

      {/* Couleur d'accent (token --primary) — s'applique aussi en thème sombre */}
      <Section
        icon={<Palette className="h-4 w-4" />}
        title="Couleur d'accent"
        hint="La couleur des boutons, liens et surbrillances (propre à cet appareil). Fonctionne aussi en mode sombre."
      >
        <div className="mb-2 text-[12px] font-medium text-muted-foreground">Couleurs unies</div>
        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENT_PRESETS.map((p) => {
            const active = (accent || "") === p.value;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => chooseAccent(p.value)}
                title={p.name}
                aria-label={p.name}
                aria-pressed={active}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition",
                  active ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-foreground/40",
                )}
                style={{ background: p.value || "linear-gradient(135deg, #0069fe 50%, #fafafa 50%)" }}
              >
                {active && <Check className="h-4 w-4 text-white drop-shadow" />}
              </button>
            );
          })}
          {/* Couleur personnalisée (sélecteur natif) */}
          <label
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            title="Couleur personnalisée"
          >
            <span className="h-4 w-4 rounded-full border border-border" style={{ background: "conic-gradient(from 0deg,#ef4444,#f59e0b,#10b981,#3b82f6,#8b5cf6,#ef4444)" }} />
            Perso
            <input type="color" value={isHex(accent) ? accent : "#0069fe"} onChange={(e) => chooseAccent(e.target.value)} className="sr-only" />
          </label>
        </div>
        {/* Dégradés : boutons pleins en deux couleurs */}
        <div className="mb-2 mt-5 text-[12px] font-medium text-muted-foreground">Dégradés</div>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_GRADIENTS.map((g) => {
            const active = accent === g.value;
            const [a, b] = parseGradient(g.value) ?? ["#000", "#000"];
            return (
              <button
                key={g.name}
                type="button"
                onClick={() => chooseAccent(g.value)}
                aria-pressed={active}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[12px] font-medium transition-colors",
                  active ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
                  {active && <Check className="h-3.5 w-3.5 text-white" />}
                </span>
                {g.name}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-faint">« Par défaut » : bleu en clair, blanc en sombre Minuit. « Bleu TTP » force le bleu partout. Un dégradé colore les boutons en deux teintes. Le texte des boutons s'ajuste (blanc/noir) pour rester lisible.</p>
      </Section>

      {/* Prospection : rythme de recontact + ouverture WhatsApp (blob prospectSettings) */}
      <Section
        icon={<MessageCircle className="h-4 w-4" />}
        title="Prospection"
        hint="Le suivi des contacts marques (page Contacts) : rythme de recontact et ouverture de WhatsApp."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Rythme de recontact</div>
              <div className="text-[11px] leading-snug text-faint">
                Un contact repasse « à relancer » quand le dernier échange (prise de contact ou réponse) date de ce nombre de jours.
              </div>
            </div>
            <label className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={relanceInput}
                onChange={(e) => {
                  relanceDirty.current = true;
                  setRelanceInput(e.target.value);
                }}
                onBlur={saveRelanceDays}
                placeholder={String(RELANCE_DAYS)}
                className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-center text-[13px] tabular-nums text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <span className="text-[12px] text-muted-foreground">jours</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Ouverture WhatsApp</div>
              <div className="text-[11px] leading-snug text-faint">
                C'est le compte connecté qui envoie, pas un réglage : choisis WhatsApp Web si ton numéro PRO y est connecté (web.whatsapp.com), l'application sinon.
              </div>
            </div>
            <Tabs
              size="sm"
              className="shrink-0"
              label="Ouverture WhatsApp"
              items={[
                { value: "app", label: "Application" },
                { value: "web", label: "WhatsApp Web" },
              ]}
              value={waMode}
              onValueChange={(v) => void saveProspect({ waMode: v as WaMode })}
            />
          </div>
        </div>
      </Section>

      {/* Textes des notifications (titres personnalisables — blob notifTexts) */}
      <Section
        icon={<BellRing className="h-4 w-4" />}
        title="Textes des notifications"
        hint="Personnalise le titre de chaque notification push. Laisse vide = texte par défaut. Les modifs s'appliquent aux prochains envois."
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 text-[12px] font-medium text-muted-foreground">Ce que reçoit un créateur (quand tu agis)</div>
            <div className="flex flex-col gap-3">
              {NOTIF_TEXTS_CREATOR.map((f) => (
                <NotifTextRow key={f.key} field={f} value={texts[f.key] ?? ""} onChange={(v) => editText(f.key, v)} onSave={() => saveText(f.key, texts[f.key] ?? "")} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium text-muted-foreground">Ce que TU reçois (quand un créateur agit)</div>
            <div className="flex flex-col gap-3">
              {NOTIF_TEXTS_AGENCY.map((f) => (
                <NotifTextRow key={f.key} field={f} value={texts[f.key] ?? ""} onChange={(v) => editText(f.key, v)} onSave={() => saveText(f.key, texts[f.key] ?? "")} />
              ))}
            </div>
          </div>
        </div>
      </Section>

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
                className="rounded-lg border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
              >
                {testing ? "Envoi…" : "Envoyer un test"}
              </button>
              <button
                type="button"
                onClick={disable}
                disabled={busy}
                className="rounded-lg border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
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
            className="my-1 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
        <PrefRow
          label="RDV de demain"
          hint="Un rappel la veille des rendez-vous prévus le lendemain."
          checked={on(prefs.digestRdvTomorrow)}
          onChange={(v) => setPref("digestRdvTomorrow", v)}
        />
        <PrefRow
          label="Reversements à faire"
          hint="Créateurs à qui il reste de l'argent à reverser (encaissé − commission − déjà versé)."
          checked={on(prefs.digestPayouts)}
          onChange={(v) => setPref("digestPayouts", v)}
        />
        <PrefRow
          label="Anniversaires créateurs"
          hint="Une notification le jour J et un rappel la veille. Il faut que la date de naissance soit renseignée dans la fiche du créateur."
          checked={on(prefs.digestBirthdays)}
          onChange={(v) => setPref("digestBirthdays", v)}
        />
        <PrefRow
          label="Récap mensuel (1er du mois)"
          hint="Le 1er de chaque mois : CA facturé et encaissé du mois précédent."
          checked={on(prefs.digestMonthly)}
          onChange={(v) => setPref("digestMonthly", v)}
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

      {/* Données créateurs à jour */}
      <Section
        icon={<RefreshCw className="h-4 w-4" />}
        title="Données créateurs à jour"
        hint="Chaque jour à 9h — tant que des créateurs ne sont pas cochés « à jour » pour le mois en cours (roster)."
      >
        <PrefRow
          label="Rappel mensuel des données"
          hint="Liste les créateurs dont les stats (abonnés, ER, CA…) ne sont pas encore à jour ce mois-ci. S'arrête quand tout est coché."
          checked={on(prefs.digestStats)}
          onChange={(v) => setPref("digestStats", v)}
        />
      </Section>

      {/* Alertes techniques */}
      <Section
        icon={<Bug className="h-4 w-4" />}
        title="Alertes techniques"
        hint="Pour être prévenu si un bug survient dans l'app — chez toi, Gianni ou un créateur."
      >
        <PrefRow
          label="Notif quand un bug survient"
          hint="Un push « ⚠️ bug » à la première occurrence (anti-spam), et l'erreur est journalisée pour diagnostic."
          checked={on(prefs.pushErrors)}
          onChange={(v) => setPref("pushErrors", v)}
        />
      </Section>

      {/* Équipe agence : qui fait quoi */}
      <Section
        icon={<History className="h-4 w-4" />}
        title="Équipe agence"
        hint="Chaque ajout, « Fait », suppression ou avancée est noté dans Pilotage → Activité. Ces réglages valent pour toute l'équipe."
      >
        <TeamNameField />
        <PrefRow
          label="Notification quand l'autre agit"
          hint="Un push sur ton téléphone dès qu'un autre compte de l'agence ajoute, termine ou supprime quelque chose. Plusieurs actions rapprochées = une seule notification."
          checked={on(prefs.pushTeamActivity)}
          onChange={(v) => setPref("pushTeamActivity", v)}
        />
        <PrefRow
          label="Afficher dans la cloche"
          hint="Les actions des autres des 3 derniers jours, filtre « Équipe »."
          checked={on(prefs.bellTeamActivity)}
          onChange={(v) => setPref("bellTeamActivity", v)}
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

      {/* Compte */}
      <Section
        icon={<LogOut className="h-4 w-4" />}
        title="Compte"
        hint="Se déconnecter de cet appareil."
      >
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-[12px] font-medium text-[#E5484D] transition-colors hover:bg-rowhover"
        >
          <LogOut className="h-3.5 w-3.5" /> Se déconnecter
        </button>
      </Section>
    </div>
  );
}

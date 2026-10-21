import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SIGNATURE_KEY, scribble, validSig, type SignatureData } from "@/lib/agencySignature";
import { SignaturePad } from "@/components/signature-pad";
import {
  BellRing, Smartphone, Sunrise, History, LogOut, Palette, MessageCircle, Bot, Copy, Unplug, PenLine, Sparkles,
  Search, ChevronRight, ChevronDown, X, type LucideIcon,
} from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { ACCENT_PRESETS, ACCENT_GRADIENTS, getAccent, setAccent, isHex, parseGradient, THEME_CHOICES, type ThemeChoice } from "@/lib/accent";
import { NOTIF_TEXTS_CREATOR, NOTIF_TEXTS_AGENCY, type NotifTextField } from "@/lib/notifTexts";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { RELANCE_DAYS, type ProspectSettings, type WaMode } from "@/lib/touches";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Tabs } from "@/components/ui/animated-tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { myDisplayName, saveMyDisplayName } from "@/lib/team";
import { NAV, type ViewId } from "@/lib/nav";
import { ALWAYS_SHOWN, HIDDEN_PAGES_EVENT, HIDDEN_PAGES_KEY, hiddenPagesOf } from "@/lib/hiddenPages";
import { TONE_SOLID } from "@/lib/statusTone";
import { readSticky, useStickyState } from "@/lib/useStickyState";
import { FolderTabs } from "@/components/ui/folder-tabs";
import { FOLDER_PAGES, FOLDER_TONES, TONE_LABEL, TONE_VAR, pageDefaultTones, resolveTabTones, type FolderTone } from "@/lib/folderTabs";
import { resetPageTones, saveTabTone, useFolderTones } from "@/lib/useFolderTones";
import { useNavSub } from "@/lib/navSub";
import { bestHit, entriesOfTab, entryAnchor, groupHits, pagesVisibility, searchSettings, sectionAnchor, settingsTabs, settingsTarget, settingsTargetFor, type SettingsEntry } from "@/lib/settingsSearch";

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

/*
 * Colonne de gauche : entrées groupées façon Réglages d'iOS. Chaque entrée ouvre un
 * volet (une ou plusieurs cartes). Les titres de cartes gardent les anciennes ancres
 * « reglage-… » (sectionAnchor) : une ancre ou une sous-page de nav ouvre la bonne entrée.
 * Pastilles : jetons uniquement (accent, encre, statuts), jamais le rouge.
 */
type Entry = SettingsEntry & { icon: LucideIcon; tile: string; hint: string };
const INK_TILE = "bg-foreground text-background";
const ENTRIES: Entry[] = [
  {
    id: "apparence", label: "Apparence", group: "Général", icon: Palette, tile: "bg-primary text-primary-foreground",
    hint: "Thème et couleur de cet appareil. Pages du menu et couleurs des classeurs de toute l'équipe.",
    keywords: ["thème", "look", "couleur", "classeur"],
    sections: [
      { title: "Apparence", keywords: ["thème", "clair", "verre", "noir", "sombre", "auto", "mode nuit"] },
      { title: "Couleur d'accent", keywords: ["couleur", "accent", "dégradé", "boutons"] },
      { title: "Pages affichées", keywords: ["menu", "masquer", "ranger", "cacher", "pages"] },
      { title: "Couleurs des classeurs", keywords: ["couleur", "onglet", "onglets", "classeur", "classeurs", "intercalaire", "dossier"] },
    ],
  },
  {
    id: "signature", label: "Signature", group: "Général", icon: PenLine, tile: INK_TILE,
    hint: "Posée d'office dans le cadre « Pour TTP Creators » de tous les contrats. Le cadre du créateur ou de la marque reste vide.",
    sections: [{ title: "Signature", keywords: ["contrat", "signer", "gribouiller"] }],
  },
  {
    id: "prospection", label: "Prospection", group: "Prospection et Claude", icon: MessageCircle, tile: TONE_SOLID.ok,
    hint: "Le rythme des relances (page À contacter) et la façon d'ouvrir WhatsApp.",
    sections: [{ title: "Prospection", keywords: ["relance", "recontact", "rythme", "jours", "whatsapp"] }],
  },
  {
    id: "claude", label: "Claude", group: "Prospection et Claude", icon: Bot, tile: TONE_SOLID.wait,
    hint: "Branche TTP Suite sur ton compte Claude (ordinateur et téléphone). Claude lit tes données et agit avec ton accord.",
    sections: [{ title: "Claude", keywords: ["connecteur", "assistant", "ia", "accès", "connexion"] }],
  },
  {
    id: "appareil", label: "Cet appareil", group: "Notifications", icon: Smartphone, tile: TONE_SOLID.progress,
    hint: "Réception des notifications push sur l'appareil que tu utilises en ce moment.",
    keywords: ["push", "notifications", "activer", "test"],
    sections: [{ title: "Cet appareil", keywords: ["push", "activer", "test", "téléphone"] }],
  },
  {
    id: "resumes", label: "Résumés et rappels", group: "Notifications", icon: Sunrise, tile: TONE_SOLID.info,
    hint: "Les notifications groupées du matin, de 14h, du lundi, et le rappel des données créateurs.",
    keywords: ["résumé", "digest"],
    sections: [
      { title: "Résumé du matin", keywords: ["8h", "évènements", "tâches", "briefs", "contrats", "factures", "rdv", "reversements", "anniversaires", "récap mensuel"] },
      { title: "Point de mi-journée", keywords: ["14h", "après-midi", "rappel"] },
      { title: "Résumé de la semaine", keywords: ["lundi", "semaine"] },
      { title: "Données créateurs à jour", keywords: ["stats", "roster", "mensuel", "abonnés"] },
      { title: "Sauvegarde mensuelle", keywords: ["sauvegarde", "backup", "csv", "export", "media kit", "crash"] },
    ],
  },
  {
    id: "activite", label: "Activité et alertes", group: "Notifications", icon: History, tile: TONE_SOLID.ok,
    hint: "Ce que font l'équipe et les créateurs, les emails reçus et les bugs.",
    sections: [
      { title: "Équipe agence", keywords: ["prénom", "collègue", "équipe", "cloche"] },
      { title: "Activité des créateurs", keywords: ["créateur", "cloche"] },
      { title: "Emails", keywords: ["mail", "gmail", "boîte"] },
      { title: "Alertes techniques", keywords: ["bug", "erreur", "diagnostic"] },
    ],
  },
  {
    id: "textes", label: "Textes des notifications", group: "Notifications", icon: BellRing, tile: INK_TILE,
    hint: "Personnalise le titre de chaque notification push. Laisse vide = texte par défaut. Les modifs s'appliquent aux prochains envois.",
    sections: [{ title: "Textes des notifications", keywords: ["titre", "personnaliser", "message"] }],
  },
  {
    id: "compte", label: "Compte", group: "Compte", icon: LogOut, tile: TONE_SOLID.closed,
    hint: "Se déconnecter de cet appareil.",
    keywords: ["déconnexion"],
    sections: [{ title: "Compte", keywords: ["déconnecter", "déconnexion", "sortir"] }],
  },
];
const ENTRY_IDS = ENTRIES.map((e) => e.id);
/** Onglets « dossier » : un par groupe de la liste ci-dessus. */
const TABS = settingsTabs(ENTRIES);
const TAB_IDS = TABS.map((t) => t.value);

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
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
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Carte du volet de droite. `anchor` = titre d'origine de la section (ancre « reglage-… »). */
/**
 * Sauvegarde mensuelle par mail (fonction monthly-backup, cron le 1er du mois) : les
 * fondateurs reçoivent une archive avec les CSV, les réglages (sans le coffre) et les
 * media kits. Bouton pour l'envoyer tout de suite.
 */
function BackupCard() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("monthly-backup", { body: {}, timeout: 150_000 });
      if (error) {
        const ctx = (error as { context?: { json?: () => Promise<unknown>; status?: number } }).context;
        const j = ctx && typeof ctx.json === "function" ? ((await ctx.json().catch(() => null)) as { error?: string; code?: string } | null) : null;
        toast(
          j?.code === "NOT_FOUND" ? "Sauvegarde pas encore installée : la fonction monthly-backup n'est pas déployée."
            : j?.error === "unauthorized" ? "Réservé aux fondateurs."
            : j?.error === "google_non_connecte" ? "Reconnecte Google (Planning) : l'envoi passe par partnerships@."
            : j?.error === "aucun_destinataire" ? "Aucun fondateur avec une adresse mail trouvé."
            : "Sauvegarde non envoyée, réessaie dans un instant.",
        );
        return;
      }
      const d = (data ?? {}) as { recipients?: number; attached?: boolean; bytes?: number };
      const mb = ((d.bytes ?? 0) / 1024 / 1024).toFixed(1).replace(".", ",");
      toast(`Sauvegarde envoyée ✓ (${mb} Mo${d.attached ? ", jointe au mail" : ", lien dans le mail"})`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Sauvegarde mensuelle"
      hint="Le 1er de chaque mois, les fondateurs reçoivent par mail une archive : un fichier CSV par liste (contacts, roster, collabs, briefs, factures, to-do, planning, scouting…), les réglages de l'agence (sans le coffre des mots de passe) et les media kits en PDF, créateurs et agence. Si l'app tombe un jour, l'essentiel est dans ta boîte mail."
      right={
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Envoi en cours…" : "Envoyer maintenant"}
        </button>
      }
    />
  );
}

function Card({ anchor, title, hint, right, children }: { anchor?: string; title?: string; hint?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  const id = anchor ?? title;
  return (
    <section id={id ? sectionAnchor(id) : undefined} className="scroll-mt-6 rounded-[20px] bg-surface p-5">
      {(title || hint || right) && (
        <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", children != null && "mb-4")}>
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>}
            {hint && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Pastille d'icône des réglages. Direction « sobre » (choix de Marc) : carré gris et
 * icône d'encre pour toutes les entrées. `entry.tile` (anciennes couleurs façon iOS)
 * n'est plus utilisé.
 */
function EntryIcon({ entry }: { entry: Entry }) {
  const Icon = entry.icon;
  return (
    <span aria-hidden className="grid size-[29px] shrink-0 place-items-center rounded-[8px] bg-field text-foreground/75">
      <Icon className="size-[17px]" strokeWidth={2.1} />
    </span>
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
    } else toast("Prénom non enregistré : pas encore activé (mise à jour en attente).");
  };
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">Ton prénom</div>
        <div className="text-[12px] text-muted-foreground">Affiché dans l'activité et les notifications : « {saved || "Marc"} a terminé la tâche… ».</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          className="h-9 w-40 min-w-0 rounded-[10px] bg-field px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Ton prénom"
          aria-label="Ton prénom"
        />
        <button type="button" onClick={() => void save()} disabled={busy || !name.trim() || name.trim() === saved}
          className="h-9 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          Enregistrer
        </button>
      </div>
    </div>
  );
}

/*
 * Aperçus de thème : mini fenêtres (barre latérale + lignes de contenu) peintes avec les
 * couleurs de CHAQUE thème. Elles montrent d'autres thèmes que celui en cours, donc pas
 * de jetons live : les couleurs figées vivent toutes ici, dans cette seule table.
 */
const PREVIEW_COLORS = {
  clair: { bg: "#f5f5f7", side: "#ffffff", card: "#ffffff", line: "#d8d8dd", strong: "#1d1d1f", accent: "#0069fe" },
  verre: {
    bg: "linear-gradient(135deg, #dbe7fb 0%, #ddf2ea 50%, #fde5d4 100%)",
    side: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.62)", line: "rgba(60,60,67,0.18)", strong: "rgba(29,29,31,0.78)", accent: "#0069fe",
  },
  noir: { bg: "#000000", side: "#1c1c1e", card: "#1c1c1e", line: "#3a3a3c", strong: "#f5f5f7", accent: "#fafafa" },
} as const;
/** Pastille « Par défaut » de l'accent : bleu en clair, blanc en Noir. */
const DEFAULT_ACCENT_SWATCH = `linear-gradient(135deg, ${PREVIEW_COLORS.clair.accent} 50%, ${PREVIEW_COLORS.noir.accent} 50%)`;

function MiniWindow({ kind }: { kind: keyof typeof PREVIEW_COLORS }) {
  const c = PREVIEW_COLORS[kind];
  const line = (w: string, h = 3) => <span className="block rounded-full" style={{ width: w, height: h, background: c.line }} />;
  return (
    <div className="absolute inset-0 flex gap-[6%] p-[7px]" style={{ background: c.bg }}>
      <div className="flex w-[28%] flex-col gap-[4px] rounded-[5px] p-[5px]" style={{ background: c.side }}>
        <span className="block h-[4px] w-[70%] rounded-full" style={{ background: c.accent }} />
        {line("85%")}
        {line("60%")}
        {line("75%")}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px] py-[2px]">
        <span className="block h-[5px] w-[45%] rounded-full" style={{ background: c.strong }} />
        <div className="flex flex-1 flex-col gap-[4px] rounded-[5px] p-[5px]" style={{ background: c.card }}>
          {line("90%")}
          {line("70%")}
          {line("80%")}
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ theme }: { theme: ThemeChoice }) {
  return (
    <span aria-hidden className="relative block aspect-[16/7] w-full overflow-hidden rounded-[10px]">
      {theme === "auto" ? (
        <>
          <MiniWindow kind="clair" />
          {/* Moitié droite en Noir : Auto suit le réglage de l'appareil. */}
          <span className="absolute inset-0" style={{ clipPath: "inset(0 0 0 50%)" }}>
            <MiniWindow kind="noir" />
          </span>
        </>
      ) : (
        <MiniWindow kind={theme} />
      )}
    </span>
  );
}

function ThemeCard() {
  const { theme, setTheme } = useTheme();
  return (
    <Card anchor="Apparence" title="Thème">
      <div role="radiogroup" aria-label="Thème" className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
        {THEME_CHOICES.map((t) => {
          const sel = theme === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => setTheme(t.value)}
              className="group flex flex-col items-center gap-2 rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span
                className={cn(
                  "block w-full rounded-[12px] p-[3px] transition-shadow",
                  sel ? "ring-2 ring-primary" : "ring-1 ring-border group-hover:ring-foreground/30",
                )}
              >
                <ThemePreview theme={t.value} />
              </span>
              <span className={cn("text-[13px]", sel ? "font-semibold text-foreground" : "text-muted-foreground")}>{t.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] leading-snug text-muted-foreground">Verre façon Liquid Glass, Noir le soir. Auto suit le réglage de l'appareil.</p>
    </Card>
  );
}

/** Fond d'une pastille d'accent (unie, dégradé, ou « Par défaut »). */
function swatchBg(value: string): string {
  if (!value) return DEFAULT_ACCENT_SWATCH;
  const g = parseGradient(value);
  return g ? `linear-gradient(135deg, ${g[0]}, ${g[1]})` : value;
}
const presetValue = (name: string) => ACCENT_PRESETS.find((p) => p.name === name)?.value ?? "";
/** Roue « Perso » peinte avec les teintes des préréglages. */
const RAINBOW = `conic-gradient(from 0deg, ${["Rouge", "Ambre", "Émeraude", "Bleu TTP", "Violet", "Rouge"].map(presetValue).join(", ")})`;
/** Pastilles visibles d'emblée ; les autres (et dégradés, couleur perso) passent sous « Plus ». */
const MAIN_ACCENTS = ["Par défaut", "Indigo", "Violet", "Rose", "Orange", "Émeraude"];

function Swatch({ name, value, active, onPick, size = "md" }: { name: string; value: string; active: boolean; onPick: (v: string) => void; size?: "md" | "sm" }) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      title={name}
      aria-label={name}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110",
        size === "md" ? "size-7" : "size-6",
        active ? "ring-2 ring-foreground" : "ring-1 ring-border",
      )}
      style={{ background: swatchBg(value) }}
    />
  );
}

/** Couleur d'accent (token --primary), PROPRE À CET APPAREIL (lib/accent.ts). */
function AccentCard() {
  const [accent, setAccentState] = useState<string>(() => getAccent());
  const choose = (color: string) => {
    setAccent(color);
    setAccentState(color);
  };
  const main = ACCENT_PRESETS.filter((p) => MAIN_ACCENTS.includes(p.name));
  const more = ACCENT_PRESETS.filter((p) => !MAIN_ACCENTS.includes(p.name));
  const inMain = main.some((p) => p.value === (accent || ""));
  return (
    <Card
      anchor="Couleur d'accent"
      title="Couleur d'accent"
      hint="Boutons, sélection, éléments actifs. Propre à cet appareil."
      right={
        <div className="flex flex-wrap items-center gap-2.5">
          {main.map((p) => (
            <Swatch key={p.name} name={p.name} value={p.value} active={(accent || "") === p.value} onPick={choose} />
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-foreground ring-offset-2 ring-offset-surface transition-colors hover:bg-rowhover",
                  inMain ? "ring-1 ring-border" : "ring-2 ring-foreground",
                )}
              >
                <span className="size-4 rounded-full ring-1 ring-border" style={{ background: inMain ? RAINBOW : swatchBg(accent) }} />
                Plus
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 rounded-[16px] p-4">
              <div className="mb-2 text-[12px] font-medium text-muted-foreground">Couleurs unies</div>
              <div className="flex flex-wrap gap-2.5">
                {more.map((p) => (
                  <Swatch key={p.name} name={p.name} value={p.value} active={accent === p.value} onPick={choose} size="sm" />
                ))}
                {/* Couleur personnalisée (sélecteur natif) */}
                <label
                  title="Couleur personnalisée"
                  className={cn(
                    "relative size-6 shrink-0 cursor-pointer rounded-full ring-offset-2 ring-offset-popover",
                    isHex(accent) && !ACCENT_PRESETS.some((p) => p.value === accent) ? "ring-2 ring-foreground" : "ring-1 ring-border",
                  )}
                  style={{ background: RAINBOW }}
                >
                  <span className="sr-only">Couleur personnalisée</span>
                  <input type="color" value={isHex(accent) ? accent : PREVIEW_COLORS.clair.accent} onChange={(e) => choose(e.target.value)} className="sr-only" />
                </label>
              </div>
              <div className="mb-2 mt-4 text-[12px] font-medium text-muted-foreground">Dégradés</div>
              <div className="flex flex-col gap-1">
                {ACCENT_GRADIENTS.map((g) => {
                  const active = accent === g.value;
                  return (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => choose(g.value)}
                      aria-pressed={active}
                      className={cn("flex h-8 items-center gap-2 rounded-[10px] px-1.5 text-left text-[13px] transition-colors hover:bg-rowhover", active ? "font-semibold text-foreground" : "text-muted-foreground")}
                    >
                      <span className={cn("size-5 rounded-full", active && "ring-2 ring-foreground ring-offset-1 ring-offset-popover")} style={{ background: swatchBg(g.value) }} />
                      {g.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] leading-snug text-muted-foreground">« Par défaut » : bleu en clair, blanc en Noir. « Bleu TTP » force le bleu partout. Un dégradé colore les boutons en deux teintes. Le texte des boutons s'ajuste (blanc ou noir) pour rester lisible.</p>
            </PopoverContent>
          </Popover>
        </div>
      }
    />
  );
}

/**
 * Pages affichées dans le menu (pour toute l'agence). Une page éteinte est rangée : hors du
 * menu, de la recherche et des raccourcis, sans rien effacer. Un clic la remet.
 */
const PAGE_FAMILIES = NAV.map((f) => ({ ...f, items: f.items.filter((i) => !ALWAYS_SHOWN.includes(i.id)) })).filter((f) => f.items.length > 0);
const PAGE_IDS = PAGE_FAMILIES.flatMap((f) => f.items.map((i) => i.id));
const FIRST_FAMILIES = 2;

function PagesCard() {
  const { data } = useAppState<ViewId[]>(hiddenPagesOf);
  const [local, setLocal] = useState<ViewId[] | null>(null);
  const [all, setAll] = useState(false);
  const parked = local ?? data ?? [];
  const toggle = async (id: ViewId) => {
    // Relecture fraîche : ne pas écraser ce qu'un collègue vient de changer.
    invalidateAppState();
    const fresh = hiddenPagesOf(await getAppState());
    const next = fresh.includes(id) ? fresh.filter((x) => x !== id) : [...fresh, id];
    setLocal(next);
    window.dispatchEvent(new CustomEvent(HIDDEN_PAGES_EVENT, { detail: next }));
    if (!(await saveAppStateKey(HIDDEN_PAGES_KEY, next))) {
      setLocal(fresh);
      window.dispatchEvent(new CustomEvent(HIDDEN_PAGES_EVENT, { detail: fresh }));
      toast("Erreur d'enregistrement, réessaie");
    }
  };
  const { visible, total } = pagesVisibility(PAGE_IDS, parked);
  const families = all ? PAGE_FAMILIES : PAGE_FAMILIES.slice(0, FIRST_FAMILIES);
  const rest = PAGE_FAMILIES.length - FIRST_FAMILIES;
  return (
    <Card
      title="Pages affichées"
      hint="Masque une page du menu pour toute l'équipe. Rien n'est effacé."
      right={<span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{visible} sur {total} visibles</span>}
    >
      <div className="flex flex-col gap-4">
        {families.map((f) => (
          <div key={f.id}>
            <div className="mb-2 text-[12px] font-medium text-muted-foreground">{f.label}</div>
            <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3">
              {f.items.map((i) => {
                const shown = !parked.includes(i.id);
                return (
                  <div key={i.id} className="flex h-10 min-w-0 items-center gap-2 rounded-[12px] bg-panel px-3">
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", shown ? "text-foreground" : "text-muted-foreground")}>{i.label}</span>
                    <Toggle checked={shown} onChange={() => void toggle(i.id)} label={shown ? `Ranger ${i.label}` : `Remettre ${i.label} dans le menu`} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {rest > 0 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-4 text-[13px] font-medium text-primary hover:underline">
          {all ? "Afficher moins" : `Afficher les ${rest} autres sections`}
        </button>
      )}
    </Card>
  );
}

/**
 * Couleurs des classeurs (pour toute l'équipe, blob `folderTabTones`) : une ligne par page
 * en onglets « dossier », dépliée pour choisir la couleur de chaque onglet parmi la palette
 * (jetons des graphiques) ou « Automatique » (couleur par défaut de la page).
 */
function FolderTonesCard() {
  const custom = useFolderTones();
  const [open, setOpen] = useState<string | null>(null);
  const pick = async (page: string, tab: string, tone: FolderTone | null) => {
    if (!(await saveTabTone(page, tab, tone))) toast("Erreur d'enregistrement, réessaie");
  };
  const reset = async (page: string) => {
    if (await resetPageTones(page)) toast("Couleurs d'origine remises ✓");
    else toast("Erreur d'enregistrement, réessaie");
  };
  return (
    <Card title="Couleurs des classeurs" hint="La couleur de chaque onglet des pages en classeur, pour toute l'équipe.">
      <div className="flex flex-col gap-1.5">
        {FOLDER_PAGES.map((p) => {
          const tones = resolveTabTones(
            p.tabs.map((t) => t.value),
            pageDefaultTones(p.id),
            custom[p.id],
          );
          const isOpen = open === p.id;
          const changed = !!custom[p.id];
          return (
            <div key={p.id} className="rounded-[12px] bg-panel">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : p.id)}
                aria-expanded={isOpen}
                className="flex h-10 w-full min-w-0 items-center gap-3 rounded-[12px] px-3 text-left transition-colors hover:bg-rowhover"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{p.label}</span>
                {changed && <span className="shrink-0 text-[12px] text-muted-foreground">Personnalisé</span>}
                <span aria-hidden className="flex shrink-0 items-center gap-1">
                  {p.tabs.map((t) => (
                    <span key={t.value} className="size-2.5 rounded-full" style={{ background: TONE_VAR[tones[t.value]] }} />
                  ))}
                </span>
                <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-faint transition-transform", isOpen && "rotate-180")} />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-1 px-3 pb-3">
                  {p.tabs.map((t) => (
                    <div key={t.value} className="flex h-10 min-w-0 items-center gap-3 border-t border-border">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{t.label}</span>
                      <TonePicker
                        label={`Couleur de l'onglet ${t.label} (${p.label})`}
                        shown={tones[t.value]}
                        chosen={custom[p.id]?.[t.value] ?? null}
                        onPick={(tone) => void pick(p.id, t.value, tone)}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={!changed}
                    onClick={() => void reset(p.id)}
                    className="mt-1 self-start text-[13px] font-medium text-primary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
                  >
                    Revenir aux couleurs d'origine
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Pastille d'un onglet : un clic ouvre la palette (7 couleurs + « Automatique »). */
function TonePicker({ label, shown, chosen, onPick }: { label: string; shown: FolderTone; chosen: FolderTone | null; onPick: (tone: FolderTone | null) => void }) {
  const [open, setOpen] = useState(false);
  const choose = (tone: FolderTone | null) => {
    setOpen(false);
    if (tone !== chosen) onPick(tone);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} : ${TONE_LABEL[shown]}`}
          title={TONE_LABEL[shown]}
          className="size-6 shrink-0 rounded-full ring-1 ring-border ring-offset-2 ring-offset-panel transition-transform hover:scale-110"
          style={{ background: TONE_VAR[shown] }}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto rounded-[16px] p-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
          {FOLDER_TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => choose(t)}
              aria-label={TONE_LABEL[t]}
              aria-pressed={chosen === t}
              title={TONE_LABEL[t]}
              className={cn("size-6 shrink-0 rounded-full ring-offset-2 ring-offset-popover transition-transform hover:scale-110", chosen === t ? "ring-2 ring-foreground" : "ring-1 ring-border")}
              style={{ background: TONE_VAR[t] }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => choose(null)}
          aria-pressed={chosen === null}
          className={cn("mt-2 flex h-8 w-full items-center rounded-[10px] px-2 text-left text-[13px] transition-colors hover:bg-rowhover", chosen === null ? "font-semibold text-foreground" : "text-muted-foreground")}
        >
          Automatique
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Connecteur Claude : adresse à ajouter dans Claude, connexions actives de CE compte
 * (coupables en un clic) et journal de ce que Claude a consulté ou fait.
 */
const MCP_URL = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ttp-mcp";
type Grant = { id: string; client_name: string | null; created_at: string; last_used_at: string | null };
type McpLog = { id: number; tool: string; ok: boolean; at: string };
const TOOL_LABELS: Record<string, string> = {
  point_du_jour: "Point du jour", rechercher: "Recherche", lister_createurs: "Roster", fiche_createur: "Fiche créateur",
  rechercher_mails: "Recherche de mails", lire_mail: "Lecture d'un mail", dm_instagram: "DM Instagram", scouting: "Scouting",
  contacts: "Contacts", pipeline: "Pipeline", collabs: "Collabs", planning: "Planning", taches: "Tâches", factures: "Factures",
  creer_tache: "Tâche créée", creer_evenement: "Rendez-vous ajouté", creer_brouillon_mail: "Brouillon de mail",
  ajouter_contact: "Contact ajouté", noter_echange_contact: "Échange noté", ajouter_au_scouting: "Ajout au scouting",
  changer_statut_scouting: "Statut de scouting", avancer_collab: "Étape de collab",
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ClaudePane() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [log, setLog] = useState<McpLog[]>([]);
  const [off, setOff] = useState(false); // tables pas encore créées
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    const [g, l] = await Promise.all([
      supabase.from("mcp_grants").select("id, client_name, created_at, last_used_at").is("revoked_at", null).order("created_at", { ascending: false }),
      supabase.from("mcp_log").select("id, tool, ok, at").order("at", { ascending: false }).limit(15),
    ]);
    if (g.error) {
      setOff(true);
      return;
    }
    setGrants((g.data as Grant[]) ?? []);
    setLog((l.data as McpLog[]) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      toast("Adresse copiée ✓");
    } catch {
      toast("Copie impossible");
    }
  };
  const cut = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from("mcp_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    setBusy(null);
    if (error) return toast("Erreur, réessaie");
    toast("Accès coupé ✓");
    void load();
  };
  return (
    <>
      <Card anchor="Claude" title="Adresse du connecteur">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[10px] bg-field px-3 py-2 text-[12px]">{MCP_URL}</code>
          <button type="button" onClick={() => void copy()} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium hover:bg-rowhover">
            <Copy className="h-3.5 w-3.5" /> Copier
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          Dans Claude (sur claude.ai) : Paramètres → Connecteurs → Ajouter un connecteur personnalisé, colle l'adresse, puis « Se connecter » et « Autoriser ». Il est ensuite disponible aussi sur l'app Claude du téléphone.
        </p>
      </Card>
      {off ? (
        <Card hint="Pas encore activé : une mise à jour est en attente." />
      ) : (
        <>
          <Card title="Connexions actives">
            {grants === null ? (
              <p className="text-[12px] text-muted-foreground">Chargement…</p>
            ) : grants.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Aucune pour l'instant.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {grants.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-3 rounded-[12px] bg-panel px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">{g.client_name || "Claude"}</span>
                      <span className="block text-[11px] text-muted-foreground">Depuis le {fmtWhen(g.created_at)}{g.last_used_at ? ` · utilisé le ${fmtWhen(g.last_used_at)}` : ""}</span>
                    </span>
                    <button type="button" onClick={() => void cut(g.id)} disabled={busy === g.id} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-medium text-destructive hover:bg-rowhover disabled:opacity-50">
                      <Unplug className="h-3.5 w-3.5" /> Couper l'accès
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {log.length > 0 && (
            <Card title="Dernières utilisations">
              <ul className="flex flex-col divide-y divide-border">
                {log.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 py-1.5 text-[12px]">
                    <span className={cn("size-1.5 shrink-0 rounded-full", l.ok ? "bg-signal" : "bg-danger")} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{TOOL_LABELS[l.tool] ?? l.tool}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtWhen(l.at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function NotifTextRow({ field, value, onChange, onSave }: { field: NotifTextField; value: string; onChange: (v: string) => void; onSave: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-foreground">{field.label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        placeholder={field.def}
        aria-label={field.label}
        className="h-9 w-full rounded-[10px] bg-field px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/30"
      />
      {field.hint && <span className="text-[11px] leading-snug text-muted-foreground">{field.hint}</span>}
    </div>
  );
}

/**
 * Signature de l'agence, posée d'office dans le cadre « Pour TTP Creators » de tous les
 * contrats (lib/agencySignature.ts). Gribouillée à la main ou par l'app.
 */
function SignatureCard() {
  const { data } = useAppState<SignatureData | null>((s) => validSig(s[SIGNATURE_KEY]));
  const [draft, setDraft] = useState<SignatureData | null | undefined>(undefined); // undefined = rien de modifié
  const shown = draft === undefined ? data ?? null : draft;
  const [busy, setBusy] = useState(false);
  const save = async (next: SignatureData | null) => {
    setBusy(true);
    const ok = await saveAppStateKey(SIGNATURE_KEY, next ? { ...next, at: new Date().toISOString() } : null);
    setBusy(false);
    if (!ok) return toast("Erreur, signature non enregistrée");
    setDraft(undefined);
    toast(next ? (next.on === false ? "Signature gardée, mais plus posée sur les contrats" : "Signature enregistrée : elle sera posée sur les contrats ✓") : "Signature retirée");
  };
  const on = shown?.on !== false;
  return (
    <Card anchor="Signature">
      <div className="flex flex-col gap-3">
        <SignaturePad value={shown} onChange={setDraft} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDraft({ ...scribble(Math.floor(Math.random() * 1e9)), on })}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Gribouiller pour moi
          </button>
          <button type="button" onClick={() => setDraft(null)} disabled={!shown}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover disabled:opacity-40">
            Effacer
          </button>
          <span className="flex-1" />
          {draft !== undefined && (
            <button type="button" onClick={() => void save(draft)} disabled={busy}
              className="rounded-full bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              Enregistrer
            </button>
          )}
        </div>
        {shown && (
          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-border pt-3">
            <span>
              <span className="block text-[13px] font-medium text-foreground">Signer automatiquement les contrats</span>
              <span className="block text-[12px] text-muted-foreground">Désactivé : les contrats sortent avec le cadre vide, à signer à la main.</span>
            </span>
            <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void save({ ...shown, on: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
          </label>
        )}
        <p className="text-[12px] leading-snug text-muted-foreground">Dessine à la souris ou au doigt dans le cadre (plusieurs traits possibles), ou laisse l'app gribouiller une signature. Les contrats déjà enregistrés gardent la version du jour où ils ont été faits.</p>
      </div>
    </Card>
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
    if (!ok) toast("Erreur d'enregistrement, réessaie");
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
    if (!ok) toast("Erreur d'enregistrement, réessaie");
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
      else if (r.total === 0) toast("Aucun appareil abonné : active d'abord ci-dessus");
      else if (r.sent === 0) toast(`Envoi refusé${r.detail ? ` : ${r.detail}` : ""}`);
      else toast(`Notification test envoyée (${r.sent}) 🎉`);
    } finally {
      setTesting(false);
    }
  };

  // ── Navigation des réglages : onglet « dossier » par groupe (mémorisé), recherche ──
  // Premier affichage après la refonte : l'onglet de l'entrée qu'on avait ouverte.
  const [tab, setTab] = useStickyState<string>("parametres:onglet", TAB_IDS, () => {
    const id = readSticky<string>("parametres:entree", ENTRY_IDS, "apparence");
    return settingsTarget(ENTRIES, id)?.tab ?? TAB_IDS[0];
  });
  const [query, setQuery] = useState("");
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const hits = useMemo(() => searchSettings(ENTRIES, query), [query]);
  const groups = useMemo(() => groupHits(hits), [hits]);

  // Ouvre une entrée (et une carte) : bascule sur l'onglet de son groupe puis défile jusqu'à elle.
  const openEntry = (id: string, sectionTitle?: string | null) => {
    const t = settingsTarget(ENTRIES, id, sectionTitle);
    if (!t) return;
    setTab(t.tab);
    setPendingAnchor(t.anchor);
    setQuery("");
  };

  // Cible venue d'ailleurs : sous-page de nav (select("parametres", "signature")) ou ancre #reglage-….
  const navSub = useNavSub();
  useEffect(() => {
    const target = navSub ?? (typeof window !== "undefined" && window.location.hash.startsWith("#reglage-") ? window.location.hash : null);
    const t = settingsTargetFor(ENTRIES, target);
    if (!t) return;
    setTab(t.tab);
    setPendingAnchor(t.anchor);
  }, [navSub, setTab]);

  // Carte ou bloc visé (résultat de recherche, ancre) : défile jusqu'à lui une fois l'onglet rendu.
  useEffect(() => {
    if (!pendingAnchor) return;
    const el = document.getElementById(pendingAnchor);
    if (el) el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    setPendingAnchor(null);
  }, [pendingAnchor, tab]);

  const paneFor = (id: string) => {
    switch (id) {
      case "apparence":
        return (
          <>
            <ThemeCard />
            <AccentCard />
            <PagesCard />
            <FolderTonesCard />
          </>
        );
      case "signature":
        return <SignatureCard />;
      case "prospection":
        return (
          <Card anchor="Prospection">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-foreground">Rythme de recontact</div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
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
                    aria-label="Rythme de recontact en jours"
                    className="h-9 w-20 rounded-[10px] bg-field px-3 text-center text-[13px] tabular-nums text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="text-[12px] text-muted-foreground">jours</span>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-foreground">Ouverture WhatsApp</div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
                    Choisis « WhatsApp Web » si ton numéro pro est connecté sur cet ordinateur, sinon « Application ».
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
          </Card>
        );
      case "claude":
        return <ClaudePane />;
      case "appareil":
        return (
          <Card anchor="Cet appareil">
            {state === "enabled" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-signaltext">
                  <BellRing className="h-4 w-4" /> Notifications activées
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={testing}
                    className="rounded-full border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
                  >
                    {testing ? "Envoi…" : "Envoyer un test"}
                  </button>
                  <button
                    type="button"
                    onClick={disable}
                    disabled={busy}
                    className="rounded-full border border-border px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
                  >
                    Désactiver
                  </button>
                </div>
              </div>
            ) : state === "needs-install" ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                📲 Sur iPhone : ouvre l'app depuis son <span className="font-medium text-foreground">icône sur l'écran d'accueil</span> pour
                pouvoir activer les notifications (Partager → Ajouter à l'écran d'accueil si ce n'est pas fait).
              </p>
            ) : state === "denied" ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                🔕 Notifications bloquées pour cette app. Autorise-les dans les réglages de l'appareil (Réglages → Notifications → TTP Suite).
              </p>
            ) : state === "unsupported" ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">Ce navigateur ne prend pas en charge les notifications push.</p>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const ok = await enable();
                  if (!ok && Notification.permission === "granted") toast("Activation échouée, réessaie");
                }}
                disabled={busy}
                className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <BellRing className="h-3.5 w-3.5" /> {busy ? "Activation…" : "Activer sur cet appareil"}
              </button>
            )}
          </Card>
        );
      case "resumes":
        return (
          <>
            <Card title="Résumé du matin" hint="Chaque matin à 8h, une notification groupée, envoyée seulement s'il y a quelque chose à signaler.">
              <PrefRow label="Évènements du jour" hint="Tes rendez-vous du Planning prévus aujourd'hui." checked={on(prefs.digestEvents)} onChange={(v) => setPref("digestEvents", v)} />
              <PrefRow label="Tâches & briefs à échéance" hint="Ceux qui tombent aujourd'hui ou déjà en retard." checked={on(prefs.digestTasks)} onChange={(v) => setPref("digestTasks", v)} />
              <PrefRow label="Contrats à surveiller" hint="Contrats qui se terminent dans moins de 60 jours (ou expirés)." checked={on(prefs.digestContracts)} onChange={(v) => setPref("digestContracts", v)} />
              <PrefRow label="Factures en retard" hint="Les factures passées en statut « retard »." checked={on(prefs.digestInvoices)} onChange={(v) => setPref("digestInvoices", v)} />
              <PrefRow label="RDV de demain" hint="Un rappel la veille des rendez-vous prévus le lendemain." checked={on(prefs.digestRdvTomorrow)} onChange={(v) => setPref("digestRdvTomorrow", v)} />
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
              <PrefRow label="Récap mensuel (1er du mois)" hint="Le 1er de chaque mois : CA facturé et encaissé du mois précédent." checked={on(prefs.digestMonthly)} onChange={(v) => setPref("digestMonthly", v)} />
            </Card>
            <Card title="Point de mi-journée" hint="Chaque jour à 14h, un rappel de ce qu'il reste à traiter (coupe la journée en deux).">
              <PrefRow label="Rappel de 14h" hint="Tâches & briefs encore à faire aujourd'hui, et évènements du jour." checked={on(prefs.digestAfternoon)} onChange={(v) => setPref("digestAfternoon", v)} />
            </Card>
            <Card title="Résumé de la semaine" hint="Chaque lundi à 8h, un aperçu des tâches et évènements de la semaine à venir.">
              <PrefRow label="Résumé du lundi" hint="Tâches, briefs et évènements prévus du lundi au dimanche." checked={on(prefs.digestWeekly)} onChange={(v) => setPref("digestWeekly", v)} />
            </Card>
            <Card title="Données créateurs à jour" hint="Chaque jour à 9h, tant que des créateurs ne sont pas cochés « à jour » pour le mois en cours (roster).">
              <PrefRow
                label="Rappel mensuel des données"
                hint="Liste les créateurs dont les stats (abonnés, engagement, CA…) ne sont pas encore à jour ce mois-ci. S'arrête quand tout est coché."
                checked={on(prefs.digestStats)}
                onChange={(v) => setPref("digestStats", v)}
              />
            </Card>
            <BackupCard />
          </>
        );
      case "activite":
        return (
          <>
            <Card title="Équipe agence" hint="Chaque ajout, « Fait », suppression ou avancée est noté dans Pilotage → Activité. Ces réglages valent pour toute l'équipe.">
              <TeamNameField />
              <div className="pt-3">
                <PrefRow
                  label="Notification quand un collègue agit"
                  hint="Un push sur ton téléphone dès qu'un autre compte de l'agence ajoute, termine ou supprime quelque chose. Plusieurs actions rapprochées = une seule notification."
                  checked={on(prefs.pushTeamActivity)}
                  onChange={(v) => setPref("pushTeamActivity", v)}
                />
                <PrefRow label="Afficher dans la cloche" hint="Les actions des autres des 3 derniers jours, filtre « Équipe »." checked={on(prefs.bellTeamActivity)} onChange={(v) => setPref("bellTeamActivity", v)} />
              </div>
            </Card>
            <Card title="Activité des créateurs" hint="Quand un créateur ajoute une tâche, une idée ou un évènement depuis son espace.">
              <PrefRow label="Notification immédiate sur le téléphone" hint="Un push dès qu'un créateur ajoute quelque chose." checked={on(prefs.pushCreatorActivity)} onChange={(v) => setPref("pushCreatorActivity", v)} />
              <PrefRow label="Afficher dans la cloche" hint="L'activité des 7 derniers jours en haut des notifications de l'app." checked={on(prefs.bellCreatorActivity)} onChange={(v) => setPref("bellCreatorActivity", v)} />
            </Card>
            <Card title="Emails" hint="Quand un email arrive sur la boîte de l'agence (Gmail connecté).">
              <PrefRow label="Notification sur le téléphone" hint="Un push par fil dès qu'un mail arrive (expéditeur, objet, début du message), un résumé au-delà de 3." checked={on(prefs.emailReceivedPush)} onChange={(v) => setPref("emailReceivedPush", v)} />
              <PrefRow label="Afficher dans la cloche" hint="Les nouveaux emails en haut des notifications de l'app." checked={on(prefs.emailReceivedBell)} onChange={(v) => setPref("emailReceivedBell", v)} />
            </Card>
            <Card title="Alertes techniques" hint="Pour être prévenu si un bug survient dans l'app : chez toi, un collègue ou un créateur.">
              <PrefRow label="Notification en cas de bug" hint="Un seul avertissement par bug, détails dans Diagnostic." checked={on(prefs.pushErrors)} onChange={(v) => setPref("pushErrors", v)} />
            </Card>
          </>
        );
      case "textes":
        return (
          <>
            <Card anchor="Textes des notifications" title="Ce que reçoit un créateur" hint="Quand tu agis.">
              <div className="flex flex-col gap-3">
                {NOTIF_TEXTS_CREATOR.map((f) => (
                  <NotifTextRow key={f.key} field={f} value={texts[f.key] ?? ""} onChange={(v) => editText(f.key, v)} onSave={() => saveText(f.key, texts[f.key] ?? "")} />
                ))}
              </div>
            </Card>
            <Card title="Ce que tu reçois" hint="Quand un créateur agit.">
              <div className="flex flex-col gap-3">
                {NOTIF_TEXTS_AGENCY.map((f) => (
                  <NotifTextRow key={f.key} field={f} value={texts[f.key] ?? ""} onChange={(v) => editText(f.key, v)} onSave={() => saveText(f.key, texts[f.key] ?? "")} />
                ))}
              </div>
            </Card>
          </>
        );
      case "compte":
        return (
          <Card anchor="Compte">
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-[13px] font-medium text-destructive transition-colors hover:bg-rowhover"
            >
              <LogOut className="h-3.5 w-3.5" /> Se déconnecter
            </button>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="@container/reglages">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="page-title text-[28px] font-bold leading-tight tracking-[-0.025em] text-foreground">Paramètres</h1>
        <div className="relative w-full @2xl/reglages:w-72">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter") {
                const h = bestHit(hits);
                if (h) openEntry(h.entry.id, h.section?.title);
              }
            }}
            placeholder="Chercher un réglage"
            aria-label="Chercher un réglage"
            className="h-9 w-full rounded-[10px] bg-field pl-8 pr-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche" className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-rowhover">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Résultats de la recherche : un clic ouvre l'onglet du réglage et défile jusqu'à lui. */}
      {query.trim() && (
        <nav aria-label="Résultats de la recherche" className="mb-6 flex flex-col gap-4">
          {groups.length === 0 && <p className="px-1 text-[13px] text-muted-foreground">Aucun réglage ne correspond.</p>}
          {groups.map((g) => (
            <div key={g.group}>
              <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{g.group}</div>
              <div className="flex flex-col overflow-hidden rounded-xl bg-surface">
                {g.hits.map(({ entry, section }) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEntry(entry.id, section?.title)}
                    className="relative flex min-h-[46px] w-full items-center gap-3 py-2 pl-3.5 pr-3 text-left transition-colors after:absolute after:bottom-0 after:left-[56px] after:right-0 after:h-px after:bg-border/70 last:after:hidden hover:bg-rowhover"
                  >
                    <EntryIcon entry={entry} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-foreground">{entry.label}</span>
                      {section && section.title !== entry.label && <span className="block truncate text-[12px] text-muted-foreground">{section.title}</span>}
                    </span>
                    <ChevronRight aria-hidden className="size-[18px] shrink-0 text-faint" strokeWidth={2.2} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}

      {/* Un onglet « dossier » par groupe (comme Agents) : ses entrées les unes sous les autres. */}
      <FolderTabs label="Rubriques des réglages" orderKey="parametres" items={TABS} value={tab} onValueChange={setTab} maxTabWidth={208}>
        <div className="@container mx-auto flex w-full max-w-3xl flex-col gap-10 py-1">
          {entriesOfTab(ENTRIES, tab).map((entry) => (
            <section key={entry.id} id={entryAnchor(entry.id)} aria-label={entry.label} className="scroll-mt-6">
              <div className="flex items-start gap-3">
                <EntryIcon entry={entry} />
                <div className="min-w-0">
                  <h2 className="text-[20px] font-bold leading-tight tracking-[-0.02em] text-foreground">{entry.label}</h2>
                  <p className="mt-1 text-[14px] leading-snug text-muted-foreground">{entry.hint}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-4">{paneFor(entry.id)}</div>
            </section>
          ))}
        </div>
      </FolderTabs>
    </div>
  );
}

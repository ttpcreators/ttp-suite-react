import {
  Smartphone,
  Laptop,
  ListChecks,
  BarChart3,
  Bell,
  Lightbulb,
  FileText,
  Target,
  TrendingUp,
  Image as ImageIcon,
  Files,
  Receipt,
  Gift,
  CalendarDays,
  Contact as ContactIcon,
  Share2,
  Check,
  ChevronRight,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { DashPanel, DashSectionTitle } from "@/components/ui/dash";
import { useT } from "@/lib/i18n";

/**
 * Page GUIDE de l'espace créateur : comment utiliser l'app (mobile + ordi),
 * et surtout le réflexe « je note mes tâches / mes demandes dans À faire ».
 * Sert de mode d'emploi pour couper court aux questions récurrentes.
 * Mise en page façon Aperçu : chapeau en texte simple, puis tableau de bord
 * 2 colonnes (l'essentiel à gauche, les réglages pratiques à droite).
 */

type Tab = string;

/** Ligne d'une liste à filets : icône grise + intitulé + texte. */
function InfoRow({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-foreground">{children}</span>;

/** Texte traduit avec des passages en gras balisés **ainsi** (l'ordre des mots change d'une langue à l'autre). */
function Rich({ text }: { text: string }) {
  return <>{text.split("**").map((part, i) => (i % 2 ? <B key={i}>{part}</B> : part))}</>;
}

const PAGES: { icon: LucideIcon; label: string; desc: string }[] = [
  { icon: BarChart3, label: "Accueil", desc: "Vue d'ensemble, envoi de tes stats et raccourcis rapides." },
  { icon: ListChecks, label: "À faire", desc: "Tes tâches, et tout ce que tu as besoin de demander à l'agence." },
  { icon: Lightbulb, label: "Idées", desc: "Note tes idées de contenu\u00A0: l'agence les voit et rebondit." },
  { icon: FileText, label: "Missions", desc: "Les campagnes des marques\u00A0: livrables, budget, script, PDF joint." },
  { icon: Target, label: "Ma feuille de route", desc: "Ta stratégie (niche, piliers, objectifs) et ta cadence du mois." },
  { icon: TrendingUp, label: "Évolution", desc: "Tes courbes d'abonnés et de taux d'engagement dans le temps." },
  { icon: ImageIcon, label: "Media kit", desc: "Ta page pro à partager aux marques, mise à jour par l'agence." },
  { icon: Files, label: "Documents", desc: "Tes fichiers\u00A0: factures, media kits, briefs, stats." },
  { icon: Receipt, label: "Gains", desc: "Tes factures et leur statut ; dépose une facture si besoin." },
  { icon: Gift, label: "Gifting", desc: "Le suivi des cadeaux et dotations reçus des marques." },
  { icon: CalendarDays, label: "Planning", desc: "Le calendrier partagé\u00A0: rendez-vous, échéances, tournages." },
  { icon: ContactIcon, label: "Contacts", desc: "Tes contacts de marques\u00A0: ajoute-les ici, ton agence les voit aussi." },
];

export function CreatorGuide({
  firstName,
  onGoto,
  onSendStats,
}: {
  firstName: string;
  onGoto: (tab: Tab) => void;
  onSendStats: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      {/* Chapeau (le titre « Guide » est déjà l'en-tête de page) */}
      <p className="-mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
        <Rich text={firstName ? t("Bienvenue {name}. Tout se fait ici, **sur mobile comme sur ordinateur**\u00A0: 2 minutes de lecture et tu es autonome.", { name: firstName }) : t("Bienvenue. Tout se fait ici, **sur mobile comme sur ordinateur**\u00A0: 2 minutes de lecture et tu es autonome.")} />
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* ── Colonne principale ── */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          {/* Le réflexe n°1 : les tâches */}
          <DashPanel className="p-5">
            <DashSectionTitle icon={ListChecks}>{t("Le réflexe le plus important")}</DashSectionTitle>
            <div className="text-[20px] font-semibold leading-tight tracking-tight text-foreground">{t("Note tout dans «\u00A0À faire\u00A0»")}</div>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              <Rich text={t("Dès que tu as **besoin de quelque chose de l'agence** (une facture, un contrat, une question, un contenu à valider, une info), **ajoute-le dans «\u00A0À faire\u00A0»** plutôt que par message.")} />
            </p>
            <ul className="mt-4 divide-y divide-border border-y border-border text-[13px] text-foreground">
              {["On le voit en direct, rien ne se perd.", "Tu suis l'avancement\u00A0: À faire, En cours, Fait.", "Tu peux découper en sous-tâches et joindre le contexte."].map((line) => (
                <li key={line} className="flex items-center gap-2.5 py-2.5">
                  <Check className="h-4 w-4 shrink-0 text-signaltext" /> <span>{t(line)}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => onGoto("todo")} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
              <ListChecks className="h-4 w-4" /> {t("Ouvrir «\u00A0À faire\u00A0»")}
            </button>
          </DashPanel>

          {/* Que trouves-tu dans chaque page : grille à filets */}
          <DashPanel>
            <div className="px-5 pt-5">
              <DashSectionTitle icon={Files}>{t("Ce que tu trouves dans chaque page")}</DashSectionTitle>
            </div>
            <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2">
              {PAGES.map((p) => (
                <div key={p.label} className="flex items-start gap-3 bg-surface px-5 py-3.5">
                  <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">{t(p.label)}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{t(p.desc)}</div>
                  </div>
                </div>
              ))}
            </div>
          </DashPanel>
        </div>

        {/* ── Colonne pratique ── */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <DashPanel className="px-5 pt-5">
            <DashSectionTitle icon={Smartphone}>{t("Installe l'app")}</DashSectionTitle>
            <div className="-mt-2 divide-y divide-border">
              <InfoRow icon={Smartphone} title="iPhone (Safari)">
                <Rich text={t("Bouton **Partager**, puis **Ajouter à l'écran d'accueil**. Ouvre-la ensuite depuis son icône\u00A0: **indispensable pour recevoir les notifications**.")} />
              </InfoRow>
              <InfoRow icon={Smartphone} title="Android (Chrome)">
                <Rich text={t("Menu **trois points** en haut à droite, puis **Installer l'application**. Elle s'ajoute comme une vraie app.")} />
              </InfoRow>
              <InfoRow icon={Laptop} title={t("Ordinateur")}>
                <Rich text={t("Va sur **app.ttpcreators.pro** et mets-la en favori. Le menu est à gauche, avec plus de place pour les graphiques.")} />
              </InfoRow>
            </div>
          </DashPanel>

          <DashPanel className="p-5">
            <DashSectionTitle icon={BarChart3}>{t("Tes stats, chaque début de mois")}</DashSectionTitle>
            <p className="-mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("C'est ce qui prouve ton audience aux marques. Le plus simple\u00A0:")}</p>
            <ol className="mt-3 flex flex-col gap-2.5">
              {[
                <Rich key="1" text={t("Ouvre l'app **Edits** d'Instagram.")} />,
                <Rich key="2" text={t("Onglet **Statistiques** (en bas à droite).")} />,
                <Rich key="3" text={t("Appuie sur **Partager** et envoie la capture depuis l'Accueil.")} />,
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-foreground">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={onSendStats} className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
              <Share2 className="h-4 w-4" /> {t("Envoyer mes stats")}
            </button>
          </DashPanel>

          <DashPanel className="p-5">
            <DashSectionTitle icon={Bell}>{t("Active les notifications")}</DashSectionTitle>
            <p className="-mt-1 text-[12px] leading-relaxed text-muted-foreground">
              <Rich text={t("Sur ton téléphone, ouvre l'app depuis son icône puis touche la **cloche** en haut, puis **Activer sur ce téléphone**. Tu es prévenue dès qu'un brief, un document ou un débrief arrive.")} />
            </p>
          </DashPanel>

          <DashPanel className="px-5 pt-5">
            <DashSectionTitle icon={Monitor}>{t("Mobile ou ordinateur\u00A0?")}</DashSectionTitle>
            <div className="-mt-2 divide-y divide-border">
              <InfoRow icon={Smartphone} title={t("Sur mobile")}>
                <Rich text={t("Le menu est **en bas**. Parfait au quotidien\u00A0: envoyer une stat, cocher une tâche, lire un brief.")} />
              </InfoRow>
              <InfoRow icon={Laptop} title={t("Sur ordinateur")}>
                <Rich text={t("Le menu est **à gauche**. Idéal pour voir les graphiques en grand et gérer plusieurs choses.")} />
              </InfoRow>
            </div>
          </DashPanel>
        </div>
      </div>

      {/* Rappel final */}
      <button type="button" onClick={() => onGoto("todo")} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-left transition-colors hover:bg-rowhover">
        <div>
          <div className="text-[13px] font-semibold text-foreground">{t("Une question\u00A0? Une demande\u00A0?")}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{t("Note-la dans «\u00A0À faire\u00A0»\u00A0: c'est le plus sûr pour qu'on te réponde vite.")}</div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-faint" />
      </button>
    </div>
  );
}

export default CreatorGuide;

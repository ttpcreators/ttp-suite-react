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
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
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

const PAGES: { icon: LucideIcon; label: string; desc: string }[] = [
  { icon: BarChart3, label: "Accueil", desc: "Vue d'ensemble, envoi de tes stats et raccourcis rapides." },
  { icon: ListChecks, label: "À faire", desc: "Tes tâches, et tout ce que tu as besoin de demander à l'agence." },
  { icon: Lightbulb, label: "Idées", desc: "Note tes idées de contenu : l'agence les voit et rebondit." },
  { icon: FileText, label: "Briefs", desc: "Les campagnes des marques : livrables, budget, script, PDF joint." },
  { icon: Target, label: "Ma feuille de route", desc: "Ta stratégie (niche, piliers, objectifs) et ta cadence du mois." },
  { icon: TrendingUp, label: "Évolution", desc: "Tes courbes d'abonnés et de taux d'engagement dans le temps." },
  { icon: ImageIcon, label: "Media kit", desc: "Ta page pro à partager aux marques, mise à jour par l'agence." },
  { icon: Files, label: "Documents", desc: "Tes fichiers : factures, media kits, briefs, stats." },
  { icon: Receipt, label: "Facturation", desc: "Tes factures et leur statut ; dépose une facture si besoin." },
  { icon: Gift, label: "Gifting", desc: "Le suivi des cadeaux et dotations reçus des marques." },
  { icon: CalendarDays, label: "Planning", desc: "Le calendrier partagé : rendez-vous, échéances, tournages." },
  { icon: ContactIcon, label: "Contacts", desc: "Les contacts utiles partagés par l'agence." },
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
  return (
    <div className="flex flex-col gap-4">
      {/* Chapeau (le titre « Guide » est déjà l'en-tête de page) */}
      <p className="-mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
        Bienvenue{firstName ? ` ${firstName}` : ""}. Tout se fait ici, <B>sur mobile comme sur ordinateur</B> : 2 minutes de lecture et tu es autonome.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* ── Colonne principale ── */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          {/* Le réflexe n°1 : les tâches */}
          <DashPanel className="p-5">
            <DashSectionTitle icon={ListChecks}>Le réflexe le plus important</DashSectionTitle>
            <div className="text-[20px] font-semibold leading-tight tracking-tight text-foreground">Note tout dans « À faire »</div>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              Dès que tu as <B>besoin de quelque chose de l'agence</B> (une facture, un contrat, une question, un contenu à valider, une info), <B>ajoute-le dans « À faire »</B> plutôt que par message.
            </p>
            <ul className="mt-4 divide-y divide-border border-y border-border text-[13px] text-foreground">
              {["On le voit en direct, rien ne se perd.", "Tu suis l'avancement : À faire, En cours, Fait.", "Tu peux découper en sous-tâches et joindre le contexte."].map((t) => (
                <li key={t} className="flex items-center gap-2.5 py-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" /> <span>{t}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => onGoto("todo")} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
              <ListChecks className="h-4 w-4" /> Ouvrir « À faire »
            </button>
          </DashPanel>

          {/* Que trouves-tu dans chaque page : grille à filets */}
          <DashPanel>
            <div className="px-5 pt-5">
              <DashSectionTitle icon={Files}>Ce que tu trouves dans chaque page</DashSectionTitle>
            </div>
            <div className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2">
              {PAGES.map((p) => (
                <div key={p.label} className="flex items-start gap-3 bg-surface px-5 py-3.5">
                  <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">{p.label}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </DashPanel>
        </div>

        {/* ── Colonne pratique ── */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <DashPanel className="px-5 pt-5">
            <DashSectionTitle icon={Smartphone}>Installe l'app</DashSectionTitle>
            <div className="-mt-2 divide-y divide-border">
              <InfoRow icon={Smartphone} title="iPhone (Safari)">
                Bouton <B>Partager</B>, puis <B>Ajouter à l'écran d'accueil</B>. Ouvre-la ensuite depuis son icône : <B>indispensable pour recevoir les notifications</B>.
              </InfoRow>
              <InfoRow icon={Smartphone} title="Android (Chrome)">
                Menu <B>trois points</B> en haut à droite, puis <B>Installer l'application</B>. Elle s'ajoute comme une vraie app.
              </InfoRow>
              <InfoRow icon={Laptop} title="Ordinateur">
                Va sur <B>app.ttpcreators.pro</B> et mets-la en favori. Le menu est à gauche, avec plus de place pour les graphiques.
              </InfoRow>
            </div>
          </DashPanel>

          <DashPanel className="p-5">
            <DashSectionTitle icon={BarChart3}>Tes stats, chaque début de mois</DashSectionTitle>
            <p className="-mt-1 text-[12px] leading-relaxed text-muted-foreground">C'est ce qui prouve ton audience aux marques. Le plus simple :</p>
            <ol className="mt-3 flex flex-col gap-2.5">
              {[
                <>Ouvre l'app <B>Edits</B> d'Instagram.</>,
                <>Onglet <B>Statistiques</B> (en bas à droite).</>,
                <>Appuie sur <B>Partager</B> et envoie la capture depuis l'Accueil.</>,
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-foreground">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={onSendStats} className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
              <Share2 className="h-4 w-4" /> Envoyer mes stats
            </button>
          </DashPanel>

          <DashPanel className="p-5">
            <DashSectionTitle icon={Bell}>Active les notifications</DashSectionTitle>
            <p className="-mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Sur ton téléphone, ouvre l'app depuis son icône puis touche la <B>cloche</B> en haut, puis <B>Activer sur ce téléphone</B>. Tu es prévenue dès qu'un brief, un document ou un débrief arrive.
            </p>
          </DashPanel>

          <DashPanel className="px-5 pt-5">
            <DashSectionTitle icon={Monitor}>Mobile ou ordinateur ?</DashSectionTitle>
            <div className="-mt-2 divide-y divide-border">
              <InfoRow icon={Smartphone} title="Sur mobile">
                Le menu est <B>en bas</B>. Parfait au quotidien : envoyer une stat, cocher une tâche, lire un brief.
              </InfoRow>
              <InfoRow icon={Laptop} title="Sur ordinateur">
                Le menu est <B>à gauche</B>. Idéal pour voir les graphiques en grand et gérer plusieurs choses.
              </InfoRow>
            </div>
          </DashPanel>
        </div>
      </div>

      {/* Rappel final */}
      <button type="button" onClick={() => onGoto("todo")} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-left transition-colors hover:bg-rowhover">
        <div>
          <div className="text-[13px] font-semibold text-foreground">Une question ? Une demande ?</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">Note-la dans « À faire » : c'est le plus sûr pour qu'on te réponde vite.</div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-faint" />
      </button>
    </div>
  );
}

export default CreatorGuide;

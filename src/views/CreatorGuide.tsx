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
  Sparkles,
  Check,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/**
 * Page GUIDE de l'espace créateur : comment utiliser l'app (mobile + ordi),
 * et surtout le réflexe « je note mes tâches / mes demandes dans À faire ».
 * Sert de mode d'emploi pour couper court aux questions récurrentes.
 */

type Tab = string;

function Section({ icon: Icon, title, children, accent = "text-primary" }: { icon: LucideIcon; title: string; children: React.ReactNode; accent?: string }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
          <Icon className={`h-[18px] w-[18px] ${accent}`} />
        </span>
        <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const PAGES: { icon: LucideIcon; label: string; desc: string }[] = [
  { icon: BarChart3, label: "Accueil", desc: "Vue d'ensemble, envoi de tes stats et raccourcis rapides." },
  { icon: ListChecks, label: "À faire", desc: "Tes tâches — et tout ce que tu as besoin de demander à l'agence." },
  { icon: Lightbulb, label: "Idées", desc: "Note tes idées de contenu ; l'agence les voit et rebondit." },
  { icon: FileText, label: "Briefs", desc: "Les campagnes (marques) : livrables, budget, script, PDF joint." },
  { icon: Target, label: "Ma feuille de route", desc: "Ta stratégie (niche, piliers, objectifs) + reporte ta cadence du mois." },
  { icon: TrendingUp, label: "Évolution", desc: "Tes courbes d'abonnés et de taux d'engagement dans le temps." },
  { icon: ImageIcon, label: "Media kit", desc: "Ta page pro à partager aux marques — mise à jour par l'agence." },
  { icon: Files, label: "Documents", desc: "Tes fichiers : factures, media kits, briefs, stats…" },
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
      {/* En-tête */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/12 via-primary/5 to-transparent p-5 shadow-sm">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Guide</div>
          <h1 className="mt-1 text-[22px] font-bold leading-tight text-foreground">Bienvenue{firstName ? ` ${firstName}` : ""} — voici comment utiliser ton espace</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Tout se fait ici, sur <span className="font-semibold text-foreground">mobile comme sur ordinateur</span>. 2 minutes de lecture et tu es autonome. 💪
          </p>
        </div>
      </div>

      {/* ⭐ Le réflexe n°1 : les tâches */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Sparkles className="h-4 w-4" /> Le réflexe le plus important
        </div>
        <h2 className="text-[16px] font-bold text-foreground">Note tout dans « À faire »</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
          Dès que tu as <span className="font-semibold">besoin de quelque chose de l'agence</span> — une facture, un contrat, une question, un contenu à valider, une info — <span className="font-semibold">ajoute-le dans « À faire »</span> plutôt que par message.
        </p>
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-foreground">
          {["On le voit en direct, rien ne se perd.", "Tu suis l'avancement (À faire → En cours → Fait).", "Tu peux découper en sous-tâches et joindre le contexte."].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> <span>{t}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onGoto("todo")} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90">
          <ListChecks className="h-4 w-4" /> Ouvrir « À faire »
        </button>
      </section>

      {/* Installer l'app */}
      <Section icon={Smartphone} title="Installe l'app sur ton téléphone">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-panel/40 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><Smartphone className="h-4 w-4 text-primary" /> iPhone (Safari)</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Bouton <span className="font-medium text-foreground">Partager</span> → <span className="font-medium text-foreground">Ajouter à l'écran d'accueil</span>. Ouvre-la ensuite depuis son icône — <span className="font-medium text-foreground">indispensable pour recevoir les notifications</span>.</p>
          </div>
          <div className="rounded-xl border border-border bg-panel/40 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><Smartphone className="h-4 w-4 text-primary" /> Android (Chrome)</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Menu <span className="font-medium text-foreground">⋮</span> → <span className="font-medium text-foreground">Installer l'application</span>. Elle s'ajoute comme une vraie app.</p>
          </div>
          <div className="rounded-xl border border-border bg-panel/40 p-3.5 sm:col-span-2">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><Laptop className="h-4 w-4 text-primary" /> Ordinateur</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Va sur <span className="font-medium text-foreground">app.ttpcreators.pro</span>, mets-la en favori. Le menu est à gauche, avec plus de place pour les graphiques.</p>
          </div>
        </div>
      </Section>

      {/* Envoyer ses stats */}
      <Section icon={BarChart3} title="Envoie tes stats chaque début de mois">
        <p className="text-[13px] leading-relaxed text-muted-foreground">C'est ce qui prouve ton audience aux marques. Le plus simple :</p>
        <ol className="mt-2.5 flex flex-col gap-2">
          {[
            <>Ouvre l'app <span className="font-semibold text-foreground">Edits</span> d'Instagram.</>,
            <>Onglet <span className="font-semibold text-foreground">Statistiques</span> (en bas à droite).</>,
            <>Appuie sur <span className="font-semibold text-foreground">Partager</span> → envoie la capture depuis l'Accueil.</>,
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] text-foreground">
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <button type="button" onClick={onSendStats} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/10">
          <Share2 className="h-4 w-4" /> Envoyer mes stats
        </button>
      </Section>

      {/* Notifications */}
      <Section icon={Bell} title="Active les notifications">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Sur ton téléphone, ouvre l'app depuis son icône puis touche la <span className="font-semibold text-foreground">cloche 🔔</span> en haut → <span className="font-semibold text-foreground">Activer sur ce téléphone</span>. Tu seras prévenue dès qu'un brief, un document ou un débrief arrive.
        </p>
      </Section>

      {/* Que trouves-tu dans chaque page */}
      <Section icon={Files} title="Ce que tu trouves dans chaque page">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {PAGES.map((p) => (
            <div key={p.label} className="flex items-start gap-3 rounded-xl border border-border bg-panel/40 p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface"><p.icon className="h-4 w-4 text-primary" /></span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-foreground">{p.label}</div>
                <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{p.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Mobile vs ordi */}
      <Section icon={Laptop} title="Mobile ou ordinateur ?">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-panel/40 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><Smartphone className="h-4 w-4 text-primary" /> Sur mobile</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Le menu est <span className="font-medium text-foreground">en bas</span>. Parfait au quotidien : envoyer une stat, cocher une tâche, lire un brief.</p>
          </div>
          <div className="rounded-xl border border-border bg-panel/40 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><Laptop className="h-4 w-4 text-primary" /> Sur ordinateur</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Le menu est <span className="font-medium text-foreground">à gauche</span>. Idéal pour voir les graphiques en grand et gérer plusieurs choses.</p>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <button type="button" onClick={() => onGoto("todo")} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-left shadow-sm transition-colors hover:bg-rowhover">
        <div>
          <div className="text-[13px] font-semibold text-foreground">Une question ? Une demande ?</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">Note-la dans « À faire » — c'est le plus sûr pour qu'on te réponde vite.</div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-faint" />
      </button>
    </div>
  );
}

export default CreatorGuide;

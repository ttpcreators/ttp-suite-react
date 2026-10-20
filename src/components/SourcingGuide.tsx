import { useState } from "react";
import { ArrowRight, BookOpen, Check, Lightbulb, ListChecks, MousePointerClick, Radar, Search, SlidersHorizontal, UserPlus, Users, X, Binoculars, ShieldCheck, Send, type LucideIcon } from "lucide-react";
import { Overlay } from "@/components/mobile/ios-sheet";
import { Tabs } from "@/components/ui/animated-tabs";
import { IconTile } from "@/components/ui/icon-tile";
import { Kbd } from "@/components/ui/kbd";
import type { StatusTone } from "@/lib/statusTone";
import { useIsPhone } from "@/lib/iosUi";

/**
 * Mode d'emploi du Sourcing : le déroulé de chaque outil en 3 étapes, le
 * vocabulaire, et comment travailler à plusieurs, en onglets. S'ouvre tout seul à la
 * première visite (Sourcing.tsx) tant que « Ne plus l'ouvrir automatiquement » n'est
 * pas coché, puis via le bouton « Mode d'emploi » ou la touche « ? ».
 */
export type GuideTool = "createurs" | "radar" | "concurrents";
type GuideTab = GuideTool | "vocabulaire" | "equipe";

type Step = { icon: LucideIcon; tone: StatusTone; title: string; text: string };
type Word = { term: string; text: string };

const WORDS: Record<string, Word> = {
  paye: { term: "Payé", text: "Le post dit #ad, publicité, collaboration commerciale, sponsorisé…" },
  offert: { term: "Offert ou code", text: "Produit offert, code promo ou réduction." },
  spontane: { term: "Spontané", text: "Aucun signe de partenariat : le créateur en parle de lui-même." },
  qui: { term: "Roster, Scouting, Hors agence", text: "Chez qui le radar a vu la marque : tes créateurs, ceux que tu suis, ou des inconnus (à recruter : « + Scouting »)." },
  confirmer: { term: "À confirmer", text: "L'app n'est pas sûre que ce compte soit une marque : vérifie avant d'écrire." },
  potentiel: { term: "Potentiel, Pépite", text: "Note sur 100 d'un créateur (engagement selon sa taille, rythme, partenariats, email, sans agence). Pépite = 70 et plus." },
  meta: { term: "Quota Meta", text: "Meta limite les demandes par heure. Au-delà de 80 %, l'app fait une pause ; ça redescend tout seul." },
  youtube: { term: "Quota YouTube", text: "Google offre 10 000 unités par jour : une recherche par thème ou par marque en coûte environ 150. Ça repart chaque jour." },
};

const TOOLS: Record<GuideTool, { steps: Step[]; tipLead: string; tip: string; words: (keyof typeof WORDS)[] }> = {
  createurs: {
    steps: [
      { icon: Search, tone: "progress", title: "Choisis le réseau et un point de départ.", text: "Instagram : une marque de ta niche (ses créateurs), un créateur que tu aimes (des profils proches), ou une liste de @. YouTube : un thème (« fitness lyon »), une marque, ou une liste de chaînes." },
      { icon: SlidersHorizontal, tone: "info", title: "Trie et filtre.", text: "Par score « Potentiel », abonnés, engagement, ville dans la bio, avec email, sans agence." },
      { icon: UserPlus, tone: "ok", title: "Agis.", text: "« Contacter » (mail depuis ta boîte Gmail, ou message Instagram) ou « + Scouting » pour le suivre plus tard." },
    ],
    tipLead: "Le bon réflexe :",
    tip: "ouvre toujours le profil avant d'écrire. Le score aide à trier, il ne remplace pas ton œil.",
    words: ["potentiel", "qui", "meta", "youtube"],
  },
  radar: {
    steps: [
      { icon: MousePointerClick, tone: "progress", title: "Choisis une tuile.", text: "« Clients potentiels » : la marque paie ou offre des produits à des créateurs. « Contacts chauds » : tes créateurs en parlent sans être payés." },
      { icon: ShieldCheck, tone: "info", title: "Vérifie.", text: "« Voir les preuves » montre les posts où la marque apparaît. Regarde que c'est bien un partenariat et que la marque colle à tes créateurs." },
      { icon: ListChecks, tone: "ok", title: "Décide.", text: "« + Pipeline » pour la suivre, « Contacter » pour écrire tout de suite, ou « Pas pertinent » pour la retirer." },
    ],
    tipLead: "Bon à savoir :",
    tip: "le radar tourne tout seul. Instagram : toutes les 2 heures. TikTok et YouTube : chaque matin. Le bloc « Vérification des marques » montre où il en est.",
    words: ["paye", "offert", "spontane", "qui"],
  },
  concurrents: {
    steps: [
      { icon: Binoculars, tone: "progress", title: "Ajoute une agence.", text: "Tape son @ Instagram, ou clique une agence repérée dans les bios des créateurs." },
      { icon: Radar, tone: "info", title: "Regarde.", text: "Sa croissance sur 7 et 30 jours (à côté de la tienne), les créateurs qu'elle met en avant et les marques qui la paient ou paient ses créateurs." },
      { icon: Send, tone: "ok", title: "Agis.", text: "« + Scouting » sur un créateur à suivre, « + Pipeline » sur une marque qui a déjà un budget influence." },
    ],
    tipLead: "Bon à savoir :",
    tip: "relu tout seul une fois par jour. La courbe des abonnés se dessine au fil des jours.",
    words: ["paye", "offert", "spontane", "qui"],
  },
};

const TABS: { value: GuideTab; label: string; short: string }[] = [
  { value: "createurs", label: "Trouver des créateurs", short: "Créateurs" },
  { value: "radar", label: "Radar à marques", short: "Radar" },
  { value: "concurrents", label: "Agences concurrentes", short: "Agences" },
  { value: "vocabulaire", label: "Vocabulaire", short: "Vocabulaire" },
  { value: "equipe", label: "En équipe", short: "En équipe" },
];

const TEAM = [
  { icon: Check, text: "Une marque ajoutée au Pipeline ou contactée disparaît des marques « à traiter » pour tout le monde." },
  { icon: Send, text: "Un créateur contacté est noté « contacté » dans le Scouting, avec la date." },
  { icon: Users, text: "Chaque ajout au Pipeline ou au Scouting apparaît dans « Activité », avec le nom de qui l'a fait." },
];

function WordCard({ w }: { w: Word }) {
  return (
    <div className="rounded-[16px] bg-panel p-4">
      <div className="text-[13px] font-semibold text-foreground">{w.term}</div>
      <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{w.text}</div>
    </div>
  );
}

export function SourcingGuide({ onClose, initial = "createurs" }: { onClose: (noAuto: boolean) => void; initial?: GuideTool }) {
  const [tab, setTab] = useState<GuideTab>(initial);
  const phone = useIsPhone();
  // Coché par défaut : comme avant, le guide ne s'ouvre tout seul qu'une fois.
  const [noAuto, setNoAuto] = useState(true);
  const close = () => onClose(noAuto);
  const idx = TABS.findIndex((t) => t.value === tab);
  const next = TABS[idx + 1];
  const tool = tab === "createurs" || tab === "radar" || tab === "concurrents" ? TOOLS[tab] : null;

  return (
    <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClose={close} label="Mode d'emploi du Sourcing">
      <div role="dialog" aria-label="Mode d'emploi du Sourcing" className="my-auto w-full max-w-[1000px] rounded-[28px] bg-surface p-5 shadow-xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          <IconTile tone="info" size="lg"><BookOpen /></IconTile>
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground sm:text-[28px]">Mode d'emploi du Sourcing</h2>
            <p className="mt-1 text-[14px] leading-snug text-muted-foreground">Trois outils, à partir d'Instagram, TikTok et YouTube. Tout ce que tu fais ici est partagé avec l'équipe.</p>
          </div>
          <button type="button" onClick={close} aria-label="Fermer" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover">
            <X className="h-4 w-4" />
          </button>
        </div>

        <Tabs
          className="mt-6"
          fullWidth
          label="Parties du mode d'emploi"
          value={tab}
          onValueChange={(v) => setTab(v as GuideTab)}
          items={TABS.map((t) => ({ value: t.value, label: phone ? t.short : t.label }))}
        />

        <div className="mt-6">
          {tool ? (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {tool.steps.map((s, i) => (
                  <section key={s.title} className="relative rounded-[20px] border border-border bg-surface p-5">
                    <IconTile tone={s.tone}><s.icon /></IconTile>
                    <span className="absolute right-5 top-5 grid h-7 w-7 place-items-center rounded-full bg-foreground text-[13px] font-bold tabular-nums text-background">{i + 1}</span>
                    <h3 className="mt-4 text-[18px] font-bold leading-tight text-foreground sm:text-[20px]">{s.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{s.text}</p>
                  </section>
                ))}
              </div>

              <div className="mt-4 flex gap-3 rounded-[16px] bg-info-soft px-4 py-3.5 text-[14px] leading-snug text-foreground">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <p>
                  <span className="font-semibold">{tool.tipLead}</span> {tool.tip}
                </p>
              </div>

              <div className="mt-6 flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-bold text-foreground">Les mots que tu vas croiser</h3>
                <button type="button" onClick={() => setTab("vocabulaire")} className="shrink-0 text-[13px] font-medium text-primary hover:underline">
                  Tout le vocabulaire
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {tool.words.map((k) => <WordCard key={k} w={WORDS[k]} />)}
              </div>
            </>
          ) : tab === "vocabulaire" ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(WORDS).map(([k, w]) => <WordCard key={k} w={w} />)}
            </div>
          ) : (
            <>
              <h3 className="text-[15px] font-bold text-foreground">À plusieurs, sans se marcher dessus</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                {TEAM.map((t, i) => (
                  <section key={t.text} className="rounded-[20px] border border-border bg-surface p-5">
                    <IconTile tone={(["progress", "info", "ok"] as const)[i]}><t.icon /></IconTile>
                    <p className="mt-4 text-[14px] leading-snug text-foreground">{t.text}</p>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-7 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" checked={noAuto} onChange={(e) => setNoAuto(e.target.checked)} className="h-4 w-4 accent-primary" />
            Ne plus l'ouvrir automatiquement
          </label>
          <span className="hidden items-center gap-1.5 text-[13px] text-muted-foreground md:flex">
            Rouvrir avec <Kbd>?</Kbd>
          </span>
          <button
            type="button"
            onClick={() => (next ? setTab(next.value) : close())}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:ml-auto"
          >
            {next ? (
              <>
                Suivant : {next.label} <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              "Compris"
            )}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

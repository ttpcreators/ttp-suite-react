import { Binoculars, BookOpen, Radar, Users, X, type LucideIcon } from "lucide-react";
import { Overlay } from "@/components/mobile/ios-sheet";

/**
 * Mode d'emploi du Sourcing : le déroulé de chaque outil en 3 étapes, le
 * vocabulaire, et comment travailler à plusieurs. S'ouvre tout seul à la
 * première visite (Sourcing.tsx), puis via le bouton « Mode d'emploi ».
 */
function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {items.map(([t, d], i) => (
        <li key={t} className="flex gap-2.5">
          <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground/[0.07] text-[11px] font-semibold tabular-nums text-foreground">{i + 1}</span>
          <span className="text-[13px] leading-snug text-muted-foreground"><span className="font-semibold text-foreground">{t}</span> {d}</span>
        </li>
      ))}
    </ol>
  );
}
function Word({ term, children }: { term: string; children: string }) {
  return (
    <div className="text-[12px] leading-snug">
      <div className="font-semibold text-foreground">{term}</div>
      <div className="mt-0.5 text-muted-foreground">{children}</div>
    </div>
  );
}
/** Carte d'un outil : même icône que sa tuile sur la page Sourcing. */
function Tool({ icon: Icon, title, goal, note, children }: { icon: LucideIcon; title: string; goal: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold leading-tight text-foreground">{title}</div>
          <div className="text-[12px] text-muted-foreground">{goal}</div>
        </div>
      </div>
      {children}
      <p className="mt-auto border-t border-border pt-3 text-[11.5px] leading-snug text-faint">{note}</p>
    </section>
  );
}

export function SourcingGuide({ onClose }: { onClose: () => void }) {
  return (
    <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClose={onClose} label="Mode d'emploi du Sourcing">
      <div className="my-auto w-full max-w-5xl rounded-2xl border border-border bg-surface p-5 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[18px] font-semibold tracking-tight text-foreground"><BookOpen className="h-5 w-5 text-muted-foreground" /> Mode d'emploi du Sourcing</div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-5 text-[13px] text-muted-foreground">Trois outils, à partir d'Instagram, TikTok et YouTube. Tout ce que tu fais ici est partagé avec l'équipe.</p>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Tool icon={Users} title="Trouver des créateurs" goal="Pour recruter" note="Ouvre toujours son profil (clic sur son nom) avant d'écrire : le score aide à trier, il ne remplace pas ton œil.">
            <div className="mb-3">
              <Steps items={[
                ["Choisis le réseau et un point de départ.", "Instagram : une marque de ta niche (ses créateurs), un créateur que tu aimes (des profils proches), ou une liste de @. YouTube : un thème (« fitness lyon »), une marque, ou une liste de chaînes."],
                ["Trie et filtre.", "Par score « Potentiel », abonnés, engagement, ville dans la bio, avec email, sans agence."],
                ["Agis.", "« Contacter » (mail depuis ta boîte Gmail, ou message Instagram) ou « + Scouting » pour le suivre plus tard."],
              ]} />
            </div>
          </Tool>
          <Tool icon={Radar} title="Radar à marques" goal="Pour trouver des clients" note="Le radar tourne tout seul. Instagram : toutes les 2 heures. TikTok et YouTube : chaque matin. Le bloc « Vérification des marques » montre où il en est.">
            <div className="mb-3">
              <Steps items={[
                ["Choisis une tuile.", "« Clients potentiels » : la marque paie ou offre des produits à des créateurs. « Contacts chauds » : tes créateurs en parlent sans être payés."],
                ["Vérifie.", "« Voir les preuves » montre les posts où la marque apparaît. Regarde que c'est bien un partenariat et que la marque colle à tes créateurs."],
                ["Décide.", "« + Pipeline » pour la suivre, « Contacter » pour écrire tout de suite, ou « Pas pertinent » pour la retirer."],
              ]} />
            </div>
          </Tool>
          <Tool icon={Binoculars} title="Agences concurrentes" goal="Pour garder une longueur d'avance" note="Relu tout seul une fois par jour. La courbe des abonnés se dessine au fil des jours.">
            <div className="mb-3">
              <Steps items={[
                ["Ajoute une agence.", "Tape son @ Instagram, ou clique une agence repérée dans les bios des créateurs."],
                ["Regarde.", "Sa croissance sur 7 et 30 jours (à côté de la tienne), les créateurs qu'elle met en avant et les marques qui la paient ou paient ses créateurs."],
                ["Agis.", "« + Scouting » sur un créateur à suivre, « + Pipeline » sur une marque qui a déjà un budget influence."],
              ]} />
            </div>
          </Tool>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl bg-panel/60 p-4">
          <div className="mb-2.5 text-[13px] font-semibold text-foreground">Le vocabulaire</div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Word term="Payé">Le post dit #ad, publicité, collaboration commerciale, sponsorisé…</Word>
            <Word term="Offert / code">Produit offert, code promo ou réduction.</Word>
            <Word term="Spontané">Aucun signe de partenariat : le créateur en parle de lui-même.</Word>
            <Word term="Roster · Scouting · Hors agence">Chez qui le radar a vu la marque : tes créateurs, ceux que tu suis, ou des inconnus (à recruter : « + Scouting »).</Word>
            <Word term="À confirmer">L'app n'est pas sûre que ce compte soit une marque : vérifie avant d'écrire.</Word>
            <Word term="Potentiel · Pépite">Note sur 100 d'un créateur (engagement selon sa taille, rythme, partenariats, email, sans agence). Pépite = 70 et plus.</Word>
            <Word term="Quota Meta">Meta limite les demandes par heure. Au-delà de 80 %, l'app fait une pause ; ça redescend tout seul.</Word>
            <Word term="Quota YouTube">Google offre 10 000 unités par jour : une recherche par thème ou par marque en coûte environ 150. Ça repart chaque jour.</Word>
          </div>
        </section>

        <section className="rounded-xl border border-border p-4">
          <div className="mb-2 text-[13px] font-semibold text-foreground">À plusieurs, sans se marcher dessus</div>
          <ul className="flex flex-col gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <li>• Une marque ajoutée au Pipeline ou contactée disparaît des marques « à traiter » pour tout le monde.</li>
            <li>• Un créateur contacté est noté « contacté » dans le Scouting, avec la date.</li>
            <li>• Chaque ajout au Pipeline ou au Scouting apparaît dans « Activité », avec le nom de qui l'a fait.</li>
          </ul>
        </section>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">C'est compris</button>
        </div>
      </div>
    </Overlay>
  );
}

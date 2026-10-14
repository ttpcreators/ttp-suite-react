import { BookOpen, X } from "lucide-react";
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
          <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span>
          <span className="text-[13px] leading-snug text-muted-foreground"><span className="font-semibold text-foreground">{t}</span> {d}</span>
        </li>
      ))}
    </ol>
  );
}
function Word({ term, children }: { term: string; children: string }) {
  return (
    <div className="flex gap-2 text-[12px] leading-snug">
      <span className="w-[8.5rem] shrink-0 font-semibold text-foreground">{term}</span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

export function SourcingGuide({ onClose }: { onClose: () => void }) {
  return (
    <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClose={onClose} label="Mode d'emploi du Sourcing">
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-border bg-surface p-5 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[17px] font-semibold text-foreground"><BookOpen className="h-5 w-5 text-primary" /> Mode d'emploi du Sourcing</div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-faint transition-colors hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-5 text-[13px] text-muted-foreground">Trois outils, à partir d'Instagram (comptes pro) et de YouTube. Tout ce que tu fais ici est partagé avec l'équipe.</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border p-4">
            <div className="mb-0.5 text-[14px] font-semibold text-foreground">Radar à marques</div>
            <div className="mb-3 text-[12px] text-primary">Pour trouver des clients</div>
            <Steps items={[
              ["Choisis une tuile.", "« Clients potentiels » : la marque paie ou offre des produits à des créatrices. « Contacts chauds » : tes créatrices en parlent sans être payées."],
              ["Vérifie.", "« Voir les preuves » montre les posts où la marque apparaît. Regarde que c'est bien un partenariat et que la marque colle à tes créatrices."],
              ["Décide.", "« + Pipeline » pour la suivre, « Contacter » pour écrire tout de suite, ou « Pas pertinent » pour la retirer."],
            ]} />
            <p className="mt-3 text-[11px] leading-snug text-faint">Le radar tourne tout seul toutes les 2 heures. Le bloc « Vérification des marques » montre où il en est.</p>
          </section>
          <section className="rounded-xl border border-border p-4">
            <div className="mb-0.5 text-[14px] font-semibold text-foreground">Trouver des créatrices</div>
            <div className="mb-3 text-[12px] text-primary">Pour recruter</div>
            <Steps items={[
              ["Choisis le réseau et un point de départ.", "Instagram : une marque de ta niche (ses créatrices), une créatrice que tu aimes (des profils proches), ou une liste de @. YouTube : un thème (« fitness lyon »), une marque, ou une liste de chaînes."],
              ["Trie et filtre.", "Par score « Potentiel », abonnés, engagement, ville dans la bio, avec email, sans agence."],
              ["Agis.", "« Contacter » (mail depuis ta boîte Gmail, ou message Instagram) ou « + Scouting » pour la suivre plus tard."],
            ]} />
            <p className="mt-3 text-[11px] leading-snug text-faint">Ouvre toujours son profil (clic sur son nom) avant d'écrire : le score aide à trier, il ne remplace pas ton œil.</p>
          </section>
          <section className="rounded-xl border border-border p-4 md:col-span-2">
            <div className="mb-0.5 text-[14px] font-semibold text-foreground">Agences concurrentes</div>
            <div className="mb-3 text-[12px] text-primary">Pour garder une longueur d'avance</div>
            <Steps items={[
              ["Ajoute une agence.", "Tape son @ Instagram, ou clique une agence repérée dans les bios des créatrices."],
              ["Regarde.", "Sa croissance sur 7 et 30 jours (à côté de la tienne), les créatrices qu'elle met en avant et les marques qui la paient ou paient ses créatrices."],
              ["Agis.", "« + Scouting » sur une créatrice à suivre, « + Pipeline » sur une marque qui a déjà un budget influence."],
            ]} />
            <p className="mt-3 text-[11px] leading-snug text-faint">Relu tout seul une fois par jour. La courbe des abonnés se dessine au fil des jours.</p>
          </section>
        </div>

        <section className="mt-4 rounded-xl bg-panel/60 p-4">
          <div className="mb-2.5 text-[13px] font-semibold text-foreground">Le vocabulaire</div>
          <div className="flex flex-col gap-1.5">
            <Word term="PAYÉ">Le post dit #ad, publicité, collaboration commerciale, sponsorisé…</Word>
            <Word term="OFFERT / CODE">Produit offert, code promo ou réduction.</Word>
            <Word term="SPONTANÉ">Aucun signe de partenariat : la créatrice en parle d'elle-même.</Word>
            <Word term="ROSTER · SCOUTING · HORS AGENCE">Chez qui le radar a vu la marque : tes créatrices, celles que tu suis, ou des inconnues (à recruter : « + Scouting »).</Word>
            <Word term="À confirmer">L'app n'est pas sûre que ce compte soit une marque : vérifie avant d'écrire.</Word>
            <Word term="Potentiel · Pépite">Note sur 100 d'une créatrice (engagement selon sa taille, rythme, partenariats, email, sans agence). Pépite = 70 et plus.</Word>
            <Word term="Quota Meta">Meta limite les demandes par heure. Au-delà de 80 %, l'app fait une pause ; ça redescend tout seul.</Word>
            <Word term="Quota YouTube">Google offre 10 000 unités par jour : une recherche par thème ou par marque en coûte environ 150. Ça repart chaque jour.</Word>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-border p-4">
          <div className="mb-2 text-[13px] font-semibold text-foreground">À plusieurs, sans se marcher dessus</div>
          <ul className="flex flex-col gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <li>• Une marque ajoutée au Pipeline ou contactée disparaît des marques « à traiter » pour tout le monde.</li>
            <li>• Une créatrice contactée est notée « contactée » dans le Scouting, avec la date.</li>
            <li>• Chaque ajout au Pipeline ou au Scouting apparaît dans « Activité », avec le nom de qui l'a fait.</li>
          </ul>
        </section>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">C'est compris</button>
        </div>
      </div>
    </Overlay>
  );
}

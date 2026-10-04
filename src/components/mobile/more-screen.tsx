import type { ReactNode } from "react";
import { LogOut, Moon, Smartphone, type LucideIcon } from "lucide-react";
import { IosGroup, IosRow, IosSwitch } from "@/components/mobile/ios-shell";
import { setIosUi } from "@/lib/iosUi";

/*
 * Écran « Plus » du mode iPhone (agence et créatrices) : profil, raccourcis,
 * toutes les pages groupées comme le menu ordinateur, puis le compte.
 * Même rendu que l'app Réglages d'iOS : listes groupées, pastilles d'icône, chevrons.
 */

export type MoreItem = { id: string; label: string; icon: LucideIcon; children?: { id: string; label: string }[] };
export type MoreSection = { id: string; label: string; items: MoreItem[] };

export function MoreScreen({
  profile, pinned, sections, onSelect, dark, onToggleTheme, exitLabel = "Se déconnecter", exitIcon = LogOut, onExit, before,
}: {
  /** Carte du haut (photo, nom, rôle) : `onClick` ouvre les paramètres. */
  profile: { avatar: ReactNode; name: ReactNode; sub: string; onClick?: () => void };
  pinned?: MoreItem[];
  sections: MoreSection[];
  onSelect: (id: string, sub?: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
  exitLabel?: string;
  exitIcon?: LucideIcon;
  onExit: () => void;
  /** Contenu ajouté sous le profil (ex. recherche). */
  before?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-7 pb-4">
      <IosGroup>
        <IosRow
          label=""
          leading={
            <span className="flex min-w-0 flex-1 items-center gap-3 py-1">
              {profile.avatar}
              <span className="min-w-0">
                <span className="block truncate text-[19px] font-semibold leading-tight text-foreground">{profile.name}</span>
                <span className="block truncate text-[0.9375rem] text-muted-foreground">{profile.sub}</span>
              </span>
            </span>
          }
          onClick={profile.onClick}
        />
      </IosGroup>

      {before}

      {pinned && pinned.length > 0 && (
        <IosGroup title="Raccourcis">
          {pinned.map((it) => (
            <IosRow key={`pin-${it.id}`} icon={it.icon} label={it.label} onClick={() => onSelect(it.id)} />
          ))}
        </IosGroup>
      )}

      {sections.map((sec) => (
        <IosGroup key={sec.id} title={sec.label}>
          {sec.items.flatMap((it) => [
            <IosRow key={it.id} icon={it.icon} label={it.label} onClick={() => onSelect(it.id)} />,
            ...(it.children ?? []).map((c) => (
              <IosRow key={`${it.id}-${c.id}`} label={c.label} indent onClick={() => onSelect(it.id, c.id)} />
            )),
          ])}
        </IosGroup>
      ))}

      <IosGroup title="Affichage" footer="Propre à cet appareil. Coupe le mode iPhone pour revenir à l'ancien affichage.">
        <IosRow icon={Moon} label="Mode sombre" chevron={false} right={<IosSwitch label="Mode sombre" checked={dark} onChange={onToggleTheme} />} />
        <IosRow icon={Smartphone} label="Mode iPhone" chevron={false} right={<IosSwitch label="Mode iPhone" checked onChange={() => setIosUi(false)} />} />
      </IosGroup>

      <IosGroup>
        <IosRow icon={exitIcon} label={exitLabel} destructive chevron={false} onClick={onExit} />
      </IosGroup>
    </div>
  );
}

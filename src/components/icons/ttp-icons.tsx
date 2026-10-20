import { forwardRef, type ReactNode, type SVGProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Icônes TTP Suite (dessinées pour l'app, validées par Marc le 2026-10-20, d'après
 * l'iconographie BlackYak) : un seul motif signature, le TOIT, repris en tête des
 * icônes ; trait de 1,5 sur une grille de 24, bouts carrés, angles vifs, presque
 * aucune courbe. Planche de référence : https://claude.ai/artifact/NuiafK6ahQgrEi7BzT64vi
 *
 * Même interface que lucide (className, size, strokeWidth) et même classe `lucide` :
 * le style commun d'index.css (épaisseur, bouts carrés) s'applique aussi à elles.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; absoluteStrokeWidth?: boolean };

function make(name: string, paths: ReactNode): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({ className, size = 24, strokeWidth = 1.5, absoluteStrokeWidth: _abs, ...rest }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
        aria-hidden="true"
        className={cn("lucide", className)}
        {...rest}
      >
        {paths}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon as unknown as LucideIcon;
}

// ── Favoris ──────────────────────────────────────────────────────────────────
export const TtpToday = make("TtpToday", <><path d="M4 10 L12 4.5 L20 10 V20 H4 Z" /><path d="M8 17 A4 4 0 0 1 16 17" /><path d="M6.5 17 H17.5" /></>);
export const TtpHome = make("TtpHome", <><path d="M4 10 L12 4.5 L20 10 V20 H4 Z" /><path d="M10 20 V15 H14 V20" /></>);
export const TtpTodo = make("TtpTodo", <><path d="M6 7.5 L12 3.5 L18 7.5 V21 H6 Z" /><path d="M9 12.5 L11 14.5 L15 10.5" /><path d="M9 18 H15" /></>);
export const TtpMail = make("TtpMail", <><path d="M3 9 L12 3.5 L21 9 V20 H3 Z" /><path d="M3 9 L12 14.5 L21 9" /></>);
export const TtpMessages = make("TtpMessages", <><path d="M3.5 9.5 L12 4 L20.5 9.5 V17 H14.5 L12 20 L9.5 17 H3.5 Z" /><path d="M8.5 12 H9.5 M11.5 12 H12.5 M14.5 12 H15.5" /></>);
export const TtpCollabs = make("TtpCollabs", <><path d="M2.5 11 L8.5 7 L14.5 11 V19 H2.5 Z" /><path d="M9.5 9 L15.5 5 L21.5 9 V17 H14.5" /></>);
export const TtpPlanning = make("TtpPlanning", <><path d="M3.5 9 L12 4 L20.5 9 V20.5 H3.5 Z" /><path d="M3.5 11.5 H20.5" /><path d="M7.5 15 H8.5 M11.5 15 H12.5 M15.5 15 H16.5 M7.5 18 H8.5 M11.5 18 H12.5" /></>);
export const TtpStar = make("TtpStar", <path d="M12 3.5 L14.5 9.3 L20.5 9.6 L15.8 13.5 L17.4 19.8 L12 16.4 L6.6 19.8 L8.2 13.5 L3.5 9.6 L9.5 9.3 Z" />);

// ── Talents ──────────────────────────────────────────────────────────────────
export const TtpPerson = make("TtpPerson", <><path d="M9 4.5 H15 V10.5 H9 Z" /><path d="M4.5 20.5 V17 L12 13 L19.5 17 V20.5 Z" /></>);
export const TtpScouting = make("TtpScouting", <><path d="M7 4.5 H12.5 V10 H7 Z" /><path d="M3 20.5 V17 L9.75 13.5 L14 15.7 V20.5 Z" /><path d="M18.5 9 V15 M15.5 12 H21.5" /></>);
export const TtpEngagement = make("TtpEngagement", <path d="M12 20 L4 12 V7.5 L8 4 L12 8 L16 4 L20 7.5 V12 Z" />);
export const TtpEvolution = make("TtpEvolution", <><path d="M3 17 L8.5 11.5 L12.5 15 L20 7.5" /><path d="M15 7.5 H20 V12.5" /></>);
export const TtpMediakit = make("TtpMediakit", <><path d="M3 5 H21 V19 H3 Z" /><path d="M3 17 L9 11 L14 16 L17 13 L21 17" /><path d="M15 8 H17 V10 H15 Z" /></>);
export const TtpTag = make("TtpTag", <><path d="M3 12 L9 5 H21 V19 H9 Z" /><path d="M9.5 11 H11.5 V13 H9.5 Z" /></>);

// ── Prospection ──────────────────────────────────────────────────────────────
export const TtpContacts = make("TtpContacts", <><path d="M4 7 L12 3 L20 7 V21 H4 Z" /><path d="M10 9 H14 V13 H10 Z" /><path d="M7.5 18 L12 15.5 L16.5 18" /></>);
export const TtpSourcing = make("TtpSourcing", <><path d="M4 9.5 L10.5 5 L17 9.5 V16 H4 Z" /><path d="M14.5 16 L20.5 21" /><path d="M8 11.5 H13" /></>);
export const TtpSend = make("TtpSend", <><path d="M3 11 L21 4 L15 20 L11 13 Z" /><path d="M11 13 L21 4" /></>);
export const TtpPipeline = make("TtpPipeline", <path d="M3 5 H21 L14 13 V20 L10 18 V13 Z" />);
export const TtpDm = make("TtpDm", <><path d="M4 4 H20 V16 H11 L7 20 V16 H4 Z" /><path d="M10 8 H14 V12 H10 Z" /></>);

// ── Collaborations ───────────────────────────────────────────────────────────
export const TtpBrief = make("TtpBrief", <><path d="M6 7.5 L12 3.5 L18 7.5 V21 H6 Z" /><path d="M9 11 H15 M9 14 H15 M9 17 H13" /></>);
export const TtpContract = make("TtpContract", <><path d="M5 3 H15 L19 7 V21 H5 Z" /><path d="M15 3 V7 H19" /><path d="M8 17 L10 15 L12 17 L14 15 L16 17" /></>);
export const TtpDeadline = make("TtpDeadline", <><path d="M6 3 H18 M6 21 H18" /><path d="M7 3 V7 L12 12 L17 7 V3" /><path d="M7 21 V17 L12 12 L17 17 V21" /></>);
export const TtpGift = make("TtpGift", <><path d="M4 10 H20 V20 H4 Z" /><path d="M3 7 H21 V10 H3 Z" /><path d="M12 7 V20" /><path d="M12 7 L8.5 3.5 M12 7 L15.5 3.5" /></>);
export const TtpReport = make("TtpReport", <><path d="M5 3 H19 V21 H5 Z" /><path d="M9 17 V13 M12 17 V9.5 M15 17 V14" /></>);
export const TtpIdea = make("TtpIdea", <><path d="M7 10 L12 4 L17 10 V14 L15 16 H9 L7 14 Z" /><path d="M9.5 19 H14.5 M10.5 21.5 H13.5" /></>);
export const TtpMission = make("TtpMission", <><path d="M5 21 V3.5" /><path d="M5 4 H18 L15 8 L18 12 H5" /></>);

// ── Finance ──────────────────────────────────────────────────────────────────
export const TtpInvoice = make("TtpInvoice", <><path d="M5 7.5 L12 3.5 L19 7.5 V20.5 L16.7 19 L14.4 20.5 L12 19 L9.6 20.5 L7.3 19 L5 20.5 Z" /><path d="M8.5 11 H15.5 M8.5 14.5 H13" /></>);
export const TtpBell = make("TtpBell", <><path d="M6 17 V11 L12 5.5 L18 11 V17" /><path d="M4 17 H20" /><path d="M10 20 H14" /></>);
export const TtpTransfer = make("TtpTransfer", <><path d="M4 8 H19 M15.5 4.5 L19 8 L15.5 11.5" /><path d="M20 16 H5 M8.5 12.5 L5 16 L8.5 19.5" /></>);
export const TtpGains = make("TtpGains", <><path d="M3 7 H21 V17 H3 Z" /><path d="M12 9.5 L14.5 12 L12 14.5 L9.5 12 Z" /></>);
export const TtpStats = make("TtpStats", <><path d="M3.5 20.5 H20.5" /><path d="M6 20.5 V14 L8 12.5 L10 14 V20.5" /><path d="M14 20.5 V8 L16 6.5 L18 8 V20.5" /><path d="M10 20.5 V10.5 L12 9 L14 10.5" /></>);
export const TtpTarget = make("TtpTarget", <><path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z" /><path d="M12 8 L16 12 L12 16 L8 12 Z" /></>);
export const TtpRoad = make("TtpRoad", <><path d="M4 20.5 L9 3.5 M20 20.5 L15 3.5" /><path d="M12 6 V8 M12 11 V13 M12 16 V18" /></>);

// ── Intelligence, ressources, réglages ───────────────────────────────────────
export const TtpSpark = make("TtpSpark", <path d="M12 3 L13.8 10.2 L21 12 L13.8 13.8 L12 21 L10.2 13.8 L3 12 L10.2 10.2 Z" />);
export const TtpHistory = make("TtpHistory", <><path d="M8 3.5 H16 L20.5 8 V16 L16 20.5 H8 L3.5 16 V8 Z" /><path d="M12 7.5 V12 H15.5" /></>);
export const TtpFiles = make("TtpFiles", <><path d="M8 3 H20 V17 H8 Z" /><path d="M4 7 V21 H16" /></>);
export const TtpTemplate = make("TtpTemplate", <><path d="M3 4 H21 V20 H3 Z" /><path d="M3 9 H21 M10 9 V20" /></>);
export const TtpChecklist = make("TtpChecklist", <><path d="M4 4 H20 V20 H4 Z" /><path d="M8 12 L11 15 L16 9" /></>);
export const TtpLock = make("TtpLock", <><path d="M6.5 11 V7.5 L12 3.5 L17.5 7.5 V11" /><path d="M4 11 H20 V21 H4 Z" /><path d="M12 14.5 V17.5" /></>);
export const TtpSliders = make("TtpSliders", <><path d="M4 7 H20 M4 12 H20 M4 17 H20" /><path d="M8 5 V9 M15 10 V14 M10 15 V19" /></>);
export const TtpPulse = make("TtpPulse", <path d="M3 12 H7 L9 7 L13 17 L15 12 H21" />);
export const TtpGuide = make("TtpGuide", <><path d="M3 5 L12 7 L21 5 V19 L12 21 L3 19 Z" /><path d="M12 7 V21" /></>);
export const TtpFolder = make("TtpFolder", <path d="M3 5 H10 L12 7.5 H21 V20 H3 Z" />);

// ── Barres et outils ─────────────────────────────────────────────────────────
export const TtpSearch = make("TtpSearch", <><path d="M10.5 4 A6.5 6.5 0 1 1 10.5 17 A6.5 6.5 0 1 1 10.5 4 Z" /><path d="M15.5 15.5 L21 21" /></>);
export const TtpTrash = make("TtpTrash", <><path d="M4 6 H20" /><path d="M9 6 V3.5 H15 V6" /><path d="M6 6 L7 21 H17 L18 6" /><path d="M10 10 V17 M14 10 V17" /></>);
export const TtpMore = make("TtpMore", <path d="M4 6 H20 M4 12 H20 M4 18 H20" />);

// ── Dans les pages (lignes, tuiles, actions) ─────────────────────────────────
export const TtpPhone = make("TtpPhone", <path d="M5 3 H9 L10.5 7.5 L8 9.5 L14.5 16 L16.5 13.5 L21 15 V19 L19 21 Q9 21 3 11 V5 Z" />);
export const TtpClock = make("TtpClock", <><path d="M8 3.5 H16 L20.5 8 V16 L16 20.5 H8 L3.5 16 V8 Z" /><path d="M12 7.5 V12 L15 14" /></>);
export const TtpProgress = make("TtpProgress", <><path d="M4 10 L12 4.5 L20 10 V20 H4 Z" strokeDasharray="2.2 2.2" /><path d="M10 13 H14 V17 H10 Z" /></>);
export const TtpRepeat = make("TtpRepeat", <><path d="M4 10.5 V7 H17 M14 4 L17 7 L14 10" /><path d="M20 13.5 V17 H7 M10 20 L7 17 L10 14" /></>);
export const TtpPackage = make("TtpPackage", <><path d="M3 9 L12 4 L21 9 V20 H3 Z" /><path d="M3 9 H21" /><path d="M10 12.5 H14" /></>);
export const TtpTrophy = make("TtpTrophy", <><path d="M7 4 H17 V9 L12 14 L7 9 Z" /><path d="M12 14 V18 M8 20.5 H16" /><path d="M7 6 H4 V8 L7 10.5 M17 6 H20 V8 L17 10.5" /></>);
export const TtpNote = make("TtpNote", <><path d="M5 3 H19 V15 L13 21 H5 Z" /><path d="M13 21 V15 H19" /><path d="M8 8 H16 M8 11 H13" /></>);
export const TtpAlert = make("TtpAlert", <><path d="M12 4 L21 20 H3 Z" /><path d="M12 10 V14 M12 16.5 V17" /></>);
export const TtpCamera = make("TtpCamera", <><path d="M3 8 H8 L10 5 H14 L16 8 H21 V19 H3 Z" /><path d="M12 10 L15 13 L12 16 L9 13 Z" /></>);
export const TtpBuilding = make("TtpBuilding", <><path d="M5 21 V8 L12 3 L19 8 V21 Z" /><path d="M9 11 H10 M14 11 H15 M9 14.5 H10 M14 14.5 H15" /><path d="M11 21 V18 H13 V21" /></>);

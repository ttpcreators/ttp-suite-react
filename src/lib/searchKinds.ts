import { Users, Contact, ListChecks, Receipt, FileText, Search as SearchIcon, type LucideIcon } from "lucide-react";
import type { SearchHit } from "./useGlobalSearch";
import type { ViewId } from "./nav";

/** Résultat de recherche globale : icône, libellé et page qui l'ouvre (recherche + palette ⌘K). */
export const KIND_META: Record<SearchHit["kind"], { icon: LucideIcon; label: string; view: ViewId | null }> = {
  creator: { icon: Users, label: "Créateur", view: null },
  contact: { icon: Contact, label: "Contact", view: "contacts" },
  todo: { icon: ListChecks, label: "À faire", view: "todo" },
  invoice: { icon: Receipt, label: "Facture", view: "facturation" },
  brief: { icon: FileText, label: "Brief", view: "briefs" },
  prospect: { icon: SearchIcon, label: "Prospect", view: "prospection" },
};

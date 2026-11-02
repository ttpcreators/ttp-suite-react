import { useState } from "react";
import { RefreshCw } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";

/** Message affiché selon la réponse de la fonction mediakit-publish. */
export function publishMessage(res: { ok?: boolean; already?: boolean; error?: string } | null): string {
  if (res?.ok && res.already) return "Publication déjà en cours : le site sera à jour dans quelques minutes";
  if (res?.ok) return "Publication lancée : en ligne dans 3 à 4 minutes ✓";
  if (res?.error === "not_configured" || res?.error === "token_refused") return "Publication pas encore branchée à GitHub (jeton manquant ou refusé)";
  return "Publication impossible, réessaie dans un instant";
}

/**
 * « Publier maintenant » : relance tout de suite la génération des pages media kit et
 * des PDF sur ttpcreators.pro, sans attendre le passage automatique de l'heure.
 * À utiliser après « Enregistrer ».
 */
export function PublishSiteButton({ className, disabled }: { className: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const publish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mediakit-publish", { body: {} });
      let res = data as { ok?: boolean; already?: boolean; error?: string } | null;
      // Réponse en erreur (502, 503…) : le détail est dans le corps.
      if (error && "context" in error && error.context instanceof Response) {
        res = await error.context.json().catch(() => null);
      }
      toast(publishMessage(res));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={publish}
      disabled={busy || disabled}
      title="Met à jour le site et le PDF tout de suite (sinon, automatiquement dans l'heure)"
      className={className}
    >
      <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> <span>{busy ? "Publication…" : "Publier maintenant"}</span>
    </button>
  );
}

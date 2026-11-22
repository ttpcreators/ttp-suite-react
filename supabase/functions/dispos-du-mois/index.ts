// ============================================================================
// dispos-du-mois/index.ts : la sélection « Dispos de <mois> » prête le 1er du mois.
// ----------------------------------------------------------------------------
// Appelée par pg_cron le 1er de chaque mois (SQL 2026-11-22-dispos-du-mois.sql) : crée ou
// met à jour la liste du mois en cours dans Base créateurs › Listes, lien public activé
// (même travail que le bouton de l'app et l'outil Claude `dispos_du_mois`, logique dans
// _shared/disposDuMoisDb.ts). Alfred n'a plus qu'à lire le lien pour préparer les messages
// aux agences. N'envoie aucun message.
//
// AUTH : verify_jwt = false (config.toml) + Bearer CRON_SECRET (comme agent-watchdog).
// ============================================================================

import { getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { moisCourant } from "../_shared/disposDuMois.ts";
import { genererDisposDuMois } from "../_shared/disposDuMoisDb.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || !timingSafeEqualStr(bearer, CRON_SECRET)) return json({ error: "unauthorized" }, 401);

  const now = new Date();
  const r = await genererDisposDuMois(getServiceClient(), moisCourant(now), now);
  if (!r.ok) return json({ error: r.error }, 500);
  return json({
    ok: true, titre: r.titre, url: r.url, cree: r.cree, sansDispos: r.sansDispos,
    createurs: r.resultat.selection.creators.length, notes: r.resultat.notes,
  });
});

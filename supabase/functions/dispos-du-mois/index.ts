// ============================================================================
// dispos-du-mois/index.ts : la sélection « Dispos de <mois> » prête le 1er du mois.
// ----------------------------------------------------------------------------
// Appelée par pg_cron le 1er de chaque mois (SQL 2026-11-22-dispos-du-mois.sql) : crée ou
// met à jour la liste du mois en cours dans Base créateurs › Listes, lien public activé
// (même travail que le bouton de l'app et l'outil Claude `dispos_du_mois`, logique dans
// _shared/disposDuMoisDb.ts). Alfred n'a plus qu'à lire le lien pour préparer les messages
// aux agences. N'envoie aucun message.
// Les points à vérifier avant l'envoi (exclusivités « à confirmer », créateurs sans prix) vont
// aussi dans une tâche de l'agence (`tacheDispos`) : la réponse du cron n'est lue par personne.
//
// AUTH : verify_jwt = false (config.toml) + Bearer CRON_SECRET (comme agent-watchdog).
// ============================================================================

import { getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { moisCourant, tacheDispos } from "../_shared/disposDuMois.ts";
import { genererDisposDuMois } from "../_shared/disposDuMoisDb.ts";
import { texteSur } from "../_shared/texteSur.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const jourParis = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d);

type Sb = ReturnType<typeof getServiceClient>;

/** Une seule tâche ouverte par liste : relancée, la fonction met à jour ses détails. */
async function noterTache(sb: Sb, t: { titre: string; details: string }, url: string, now: Date): Promise<boolean> {
  const details = texteSur(t.details);
  const { data: open, error: e0 } = await sb.from("todos").select("id").eq("text", t.titre).eq("done", false).limit(1);
  if (e0) {
    console.error("dispos-du-mois tâche", e0.message);
    return false;
  }
  const cur = ((open as { id: string }[] | null) ?? [])[0];
  if (cur) {
    const { error } = await sb.from("todos").update({ descr: details }).eq("id", cur.id);
    if (error) console.error("dispos-du-mois tâche", error.message);
    return !error;
  }
  const row: Record<string, unknown> = {
    text: t.titre, descr: details, due: jourParis(now), priority: "haute", tag: "AGENCE", creator: null,
    source: "agency", status: "À faire", done: false, attachments: [{ name: "Voir la liste", size: "", path: url }],
  };
  let { error } = await sb.from("todos").insert(row);
  if (error && /attachments/i.test(error.message)) {
    delete row.attachments;
    ({ error } = await sb.from("todos").insert(row));
  }
  if (error) console.error("dispos-du-mois tâche", error.message);
  return !error;
}

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || !timingSafeEqualStr(bearer, CRON_SECRET)) return json({ error: "unauthorized" }, 401);

  const now = new Date();
  const sb = getServiceClient();
  const r = await genererDisposDuMois(sb, moisCourant(now), now);
  if (!r.ok) return json({ error: r.error }, 500);
  const t = tacheDispos(r.resultat, r.url);
  const tache = t ? await noterTache(sb, t, r.url, now) : false;
  return json({
    ok: true, titre: r.titre, url: r.url, cree: r.cree, sansDispos: r.sansDispos,
    createurs: r.resultat.selection.creators.length, notes: r.resultat.notes, tache,
  });
});

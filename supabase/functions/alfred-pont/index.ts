// ============================================================================
// alfred-pont/index.ts : le pont entre l'iMac d'Alfred et TTP Suite (demande de Marc,
// 17 novembre 2026). L'iMac n'a pas les clés de la base : il passe par ici, avec son secret.
// ----------------------------------------------------------------------------
// POST, Authorization: Bearer ALFRED_PONT_SECRET, corps JSON :
//   { action: "pouls", commandes?: { texte, maj_le } }
//       → { evenements, demandes, reglages, commandes, etait_hors_ligne, skills?, skills_version }
//       (skills : les skills faites pour Marc, hors du dépôt public, table agent.skills_privees,
//        envoyées seulement quand leur version change : body.skills_version)
//       l'iMac est vu maintenant ; les nouvelles de l'app et les demandes en attente lui
//       sont remises (et marquées remises) ; il reçoit ses réglages et ses commandes.
//   { action: "vivant" }                  → signe de vie pendant un passage
//   { action: "passage", passage }        → fin d'un passage d'Alfred (point du matin…)
//   { action: "reponse", demandes, texte } → la réponse d'Alfred à des demandes de l'app
//   { action: "deposer", nom, contenu }   → un fichier de l'iMac (PDF d'un contrat, pièce reçue sur
//       Telegram) rangé dans le stockage « documents » sous alfred/, pour le joindre à un mail
//       (creer_brouillon_mail, pieces_jointes : { document }) ; 10 Mo au plus
// AUTH : verify_jwt = false (config.toml) + secret ALFRED_PONT_SECRET (aussi dans config.env de l'iMac),
// ou, sans ce secret, « tg:<empreinte SHA-256 du jeton du bot d'Alfred> » : l'iMac a déjà ce jeton
// (ALFRED_BOT_TOKEN), le même est posé côté Supabase ; le jeton lui-même ne circule jamais.
// ============================================================================

import { getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { commandesGagnantes, reglagesPropres } from "../_shared/alfredPont.ts";
import { nomPropre, tailleBase64, typeAccepte, typeDuNom } from "../_shared/piecesJointes.ts";

const SECRET = Deno.env.get("ALFRED_PONT_SECRET") ?? "";
const BOT = Deno.env.get("ALFRED_BOT_TOKEN") ?? "";

async function empreinte(texte: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const parSecret = !!SECRET && timingSafeEqualStr(bearer, SECRET);
  const parBot = !!BOT && bearer.startsWith("tg:") && timingSafeEqualStr(bearer, `tg:${await empreinte(BOT)}`);
  if (!parSecret && !parBot) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, any>;

  const db = getServiceClient().schema("agent");
  const { data: ag } = await db.from("agents").select("id, reglages, vu_le, hors_ligne_alerte_le").or("slug.eq.talent-manager,nom.ilike.Alfred").limit(1);
  const alfred = ((ag as Record<string, any>[] | null) ?? [])[0];
  if (!alfred) return json({ error: "agent_introuvable" }, 404);
  const maintenant = new Date().toISOString();

  // Signe de vie pendant un passage (l'écoute de l'iMac attend la fin d'Alfred).
  if (body.action === "vivant") {
    await db.from("agents").update({ vu_le: maintenant }).eq("id", alfred.id);
    return json({ ok: true });
  }

  if (body.action === "passage") {
    await db.from("agents").update({ vu_le: maintenant, passage: String(body.passage ?? "").slice(0, 80), passage_le: maintenant }).eq("id", alfred.id);
    return json({ ok: true });
  }

  if (body.action === "reponse") {
    const ids = (Array.isArray(body.demandes) ? body.demandes : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 20);
    if (!ids.length) return json({ ok: true, n: 0 });
    const { error } = await db.from("demandes").update({ statut: "repondue", reponse: String(body.texte ?? "").slice(0, 8000) || "(réponse envoyée sur Telegram)", repondu_le: maintenant }).in("id", ids);
    return error ? json({ error: error.message }, 500) : json({ ok: true, n: ids.length });
  }

  if (body.action === "deposer") {
    const nom = nomPropre(String(body.nom ?? ""));
    const type = typeDuNom(nom);
    const contenu = String(body.contenu ?? "");
    if (!type || !typeAccepte(type)) return json({ error: "type" }, 400);
    if (!contenu || tailleBase64(contenu) > 10 * 1024 * 1024) return json({ error: "taille" }, 400);
    const octets = Uint8Array.from(atob(contenu), (c) => c.charCodeAt(0));
    const path = `alfred/${maintenant.slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}-${nom.replace(/[^A-Za-z0-9._ -]/g, "_")}`;
    const { error } = await getServiceClient().storage.from("documents").upload(path, octets, { contentType: type, upsert: false });
    return error ? json({ error: error.message }, 500) : json({ ok: true, path, nom });
  }

  if (body.action !== "pouls") return json({ error: "action" }, 400);

  // Revenu après une alerte « hors ligne » : l'iMac le dira à Marc.
  const etaitHorsLigne = !!alfred.hors_ligne_alerte_le && (!alfred.vu_le || Date.parse(alfred.hors_ligne_alerte_le) > Date.parse(alfred.vu_le));

  // Les commandes « / » : la plus récente des deux gagne, et l'app garde la dernière.
  // Réglages d'Alfred (colonne reglages, page Agents) : { heures, sonner, commandes: { texte, maj_le } }.
  const reglages = (alfred.reglages && typeof alfred.reglages === "object" && !Array.isArray(alfred.reglages) ? alfred.reglages : {}) as Record<string, any>;
  const cmd = commandesGagnantes(body.commandes, reglages.commandes);
  const nouveaux = cmd.source === "imac" && cmd.texte !== reglages.commandes?.texte ? { ...reglages, commandes: { texte: cmd.texte, maj_le: cmd.maj_le } } : null;
  await db.from("agents").update({ vu_le: maintenant, ...(nouveaux ? { reglages: nouveaux } : {}) }).eq("id", alfred.id);

  // Les nouvelles de l'app et les demandes : remises une seule fois.
  // Une lecture refusée n'est plus jamais silencieuse (droits manquants découverts le 22/11) :
  // l'erreur part dans la réponse, l'iMac la note et la signale.
  const erreurs: string[] = [];
  const { data: ev, error: eEv } = await db.from("evenements").select("id, type, cible, detail, lien, auteur, cree_le").is("livre_le", null).order("cree_le").limit(50);
  if (eEv) erreurs.push(`evenements : ${eEv.message}`);
  const evenements = (ev as Record<string, any>[] | null) ?? [];
  if (evenements.length) await db.from("evenements").update({ livre_le: maintenant }).in("id", evenements.map((e) => e.id));
  const { data: dm, error: eDm } = await db.from("demandes").select("id, texte, contexte, lien, auteur, cree_le").eq("statut", "nouvelle").order("cree_le").limit(10);
  if (eDm) erreurs.push(`demandes : ${eDm.message}`);
  const demandes = (dm as Record<string, any>[] | null) ?? [];
  if (demandes.length) await db.from("demandes").update({ statut: "recue", recue_le: maintenant }).in("id", demandes.map((d) => d.id));

  // Les skills privées (hooks-viraux, structure-script, conseil) : seulement si elles ont changé.
  const { data: sk, error: eSk } = await db.from("skills_privees").select("nom, fichiers, maj_le").order("nom");
  if (eSk) erreurs.push(`skills_privees : ${eSk.message}`);
  if (erreurs.length) console.error(`alfred-pont : ${erreurs.join(" ; ")}`);
  const skills = (sk as { nom: string; fichiers: Record<string, string>; maj_le: string }[] | null) ?? [];
  const skillsVersion = skills.map((x) => `${x.nom}@${x.maj_le}`).join(",");

  return json({
    ...(skills.length && skillsVersion !== String(body.skills_version ?? "") ? { skills: skills.map(({ nom, fichiers }) => ({ nom, fichiers })) } : {}),
    skills_version: skillsVersion,
    evenements,
    demandes,
    reglages: reglagesPropres(reglages),
    commandes: cmd.source === "app" ? cmd : null,
    etait_hors_ligne: etaitHorsLigne,
    ...(erreurs.length ? { erreurs } : {}),
  });
});

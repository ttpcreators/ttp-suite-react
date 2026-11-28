// ============================================================================
// ttp-mcp/autonomie.ts : outils de prospection autonome pour Alfred et Claude
// (plan « MCP TTP autonomie », demandé par Marc le 2026-11-24).
// ----------------------------------------------------------------------------
//   importer_historique_instagram : tout l'historique des DM de @ttpcreators, par tranches
//      reprenables (_shared/igHistoriqueDb.ts, aussi action « backfill » de ig-inbox, que la
//      tâche planifiée ig-historique-import lance toutes les 3 minutes jusqu'à la fin) ;
//   lire_profil_instagram / lire_profils_instagram : profils lus par Business Discovery,
//      agence détectée, Base créateurs mise à jour (_shared/profilInstagramDb.ts) ;
//   scanner_base_createurs : relit la Base par lots (jamais lus, ou lus il y a plus de 30 j) ;
//   trouver_emails_marque : les bonnes personnes chez une marque (FullEnrich, recherche de
//      personnes) ;
//   trouver_email_personne : l'e-mail pro d'une personne (FullEnrich).
//      Ces deux outils dépensent des crédits FullEnrich : write (accord demandé avant chaque appel).
//      Hunter est mis de côté depuis le 24/11/2026 : son code reste en sommeil (sans la clé
//      HUNTER_API_KEY, il n'appelle rien), ne pas créer de compte.
//   lire_site_marque : l'adresse de contact écrite sur le site d'une marque (gratuit).
//   dm_sans_reponse : les conversations Instagram où notre dernier message est resté sans
//      réponse, avec ce qu'on sait déjà pour reprendre le contact par e-mail.
// Rien n'est écrit dans les contacts : l'outil propose, puis Claude appelle ajouter_contact.
// ============================================================================

import type { AdminTool } from "./admin.ts";
import { etatHistorique, trancheHistorique } from "../_shared/igHistoriqueDb.ts";
import { lireProfils, scannerBase, RELIRE_APRES_JOURS, type Lecture } from "../_shared/profilInstagramDb.ts";
import { MAX_LOT, compteDe, preparerComptes, raisonEchec, texteProfil as texteProfilBrut } from "../_shared/profilInstagram.ts";
import { externeLigne } from "../_shared/contenuExterne.ts";

/** Le profil lu, la bio (écrite par le titulaire du compte) rendue comme une donnée, jamais une consigne. */
const texteProfil = (r: Parameters<typeof texteProfilBrut>[0]) =>
  texteProfilBrut(r.bio ? { ...r, bio: externeLigne("bio Instagram", r.bio.replace(/\s+/g, " ").slice(0, 250)) } : r);
import { tidySecret } from "../_shared/instagram.ts";
import { CLE_MANQUANTE, HUNTER_API, cibles, domaineDe, erreurHunter, limiteDeLOffre, lignePersonne, lireEmailTrouve, lireRecherche, lireVerification, paramsRecherche, statutEmail, type PersonneHunter } from "../_shared/hunter.ts";
import { classerPersonnes, coutRecherche, enrichContact, lignePersonneFE, parsePeople, searchBody } from "../_shared/fullenrich.ts";
import { FULLENRICH_KEY, enrichir, fe, result as resultatFullEnrich, why, type EnrichResult } from "../_shared/fullenrichApi.ts";
import { MAX_OCTETS, adresseSite, domaineDuSite, emailsDuSite, ligneEmailSite, pagesALire, reseauxDuSite } from "../_shared/siteMarque.ts";
import { cleCompte, decompte, ligneSansReponse, sansReponse, type FilDm, type ProfilDm, type TypeDemande } from "../_shared/dmSansReponse.ts";
import { LIBELLES, etatRecrut, lireSuivi, noterMessage, texteSuivi, type Canal, type EtatRecrut } from "../_shared/recrutementSuivi.ts";
import { readAppState } from "../_shared/appState.ts";
import { PLAFONDS } from "../_shared/quotaMeta.ts";
import { str } from "../_shared/texteSur.ts";
import { prouveAdresse } from "../_shared/mailRecu.ts";

type Json = Record<string, unknown>;
const ok = (text: string) => ({ text });
const fail = (text: string) => ({ text, isError: true });
const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};
const fr = (n: number) => n.toLocaleString("fr-FR");
/** Temps laissé aux appels Meta : les fonctions sont coupées à 150 s. */
const BUDGET_MS = 100_000;
const SQL_BASE = "⚠ Le SQL 2026-11-24-base-createurs-profils.sql n'est pas encore lancé : agence, agence_nom et date de lecture sont gardés dans les données du profil (data), pas encore dans leurs colonnes.";

// ── 1. Historique des DM ────────────────────────────────────────────────────
const importerHistorique: AdminTool = {
  name: "importer_historique_instagram",
  title: "Importer l'historique des DM Instagram",
  description:
    `L'historique des conversations Instagram de @ttpcreators (environ 3 000) dans la page DM de TTP Suite : pour chaque conversation, le @ et l'id Instagram de la personne, son nom, la date du premier et du dernier message, qui a parlé en dernier et les 20 derniers messages (limite Meta). Il est déjà importé en entier (tâche planifiée ig-historique-import, qui s'arrête seule à la fin) ; les nouvelles conversations arrivent par la synchro ig-inbox. etat_seulement = voir l'état, sans appeler Meta. Un appel sans option relance une tranche si l'import n'est pas fini (1 à 6 pages de 25 conversations, pas de doublon), sinon montre l'état ; arrêt propre si Meta limite (heure de reprise donnée) ou à ${PLAFONDS.import} % du quota. recommencer relit tout depuis le début (des heures d'appels Meta, sur le quota partagé) : seulement sur demande explicite de Marc ou de Gianni. Fondateurs.`,
  inputSchema: {
    type: "object",
    properties: {
      pages: { type: "integer", minimum: 1, maximum: 6, description: "Pages de 25 conversations dans cette tranche (défaut 2)" },
      recommencer: { type: "boolean", description: "Repartir du début : relit tout (des heures d'appels Meta, sur le quota partagé). Seulement sur demande explicite de Marc ou de Gianni" },
      etat_seulement: { type: "boolean", description: "Seulement l'état de l'import, sans appeler Meta" },
    },
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    if (a.etat_seulement === true) {
      const r = await etatHistorique(sb);
      return r.ok ? ok(r.texte) : fail(r.texte);
    }
    const r = await trancheHistorique(sb, { pages: int(a.pages, 2, 1, 6), recommencer: a.recommencer === true, budgetMs: BUDGET_MS });
    return r.ok ? ok(r.texte) : fail(r.texte);
  },
};

// ── 2. Profils Instagram ────────────────────────────────────────────────────
function texteLecture(l: Lecture, enregistrer: boolean, entete: string[]): string {
  const lus = l.profils.filter((p) => p.ok);
  const rates = l.profils.filter((p) => !p.ok);
  const enreg = lus.filter((p) => p.ok && p.enregistre).length;
  return [
    ...entete,
    `${fr(lus.length)} profil(s) lu(s)${enregistrer ? `, ${fr(enreg)} mis à jour dans la Base créateurs` : " (Base non modifiée)"}${rates.length ? `, ${fr(rates.length)} non lisible(s)` : ""}${l.restants.length ? `, ${fr(l.restants.length)} pas lu(s)` : ""}.`,
    ...lus.map((p) => (p.ok ? texteProfil(p.resume) : "")),
    ...(rates.length ? ["## Non lus", ...rates.map((p) => `- @${p.username} : ${p.ok ? "" : raisonEchec(p.why)}`)] : []),
    l.restants.length ? `## Pas lus cette fois (${l.arret ? raisonEchec(l.arret) : "à relancer"})\n${l.restants.map((u) => `@${u}`).join(" ")}` : "",
    l.sansColonnes ? SQL_BASE : "",
    ...l.erreursEcriture.slice(0, 5).map((e) => `⚠ Écriture : ${e}`),
    l.quota && typeof l.quota.appPct === "number" ? `Quota Meta utilisé : ${Math.round(Math.max(Number(l.quota.appPct) || 0, Number(l.quota.bucPct) || 0))} %.` : "",
  ].filter(Boolean).join("\n");
}

const lireProfil: AdminTool = {
  name: "lire_profil_instagram",
  title: "Lire un profil Instagram",
  description:
    "Lit un compte Instagram PROFESSIONNEL (créateur ou entreprise) via Business Discovery de Meta : abonnés, nombre de posts, bio, lien du site, e-mail trouvé dans la bio, engagement moyen des derniers posts (formule de l'app), date du dernier post, et agence détectée (oui, non ou à vérifier, avec son nom). Met à jour la fiche dans la Base créateurs (enregistrer = false pour ne rien écrire). Un compte personnel, privé ou introuvable ne peut pas être lu (limite de Meta).",
  inputSchema: {
    type: "object",
    properties: {
      compte: { type: "string", description: "@ ou lien du profil Instagram" },
      enregistrer: { type: "boolean", description: "Mettre à jour la Base créateurs (défaut : oui)" },
    },
    required: ["compte"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const u = compteDe(str(a.compte, 200));
    if (!u) return fail(`@ illisible : « ${str(a.compte, 60)} ».`);
    const l = await lireProfils(sb, [u], { enregistrer: a.enregistrer !== false, budgetMs: BUDGET_MS });
    const p = l.profils[0];
    if (!p) return fail(`@${u} pas lu : ${raisonEchec(l.arret ?? "reseau")}.`);
    if (!p.ok) return p.why === "retire" ? ok(`@${u} : ${raisonEchec("retire")}.`) : fail(`@${u} : ${raisonEchec(p.why)}.`);
    return ok([
      `# Profil Instagram @${u}`,
      texteProfil(p.resume),
      a.enregistrer === false ? "Base créateurs non modifiée." : p.enregistre ? "Base créateurs mise à jour." : "⚠ Base créateurs PAS mise à jour.",
      l.sansColonnes ? SQL_BASE : "",
      ...l.erreursEcriture.slice(0, 2).map((e) => `⚠ ${e}`),
    ].filter(Boolean).join("\n"));
  },
};

const lireProfilsLot: AdminTool = {
  name: "lire_profils_instagram",
  title: "Lire des profils Instagram par lots",
  description:
    `Comme lire_profil_instagram, pour une liste de 1 à ${MAX_LOT} comptes en un appel (3 lus à la fois). Les comptes personnels, privés ou introuvables sont listés à part. Si Meta approche de sa limite (${PLAFONDS.profils} % du quota) ou si le temps manque, les comptes pas lus sont rendus : relancer avec eux. Met à jour la Base créateurs (enregistrer = false pour ne rien écrire).`,
  inputSchema: {
    type: "object",
    properties: {
      comptes: { type: "array", items: { type: "string" }, maxItems: MAX_LOT, description: `@ ou liens, ${MAX_LOT} au plus` },
      enregistrer: { type: "boolean", description: "Mettre à jour la Base créateurs (défaut : oui)" },
    },
    required: ["comptes"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const list = Array.isArray(a.comptes) ? a.comptes : [];
    const { comptes, illisibles, enTrop } = preparerComptes(list);
    if (!comptes.length) return fail("Aucun @ lisible dans la liste.");
    const enregistrer = a.enregistrer !== false;
    const l = await lireProfils(sb, comptes, { enregistrer, budgetMs: BUDGET_MS });
    return ok(texteLecture(l, enregistrer, [
      `# Profils Instagram · ${fr(comptes.length)} demandé(s)`,
      illisibles.length ? `@ illisibles ignorés : ${illisibles.join(", ")}` : "",
      enTrop ? `⚠ ${enTrop} compte(s) au-delà de ${MAX_LOT} ignoré(s) : les envoyer dans un autre appel.` : "",
    ]));
  },
};

const scannerBaseTool: AdminTool = {
  name: "scanner_base_createurs",
  title: "Scanner la Base créateurs",
  description:
    `Relit par lots les profils de la Base créateurs jamais lus par lire_profil_instagram, puis ceux lus il y a plus de ${RELIRE_APRES_JOURS} jours (les plus anciens d'abord ; pas les marques ni YouTube ; pas les créateurs retirés de la Base). Met à jour abonnés, bio, e-mail, site, engagement, dernier post et agence. Reprenable : ce qui est lu sort de la file, relancer pour le lot suivant ; s'arrête à ${PLAFONDS.profils} % du quota Meta. Fondateurs.`,
  inputSchema: {
    type: "object",
    properties: { lot: { type: "integer", minimum: 1, maximum: 100, description: "Profils à lire dans ce lot (défaut 40)" } },
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const s = await scannerBase(sb, int(a.lot, 40, 1, 100), BUDGET_MS);
    if (s.error) return fail(`Base illisible : ${s.error}`);
    if (!s.lecture) return ok(`# Scan de la Base créateurs\nRien à lire : tous les profils ont été lus il y a moins de ${RELIRE_APRES_JOURS} jours.${s.sansColonnes ? `\n${SQL_BASE}` : ""}`);
    const lus = s.lecture.profils.length;
    const reste = s.restantsAvant != null ? Math.max(0, s.restantsAvant - lus) : null;
    return ok(texteLecture(s.lecture, true, [
      `# Scan de la Base créateurs`,
      reste != null ? `Il reste environ ${fr(reste)} profil(s) à lire (jamais lus ou lus il y a plus de ${RELIRE_APRES_JOURS} jours). Relancer pour le lot suivant.` : "",
    ]));
  },
};

// ── 3. E-mails pro des marques ──────────────────────────────────────────────
const hunterKey = () => tidySecret(Deno.env.get("HUNTER_API_KEY"));

async function hunter(path: string, key: string): Promise<{ status: number; body: Json }> {
  try {
    const r = await fetch(`${HUNTER_API}${path}`, { headers: { "X-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Json };
  } catch {
    return { status: 0, body: {} };
  }
}

const RAISON_FE: Record<string, string> = {
  reseau: "FullEnrich ne répond pas, réessayer dans une minute",
  cle_invalide: "clé FullEnrich refusée (secret FULLENRICH_API_KEY à vérifier)",
  credits_insuffisants: "crédits FullEnrich épuisés pour ce mois",
  limite: "trop de demandes à FullEnrich d'un coup, réessayer dans une minute",
};
const raisonFE = (code: string) => RAISON_FE[code] ?? `FullEnrich a répondu une erreur (${code})`;

/** Les bonnes personnes chez une marque, par la recherche de personnes FullEnrich. */
async function marqueParFullEnrich(a: Record<string, unknown>) {
  const domaine = domaineDe(str(a.domaine, 200)) || domaineDe(str(a.marque, 200));
  const marque = str(a.marque, 120);
  if (!domaine && !marque) return fail("Donne le domaine du site de la marque (ex. marque.fr) ou son nom.");
  const company = domaine || marque;
  const max = int(a.max, 5, 1, 10);
  const titles = str(a.postes, 400).split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const country = str(a.pays, 60) || undefined;
  const chercher = (allTitles: boolean, limit: number) => fe("/people/search", { method: "POST", body: JSON.stringify(searchBody({ company, titles, country, limit, allTitles })) });

  const r = await chercher(a.tous_les_postes === true, max);
  if (r.status !== 200) return fail(`Rien n'a été cherché : ${raisonFE(why(r.status, r.body))}.`);
  let res = parsePeople(r.body);
  let cout = coutRecherche(res.people.length, res.credits);
  let elargi = false;
  // Personne avec un poste marketing ou influence : on regarde tous les postes, 5 personnes au plus.
  if (!res.people.length && a.tous_les_postes !== true) {
    const r2 = await chercher(true, Math.min(max, 5));
    if (r2.status === 200) {
      res = parsePeople(r2.body);
      cout += coutRecherche(res.people.length, res.credits);
      elargi = true;
    }
  }
  const { toutes, cibles: dansLaCible } = classerPersonnes(res.people);
  const solde = await fe("/account/credits");
  const restants = solde.status === 200 && Number.isFinite(Number(solde.body.balance)) ? Number(solde.body.balance) : null;
  const nom = toutes.find((p) => p.company)?.company || marque || domaine;
  return ok([
    `# Personnes à contacter · ${nom}${domaine ? ` (${domaine})` : ""}`,
    !domaine ? `Recherche par le nom « ${marque} », sans le site : vérifier que les personnes travaillent bien pour cette marque.` : "",
    toutes.length
      ? `${fr(toutes.length)} personne(s)${res.total > toutes.length ? ` sur ${fr(res.total)} connue(s) de FullEnrich` : ""}${country ? `, ${country}` : ""}${elargi ? ", recherche élargie à tous les postes" : ""}. ${fr(dansLaCible.length)} avec un poste dans la cible, les plus utiles en premier.`
      : `FullEnrich ne connaît personne chez ${nom}${country ? ` (${country})` : ""}${elargi ? ", même sans filtre de poste" : ""}. Essayer avec le domaine exact du site, sans le pays, ou chercher l'adresse partenariats ou presse du site (lire_site_marque).`,
    ...toutes.map(lignePersonneFE),
    toutes.length ? "Pour l'e-mail d'une personne : trouver_email_personne (prenom, nom, domaine, ou son lien LinkedIn) : 1 crédit seulement si l'e-mail est trouvé." : "",
    `Coût de cette recherche : ${fr(cout)} crédit(s) FullEnrich.${restants === null ? "" : ` Crédits restants : ${fr(restants)}.`}`,
    restants !== null && restants < 25 ? "⚠ Presque plus de crédits FullEnrich ce mois-ci : garder les adresses générales des marques pour la suite." : "",
    "Rien n'a été enregistré. Pour garder une personne : ajouter_contact (marque, personne, role, email, linkedin, ville).",
  ].filter(Boolean).join("\n"));
}

const trouverEmailsMarque: AdminTool = {
  name: "trouver_emails_marque",
  title: "Trouver les personnes à contacter chez une marque",
  description:
    "Trouve chez une marque les personnes à contacter (influence, partenariats, relations presse, social media, marketing), classées de la plus utile à la moins utile, avec leur poste, leur ville et leur LinkedIn. Coûte des crédits FullEnrich (abonnement de l'agence, 500 par mois) : 0,25 crédit par personne trouvée, donc 5 personnes par défaut. Annoncer le coût et attendre l'accord ; seulement pour une marque prioritaire, après lire_site_marque (gratuit). Donner le domaine du site (ex. marque.fr) de préférence, sinon le nom de la marque. La recherche ne donne PAS l'e-mail : pour la ou les personnes retenues, appeler ensuite trouver_email_personne (1 crédit seulement si l'e-mail est trouvé). Le solde de crédits est affiché à la fin. N'enregistre rien dans l'app : pour garder une personne, appeler ajouter_contact.",
  inputSchema: {
    type: "object",
    properties: {
      domaine: { type: "string", description: "Domaine ou site de la marque (ex. marque.fr)" },
      marque: { type: "string", description: "Nom de la marque, si le domaine est inconnu" },
      max: { type: "integer", minimum: 1, maximum: 50, description: "Personnes demandées (défaut 5, 10 au plus avec FullEnrich : chaque personne trouvée coûte 0,25 crédit)" },
      postes: { type: "string", description: "Postes cherchés, séparés par des virgules (défaut : influence, partenariat, marketing, communication, relations presse, social media, brand manager)" },
      pays: { type: "string", description: "Ne garder que les personnes dans ce pays (ex. France). Vide : tous les pays" },
      tous_les_postes: { type: "boolean", description: "Chercher sans filtre de poste (petite marque où personne n'a un titre marketing)" },
    },
    additionalProperties: false,
  },
  // Dépense des crédits FullEnrich à chaque appel : jamais annoncé « lecture seule » (accord demandé).
  write: true,
  founder: true,
  run: async (_sb, _c, a) => {
    // FullEnrich seulement (abonnement de l'agence, décision du 24/11/2026 : pas de Hunter).
    if (FULLENRICH_KEY) return await marqueParFullEnrich(a);
    // Hunter en sommeil : il ne sert que si une clé HUNTER_API_KEY existe encore.
    const key = hunterKey();
    if (!key) return fail("FullEnrich non configuré (secret FULLENRICH_API_KEY) : rien n'a été cherché.");
    const domaine = domaineDe(str(a.domaine, 200)) || domaineDe(str(a.marque, 200));
    const marque = str(a.marque, 120);
    if (!domaine && !marque) return fail("Donne le domaine du site de la marque (ex. marque.fr) ou son nom.");
    const max = int(a.max, 10, 1, 50);
    let r = await hunter(`/domain-search?${paramsRecherche({ domaine, marque, limite: max })}`, key);
    // Offre gratuite : 10 résultats au plus par appel.
    if (limiteDeLOffre(r.status, r.body) && max > 10) r = await hunter(`/domain-search?${paramsRecherche({ domaine, marque, limite: 10 })}`, key);
    if (r.status !== 200) return fail(erreurHunter(r.status, r.body));
    let res = lireRecherche(r.body);
    if (!res.domaine) return fail(`Hunter ne trouve pas le site de « ${marque || domaine} ». Donne le domaine exact du site de la marque (ex. marque.fr).`);
    let elargi = false;
    // Personne dans les départements marketing / communication : on regarde tous les postes.
    if (!res.personnes.length) {
      const r2 = await hunter(`/domain-search?${paramsRecherche({ domaine: res.domaine, limite: Math.min(max, 10), departements: false })}`, key);
      if (r2.status === 200) {
        res = lireRecherche(r2.body);
        elargi = true;
      }
    }
    let list: PersonneHunter[] = a.tous_les_postes === true ? res.personnes : cibles(res.personnes);
    const verifs: string[] = [];
    if (a.verifier === true) {
      const aVerifier = list.filter((p) => p.statut !== "valid" && p.statut !== "invalid").slice(0, 5);
      for (const p of aVerifier) {
        const v = await hunter(`/email-verifier?email=${encodeURIComponent(p.email)}`, key);
        if (v.status === 200) p.statut = lireVerification(v.body) || p.statut;
        else {
          verifs.push(erreurHunter(v.status, v.body));
          break;
        }
      }
      list = list.filter((p) => p.statut !== "invalid" && p.statut !== "disposable");
    }
    const autres = res.personnes.length - list.length;
    return ok([
      `# E-mails pro · ${res.organisation || marque || res.domaine} (${res.domaine})`,
      !domaine ? `Domaine trouvé par Hunter à partir du nom « ${marque} » : ${res.domaine}. À confirmer avant d'écrire.` : "",
      `${fr(list.length)} personne(s) ${a.tous_les_postes === true ? "" : "marketing, influence, RP ou partenariats "}sur ${fr(res.personnes.length)} reçue(s)${res.total > res.personnes.length ? ` (Hunter en connaît ${fr(res.total)} : max pour en voir plus)` : ""}${elargi ? ", recherche élargie à tous les services" : ""}.`,
      ...list.map((p) => lignePersonne(p, res.acceptAll)),
      !list.length ? (autres > 0 ? `Aucun poste marketing, influence, RP ou partenariats parmi les ${autres} trouvée(s) : tous_les_postes = true pour les voir.` : "Hunter ne connaît personne à ce domaine. Essayer trouver_email_personne avec un nom trouvé sur LinkedIn.") : "",
      res.motif ? `Format habituel des adresses : ${res.motif}@${res.domaine}.` : "",
      ...verifs.map((v) => `⚠ Vérification arrêtée : ${v}`),
      "Rien n'a été enregistré. Pour garder une personne : ajouter_contact (marque, personne, role, email, linkedin, ville).",
    ].filter(Boolean).join("\n"));
  },
};

const STATUT_FE: Record<string, string> = {
  DELIVERABLE: "vérifiée (FullEnrich : délivrable)",
  HIGH_PROBABILITY: "très probable (FullEnrich)",
  CATCH_ALL: "non garantie : le domaine accepte toutes les adresses (FullEnrich)",
};

function texteFullEnrich(r: EnrichResult, qui: string): { texte: string; trouve: boolean; attente: string | null } {
  if ("error" in r) return { texte: `FullEnrich : ${r.error === "credits_insuffisants" ? "crédits épuisés" : r.error === "cle_invalide" ? "clé refusée" : `échec (${r.error})`}.`, trouve: false, attente: null };
  if ("pending" in r) return { texte: `FullEnrich cherche encore l'e-mail de ${qui}.`, trouve: false, attente: r.pending };
  if (!r.email) return { texte: `FullEnrich n'a pas trouvé d'e-mail pro pour ${qui} (aucun crédit dépensé).`, trouve: false, attente: null };
  return { texte: `- ${qui} · ${r.email} (${STATUT_FE[r.emailStatus] ?? `statut FullEnrich : ${r.emailStatus || "inconnu"}`}) · 1 crédit FullEnrich`, trouve: true, attente: null };
}

const trouverEmailPersonne: AdminTool = {
  name: "trouver_email_personne",
  title: "Trouver l'e-mail pro d'une personne",
  description:
    "Trouve l'e-mail pro d'une personne précise (prénom, nom et domaine de la marque, ou son lien LinkedIn) par FullEnrich, et donne son statut de vérification. Coûte des crédits FullEnrich (1 crédit seulement si l'e-mail est trouvé, abonnement de 500 par mois) : annoncer le coût et attendre l'accord ; seulement pour une marque prioritaire, après lire_site_marque (gratuit). Si FullEnrich met trop de temps, l'outil donne un numéro de suivi : rappeler avec suivi = ce numéro (ce rappel ne redemande pas l'accord). N'enregistre rien dans l'app : pour garder la personne, appeler ajouter_contact.",
  inputSchema: {
    type: "object",
    properties: {
      prenom: { type: "string" },
      nom: { type: "string" },
      domaine: { type: "string", description: "Domaine ou site de la marque (ex. marque.fr)" },
      marque: { type: "string", description: "Nom de la marque si le domaine est inconnu" },
      linkedin: { type: "string", description: "Lien du profil LinkedIn (facultatif, remplace prénom + nom)" },
      suivi: { type: "string", description: "Numéro de suivi FullEnrich donné par un appel précédent" },
    },
    additionalProperties: false,
  },
  // Dépense des crédits FullEnrich : jamais annoncé « lecture seule » (accord demandé avant l'appel).
  write: true,
  founder: true,
  run: async (_sb, _c, a) => {
    const prenom = str(a.prenom, 60);
    const nom = str(a.nom, 60);
    const domaine = domaineDe(str(a.domaine, 200));
    const marque = str(a.marque, 120);
    const linkedin = str(a.linkedin, 300);
    const qui = `${prenom} ${nom}`.trim() || linkedin || "cette personne";
    const suivi = str(a.suivi, 80);
    if (suivi) {
      if (!FULLENRICH_KEY) return fail("Clé FullEnrich absente (secret FULLENRICH_API_KEY).");
      if (!/^[0-9a-f-]{20,60}$/i.test(suivi)) return fail("Numéro de suivi illisible.");
      const t = texteFullEnrich(await resultatFullEnrich(suivi, 20_000), qui);
      return t.attente ? ok(`${t.texte} Rappeler encore avec suivi = ${t.attente}.`) : ok(`${t.texte}\nRien n'a été enregistré. Pour garder la personne : ajouter_contact.`);
    }
    if (!linkedin && (!prenom || !nom)) return fail("Il faut le prénom et le nom (ou le lien LinkedIn).");
    if (!linkedin && !domaine && !marque) return fail("Il faut le domaine du site de la marque (ex. marque.fr) ou son nom.");

    const lignes: string[] = [`# E-mail pro de ${qui}${domaine ? ` (${domaine})` : marque ? ` (${marque})` : ""}`];
    // FullEnrich a cherché sans trouver (ni réponse en attente) : la suite est dite plus bas.
    let pasTrouve = false;
    // 1. FullEnrich.
    if (FULLENRICH_KEY) {
      const contact = enrichContact({ first: prenom, last: nom, domain: domaine, company: marque, linkedin });
      if (contact) {
        const r = await enrichir(contact, 25_000);
        const t = texteFullEnrich(r, qui);
        lignes.push(t.texte);
        if (t.trouve) return ok([...lignes, "Rien n'a été enregistré. Pour garder la personne : ajouter_contact."].join("\n"));
        if (t.attente) lignes.push(`Rappeler avec suivi = ${t.attente} dans une minute pour le résultat FullEnrich.`);
        else pasTrouve = !("error" in r);
      } else lignes.push("Lien LinkedIn illisible : donner un lien linkedin.com, ou le prénom, le nom et le domaine.");
    } else lignes.push("FullEnrich non configuré (secret FULLENRICH_API_KEY absent).");
    // 2. Hunter, mis de côté le 24/11/2026 : en sommeil, il ne sert que si une clé HUNTER_API_KEY existe encore.
    const key = hunterKey();
    if (!key) return ok([...lignes, ...(pasTrouve ? [CLE_MANQUANTE] : [])].join("\n"));
    if (!prenom || !nom) return ok([...lignes, "Hunter a besoin du prénom et du nom (le lien LinkedIn seul ne suffit pas)."].join("\n"));
    const q = new URLSearchParams({ first_name: prenom, last_name: nom, ...(domaine ? { domain: domaine } : { company: marque }) });
    const r = await hunter(`/email-finder?${q}`, key);
    if (r.status !== 200) return ok([...lignes, `Hunter : ${erreurHunter(r.status, r.body)}`].join("\n"));
    const f = lireEmailTrouve(r.body);
    if (!f.email) return ok([...lignes, `Hunter n'a pas trouvé d'e-mail pour ${qui}.`].join("\n"));
    return ok([
      ...lignes,
      `- ${qui}${f.poste ? ` · ${f.poste}` : ""} · ${f.email} (Hunter : ${statutEmail(f.statut, f.confiance, f.acceptAll)})${f.linkedin ? ` · ${f.linkedin}` : ""}`,
      "Rien n'a été enregistré. Pour garder la personne : ajouter_contact.",
    ].join("\n"));
  },
};

// ── 4. Site d'une marque ────────────────────────────────────────────────────
type PageLue = { url: string; html: string };

/** Le début d'une réponse, borné à MAX_OCTETS : une page énorme ne remplit pas la mémoire. */
async function debutDuTexte(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const tout = new Uint8Array(MAX_OCTETS);
  let pris = 0;
  while (pris < MAX_OCTETS) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const part = value.subarray(0, Math.min(value.length, MAX_OCTETS - pris));
    tout.set(part, pris);
    pris += part.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(tout.subarray(0, pris));
}

/**
 * Lit une page publique. Les redirections sont suivies à la main (3 au plus), et chaque étape
 * repasse par adresseSite : jamais d'adresse IP, de nom interne ni de port.
 */
async function lirePageSite(url: string): Promise<PageLue | { erreur: string }> {
  let courant = url;
  for (let saut = 0; saut < 4; saut++) {
    let res: Response;
    try {
      res = await fetch(courant, {
        redirect: "manual",
        headers: { "User-Agent": "TTPSuite/1.0 (+https://ttpcreators.pro)", Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return { erreur: "pas de réponse" };
    }
    if (res.status >= 300 && res.status < 400) {
      const vers = res.headers.get("location") ?? "";
      await res.body?.cancel().catch(() => {});
      let suite: URL;
      try {
        suite = new URL(vers, courant);
      } catch {
        return { erreur: "redirection illisible" };
      }
      const origine = adresseSite(suite.origin);
      if (!origine) return { erreur: "redirection vers une adresse refusée" };
      courant = `${origine}${suite.pathname}${suite.search}`;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { erreur: `réponse ${res.status}` };
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { erreur: "ce n'est pas une page web" };
    }
    return { url: courant, html: await debutDuTexte(res) };
  }
  return { erreur: "trop de redirections" };
}

const lireSiteMarque: AdminTool = {
  name: "lire_site_marque",
  title: "Lire le site d'une marque",
  description:
    "Lit le site public d'une marque (page d'accueil, puis contact, presse, mentions légales : 6 pages au plus) et en sort les adresses e-mail écrites dessus, les plus utiles d'abord (partenariats et presse, adresse générale, adresse d'une personne, service client), plus le compte Instagram et la page LinkedIn liés depuis le site. GRATUIT : aucun crédit FullEnrich. À faire en premier pour chaque marque ; trouver_emails_marque (payant en crédits) seulement pour les marques prioritaires ou quand le site ne donne rien. Les réseaux sociaux ne sont pas lus. N'écrit RIEN : pour garder une adresse, appeler ajouter_contact.",
  inputSchema: {
    type: "object",
    properties: {
      site: { type: "string", description: "Site de la marque (ex. marque.fr ou https://www.marque.fr)" },
    },
    required: ["site"],
    additionalProperties: false,
  },
  run: async (_sb, _c, a) => {
    const site = adresseSite(str(a.site, 300));
    if (!site) return fail("Donne le site public de la marque (ex. marque.fr). Les réseaux sociaux, les adresses internes et les adresses IP ne sont pas lus.");
    let accueil = await lirePageSite(`${site}/`);
    const premiereErreur = "erreur" in accueil ? accueil.erreur : "";
    // « marque.fr » qui ne répond pas : beaucoup de sites ne répondent qu'avec « www. ».
    if ("erreur" in accueil && !/^https:\/\/www\./.test(site)) {
      const avecWww = adresseSite(`www.${domaineDuSite(site)}`);
      if (avecWww) accueil = await lirePageSite(`${avecWww}/`);
    }
    if ("erreur" in accueil) return fail(`Le site ${domaineDuSite(site)} n'a pas pu être lu (${premiereErreur || accueil.erreur}). Vérifier l'adresse du site.`);
    // Le site a pu renvoyer vers une autre adresse (www., autre domaine) : c'est elle qui compte.
    const base = adresseSite(new URL(accueil.url).origin) || site;
    const autres = await Promise.all(pagesALire(base, accueil.html).map((u) => lirePageSite(u)));
    const pages: PageLue[] = [accueil, ...autres.filter((p): p is PageLue => !("erreur" in p))];
    const emails = emailsDuSite(pages, base);
    const reseaux = reseauxDuSite(pages);
    return ok([
      `# Site de ${domaineDuSite(base)} · ${pages.length} page(s) lue(s)`,
      emails.length
        ? `${fr(emails.length)} adresse(s) écrite(s) sur le site, les plus utiles d'abord :`
        : "Aucune adresse e-mail écrite sur les pages lues : la marque passe sans doute par un formulaire. Essayer trouver_emails_marque (crédits FullEnrich) si la marque est prioritaire, ou le DM Instagram.",
      ...emails.map(ligneEmailSite),
      emails.some((e) => e.genre === "nominative") ? "Une adresse d'une personne est une donnée personnelle : lui écrire seulement pour son activité professionnelle." : "",
      reseaux.instagram ? `Instagram lié depuis le site : ${reseaux.instagram}` : "",
      reseaux.linkedin ? `LinkedIn lié depuis le site : ${reseaux.linkedin}` : "",
      "Aucun crédit dépensé. Rien n'a été enregistré : pour garder une adresse, ajouter_contact (marque, email, instagram).",
    ].filter(Boolean).join("\n"));
  },
};

// ── 5. DM restés sans réponse ───────────────────────────────────────────────
type Lecture1000 = PromiseLike<{ data: unknown; error: unknown }>;

/** Lit une table par pages de 1 000 lignes (l'API n'en rend pas plus par appel). null si une lecture échoue. */
async function toutLire<T>(lire: (de: number, a: number) => Lecture1000, maxPages = 10): Promise<T[] | null> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await lire(p * 1000, p * 1000 + 999);
    if (error) return null;
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const TYPES_DM: TypeDemande[] = ["marques", "createurs", "inconnus", "tous"];

const dmSansReponse: AdminTool = {
  name: "dm_sans_reponse",
  title: "DM Instagram restés sans réponse",
  description:
    "Liste les conversations Instagram de @ttpcreators où le dernier message est le nôtre et où rien n'est revenu depuis au moins `jours` jours : les comptes à reprendre par e-mail. Pour chacun : marque ou créateur (si le profil a déjà été lu), abonnés, date de notre dernier message, e-mail donné en DM, e-mail et site du profil, agence. Les comptes déjà au carnet de contacts et les créateurs déjà en agence sont laissés de côté par défaut. Les plus gros comptes d'abord. Lecture seule. Ensuite : lire_profils_instagram pour les profils jamais lus, lire_site_marque pour l'adresse d'une marque, puis ajouter_contacts.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: TYPES_DM, description: "marques, createurs, inconnus (profil jamais lu) ou tous (défaut)" },
      jours: { type: "integer", minimum: 0, maximum: 3650, description: "Jours écoulés au moins depuis notre dernier message (défaut 7)" },
      abonnes_min: { type: "integer", minimum: 0, description: "Abonnés au moins (ex. 100000 pour les créateurs visés)" },
      avec_carnet: { type: "boolean", description: "Montrer aussi les comptes déjà au carnet de contacts" },
      avec_agence: { type: "boolean", description: "Montrer aussi les créateurs déjà en agence" },
      limite: { type: "integer", minimum: 1, maximum: 100, description: "Comptes montrés (défaut 30)" },
      a_partir_de: { type: "integer", minimum: 0, description: "Passer les N premiers comptes (pour voir la suite)" },
    },
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const type = (TYPES_DM as string[]).includes(str(a.type, 20)) ? (str(a.type, 20) as TypeDemande) : "tous";
    const limite = int(a.limite, 30, 1, 100);
    const passer = int(a.a_partir_de, 0, 0, 100_000);
    const fils = await toutLire<FilDm & { hidden?: boolean | null }>((de, fin) =>
      sb.from("ig_threads").select("id, username, name, followers, updated_at, emails, contact_id, hidden").eq("last_from_me", true).order("updated_at", { ascending: true }).order("id").range(de, fin));
    if (!fils) return fail("Les conversations Instagram n'ont pas pu être lues. Réessayer.");
    const visibles = fils.filter((f) => f.hidden !== true);
    const comptes = [...new Set(visibles.map((f) => cleCompte(f.username)).filter(Boolean))];
    const profils: ProfilDm[] = [];
    const paquets: string[][] = [];
    for (let i = 0; i < comptes.length; i += 150) paquets.push(comptes.slice(i, i + 150));
    for (let i = 0; i < paquets.length; i += 5) {
      const lus = await Promise.all(paquets.slice(i, i + 5).map((noms) =>
        sb.from("ig_profiles").select("username, agence, agence_nom, isBrand:data->isBrand, website:data->>website, email:data->>email, followers:data->followers, agency:data->>agency").in("username", noms)));
      for (const r of lus) {
        if (r.error) return fail("Les profils déjà lus n'ont pas pu être relus. Réessayer.");
        profils.push(...((r.data as ProfilDm[] | null) ?? []));
      }
    }
    const carnet = await toutLire<{ instagram: string | null }>((de, fin) => sb.from("contacts").select("instagram").not("instagram", "is", null).order("id").range(de, fin), 30);
    if (!carnet) return fail("Le carnet de contacts n'a pas pu être relu. Réessayer.");
    const duCarnet = new Set(carnet.map((c) => cleCompte(c.instagram)).filter(Boolean));
    const toutes = sansReponse(visibles, profils, duCarnet, {
      now: new Date(), joursMin: int(a.jours, 7, 0, 3650), type, abonnesMin: int(a.abonnes_min, 0, 0, 1_000_000_000), sansContact: a.avec_carnet !== true, sansAgence: a.avec_agence !== true,
    });
    const page = toutes.slice(passer, passer + limite);
    const jamaisLus = page.filter((l) => l.genre === "inconnu").map((l) => l.compte);
    return ok([
      `# DM sans réponse · ${fr(toutes.length)} compte(s) : ${decompte(toutes)}`,
      toutes.length ? `Comptes ${fr(passer + 1)} à ${fr(passer + page.length)}, les plus gros d'abord :` : "Aucun compte ne correspond.",
      ...page.map(ligneSansReponse),
      toutes.length > passer + page.length ? `Suite : a_partir_de = ${passer + page.length}.` : "",
      jamaisLus.length ? `Profils jamais lus dans cette page (${jamaisLus.length}) : ${jamaisLus.join(", ")}. Appeler lire_profils_instagram avec ces comptes pour savoir si ce sont des marques, leur site et leur e-mail.` : "",
      "Rien n'a été modifié.",
    ].filter(Boolean).join("\n"));
  },
};


// ── Recrutement des créateurs (audit du 24/11, M13 et M22) ─────────────────
const parisJour = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d);
const ORDRE: EtatRecrut[] = ["a_repondu", "a_relancer", "a_contacter", "attente", "fini"];

const createursAContacter: AdminTool = {
  name: "createurs_a_contacter",
  title: "Recrutement des créateurs : à contacter, à relancer",
  description:
    "Le suivi du recrutement des créateurs du Scouting : ceux qui ont répondu (DM ou mail) depuis notre premier message, ceux à relancer aujourd'hui (J+5 puis J+12), ceux « À contacter » jamais écrits, ceux en attente, et ceux qui n'ont pas répondu après deux relances. Pour chacun : @, abonnés, catégorie, e-mail, dates. Lecture seule. Pour trouver de nouveaux créateurs : base_createurs avec pour_recruter, puis ajouter_au_scouting et changer_statut_scouting (contacter). Après un DM ou un mail envoyé (après le « oui » de Gianni) : noter_contact_createur.",
  inputSchema: {
    type: "object",
    properties: {
      etat: { type: "string", enum: ["a_repondu", "a_relancer", "a_contacter", "attente", "fini"], description: "Une seule catégorie (défaut : toutes)" },
      limite: { type: "integer", minimum: 1, maximum: 200, description: "Fiches montrées par catégorie (défaut 30)" },
    },
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const { data, error } = await sb.from("creator_pool").select("id, name, handle, email, tag, last_contacted").order("sort_order");
    if (error) return fail("Le Scouting n'a pas pu être lu. Réessayer.");
    let track: Record<string, Json>;
    try {
      track = ((await readAppState(sb)).poolTracking ?? {}) as Record<string, Json>;
    } catch {
      return fail("Le suivi du Scouting n'a pas pu être lu. Réessayer.");
    }
    const fiches = ((data as Json[] | null) ?? []).map((r) => {
      const t = track[String(r.id)] ?? {};
      const snaps = ((t.snaps as { date: string; value: number }[] | undefined) ?? []).slice().sort((x, y) => x.date.localeCompare(y.date));
      return { r, t, status: String(t.status ?? "observation"), suivi: lireSuivi(t.recrut), abonnes: snaps.length ? snaps[snaps.length - 1].value : null, compte: cleCompte(r.handle) };
    });
    // Réponses : DM dont le dernier message vient d'eux, mails reçus de leur adresse.
    const suivis = fiches.filter((f) => f.suivi);
    const reponse = new Map<string, string>();
    const comptes = [...new Set(suivis.map((f) => f.compte).filter(Boolean))];
    for (let i = 0; i < comptes.length; i += 150) {
      const { data: fils, error: e } = await sb.from("ig_threads").select("username, updated_at").eq("last_from_me", false).in("username", comptes.slice(i, i + 150));
      if (e) return fail("Les DM n'ont pas pu être relus. Réessayer.");
      for (const f of (fils as Json[] | null) ?? []) {
        const j = parisJour(new Date(String(f.updated_at)));
        const k = `ig:${cleCompte(f.username)}`;
        if (!reponse.has(k) || reponse.get(k)! < j) reponse.set(k, j);
      }
    }
    const emails = [...new Set(suivis.map((f) => str(f.r.email, 200).toLowerCase()).filter((e) => e.includes("@")))];
    for (let i = 0; i < emails.length; i += 100) {
      const { data: recus, error: e } = await sb.from("email_activity").select("contact_email, created_at, source").eq("direction", "in").in("contact_email", emails.slice(i, i + 100)).order("created_at", { ascending: false }).limit(1000);
      if (e) return fail("Les mails reçus n'ont pas pu être relus. Réessayer.");
      for (const m of (recus as Json[] | null) ?? []) {
        // Un rebond ou un expéditeur non vérifié ne compte pas comme une réponse (_shared/mailRecu.ts).
        if (!prouveAdresse(m.source)) continue;
        const j = parisJour(new Date(String(m.created_at)));
        const k = `mail:${String(m.contact_email).toLowerCase()}`;
        if (!reponse.has(k) || reponse.get(k)! < j) reponse.set(k, j);
      }
    }
    const today = parisJour();
    const par = new Map<EtatRecrut, typeof fiches>();
    for (const f of fiches) {
      const rep = [reponse.get(`ig:${f.compte}`), reponse.get(`mail:${str(f.r.email, 200).toLowerCase()}`)].filter(Boolean).sort().pop() ?? null;
      const e = etatRecrut(f.status, f.suivi, rep, today);
      if (e === "hors_suivi") continue;
      par.set(e, [...(par.get(e) ?? []), f]);
    }
    const voulu = str(a.etat, 20) as EtatRecrut;
    const lim = int(a.limite, 30, 1, 200);
    const out: string[] = [`# Recrutement des créateurs · ${ORDRE.map((e) => `${fr(par.get(e)?.length ?? 0)} ${LIBELLES[e].split(" (")[0].split(" :")[0].toLowerCase()}`).join(" · ")}`];
    for (const e of ORDRE) {
      if (voulu && voulu !== e) continue;
      const l = par.get(e) ?? [];
      if (!l.length) continue;
      out.push(`\n## ${LIBELLES[e]} · ${fr(l.length)}`);
      for (const f of l.slice(0, lim)) {
        out.push(`- ${f.r.name} · ${f.r.handle ?? "sans @"}${f.abonnes != null ? ` · ${fr(f.abonnes)} abonnés` : ""}${f.r.tag ? ` · ${f.r.tag}` : ""}${f.r.email ? ` · ${f.r.email}` : ""} · ${texteSuivi(f.suivi)} [scouting ${f.r.id}]`);
      }
      if (l.length > lim) out.push(`… et ${fr(l.length - lim)} autre(s).`);
    }
    if (out.length === 1) out.push("Personne à suivre. Pour en trouver : base_createurs avec pour_recruter, puis ajouter_au_scouting.");
    out.push("Avant d'écrire : relire l'historique (dm_instagram, rechercher_mails). Rien n'a été envoyé ni modifié.");
    return ok(out.join("\n"));
  },
};

const noterContactCreateur: AdminTool = {
  name: "noter_contact_createur",
  title: "Noter un DM ou un mail envoyé à un créateur du Scouting",
  description:
    "À appeler APRÈS avoir envoyé (avec le « oui » de Gianni) un DM ou un mail de recrutement à un créateur du Scouting : note la date et le canal, compte la relance et fixe la prochaine (J+5 puis J+12 ; après deux relances, le suivi s'arrête). Passe la fiche en « À contacter » si elle était « En observation ». N'envoie rien.",
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      profil: { type: "string", description: "Id donné par scouting ou createurs_a_contacter (ou nom exact)" },
      canal: { type: "string", enum: ["dm", "email"] },
    },
    required: ["profil", "canal"],
    additionalProperties: false,
  },
  run: async (sb, _c, a) => {
    const key = str(a.profil, 120);
    const { data } = /^[0-9a-f-]{36}$/i.test(key) ? await sb.from("creator_pool").select("id, name").eq("id", key).limit(1) : await sb.from("creator_pool").select("id, name").ilike("name", key.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(2);
    const list = (data as Json[] | null) ?? [];
    if (list.length !== 1) return fail(list.length ? "Plusieurs fiches correspondent : donne l'id." : "Fiche introuvable dans le Scouting.");
    const id = String(list[0].id);
    let cur: Record<string, Json>;
    try {
      cur = ((await readAppState(sb)).poolTracking ?? {}) as Record<string, Json>;
    } catch {
      return fail("Le suivi du Scouting n'a pas pu être lu : rien n'a été noté. Réessayer.");
    }
    const avant = cur[id] ?? {};
    const canal: Canal = str(a.canal) === "email" ? "email" : "dm";
    const jour = parisJour();
    const prec = lireSuivi(avant.recrut);
    if (prec && prec.dernier === jour && !prec.fini) return ok(`${list[0].name} : un message est déjà noté aujourd'hui (${texteSuivi(prec)}). Rien de changé.`);
    const recrut = noterMessage(prec, canal, jour);
    const status = !avant.status || avant.status === "observation" ? "contacter" : avant.status;
    // Seule l'entrée de CETTE fiche est réécrite (app_state_merge), avec ses autres clés.
    const { error } = await sb.rpc("app_state_merge", { p_key: "poolTracking", p_set: { [id]: { ...avant, status, recrut } }, p_remove: [] });
    if (error) return fail(`Rien n'a été noté : ${error.message}`);
    await sb.from("creator_pool").update({ last_contacted: new Date().toISOString() }).eq("id", id).then(() => {}, () => {});
    return ok(`${list[0].name} : ${recrut.relances ? `relance ${recrut.relances}` : "premier contact"} noté (${canal === "dm" ? "DM" : "mail"}). ${texteSuivi(recrut)}.`);
  },
};

export const AUTONOMIE_TOOLS: AdminTool[] = [importerHistorique, lireProfil, lireProfilsLot, scannerBaseTool, trouverEmailsMarque, trouverEmailPersonne, lireSiteMarque, dmSansReponse, createursAContacter, noterContactCreateur];

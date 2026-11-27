import { describe, expect, it } from "vitest";
import {
  aEnvoyer,
  actionGoogle,
  appliquerLecture,
  type BaseAgenda,
  bilanVide,
  type Champs,
  choixLecture,
  declencheurSync,
  ecrituresApresEnvoi,
  envoyerVersGoogle,
  type EvenementGoogle,
  type GoogleAgenda,
  issueEnvoi,
  type LigneEvent,
  ligneErreur,
  ligneJournal,
  noterEnvoi,
} from "./synchroAgenda.ts";

// ----------------------------------------------------------------------------
// Une base et un Google simulés, données fictives. Le passage testé ici est le vrai
// (envoyerVersGoogle, appliquerLecture), celui que runSyncCycle appelle. Reste hors test :
// les deux adaptateurs de _shared/google.ts (baseAgenda : requêtes Supabase ; googleAgenda :
// appels HTTP à Google), courts, qui ne décident rien. La base imite le déclencheur
// touch_updated_at tel qu'il est en prod : une écriture serveur remet updated_at à now() sauf
// si la ligne passe en sync_source 'google'.
// ----------------------------------------------------------------------------

type Ligne = LigneEvent & { title: string; deleted_at?: string | null };
type EvG = { id: string; etag: string; updated: string; summary: string; status: "confirmed" | "cancelled" };

const T0 = "2026-11-20T10:00:00.000Z";
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** Horloge commune à la base et à Google : chaque lecture avance d'une milliseconde. */
function horlogeSimulee(): () => string {
  let t = Date.parse(T0);
  return () => new Date((t += 1)).toISOString();
}

function baseSimulee(h: () => string) {
  const lignes = new Map<string, Ligne>();
  const pannes = { lecture: false, ecriture: false, ecritureSiInchangee: false, ajout: "" };
  /** Appelé une fois juste après une lecture par id Google (modification faite pendant la lecture). */
  let pendantLecture: (() => void) | null = null;
  const appliquer = (id: string, champs: Champs) => {
    const apres = { ...lignes.get(id)!, ...champs } as Ligne;
    if (apres.sync_source !== "google") apres.updated_at = h(); // déclencheur touch_updated_at (clé service)
    lignes.set(id, apres);
  };
  const base: BaseAgenda<Ligne> = {
    async lignesAgence() {
      if (pannes.lecture) throw new Error("events_read_failed:panne");
      return [...lignes.values()].filter((l) => l.sync_source === "agence").map((l) => ({ ...l }));
    },
    async parIdGoogle(idGoogle) {
      if (pannes.lecture) throw new Error("events_read_failed:panne");
      const l = [...lignes.values()].find((x) => x.google_event_id === idGoogle);
      const copie = l ? { ...l } : null;
      const p = pendantLecture;
      pendantLecture = null;
      p?.();
      return copie;
    },
    async ecrireSiInchangee(ligne, champs) {
      if (pannes.ecritureSiInchangee) return { ecrite: false, erreur: "panne" };
      if (lignes.get(ligne.id)?.updated_at !== ligne.updated_at) return { ecrite: false, erreur: null };
      appliquer(ligne.id, champs);
      return { ecrite: true, erreur: null };
    },
    async ecrire(id, champs) {
      if (pannes.ecriture) return "panne";
      appliquer(id, champs);
      return null;
    },
    async ajouter(champs) {
      if (pannes.ajout) return pannes.ajout;
      const deja = [...lignes.values()].find((x) => x.google_event_id === champs.google_event_id);
      const id = deja?.id ?? `rdv-g${lignes.size + 1}`;
      lignes.set(id, { ...(deja ?? {}), id, ...champs } as Ligne);
      return null;
    },
  };
  return {
    base,
    lignes,
    pannes,
    set pendantLecture(f: (() => void) | null) {
      pendantLecture = f;
    },
    /** Modification dans l'app ou par Alfred : sync_source 'agence' et updated_at = now(). */
    ecritureApp(id: string, champs: Partial<Ligne>) {
      lignes.set(id, { ...lignes.get(id)!, ...champs, sync_source: "agence", updated_at: h() });
    },
  };
}

function googleSimule(h: () => string) {
  const evenements = new Map<string, EvG>();
  const appels: string[] = [];
  let n = 0;
  let nId = 0;
  const reglages = {
    /** Appelé à chaque envoi, avant que Google réponde (modification faite pendant l'envoi). */
    pendant: null as ((action: string, ligne: Ligne) => void) | null,
    /** Statut imposé au prochain envoi (refus de Google). */
    statutImpose: 0,
    /** Création acceptée mais réponse illisible. */
    sansCorps: false,
  };
  const nouvelEtag = () => `"e${++n}"`;
  const ajouterChezGoogle = (summary: string): EvG => {
    const ev: EvG = { id: `evg-${++nId}`, etag: nouvelEtag(), updated: h(), summary, status: "confirmed" };
    evenements.set(ev.id, ev);
    return ev;
  };
  const google: GoogleAgenda<Ligne> = {
    async envoyer(action, ligne) {
      appels.push(action);
      reglages.pendant?.(action, ligne);
      if (reglages.statutImpose) {
        const statut = reglages.statutImpose;
        reglages.statutImpose = 0;
        return { statut, g: {} };
      }
      if (action === "creer") {
        const ev = ajouterChezGoogle(ligne.title);
        return { statut: 200, g: reglages.sansCorps ? {} : { id: ev.id, etag: ev.etag } };
      }
      const ev = evenements.get(ligne.google_event_id ?? "");
      if (action === "supprimer") {
        if (!ev || ev.status === "cancelled") return { statut: 410, g: {} };
        Object.assign(ev, { status: "cancelled", etag: nouvelEtag(), updated: h() });
        return { statut: 204, g: {} };
      }
      if (!ev) return { statut: 404, g: {} };
      if (ligne.google_etag && ligne.google_etag !== ev.etag) return { statut: 412, g: {} };
      Object.assign(ev, { summary: ligne.title, etag: nouvelEtag(), updated: h() });
      return { statut: 200, g: { id: ev.id, etag: ev.etag } };
    },
    async lire(idGoogle) {
      appels.push("lire");
      const ev = evenements.get(idGoogle);
      return ev ? { statut: 200, g: { ...ev } } : { statut: 404, g: null };
    },
    champs: (g) => ({ title: (g as EvenementGoogle & { summary?: string }).summary ?? "(sans titre)" }),
  };
  return {
    google,
    evenements,
    appels,
    reglages,
    ajouterChezGoogle,
    /** Modification faite dans Google Agenda (par l'équipe, un invité, inviter_rdv…). */
    modifierChezGoogle(id: string, summary: string) {
      Object.assign(evenements.get(id)!, { summary, etag: nouvelEtag(), updated: h() });
    },
  };
}

function monde() {
  const h = horlogeSimulee();
  const b = baseSimulee(h);
  const g = googleSimule(h);
  const journal: Record<string, unknown>[] = [];
  const noter = (q: Record<string, unknown>) => {
    journal.push(q);
  };
  return {
    h,
    b,
    g,
    journal,
    ligne: (id = "rdv-1") => b.lignes.get(id)!,
    /** Un passage d'envoi complet, avec son bilan. */
    async passage() {
      const bilan = bilanVide();
      await envoyerVersGoogle(b.base, g.google, bilan, noter, h);
      return bilan;
    },
    /** La lecture d'un rendez-vous de Google. */
    lire: (ev: EvenementGoogle) => appliquerLecture(b.base, g.google, ev, h(), noter),
    /** Un rendez-vous créé dans l'app, déjà envoyé une fois (même etag des deux côtés). */
    rdvSynchro(id = "rdv-1", titre = "Tournage marque fictive") {
      const ev = g.ajouterChezGoogle(titre);
      const t = h();
      b.lignes.set(id, {
        id, title: titre, google_event_id: ev.id, google_etag: ev.etag,
        updated_at: t, last_synced_at: t, sync_source: "google", deleted: false,
      });
      return ev;
    },
    /** Un rendez-vous créé dans l'app, jamais envoyé. */
    rdvNouveau(id = "rdv-2", titre = "Shooting fictif") {
      b.lignes.set(id, {
        id, title: titre, google_event_id: null, google_etag: null,
        updated_at: h(), last_synced_at: null, sync_source: "agence", deleted: false,
      });
    },
  };
}

// ----------------------------------------------------------------------------
// Les décisions
// ----------------------------------------------------------------------------

describe("aEnvoyer", () => {
  it("une ligne venue de Google n'est jamais envoyée", () => {
    expect(aEnvoyer({ sync_source: "google", updated_at: T0, last_synced_at: null })).toBe(false);
  });
  it("une ligne de l'app jamais envoyée part", () => {
    expect(aEnvoyer({ sync_source: "agence", updated_at: T0, last_synced_at: null })).toBe(true);
  });
  it("modifiée depuis le dernier envoi : part", () => {
    expect(aEnvoyer({ sync_source: "agence", updated_at: plus(T0, 1), last_synced_at: T0 })).toBe(true);
  });
  it("même instant (écrit par la synchro) ou plus ancien : ne part pas", () => {
    expect(aEnvoyer({ sync_source: "agence", updated_at: T0, last_synced_at: T0 })).toBe(false);
    expect(aEnvoyer({ sync_source: "agence", updated_at: plus(T0, -1000), last_synced_at: T0 })).toBe(false);
  });
  it("lit les dates de la base (microsecondes, +00:00)", () => {
    expect(aEnvoyer({ sync_source: "agence", updated_at: "2026-11-20T10:00:00.021337+00:00", last_synced_at: T0 })).toBe(true);
  });
});

describe("actionGoogle", () => {
  it("création, modification, suppression, ou rien chez Google", () => {
    expect(actionGoogle({ deleted: false, google_event_id: null })).toBe("creer");
    expect(actionGoogle({ deleted: false, google_event_id: "evg-1" })).toBe("modifier");
    expect(actionGoogle({ deleted: true, google_event_id: "evg-1" })).toBe("supprimer");
    expect(actionGoogle({ deleted: true, google_event_id: null })).toBe("aucune");
  });
});

describe("issueEnvoi", () => {
  it("2xx : envoyé", () => {
    expect(issueEnvoi("creer", 200, { id: "evg-1" })).toBe("envoye");
    expect(issueEnvoi("modifier", 200)).toBe("envoye");
    expect(issueEnvoi("supprimer", 204)).toBe("envoye");
  });
  it("création acceptée sans id lisible : refus (rien ne peut être marqué)", () => {
    expect(issueEnvoi("creer", 200)).toBe("refus");
    expect(issueEnvoi("creer", 200, { etag: '"e1"' })).toBe("refus");
  });
  it("404 ou 410 sur une suppression : déjà parti, c'est fait", () => {
    expect(issueEnvoi("supprimer", 404)).toBe("envoye");
    expect(issueEnvoi("supprimer", 410)).toBe("envoye");
  });
  it("404 ou 410 sur une modification : absent de Google", () => {
    expect(issueEnvoi("modifier", 404)).toBe("absent");
    expect(issueEnvoi("modifier", 410)).toBe("absent");
  });
  it("412 sur une modification : conflit", () => {
    expect(issueEnvoi("modifier", 412)).toBe("conflit");
  });
  it("le reste : refus, réessayé au passage suivant", () => {
    for (const s of [400, 403, 429, 500, 503]) expect(issueEnvoi("modifier", s)).toBe("refus");
    expect(issueEnvoi("creer", 404)).toBe("refus");
    expect(issueEnvoi("supprimer", 500)).toBe("refus");
  });
  it("supprimée avant d'être envoyée : rien à demander, c'est fait", () => {
    expect(issueEnvoi("aucune", 0)).toBe("envoye");
  });
});

describe("ecrituresApresEnvoi", () => {
  const ligne = { google_etag: '"e1"' };
  it("chaque écriture qui marque passe à 'google' et aligne updated_at sur last_synced_at", () => {
    for (const action of ["creer", "modifier", "supprimer", "aucune"] as const) {
      const m = ecrituresApresEnvoi(action, "envoye", T0, ligne, { id: "evg-2", etag: '"e2"' }).marquer;
      expect(m).toMatchObject({ sync_source: "google", updated_at: T0, last_synced_at: T0 });
    }
  });
  it("ce qui s'écrit sans condition ne marque jamais la ligne", () => {
    const cas = [
      ...(["creer", "modifier", "supprimer", "aucune"] as const).map((a) => ecrituresApresEnvoi(a, "envoye", T0, ligne, { id: "evg-2", etag: '"e2"' })),
      ecrituresApresEnvoi("modifier", "absent", T0, ligne),
    ];
    for (const e of cas) for (const cle of ["last_synced_at", "updated_at", "sync_source"]) expect(e.sinon ?? {}).not.toHaveProperty(cle);
  });
  it("404 ou 410 sur une modification : id effacé sans marquer, comme avant", () => {
    expect(ecrituresApresEnvoi("modifier", "absent", T0, ligne)).toEqual({ marquer: null, sinon: { google_event_id: null, google_etag: null } });
  });
  it("412, refus ou création sans id : rien n'est écrit", () => {
    expect(ecrituresApresEnvoi("modifier", "conflit", T0, ligne)).toEqual({ marquer: null, sinon: null });
    expect(ecrituresApresEnvoi("modifier", "refus", T0, ligne)).toEqual({ marquer: null, sinon: null });
    expect(ecrituresApresEnvoi("creer", "envoye", T0, ligne, {})).toEqual({ marquer: null, sinon: null });
  });
  it("modification acceptée sans etag lisible : l'ancien etag est gardé", () => {
    const e = ecrituresApresEnvoi("modifier", "envoye", T0, ligne, {});
    expect(e.marquer).toMatchObject({ google_etag: '"e1"' });
    expect(e.sinon).toBeNull();
  });
});

describe("choixLecture", () => {
  const ligne = { google_etag: '"e2"', updated_at: T0 };
  it("même etag que la dernière version synchronisée : rien (notre envoi qui revient)", () => {
    expect(choixLecture(ligne, { etag: '"e2"', updated: plus(T0, 60_000) }, plus(T0, 60_000))).toBe("rien");
  });
  it("Google plus récent : prendre_google", () => {
    expect(choixLecture(ligne, { etag: '"e3"', updated: plus(T0, 1000) }, plus(T0, 2000))).toBe("prendre_google");
  });
  it("l'app plus récente (ou même instant) : garder_app", () => {
    expect(choixLecture(ligne, { etag: '"e3"', updated: plus(T0, -1000) }, plus(T0, 2000))).toBe("garder_app");
    expect(choixLecture(ligne, { etag: '"e3"', updated: T0 }, plus(T0, 2000))).toBe("garder_app");
  });
  it("sans date chez Google : comptée maintenant", () => {
    expect(choixLecture(ligne, { etag: '"e3"' }, plus(T0, 2000))).toBe("prendre_google");
  });
  it("sans etag d'un côté : on compare les dates", () => {
    expect(choixLecture({ google_etag: null, updated_at: T0 }, { updated: plus(T0, 1000) }, plus(T0, 2000))).toBe("prendre_google");
    expect(choixLecture({ google_etag: null, updated_at: T0 }, { updated: plus(T0, -1000) }, plus(T0, 2000))).toBe("garder_app");
  });
});

// ----------------------------------------------------------------------------
// Le passage (envoi), avec la base et Google simulés
// ----------------------------------------------------------------------------

describe("envoi : la boucle du 27/11/2026", () => {
  it("un envoi réussi sort la ligne de la file, le passage suivant n'envoie plus rien", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { title: "Tournage déplacé" });
    expect(await m.passage()).toMatchObject({ pushed: 1, conflits: 0, refus: 0 });
    expect(m.ligne()).toMatchObject({ sync_source: "google", google_etag: m.g.evenements.get("evg-1")!.etag });
    expect(m.g.evenements.get("evg-1")!.summary).toBe("Tournage déplacé");
    const appels = m.g.appels.length;
    expect((await m.passage()).pushed).toBe(0);
    expect(m.g.appels.length).toBe(appels); // plus rien ne part vers Google
  });

  it("une modification de l'app ou d'Alfred la remet dans la file", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { title: "Tournage déplacé" });
    await m.passage();
    m.b.ecritureApp("rdv-1", { title: "Tournage déplacé à 15 h" });
    expect(aEnvoyer(m.ligne())).toBe(true);
    expect((await m.passage()).pushed).toBe(1);
    expect(m.g.evenements.get("evg-1")!.summary).toBe("Tournage déplacé à 15 h");
  });
});

describe("envoi : modification faite pendant l'envoi", () => {
  it("modification : jamais marquée synchronisée, elle repart au passage suivant sans 412", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { title: "Version 1" });
    m.g.reglages.pendant = () => {
      m.g.reglages.pendant = null;
      m.b.ecritureApp("rdv-1", { title: "Version 2" });
    };
    expect((await m.passage()).pushed).toBe(1);
    expect(m.ligne()).toMatchObject({ sync_source: "agence", google_etag: m.g.evenements.get("evg-1")!.etag });
    expect(aEnvoyer(m.ligne())).toBe(true);
    expect(await m.passage()).toMatchObject({ pushed: 1, conflits: 0 });
    expect(m.g.evenements.get("evg-1")!.summary).toBe("Version 2");
    expect(aEnvoyer(m.ligne())).toBe(false);
  });

  it("création : l'id Google est gardé, pas de doublon chez Google", async () => {
    const m = monde();
    m.rdvNouveau();
    m.g.reglages.pendant = () => {
      m.g.reglages.pendant = null;
      m.b.ecritureApp("rdv-2", { title: "Shooting renommé" });
    };
    await m.passage();
    expect(m.ligne("rdv-2").google_event_id).toBe("evg-1");
    expect(actionGoogle(m.ligne("rdv-2"))).toBe("modifier");
    await m.passage();
    expect(m.g.evenements.size).toBe(1);
    expect(m.g.evenements.get("evg-1")!.summary).toBe("Shooting renommé");
  });

  it("supprimée dans l'app pendant la création : supprimée chez Google au passage suivant", async () => {
    const m = monde();
    m.rdvNouveau();
    m.g.reglages.pendant = () => {
      m.g.reglages.pendant = null;
      m.b.ecritureApp("rdv-2", { deleted: true });
    };
    await m.passage();
    expect(actionGoogle(m.ligne("rdv-2"))).toBe("supprimer");
    expect((await m.passage()).deleted).toBe(1);
    expect(m.g.evenements.get("evg-1")!.status).toBe("cancelled");
    expect(aEnvoyer(m.ligne("rdv-2"))).toBe(false);
  });

  it("restaurée dans l'app pendant la suppression : recréée une fois chez Google", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { deleted: true });
    m.g.reglages.pendant = () => {
      m.g.reglages.pendant = null;
      m.b.ecritureApp("rdv-1", { deleted: false });
    };
    await m.passage();
    expect(m.ligne()).toMatchObject({ google_event_id: null, deleted: false });
    expect((await m.passage()).pushed).toBe(1);
    expect(m.ligne().google_event_id).toBe("evg-2");
    expect((await m.passage()).pushed).toBe(0);
  });

  it("écriture refusée après l'envoi : journalisée, l'etag de Google est quand même retenu", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { title: "Tournage déplacé" });
    m.b.pannes.ecritureSiInchangee = true;
    await m.passage();
    expect(m.journal).toContainEqual({ ecriture_refusee: "rdv-1", erreur: "panne" });
    expect(m.ligne().google_etag).toBe(m.g.evenements.get("evg-1")!.etag); // le prochain envoi ne tombera pas en 412
    expect(aEnvoyer(m.ligne())).toBe(true);
  });
});

describe("envoi : réponses de Google", () => {
  it("404 sur une modification : comme avant, id effacé et rendez-vous recréé une fois au passage suivant", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.evenements.delete("evg-1"); // purgé chez Google, ou un autre compte Google après une reconnexion
    m.b.ecritureApp("rdv-1", { title: "Modifié dans l'app" });
    expect((await m.passage()).absents).toBe(1);
    expect(m.journal).toContainEqual({ absent_de_google: "rdv-1", statut: 404, recree_au_passage_suivant: true });
    expect(m.ligne()).toMatchObject({ google_event_id: null, google_etag: null, sync_source: "agence" });
    expect((await m.passage()).pushed).toBe(1);
    expect(m.g.evenements.size).toBe(1);
    expect(m.ligne().google_event_id).toBe("evg-2");
    expect((await m.passage()).pushed).toBe(0);
  });

  it("412, Google plus récent : relu dans le même passage, sa version entre dans l'app", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { title: "Titre de l'app" });
    m.g.modifierChezGoogle("evg-1", "Titre de Google"); // plus tard que l'app
    const etag = m.g.evenements.get("evg-1")!.etag;
    expect(await m.passage()).toMatchObject({ conflits: 1, pulled: 1, pushed: 0 });
    expect(m.journal).toContainEqual({ conflit: "rdv-1" });
    expect(m.ligne()).toMatchObject({ title: "Titre de Google", sync_source: "google", google_etag: etag });
    expect(m.g.evenements.get("evg-1")!.etag).toBe(etag); // Google n'est pas réécrit
  });

  it("412, l'app plus récente (changement Google déjà lu, etag périmé) : relu, et la version de l'app part dans le même passage", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.modifierChezGoogle("evg-1", "Titre de Google"); // lu par un ancien passage sans garder l'etag
    m.b.ecritureApp("rdv-1", { title: "Titre de l'app" }); // plus tard
    expect(await m.passage()).toMatchObject({ conflits: 1, pushed: 1 });
    expect(m.g.evenements.get("evg-1")!.summary).toBe("Titre de l'app");
    expect(m.ligne()).toMatchObject({ sync_source: "google", google_etag: m.g.evenements.get("evg-1")!.etag });
    expect((await m.passage()).pushed).toBe(0);
  });

  it("412 encore au second envoi : on s'arrête là (pas de boucle), la ligne reste à envoyer", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.modifierChezGoogle("evg-1", "Titre de Google");
    m.b.ecritureApp("rdv-1", { title: "Titre de l'app" });
    let envois = 0;
    m.g.reglages.pendant = (action) => {
      if (action === "modifier" && ++envois === 2) m.g.modifierChezGoogle("evg-1", "Encore changé chez Google");
    };
    expect((await m.passage()).conflits).toBe(2);
    expect(m.journal).toContainEqual({ conflit: "rdv-1", encore: true });
    expect(m.g.appels.filter((a) => a === "modifier")).toHaveLength(2);
    expect(aEnvoyer(m.ligne())).toBe(true);
  });

  it("refus de Google (503 après les essais) : rien n'est écrit, la ligne repart au passage suivant", async () => {
    const m = monde();
    m.rdvSynchro();
    m.b.ecritureApp("rdv-1", { title: "Tournage déplacé" });
    const avant = { ...m.ligne() };
    m.g.reglages.statutImpose = 503;
    expect(await m.passage()).toMatchObject({ pushed: 0, refus: 1, statutsRefus: [503] });
    expect(m.journal).toContainEqual({ refus_google: "rdv-1", action: "modifier", statut: 503 });
    expect(m.ligne()).toEqual(avant);
    expect((await m.passage()).pushed).toBe(1);
  });

  it("création acceptée sans id lisible : comptée en refus (200), rien n'est marqué", async () => {
    const m = monde();
    m.rdvNouveau();
    m.g.reglages.sansCorps = true;
    expect(await m.passage()).toMatchObject({ pushed: 0, refus: 1, statutsRefus: [200] });
    expect(m.journal).toContainEqual({ refus_google: "rdv-2", action: "creer", statut: 200, reponse_sans_id: true });
    expect(m.ligne("rdv-2").google_event_id).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// La lecture d'un rendez-vous de Google
// ----------------------------------------------------------------------------

describe("appliquerLecture", () => {
  it("même etag que la dernière version synchronisée : rien n'est écrit (notre envoi qui revient)", async () => {
    const m = monde();
    const ev = m.rdvSynchro();
    const avant = { ...m.ligne() };
    expect(await m.lire({ ...ev })).toBeNull();
    expect(m.ligne()).toEqual(avant);
  });

  it("l'app plus récente : etag de Google retenu ; écriture ratée : le passage s'arrête", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.modifierChezGoogle("evg-1", "Titre de Google");
    m.b.ecritureApp("rdv-1", { title: "Titre de l'app" });
    const ev = { ...m.g.evenements.get("evg-1")! };
    m.b.pannes.ecriture = true;
    await expect(m.lire(ev)).rejects.toThrow("events_write_failed:panne");
    m.b.pannes.ecriture = false;
    expect(await m.lire(ev)).toBe("garde");
    expect(m.ligne()).toMatchObject({ title: "Titre de l'app", google_etag: ev.etag });
  });

  it("Google plus récent : pris sous condition ; ligne modifiée pendant la lecture : etag seul retenu, ou arrêt si l'écriture rate", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.modifierChezGoogle("evg-1", "Titre de Google");
    const ev = { ...m.g.evenements.get("evg-1")! };
    m.b.pendantLecture = () => m.b.ecritureApp("rdv-1", { title: "Titre de l'app, à l'instant" });
    expect(await m.lire(ev)).toBe("garde");
    expect(m.ligne()).toMatchObject({ title: "Titre de l'app, à l'instant", google_etag: ev.etag, sync_source: "agence" });

    const m2 = monde();
    m2.rdvSynchro();
    m2.g.modifierChezGoogle("evg-1", "Titre de Google");
    m2.b.pendantLecture = () => {
      m2.b.ecritureApp("rdv-1", { title: "Titre de l'app, à l'instant" });
      m2.b.pannes.ecriture = true;
    };
    await expect(m2.lire({ ...m2.g.evenements.get("evg-1")! })).rejects.toThrow("events_write_failed:panne");
  });

  it("Google plus récent, ligne inchangée : sa version entre dans l'app", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.modifierChezGoogle("evg-1", "Titre de Google");
    const ev = { ...m.g.evenements.get("evg-1")! };
    expect(await m.lire(ev)).toBe("pulled");
    expect(m.ligne()).toMatchObject({ title: "Titre de Google", google_etag: ev.etag, sync_source: "google", updated_at: ev.updated });
  });

  it("refusé par la base pour ses données : journalisé, le passage continue", async () => {
    const m = monde();
    m.rdvSynchro();
    m.g.modifierChezGoogle("evg-1", "Titre de Google");
    m.b.pannes.ecritureSiInchangee = true;
    expect(await m.lire({ ...m.g.evenements.get("evg-1")! })).toBeNull();
    expect(m.journal).toContainEqual({ lecture_refusee: "rdv-1", erreur: "panne" });
  });

  it("lecture de la base ratée : le passage s'arrête (le curseur n'avance pas)", async () => {
    const m = monde();
    const ev = m.rdvSynchro();
    m.b.pannes.lecture = true;
    await expect(m.lire({ ...ev, etag: '"autre"' })).rejects.toThrow("events_read_failed");
  });

  it("suppression annoncée par Google : marquée supprimée ; écriture ratée : le passage s'arrête", async () => {
    const m = monde();
    const ev = m.rdvSynchro();
    m.b.pannes.ecriture = true;
    await expect(m.lire({ ...ev, status: "cancelled" })).rejects.toThrow("events_write_failed:panne");
    m.b.pannes.ecriture = false;
    expect(await m.lire({ ...ev, status: "cancelled" })).toBe("deleted");
    expect(m.ligne()).toMatchObject({ deleted: true, sync_source: "google" });
    expect(await m.lire({ ...ev, status: "cancelled" })).toBeNull(); // déjà supprimée
  });

  it("nouveau rendez-vous de Google : ajouté en 'google' ; refusé par la base : journalisé, le passage continue", async () => {
    const m = monde();
    const ev = m.g.ajouterChezGoogle("Appel marque fictive");
    expect(await m.lire({ ...ev })).toBe("pulled");
    const ajoutee = [...m.b.lignes.values()].find((l) => l.google_event_id === ev.id)!;
    expect(ajoutee).toMatchObject({ title: "Appel marque fictive", sync_source: "google", google_etag: ev.etag });
    expect(aEnvoyer(ajoutee)).toBe(false);

    const autre = m.g.ajouterChezGoogle("Autre appel fictif");
    m.b.pannes.ajout = "panne";
    expect(await m.lire({ ...autre })).toBeNull();
    expect(m.journal).toContainEqual({ nouveau_refuse: autre.id.slice(0, 8), erreur: "panne" });
  });
});

// ----------------------------------------------------------------------------
// Bilan et journal
// ----------------------------------------------------------------------------

describe("bilan et journal", () => {
  it("compte chaque réponse", () => {
    const b = bilanVide();
    noterEnvoi(b, "creer", "envoye", 200);
    noterEnvoi(b, "modifier", "envoye", 200);
    noterEnvoi(b, "supprimer", "envoye", 410);
    noterEnvoi(b, "aucune", "envoye", 0);
    noterEnvoi(b, "modifier", "absent", 404);
    noterEnvoi(b, "modifier", "conflit", 412);
    noterEnvoi(b, "modifier", "refus", 429);
    noterEnvoi(b, "creer", "refus", 429);
    noterEnvoi(b, "modifier", "refus", 503);
    expect(b).toEqual({ pulled: 0, pushed: 2, deleted: 1, resynced: false, conflits: 1, absents: 1, refus: 3, statutsRefus: [429, 503] });
  });

  it("statuts de refus distincts, 5 au plus", () => {
    const b = bilanVide();
    for (const s of [400, 401, 403, 429, 500, 502, 503, 400]) noterEnvoi(b, "modifier", "refus", s);
    expect(b.refus).toBe(8);
    expect(b.statutsRefus).toEqual([400, 401, 403, 429, 500]);
  });

  it("une ligne par passage : déclencheur, envoyés, reçus, durée", () => {
    const b = { ...bilanVide(), pushed: 1, pulled: 2 };
    expect(ligneJournal({ canal: "reconnu", etat: "exists" }, b, 812)).toEqual({ canal: "reconnu", etat: "exists", envoyes: 1, recus: 2, supprimes: 0, ms: 812 });
  });

  it("les anomalies n'apparaissent que si elles ont eu lieu", () => {
    const b = { ...bilanVide(), absents: 1, conflits: 2, refus: 1, statutsRefus: [403], resynced: true };
    expect(ligneJournal({ declencheur: "cron" }, b, 90)).toEqual({
      declencheur: "cron", envoyes: 0, recus: 0, supprimes: 0, conflits: 2, absents: 1, refus: 1, statuts_refus: [403], resync: true, ms: 90,
    });
  });

  it("verrou perdu après l'envoi : ce qui est parti est quand même dit", () => {
    const b = { ...bilanVide(), pushed: 3, verrouPerdu: true };
    expect(ligneJournal({ declencheur: "cron" }, b, 130_000)).toEqual({ declencheur: "cron", envoyes: 3, recus: 0, supprimes: 0, verrou_perdu: true, ms: 130_000 });
  });

  it("passage sauté parce qu'un autre tourne", () => {
    expect(ligneJournal({ canal: "reconnu" }, { skipped: "locked" }, 15)).toEqual({ canal: "reconnu", saute: "verrou", ms: 15 });
  });

  it("passage en erreur : message raccourci", () => {
    expect(ligneErreur({ declencheur: "cron" }, new Error("not_connected"), 40)).toEqual({ declencheur: "cron", erreur: "not_connected", ms: 40 });
    expect((ligneErreur({}, "x".repeat(500), 1).erreur as string).length).toBe(300);
  });

  it("déclencheur de google-sync : étiquette connue, sinon l'app ou « inconnu »", () => {
    expect(declencheurSync("cron", "cron")).toBe("cron");
    expect(declencheurSync("manual", "agency")).toBe("manual");
    expect(declencheurSync("app", "agency")).toBe("app"); // relance automatique de l'app
    expect(declencheurSync(undefined, "agency")).toBe("app");
    expect(declencheurSync("n'importe quoi", "cron")).toBe("inconnu");
    expect(declencheurSync(42, undefined)).toBe("inconnu");
  });
});

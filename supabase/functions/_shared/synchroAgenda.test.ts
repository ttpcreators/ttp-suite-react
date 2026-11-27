import { describe, expect, it } from "vitest";
import {
  aEnvoyer,
  actionGoogle,
  bilanVide,
  choixLecture,
  declencheurSync,
  ecrituresApresEnvoi,
  issueEnvoi,
  ligneErreur,
  ligneJournal,
  noterEnvoi,
  type LigneSync,
} from "./synchroAgenda.ts";

// ----------------------------------------------------------------------------
// Une petite base simulée : le déclencheur touch_updated_at tel qu'il est en prod, et
// l'écriture conditionnelle de runSyncCycle. Données fictives.
// ----------------------------------------------------------------------------

type Ligne = LigneSync & { id: string; title: string };

const T0 = "2026-11-20T10:00:00.000Z";

/** Écriture serveur (service_role) : le déclencheur remet updated_at à now() sauf si sync_source = 'google'. */
function ecritureServeur(avant: Ligne, champs: Record<string, unknown>, horlogeBase: string): Ligne {
  const apres = { ...avant, ...champs } as Ligne;
  if (apres.sync_source !== "google") apres.updated_at = horlogeBase;
  return apres;
}

/** Modification dans l'app (ou par Alfred) : sync_source 'agence' et updated_at = now(). */
function ecritureApp(avant: Ligne, champs: Partial<Ligne>, horlogeBase: string): Ligne {
  return { ...avant, ...champs, sync_source: "agence", updated_at: horlogeBase };
}

/** Écriture SOUS CONDITION que updated_at n'ait pas bougé depuis la lecture (comme runSyncCycle). */
function ecrireSiInchangee(base: Ligne, lue: Ligne, champs: Record<string, unknown>, horlogeBase: string): { ligne: Ligne; ecrite: boolean } {
  if (base.updated_at !== lue.updated_at) return { ligne: base, ecrite: false };
  return { ligne: ecritureServeur(base, champs, horlogeBase), ecrite: true };
}

/** Un rendez-vous créé dans l'app, déjà envoyé une fois, puis modifié dans l'app. */
function rdvModifie(): Ligne {
  return {
    id: "rdv-1",
    title: "Tournage marque fictive",
    google_event_id: "evg-1",
    google_etag: '"e1"',
    updated_at: "2026-11-20T09:59:00.000Z",
    last_synced_at: "2026-11-20T09:00:00.000Z",
    sync_source: "agence",
    deleted: false,
  };
}

const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

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
    expect(issueEnvoi("creer", 200)).toBe("envoye");
    expect(issueEnvoi("modifier", 200)).toBe("envoye");
    expect(issueEnvoi("supprimer", 204)).toBe("envoye");
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

describe("la boucle du 27/11/2026", () => {
  it("avant : l'écriture d'après envoi laissait la ligne à envoyer (le déclencheur remettait now())", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    const ancienne = ecritureServeur(lue, { google_etag: '"e2"', last_synced_at: t, updated_at: t }, plus(t, 21));
    expect(aEnvoyer(ancienne)).toBe(true); // repartait à chaque passage
  });

  it("maintenant : un envoi réussi sort la ligne de la file, et le passage suivant n'envoie plus rien", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    const e = ecrituresApresEnvoi("modifier", "envoye", t, lue, { etag: '"e2"' });
    const r = ecrireSiInchangee(lue, lue, e.marquer!, plus(t, 21));
    expect(r.ecrite).toBe(true);
    expect(r.ligne).toMatchObject({ sync_source: "google", google_etag: '"e2"', updated_at: t, last_synced_at: t });
    expect([r.ligne].filter(aEnvoyer)).toEqual([]);
  });

  it("une modification de l'app ou d'Alfred la remet dans la file", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    const synchro = ecrireSiInchangee(lue, lue, ecrituresApresEnvoi("modifier", "envoye", t, lue, { etag: '"e2"' }).marquer!, t).ligne;
    const apres = ecritureApp(synchro, { title: "Tournage déplacé" }, plus(t, 5000));
    expect(aEnvoyer(apres)).toBe(true);
    expect(actionGoogle(apres)).toBe("modifier");
  });

  it("chaque écriture qui marque passe à 'google' et aligne updated_at sur last_synced_at", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    const cas: [Parameters<typeof ecrituresApresEnvoi>[0], Parameters<typeof ecrituresApresEnvoi>[1]][] = [
      ["creer", "envoye"], ["modifier", "envoye"], ["supprimer", "envoye"], ["aucune", "envoye"], ["modifier", "absent"],
    ];
    for (const [action, issue] of cas) {
      const m = ecrituresApresEnvoi(action, issue, t, lue, { id: "evg-2", etag: '"e2"' }).marquer;
      expect(m).toMatchObject({ sync_source: "google", updated_at: t, last_synced_at: t });
    }
  });
});

describe("la course : modification pendant l'envoi", () => {
  it("modification : jamais marquée synchronisée, repart avec le nouvel etag", () => {
    const lue = rdvModifie();
    const enBase = ecritureApp(lue, { title: "Titre changé pendant l'envoi" }, plus(T0, 200));
    const t = plus(T0, 600);
    const e = ecrituresApresEnvoi("modifier", "envoye", t, lue, { etag: '"e2"' });
    const r = ecrireSiInchangee(enBase, lue, e.marquer!, t);
    expect(r.ecrite).toBe(false);
    const apres = ecritureServeur(r.ligne, e.siModifiee!, plus(t, 30));
    expect(apres.title).toBe("Titre changé pendant l'envoi");
    expect(apres.google_etag).toBe('"e2"'); // le prochain envoi ne tombera pas sur un 412
    expect(aEnvoyer(apres)).toBe(true);
  });

  it("création : l'id Google est gardé, le passage suivant modifie au lieu de recréer (pas de doublon)", () => {
    const lue: Ligne = { ...rdvModifie(), google_event_id: null, google_etag: null, last_synced_at: null };
    const enBase = ecritureApp(lue, { title: "Renommé pendant la création" }, plus(T0, 200));
    const t = plus(T0, 600);
    const e = ecrituresApresEnvoi("creer", "envoye", t, lue, { id: "evg-9", etag: '"e1"' });
    const r = ecrireSiInchangee(enBase, lue, e.marquer!, t);
    expect(r.ecrite).toBe(false);
    const apres = ecritureServeur(r.ligne, e.siModifiee!, plus(t, 30));
    expect(apres.google_event_id).toBe("evg-9");
    expect(aEnvoyer(apres)).toBe(true);
    expect(actionGoogle(apres)).toBe("modifier");
  });

  it("supprimée dans l'app pendant la création : le passage suivant la supprime chez Google", () => {
    const lue: Ligne = { ...rdvModifie(), google_event_id: null, google_etag: null, last_synced_at: null };
    const enBase = ecritureApp(lue, { deleted: true }, plus(T0, 200));
    const t = plus(T0, 600);
    const e = ecrituresApresEnvoi("creer", "envoye", t, lue, { id: "evg-9", etag: '"e1"' });
    const apres = ecritureServeur(ecrireSiInchangee(enBase, lue, e.marquer!, t).ligne, e.siModifiee!, plus(t, 30));
    expect(aEnvoyer(apres)).toBe(true);
    expect(actionGoogle(apres)).toBe("supprimer");
  });

  it("restaurée pendant la suppression : recréée une fois chez Google, avec la version de l'app", () => {
    const lue: Ligne = { ...rdvModifie(), deleted: true };
    const enBase = ecritureApp(lue, { deleted: false }, plus(T0, 200));
    const t = plus(T0, 600);
    const e = ecrituresApresEnvoi("supprimer", "envoye", t, lue);
    const r = ecrireSiInchangee(enBase, lue, e.marquer!, t);
    expect(r.ecrite).toBe(false);
    const apres = ecritureServeur(r.ligne, e.siModifiee!, plus(t, 30));
    expect(aEnvoyer(apres)).toBe(true);
    expect(actionGoogle(apres)).toBe("creer");
  });

  it("ce qu'on écrit quand la ligne a bougé ne la marque jamais", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    for (const action of ["creer", "modifier", "supprimer", "aucune"] as const) {
      const s = ecrituresApresEnvoi(action, "envoye", t, lue, { id: "evg-2", etag: '"e2"' }).siModifiee;
      for (const cle of ["last_synced_at", "updated_at", "sync_source"]) expect(s ?? {}).not.toHaveProperty(cle);
    }
  });
});

describe("réponses de Google qui ne marquent rien", () => {
  it("404 ou 410 sur une modification : la ligne sort de la file mais n'est jamais recréée", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    for (const statut of [404, 410]) {
      const e = ecrituresApresEnvoi("modifier", issueEnvoi("modifier", statut), t, lue);
      expect(e.siModifiee).toBeNull();
      expect(e.marquer).not.toHaveProperty("google_event_id"); // id gardé : la lecture peut encore la marquer supprimée
      const apres = ecrireSiInchangee(lue, lue, e.marquer!, t).ligne;
      expect(apres.google_event_id).toBe("evg-1");
      expect(aEnvoyer(apres)).toBe(false);
      expect(actionGoogle(apres)).not.toBe("creer");
    }
  });

  it("412, refus ou réponse sans id à une création : rien n'est écrit, la ligne reste à envoyer", () => {
    const lue = rdvModifie();
    const t = plus(T0, 600);
    expect(ecrituresApresEnvoi("modifier", "conflit", t, lue)).toEqual({ marquer: null, siModifiee: null });
    expect(ecrituresApresEnvoi("modifier", "refus", t, lue)).toEqual({ marquer: null, siModifiee: null });
    expect(ecrituresApresEnvoi("creer", "envoye", t, lue, {})).toEqual({ marquer: null, siModifiee: null });
    expect(aEnvoyer(lue)).toBe(true);
  });

  it("modification acceptée sans etag lisible : l'ancien etag est gardé", () => {
    const e = ecrituresApresEnvoi("modifier", "envoye", T0, rdvModifie(), {});
    expect(e.marquer).toMatchObject({ google_etag: '"e1"' });
    expect(e.siModifiee).toBeNull();
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
  it("garder_app puis etag retenu : le prochain envoi part avec l'etag de Google au lieu d'un 412", () => {
    const lue = rdvModifie(); // modifiée dans l'app, etag "e1" périmé (Google est à "e3")
    expect(choixLecture(lue, { etag: '"e3"', updated: "2026-11-20T09:30:00.000Z" }, T0)).toBe("garder_app");
    const apres = ecritureServeur(lue, { google_etag: '"e3"' }, plus(T0, 10));
    expect(apres.google_etag).toBe('"e3"');
    expect(aEnvoyer(apres)).toBe(true);
  });
});

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

  it("passage sauté parce qu'un autre tourne", () => {
    expect(ligneJournal({ canal: "reconnu" }, { skipped: "locked" }, 15)).toEqual({ canal: "reconnu", saute: "verrou", ms: 15 });
  });

  it("passage en erreur : message raccourci", () => {
    expect(ligneErreur({ declencheur: "cron" }, new Error("not_connected"), 40)).toEqual({ declencheur: "cron", erreur: "not_connected", ms: 40 });
    expect((ligneErreur({}, "x".repeat(500), 1).erreur as string).length).toBe(300);
  });

  it("déclencheur de google-sync : valeur connue, sinon l'app ou « inconnu »", () => {
    expect(declencheurSync("cron", "cron")).toBe("cron");
    expect(declencheurSync("manual", "agency")).toBe("manual");
    expect(declencheurSync(undefined, "agency")).toBe("app");
    expect(declencheurSync("n'importe quoi", "cron")).toBe("inconnu");
    expect(declencheurSync(42, undefined)).toBe("inconnu");
  });
});

import { describe, expect, it } from "vitest";
import {
  avanceCollabOf, detailModification, gesteClavier, gesteValider, modeModifier, patchEtape,
  positionCourante, positionVoisine, statutApresValidation, texteModifie, typeAffiche, validablesEnLot, type PropositionLite,
} from "./aValider";

const COLLAB = "11111111-2222-3333-4444-555555555555";
const ALFRED = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const lien = (etape: number | string, extra = "") => `https://app.ttpcreators.pro/?open=view&view=collabs&item=${COLLAB}&avancer=1&etape=${etape}${extra}`;
const p = (o: Partial<PropositionLite>): PropositionLite => ({ id: "p1", type: "whatsapp", cible: "Zoé Test", contexte: null, contenu: "Salut !", lien_spark: null, agent_id: null, ...o });

describe("avanceCollabOf", () => {
  it("lit la collab et l'étape d'une proposition avancer_collab", () => {
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: lien(9) })).toEqual({ collabId: COLLAB, etape: 9 });
  });
  it("reconnaît le repli en alerte (avant le SQL)", () => {
    expect(avanceCollabOf({ type: "alerte", lien_spark: lien(6) })).toEqual({ collabId: COLLAB, etape: 6 });
  });
  it("ignore une alerte ordinaire, un lien sans marqueur ou une étape hors bornes", () => {
    expect(avanceCollabOf({ type: "alerte", lien_spark: `https://app.ttpcreators.pro/?open=view&view=collabs&item=${COLLAB}` })).toBeNull();
    expect(avanceCollabOf({ type: "alerte", lien_spark: null })).toBeNull();
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: lien(12) })).toBeNull();
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: lien("x") })).toBeNull();
    expect(avanceCollabOf({ type: "whatsapp", lien_spark: lien(9) })).toBeNull();
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: "pas une adresse" })).toBeNull();
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: lien(7).replace(COLLAB, "abc") })).toBeNull();
  });
  it("affiche le repli comme une avance de collab", () => {
    expect(typeAffiche({ type: "alerte", lien_spark: lien(7) })).toBe("avancer_collab");
    expect(typeAffiche({ type: "alerte", lien_spark: null })).toBe("alerte");
  });
});

describe("gesteValider : même statut qu'avant", () => {
  it("un mail d'Alfred passe en « valide » (Alfred l'envoie)", () => {
    const g = gesteValider(p({ type: "brouillon_mail", agent_id: ALFRED, lien_spark: "https://x.test/d" }), ALFRED);
    expect(g).toBe("alfred_envoie");
    expect(statutApresValidation(g)).toBe("valide");
  });
  it("un mail d'un autre agent est marqué envoyé", () => {
    const g = gesteValider(p({ type: "brouillon_mail", agent_id: null }), ALFRED);
    expect(g).toBe("marquer_envoye");
    expect(statutApresValidation(g)).toBe("envoye");
  });
  it("un message à copier est copié puis marqué envoyé", () => {
    expect(gesteValider(p({ type: "instagram" }), ALFRED)).toBe("copier_envoye");
    expect(statutApresValidation("copier_envoye")).toBe("envoye");
    expect(gesteValider(p({ type: "whatsapp", contenu: "  " }), ALFRED)).toBe("marquer_envoye");
  });
  it("une avance de collab", () => {
    expect(gesteValider(p({ type: "avancer_collab", lien_spark: lien(5) }), ALFRED)).toBe("avancer_collab");
    expect(statutApresValidation("avancer_collab")).toBe("envoye");
  });
  it("un appel d'outil proposé par un agent passe en « valide » (l'agent le fait)", () => {
    const g = gesteValider(p({ type: "alerte", contenu: "Action demandée : …", outil: { nom: "noter_reversement", arguments: { montant: 400 } } }), ALFRED);
    expect(g).toBe("alfred_fait");
    expect(statutApresValidation(g)).toBe("valide");
    expect(gesteValider(p({ type: "alerte", outil: null }), ALFRED)).toBe("marquer_envoye");
  });
  it("sans Alfred connu, un mail est marqué envoyé", () => {
    expect(gesteValider(p({ type: "brouillon_mail", agent_id: ALFRED }), null)).toBe("marquer_envoye");
  });
  it("un mail déposé par une connexion « agent autonome » passe en « valide », quel que soit l'agent nommé", () => {
    const g = gesteValider(p({ type: "brouillon_mail", agent_id: null, connexion_agent: true }), ALFRED);
    expect(g).toBe("alfred_envoie");
    expect(statutApresValidation(g)).toBe("valide");
    expect(gesteValider(p({ type: "brouillon_mail", agent_id: null, connexion_agent: true }), null)).toBe("alfred_envoie");
    expect(gesteValider(p({ type: "brouillon_mail", agent_id: null, connexion_agent: false }), ALFRED)).toBe("marquer_envoye");
    // Un message à copier reste à copier, même venu d'un agent.
    expect(gesteValider(p({ type: "whatsapp", connexion_agent: true }), ALFRED)).toBe("copier_envoye");
  });
});

describe("modeModifier", () => {
  it("texte en ligne pour les messages à copier", () => {
    expect(modeModifier(p({ type: "whatsapp" }))).toBe("texte");
    expect(modeModifier(p({ type: "linkedin" }))).toBe("texte");
  });
  it("un brouillon de mail s'ouvre là où il vit, jamais modifié dans la file", () => {
    expect(modeModifier(p({ type: "brouillon_mail", lien_spark: "https://x.test/d" }))).toBe("lien");
    expect(modeModifier(p({ type: "brouillon_mail" }))).toBeNull();
  });
  it("une avance de collab ouvre la collab, une alerte ne se modifie pas", () => {
    expect(modeModifier(p({ type: "avancer_collab", lien_spark: lien(9) }))).toBe("lien");
    expect(modeModifier(p({ type: "alerte" }))).toBeNull();
  });
});

describe("texteModifie et detailModification", () => {
  it("ignore les espaces en trop", () => {
    expect(texteModifie("Salut  Zoé\r\n", "Salut Zoé")).toBe(false);
    expect(texteModifie("Salut Zoé", "Coucou Zoé")).toBe(true);
    expect(texteModifie(null, "")).toBe(false);
  });
  it("garde l'avant et l'après, coupés", () => {
    const d = detailModification({ id: "p9", type: "whatsapp", cible: "Zoé Test" }, "Bonjour Zoé, voici", "Salut Zoé", 10);
    expect(d).toBe("whatsapp · Zoé Test [proposition p9]\nAvant : Bonjour Z…\nAprès : Salut Zoé");
  });
});

describe("patchEtape", () => {
  it("avance, jamais en arrière ni sur place", () => {
    expect(patchEtape({ step: 6, status: "active" }, 9)).toEqual({ step: 9 });
    expect(patchEtape({ step: 9, status: "active" }, 9)).toBeNull();
    expect(patchEtape({ step: 10, status: "active" }, 7)).toBeNull();
    expect(patchEtape({ step: 1, status: "active" }, Number.NaN)).toBeNull();
  });
  it("la dernière étape passe une collab en cours à gagnée", () => {
    expect(patchEtape({ step: 10, status: "active" }, 11)).toEqual({ step: 11, status: "gagnee" });
    expect(patchEtape({ step: 10, status: "terminee" }, 11)).toEqual({ step: 11 });
  });
});

describe("raccourcis clavier", () => {
  it("V, M, E, flèches, Espace", () => {
    expect(gesteClavier({ key: "v" })).toBe("valider");
    expect(gesteClavier({ key: "V", shiftKey: true })).toBe("valider_selection");
    expect(gesteClavier({ key: "M" })).toBe("modifier");
    expect(gesteClavier({ key: "e" })).toBe("ecarter");
    expect(gesteClavier({ key: "ArrowDown" })).toBe("suivante");
    expect(gesteClavier({ key: "k" })).toBe("precedente");
    expect(gesteClavier({ key: " " })).toBe("cocher");
  });
  it("rien dans un champ, ni avec Cmd, Ctrl ou Alt", () => {
    expect(gesteClavier({ key: "v", dansUnChamp: true })).toBeNull();
    expect(gesteClavier({ key: "v", metaKey: true })).toBeNull();
    expect(gesteClavier({ key: "e", ctrlKey: true })).toBeNull();
    expect(gesteClavier({ key: "M", shiftKey: true })).toBeNull();
    expect(gesteClavier({ key: "q" })).toBeNull();
  });
  it("positionVoisine reste dans la liste", () => {
    expect(positionVoisine(0, 3, -1)).toBe(0);
    expect(positionVoisine(2, 3, 1)).toBe(2);
    expect(positionVoisine(1, 3, 1)).toBe(2);
    expect(positionVoisine(0, 0, 1)).toBe(0);
  });
});

describe("corrections de relecture", () => {
  it("un lien avancer=1 n'est accepté que sur l'hôte de l'app, en https", () => {
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: lien(9).replace("app.ttpcreators.pro", "evil.example.com") })).toBeNull();
    expect(avanceCollabOf({ type: "avancer_collab", lien_spark: lien(9).replace("app.ttpcreators.pro", "app.ttpcreators.pro.evil.test") })).toBeNull();
    expect(avanceCollabOf({ type: "alerte", lien_spark: lien(9).replace("https:", "http:") })).toBeNull();
    expect(avanceCollabOf({ type: "alerte", lien_spark: lien(9) })).not.toBeNull();
  });
  it("une collab perdue ou archivée n'avance pas", () => {
    expect(patchEtape({ step: 6, status: "perdue" }, 9)).toBeNull();
    expect(patchEtape({ step: 6, status: "archivee" }, 9)).toBeNull();
  });
  it("Valider (n) laisse dans la file les messages à copier", () => {
    const items = [
      p({ id: "w", type: "whatsapp" }),
      p({ id: "m", type: "brouillon_mail", agent_id: ALFRED }),
      p({ id: "c", type: "avancer_collab", lien_spark: lien(9) }),
      p({ id: "i", type: "instagram" }),
      p({ id: "a", type: "alerte", contenu: "Facture à créer" }),
    ];
    expect(validablesEnLot(items, ALFRED).map((x) => x.id)).toEqual(["m", "c", "a"]);
  });
  it("la proposition courante se retrouve par son id", () => {
    // Une nouvelle proposition arrive en tête : la cible reste la même carte.
    expect(positionCourante(["neuve", "a", "b", "c"], "b", 1)).toBe(2);
    // La courante a été validée : celle qui a pris sa place.
    expect(positionCourante(["a", "c"], "b", 1)).toBe(1);
    expect(positionCourante(["a"], "b", 4)).toBe(0);
    expect(positionCourante([], "b", 2)).toBe(0);
    expect(positionCourante(["a", "b"], null, 0)).toBe(0);
  });
});

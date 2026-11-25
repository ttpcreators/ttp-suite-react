import { describe, expect, it } from "vitest";
import { classerReponse, LIEN_RDV, noteReponse, reponseSequence, tacheReponse } from "./reponseProspect.ts";

describe("classerReponse", () => {
  it("reconnaît un intérêt", () => {
    expect(classerReponse("Re: Collaboration", "Bonjour, avec plaisir ! Pouvez-vous m'envoyer vos tarifs ?")).toBe("interesse");
    expect(classerReponse("Re: Collaboration", "Hi, sounds great, can you send over the media kit?")).toBe("interesse");
    expect(classerReponse("Re: Partenariat", "Merci, je transmets en interne et je reviens vers vous.")).toBe("interesse");
    expect(classerReponse("Re: Partenariat", "On peut caler une visio jeudi ?")).toBe("interesse");
  });
  it("reconnaît un refus, même avec le mot « intéressé »", () => {
    expect(classerReponse("Re: Collaboration", "Bonjour, nous ne sommes pas intéressés, bonne journée.")).toBe("refus");
    expect(classerReponse("Re: Collaboration", "Non merci.")).toBe("refus");
    expect(classerReponse("Re: Collab", "Merci de ne plus nous contacter.")).toBe("refus");
    expect(classerReponse("Re: Collab", "Thanks but we're not interested at this time.")).toBe("refus");
    expect(classerReponse("Re: Collab", "Nous ne travaillons pas avec des agences.")).toBe("refus");
  });
  it("reconnaît un « plus tard »", () => {
    expect(classerReponse("Re: Collab", "Pas pour le moment, nos budgets sont bouclés pour cette année.")).toBe("plus_tard");
    expect(classerReponse("Re: Collab", "Revenez vers nous début 2027 svp.")).toBe("plus_tard");
    expect(classerReponse("Re: Collab", "Not right now, maybe next quarter.")).toBe("plus_tard");
  });
  it("cas réels du 25/11", () => {
    expect(classerReponse("Re: Comme convenu, des nouvelles pour 2027", "Bonjour, Et merci. Aucun budget confirmé pour le moment. Rediscutons de cela d'ici 3 semaines. À bientôt.")).toBe("plus_tard");
    expect(classerReponse("Re: Tes partenariats", "Merci beaucoup pour ton message et pour tes jolis mots sur son univers. Elle est déjà accompagnée par notre agence pour l'ensemble de ses partenariats.")).toBe("refus");
  });
  it("laisse le reste à lire", () => {
    expect(classerReponse("Re: Collaboration intéressante ?", "Bonjour Marc,")).toBe("a_lire");
    expect(classerReponse("Re: Collab", "")).toBe("a_lire");
  });
  it("lit un objet réécrit par la marque", () => {
    expect(classerReponse("Demande de tarifs", "Bonjour,")).toBe("interesse");
  });
});

describe("tâches et notes", () => {
  const p = { marque: "Marque Fictive", email: "hello@marque-fictive.fr", objet: "Re: Collab", extrait: "…", jour: "2026-11-25" };
  it("refus : propose la liste, ne fait rien seul", () => {
    const t = tacheReponse("refus", p);
    expect(t.text).toBe("Refus : Marque Fictive");
    expect(t.descr).toMatch(/ne_plus_contacter/);
    expect(t.descr).toMatch(/Rien n'est fait tout seul/);
  });
  it("plus tard : tâche datée 45 jours après", () => {
    const t = tacheReponse("plus_tard", p);
    expect(t.text).toBe("Recontacter : Marque Fictive");
    expect(t.due).toBe("2027-01-09");
  });
  it("intéressé : tâche Visio avec le lien de rendez-vous", () => {
    const t = tacheReponse("interesse", { ...p, visio: { text: "Visio : Marque Fictive", descr: "Fiche" } });
    expect(t.text).toBe("Visio : Marque Fictive");
    expect(t.priority).toBe("haute");
    expect(tacheReponse("refus", p).priority).toBe("moyenne");
    expect(t.descr).toContain(LIEN_RDV);
    expect(t.descr).toContain("Fiche");
  });
  it("note et réponse de séquence", () => {
    expect(noteReponse("plus_tard", "Re: Collab")).toBe("Plus tard : Re: Collab");
    expect(reponseSequence("refus")).toBe("negative");
    expect(reponseSequence("interesse")).toBe("positive");
    expect(reponseSequence("a_lire")).toBe("a_repondu");
  });
});

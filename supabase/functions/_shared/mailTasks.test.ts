import { describe, expect, it } from "vitest";
import { brandFromEmail, findDue, ignoredSender, mailTasks, parisDay, stripQuoted, taskKey } from "./mailTasks.ts";

// Mercredi 29 octobre 2026, 10 h à Paris.
const at = Date.UTC(2026, 9, 29, 9, 0);
const day = parisDay(at);
const kinds = (subject: string, body: string) => mailTasks({ subject, body, who: "Nike", receivedAt: at }).map((t) => t.kind);

describe("demandes d'un mail → tâches (sans IA)", () => {
  it("repère une demande de stats avec son échéance", () => {
    const [t] = mailTasks({ subject: "Campagne Air Max", body: "Bonjour,\n\nPourriez-vous nous envoyer les stats de la vidéo avant le 5 novembre ?\n\nMerci !", who: "Nike", receivedAt: at });
    expect(t).toMatchObject({ kind: "stats", title: "Envoyer les stats à Nike", due: "2026-11-05", priority: "moyenne" });
    expect(t.quote).toContain("Pourriez-vous nous envoyer les stats");
  });
  it("plusieurs demandes dans un même mail, en anglais", () => {
    expect(kinds("Next steps", "Hi! Could you send us the invoice by Friday? Also please share your shipping address so we can send the products.")).toEqual(["facture", "adresse"]);
    const [f] = mailTasks({ subject: "x", body: "Could you send us the invoice by Friday?", who: "Nike", receivedAt: at });
    expect(f.due).toBe("2026-10-30");
  });
  it("tournures claires sans « merci de » : contrat à signer, brief joint, retours, paiement", () => {
    expect(kinds("Contrat", "Ci-joint le contrat à signer.")).toEqual(["contrat"]);
    expect(kinds("Brief Nike x Léna", "Voici le brief de la campagne.")).toEqual(["brief"]);
    expect(kinds("V1", "Voici nos retours sur la vidéo : couper l'intro.")).toEqual(["retours"]);
    expect(kinds("Paiement", "Le virement a été effectué ce matin.")).toEqual(["paiement"]);
    expect(kinds("Planning", "La mise en ligne est prévue le 12/11.")).toEqual(["publication"]);
  });
  it("ne crée rien pour un mail qui ne demande rien", () => {
    expect(kinds("Merci", "Super, merci pour la vidéo, on adore !")).toEqual([]);
    expect(kinds("Dispo", "Je suis dispo cette semaine pour un call oui")).toEqual([]);
    expect(kinds("Contrat", "Le contrat est bien signé de notre côté.")).toEqual([]);
  });
  it("urgence : priorité haute, à faire le jour même", () => {
    const [t] = mailTasks({ subject: "URGENT", body: "Merci de nous envoyer la facture ASAP.", who: "Nike", receivedAt: at });
    expect(t).toMatchObject({ kind: "facture", priority: "haute", due: "2026-10-29" });
  });
  it("sans date : 2 jours après la réception", () => {
    const [t] = mailTasks({ subject: "Tarifs", body: "Pouvez-vous nous partager vos tarifs pour un reel ?", who: "Nike", receivedAt: at });
    expect(t.due).toBe("2026-10-31");
  });
  it("ignore ce qui est cité des anciens messages", () => {
    const body = "Top, merci !\n\nLe mar. 28 oct. 2026 à 10:00, Marc <m@x.fr> a écrit :\n> Pouvez-vous nous envoyer les stats ?";
    expect(stripQuoted(body)).toBe("Top, merci !");
    expect(kinds("Re: stats", body)).toEqual([]); // la demande était dans l'ancien message, pas dans celui-ci
  });
  it("titre de 45 caractères au plus", () => {
    const [t] = mailTasks({ subject: "x", body: "Merci de nous envoyer les stats.", who: "Une marque au nom vraiment très très long", receivedAt: at });
    expect(t.title.length).toBeLessThanOrEqual(45);
    expect(t.title.startsWith("Envoyer les stats à ")).toBe(true);
  });
});

describe("échéances", () => {
  it("dates écrites, jours de la semaine, mots relatifs", () => {
    expect(findDue("avant le 12 novembre", day)?.due).toBe("2026-11-12");
    expect(findDue("by Nov 3rd", day)?.due).toBe("2026-11-03");
    expect(findDue("pour le 03/11", day)?.due).toBe("2026-11-03");
    expect(findDue("d’ici vendredi", day)?.due).toBe("2026-10-30");
    expect(findDue("demain", day)?.due).toBe("2026-10-30");
    expect(findDue("semaine prochaine", day)?.due).toBe("2026-11-02");
    expect(findDue("fin du mois", day)?.due).toBe("2026-10-31");
    expect(findDue("le 5 janvier", day)?.due).toBe("2027-01-05");
    expect(findDue("rien de daté", day)).toBeNull();
  });
});

describe("expéditeur et marque", () => {
  it("robots ignorés, marque tirée du domaine", () => {
    expect(ignoredSender("no-reply@nike.com")).toBe(true);
    expect(ignoredSender("lea@nike.com")).toBe(false);
    expect(brandFromEmail("partenariats@nike.com")).toBe("Nike");
    expect(brandFromEmail("pr@brand.co.uk")).toBe("Brand");
    expect(brandFromEmail("lea@gmail.com")).toBeNull();
    expect(taskKey("t1", "stats")).toBe("t1:stats");
  });
});

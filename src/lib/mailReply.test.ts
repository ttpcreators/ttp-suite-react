import { describe, expect, it } from "vitest";
import { replyPlan } from "./mailReply";

const D = "@ttpcreators.pro";
const m = (from: string, to: string, cc = "", extra: object = {}) => ({ from, to, cc, ...extra });

describe("destinataires d'une réponse", () => {
  it("réponse simple : l'expéditeur du dernier message reçu, ses copies en « tous »", () => {
    const p = replyPlan([m("Clara <clara@marque.com>", "partnerships@ttpcreators.pro", "paul@marque.com")], "", D);
    expect(p).toMatchObject({ to: "clara@marque.com", cc: ["paul@marque.com"] });
  });
  it("relance : garde les personnes que l'agence avait mises en copie", () => {
    const p = replyPlan([
      m("clara@marque.com", "partnerships@ttpcreators.pro"),
      m("partnerships@ttpcreators.pro", "clara@marque.com", "juridique@marque.com, agent@autre.fr"),
    ], "", D);
    expect(p.to).toBe("clara@marque.com");
    expect(p.cc).toEqual(["juridique@marque.com", "agent@autre.fr"]);
  });
  it("mot interne d'un collègue en dernier : la réponse reste pour la marque", () => {
    const p = replyPlan([m("clara@marque.com", "partnerships@ttpcreators.pro"), m("lea@ttpcreators.pro", "partnerships@ttpcreators.pro")], "", D);
    expect(p).toMatchObject({ to: "clara@marque.com", cc: [] });
  });
  it("Reply-To : l'adresse technique d'envoi ne passe pas en copie", () => {
    const p = replyPlan([m("noreply@plateforme.io", "partnerships@ttpcreators.pro", "", { replyTo: "clara@marque.com" })], "", D);
    expect(p).toMatchObject({ to: "clara@marque.com", cc: [] });
  });
  it("fil sans message reçu : le contact du fil", () => {
    expect(replyPlan([m("partnerships@ttpcreators.pro", "clara@marque.com")], "clara@marque.com", D).to).toBe("clara@marque.com");
  });
});

import { describe, expect, it } from "vitest";
import { ETAT_VIDE, curseurSuivant, lireEtat, ligneConversation, messagesDe, texteTranche, trancheEnCours, tropAncienne } from "./igHistorique.ts";
import { NO_TEXT } from "./inbox.ts";

// Conversation fictive (dépôt public : aucune vraie personne).
const moi = { id: "100", username: "agence.test" };
const elle = { id: "200", username: "Zoe.Test" };
const estMoi = (p?: { id?: string }) => p?.id === "100";

describe("historique des DM Instagram", () => {
  it("curseur : seulement s'il y a une page suivante (jamais l'adresse avec le jeton)", () => {
    expect(curseurSuivant({ cursors: { after: "QVFI" }, next: "https://graph.facebook.com/…&access_token=SECRET" })).toBe("QVFI");
    expect(curseurSuivant({ cursors: { after: "QVFI" } })).toBeNull();
    expect(curseurSuivant(undefined)).toBeNull();
  });

  it("messages Meta → messages de l'app", () => {
    const m = messagesDe([
      { id: "m2", created_time: "2026-03-02T10:00:00+0000", message: "Merci, voici mon mail zoe@studio-zoe.fr", from: elle },
      { id: "m1", created_time: "2026-03-01T09:00:00+0000", message: "Bonjour Zoé !", from: moi },
      { id: "m0", created_time: "2026-03-01T08:00:00+0000", from: elle },
      { id: "x", message: "sans date" },
    ], estMoi);
    expect(m).toEqual([
      { id: "m2", at: "2026-03-02T10:00:00.000Z", me: false, text: "Merci, voici mon mail zoe@studio-zoe.fr" },
      { id: "m1", at: "2026-03-01T09:00:00.000Z", me: true, text: "Bonjour Zoé !" },
      { id: "m0", at: "2026-03-01T08:00:00.000Z", me: false, text: NO_TEXT },
    ]);
  });

  it("ligne ig_threads : @, id, dates du premier et du dernier message, qui a parlé en dernier, emails", () => {
    const msgs = messagesDe([
      { id: "m2", created_time: "2026-03-02T10:00:00+0000", message: "Voici mon mail zoe@studio-zoe.fr", from: elle },
      { id: "m1", created_time: "2026-03-01T09:00:00+0000", message: "Bonjour !", from: moi },
    ], estMoi);
    const conv = { id: "t1", updated_time: "2026-03-02T10:00:00+0000" };
    const r = ligneConversation(conv, elle, msgs, { username: null, emails: ["ancien@exemple.fr"] }, null, "2026-11-24T00:00:00.000Z");
    expect(r).toEqual({
      id: "t1", username: "zoe.test", igsid: "200", updated_at: "2026-03-02T10:00:00.000Z",
      last_text: "Voici mon mail zoe@studio-zoe.fr", last_from_me: false, emails: ["ancien@exemple.fr", "zoe@studio-zoe.fr"],
      synced_at: "2026-11-24T00:00:00.000Z", first_at: "2026-03-01T09:00:00.000Z",
    });
    // Conversation longue : la date la plus ancienne trouvée dans les pages suivantes l'emporte.
    expect(ligneConversation(conv, elle, msgs, undefined, "2025-12-31T00:00:00.000Z", "x").first_at).toBe("2025-12-31T00:00:00.000Z");
    // Sans @ chez Meta : on garde celui déjà connu.
    expect(ligneConversation(conv, {}, msgs, { username: "zoe.test", emails: null }, null, "x").username).toBe("zoe.test");
  });

  it("règle des 3 ans, verrou d'une tranche en cours, état abîmé", () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    expect(tropAncienne("2023-11-01T00:00:00Z", now)).toBe(true);
    expect(tropAncienne("2024-01-01T00:00:00Z", now)).toBe(false);
    expect(trancheEnCours({ ...ETAT_VIDE("x"), enCours: "2026-11-23T23:59:00Z" }, now)).toBe(true);
    expect(trancheEnCours({ ...ETAT_VIDE("x"), enCours: "2026-11-23T23:50:00Z" }, now)).toBe(false);
    expect(lireEtat({ after: 3, vues: "x", termine: true }, "d")).toMatchObject({ after: null, vues: 0, termine: true, debut: "d" });
  });

  it("compte rendu : combien importé, combien il reste", () => {
    const e = { ...ETAT_VIDE("2026-11-24T10:00:00Z"), vues: 500, importees: 420, maj: 80, pages: 20 };
    const t = texteTranche(e, { pages: 2, vues: 50, importees: 45, maj: 5, dejaFaites: 0, anciennes: 0, erreurs: 0, coupee: false }, 829, 3045);
    expect(t).toContain("import en cours");
    expect(t).toContain("environ 2 545");
    expect(t).toContain("Conversations dans TTP Suite : 829.");
    expect(texteTranche({ ...e, termine: true }, null, null, 3045)).toContain("import terminé");
  });
});

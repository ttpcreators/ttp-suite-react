import { describe, expect, it } from "vitest";
import { MAX_ERREUR, MAX_RESUME, colonneErreurAbsente, erreurJournal, ligneJournal, sansErreur } from "./mcpJournal.ts";

describe("journal du connecteur Claude", () => {
  it("ne garde aucune raison pour un appel réussi", () => {
    expect(erreurJournal({ text: "✓ Brouillon créé" })).toBeNull();
    expect(erreurJournal({ text: "✓ Brouillon créé", isError: false })).toBeNull();
  });

  it("garde la raison d'un appel raté, sur une ligne et bornée", () => {
    expect(erreurJournal({ text: "Destinataire invalide.", isError: true })).toBe("Destinataire invalide.");
    expect(erreurJournal({ text: "Rien n'est parti :\n  adresse  en erreur", isError: true })).toBe("Rien n'est parti : adresse en erreur");
    expect(erreurJournal({ text: "x".repeat(MAX_ERREUR + 50), isError: true })).toHaveLength(MAX_ERREUR);
    expect(erreurJournal({ text: "   ", isError: true })).toBeNull();
    expect(erreurJournal({ isError: true })).toBeNull();
  });

  it("écrit la ligne d'un appel réussi sans colonne error", () => {
    const l = ligneJournal({ userId: "u1", grantId: "g1", tool: "contacts", args: { recherche: "Nova" }, res: { text: "# Contacts" } });
    expect(l).toEqual({ user_id: "u1", grant_id: "g1", tool: "contacts", summary: '{"recherche":"Nova"}', ok: true });
    expect("error" in l).toBe(false);
  });

  it("écrit la ligne d'un appel raté avec sa raison", () => {
    const l = ligneJournal({ userId: "u1", grantId: "g1", tool: "creer_brouillon_mail", args: { a: "zoe@exemple.fr" }, res: { text: "Message vide.", isError: true } });
    expect(l.ok).toBe(false);
    expect(l.error).toBe("Message vide.");
  });

  it("borne la demande et accepte une demande absente", () => {
    const long = ligneJournal({ userId: "u1", grantId: "g1", tool: "creer_tache", args: { titre: "t".repeat(1000) }, res: { text: "ok" } });
    expect(long.summary).toHaveLength(MAX_RESUME);
    expect(ligneJournal({ userId: "u1", grantId: "g1", tool: "point_du_jour", args: undefined, res: { text: "ok" } }).summary).toBe("{}");
  });

  it("coupe la demande et la raison sans casser d'emoji (la ligne serait refusée par la base)", () => {
    // '{"t":"' fait 6 caractères : l'emoji tombe pile sur la coupe à 300.
    const l = ligneJournal({ userId: "u1", grantId: "g1", tool: "noter_journal", args: { t: `${"x".repeat(293)}😀 fin` }, res: { text: `${"y".repeat(MAX_ERREUR - 1)}😀`, isError: true } });
    expect(l.summary).toBe(`{"t":"${"x".repeat(293)}`);
    expect(l.error).toBe("y".repeat(MAX_ERREUR - 1));
    expect(() => encodeURIComponent(`${l.summary}${l.error}`)).not.toThrow();
  });

  it("retire la raison pour le repli d'avant le SQL", () => {
    const l = ligneJournal({ userId: "u1", grantId: "g1", tool: "envoyer_mail", args: {}, res: { text: "Message vide.", isError: true } });
    expect(sansErreur(l)).toEqual({ user_id: "u1", grant_id: "g1", tool: "envoyer_mail", summary: "{}", ok: false });
  });

  it("reconnaît la colonne error absente", () => {
    expect(colonneErreurAbsente({ code: "PGRST204", message: "Could not find the 'error' column of 'mcp_log' in the schema cache" })).toBe(true);
    expect(colonneErreurAbsente({ code: "42703", message: 'column "error" of relation "mcp_log" does not exist' })).toBe(true);
    expect(colonneErreurAbsente({ message: 'column "error" does not exist' })).toBe(true);
    expect(colonneErreurAbsente({ code: "23503", message: "insert or update violates foreign key constraint" })).toBe(false);
    expect(colonneErreurAbsente(null)).toBe(false);
  });
});

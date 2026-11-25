import { describe, expect, it } from "vitest";
import { colonneAuteurAbsente, idDejaJournalise, lignesEnvoi, nomAffiche, sansAuteur, sansIdGmail } from "./auteurEnvoi.ts";

describe("nomAffiche", () => {
  it("prend le prénom réglé, sinon le début de l'adresse", () => {
    expect(nomAffiche(" Gianni.V ", "x@y.fr")).toBe("Gianni.V");
    expect(nomAffiche(null, "marc.test@exemple.fr")).toBe("marc.test");
    expect(nomAffiche("", "")).toBe("Agence");
    expect(nomAffiche("x".repeat(60), "")).toHaveLength(40);
  });
});

describe("erreurs reconnues", () => {
  it("colonne absente", () => {
    expect(colonneAuteurAbsente({ code: "PGRST204", message: "Could not find the 'envoye_par' column" })).toBe(true);
    expect(colonneAuteurAbsente({ code: "42703", message: "column does not exist" })).toBe(true);
    expect(colonneAuteurAbsente({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(colonneAuteurAbsente(null)).toBe(false);
  });
  it("id Gmail en double", () => {
    expect(idDejaJournalise({ code: "23505", message: "duplicate key value violates unique constraint \"email_activity_gmail_msg_uidx\"" })).toBe(true);
    expect(idDejaJournalise({ code: "42703" })).toBe(false);
  });
});

describe("lignesEnvoi", () => {
  const auteur = { id: "11111111-1111-1111-1111-111111111111", nom: "Gianni.V" };
  it("une ligne par destinataire, l'id Gmail sur la première seulement", () => {
    const rows = lignesEnvoi(["a@x.fr", "b@x.fr"], { subject: "Objet", snippet: "Mail envoyé par Claude", source: "claude", threadId: "t1", box: "talent", messageId: "m1", auteur });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ contact_email: "a@x.fr", direction: "out", thread_id: "t1", box: "talent", gmail_message_id: "m1", envoye_par: auteur.id, envoye_par_nom: "Gianni.V" });
    expect(rows[1].gmail_message_id).toBeUndefined();
    expect(rows[1].envoye_par).toBe(auteur.id);
  });
  it("sans auteur ni id : rien de plus qu'avant", () => {
    const [r] = lignesEnvoi(["a@x.fr"], { subject: "O", snippet: "s", source: "claude-file" });
    expect(r).toEqual({ contact_email: "a@x.fr", direction: "out", subject: "O", snippet: "s", source: "claude-file", thread_id: null });
  });
  it("replis : sans auteur, sans id Gmail", () => {
    const rows = lignesEnvoi(["a@x.fr"], { subject: "O", snippet: "s", source: "claude", messageId: "m1", auteur });
    expect("envoye_par" in sansAuteur(rows)[0]).toBe(false);
    expect(sansAuteur(rows)[0].gmail_message_id).toBe("m1");
    expect("gmail_message_id" in sansIdGmail(rows)[0]).toBe(false);
    expect(sansIdGmail(rows)[0].envoye_par_nom).toBe("Gianni.V");
  });
});

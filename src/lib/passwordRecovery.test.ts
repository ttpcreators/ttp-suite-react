import { describe, expect, it } from "vitest";
import { adresseRetour, messageErreurMotDePasse, motDePasseInvalide, retourDuLien } from "./passwordRecovery";

describe("retourDuLien", () => {
  it("reconnaît le lien de récupération (jeton dans l'adresse, type=recovery)", () => {
    expect(retourDuLien("#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery")).toBe("recovery");
    expect(retourDuLien("", "?code=xyz&type=recovery")).toBe("recovery");
  });
  it("un lien périmé ou déjà servi", () => {
    expect(retourDuLien("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toBe("expired");
    expect(retourDuLien("#error=access_denied&error_description=Email+link+is+invalid")).toBe("expired");
  });
  it("une adresse ordinaire, ou une connexion qui n'est pas une récupération : rien", () => {
    expect(retourDuLien("")).toBe(null);
    expect(retourDuLien("#access_token=abc&type=signup")).toBe(null);
    expect(retourDuLien("#type=recovery")).toBe(null);
    expect(retourDuLien("", "?open=mails&thread=1")).toBe(null);
  });
});

describe("adresseRetour", () => {
  it("l'adresse de l'app, avec sa base", () => {
    expect(adresseRetour("https://app.exemple.test", "/")).toBe("https://app.exemple.test/");
    expect(adresseRetour("http://localhost:5173", "/")).toBe("http://localhost:5173/");
  });
});

describe("motDePasseInvalide", () => {
  it("6 caractères au moins, et les deux saisies pareilles", () => {
    expect(motDePasseInvalide("abc", "abc")).toBe("6 caractères au moins.");
    expect(motDePasseInvalide("abcdef", "abcdeg")).toBe("Les deux mots de passe ne sont pas identiques.");
    expect(motDePasseInvalide("abcdef", "abcdef")).toBe(null);
  });
});

describe("messageErreurMotDePasse", () => {
  it("traduit les refus connus de Supabase Auth", () => {
    expect(messageErreurMotDePasse({ code: "same_password" })).toBe("Le mot de passe doit être différent de l'ancien.");
    expect(messageErreurMotDePasse({ code: "weak_password", message: "Password should be at least 6 characters." })).toBe("6 caractères au moins.");
    expect(messageErreurMotDePasse({ code: "reauthentication_needed" })).toBe("Pour des raisons de sécurité, reconnecte-toi puis réessaie.");
    expect(messageErreurMotDePasse({ message: "Failed to fetch" })).toBe("Ça n'a pas marché. Réessaie dans un instant.");
    expect(messageErreurMotDePasse(null)).toBe("Ça n'a pas marché. Réessaie dans un instant.");
  });
});

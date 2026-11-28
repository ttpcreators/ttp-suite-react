import { describe, expect, it } from "vitest";
import { CHATGPT_RAPPEL, MARGE_REUTILISATION_MS, adresseRetourAutorisee, alerteNouvelleConnexion, destinationRetour, reutilisationSuspecte } from "./oauthRetour.ts";

describe("adresses de retour du connecteur", () => {
  it("garde les rappels de Claude qui marchent aujourd'hui", () => {
    expect(adresseRetourAutorisee("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(adresseRetourAutorisee("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(adresseRetourAutorisee("https://www.claude.ai/api/mcp/auth_callback")).toBe(true);
    // Claude Code et les agents sur l'ordinateur
    expect(adresseRetourAutorisee("http://localhost:53682/callback")).toBe(true);
    expect(adresseRetourAutorisee("http://127.0.0.1:8976/callback")).toBe(true);
  });

  it("ChatGPT : seulement les deux rappels officiels des connecteurs", () => {
    expect(adresseRetourAutorisee(CHATGPT_RAPPEL)).toBe(true);
    expect(adresseRetourAutorisee("https://chatgpt.com/connector/oauth/abc_DEF-123")).toBe(true);
    expect(adresseRetourAutorisee("https://chatgpt.com/")).toBe(false);
    expect(adresseRetourAutorisee("https://chatgpt.com/g/un-gpt/oauth/callback")).toBe(false);
    expect(adresseRetourAutorisee("https://chatgpt.com/aip/g-123/oauth/callback")).toBe(false);
    expect(adresseRetourAutorisee("https://chatgpt.com/connector/oauth/abc/autre")).toBe(false);
    expect(adresseRetourAutorisee("https://chatgpt.com/connector/oauth/")).toBe(false);
    expect(adresseRetourAutorisee(`${CHATGPT_RAPPEL}?suite=1`)).toBe(false);
    expect(adresseRetourAutorisee(`${CHATGPT_RAPPEL}#x`)).toBe(false);
    expect(adresseRetourAutorisee("http://chatgpt.com/connector_platform_oauth_redirect")).toBe(false);
    expect(adresseRetourAutorisee("https://chatgpt.com:8443/connector_platform_oauth_redirect")).toBe(false);
    expect(adresseRetourAutorisee("https://chat.openai.com/connector_platform_oauth_redirect")).toBe(false);
  });

  it("Claude : seulement son rappel officiel", () => {
    expect(adresseRetourAutorisee("https://claude.ai/")).toBe(false);
    expect(adresseRetourAutorisee("https://claude.ai/chat/abc")).toBe(false);
    expect(adresseRetourAutorisee("https://claude.ai/api/mcp/auth_callback/autre")).toBe(false);
    expect(adresseRetourAutorisee("https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(adresseRetourAutorisee("https://claude.ai/api/mcp/auth_callback#x")).toBe(false);
    expect(adresseRetourAutorisee("https://claude.ai:8443/api/mcp/auth_callback")).toBe(false);
    expect(adresseRetourAutorisee("https://a@claude.ai/api/mcp/auth_callback")).toBe(false);
  });

  it("refuse le reste", () => {
    expect(adresseRetourAutorisee("https://claude.ai.exemple.com/callback")).toBe(false);
    expect(adresseRetourAutorisee("http://claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(adresseRetourAutorisee("https://exemple.com/callback")).toBe(false);
    expect(adresseRetourAutorisee("javascript:alert(1)")).toBe(false);
    expect(adresseRetourAutorisee("pas une adresse")).toBe(false);
  });
});

describe("ce que la page d'accord affiche", () => {
  it("la vraie destination, pas le nom choisi par l'application", () => {
    expect(destinationRetour("https://claude.ai/api/mcp/auth_callback")).toEqual({ hote: "claude.ai", texte: "Claude (claude.ai)", locale: false });
    expect(destinationRetour(CHATGPT_RAPPEL)?.texte).toBe("ChatGPT (chatgpt.com)");
    const local = destinationRetour("http://localhost:53682/callback");
    expect(local?.locale).toBe(true);
    expect(local?.hote).toBe("localhost:53682");
    expect(local?.texte).toContain("cet ordinateur");
    expect(destinationRetour("https://exemple.com/callback")).toBeNull();
  });
});

describe("alerte d'une nouvelle connexion", () => {
  it("dit qui, où et si c'est un agent", () => {
    const a = alerteNouvelleConnexion("Zoé", "https://claude.ai/api/mcp/auth_callback", true);
    expect(a.texte).toContain("Zoé");
    expect(a.texte).toContain("Claude (claude.ai)");
    expect(a.texte).toContain("agent autonome");
    expect(alerteNouvelleConnexion("  ", "http://localhost:4000/cb", false).texte).toMatch(/^Un compte de l'agence .*cet ordinateur/);
  });
});

describe("jeton de renouvellement présenté de nouveau", () => {
  it("coupe la connexion, sauf juste après le remplacement", () => {
    const now = Date.parse("2026-11-28T10:00:00Z");
    expect(reutilisationSuspecte(null, now)).toBe(false);
    expect(reutilisationSuspecte(new Date(now - 5_000).toISOString(), now)).toBe(false);
    expect(reutilisationSuspecte(new Date(now - MARGE_REUTILISATION_MS - 1).toISOString(), now)).toBe(true);
    expect(reutilisationSuspecte("pas une date", now)).toBe(false);
  });
});

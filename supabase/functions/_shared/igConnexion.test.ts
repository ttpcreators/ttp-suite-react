import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALERTE_EXPIRATION_MS,
  JOUR_MS,
  LIEN_IG_TTL_MS,
  MESSAGES_RAISON,
  RAISONS,
  RAISON_AGENCE,
  essaisRates,
  estComptePro,
  etatConnexion,
  lireLien,
  lireRaison,
  messageBrut,
  raisonEchec,
  signerLien,
  urlLien,
} from "./igConnexion.ts";

const now = Date.parse("2026-11-25T12:00:00Z");
const SECRET = "secret-de-test";
const ID = "00000000-0000-4000-8000-000000000001";

describe("raison d'un échec de connexion Instagram", () => {
  it("refus et compte personnel sur la page d'accord", () => {
    expect(raisonEchec("autorisation", "access_denied: user_denied The user denied your request")).toBe("refus");
    expect(raisonEchec("autorisation", "access_denied: user_cancelled_pro_account_conversion")).toBe("pas_pro");
    expect(raisonEchec("compte_pas_pro", "PERSONAL")).toBe("pas_pro");
  });
  it("compte sans rôle sur l'app", () => {
    expect(raisonEchec("autorisation", "Insufficient Developer Role")).toBe("pas_autorise");
  });
  it("code déjà utilisé ou expiré, state expiré", () => {
    expect(raisonEchec("echange", "This authorization code has been used")).toBe("expire");
    expect(raisonEchec("echange", "Matching code was not found or was already used")).toBe("expire");
    expect(raisonEchec("etat", "state_expired")).toBe("expire");
  });
  it("adresse de retour, clé secrète, réseau, base : c'est pour l'agence", () => {
    expect(raisonEchec("echange", "Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request")).toBe("agence");
    expect(raisonEchec("echange", "Invalid platform app")).toBe("agence");
    expect(raisonEchec("jeton_long", "reseau")).toBe("agence");
    expect(raisonEchec("enregistrement", "duplicate key")).toBe("agence");
    expect(raisonEchec("autorisation", "server_error")).toBe("agence");
  });
  it("lien invalide", () => {
    expect(raisonEchec("lien", "signature")).toBe("lien_invalide");
  });
  it("chaque raison a un message créatrice et une ligne agence", () => {
    for (const r of RAISONS) {
      expect(MESSAGES_RAISON[r].titre.length).toBeGreaterThan(5);
      expect(MESSAGES_RAISON[r].texte.length).toBeGreaterThan(5);
      expect(RAISON_AGENCE[r].length).toBeGreaterThan(5);
    }
    expect(MESSAGES_RAISON.pas_pro.texte).toContain("Passer à un compte professionnel");
  });
  it("le paramètre d'adresse ne laisse passer qu'une raison connue", () => {
    expect(lireRaison("pas_pro")).toBe("pas_pro");
    expect(lireRaison("<script>")).toBe("agence");
    expect(lireRaison(null)).toBe("agence");
    expect(lireRaison("constructor")).toBe("agence");
  });
});

describe("type de compte", () => {
  it("pro, personnel, inconnu", () => {
    expect(estComptePro("BUSINESS")).toBe(true);
    expect(estComptePro("media_creator")).toBe(true);
    expect(estComptePro("PERSONAL")).toBe(false);
    expect(estComptePro(undefined)).toBe(null);
  });
});

describe("état de la connexion", () => {
  const dans = (ms: number) => new Date(now + ms).toISOString();
  it("connecté, bientôt expiré, expiré", () => {
    expect(etatConnexion({ link: { expires: dans(40 * JOUR_MS) } }, now)).toEqual({ etat: "connecte", joursRestants: 40 });
    expect(etatConnexion({ link: { expires: dans(ALERTE_EXPIRATION_MS - JOUR_MS) } }, now)).toEqual({ etat: "bientot_expire", joursRestants: 6 });
    expect(etatConnexion({ link: { expires: dans(-JOUR_MS) } }, now).etat).toBe("expire");
    expect(etatConnexion({ link: { expires: dans(40 * JOUR_MS) }, jetonInvalide: true }, now).etat).toBe("expire");
  });
  it("connecté sans date d'expiration connue", () => {
    expect(etatConnexion({ link: { expires: null } }, now)).toEqual({ etat: "connecte", joursRestants: null });
  });
  it("échec et jamais tenté", () => {
    expect(etatConnexion({ link: null, dernier: { at: dans(-60_000), ok: false, raison: "agence" } }, now).etat).toBe("echec");
    expect(etatConnexion({ link: null, dernier: null }, now).etat).toBe("jamais");
    expect(etatConnexion({}, now).etat).toBe("jamais");
  });
  it("essais ratés depuis la dernière réussite", () => {
    const e = (ok: boolean) => ({ at: "", ok });
    expect(essaisRates([e(false), e(false), e(true), e(false)])).toBe(2);
    expect(essaisRates([e(true), e(false)])).toBe(0);
    expect(essaisRates([])).toBe(0);
  });
});

describe("lien de connexion signé", () => {
  it("un lien valide donne la créatrice", async () => {
    const j = await signerLien(SECRET, ID, now);
    expect(await lireLien(SECRET, j, now + JOUR_MS)).toEqual({ ok: true, creatorId: ID, iat: now });
    expect(urlLien(j)).toBe(`https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback?lien=${j}`);
  });
  it("refusé après 7 jours, ou daté dans le futur", async () => {
    const j = await signerLien(SECRET, ID, now);
    expect(await lireLien(SECRET, j, now + LIEN_IG_TTL_MS + 1)).toEqual({ ok: false, raison: "expire", creatorId: ID });
    const futur = await signerLien(SECRET, ID, now + JOUR_MS);
    expect((await lireLien(SECRET, futur, now)).ok).toBe(false);
  });
  it("refusé si la signature ou la créatrice ne colle pas", async () => {
    const j = await signerLien(SECRET, ID, now);
    expect(await lireLien("autre-secret", j, now)).toEqual({ ok: false, raison: "signature" });
    const [p, s] = j.split(".");
    const autre = btoa(JSON.stringify({ k: "ig-lien", c: "00000000-0000-4000-8000-000000000002", iat: now })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await lireLien(SECRET, `${autre}.${s}`, now)).toEqual({ ok: false, raison: "signature" });
    expect(await lireLien(SECRET, `${p}.${s}x`, now)).toMatchObject({ ok: false });
  });
  it("un autre jeton signé avec le même secret (state OAuth) n'est pas un lien", async () => {
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const p = enc({ origin: "https://app.ttpcreators.pro/", nonce: "n", iat: now, sub: ID });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(p)));
    const s = btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await lireLien(SECRET, `${p}.${s}`, now)).toEqual({ ok: false, raison: "forme" });
  });
  it("forme invalide", async () => {
    expect(await lireLien(SECRET, "", now)).toEqual({ ok: false, raison: "forme" });
    expect(await lireLien(SECRET, "a.b.c", now)).toEqual({ ok: false, raison: "forme" });
    expect(await lireLien("", "a.b", now)).toEqual({ ok: false, raison: "forme" });
    await expect(signerLien(SECRET, "pas-un-uuid", now)).rejects.toThrow();
  });
});

describe("message brut de Meta", () => {
  it("une ligne, sans jeton ni clé", () => {
    expect(messageBrut("a\n b")).toBe("a b");
    expect(messageBrut("https://x?access_token=ABC&client_secret=XYZ&code=123")).toBe("https://x?access_token=…&client_secret=…&code=…");
    expect(messageBrut({ error_message: "x" })).toBe('{"error_message":"x"}');
    expect(messageBrut("y".repeat(900)).length).toBe(400);
  });
});

describe("page de fin du lien (public/instagram-relie)", () => {
  it("affiche les mêmes messages que l'espace créatrice", () => {
    const html = readFileSync(new URL("../../../public/instagram-relie/index.html", import.meta.url), "utf8");
    for (const r of RAISONS) {
      expect(html).toContain(`${r}: ["${MESSAGES_RAISON[r].titre}", "${MESSAGES_RAISON[r].texte}"]`);
    }
  });
});

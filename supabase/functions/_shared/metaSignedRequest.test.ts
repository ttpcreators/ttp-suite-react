import { describe, expect, it } from "vitest";
import { lireSignedRequest, signedRequestDuCorps, signerSignedRequest } from "./metaSignedRequest.ts";

// Faux secret de test : jamais la clé de l'app.
const SECRET = "secret-de-test-pas-le-vrai";
const PAYLOAD = { algorithm: "HMAC-SHA256", issued_at: 1_764_000_000, user_id: "17841400000000000" };

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("lireSignedRequest", () => {
  it("accepte une signature bonne et rend user_id", async () => {
    const sr = await signerSignedRequest(SECRET, PAYLOAD);
    const r = await lireSignedRequest(SECRET, sr);
    expect(r).toMatchObject({ ok: true, userId: "17841400000000000", issuedAt: 1_764_000_000 });
  });

  it("accepte un user_id numérique et la casse de l'algorithme", async () => {
    const r = await lireSignedRequest(SECRET, await signerSignedRequest(SECRET, { ...PAYLOAD, algorithm: "hmac-sha256", user_id: 1234 }));
    expect(r).toMatchObject({ ok: true, userId: "1234" });
  });

  it("refuse une signature faite avec un autre secret", async () => {
    const sr = await signerSignedRequest("autre-secret", PAYLOAD);
    expect(await lireSignedRequest(SECRET, sr)).toEqual({ ok: false, raison: "signature" });
  });

  it("refuse un payload modifié après signature", async () => {
    const sr = await signerSignedRequest(SECRET, PAYLOAD);
    const [sig] = sr.split(".");
    const triche = b64url(JSON.stringify({ ...PAYLOAD, user_id: "999" }));
    expect(await lireSignedRequest(SECRET, `${sig}.${triche}`)).toEqual({ ok: false, raison: "signature" });
  });

  it("refuse une signature abîmée d'un caractère", async () => {
    const sr = await signerSignedRequest(SECRET, PAYLOAD);
    const abime = (sr[0] === "A" ? "B" : "A") + sr.slice(1);
    expect(await lireSignedRequest(SECRET, abime)).toEqual({ ok: false, raison: "signature" });
  });

  it("refuse un payload bien signé mais qui n'est pas du JSON", async () => {
    const p = b64url("pas du json {");
    // Signature valide d'un payload illisible : faite à la main.
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(p)))).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await lireSignedRequest(SECRET, `${sig}.${p}`)).toEqual({ ok: false, raison: "payload" });
  });

  it("refuse un autre algorithme ou un user_id absent", async () => {
    expect(await lireSignedRequest(SECRET, await signerSignedRequest(SECRET, { ...PAYLOAD, algorithm: "none" }))).toEqual({ ok: false, raison: "algorithme" });
    expect(await lireSignedRequest(SECRET, await signerSignedRequest(SECRET, { algorithm: "HMAC-SHA256" }))).toEqual({ ok: false, raison: "utilisateur" });
    expect(await lireSignedRequest(SECRET, await signerSignedRequest(SECRET, { ...PAYLOAD, user_id: "1 OR 1=1" }))).toEqual({ ok: false, raison: "utilisateur" });
  });

  it("refuse les formes cassées et l'absence de secret", async () => {
    const sr = await signerSignedRequest(SECRET, PAYLOAD);
    for (const x of ["", null, undefined, "abc", "a.b.c", "a b.c", `${sr}.x`, "=.="]) {
      expect(await lireSignedRequest(SECRET, x)).toEqual({ ok: false, raison: "forme" });
    }
    expect(await lireSignedRequest("", sr)).toEqual({ ok: false, raison: "secret_manquant" });
  });
});

describe("signedRequestDuCorps", () => {
  it("lit le formulaire envoyé par Meta", () => {
    expect(signedRequestDuCorps("signed_request=abc.def", "application/x-www-form-urlencoded")).toBe("abc.def");
  });
  it("lit aussi un corps JSON", () => {
    expect(signedRequestDuCorps('{"signed_request":"abc.def"}', "application/json")).toBe("abc.def");
  });
  it("rend null sans signed_request", () => {
    expect(signedRequestDuCorps("", "")).toBeNull();
    expect(signedRequestDuCorps("autre=1", "")).toBeNull();
    expect(signedRequestDuCorps("{cassé", "application/json")).toBeNull();
  });
});

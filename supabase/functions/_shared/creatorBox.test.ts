import { describe, expect, it } from "vitest";
import { droitsComplets, emailDuJeton, isCreatorBox, normEmail, urlAutorisation } from "./creatorBox.ts";

const jeton = (p: Record<string, unknown>) => `x.${btoa(JSON.stringify(p)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.y`;

describe("Boîtes Gmail des créateurs", () => {
  it("reconnaît une adresse et une boîte de créateur", () => {
    expect(normEmail("  Lea.Test@Gmail.com ")).toBe("lea.test@gmail.com");
    expect(normEmail("pas une adresse")).toBeNull();
    expect(isCreatorBox("lea.test@gmail.com")).toBe(true);
    expect(isCreatorBox("partnerships")).toBe(false);
  });
  it("lit l'adresse vérifiée du jeton Google, jamais une adresse non vérifiée", () => {
    expect(emailDuJeton(jeton({ email: "Lea.Test@gmail.com", email_verified: true }))).toBe("lea.test@gmail.com");
    expect(emailDuJeton(jeton({ email: "lea.test@gmail.com", email_verified: false }))).toBeNull();
    expect(emailDuJeton("illisible")).toBeNull();
  });
  it("exige les deux droits Gmail", () => {
    expect(droitsComplets("openid https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose")).toBe(true);
    expect(droitsComplets("openid https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
  });
  it("demande un accès durable, l'adresse pré-remplie, sans droit de suppression", () => {
    const u = new URL(urlAutorisation("client", "etat", "lea.test@gmail.com"));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("login_hint")).toBe("lea.test@gmail.com");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/functions\/v1\/creator-box-callback$/);
    expect(u.searchParams.get("scope")).not.toMatch(/gmail\.modify|mail\.google\.com/);
  });
});

import { describe, expect, it } from "vitest";
import { driveErrorOf } from "./drive.ts";

describe("driveErrorOf", () => {
  it("API Drive pas activée", () => {
    expect(driveErrorOf(403, '{"error":{"errors":[{"reason":"accessNotConfigured"}]}}')).toBe("api_desactivee");
  });
  it("autorisation Drive manquante", () => {
    expect(driveErrorOf(403, '{"error":{"message":"Request had insufficient authentication scopes."}}')).toBe("autorisation_manquante");
    expect(driveErrorOf(401, "")).toBe("autorisation_manquante");
  });
  it("autre panne", () => {
    expect(driveErrorOf(500, "oops")).toBe("drive_indisponible");
  });
});

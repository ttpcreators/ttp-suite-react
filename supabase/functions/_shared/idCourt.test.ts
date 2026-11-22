import { describe, expect, it } from "vitest";
import { estUuid, plageUuid } from "./idCourt.ts";

describe("id court d'Alfred", () => {
  it("transforme un début d'id en plage d'uuid", () => {
    expect(plageUuid("515a22fd")).toEqual({ de: "515a22fd-0000-0000-0000-000000000000", a: "515a22fd-ffff-ffff-ffff-ffffffffffff" });
    expect(plageUuid("658cf01d-b6c0")).toEqual({ de: "658cf01d-b6c0-0000-0000-000000000000", a: "658cf01d-b6c0-ffff-ffff-ffffffffffff" });
  });
  it("refuse ce qui n'est pas un début d'id", () => {
    expect(plageUuid("Relancer Nova")).toBeNull();
    expect(plageUuid("515a")).toBeNull();
  });
  it("reconnaît un id complet", () => {
    expect(estUuid("658cf01d-b6c0-4b2c-9e4b-0149c479d790")).toBe(true);
    expect(estUuid("658cf01d")).toBe(false);
  });
});

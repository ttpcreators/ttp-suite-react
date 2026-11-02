import { describe, expect, it } from "vitest";
import { publishMessage } from "./publish-site-button";

describe("publishMessage", () => {
  it("dit si la publication est lancée ou déjà en cours", () => {
    expect(publishMessage({ ok: true })).toMatch(/lancée/);
    expect(publishMessage({ ok: true, already: true })).toMatch(/déjà en cours/);
  });

  it("explique quand GitHub n'est pas branché, sinon propose de réessayer", () => {
    expect(publishMessage({ error: "not_configured" })).toMatch(/jeton/);
    expect(publishMessage({ error: "token_refused" })).toMatch(/jeton/);
    expect(publishMessage(null)).toMatch(/réessaie/);
  });
});

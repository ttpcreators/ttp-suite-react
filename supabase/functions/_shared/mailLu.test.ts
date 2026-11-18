import { describe, expect, it } from "vitest";
import { isUnread, rowsNowRead } from "./mailLu.ts";

describe("isUnread", () => {
  it("lit le libellé UNREAD de Gmail", () => {
    expect(isUnread(["INBOX", "UNREAD"])).toBe(true);
    expect(isUnread(["INBOX"])).toBe(false);
    expect(isUnread(undefined)).toBe(false);
  });
});

describe("rowsNowRead", () => {
  const rows = [
    { id: "r1", gmail_message_id: "a", box: "partnerships" },
    { id: "r2", gmail_message_id: "b", box: "partnerships" },
    { id: "r3", gmail_message_id: "c", box: "talent" },
    { id: "r4", gmail_message_id: "d", box: null },
    { id: "r5", gmail_message_id: null, box: "talent" },
  ];

  it("marque lu ce qui n'est plus dans les non lus de sa boîte", () => {
    const got = rowsNowRead(rows, { partnerships: new Set(["a"]), talent: new Set(["c"]) }, ["partnerships", "talent"]);
    expect(got).toEqual(["r2", "r4"]);
  });

  it("ne conclut rien pour une boîte dont la liste a échoué", () => {
    const got = rowsNowRead(rows, { partnerships: new Set(["a"]), talent: null }, ["partnerships", "talent"]);
    expect(got).toEqual(["r2"]);
  });

  it("ancienne ligne sans boîte : lue seulement si aucune boîte ne l'a en non lu", () => {
    expect(rowsNowRead(rows, { partnerships: new Set(["a", "b"]), talent: new Set(["c", "d"]) }, ["partnerships", "talent"])).toEqual([]);
    expect(rowsNowRead(rows, { partnerships: new Set(["a", "b"]) }, ["partnerships"])).toEqual(["r4"]);
  });
});

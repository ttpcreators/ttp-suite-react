import { describe, expect, it } from "vitest";
import { orderByIds } from "./nav";

describe("ordre des favoris", () => {
  const items = ["aujourdhui", "todo", "mails", "contacts"].map((id) => ({ id }));
  it("range selon l'ordre choisi, les nouveaux à la suite", () => {
    expect(orderByIds(items, ["mails", "aujourdhui"]).map((x) => x.id)).toEqual(["mails", "aujourdhui", "todo", "contacts"]);
    expect(orderByIds(items, ["contacts", "mails", "todo", "aujourdhui"]).map((x) => x.id)).toEqual(["contacts", "mails", "todo", "aujourdhui"]);
  });
  it("sans ordre : inchangé ; ids inconnus ignorés", () => {
    expect(orderByIds(items, null)).toBe(items);
    expect(orderByIds(items, ["inconnu", "todo"]).map((x) => x.id)).toEqual(["todo", "aujourdhui", "mails", "contacts"]);
  });
});

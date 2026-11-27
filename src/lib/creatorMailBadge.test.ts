import { describe, expect, it } from "vitest";
import { mailBadgeCount } from "./creatorMailBadge";

const mail = (id: string) => ({ object_type: "mail", object_id: id });

describe("pastille Mail du créateur", () => {
  it("une remarque de l'agence sur un échange : 1, pas 2", () => {
    // Le même échange a bougé sur l'appareil ET a un repère « nouveau ».
    expect(mailBadgeCount(["t1"], [mail("t1")])).toBe(1);
  });

  it("chaque échange compte une fois, d'où que vienne le signal", () => {
    expect(mailBadgeCount(["t1"], [mail("t2")])).toBe(2);
    expect(mailBadgeCount([], [mail("t2"), mail("t2")])).toBe(1);
    expect(mailBadgeCount(["t1", "t1"], [])).toBe(1);
  });

  it("les repères d'autres objets ne comptent pas", () => {
    expect(mailBadgeCount(["t1"], [{ object_type: "todo", object_id: "t9" }, { object_type: "brief", object_id: "t1" }])).toBe(1);
    expect(mailBadgeCount([], [])).toBe(0);
  });
});

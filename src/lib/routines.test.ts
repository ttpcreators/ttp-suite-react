import { describe, expect, it } from "vitest";
import { doneThisWeek, nextDoneLog } from "./routines";

describe("chaque semaine : clic sur la case relu sur la base", () => {
  const wed = new Date(2026, 9, 7, 15, 0); // mercredi 7 octobre 2026
  const lastWeek = { at: new Date(2026, 9, 2, 10, 0).toISOString(), by: "A" };
  const monday = { at: new Date(2026, 9, 5, 9, 0).toISOString(), by: "A" };
  const tuesday = { at: new Date(2026, 9, 6, 9, 0).toISOString(), by: "B" };
  const now = { at: wed.toISOString(), by: "C" };

  it("cocher ajoute un « Fait » à l'historique frais (celui d'un collègue n'est pas écrasé)", () => {
    expect(nextDoneLog([lastWeek], true, now, wed)).toEqual([lastWeek, now]);
  });
  it("déjà dans l'état voulu (un collègue a cliqué entre-temps) : rien à écrire", () => {
    expect(nextDoneLog([lastWeek, monday], true, now, wed)).toBeNull();
    expect(nextDoneLog([lastWeek], false, now, wed)).toBeNull();
  });
  it("décocher retire tous les « Fait » de la semaine, garde les anciens", () => {
    const next = nextDoneLog([lastWeek, monday, tuesday], false, now, wed);
    expect(next).toEqual([lastWeek]);
    expect(doneThisWeek({ done_log: next }, wed)).toBe(false);
  });
  it("historique vide ou absent, gardé à 100 entrées", () => {
    expect(nextDoneLog(null, true, now, wed)).toEqual([now]);
    const long = Array.from({ length: 100 }, () => lastWeek);
    expect(nextDoneLog(long, true, now, wed)).toHaveLength(100);
  });
});

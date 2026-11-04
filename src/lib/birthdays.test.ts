import { describe, expect, it } from "vitest";
import { upcomingBirthdays } from "../../supabase/functions/_shared/birthdays";

describe("upcomingBirthdays", () => {
  const creators = [
    { name: "Ivana", birth: "1999-11-05", status: "actif" },
    { name: "Léa", birth: "05/11/1994", status: "inactif" },
    { name: "Ana", birth: "1996-11-04" },
    { name: "Beverly", birth: "" },
    { name: "Chloé", birth: null },
  ];

  it("annonce la veille et le jour J, avec l'âge", () => {
    expect(upcomingBirthdays(creators, "2026-11-04")).toEqual([
      { name: "Ivana", when: "tomorrow", date: "2026-11-05", age: 27 },
      { name: "Ana", when: "today", date: "2026-11-04", age: 30 },
    ]);
    expect(upcomingBirthdays(creators, "2026-11-05")).toEqual([{ name: "Ivana", when: "today", date: "2026-11-05", age: 27 }]);
  });

  it("passe le changement d'année et fête un 29 février le 28", () => {
    expect(upcomingBirthdays([{ name: "Zoé", birth: "2000-01-01" }], "2026-12-31")).toEqual([
      { name: "Zoé", when: "tomorrow", date: "2027-01-01", age: 27 },
    ]);
    expect(upcomingBirthdays([{ name: "Max", birth: "2004-02-29" }], "2027-02-28")[0]).toMatchObject({ when: "today" });
  });
});

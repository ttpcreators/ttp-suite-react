import { describe, expect, it } from "vitest";
import { activityText } from "../../supabase/functions/_shared/activityText";
import { doneThisWeek, weekStart } from "./routines";
import { guessName } from "./team";

describe("équipe : qui fait quoi", () => {
  it("phrase lisible de chaque action", () => {
    expect(activityText({ verb: "done", entity: "todos", label: "Relancer Nike" })).toEqual({ action: "a terminé la tâche", what: "Relancer Nike" });
    expect(activityText({ verb: "add", entity: "contacts", label: "Gymshark" }).action).toBe("a ajouté un contact");
    expect(activityText({ verb: "delete", entity: "ideas", label: "x" }).action).toBe("a supprimé l'idée");
    expect(activityText({ verb: "status", entity: "collabs", label: "Nike", detail: "gagnee" }).action).toBe("a marqué gagnée la collab");
    expect(activityText({ verb: "status", entity: "invoices", label: "TTP-1", detail: "payee" }).action).toBe("a passé la facture en « payée »");
    expect(activityText({ verb: "step", entity: "collabs", label: "Nike", detail: "4" }).action).toBe("a fait avancer la collab (étape 4)");
    expect(activityText({ verb: "done", entity: "todo_routines", label: "Stats" }).action).toBe("a fait la tâche hebdo");
  });

  it("prénom deviné depuis l'adresse", () => {
    expect(guessName("gianni.valter@gmail.com")).toBe("Gianni");
    expect(guessName("marcbouraoui@gmail.com")).toBe("Marc");
    expect(guessName("talent@ttpcreators.pro")).toBe("Talent");
    expect(guessName("jean-paul@x.fr")).toBe("Jean");
  });
});

describe("to-do chaque semaine", () => {
  const wed = new Date(2026, 9, 7, 15, 0); // mercredi 7 octobre 2026
  it("la semaine commence le lundi à 0 h", () => {
    const s = weekStart(wed);
    expect(s.getDay()).toBe(1);
    expect(s.getDate()).toBe(5);
    expect(s.getHours()).toBe(0);
    expect(weekStart(new Date(2026, 9, 11, 23, 0)).getDate()).toBe(5); // dimanche → même semaine
  });
  it("faite cette semaine seulement si le dernier « Fait » date d'après lundi", () => {
    expect(doneThisWeek({ done_log: [{ at: new Date(2026, 9, 5, 9, 0).toISOString() }] }, wed)).toBe(true);
    expect(doneThisWeek({ done_log: [{ at: new Date(2026, 9, 4, 22, 0).toISOString() }] }, wed)).toBe(false);
    expect(doneThisWeek({ done_log: [] }, wed)).toBe(false);
    expect(doneThisWeek({ done_log: null }, wed)).toBe(false);
  });
});

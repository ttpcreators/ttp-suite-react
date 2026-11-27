import { describe, expect, it } from "vitest";
import { activityPage, champsModifies, changeText, countsByPage, dropReadLocally, infosEvents, keepOpen, sameOpenObjects, throttlePush, unreadKeys } from "./activityEvents";

const ev = (object_type: "todo" | "idea" | "brief" | "mail" | "document" | "creator", object_id: string) => ({ object_type, object_id });

describe("repères « nouveau »", () => {
  it("clés et compteurs par page (un objet compte une fois)", () => {
    const list = [ev("todo", "a"), ev("todo", "a"), ev("todo", "b"), ev("idea", "c"), ev("mail", "t1")];
    expect([...unreadKeys(list)]).toEqual(["todo:a", "todo:b", "idea:c", "mail:t1"]);
    expect(countsByPage(list, "agency")).toEqual({ todo: 2, ideas: 1, mails: 1 });
    expect(countsByPage([ev("brief", "x")], "creator")).toEqual({ missions: 1 });
    expect(activityPage("brief", "agency")).toBe("briefs");
    expect(activityPage("autre", "agency")).toBe(null);
  });
  it("vague 1 : dépôt et infos d'un créateur comptés sur Documents et Roster côté agence", () => {
    expect(countsByPage([ev("document", "d1"), ev("document", "d1"), ev("creator", "c1")], "agency")).toEqual({ documents: 1, roster: 1 });
    expect(activityPage("creator", "creator")).toBe("infos");
    expect(changeText("done", "Envoyer la preview Marque X")).toBe("Terminée · « Envoyer la preview Marque X »");
  });
  it("vague 1 : la pastille ne compte que les objets encore ouverts", () => {
    const list = [ev("todo", "faite"), ev("todo", "ouverte"), ev("brief", "termine"), ev("brief", "encours"), ev("idea", "supprimee"), ev("mail", "t1")];
    const open = { todo: new Set(["ouverte"]), brief: new Set(["encours"]), idea: new Set<string>() };
    expect(countsByPage(keepOpen(list, open), "creator")).toEqual({ todo: 1, missions: 1, mails: 1 });
    expect(keepOpen(list, null)).toHaveLength(list.length);
    expect(sameOpenObjects(open, { idea: new Set(), brief: new Set(["encours"]), todo: new Set(["ouverte"]) })).toBe(true);
    expect(sameOpenObjects(open, { ...open, todo: new Set(["ouverte", "autre"]) })).toBe(false);
    expect(sameOpenObjects(open, { todo: open.todo, brief: open.brief })).toBe(false);
    expect(sameOpenObjects(null, null)).toBe(true);
    expect(sameOpenObjects(null, open)).toBe(false);
  });
  it("vague 1 : infos modifiées par un créateur, noms des champs seulement", () => {
    const list = [
      { object_type: "creator" as const, object_id: "id-a", creator: "Créatrice A" },
      { object_type: "creator" as const, object_id: "id-b", creator: "Créateur B" },
      { object_type: "todo" as const, object_id: "t1", creator: "Créatrice A" },
    ];
    expect(infosEvents(list, " créatrice a ").map((e) => e.object_id)).toEqual(["id-a"]);
    expect(infosEvents(list, "Autre nom", "id-b").map((e) => e.object_id)).toEqual(["id-b"]);
    expect(champsModifies(["address, siren", "siren,email_pro", null, "ville"])).toEqual(["adresse", "SIREN", "email pro", "ville"]);
    expect(champsModifies(["adresse, SIREN"])).toEqual(["adresse", "SIREN"]);
  });
  it("texte de notification court et clair", () => {
    expect(changeText("subtask", "Tournage Gymshark")).toBe("Nouvelle sous-tâche · « Tournage Gymshark »");
    expect(changeText("progress", "x".repeat(60))).toBe(`Nouveau message · « ${"x".repeat(44)}… »`);
  });
  it("un repère marqué lu ne revient pas avec une lecture partie avant (sauf nouveau changement)", () => {
    const at = Date.parse("2026-10-25T10:00:00Z");
    const read = new Map([["todo:a", at]]);
    const list = [
      { object_type: "todo" as const, object_id: "a", updated_at: "2026-10-25T09:59:00Z" },
      { object_type: "todo" as const, object_id: "b", updated_at: "2026-10-25T09:00:00Z" },
    ];
    expect(dropReadLocally(list, read).map((e) => e.object_id)).toEqual(["b"]);
    expect(dropReadLocally([{ ...list[0], updated_at: "2026-10-25T10:05:00Z" }], read)).toHaveLength(1);
    expect(dropReadLocally([{ ...list[0], updated_at: "pas une date" }], read)).toHaveLength(0);
    expect(dropReadLocally(list, new Map())).toHaveLength(2);
  });
  it("un push par objet et par changement toutes les 10 minutes", () => {
    const a = throttlePush({}, "todo:a:subtask", 1000);
    expect(a).toEqual({ "todo:a:subtask": 1000 });
    expect(throttlePush(a!, "todo:a:subtask", 1000 + 60_000)).toBe(null);
    expect(throttlePush(a!, "todo:a:progress", 2000)).toEqual({ "todo:a:subtask": 1000, "todo:a:progress": 2000 });
    expect(throttlePush(a!, "todo:a:subtask", 1000 + 11 * 60_000)).toEqual({ "todo:a:subtask": 1000 + 11 * 60_000 });
  });
});

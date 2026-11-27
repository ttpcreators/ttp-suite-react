import { describe, expect, it } from "vitest";
import { aPrevenirApresConfier, creatorsANotifier, memesCreateurs, mentionCachee, patchConfier, pourCreateurColumnMissing, pushFinTache, visibiliteCreation } from "./todoDemande";

const agence = (o: Record<string, unknown> = {}) => ({ source: "agency", creator: null, creators: [], visible_createur: false, ...o });

describe("création d'une tâche par l'agence", () => {
  it("avec un créateur : visible et demandée ; sans : interne", () => {
    expect(visibiliteCreation(1, true)).toEqual({ visible_createur: true, pour_createur: true });
    expect(visibiliteCreation(0, true)).toEqual({ visible_createur: false, pour_createur: false });
  });
  it("avant le SQL, pour_createur n'est jamais envoyé", () => {
    expect(visibiliteCreation(2, false)).toEqual({ visible_createur: true });
    expect(visibiliteCreation(0, false)).toEqual({ visible_createur: false });
  });
});

describe("Confier à / Modifier", () => {
  it("d'aucun créateur à un : visible et demandée, le créateur est prévenu", () => {
    const t = agence();
    const p = patchConfier(t, ["Créatrice A"], true);
    expect(p).toEqual({ visible_createur: true, pour_createur: true });
    expect(aPrevenirApresConfier(t, ["Créatrice A"], p)).toEqual(["Créatrice A"]);
  });
  it("avant le SQL : visible seulement, et prévenu quand même (tâche pour lui)", () => {
    const t = agence();
    const p = patchConfier(t, ["Créatrice A"], false);
    expect(p).toEqual({ visible_createur: true });
    expect(aPrevenirApresConfier(t, ["Créatrice A"], p)).toEqual(["Créatrice A"]);
  });
  it("rendue à l'agence : interne", () => {
    expect(patchConfier(agence({ creator: "Créatrice A", creators: ["Créatrice A"], visible_createur: true, pour_createur: true }), [], true)).toEqual({ visible_createur: false, pour_createur: false });
  });
  it("d'un créateur à un autre : rien ne change, une tâche interne le reste", () => {
    const interne = agence({ creator: "Créatrice A", creators: ["Créatrice A"], visible_createur: false });
    expect(patchConfier(interne, ["Créatrice B"], true)).toEqual({});
    expect(aPrevenirApresConfier(interne, ["Créatrice B"], {})).toEqual([]);
  });
  it("tâche demandée confiée à un autre créateur en plus : seul le nouveau est prévenu", () => {
    const t = agence({ creator: "Créatrice A", creators: ["Créatrice A"], visible_createur: true, pour_createur: true });
    expect(aPrevenirApresConfier(t, ["Créatrice A", "Créatrice B"], {})).toEqual(["Créatrice B"]);
  });
  it("tâche suivie par l'agence (pas demandée) : personne n'est prévenu", () => {
    const t = agence({ creator: "Créatrice A", creators: ["Créatrice A"], visible_createur: true, pour_createur: false });
    expect(aPrevenirApresConfier(t, ["Créatrice A", "Créatrice B"], {})).toEqual([]);
  });
  it("une tâche écrite par le créateur n'est pas touchée", () => {
    const t = { source: "creator", creator: "Créatrice A", creators: ["Créatrice A"] };
    expect(patchConfier(t, ["Créatrice B"], true)).toEqual({});
    expect(aPrevenirApresConfier(t, ["Créatrice B"], {})).toEqual([]);
  });
});

describe("toast de « Confier à » : dire quand la tâche reste cachée (constat W4)", () => {
  it("tâche interne (rappel de collab) confiée à un autre créateur : « interne, cachée au créateur »", () => {
    const rappel = agence({ creator: "Créatrice A", creators: ["Créatrice A"], visible_createur: false, pour_createur: false });
    expect(mentionCachee(rappel, ["Créatrice B"], patchConfier(rappel, ["Créatrice B"], true))).toBe("interne, cachée au créateur");
    expect(mentionCachee(rappel, ["Créatrice A", "Créatrice B"], {})).toBe("interne, cachée aux créateurs");
  });
  it("tâche visible, tâche qui devient visible, rendue à l'agence ou tâche du créateur : rien à ajouter", () => {
    const visible = agence({ creator: "Créatrice A", creators: ["Créatrice A"], visible_createur: true });
    expect(mentionCachee(visible, ["Créatrice B"], {})).toBe("");
    const sans = agence();
    expect(mentionCachee(sans, ["Créatrice A"], patchConfier(sans, ["Créatrice A"], true))).toBe("");
    expect(mentionCachee(visible, [], patchConfier(visible, [], true))).toBe("");
    expect(mentionCachee({ source: "creator", creator: "Créatrice A" }, ["Créatrice B"], {})).toBe("");
  });
  it("même liste de créateurs : sans ordre, casse ni doublon", () => {
    expect(memesCreateurs(["Créatrice A", "créatrice b"], ["Créatrice B", "CRÉATRICE A", " "])).toBe(true);
    expect(memesCreateurs(["Créatrice A"], ["Créatrice A", "Créatrice B"])).toBe(false);
    expect(memesCreateurs([], [])).toBe(true);
  });
});

describe("fin d'une tâche par l'agence (push au créateur)", () => {
  it("sa propre demande : « Ta demande est faite »", () => {
    expect(pushFinTache({ source: "creator", creator: "Créatrice A" })).toEqual({ kind: "task-done", to: ["Créatrice A"] });
  });
  it("tâche que l'agence lui demandait : « Tâche terminée », à tous ses créateurs", () => {
    expect(pushFinTache(agence({ creators: ["Créatrice A", "Créatrice B"], visible_createur: true, pour_createur: true }))).toEqual({ kind: "task-closed", to: ["Créatrice A", "Créatrice B"] });
    // Avant le SQL, une tâche visible reste « pour lui ».
    expect(pushFinTache(agence({ creator: "Créatrice A", visible_createur: true }))?.kind).toBe("task-closed");
  });
  it("tâche interne ou suivie par l'agence : aucun push", () => {
    expect(pushFinTache(agence({ creator: "Créatrice A", visible_createur: false }))).toBe(null);
    expect(pushFinTache(agence({ creator: "Créatrice A", visible_createur: true, pour_createur: false }))).toBe(null);
    expect(pushFinTache(agence({ visible_createur: true, pour_createur: true }))).toBe(null);
  });
  it("créateurs prévenus des nouveautés : tâche visible et pour lui seulement", () => {
    expect(creatorsANotifier(agence({ creator: "Créatrice A", visible_createur: true, pour_createur: false }))).toEqual([]);
    expect(creatorsANotifier(agence({ creator: "Créatrice A", visible_createur: true }))).toEqual(["Créatrice A"]);
  });
});

describe("pourCreateurColumnMissing", () => {
  it("reconnaît la colonne absente, pas les autres erreurs", () => {
    expect(pourCreateurColumnMissing({ code: "42703", message: 'column todos.pour_createur does not exist' })).toBe(true);
    expect(pourCreateurColumnMissing({ code: "PGRST204", message: "Could not find the 'pour_createur' column of 'todos' in the schema cache" })).toBe(true);
    expect(pourCreateurColumnMissing({ code: "42501", message: "permission denied" })).toBe(false);
    expect(pourCreateurColumnMissing(null)).toBe(false);
  });
});

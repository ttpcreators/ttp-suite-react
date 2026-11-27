import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerPlanificateur, type IssueLancement } from "./synchroPlanifiee";

/** Un lancement simulé : rend les issues données dans l'ordre (puis « fait »), et compte les appels. */
function lanceur(issues: IssueLancement[] = []) {
  const f = vi.fn(async () => issues.shift() ?? "fait");
  return f;
}

describe("creerPlanificateur", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("écritures rapprochées : un seul lancement, 2 s après la dernière", async () => {
    const lancer = lanceur();
    const p = creerPlanificateur(lancer);
    p.planifier();
    await vi.advanceTimersByTimeAsync(1500);
    p.planifier(); // lien vers une collab écrit juste après la création
    await vi.advanceTimersByTimeAsync(1999);
    expect(lancer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lancer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lancer).toHaveBeenCalledTimes(1);
  });

  it("passage déjà en cours côté serveur : nouvel essai après 5 s, deux fois au plus", async () => {
    const lancer = lanceur(["verrou", "verrou", "verrou"]);
    const p = creerPlanificateur(lancer);
    p.planifier();
    await vi.advanceTimersByTimeAsync(2000);
    expect(lancer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(lancer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(lancer).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lancer).toHaveBeenCalledTimes(3); // le cron horaire prendra le relais
  });

  it("le verrou libéré au nouvel essai : on s'arrête là", async () => {
    const lancer = lanceur(["verrou", "fait"]);
    const p = creerPlanificateur(lancer);
    p.planifier();
    await vi.advanceTimersByTimeAsync(2000 + 5000 + 60_000);
    expect(lancer).toHaveBeenCalledTimes(2);
  });

  it("écriture pendant un lancement : un autre lancement juste après lui", async () => {
    let finir: (i: IssueLancement) => void = () => {};
    const lancer = vi.fn(() => new Promise<IssueLancement>((ok) => (finir = ok)));
    const p = creerPlanificateur(lancer);
    p.planifier();
    await vi.advanceTimersByTimeAsync(2000);
    expect(lancer).toHaveBeenCalledTimes(1);
    p.planifier(); // écrite pendant que le passage tourne
    await vi.advanceTimersByTimeAsync(2000);
    expect(lancer).toHaveBeenCalledTimes(1); // pas deux passages en même temps
    finir("fait");
    await vi.advanceTimersByTimeAsync(0);
    expect(lancer).toHaveBeenCalledTimes(2);
    finir("fait");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lancer).toHaveBeenCalledTimes(2);
  });

  it("erreur (Google pas connecté, réseau) ou exception : pas de nouvel essai", async () => {
    const lancer = vi.fn(async (): Promise<IssueLancement> => {
      throw new Error("réseau");
    });
    const p = creerPlanificateur(lancer);
    p.planifier();
    await vi.advanceTimersByTimeAsync(2000 + 60_000);
    expect(lancer).toHaveBeenCalledTimes(1);
    const lancer2 = lanceur(["erreur"]);
    creerPlanificateur(lancer2).planifier();
    await vi.advanceTimersByTimeAsync(2000 + 60_000);
    expect(lancer2).toHaveBeenCalledTimes(1);
  });

  it("une écriture pendant l'attente d'un nouvel essai repart du délai normal", async () => {
    const lancer = lanceur(["verrou"]);
    const p = creerPlanificateur(lancer);
    p.planifier();
    await vi.advanceTimersByTimeAsync(2000);
    expect(lancer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    p.planifier();
    await vi.advanceTimersByTimeAsync(2000);
    expect(lancer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lancer).toHaveBeenCalledTimes(2);
  });
});

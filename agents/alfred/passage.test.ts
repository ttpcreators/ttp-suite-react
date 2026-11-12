import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { decider, heureReprise, lireReprise, lireSortie, messageAttente, messageEchec, oublierRepriseSi, quand, repriseDue } from "./passage.mjs";

// Mercredi 12 novembre 2026, 12 h 56 (heure locale).
const MAINTENANT = new Date(2026, 10, 12, 12, 56).getTime();
const a = (h: number, m = 0, jour = 12) => new Date(2026, 10, jour, h, m).getTime();
const sortie = (o: Record<string, unknown>) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", ...o });

describe("Alfred : le bilan d'un passage de Claude", () => {
  it("reconnaît un passage réussi et garde le dernier texte de Claude", () => {
    expect(lireSortie(sortie({ result: " Fait. " }))).toMatchObject({ type: "ok", texte: "Fait." });
  });

  it("reconnaît la limite de l'abonnement et l'heure où elle repart", () => {
    const r = lireSortie(sortie({ is_error: true, result: "You've hit your limit · resets 3pm (Europe/Paris)" }), { maintenant: MAINTENANT });
    expect(r.type).toBe("limite");
    expect(r.fin).toBe(a(15));
    expect(lireSortie(sortie({ is_error: true, api_error_status: 429, result: "Too many requests" })).type).toBe("limite");
    expect(lireSortie(sortie({ is_error: true, result: `Claude AI usage limit reached|${a(14) / 1000}` }), { maintenant: MAINTENANT }).fin).toBe(a(14));
  });

  it("lit l'heure de reprise sous ses différentes formes, et rien quand elle n'y est pas", () => {
    expect(heureReprise("resets 14:30", MAINTENANT)).toBe(a(14, 30));
    expect(heureReprise("resets 9am", MAINTENANT)).toBe(a(9, 0, 13));
    expect(heureReprise("resets 12am", MAINTENANT)).toBe(a(0, 0, 13));
    expect(heureReprise("resets in 2 hours", MAINTENANT)).toBe(MAINTENANT + 2 * 3_600_000);
    expect(heureReprise("resets Nov 15, 3pm", MAINTENANT)).toBeNull();
    expect(heureReprise("limit reached", MAINTENANT)).toBeNull();
  });

  it("reconnaît la connexion perdue, Claude surchargé, trop d'étapes et le reste", () => {
    expect(lireSortie(sortie({ is_error: true, result: "Invalid API key · Please run /login" })).type).toBe("connexion");
    expect(lireSortie(sortie({ is_error: true, api_error_status: 401, result: "x" })).type).toBe("connexion");
    expect(lireSortie(sortie({ is_error: true, result: "API Error: 529 Overloaded" })).type).toBe("surcharge");
    expect(lireSortie(sortie({ is_error: true, api_error_status: 503, result: "x" })).type).toBe("surcharge");
    expect(lireSortie(sortie({ is_error: true, result: "fetch failed" })).type).toBe("surcharge");
    expect(lireSortie(sortie({ subtype: "error_max_turns", is_error: true, errors: ["Reached maximum number of turns (150)"] })).type).toBe("tours");
    const autre = lireSortie(sortie({ is_error: true, api_error_status: 404, result: "There's an issue with the selected model (x)." }));
    expect(autre).toMatchObject({ type: "autre", raison: "There's an issue with the selected model (x)." });
  });

  it("dit quelque chose d'utile quand Claude n'a rien écrit du tout", () => {
    expect(lireSortie("", { code: 137 })).toMatchObject({ type: "autre", raison: "Claude s'est arrêté sans rien dire, code 137" });
    expect(lireSortie("pas du json").raison).toBe("pas du json");
    expect(lireSortie(`bruit\n${sortie({ result: "ok" })}`).type).toBe("ok");
  });

  it("écrit l'heure simplement", () => {
    expect(quand(a(14, 5), MAINTENANT)).toBe("14 h 05");
    expect(quand(a(15), MAINTENANT)).toBe("15 h");
    expect(quand(a(9, 0, 13), MAINTENANT)).toBe("demain à 9 h");
    expect(quand(a(9, 0, 15), MAINTENANT)).toBe("le 15 novembre à 9 h");
  });
});

describe("Alfred : que faire après un échec", () => {
  it("limite : garde le message et attend la fin de la limite, ou un quart d'heure si elle est inconnue", () => {
    const d = decider({ type: "limite", fin: a(15), maintenant: MAINTENANT });
    expect(d).toMatchObject({ garder: true, silencieux: false, prochaine: { type: "limite", quand: a(15, 1), fin: a(15) } });
    expect(decider({ type: "limite", maintenant: MAINTENANT }).prochaine).toMatchObject({ quand: MAINTENANT + 15 * 60_000, fin: null });
  });

  it("échec passager : deux reprises à 10 minutes, puis on laisse tomber", () => {
    const un = decider({ type: "surcharge", maintenant: MAINTENANT });
    expect(un).toMatchObject({ garder: true, silencieux: false, prochaine: { type: "essai", essais: 1, quand: MAINTENANT + 600_000 } });
    const deux = decider({ type: "autre", avant: un.prochaine, origine: "reprise", maintenant: un.prochaine.quand });
    expect(deux).toMatchObject({ garder: true, silencieux: true, prochaine: { essais: 2 } });
    const trois = decider({ type: "surcharge", avant: deux.prochaine, origine: "reprise", maintenant: deux.prochaine.quand });
    expect(trois).toMatchObject({ garder: false, prochaine: null, silencieux: false });
    // Un nouveau message de Marc repart de zéro.
    expect(decider({ type: "surcharge", avant: deux.prochaine, origine: "marc", maintenant: MAINTENANT }).prochaine.essais).toBe(1);
  });

  it("ne redit pas à Marc ce qu'il sait déjà, sauf s'il vient d'écrire ou pour un point", () => {
    const avant = { type: "limite", quand: MAINTENANT, fin: null, essais: 0 };
    expect(decider({ type: "limite", avant, origine: "auto", maintenant: MAINTENANT }).silencieux).toBe(true);
    expect(decider({ type: "limite", avant, origine: "marc", maintenant: MAINTENANT }).silencieux).toBe(false);
    expect(decider({ type: "limite", avant, origine: "auto", mode: "le point du matin", maintenant: MAINTENANT }).silencieux).toBe(false);
    const connexion = { type: "connexion", quand: MAINTENANT, fin: null, essais: 0 };
    expect(decider({ type: "connexion", avant: connexion, origine: "reprise", maintenant: MAINTENANT }).silencieux).toBe(true);
  });

  it("trop d'étapes : on ne remet pas le message en file", () => {
    expect(decider({ type: "tours", maintenant: MAINTENANT })).toMatchObject({ garder: false, prochaine: null });
  });
});

describe("Alfred : les messages à Marc", () => {
  it("dit la vraie raison, simplement, sans tiret long", () => {
    const limite = decider({ type: "limite", fin: a(15), maintenant: MAINTENANT });
    const textes = [
      messageEchec({ type: "limite", ...limite, maintenant: MAINTENANT }),
      messageEchec({ type: "limite", mode: "le point du matin", prochaine: limite.prochaine, maintenant: MAINTENANT }),
      messageEchec({ type: "connexion", garder: true }),
      messageEchec({ type: "tours" }),
      messageEchec({ type: "surcharge", raison: "API Error: 529", ...decider({ type: "surcharge", maintenant: MAINTENANT }), maintenant: MAINTENANT }),
      messageEchec({ type: "autre", raison: "modèle inconnu", garder: false }),
      messageEchec({ type: "limite", partiel: true, prochaine: limite.prochaine, maintenant: MAINTENANT }),
    ];
    expect(textes).toEqual([
      "Limite de ton abonnement Claude atteinte : je ne peux pas te répondre avant 15 h. Ton message est gardé : je te réponds tout seul à ce moment-là.",
      "Limite de ton abonnement Claude atteinte : je ne peux pas faire le point du matin avant 15 h. Écris « POINT » à partir de 15 h pour l'avoir.",
      "Je ne suis plus connecté à Claude sur l'iMac : ouvre le Terminal, tape claude puis /login. Ton message est gardé.",
      "Ta demande m'a pris trop d'étapes et je me suis arrêté. Redis-la en plus court, ou en plusieurs fois.",
      "Claude ne répond pas en ce moment, même après un nouvel essai (API Error: 529). Ton message est gardé : je réessaie tout seul à 13 h 06.",
      "Je n'ai pas pu te répondre, même après un nouvel essai (modèle inconnu). Réécris-moi dans un moment.",
      "Je me suis arrêté avant la fin de ma réponse : limite de ton abonnement Claude, jusqu'à 15 h. Redemande-moi ce qui manque.",
    ]);
    for (const t of textes) expect(t).not.toMatch(/[—–]/);
  });

  it("pendant la limite : prévient Marc s'il écrit, se tait pour une reprise, laisse passer après", () => {
    const reprise = { type: "limite", quand: a(15, 1), fin: a(15), essais: 0 };
    expect(messageAttente({ reprise, origine: "marc", maintenant: MAINTENANT })).toBe(
      "Toujours à la limite de ton abonnement Claude, jusqu'à 15 h : ton message est gardé, je te réponds tout seul à ce moment-là.",
    );
    expect(messageAttente({ reprise, origine: "auto", maintenant: MAINTENANT })).toBe("");
    expect(messageAttente({ reprise, mode: "le point du soir", origine: "auto", maintenant: MAINTENANT })).toBe(
      "Pas de point du soir pour l'instant : limite de ton abonnement Claude, jusqu'à 15 h. Écris « POINT » à partir de 15 h pour l'avoir.",
    );
    expect(messageAttente({ reprise, origine: "marc", maintenant: a(15, 2) })).toBeNull();
    expect(messageAttente({ reprise: { ...reprise, type: "essai" }, origine: "marc", maintenant: MAINTENANT })).toBeNull();
    expect(messageAttente({ reprise: null, maintenant: MAINTENANT })).toBeNull();
  });
});

describe("Alfred : la reprise toute seule par l'écoute", () => {
  const dossier = () => {
    const d = mkdtempSync(join(tmpdir(), "alfred-reprise-"));
    mkdirSync(join(d, "etat"));
    return d;
  };

  it("relance seulement à l'heure prévue, et seulement si des messages de Marc attendent", () => {
    const d = dossier();
    const brut = JSON.stringify({ type: "limite", quand: a(15, 1), fin: a(15), essais: 0 });
    writeFileSync(join(d, "etat", "reprise.json"), brut);
    expect(repriseDue(d, a(16))).toBeNull();
    writeFileSync(join(d, "etat", "file-recue.txt"), "[12/11 12:55] Ok niveau mail tu es à jour ?\n");
    expect(repriseDue(d, a(14))).toBeNull();
    expect(repriseDue(d, a(16))).toBe(brut);
    expect(lireReprise(brut)).toMatchObject({ type: "limite" });
    expect(lireReprise("{}")).toBeNull();
  });

  it("oublie une reprise que le passage n'a pas touchée, pour ne pas boucler", () => {
    const d = dossier();
    const brut = JSON.stringify({ type: "essai", quand: 1, fin: null, essais: 1 });
    writeFileSync(join(d, "etat", "reprise.json"), brut);
    oublierRepriseSi(d, "autre contenu");
    expect(existsSync(join(d, "etat", "reprise.json"))).toBe(true);
    oublierRepriseSi(d, brut);
    expect(existsSync(join(d, "etat", "reprise.json"))).toBe(false);
  });
});

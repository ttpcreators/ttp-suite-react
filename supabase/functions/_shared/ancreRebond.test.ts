import { describe, expect, it } from "vitest";
import { ancrerAvis, envoisVers } from "./ancreRebond.ts";

// Données fictives (domaines d'exemple). Faux client : chaque table rend ses lignes, ou une erreur.
type Rep = { data: Record<string, unknown>[] | null; error: { message: string } | null };
function faux(tables: Record<string, Rep>) {
  const lus: string[] = [];
  const sb = {
    from(t: string) {
      lus.push(t);
      const rep = tables[t] ?? { data: [], error: null };
      const q = {
        select: () => q, eq: () => q, gte: () => q, or: () => q, limit: () => Promise.resolve(rep),
      };
      return q;
    },
  };
  return { sb, lus };
}

const TS = Date.parse("2026-11-26T09:00:00Z");
const avis = (snippet: string) => ({
  from: "Mail Delivery Subsystem <mailer-daemon@mx.exemple.net>", subject: "Undeliverable: Collab", snippet, ts: TS, avis: true, verifie: false,
});

describe("ancreRebond : envois de l'agence vers des adresses", () => {
  it("journal et file, adresses comparées exactement", async () => {
    const { sb } = faux({
      email_activity: { data: [{ contact_email: "Jean@Marque-Exemple.fr, anne@marque-exemple.fr", created_at: "2026-11-25T09:00:00Z" }, { contact_email: "jean@marque-exemple.fr.autre-exemple.fr", created_at: "2026-11-25T09:00:00Z" }], error: null },
      envoi_file: { data: [{ destinataires: "jean@marque-exemple.fr", envoye_at: "2026-11-24T09:00:00Z" }], error: null },
    });
    expect(await envoisVers(sb, ["jean@marque-exemple.fr"], "2026-11-19T00:00:00Z")).toEqual([
      { email: "jean@marque-exemple.fr", at: "2026-11-25T09:00:00Z" },
      { email: "jean@marque-exemple.fr", at: "2026-11-24T09:00:00Z" },
    ]);
  });
  it("journal illisible : null ; file illisible : ignorée ; rien à chercher : rien de lu", async () => {
    expect(await envoisVers(faux({ email_activity: { data: null, error: { message: "x" } } }).sb, ["jean@marque-exemple.fr"], "2026-11-19T00:00:00Z")).toBeNull();
    expect(await envoisVers(faux({ envoi_file: { data: null, error: { message: "x" } } }).sb, ["jean@marque-exemple.fr"], "2026-11-19T00:00:00Z")).toEqual([]);
    const vide = faux({});
    expect(await envoisVers(vide.sb, ["", "a*@marque-exemple.fr"], "2026-11-19T00:00:00Z")).toEqual([]);
    expect(vide.lus).toEqual([]);
  });
});

describe("ancreRebond : un avis ne compte que s'il suit un envoi réel", () => {
  it("avis après un envoi à l'adresse citée : gardé", async () => {
    const { sb } = faux({ email_activity: { data: [{ contact_email: "jean@marque-exemple.fr", created_at: "2026-11-26T08:00:00Z" }], error: null } });
    const m = avis("Your message wasn't delivered to jean@marque-exemple.fr");
    expect(await ancrerAvis(sb, [m], "ttpcreators.pro")).toBe(0);
    expect(m.avis).toBe(true);
  });
  it("aucun envoi à l'adresse citée, adresse introuvable, ou journal illisible : douteux", async () => {
    const sans = avis("Your message wasn't delivered to jean@marque-exemple.fr");
    expect(await ancrerAvis(faux({}).sb, [sans], "ttpcreators.pro")).toBe(1);
    expect(sans).toMatchObject({ avis: false, verifie: false });
    const muet = avis("Your message could not be delivered");
    expect(await ancrerAvis(faux({}).sb, [muet], "ttpcreators.pro")).toBe(1);
    expect(muet.avis).toBe(false);
    const panne = avis("Your message wasn't delivered to jean@marque-exemple.fr");
    expect(await ancrerAvis(faux({ email_activity: { data: null, error: { message: "x" } } }).sb, [panne], "ttpcreators.pro")).toBe(1);
    expect(panne.avis).toBe(false);
  });
  it("un mail qui n'est pas un avis n'est pas touché, et rien n'est lu", async () => {
    const f = faux({});
    const m = { ...avis("x"), avis: false, verifie: true };
    expect(await ancrerAvis(f.sb, [m], "ttpcreators.pro")).toBe(0);
    expect(m.verifie).toBe(true);
    expect(f.lus).toEqual([]);
  });
});

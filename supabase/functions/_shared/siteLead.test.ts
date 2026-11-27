import { describe, expect, it } from "vitest";
import { ilikeExact, lireLead, tacheLead, toucheLead } from "./siteLead.ts";

describe("lireLead", () => {
  it("lit et nettoie une demande", () => {
    const r = lireLead({ email: " Anais@Kosbiotic.COM ", marque: "Kosbiotic<script>", nom: "Anaïs", message: "Campagne\nde janvier" });
    expect(r).toEqual({ lead: { email: "anais@kosbiotic.com", marque: "Kosbiotic script", nom: "Anaïs", message: "Campagne\nde janvier" } });
  });
  it("refuse sans email valable ou sans marque", () => {
    expect(lireLead({ email: "pas-un-mail", marque: "X" })).toEqual({ erreur: "email" });
    expect(lireLead({ email: "a@b.fr", marque: "  " })).toEqual({ erreur: "marque" });
    expect(lireLead(null)).toEqual({ erreur: "email" });
  });
  it("piège à robots rempli : ignoré", () => {
    expect(lireLead({ email: "a@b.fr", marque: "X", site: "http://spam" })).toEqual({ robot: true });
  });
  it("borne les longueurs", () => {
    const r = lireLead({ email: "a@b.fr", marque: "M".repeat(500), message: "x".repeat(5000) });
    expect("lead" in r && r.lead.marque.length).toBe(80);
    expect("lead" in r && r.lead.message.length).toBe(1500);
  });
});

describe("touche et tâche", () => {
  const lead = { email: "a@b.fr", marque: "Nakd", nom: "", message: "Budget 3 000 €" };
  it("touche « réponse » par mail, datée", () => {
    expect(toucheLead(lead, new Date("2026-11-20T10:00:00Z"))).toMatchObject({ canal: "email", kind: "reponse", date: "2026-11-20T10:00:00.000Z", note: "Demande du roster via le site : Budget 3 000 €" });
  });
  it("tâche au format fixe", () => {
    expect(tacheLead(lead)).toBe("Lead site : Nakd demande le roster (tri : question du budget)");
  });
});

describe("ilikeExact", () => {
  it("neutralise les jokers d'un email pour un filtre ilike", () => {
    expect(ilikeExact("%@%.com")).toBe("\\%@\\%.com");
    expect(ilikeExact("prenom_nom@marque.fr")).toBe("prenom\\_nom@marque.fr");
    expect(ilikeExact("a\\b@c.fr")).toBe("a\\\\b@c.fr");
    expect(ilikeExact("simple@marque.fr")).toBe("simple@marque.fr");
  });
  it("marque et message coupés sans casser d'emoji", () => {
    const r = lireLead({ email: "a@b.fr", marque: `${"m".repeat(79)}😀`, message: `${"z".repeat(1499)}😀` });
    expect("lead" in r && r.lead.marque).toBe("m".repeat(79));
    expect("lead" in r && r.lead.message).toBe("z".repeat(1499));
  });
});

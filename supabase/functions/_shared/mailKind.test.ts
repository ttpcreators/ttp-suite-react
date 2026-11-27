import { describe, expect, it } from "vitest";
import { threadKind, type KindMsg } from "./mailKind.ts";

const msg = (from: string, subject: string, extra: Partial<KindMsg> & { h?: Record<string, string> } = {}): KindMsg => ({
  labelIds: extra.labelIds ?? ["INBOX", "CATEGORY_PERSONAL"],
  snippet: extra.snippet ?? "",
  headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...Object.entries(extra.h ?? {}).map(([name, value]) => ({ name, value }))],
});
const us = (m: KindMsg) => /@ttpcreators\.pro/i.test(m.headers.find((x) => x.name === "From")?.value ?? "");

// Cas tirés de la boîte (novembre 2026), noms et adresses changés.
describe("threadKind", () => {
  it("réponses automatiques", () => {
    expect(threadKind([msg("Inès Caron <ines@agence-exemple.fr>", "Accès limité à mes mails jusqu'au 28 novembre Re: Facturation Léna")], us)).toBe("auto");
    expect(threadKind([msg("Rebecca <rebecca@marque-exemple.fr>", "Réponse automatique : Justine Faure x Solvi")], us)).toBe("auto");
    expect(threadKind([msg("x <x@brand.fr>", "Re: Collab", { h: { "Auto-Submitted": "auto-replied" } })], us)).toBe("auto");
  });

  it("absence en dernier message d'une vraie conversation", () => {
    const fil = [msg("TTP <partnerships@ttpcreators.pro>", "Collab"), msg("Zoé <zoe@brand.fr>", "Automatic reply: Collab")];
    expect(threadKind(fil, us)).toBe("auto");
  });

  it("notifications et reçus", () => {
    expect(threadKind([msg("Youtrust pour Inès CARON <notifications@yousign.app>", "Marc, vous avez signé")], us)).toBe("notif");
    expect(threadKind([msg("GitHub <noreply@github.com>", "[GitHub] Claude is requesting updated permissions")], us)).toBe("notif");
    expect(threadKind([msg('"Supabase" <invoice+statements@supabase.com>', "Payment received")], us)).toBe("notif");
    expect(threadKind([msg('"DPD France" <enquetes@voc.dpd.fr>', "Quel est votre niveau de satisfaction ?")], us)).toBe("notif");
  });

  it("mails transférés", () => {
    expect(threadKind([msg("Lou <createur@exemple.fr>", "Fwd: Proposition de collaboration Kora")], us)).toBe("forward");
    expect(threadKind([msg("a <a@b.fr>", "TR: devis")], us)).toBe("forward");
  });

  it("newsletters", () => {
    expect(threadKind([msg("Brand <hello@brand.com>", "Nos nouveautés", { h: { "List-Id": "<news.brand.com>" } })], us)).toBe("newsletter");
    expect(threadKind([msg("Brand <hello@brand.com>", "Promo", { labelIds: ["INBOX", "CATEGORY_UPDATES"], h: { "List-Unsubscribe": "<mailto:u@brand.com>" } })], us)).toBe("newsletter");
  });

  it("les vraies demandes restent à traiter", () => {
    expect(threadKind([msg('"Inès Caron" <ines@agence-exemple.fr>', "Opportunité de collaboration : Nova PR Package")], us)).toBeNull();
    // Prospection d'une marque via un outil (List-Unsubscribe seul) : reste une vraie demande.
    expect(threadKind([msg("Tina <tina@marque-exemple.fr>", "Collab", { h: { "List-Unsubscribe": "<mailto:u@hubspot.com>" } })], us)).toBeNull();
    expect(threadKind([msg("Marketing <marketing@brand.fr>", "Partenariat avec Léna")], us)).toBeNull();
    // Conversation où l'agence a écrit : jamais rangée en notification, même depuis un robot.
    const fil = [msg("TTP <talent@ttpcreators.pro>", "Fwd: devis"), msg("Compta <invoice@brand.fr>", "Re: Fwd: devis")];
    expect(threadKind(fil, us)).toBeNull();
    // Dernier message de l'agence : déjà traité.
    expect(threadKind([msg("a <a@b.fr>", "Collab"), msg("TTP <partnerships@ttpcreators.pro>", "Re: Collab")], us)).toBeNull();
  });
});

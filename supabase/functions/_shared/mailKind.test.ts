import { describe, expect, it } from "vitest";
import { threadKind, type KindMsg } from "./mailKind.ts";

const msg = (from: string, subject: string, extra: Partial<KindMsg> & { h?: Record<string, string> } = {}): KindMsg => ({
  labelIds: extra.labelIds ?? ["INBOX", "CATEGORY_PERSONAL"],
  snippet: extra.snippet ?? "",
  headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...Object.entries(extra.h ?? {}).map(([name, value]) => ({ name, value }))],
});
const us = (m: KindMsg) => /@ttpcreators\.pro/i.test(m.headers.find((x) => x.name === "From")?.value ?? "");

// Cas réels de la boîte (novembre 2026).
describe("threadKind", () => {
  it("réponses automatiques", () => {
    expect(threadKind([msg("Lorna Wood <lorna@lornawood.fr>", "Accès limité à mes mails jusqu'au 28 novembre Re: Facturation Léna")], us)).toBe("auto");
    expect(threadKind([msg("Rebecca <rebecca@steam-one.com>", "Réponse automatique : Justine Gentet x SteamOne")], us)).toBe("auto");
    expect(threadKind([msg("x <x@brand.fr>", "Re: Collab", { h: { "Auto-Submitted": "auto-replied" } })], us)).toBe("auto");
  });

  it("absence en dernier message d'une vraie conversation", () => {
    const fil = [msg("TTP <partnerships@ttpcreators.pro>", "Collab"), msg("Zoé <zoe@brand.fr>", "Automatic reply: Collab")];
    expect(threadKind(fil, us)).toBe("auto");
  });

  it("notifications et reçus", () => {
    expect(threadKind([msg("Youtrust pour Lorna WOOD <notifications@yousign.app>", "Marc, vous avez signé")], us)).toBe("notif");
    expect(threadKind([msg("GitHub <noreply@github.com>", "[GitHub] Claude is requesting updated permissions")], us)).toBe("notif");
    expect(threadKind([msg('"Supabase" <invoice+statements@supabase.com>', "Payment received")], us)).toBe("notif");
    expect(threadKind([msg('"DPD France" <enquetes@voc.dpd.fr>', "Quel est votre niveau de satisfaction ?")], us)).toBe("notif");
  });

  it("mails transférés", () => {
    expect(threadKind([msg("lunivana <contact.lunivana@gmail.com>", "Fwd: Proposition de collaboration TopTop")], us)).toBe("forward");
    expect(threadKind([msg("a <a@b.fr>", "TR: devis")], us)).toBe("forward");
  });

  it("newsletters", () => {
    expect(threadKind([msg("Brand <hello@brand.com>", "Nos nouveautés", { h: { "List-Id": "<news.brand.com>" } })], us)).toBe("newsletter");
    expect(threadKind([msg("Brand <hello@brand.com>", "Promo", { labelIds: ["INBOX", "CATEGORY_UPDATES"], h: { "List-Unsubscribe": "<mailto:u@brand.com>" } })], us)).toBe("newsletter");
  });

  it("les vraies demandes restent à traiter", () => {
    expect(threadKind([msg('"Léane Vabre" <leane@thenode.gg>', "Opportunité de collaboration – Opera Air PR Package")], us)).toBeNull();
    // Prospection d'une marque via un outil (List-Unsubscribe seul) : reste une vraie demande.
    expect(threadKind([msg("Tina <tina@flexihome.fr>", "Collab", { h: { "List-Unsubscribe": "<mailto:u@hubspot.com>" } })], us)).toBeNull();
    expect(threadKind([msg("Marketing <marketing@brand.fr>", "Partenariat avec Léna")], us)).toBeNull();
    // Conversation où l'agence a écrit : jamais rangée en notification, même depuis un robot.
    const fil = [msg("TTP <talent@ttpcreators.pro>", "Fwd: devis"), msg("Compta <invoice@brand.fr>", "Re: Fwd: devis")];
    expect(threadKind(fil, us)).toBeNull();
    // Dernier message de l'agence : déjà traité.
    expect(threadKind([msg("a <a@b.fr>", "Collab"), msg("TTP <partnerships@ttpcreators.pro>", "Re: Collab")], us)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { separerNotes } from "./texte.mjs";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { messagesFor } from "./telegram.mjs";
import { problemeTexteDestinataire } from "../../supabase/functions/_shared/texteDestinataire.ts";

const PROPRE = "Hello Léa !\n\nNova aimerait un Reel pour la rentrée, 600 € HT.\nNB : le tournage peut se faire chez toi.\nTu me dis ?";
const SALE = "Voici le message pour Léa :\nHello [prénom] !\nNova aimerait un Reel.\nÀ VÉRIFIER : le prix exact\nNote pour Marc : elle a refusé l'UGC en octobre";

describe("Alfred : le texte à envoyer ne contient que le message", () => {
  it("garde un message propre tel quel, même avec un « NB » adressé au destinataire", () => {
    expect(separerNotes(PROPRE)).toEqual({ texte: PROPRE, notes: [], trous: [] });
    expect(problemeTexteDestinataire(PROPRE)).toBeNull();
  });

  it("sort l'introduction, les « À VÉRIFIER » et les notes pour Marc, et repère les trous", () => {
    const r = separerNotes(SALE);
    expect(r.texte).toBe("Hello [prénom] !\nNova aimerait un Reel.");
    expect(r.notes).toEqual(["Voici le message pour Léa :", "À VÉRIFIER : le prix exact", "Note pour Marc : elle a refusé l'UGC en octobre"]);
    expect(r.trous).toEqual(["[prénom]"]);
  });

  it("le connecteur refuse le même brouillon, avec la raison", () => {
    expect(problemeTexteDestinataire(SALE)).toMatch(/notes pour Marc.*trous à compléter \(\[prénom\]\)/);
    expect(problemeTexteDestinataire("Bonjour Lorna,\n\nMerci pour votre retour.")).toBeNull();
  });

  it("sur Telegram, seul le message est dans le bloc à copier ; les notes passent dessous", () => {
    const [m] = messagesFor("02-whatsapp.txt", "Pour Léa sur WhatsApp\n" + SALE);
    const copie = m.boutons?.[0]?.find((b: { copy_text?: { text: string } }) => b.copy_text)?.copy_text.text;
    expect(copie).toBe("Hello [prénom] !\nNova aimerait un Reel.");
    expect(m.plain).toContain("À compléter avant d'envoyer : [prénom]");
    expect(m.plain).toContain("Note pour Marc : elle a refusé l'UGC en octobre");
  });
});

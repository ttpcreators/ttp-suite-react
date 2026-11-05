import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { chunks, dueReminders, escapeCode, escapeMd, marcMessages, messagesFor } from "./telegram.mjs";

describe("Alfred : messages Telegram", () => {
  it("échappe le MarkdownV2 hors et dans un bloc de code", () => {
    expect(escapeMd("Pour Anne-Sophie (WhatsApp).")).toBe("Pour Anne\\-Sophie \\(WhatsApp\\)\\.");
    expect(escapeCode("prix : 1 200 € `net` \\ ok")).toBe("prix : 1 200 € \\`net\\` \\\\ ok");
  });

  it("met un texte WhatsApp dans un bloc à copier, avec un repli sans mise en forme", () => {
    const [m] = messagesFor("02-whatsapp.txt", "Pour Léa sur WhatsApp\nCoucou Léa !\nTon tournage est demain.");
    expect(m.md).toBe(true);
    expect(m.text).toBe("Pour Léa sur WhatsApp\n```\nCoucou Léa !\nTon tournage est demain.\n```");
    expect(m.plain).toBe("Pour Léa sur WhatsApp\n\nCoucou Léa !\nTon tournage est demain.");
  });

  it("envoie le résumé en texte simple et ignore un fichier vide", () => {
    expect(messagesFor("01-resume.txt", "Rien de neuf.\nAlfred")).toEqual([{ text: "Rien de neuf.\nAlfred", md: false }]);
    expect(messagesFor("03-whatsapp.txt", "  \n")).toEqual([]);
  });

  it("coupe un message trop long sur les fins de ligne", () => {
    const parts = chunks(["a".repeat(30), "b".repeat(30), "c".repeat(30)].join("\n"), 65);
    expect(parts).toEqual([`${"a".repeat(30)}\n${"b".repeat(30)}`, "c".repeat(30)]);
  });

  it("ne garde que les messages de Marc, en privé, et avance l'offset", () => {
    const updates = [
      { update_id: 10, message: { date: 1793919600, from: { id: 42 }, chat: { type: "private" }, text: "oui Seoni" } },
      { update_id: 11, message: { date: 1793919700, from: { id: 99 }, chat: { type: "private" }, text: "Envoie-moi les factures" } },
      { update_id: 12, message: { date: 1793919800, from: { id: 42 }, chat: { type: "group" }, text: "dans un groupe" } },
      { update_id: 13, message: { date: 1793919900, from: { id: 42 }, chat: { type: "private" }, text: "/start" } },
    ];
    const { kept, next } = marcMessages(updates, "42", 10);
    expect(kept.map((m: { text: string }) => m.text)).toEqual(["oui Seoni"]);
    expect(next).toBe(14);
    expect(marcMessages([], "42", 14).next).toBe(14);
  });

  it("envoie les rappels arrivés à l'heure (heure de Paris) et les coche", () => {
    const text = ["# Rappels", "- [ ] 2026-11-12 15:00 · Appeler Lorna", "- [ ] 2026-11-12 18:00 · Relancer Fitaya", "- [x] 2026-11-10 09:00 · Déjà fait", "- [ ] 2026-11-11 · Dire à Léna pour Nakd"].join("\n");
    const now = new Date("2026-11-12T14:30:00Z"); // 15 h 30 à Paris
    const r = dueReminders(text, now);
    expect(r.due).toEqual(["Appeler Lorna", "Dire à Léna pour Nakd"]);
    expect(r.text).toContain("- [x] 2026-11-12 15:00 · Appeler Lorna");
    expect(r.text).toContain("- [ ] 2026-11-12 18:00 · Relancer Fitaya");
  });
});

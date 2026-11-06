import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { chunks, dueReminders, escapeCode, escapeMd, frameTimes, marcMessages, mediaOf, messagesFor } from "./telegram.mjs";

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

  it("garde aussi un vocal de Marc, pour le transcrire", () => {
    const updates = [{ update_id: 20, message: { date: 1793919600, from: { id: 42 }, chat: { type: "private" }, voice: { file_id: "VOC1", duration: 12 } } }];
    const { kept } = marcMessages(updates, "42", 0);
    expect(kept).toHaveLength(1);
    expect(kept[0].voice).toBe("VOC1");
    expect(kept[0].text).toBe("");
  });

  it("garde le message auquel Marc répond, pour le contexte", () => {
    const updates = [{
      update_id: 30,
      message: {
        date: 1793919600, from: { id: 42 }, chat: { type: "private" }, text: "oui",
        reply_to_message: { from: { id: 7, is_bot: true }, text: "Mail à Lorna (Seoni) · réponds « oui Seoni » pour l'envoyer" },
      },
    }];
    const [m] = marcMessages(updates, "42", 0).kept;
    expect(m.text).toBe("oui");
    expect(m.reply).toBe("(en réponse à ton message : « Mail à Lorna (Seoni) · réponds « oui Seoni » pour l'envoyer »)");
  });

  it("repère la preview d'un créateur (vidéo, photo, document) et garde le message", () => {
    expect(mediaOf({ video: { file_id: "V", file_size: 1000, file_name: "lena.mp4" } })).toEqual({ fileId: "V", kind: "video", name: "lena.mp4", size: 1000 });
    expect(mediaOf({ photo: [{ file_id: "p1" }, { file_id: "p2", file_size: 50 }] })?.fileId).toBe("p2");
    expect(mediaOf({ document: { file_id: "D", mime_type: "application/pdf", file_name: "brief.pdf" } })?.kind).toBe("pdf");
    expect(mediaOf({ document: { file_id: "Z", mime_type: "application/zip" } })).toBeNull();
    const { kept } = marcMessages([{ update_id: 40, message: { date: 1793919600, from: { id: 42 }, chat: { type: "private" }, video: { file_id: "V" }, caption: "preview Léna Yade" } }], "42", 0);
    expect(kept[0].media?.kind).toBe("video");
    expect(kept[0].text).toBe("preview Léna Yade");
  });

  it("choisit les images d'une vidéo : l'accroche de près, puis toute la durée", () => {
    expect(frameTimes(11)).toEqual([0, 0.5, 1, 1.5, 2.5, 4, 6, 8, 10, 10.5]);
    const long = frameTimes(60);
    expect(long.slice(0, 5)).toEqual([0, 0.5, 1, 1.5, 2.5]);
    expect(long.length).toBeLessThanOrEqual(25);
    expect(frameTimes(0)).toEqual([]);
  });
});

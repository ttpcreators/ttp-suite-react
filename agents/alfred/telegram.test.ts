import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { chunks, dueReminders, escapeCode, escapeMd, frameTimes, lienSimple, marcMessages, mediaOf, messagesFor, pdfArgs, trouverLien } from "./telegram.mjs";

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
    expect(kept[0].id).toBeNull(); // pas de message_id dans ce test
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
    // Un contrat Word d'une marque : lu après conversion en texte.
    expect(mediaOf({ document: { file_id: "W", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", file_name: "contrat.docx" } })?.kind).toBe("doc");
    expect(mediaOf({ document: { file_id: "W2", mime_type: "application/octet-stream", file_name: "Contrat Marque.DOC" } })?.kind).toBe("doc");
    expect(mediaOf({ document: { file_id: "Z", mime_type: "application/zip", file_name: "x.zip" } })).toBeNull();
    expect(mediaOf({ document: { file_id: "D", mime_type: "application/pdf", file_name: "brief.pdf" } })?.kind).toBe("pdf");
    expect(mediaOf({ document: { file_id: "Z", mime_type: "application/zip" } })).toBeNull();
    const { kept } = marcMessages([{ update_id: 40, message: { date: 1793919600, from: { id: 42 }, chat: { type: "private" }, video: { file_id: "V" }, caption: "preview Léna Yade" } }], "42", 0);
    expect(kept[0].media?.kind).toBe("video");
    expect(kept[0].text).toBe("preview Léna Yade");
  });

  it("choisit les images d'une vidéo : l'accroche toutes les demi secondes, puis une par seconde", () => {
    expect(frameTimes(11)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 10.5]);
    const minute = frameTimes(60);
    expect(minute.slice(0, 6)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(minute).toContain(59);
    const long = frameTimes(300);
    expect(long.length).toBeLessThanOrEqual(70);
    expect(frameTimes(0)).toEqual([]);
  });

  it("repère un lien de vidéo à télécharger", () => {
    expect(trouverLien("preview Léna https://we.tl/t-AbC123 merci")).toEqual({ kind: "wetransfer", url: "https://we.tl/t-AbC123" });
    expect(trouverLien("https://wetransfer.com/downloads/abc/def.")?.url).toBe("https://wetransfer.com/downloads/abc/def");
    expect(trouverLien("https://www.swisstransfer.com/d/1b2c3d4e-0000-4000-8000-123456789abc")?.kind).toBe("swisstransfer");
    expect(trouverLien("https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing")?.kind).toBe("drive");
    expect(trouverLien("https://exemple.fr/v/preview.MOV")?.kind).toBe("direct");
    expect(trouverLien("le site https://ttpcreators.pro/")).toBeNull();
    expect(lienSimple("drive", "https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing")).toBe("https://drive.usercontent.google.com/download?id=1AbCdEfGhIjK&export=download&confirm=t");
    expect(lienSimple("dropbox", "https://www.dropbox.com/scl/fi/xyz/preview.mp4?rlkey=k&dl=0")).toBe("https://www.dropbox.com/scl/fi/xyz/preview.mp4?rlkey=k&dl=1");
  });

  it("garde le numéro du message de Marc, pour y répondre en le citant", () => {
    const [m] = marcMessages([{ update_id: 50, message: { message_id: 321, date: 1793919600, from: { id: 42 }, chat: { type: "private" }, text: "où en est Fitaya ?" } }], "42", 0).kept;
    expect(m.id).toBe(321);
  });
});

describe("Alfred : documents en PDF", () => {
  it("imprime le HTML sans en-tête, vers le PDF demandé", () => {
    const a = pdfArgs("/tmp/x/02-proposition.html", "/tmp/x/02-proposition.pdf");
    expect(a).toContain("--headless");
    expect(a).toContain("--print-to-pdf=/tmp/x/02-proposition.pdf");
    expect(a[a.length - 1]).toBe("file:///tmp/x/02-proposition.html");
  });
});

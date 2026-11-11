import { describe, expect, it } from "vitest";
// @ts-expect-error : module JavaScript d'Alfred, sans types.
import { boutonsLiens, chunks, clavier, clavierConfirmation, etapeToucher, dossierEnvoi, dueReminders, extraireLiens, fichierRecuIds, fichiersPrets, escapeCode, escapeMd, frameTimes, lienSimple, marcMessages, mediaOf, messagesFor, nomAffiche, nomPieceJointe, pdfArgs, refusPiece, trouverLien } from "./telegram.mjs";

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

  it("met le résumé en forme légère et ignore un fichier vide", () => {
    expect(messagesFor("01-resume.txt", "Rien de neuf.\nAlfred")).toEqual([{ text: "Rien de neuf.\nAlfred", html: true, plain: "Rien de neuf.\nAlfred" }]);
    const [m] = messagesFor("01-resume.txt", "**Point du matin**\nURGENT : facture <Fitaya> & relance\n> citation\nOuvrir dans l'app : https://app.ttpcreators.pro/?open=mails");
    expect(m.text).toBe("<b>Point du matin</b>\n\n<b>URGENT</b> : facture &lt;Fitaya&gt; &amp; relance\n<blockquote>citation</blockquote>");
    expect(m.boutons).toEqual([[{ text: "Ouvrir dans l'app", web_app: { url: "https://app.ttpcreators.pro/?open=mails" } }]]);
    expect(messagesFor("03-whatsapp.txt", "  \n")).toEqual([]);
  });

  it("ouvre TTP Suite dans Telegram et les autres liens dans le navigateur", () => {
    expect(boutonsLiens([{ text: "App", url: "https://app.ttpcreators.pro" }, { text: "Spark", url: "https://sparkmailapp.com/dpl/bl?token=x" }, { text: "Piège", url: "https://app.ttpcreators.pro.exemple.com/x" }])).toEqual([
      { text: "App", web_app: { url: "https://app.ttpcreators.pro" } },
      { text: "Spark", url: "https://sparkmailapp.com/dpl/bl?token=x" },
      { text: "Piège", url: "https://app.ttpcreators.pro.exemple.com/x" },
    ]);
  });

  it("présente un mail à valider avec ses boutons Envoyer et Spark", () => {
    const [m] = messagesFor(
      "02-mail.txt",
      "Mail à Erwann (Marque Test) · réponds « oui Erwann » pour l'envoyer\nÀ : erwann@exemple.fr · Objet : Rendez vous\n\nBonjour Erwann,\nLequel vous arrange ?\n\nÀ VÉRIFIER : les créneaux\n\nOuvrir dans Spark : https://sparkmailapp.com/dpl/bl?token=abc",
    );
    expect(m.text).toBe(
      "<b>Mail à Erwann (Marque Test)</b>\nÀ : erwann@exemple.fr · Objet : Rendez vous\n\n<blockquote>Bonjour Erwann,\nLequel vous arrange ?</blockquote>\n\n<b>À vérifier</b> : les créneaux",
    );
    expect(m.boutons).toEqual([[{ text: "Envoyer", callback_data: "oui Erwann" }, { text: "Ouvrir dans Spark", url: "https://sparkmailapp.com/dpl/bl?token=abc" }]]);
    // Brouillon dans la boîte d'un créateur : Alfred ne peut pas l'envoyer, pas de bouton Envoyer.
    const [s] = messagesFor("03-mail.txt", "Mail à Lola (Marque) · à envoyer depuis Spark\n\nHello\n\nOuvrir dans Spark : https://sparkmailapp.com/dpl/bl?token=x");
    expect(s.boutons).toEqual([[{ text: "Ouvrir dans Spark", url: "https://sparkmailapp.com/dpl/bl?token=x" }]]);
  });

  it("transforme le toucher de Marc sur Envoyer en « oui », et ignore les autres", () => {
    const toucher = (from: number, data: string) => ({ update_id: 20, callback_query: { id: "cb1", from: { id: from }, data, message: { message_id: 7, chat: { id: 42 }, text: "Mail à Erwann", reply_markup: { inline_keyboard: [] } } } });
    const { kept, next } = marcMessages([toucher(42, "oui Erwann")], 42, 0);
    expect(next).toBe(21);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ id: 7, text: "oui Erwann (bouton « Envoyer »)", reply: "(en réponse à ton message : « Mail à Erwann »)" });
    expect(marcMessages([toucher(99, "oui Erwann")], 42, 0).kept).toEqual([]);
    expect(marcMessages([{ update_id: 21, callback_query: { id: "x", from: { id: 42 }, data: "" } }], 42, 0).kept).toEqual([]);
  });

  it("fait des boutons d'action, et garde en texte un message trop long pour Telegram", () => {
    const texte = `URGENT : reverser 280 € à Léna\nBouton : Fait (Reverser Léna) = fait tâche d57bddd4-7c30-4e72-a1ac-5139047bbc46\nBouton : Rappelle-moi demain = rappelle-moi demain : reversement Léna\nBouton : Trop long = ${"x".repeat(70)}`;
    const { actions, texte: reste } = extraireLiens(texte);
    expect(actions).toEqual([
      { text: "Fait (Reverser Léna)", callback_data: "fait tâche d57bddd4-7c30-4e72-a1ac-5139047bbc46" },
      { text: "Rappelle-moi demain", callback_data: "rappelle-moi demain : reversement Léna" },
    ]);
    expect(reste).toContain("Bouton : Trop long");
    expect(clavier([{ text: "Ouvrir dans l'app", url: "https://app.ttpcreators.pro" }], [...actions, actions[0]]).boutons).toHaveLength(3);
    expect(clavier([], [])).toEqual({});
    // Un toucher sur une action arrive avec son libellé.
    const u = { update_id: 30, callback_query: { id: "c", from: { id: 42 }, data: actions[0].callback_data, message: { message_id: 9, chat: { id: 42 }, text: "Point", reply_markup: { inline_keyboard: [actions] } } } };
    expect(marcMessages([u], 42, 0).kept[0].text).toBe("fait tâche d57bddd4-7c30-4e72-a1ac-5139047bbc46 (bouton « Fait (Reverser Léna) »)");
  });

  it("ajoute un bouton Copier sous un texte WhatsApp court", () => {
    const [m] = messagesFor("02-whatsapp.txt", "Pour Léa sur WhatsApp\nCoucou Léa !");
    expect(m.boutons).toEqual([[{ text: "Copier", copy_text: { text: "Coucou Léa !" } }]]);
    const [long] = messagesFor("03-whatsapp.txt", `Pour Léa sur WhatsApp\n${"a".repeat(300)}`);
    expect(long.boutons).toBeUndefined();
  });

  it("ouvre la discussion WhatsApp avec le texte déjà écrit quand le numéro est donné", () => {
    const [m] = messagesFor("02-whatsapp.txt", "Pour Léa sur WhatsApp · 33 6 00 00 00 00\nCoucou Léa & co !");
    expect(m.text.startsWith("Pour Léa sur WhatsApp\n")).toBe(true);
    expect(m.plain).not.toContain("33");
    expect(m.boutons).toEqual([[{ text: "Ouvrir dans WhatsApp", url: "https://wa.me/33600000000?text=Coucou%20L%C3%A9a%20%26%20co%20!" }, { text: "Copier", copy_text: { text: "Coucou Léa & co !" } }]]);
    const [long] = messagesFor("03-whatsapp.txt", `Pour Léa sur WhatsApp · 33600000000\n${"é".repeat(800)}`);
    expect(long.boutons[0][0]).toEqual({ text: "Ouvrir dans WhatsApp", url: "https://wa.me/33600000000" });
    const [groupe] = messagesFor("04-whatsapp.txt", "Pour le groupe Léna × TTP sur WhatsApp\nHello");
    expect(groupe.boutons).toEqual([[{ text: "Copier", copy_text: { text: "Hello" } }]]);
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

  it("demande une confirmation avant d'agir sur un bouton", () => {
    const attente = { abc123: { data: "oui Erwann", libelle: "Envoyer", clavier: [], at: 1 } };
    expect(etapeToucher("oui Erwann", attente)).toEqual({ action: "demander" });
    expect(etapeToucher("ok:abc123", attente)).toMatchObject({ action: "valider", id: "abc123", entree: { data: "oui Erwann" } });
    expect(etapeToucher("non:abc123", attente)).toMatchObject({ action: "annuler", id: "abc123" });
    expect(etapeToucher("ok:zzz999", attente)).toEqual({ action: "perime" });
    expect(clavierConfirmation("abc123", "Envoyer")).toEqual([[{ text: "Confirmer : Envoyer", callback_data: "ok:abc123" }, { text: "Annuler", callback_data: "non:abc123" }]]);
  });
});

describe("Alfred : pièces jointes des mails", () => {
  it("range la pièce jointe dans l'ordre d'envoi, sous son nom d'origine nettoyé", () => {
    expect(nomPieceJointe("Vaillant x Justine - Script Black Friday 2026.pdf", "3")).toBe("03-Vaillant x Justine - Script Black Friday 2026.pdf");
    const piege = nomPieceJointe("../../config.env/brief.pdf");
    expect(piege.startsWith("05-")).toBe(true);
    expect(piege).not.toContain("/");
    expect(nomPieceJointe("brief:final\nv2.pdf", "abc")).toBe("05-brief final v2.pdf");
    expect(nomPieceJointe("")).toBeNull();
  });

  it("montre à Marc le nom sans le numéro d'ordre", () => {
    expect(nomAffiche("03-Vaillant x Justine - Script.pdf")).toBe("Vaillant x Justine - Script.pdf");
    expect(nomAffiche("contrat-seoni.pdf")).toBe("contrat-seoni.pdf");
    expect(nomAffiche("2026-11-11.pdf")).toBe("2026-11-11.pdf");
  });

  it("refuse ce qui ne peut pas partir sur Telegram", () => {
    const ok = { path: "/cache/x.pdf", name: "Script.pdf", size: 38_000 };
    expect(refusPiece(ok)).toBeNull();
    expect(refusPiece({ ...ok, name: "notes.txt" })).toMatch(/non pris en charge/);
    expect(refusPiece({ ...ok, name: "page.html" })).toMatch(/non pris en charge/);
    expect(refusPiece({ ...ok, size: 60 * 1024 * 1024 })).toMatch(/50 Mo/);
    expect(refusPiece({})).toMatch(/introuvable/);
  });
});

describe("Alfred : envoi au fil de l'eau", () => {
  it("n'envoie que les fichiers finis depuis 3 secondes, dans l'ordre des noms", () => {
    const t = 1_000_000;
    const entrees = [
      { name: "02-copier.txt", size: 120, mtimeMs: t - 3_500 },
      { name: "01-resume.txt", size: 40, mtimeMs: t - 9_000 },
      { name: "03-mail.txt", size: 300, mtimeMs: t - 1_000 },
      { name: "04-vide.txt", size: 0, mtimeMs: t - 9_000 },
      { name: ".deja-cite", size: 1, mtimeMs: t - 9_000 },
    ];
    expect(fichiersPrets(entrees, t)).toEqual(["01-resume.txt", "02-copier.txt"]);
    expect(fichiersPrets(entrees, t + 3_000)).toEqual(["01-resume.txt", "02-copier.txt", "03-mail.txt"]);
  });

  it("n'écrit que dans les dossiers d'envoi et ne lit que les fichiers de messages d'Alfred", () => {
    expect(dossierEnvoi("etat/envoi-reponse")).toBe("etat/envoi-reponse");
    expect(dossierEnvoi("etat/envoi")).toBe("etat/envoi");
    expect(dossierEnvoi("../../Desktop")).toBe("etat/envoi");
    expect(dossierEnvoi(undefined)).toBe("etat/envoi");
    expect(fichierRecuIds("etat/recu-reponse-ids.txt")).toBe("etat/recu-reponse-ids.txt");
    expect(fichierRecuIds("/etc/passwd")).toBe("etat/recu-ids.txt");
  });
});

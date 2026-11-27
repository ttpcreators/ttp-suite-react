import { describe, expect, it } from "vitest";
import { backupMonth, destinatairesSauvegarde, mediakitPages, mediakitSlug, mimeMessage, pdfLinksIn, safeAppState, toBase64, toCsv } from "./backup.ts";

describe("sauvegarde mensuelle", () => {
  it("CSV Excel France : BOM, « ; », guillemets, objets en JSON", () => {
    const csv = toCsv([{ nom: "Léa", note: 'dit "oui"; ok', tags: ["a", "b"] }, { nom: "Nike", ville: "Lyon" }]);
    expect(csv.startsWith("﻿nom;note;tags;ville\r\n")).toBe(true);
    expect(csv).toContain('Léa;"dit ""oui""; ok";"[""a"",""b""]";');
    expect(csv).toContain("Nike;;;Lyon");
    expect(toCsv([])).toBe("﻿\r\n");
  });
  it("mois de Paris", () => {
    expect(backupMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
  });
  it("jamais le coffre des mots de passe", () => {
    expect(safeAppState({ credVault: { x: 1 }, invoiceIssuer: { name: "TTP" } })).toEqual({ invoiceIssuer: { name: "TTP" } });
  });
  it("trouve les media kits et leurs PDF", () => {
    const xml = "<urlset><url><loc>https://ttpcreators.pro/</loc></url><url><loc>https://ttpcreators.pro/mediakit/lena/</loc></url><url><loc> https://ttpcreators.pro/mediakit/agence/ </loc></url></urlset>";
    expect(mediakitPages(xml, "https://ttpcreators.pro")).toEqual(["https://ttpcreators.pro/mediakit/lena/", "https://ttpcreators.pro/mediakit/agence/"]);
    expect(mediakitSlug("https://ttpcreators.pro/mediakit/lena/en/")).toBe("lena-en");
    const html = '<a href="media-kit-abc.pdf">PDF</a><a href="/assets/Agence.pdf?v=2">x</a><a href="media-kit-abc.pdf">bis</a>';
    expect(pdfLinksIn(html, "https://ttpcreators.pro/mediakit/agence/")).toEqual([
      "https://ttpcreators.pro/mediakit/agence/media-kit-abc.pdf",
      "https://ttpcreators.pro/assets/Agence.pdf",
    ]);
  });
  it("destinataires : seulement des fondateurs, jamais de repli quand une liste est réglée", () => {
    const fondateurs = ["a@agence.test", "B@agence.test ", "c@agence.test"];
    // Pas de liste (ou liste vide) : tous les fondateurs.
    expect(destinatairesSauvegarde(undefined, fondateurs)).toEqual({ to: ["a@agence.test", "b@agence.test", "c@agence.test"], ignorees: 0 });
    expect(destinatairesSauvegarde([], fondateurs)).toEqual({ to: ["a@agence.test", "b@agence.test", "c@agence.test"], ignorees: 0 });
    // Liste réglée : ses adresses qui sont des fondateurs, sans casse ni doublon.
    expect(destinatairesSauvegarde([" A@agence.test", "b@agence.test", "a@agence.test"], fondateurs)).toEqual({ to: ["a@agence.test", "b@agence.test"], ignorees: 0 });
    // Une adresse qui n'est pas un fondateur est écartée, et comptée pour le dire dans le mail.
    expect(destinatairesSauvegarde(["a@agence.test", "faute@agence.test"], fondateurs)).toEqual({ to: ["a@agence.test"], ignorees: 1 });
    // Aucune adresse de la liste n'est un fondateur : personne (pas de repli vers les trois).
    expect(destinatairesSauvegarde(["faute@agence.test"], fondateurs)).toEqual({ error: "destinataires_inconnus" });
    expect(destinatairesSauvegarde(["<adresse de connexion>"], fondateurs)).toEqual({ error: "destinataires_inconnus" });
    expect(destinatairesSauvegarde("a@agence.test", fondateurs)).toEqual({ to: ["a@agence.test"], ignorees: 0 });
    expect(destinatairesSauvegarde({ a: 1 }, fondateurs)).toEqual({ error: "destinataires_inconnus" });
    // Réglages illisibles : personne ; aucun fondateur : personne.
    expect(destinatairesSauvegarde(undefined, fondateurs, false)).toEqual({ error: "reglages_illisibles" });
    expect(destinatairesSauvegarde(undefined, [])).toEqual({ error: "aucun_destinataire" });
  });
  it("mail avec pièce jointe", () => {
    const raw = mimeMessage({ from: "a@x.fr", to: ["b@y.fr"], subject: "Sauvegarde · octobre", html: "<p>ok</p>", attachments: [{ filename: "s.zip", mimeType: "application/zip", bytes: new Uint8Array([1, 2, 3]) }], boundary: "B" });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="B"');
    expect(raw).toContain('filename="s.zip"');
    expect(raw).toContain(toBase64(new Uint8Array([1, 2, 3])));
    expect(raw.trim().endsWith("--B--")).toBe(true);
  });
});

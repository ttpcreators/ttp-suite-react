import { describe, expect, it } from "vitest";
import { backupMonth, mediakitPages, mediakitSlug, mimeMessage, pdfLinksIn, safeAppState, toBase64, toCsv } from "./backup.ts";

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
  it("mail avec pièce jointe", () => {
    const raw = mimeMessage({ from: "a@x.fr", to: ["b@y.fr"], subject: "Sauvegarde · octobre", html: "<p>ok</p>", attachments: [{ filename: "s.zip", mimeType: "application/zip", bytes: new Uint8Array([1, 2, 3]) }], boundary: "B" });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="B"');
    expect(raw).toContain('filename="s.zip"');
    expect(raw).toContain(toBase64(new Uint8Array([1, 2, 3])));
    expect(raw.trim().endsWith("--B--")).toBe(true);
  });
});

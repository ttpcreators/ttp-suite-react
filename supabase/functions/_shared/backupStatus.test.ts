import { describe, expect, it } from "vitest";
import { asBackupStatus, backupErrorText, backupStatusLine, backupWhen, latestStatus, statusFromResult } from "./backupStatus.ts";

const NOW = new Date("2026-11-18T10:00:00Z");
const START = new Date("2026-11-01T02:00:00Z"); // 03:00 à Paris
const END = new Date("2026-11-01T02:01:30Z");

describe("état de la sauvegarde mensuelle", () => {
  it("aucune sauvegarde : ligne d'attente", () => {
    expect(backupStatusLine(undefined, NOW)).toEqual({ text: "Aucune sauvegarde encore", tone: "muted" });
    expect(backupStatusLine({ at: "pas une date" }, NOW).text).toBe("Aucune sauvegarde encore");
    expect(backupStatusLine([1], NOW).text).toBe("Aucune sauvegarde encore");
  });

  it("date et heure de Paris, l'année seulement si elle change", () => {
    expect(backupWhen(START, NOW)).toBe("1 nov. à 03:00");
    expect(backupWhen(new Date("2025-12-01T02:00:00Z"), NOW)).toBe("1 déc. 2025 à 03:00");
  });

  it("passage réussi", () => {
    const s = statusFromResult(START, END, "cron", { ok: true, drive: "ok", month: "2026-11", files: 30, bytes: 1200, missing: [] });
    expect(s).toEqual({ at: START.toISOString(), endedAt: END.toISOString(), source: "cron", ok: true, drive: "ok", month: "2026-11", files: 30, bytes: 1200 });
    expect(backupStatusLine(s, NOW)).toEqual({ text: "Dernière sauvegarde : 1 nov. à 03:00 · réussie", tone: "ok" });
  });

  it("mail parti mais Drive en échec : erreur en français", () => {
    const s = statusFromResult(START, END, "manuel", { ok: true, drive: "api_desactivee" });
    expect(backupStatusLine(s, NOW)).toEqual({
      text: "Dernière sauvegarde : 1 nov. à 03:00 · échec : l'API Google Drive n'est pas activée (archive envoyée par mail)",
      tone: "fail",
    });
  });

  it("mail non parti", () => {
    const s = statusFromResult(START, END, "cron", { error: "google_non_connecte" });
    expect(s.ok).toBe(false);
    expect(backupStatusLine(s, NOW).text).toBe("Dernière sauvegarde : 1 nov. à 03:00 · échec : Google n'est pas connecté");
  });

  it("erreur inconnue : message court générique", () => {
    expect(backupErrorText("TypeError: boom")).toBe("erreur inattendue");
    expect(backupErrorText(undefined)).toBe("erreur inattendue");
    expect(backupStatusLine(statusFromResult(START, END, "cron", { error: "zzz" }), NOW).text).toBe("Dernière sauvegarde : 1 nov. à 03:00 · échec : erreur inattendue");
  });

  it("sauvegarde incomplète", () => {
    const s = statusFromResult(START, END, "cron", { ok: true, drive: "ok", missing: ["contacts", "invoices (incomplète)"] });
    expect(backupStatusLine(s, NOW).text).toBe("Dernière sauvegarde : 1 nov. à 03:00 · incomplète : 2 listes non lues");
  });

  it("en cours, puis interrompue si elle ne s'est jamais terminée", () => {
    const running = { at: "2026-11-18T09:58:00Z", running: true, source: "manuel" };
    expect(backupStatusLine(running, NOW)).toEqual({ text: "Sauvegarde en cours, lancée à 10:58", tone: "muted" });
    expect(backupStatusLine({ ...running, at: START.toISOString() }, NOW).text).toBe("Dernière sauvegarde : 1 nov. à 03:00 · échec : interrompue avant la fin");
  });

  it("garde l'état le plus récent", () => {
    const old = statusFromResult(START, END, "cron", { ok: true, drive: "ok" });
    const fresh = statusFromResult(new Date("2026-11-18T09:00:00Z"), new Date("2026-11-18T09:01:00Z"), "manuel", { error: "envoi_echoue" });
    expect(latestStatus(old, fresh)).toEqual(fresh);
    expect(latestStatus(fresh, old)).toEqual(fresh);
    expect(latestStatus(undefined, old)).toEqual(old);
    expect(latestStatus(null, "x")).toBeNull();
    expect(asBackupStatus({ at: START.toISOString() })).toEqual({ at: START.toISOString() });
  });
});

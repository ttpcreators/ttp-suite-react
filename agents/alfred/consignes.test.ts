import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Les consignes d'Alfred : un tronc court (CLAUDE.md) et des fiches par sujet (fiches/), lues à la demande.
const ici = new URL(".", import.meta.url).pathname.replace(/%20/g, " ");
const tronc = readFileSync(join(ici, "CLAUDE.md"), "utf8");
const fiches = readdirSync(join(ici, "fiches")).filter((n) => n.endsWith(".md"));
const textes = [tronc, ...fiches.map((n) => readFileSync(join(ici, "fiches", n), "utf8"))];
const titres = textes.flatMap((t) => [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));

describe("Alfred : le tronc et les fiches", () => {
  it("le tronc reste court (lu à chaque message de Marc)", () => {
    expect(tronc.length).toBeLessThan(40_000);
  });

  it("chaque fiche est dans l'index du tronc, et chaque fiche de l'index existe", () => {
    const index = [...tronc.matchAll(/`fiches\/([a-z-]+\.md)`/g)].map((m) => m[1]);
    for (const f of fiches) expect(index).toContain(f);
    for (const f of index) expect(fiches).toContain(f);
  });

  it("chaque section de l'index existe dans sa fiche", () => {
    for (const m of tronc.matchAll(/^- \*\*`fiches\/([a-z-]+\.md)`\*\* \([^)]*\) : (.+)\.$/gm)) {
      const fiche = readFileSync(join(ici, "fiches", m[1]), "utf8");
      for (const [, nom] of m[2].matchAll(/« ([^»]+) »/g)) expect(fiche).toContain(`## ${nom}`);
    }
  });

  it("chaque renvoi « voir « … » » mène à une section qui existe", () => {
    const renvois = textes.flatMap((t) => [...t.matchAll(/voir « ([^»]+?) »/g)].map((m) => m[1])).filter((r) => r !== "…");
    expect(renvois.length).toBeGreaterThan(20);
    for (const r of renvois) expect(titres.some((t) => t.startsWith(r)), r).toBe(true);
  });

  it("aucune section en double", () => {
    expect(new Set(titres).size).toBe(titres.length);
  });

  it("pas de tiret long dans les consignes", () => {
    for (const t of textes) expect(t).not.toMatch(/[—–]/);
  });
});

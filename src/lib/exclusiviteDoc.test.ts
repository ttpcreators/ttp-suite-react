import { beforeEach, describe, expect, it, vi } from "vitest";

type Found = { id: string; creator: string | null; name: string; type: string | null };
const db = vi.hoisted(() => ({ found: [] as Found[], inserted: [] as unknown[], updated: [] as unknown[] }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: db.found, error: null }) }) }),
      update: (v: unknown) => ({ eq: async () => (db.updated.push(v), { error: null }) }),
      insert: async (v: unknown) => (db.inserted.push(v), { error: null }),
    }),
  },
}));

import { contractDocName, fileContractDoc } from "./exclusiviteDoc";

beforeEach(() => {
  db.found = [];
  db.inserted = [];
  db.updated = [];
});

describe("fileContractDoc", () => {
  it("range un nouveau contrat dans Documents, au nom de la créatrice", async () => {
    expect(await fileContractDoc({ creator: "Justine Faure", brand: "Marque Exemple", docPath: "contrats/v.pdf" })).toBe(true);
    expect(db.inserted).toEqual([{ creator: "Justine Faure", name: "Contrat · Marque Exemple · Justine Faure", type: "contract", size: null, path: "contrats/v.pdf", sort_order: 0 }]);
  });

  it("ne touche pas un fichier déjà rangé comme brief", async () => {
    db.found = [{ id: "d1", creator: "LÉNA MOREL", name: "Brief · Solvi", type: "brief" }];
    expect(await fileContractDoc({ creator: "LÉNA MOREL", brand: "Solvi", docPath: "briefs/n.pdf" })).toBe(true);
    expect(db.inserted).toEqual([]);
    expect(db.updated).toEqual([]);
  });

  it("corrige la créatrice d'un contrat déjà rangé", async () => {
    db.found = [{ id: "d2", creator: null, name: "Contrat · Marque Exemple", type: "contract" }];
    await fileContractDoc({ creator: "Justine Faure", brand: "Marque Exemple", docPath: "contrats/v.pdf" });
    expect(db.updated).toEqual([{ creator: "Justine Faure", name: contractDocName("Marque Exemple", "Justine Faure") }]);
  });

  it("ne fait rien sans fichier", async () => {
    expect(await fileContractDoc({ creator: "A", brand: "B", docPath: null })).toBe(true);
    expect(db.inserted).toEqual([]);
  });
});

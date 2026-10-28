import { describe, expect, it } from "vitest";
import { brandSummary, postEr, postKind, type CollabPost } from "./creatorCollabs.ts";

const post = (o: Partial<CollabPost>): CollabPost => ({ id: "1", url: "", at: "2026-10-01", kind: "Reel", likes: 100, comments: 10, er: 1, paid: false, brands: [], caption: "", ...o });

describe("collabs d'un créateur", () => {
  it("format et engagement d'un post", () => {
    expect(postKind("VIDEO", "REELS")).toBe("Reel");
    expect(postKind("CAROUSEL_ALBUM", "FEED")).toBe("Carrousel");
    expect(postKind("IMAGE", "FEED")).toBe("Photo");
    expect(postEr(900, 100, 20000)).toBe(5);
    expect(postEr(null, 10, 20000)).toBeNull();
  });
  it("une ligne par marque, payées d'abord", () => {
    const s = brandSummary([
      post({ brands: ["nike"], at: "2026-09-01", er: 2 }),
      post({ brands: ["gymshark"], paid: true, at: "2026-10-02", er: 4 }),
      post({ brands: ["nike", "gymshark"], paid: true, at: "2026-10-05", er: 6 }),
    ]);
    expect(s).toEqual([
      { brand: "gymshark", posts: 2, paid: 2, last: "2026-10-05", er: 5 },
      { brand: "nike", posts: 2, paid: 1, last: "2026-10-05", er: 4 },
    ]);
  });
});

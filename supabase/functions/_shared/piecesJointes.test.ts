import { describe, expect, it } from "vitest";
import { construireRaw, nomPropre, problemePieces, typeDuNom } from "./piecesJointes.ts";

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const alea = () => "X";

describe("pièces jointes d'un brouillon", () => {
  it("reconnaît les types acceptés", () => {
    expect(typeDuNom("Contrat Nova.PDF")).toBe("application/pdf");
    expect(typeDuNom("photo.jpg")).toBe("image/jpeg");
    expect(typeDuNom("archive.zip")).toBeNull();
  });

  it("nettoie le nom et refuse ce qui ne passe pas", () => {
    expect(nomPropre('a"b\nc.pdf')).toBe("a b c.pdf");
    expect(problemePieces([{ nom: "x.zip", type: "application/zip", base64: "AA==" }])).toContain("non accepté");
    expect(problemePieces([{ nom: "x.pdf", type: "application/pdf", base64: "A".repeat(28 * 1024 * 1024) }])).toContain("trop lourdes");
    expect(problemePieces([{ nom: "x.pdf", type: "application/pdf", base64: "JVBERi0=" }])).toBeNull();
  });

  it("sans pièce : le même mail qu'avant", () => {
    const raw = construireRaw(["To: a@b.fr"], { texte: "Bonjour" }, [], b64, alea);
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).not.toContain("multipart/mixed");
  });

  it("avec un PDF : multipart/mixed, corps puis pièce", () => {
    const raw = construireRaw(["To: a@b.fr"], { texte: "Bonjour", html: "<p>Bonjour</p>" }, [{ nom: "Contrat Léna.pdf", type: "application/pdf", base64: "JVBERi0=" }], b64, alea);
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="ttpmix_X"');
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Content-Disposition: attachment; filename=\"=?UTF-8?B?");
    expect(raw).toContain("JVBERi0=");
    expect(raw.trim().endsWith("--ttpmix_X--")).toBe(true);
  });
});

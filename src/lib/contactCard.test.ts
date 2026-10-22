import { describe, expect, it } from "vitest";
import { contactCard } from "./contactCard";

describe("contactCard", () => {
  it("nom, rôle et marque, email, téléphone sur des lignes séparées", () => {
    expect(
      contactCard({ brand: "Maison Test", first_name: "Alice", last_name: "Martin", role: "Communication", email: "alice@test.fr", phone: "0600000000" }),
    ).toBe("Alice Martin\nCommunication, Maison Test\nalice@test.fr\n0600000000");
  });
  it("saute les champs vides et le remplissage « — »", () => {
    expect(contactCard({ brand: "Maison Test", person: "Alice", role: "—", email: "alice@test.fr", phone: "" })).toBe("Alice\nMaison Test\nalice@test.fr");
    expect(contactCard({ brand: "Maison Test" })).toBe("Maison Test");
  });
});

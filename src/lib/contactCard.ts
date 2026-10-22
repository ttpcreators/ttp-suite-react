/*
 * Bouton « Copier la fiche » (page Contacts) : nom, rôle et marque, email, téléphone
 * en un seul texte, prêt à coller (Claude, WhatsApp, note…). Les champs vides sont sautés.
 */

type CardContact = {
  brand?: string | null; first_name?: string | null; last_name?: string | null; person?: string | null;
  role?: string | null; email?: string | null; phone?: string | null;
};

// « — » = champ de remplissage en base : traité comme vide.
const val = (s?: string | null) => {
  const v = (s ?? "").trim();
  return v === "—" ? "" : v;
};

export function contactCard(c: CardContact): string {
  const name = [val(c.first_name), val(c.last_name)].filter(Boolean).join(" ") || val(c.person);
  const job = [val(c.role), val(c.brand)].filter(Boolean).join(", ");
  return [name, job, val(c.email), val(c.phone)].filter(Boolean).join("\n");
}

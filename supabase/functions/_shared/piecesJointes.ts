// ============================================================================
// _shared/piecesJointes.ts : joindre des fichiers (PDF surtout) à un brouillon Gmail
// (demande de Marc, 19 novembre 2026). Logique pure, testée par piecesJointes.test.ts.
// ============================================================================

export type Piece = { nom: string; type: string; base64: string };

/** 20 Mo de pièces au plus par brouillon (Gmail accepte 25 Mo, l'encodage en prend une part). */
export const TAILLE_MAX = 20 * 1024 * 1024;
const TYPES = /^(application\/pdf|image\/(png|jpe?g|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|text\/csv)$/;

/** Le type d'un fichier d'après son nom, si on l'accepte (sinon null). */
export function typeDuNom(nom: string): string | null {
  const ext = String(nom).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const t: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv",
  };
  return t[ext] ?? null;
}

export const typeAccepte = (type: string) => TYPES.test(type);

/** Nom de fichier propre pour un en-tête (sans guillemets ni retours, 120 caractères). */
export function nomPropre(nom: string): string {
  const n = String(nom ?? "").replace(/[\r\n"\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return n || "piece-jointe.pdf";
}

/** Taille réelle (octets) d'un contenu en base64. */
export const tailleBase64 = (b64: string) => Math.floor((b64.replace(/[^A-Za-z0-9+/]/g, "").length * 3) / 4);

/** Problème des pièces (type, taille), ou null. */
export function problemePieces(pieces: Piece[]): string | null {
  for (const p of pieces) if (!typeAccepte(p.type)) return `« ${p.nom} » : type non accepté (${p.type}). PDF, image, Word, Excel, PowerPoint ou CSV.`;
  const total = pieces.reduce((t, p) => t + tailleBase64(p.base64), 0);
  if (total > TAILLE_MAX) return `Pièces trop lourdes (${Math.round(total / 1048576)} Mo, 20 Mo au plus) : envoie un lien à la place.`;
  return null;
}

/** Encodage d'un nom de fichier non ASCII (RFC 2047), pour Gmail et les autres messageries. */
function nomEnTete(nom: string): string {
  const n = nomPropre(nom);
  if (/^[\x20-\x7e]*$/.test(n)) return `"${n}"`;
  const b = btoa(String.fromCharCode(...new TextEncoder().encode(n)));
  return `"=?UTF-8?B?${b}?="`;
}

/**
 * Le mail complet (en-têtes + corps), avec ses pièces : multipart/mixed autour du corps
 * (texte seul, ou texte + HTML) ; sans pièce, le même mail qu'avant.
 */
export function construireRaw(entetes: string[], corps: { texte: string; html?: string }, pieces: Piece[], b64: (s: string) => string, alea: () => string): string {
  const h = [...entetes];
  let corpsMime: { entete: string; contenu: string };
  if (corps.html) {
    const alt = `ttp_${alea()}`;
    const part = (type: string, body: string) => `--${alt}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}`;
    corpsMime = { entete: `Content-Type: multipart/alternative; boundary="${alt}"`, contenu: `${part("text/plain", corps.texte)}\r\n${part("text/html", corps.html)}\r\n--${alt}--` };
  } else {
    corpsMime = { entete: "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64", contenu: b64(corps.texte) };
  }
  if (!pieces.length) return `${[...h, corpsMime.entete].join("\r\n")}\r\n\r\n${corpsMime.contenu}`;
  const mix = `ttpmix_${alea()}`;
  const lignes = (s: string) => s.replace(/\s+/g, "").replace(/.{76}/g, "$&\r\n");
  const parts = [
    `--${mix}\r\n${corpsMime.entete}\r\n\r\n${corpsMime.contenu}`,
    ...pieces.map((p) => `--${mix}\r\nContent-Type: ${p.type}; name=${nomEnTete(p.nom)}\r\nContent-Disposition: attachment; filename=${nomEnTete(p.nom)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${lignes(p.base64)}`),
  ];
  return `${[...h, `Content-Type: multipart/mixed; boundary="${mix}"`].join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${mix}--`;
}

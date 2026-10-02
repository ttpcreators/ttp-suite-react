import DOMPurify from "dompurify";

// Séparé de mailSend.ts : DOMPurify ne charge que dans les écrans mail (pas dans le bundle principal).

/** Signature collée depuis Gmail/Spark : HTML assaini (aucun script, images conservées). */
export function cleanSignature(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "form", "input", "button", "iframe", "object", "embed", "link", "meta", "base"],
    FORBID_ATTR: ["srcset", "action", "formaction", "ping"],
  }).trim();
}


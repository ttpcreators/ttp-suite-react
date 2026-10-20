/**
 * Signature de l'agence posée D'OFFICE dans le cadre « Pour TTP Creators » de tous les
 * contrats (Marque × Créateur, UGC, Représentation). Le cadre du créateur ou de la
 * marque reste vide : c'est à eux de signer.
 *
 * Réglée une fois dans Paramètres → Signature : dessinée au doigt / à la souris, ou
 * « gribouillée » par l'app (scribble). Gardée dans les réglages partagés (clé
 * `agencySignature`) sous forme de tracés SVG, VÉRIFIÉS avant d'entrer dans un PDF
 * (rien d'autre que des commandes de tracé et des nombres).
 *
 * Les fabricants de contrats sont synchrones : la signature courante est tenue ici
 * (setCurrentSignature, appelé par AgencySignatureSync dans App) et lue par sigImgHtml().
 */
export const SIGNATURE_KEY = "agencySignature";

export type SignatureData = { paths: string[]; w: number; h: number; on?: boolean; by?: string; at?: string };

const PATH_OK = /^[MLCSQZ0-9 .,-]+$/;

/** Signature valide (forme et contenu des tracés), sinon null. */
export function validSig(x: unknown): SignatureData | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Partial<SignatureData>;
  if (!Array.isArray(s.paths) || !s.paths.length || s.paths.length > 200) return null;
  if (!s.paths.every((p) => typeof p === "string" && p.length < 20000 && PATH_OK.test(p))) return null;
  const w = Number(s.w);
  const h = Number(s.h);
  if (!(w > 0 && w < 5000 && h > 0 && h < 5000)) return null;
  return { paths: s.paths, w, h, on: s.on !== false, by: typeof s.by === "string" ? s.by : undefined, at: typeof s.at === "string" ? s.at : undefined };
}

/** Encre « stylo bleu nuit » : se lit comme une vraie signature à l'impression. */
export const SIG_INK = "#1d2a5c";

export function sigSvg(sig: SignatureData, color = SIG_INK): string {
  const paths = sig.paths.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sig.w} ${sig.h}" width="${sig.w}" height="${sig.h}">${paths}</svg>`;
}

let current: SignatureData | null = null;
export function setCurrentSignature(sig: SignatureData | null): void {
  current = sig;
}

/** <img> de la signature pour le cadre de l'agence ("" si aucune ou désactivée). */
export function sigImgHtml(): string {
  if (!current || current.on === false) return "";
  return `<img class="sig" alt="Signature" src="data:image/svg+xml;utf8,${encodeURIComponent(sigSvg(current))}">`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Signature « gribouillée » par l'app : une écriture cursive inventée (boucles, vagues,
 * descente) et un trait de soulignement. Même graine = même gribouillis.
 */
export function scribble(seed: number): SignatureData {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const H = 120;
  const y = 72;
  let x = 16;
  let d = `M${x} ${y}`;
  const letters = 7 + Math.floor(rnd() * 4);
  for (let i = 0; i < letters; i++) {
    const w = 14 + rnd() * 14;
    if (rnd() < (i === 0 ? 0.9 : 0.42)) {
      // Boucle montante (initiale, l, b, h)
      const up = i === 0 ? 46 + rnd() * 14 : 22 + rnd() * 24;
      d += ` C${r1(x + w * 0.15)} ${r1(y - up * 0.45)} ${r1(x + w * 0.95)} ${r1(y - up)} ${r1(x + w * 0.55)} ${r1(y - up)}`;
      d += ` C${r1(x + w * 0.15)} ${r1(y - up)} ${r1(x + w * 0.3)} ${r1(y - up * 0.15)} ${r1(x + w * 0.75)} ${y}`;
    } else {
      // Vague basse (n, m, e)
      const h = 9 + rnd() * 12;
      d += ` C${r1(x + w * 0.25)} ${r1(y - h)} ${r1(x + w * 0.6)} ${r1(y - h)} ${r1(x + w * 0.68)} ${y - 2}`;
      d += ` S${r1(x + w * 0.92)} ${y + 3} ${r1(x + w)} ${y}`;
    }
    x += w * 0.82;
  }
  // Descente finale, puis soulignement en un geste.
  d += ` C${r1(x + 10)} ${y + 12} ${r1(x - 4)} ${y + 26} ${r1(x - 22)} ${y + 20}`;
  const W = Math.round(x + 44);
  const u = `M${r1(12 + rnd() * 18)} ${r1(y + 30 - rnd() * 6)} C${r1(W * 0.3)} ${y + 18} ${r1(W * 0.66)} ${y + 34} ${r1(W - 10)} ${r1(y + 12 + rnd() * 6)}`;
  return { paths: [d, u], w: W, h: H, on: true };
}

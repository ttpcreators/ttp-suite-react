/**
 * Texte d'un PDF, lu dans le navigateur (pdf.js, chargé à la demande : rien n'est envoyé
 * nulle part pour la lecture). Sert à « Lire un contrat » (page Exclusivités).
 * Un PDF scanné (image sans texte) renvoie un texte vide.
 */
export async function pdfText(file: Blob, maxPages = 40): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  await doc.destroy();
  return pages.join("\n");
}

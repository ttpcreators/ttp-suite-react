/**
 * Ouvre la boîte d'impression du navigateur sur un document HTML → l'utilisateur
 * choisit « Enregistrer au format PDF » (destination PDF). 0 €, texte NET
 * (vectoriel, pas une image floue), pagination gérée par le CSS @media print.
 *
 * Utilise un iframe caché same-origin (pas de pop-up → jamais bloqué), retiré
 * après impression. Le nom de fichier proposé = le <title> du document HTML.
 */
export function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = html; // same-origin → contentWindow.print() autorisé

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => iframe.remove(), 1000); // laisse le dialogue s'ouvrir
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    try {
      win.focus();
      win.addEventListener("afterprint", cleanup);
      win.print();
      setTimeout(cleanup, 60000); // filet si afterprint ne se déclenche pas
    } catch {
      iframe.remove();
    }
  };

  document.body.appendChild(iframe);
}

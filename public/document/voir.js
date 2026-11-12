// Lecteur des documents HTML du stockage (contrats…) : /document/#<lien signé>.
// Supabase sert les .html en texte brut (protection anti-hébergement) : ouvert tel quel,
// le navigateur montre le CODE avec les accents cassés. Ici on récupère le fichier
// (décodé en UTF-8) et on l'affiche comme une vraie page, imprimable.
// Sécurité : seuls les liens signés de notre stockage sont acceptés, les scripts et
// attributs actifs sont retirés, et la CSP de la page bloque tout script venu du fichier.
(function () {
  var PREFIX = "https://zizvggziggswhrbuyhuo.supabase.co/storage/v1/object/sign/documents/";
  var msg = document.getElementById("msg");
  var fail = function (text) {
    msg.textContent = text;
  };

  // Un autre document ouvert dans le même onglet (seul le # change) : on recharge.
  window.addEventListener("hashchange", function () {
    location.reload();
  });

  var url = "";
  try {
    url = decodeURIComponent(location.hash.slice(1));
  } catch {
    url = "";
  }
  var path = url.split("?")[0];
  if (url.indexOf(PREFIX) !== 0 || !/\.html?$/i.test(path)) {
    fail("Lien de document invalide. Rouvre-le depuis l'app TTP Creators.");
    return;
  }

  var clean = function (doc) {
    doc.querySelectorAll("script, iframe, frame, object, embed, base, form, meta[http-equiv], link:not([rel~='stylesheet'])").forEach(function (el) {
      el.remove();
    });
    doc.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        var value = a.value.replace(/\s+/g, "").toLowerCase();
        if (name.indexOf("on") === 0 || /^(javascript|vbscript|data:text)/.test(value)) el.removeAttribute(a.name);
      });
    });
  };

  // Barre « Télécharger en PDF » au-dessus du document (cachée à l'impression).
  // Le PDF passe par la boîte d'impression de la PAGE (pas d'un iframe) : c'est la seule
  // voie qui marche partout (Mac, PC, iPhone, Android) avec un texte net. Le nom du
  // fichier proposé = le titre du document. Les navigateurs intégrés (Instagram,
  // TikTok, Facebook…) n'ont pas d'impression : on y explique d'ouvrir Safari ou Chrome.
  var ua = navigator.userAgent || "";
  var inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Twitter|Line\//i.test(ua);
  var ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var android = /Android/i.test(ua);

  var BAR_CSS =
    ".ttp-pdfbar{position:sticky;top:0;z-index:2147483647;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;" +
    "padding:10px 16px;background:#fff;border-bottom:1px solid rgba(28,25,23,.1);" +
    "font:14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c1917;text-align:left}" +
    ".ttp-pdfbar *{box-sizing:border-box;font:inherit;letter-spacing:normal;text-transform:none}" +
    ".ttp-pdfbar button{appearance:none;border:0;margin:0;cursor:pointer;display:inline-flex;align-items:center;gap:8px;" +
    "height:40px;padding:0 16px;border-radius:10px;background:#1c1917;color:#fff;font-weight:500;white-space:nowrap}" +
    ".ttp-pdfbar button:focus-visible{outline:2px solid #1c1917;outline-offset:2px}" +
    ".ttp-pdfbar button.ghost{background:transparent;color:#1c1917;box-shadow:inset 0 0 0 1px rgba(28,25,23,.18)}" +
    ".ttp-pdfbar p{margin:0;padding:0;flex:1 1 220px;min-width:0;max-width:none;font-size:13px;color:#57534e;text-align:left}" +
    ".ttp-pdfbar svg{width:16px;height:16px;flex:none}" +
    "@media print{.ttp-pdfbar{display:none!important}}";

  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

  var tip = function () {
    if (ios) return "Dans la fenêtre qui s'ouvre, touche le bouton Partager (le carré avec la flèche), puis « Enregistrer dans Fichiers ».";
    if (android) return "Dans la fenêtre qui s'ouvre, choisis « Enregistrer au format PDF » en haut, puis touche le bouton PDF.";
    return "Dans la fenêtre qui s'ouvre, choisis « Enregistrer au format PDF » comme destination.";
  };

  var addPdfBar = function () {
    var style = document.createElement("style");
    style.textContent = BAR_CSS;
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.className = "ttp-pdfbar";
    var text = document.createElement("p");

    if (inApp) {
      var copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copier le lien";
      text.textContent = "Ce navigateur ne sait pas créer de PDF. Copie le lien et ouvre-le dans Safari ou Chrome.";
      copy.addEventListener("click", function () {
        var done = function () {
          copy.textContent = "Lien copié";
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, function () {});
      });
      bar.appendChild(copy);
    } else {
      var dl = document.createElement("button");
      dl.type = "button";
      dl.innerHTML = ICON + "<span>Télécharger en PDF</span>";
      text.textContent = tip();
      dl.addEventListener("click", function () {
        try {
          window.print();
        } catch {
          text.textContent = "L'impression est bloquée ici. Ouvre ce lien dans Safari ou Chrome.";
        }
      });
      bar.appendChild(dl);
    }
    bar.appendChild(text);
    document.body.insertBefore(bar, document.body.firstChild);
  };

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      clean(doc);
      document.title = doc.title || "Document · TTP Creators";
      document.documentElement.setAttribute("lang", doc.documentElement.getAttribute("lang") || "fr");
      // Les styles de la page d'attente cèdent la place à ceux du document.
      document.querySelectorAll("head style").forEach(function (el) {
        el.remove();
      });
      Array.prototype.slice.call(doc.head.children).forEach(function (el) {
        if (el.tagName !== "TITLE" && !(el.tagName === "META" && el.getAttribute("charset"))) document.head.appendChild(document.adoptNode(el));
      });
      document.body.replaceWith(document.adoptNode(doc.body));
      addPdfBar();
    })
    .catch(function () {
      fail("Ce lien a expiré ou le document est introuvable. Rouvre-le depuis l'app TTP Creators.");
    });
})();

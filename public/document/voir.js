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
    })
    .catch(function () {
      fail("Ce lien a expiré ou le document est introuvable. Rouvre-le depuis l'app TTP Creators.");
    });
})();

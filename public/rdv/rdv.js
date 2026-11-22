// Page publique « Réserver une visio avec Marc » : créneaux et réservation via la fonction
// Supabase `rdv` (supabase/functions/rdv). Aucune donnée n'est gardée dans le navigateur.
(function () {
  var API = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/rdv";
  var zone = document.getElementById("creneaux");
  var formZone = document.getElementById("formulaire");
  var form = document.getElementById("form");
  var choisiEl = document.getElementById("choisi");
  var erreur = document.getElementById("erreur");
  var envoyer = document.getElementById("envoyer");
  var ok = document.getElementById("ok");
  var choix = null;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  function message(texte) {
    zone.textContent = "";
    zone.appendChild(el("p", { class: "note" }, texte));
  }

  function afficher(d) {
    zone.textContent = "";
    if (!d.jours || !d.jours.length) {
      message("Plus aucun créneau libre ces deux prochaines semaines. Écris-nous à partnerships@ttpcreators.pro.");
      return;
    }
    d.jours.forEach(function (j) {
      var bloc = el("div", { class: "jour" });
      bloc.appendChild(el("h2", {}, j.label.charAt(0).toUpperCase() + j.label.slice(1)));
      var heures = el("div", { class: "heures" });
      j.heures.forEach(function (h) {
        var b = el("button", { type: "button", class: "h", "aria-pressed": "false" }, h.replace(":", " h "));
        b.addEventListener("click", function () {
          var tous = zone.querySelectorAll("button.h");
          for (var i = 0; i < tous.length; i++) tous[i].setAttribute("aria-pressed", "false");
          b.setAttribute("aria-pressed", "true");
          choix = { jour: j.jour, heure: h };
          choisiEl.textContent = j.label + " à " + h.replace(":", " h ");
          formZone.hidden = false;
          formZone.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        heures.appendChild(b);
      });
      bloc.appendChild(heures);
      zone.appendChild(bloc);
    });
    document.getElementById("sous").textContent = "Choisis un créneau de " + d.duree + " minutes : on parle de ton projet et des créateurs qui y correspondent.";
  }

  function charger() {
    fetch(API, { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.actif === false) return message("La prise de rendez-vous en ligne n'est pas ouverte pour l'instant. Écris-nous à partnerships@ttpcreators.pro.");
        if (!d || d.error) return message("Les créneaux ne s'affichent pas pour l'instant. Réessaie dans un moment, ou écris-nous à partnerships@ttpcreators.pro.");
        afficher(d);
      })
      .catch(function () { message("Connexion impossible. Réessaie dans un moment."); });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    erreur.textContent = "";
    if (!choix) { erreur.textContent = "Choisis d'abord un créneau."; return; }
    var f = new FormData(form);
    var corps = { jour: choix.jour, heure: choix.heure, nom: String(f.get("nom") || ""), marque: String(f.get("marque") || ""), email: String(f.get("email") || ""), message: String(f.get("message") || ""), site: String(f.get("site") || "") };
    if (!corps.nom.trim() || !corps.marque.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corps.email.trim())) {
      erreur.textContent = "Indique ton nom, ta marque et un email pro valide.";
      return;
    }
    envoyer.disabled = true;
    envoyer.textContent = "Réservation…";
    fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (x) {
        if (x.status === 409) { erreur.textContent = "Ce créneau vient d'être pris. Choisis-en un autre."; choix = null; charger(); return; }
        if (!x.d || !x.d.ok) { erreur.textContent = "La réservation n'a pas abouti. Réessaie, ou écris-nous à partnerships@ttpcreators.pro."; return; }
        zone.hidden = true;
        formZone.hidden = true;
        ok.hidden = false;
        ok.appendChild(el("h2", {}, "C'est réservé."));
        ok.appendChild(el("p", {}, "Visio le " + (x.d.quand || "") + " (heure de Paris), " + (x.d.duree || 30) + " minutes, avec Marc."));
        ok.appendChild(el("p", { class: "note" }, "Une invitation Google Agenda est partie à " + corps.email + ", avec le lien de la visio. À très vite."));
      })
      .catch(function () { erreur.textContent = "Connexion impossible. Réessaie dans un moment."; })
      .then(function () { envoyer.disabled = false; envoyer.textContent = "Réserver la visio"; });
  });

  charger();
})();

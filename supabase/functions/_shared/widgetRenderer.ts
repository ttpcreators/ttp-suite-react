// ============================================================================
// _shared/widgetRenderer.ts : le DESSIN du widget iPhone (code Scriptable), servi par
// la fonction `widget` (?script=1). Le script collé une fois dans Scriptable n'est
// qu'un lanceur (src/lib/widgetScript.ts) : il télécharge ce code, le garde pour
// rester lisible hors connexion, et l'exécute avec API, CLE et ANON. Retoucher le
// dessin ici suffit : les iPhone le reçoivent au rafraîchissement suivant.
// Vue choisie par widget : champ « Parameter » du widget dans iOS (vide = tâches +
// planning ; « mails », « taches » ou « planning » pour une seule liste).
// Style : celui de l'app (fond blanc / #1c1c1e, bleu #0069fe, rouge et orange des
// statuts), polices arrondies d'iOS, icônes SF Symbols.
// Pas d'accent grave ni de « ${ » dans ce code : il vit dans une chaîne String.raw.
// Testé par src/lib/widgetScript.test.ts (exécuté avec un faux Scriptable).
// ============================================================================

export const RENDERER_TAG = "// ttp-widget-renderer";

export const WIDGET_RENDERER = String.raw`// ttp-widget-renderer v2
const APP = "https://app.ttpcreators.pro";
const LIEN_TACHES = APP + "/?open=view&view=todo";
const LIEN_PLANNING = APP + "/?open=view&view=planning";
const LIEN_MAILS = APP + "/?open=view&view=mails";

// « mails », « taches », « planning » ; vide ou autre = tâches + planning.
function vueDe(p) {
  const v = String(p || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^(mail|mails|email|emails|boite)$/.test(v)) return "mails";
  if (/^(tache|taches|todo|to-do|to do|a faire)$/.test(v)) return "taches";
  if (/^(planning|agenda|calendrier|rdv)$/.test(v)) return "planning";
  return "tout";
}

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.cacheDirectory(), "ttp-widget.json");

const dyn = (clair, sombre, a) => Color.dynamic(new Color(clair, a == null ? 1 : a), new Color(sombre, a == null ? 1 : a));
const C = {
  fond: dyn("#ffffff", "#1c1c1e"),
  carte: dyn("#f2f2f7", "#2c2c2e"),
  texte: dyn("#1d1d1f", "#f5f5f7"),
  doux: dyn("#86868b", "#98989d"),
  trait: dyn("#e5e5ea", "#3a3a3c"),
  accent: dyn("#0069fe", "#64a8ff"),
  accentDoux: dyn("#0069fe", "#64a8ff", 0.12),
  retard: dyn("#d70015", "#ff6961"),
  retardDoux: dyn("#d70015", "#ff6961", 0.12),
  jour: dyn("#b86e00", "#ffb340"),
  jourDoux: dyn("#ff9500", "#ffb340", 0.16),
  ok: dyn("#1e7b34", "#30d158"),
  okDoux: dyn("#1e7b34", "#30d158", 0.12),
  talent: dyn("#7a3fd1", "#bf8cff"),
  talentDoux: dyn("#7a3fd1", "#bf8cff", 0.14),
};
const boiteCouleur = (b) => (b === "talent" ? C.talent : C.accent);
const tonCouleur = (ton) => (ton === "retard" ? C.retard : ton === "jour" ? C.jour : ton === "bientot" ? C.accent : C.trait);
const tonTexte = (ton) => (ton === "retard" ? C.retard : ton === "jour" ? C.jour : ton === "bientot" ? C.accent : C.doux);

async function charger() {
  try {
    const r = new Request(API);
    r.headers = { Authorization: "Bearer " + CLE, apikey: ANON };
    r.timeoutInterval = 15;
    const d = await r.loadJSON();
    const code = r.response ? r.response.statusCode : 0;
    if (code === 401) return { erreur: "Clé refusée. Recrée le script dans TTP Suite, Paramètres, Widget iPhone." };
    if (d && d.taches && d.planning) {
      fm.writeString(CACHE, JSON.stringify(d));
      return d;
    }
  } catch (e) {}
  if (fm.fileExists(CACHE)) {
    try {
      const d = JSON.parse(fm.readString(CACHE));
      d.horsLigne = true;
      return d;
    } catch (e) {}
  }
  return { erreur: "Pas de connexion pour l'instant." };
}

function txt(st, s, font, couleur, lignes) {
  const t = st.addText(String(s));
  t.font = font;
  t.textColor = couleur || C.texte;
  t.lineLimit = lignes || 1;
  return t;
}

function icone(st, nom, taille, couleur) {
  const s = SFSymbol.named(nom);
  if (!s) return null;
  s.applyFont(Font.semiboldSystemFont(taille));
  const i = st.addImage(s.image);
  i.imageSize = new Size(taille + 2, taille + 2);
  i.tintColor = couleur;
  return i;
}

function barre(st, couleur, h) {
  const b = st.addStack();
  b.size = new Size(3, h);
  b.cornerRadius = 1.5;
  b.backgroundColor = couleur;
}

function puce(st, s, couleur, fond, taille) {
  const p = st.addStack();
  p.setPadding(2, 7, 2, 7);
  p.cornerRadius = 8;
  p.backgroundColor = fond;
  txt(p, s, Font.semiboldSystemFont(taille), couleur);
  return p;
}

// court : « 2 retard · 1 auj. » pour les petites places.
function puces(st, d, taille, court) {
  const l = st.addStack();
  l.centerAlignContent();
  l.spacing = 4;
  if (d.taches.retard) puce(l, d.taches.retard + (court ? " retard" : " en retard"), C.retard, C.retardDoux, taille);
  if (d.taches.aujourdhui) puce(l, d.taches.aujourdhui + (court ? " auj." : " aujourd'hui"), C.jour, C.jourDoux, taille);
  if (!d.taches.retard && !d.taches.aujourdhui) puce(l, d.taches.ouvertes ? "rien d'urgent" : "tout est fait", C.ok, C.okDoux, taille);
  return l;
}

function entete(st, nom, titre, droite) {
  const h = st.addStack();
  h.centerAlignContent();
  h.spacing = 5;
  icone(h, nom, 12, C.accent);
  txt(h, titre, Font.semiboldSystemFont(13), C.texte);
  if (droite != null) {
    h.addSpacer();
    txt(h, droite, Font.semiboldRoundedSystemFont(13), C.doux);
  }
  return h;
}

function ligneTache(st, t, taille, avecQuand) {
  const l = st.addStack();
  l.centerAlignContent();
  l.spacing = 7;
  barre(l, tonCouleur(t.ton), taille + 3);
  txt(l, t.t, t.haute ? Font.semiboldSystemFont(taille) : Font.systemFont(taille), C.texte);
  if (avecQuand && t.quand) {
    l.addSpacer();
    txt(l, t.ton === "retard" ? t.quand.replace(" de retard", "") : t.quand, Font.mediumSystemFont(taille - 2), tonTexte(t.ton));
  }
  return l;
}

function taches(st, d, n, taille, avecQuand) {
  const liste = d.taches.liste.slice(0, n);
  if (!liste.length) {
    txt(st, "Aucune tâche ouverte", Font.systemFont(taille), C.doux);
    return;
  }
  for (let i = 0; i < liste.length; i++) {
    if (i) st.addSpacer(5);
    ligneTache(st, liste[i], taille, avecQuand);
  }
}

// Planning groupé par jour ; n = lignes disponibles (un titre de jour compte pour une).
function planning(st, d, n, taille, largeurHeure) {
  if (!d.planning.liste.length) {
    txt(st, "Rien de prévu cette semaine", Font.systemFont(taille), C.doux);
    return;
  }
  let jour = null;
  let lignes = 0;
  for (const e of d.planning.liste) {
    const titreJour = e.quand !== jour;
    if (lignes + (titreJour ? 2 : 1) > n) break;
    if (titreJour) {
      if (jour !== null) st.addSpacer(5);
      jour = e.quand;
      txt(st, jour, Font.semiboldSystemFont(taille - 2), e.ton === "jour" ? C.accent : C.doux);
      st.addSpacer(3);
      lignes++;
    } else st.addSpacer(4);
    const l = st.addStack();
    l.centerAlignContent();
    l.spacing = 6;
    const h = l.addStack();
    h.size = new Size(largeurHeure, 0);
    if (e.heure) txt(h, e.heure, Font.mediumMonospacedSystemFont(taille - 2), C.doux);
    else if (e.deadline) icone(h, "flag.fill", taille - 3, C.jour);
    else txt(h, "jour", Font.mediumSystemFont(taille - 3), C.doux);
    h.addSpacer();
    txt(l, e.t, Font.systemFont(taille), C.texte);
    lignes++;
  }
}

function pucesMails(st, d, taille, court) {
  const l = st.addStack();
  l.centerAlignContent();
  l.spacing = 4;
  const m = d.mails || { nonLus: 0, partnerships: 0, talent: 0 };
  if (m.partnerships) puce(l, (court ? "partn. " : "partnerships ") + m.partnerships, C.accent, C.accentDoux, taille);
  if (m.talent) puce(l, "talent " + m.talent, C.talent, C.talentDoux, taille);
  if (!m.nonLus) puce(l, "boîte à zéro", C.ok, C.okDoux, taille);
  return l;
}

// Un mail : barre de la boîte, expéditeur et heure, puis l'objet (si la place le permet).
function ligneMail(st, m, taille, avecObjet) {
  const l = st.addStack();
  l.spacing = 7;
  l.topAlignContent();
  barre(l, boiteCouleur(m.boite), avecObjet ? taille * 2 + 6 : taille + 3);
  const c = l.addStack();
  c.layoutVertically();
  const h = c.addStack();
  h.centerAlignContent();
  txt(h, m.de, Font.semiboldSystemFont(taille), C.texte);
  h.addSpacer();
  txt(h, m.quand, Font.mediumSystemFont(taille - 2), C.doux);
  if (avecObjet) {
    c.addSpacer(1);
    txt(c, m.objet, Font.systemFont(taille - 1), C.doux);
  }
  return l;
}

function mails(st, d, n, taille, avecObjet) {
  const liste = ((d.mails && d.mails.liste) || []).slice(0, n);
  if (!liste.length) {
    txt(st, "Aucun mail non lu", Font.systemFont(taille), C.doux);
    return;
  }
  for (let i = 0; i < liste.length; i++) {
    if (i) st.addSpacer(avecObjet ? 7 : 5);
    ligneMail(st, liste[i], taille, avecObjet);
  }
}

function separateur(st, vertical, longueur) {
  const s = st.addStack();
  s.size = vertical ? new Size(1, longueur) : new Size(longueur, 1);
  s.backgroundColor = C.trait;
}

function largeurWidget() {
  const w = Device.screenSize().width;
  return Math.round(Math.min(w, 440) * 0.866);
}

function aujourdhui() {
  const f = new DateFormatter();
  f.locale = "fr_FR";
  f.dateFormat = "EEEE d MMMM";
  const s = f.string(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pied(w, d) {
  if (!d.horsLigne) return;
  const f = new DateFormatter();
  f.dateFormat = "HH:mm";
  w.addSpacer(4);
  const t = txt(w, "Hors ligne · données de " + f.string(new Date(d.maj)), Font.mediumSystemFont(9), C.doux);
  t.rightAlignText();
}

function erreur(w, msg) {
  const h = w.addStack();
  h.centerAlignContent();
  h.spacing = 5;
  icone(h, "exclamationmark.triangle.fill", 12, C.jour);
  txt(h, "TTP Suite", Font.semiboldSystemFont(13), C.texte);
  w.addSpacer(6);
  txt(w, msg, Font.systemFont(12), C.doux, 4);
}

// Une seule liste (mails, tâches ou planning), dans toutes les tailles.
function uneVue(w, d, famille, vue) {
  const m = d.mails || { nonLus: 0, partnerships: 0, talent: 0, liste: [] };
  const premier = vue === "mails" ? m.liste[0] : vue === "taches" ? d.taches.liste[0] : d.planning.liste[0];
  const nombre = vue === "mails" ? m.nonLus : vue === "taches" ? d.taches.ouvertes : d.planning.total;
  const icon = vue === "mails" ? "envelope.fill" : vue === "taches" ? "checklist" : "calendar";
  const titre = vue === "mails" ? "Mails" : vue === "taches" ? "À faire" : "Planning";
  const resume = vue === "mails" ? nombre + " non lu" + (nombre > 1 ? "s" : "") : vue === "taches" ? nombre + " à faire" : nombre + " sur 7 jours";
  const ligne1 = premier ? (vue === "mails" ? premier.de + " · " + premier.objet : vue === "planning" ? premier.court + "  " + premier.t : premier.t) : "";

  if (famille === "accessoryInline") {
    w.addText(resume + (ligne1 ? " · " + ligne1 : ""));
    return w;
  }
  if (famille === "accessoryCircular") {
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    icone(s, icon, 10);
    const n = s.addText(String(nombre));
    n.font = Font.boldRoundedSystemFont(20);
    n.centerAlignText();
    return w;
  }
  if (famille === "accessoryRectangular") {
    const h = w.addStack();
    h.centerAlignContent();
    h.spacing = 4;
    icone(h, icon, 11);
    const a = h.addText(resume);
    a.font = Font.semiboldSystemFont(13);
    a.lineLimit = 1;
    if (vue === "mails" && premier) {
      const b = w.addText(premier.de);
      b.font = Font.mediumSystemFont(12);
      b.lineLimit = 1;
      const c = w.addText(premier.objet);
      c.font = Font.systemFont(12);
      c.lineLimit = 1;
    } else {
      const liste = vue === "taches" ? d.taches.liste : d.planning.liste;
      for (const x of liste.slice(0, 2)) {
        const b = w.addText(vue === "planning" ? x.court + "  " + x.t : x.t);
        b.font = Font.systemFont(12);
        b.lineLimit = 1;
      }
    }
    return w;
  }

  if (famille === "small") {
    w.setPadding(14, 14, 14, 14);
    entete(w, icon, titre);
    w.addSpacer(2);
    txt(w, nombre, Font.boldRoundedSystemFont(38), C.texte);
    if (vue === "mails") pucesMails(w, d, 10, true);
    else if (vue === "taches") puces(w, d, 10, true);
    else txt(w, "sur 7 jours", Font.mediumSystemFont(11), C.doux);
    w.addSpacer();
    const c = w.addStack();
    c.layoutVertically();
    c.setPadding(6, 8, 6, 8);
    c.cornerRadius = 10;
    c.backgroundColor = C.carte;
    if (!premier) txt(c, vue === "mails" ? "Boîte à zéro" : vue === "taches" ? "Tout est fait" : "Planning libre", Font.mediumSystemFont(12), C.doux);
    else if (vue === "mails") {
      txt(c, premier.de, Font.semiboldSystemFont(11), boiteCouleur(premier.boite));
      txt(c, premier.objet, Font.mediumSystemFont(12), C.texte, 2);
    } else if (vue === "taches") {
      if (premier.quand) txt(c, premier.quand, Font.semiboldSystemFont(10), tonTexte(premier.ton));
      txt(c, premier.t, Font.mediumSystemFont(12), C.texte, 2);
    } else {
      txt(c, premier.court, Font.semiboldSystemFont(10), premier.ton === "jour" ? C.accent : C.doux);
      txt(c, (premier.deadline ? "⚑ " : "") + premier.t, Font.mediumSystemFont(12), C.texte, 2);
    }
    return w;
  }

  const grand = famille !== "medium";
  w.setPadding(grand ? 16 : 14, grand ? 16 : 15, 14, grand ? 16 : 15);
  if (grand) {
    txt(w, aujourdhui(), Font.semiboldSystemFont(12), C.accent);
    w.addSpacer(8);
  }
  const h = w.addStack();
  h.centerAlignContent();
  h.spacing = 8;
  entete(h, icon, titre);
  h.addSpacer();
  if (vue === "mails") pucesMails(h, d, 10);
  else if (vue === "taches") puces(h, d, 10);
  else txt(h, resume, Font.semiboldRoundedSystemFont(12), C.doux);
  w.addSpacer(grand ? 12 : 9);
  if (vue === "mails") mails(w, d, grand ? (famille === "large" ? 7 : 9) : 3, grand ? 13 : 12, true);
  else if (vue === "taches") taches(w, d, grand ? (famille === "large" ? 12 : 12) : 5, grand ? 13 : 12, true);
  else planning(w, d, grand ? (famille === "large" ? 14 : 18) : 6, grand ? 13 : 12, 40);
  w.addSpacer();
  pied(w, d);
  return w;
}

function construire(d, famille, vue) {
  const w = new ListWidget();
  w.url = vue === "mails" ? LIEN_MAILS : vue === "planning" ? LIEN_PLANNING : LIEN_TACHES;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const verrouille = famille.indexOf("accessory") === 0;
  if (!verrouille) w.backgroundColor = C.fond;
  if (d.erreur) {
    if (!verrouille) w.setPadding(14, 14, 14, 14);
    erreur(w, d.erreur);
    return w;
  }
  const prochain = d.planning.liste[0];
  if (vue !== "tout") return uneVue(w, d, famille, vue);

  if (famille === "accessoryInline") {
    w.addText(d.taches.ouvertes + " à faire" + (d.taches.retard ? ", " + d.taches.retard + " en retard" : "") + (prochain ? " · " + prochain.court + " " + prochain.t : ""));
    return w;
  }
  if (famille === "accessoryCircular") {
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    icone(s, d.taches.retard ? "exclamationmark.circle" : "checklist", 10);
    const n = s.addText(String(d.taches.retard || d.taches.ouvertes));
    n.font = Font.boldRoundedSystemFont(20);
    n.centerAlignText();
    return w;
  }
  if (famille === "accessoryRectangular") {
    const h = w.addStack();
    h.centerAlignContent();
    h.spacing = 4;
    icone(h, "checklist", 11);
    const a = h.addText(d.taches.ouvertes + " à faire" + (d.taches.retard ? " · " + d.taches.retard + " en retard" : ""));
    a.font = Font.semiboldSystemFont(13);
    a.lineLimit = 1;
    if (d.taches.liste[0]) {
      const b = w.addText(d.taches.liste[0].t);
      b.font = Font.systemFont(12);
      b.lineLimit = 1;
    }
    if (prochain) {
      const c = w.addText(prochain.court + "  " + prochain.t);
      c.font = Font.systemFont(12);
      c.lineLimit = 1;
    }
    return w;
  }

  if (famille === "small") {
    w.setPadding(14, 14, 14, 14);
    entete(w, "checklist", "À faire");
    w.addSpacer(2);
    txt(w, d.taches.ouvertes, Font.boldRoundedSystemFont(38), C.texte);
    puces(w, d, 10, true);
    w.addSpacer();
    const c = w.addStack();
    c.layoutVertically();
    c.setPadding(6, 8, 6, 8);
    c.cornerRadius = 10;
    c.backgroundColor = C.carte;
    c.url = LIEN_PLANNING;
    if (prochain) {
      txt(c, prochain.ton === "jour" ? prochain.heure || "Aujourd'hui" : prochain.court, Font.semiboldSystemFont(10), prochain.ton === "jour" ? C.accent : C.doux);
      txt(c, (prochain.deadline ? "⚑ " : "") + prochain.t, Font.mediumSystemFont(12), C.texte, 2);
    } else txt(c, "Planning libre", Font.mediumSystemFont(12), C.doux);
    return w;
  }

  const L = largeurWidget();
  if (famille === "medium") {
    w.setPadding(14, 15, 14, 15);
    const col = Math.floor((L - 30 - 21) / 2);
    const row = w.addStack();
    row.topAlignContent();
    const g = row.addStack();
    g.layoutVertically();
    g.size = new Size(col, 0);
    g.url = LIEN_TACHES;
    entete(g, "checklist", "À faire", d.taches.ouvertes);
    g.addSpacer(5);
    puces(g, d, 10, true);
    g.addSpacer(8);
    taches(g, d, 4, 12, false);
    g.addSpacer();
    row.addSpacer(10);
    separateur(row, true, 124);
    row.addSpacer(10);
    const p = row.addStack();
    p.layoutVertically();
    p.size = new Size(col, 0);
    p.url = LIEN_PLANNING;
    entete(p, "calendar", "Planning");
    p.addSpacer(7);
    planning(p, d, 5, 12, 36);
    p.addSpacer();
    pied(w, d);
    return w;
  }

  // Grand (et très grand sur iPad).
  const grand = famille !== "large";
  w.setPadding(16, 16, 14, 16);
  txt(w, aujourdhui(), Font.semiboldSystemFont(12), C.accent);
  w.addSpacer(8);
  const t = w.addStack();
  t.layoutVertically();
  t.url = LIEN_TACHES;
  entete(t, "checklist", "À faire", d.taches.ouvertes);
  t.addSpacer(6);
  puces(t, d, 11);
  t.addSpacer(9);
  taches(t, d, grand ? 9 : 5, 13, true);
  w.addSpacer(12);
  separateur(w, false, L - 32);
  w.addSpacer(12);
  const p = w.addStack();
  p.layoutVertically();
  p.url = LIEN_PLANNING;
  entete(p, "calendar", "Planning", d.planning.total ? d.planning.total + " sur 7 j" : null);
  p.addSpacer(8);
  planning(p, d, grand ? 10 : 7, 13, 40);
  w.addSpacer();
  pied(w, d);
  return w;
}

const donnees = await charger();
const famille = config.widgetFamily || "medium";
const widget = construire(donnees, famille, vueDe(args.widgetParameter));
if (config.runsInWidget) Script.setWidget(widget);
else if (famille === "small") await widget.presentSmall();
else if (famille === "large") await widget.presentLarge();
else await widget.presentMedium();
Script.complete();
`;

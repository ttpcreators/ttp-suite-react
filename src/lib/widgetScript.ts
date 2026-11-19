// ============================================================================
// widgetScript.ts : le widget iPhone de TTP Suite, dessiné par l'app Scriptable.
// ----------------------------------------------------------------------------
// Une webapp ne peut pas poser de widget sur l'écran d'accueil d'un iPhone. L'app
// Scriptable (gratuite) le fait avec un script : Paramètres › Résumés › Widget iPhone
// crée une clé, puis copie ce script (clé comprise) à coller dans Scriptable.
// Le script lit la fonction `widget` (tâches ouvertes + planning des 7 jours, lecture
// seule), garde la dernière réponse pour rester lisible hors connexion, et se dessine
// en petit, moyen, grand, et sur l'écran verrouillé.
// Données et règles : supabase/functions/_shared/widget.ts.
// ============================================================================

import { KEY_RE } from "../../supabase/functions/_shared/widget.ts";

export const SCRIPTABLE_APP_STORE = "https://apps.apple.com/app/scriptable/id1405459188";

/** Clé neuve : 32 octets aléatoires en base64url (43 caractères). */
export function nouvelleCle(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type WidgetScriptOpts = { supabaseUrl: string; anonKey: string; cle: string; app?: string; creeLe?: Date };

/** Le script Scriptable complet, clé comprise (à ne pas partager). */
export function widgetScript(o: WidgetScriptOpts): string {
  if (!KEY_RE.test(o.cle)) throw new Error("clé de widget invalide");
  const api = `${o.supabaseUrl.replace(/\/+$/, "")}/functions/v1/widget`;
  const app = (o.app ?? "https://app.ttpcreators.pro").replace(/\/+$/, "");
  const le = (o.creeLe ?? new Date()).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `// TTP Suite · widget iPhone (Scriptable), créé le ${le}.
// Tâches à faire et planning des 7 prochains jours, en lecture seule.
// Ce script contient la clé du widget : ne le partage pas.
// Clé perdue ou partagée : TTP Suite › Paramètres › Résumés › Widget iPhone › Nouvelle clé.

const API = ${JSON.stringify(api)};
const CLE = ${JSON.stringify(o.cle)};
const ANON = ${JSON.stringify(o.anonKey)};
const APP = ${JSON.stringify(app)};
const LIEN_TACHES = APP + "/?open=view&view=todo";
const LIEN_PLANNING = APP + "/?open=view&view=planning";

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.cacheDirectory(), "ttp-widget.json");

const C = {
  fond: Color.dynamic(new Color("#ffffff"), new Color("#161616")),
  texte: Color.dynamic(new Color("#151515"), new Color("#f2f2f2")),
  doux: Color.dynamic(new Color("#6e6e6e"), new Color("#9b9b9b")),
  trait: Color.dynamic(new Color("#d6d6d6"), new Color("#3a3a3a")),
  retard: Color.dynamic(new Color("#d93d42"), new Color("#ff6b6f")),
  jour: Color.dynamic(new Color("#c97a00"), new Color("#ffb340")),
  bientot: Color.dynamic(new Color("#2f6fdf"), new Color("#6ea2ff")),
};
const tonCouleur = (ton) => (ton === "retard" ? C.retard : ton === "jour" ? C.jour : ton === "bientot" || ton === "demain" ? C.bientot : C.doux);

async function charger() {
  try {
    const r = new Request(API);
    r.headers = { Authorization: "Bearer " + CLE, apikey: ANON };
    r.timeoutInterval = 15;
    const d = await r.loadJSON();
    const code = r.response ? r.response.statusCode : 0;
    if (code === 401) return { erreur: "Clé refusée. Recrée le script dans TTP Suite › Paramètres › Widget iPhone." };
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

function texte(stack, s, taille, couleur, gras) {
  const t = stack.addText(String(s));
  t.font = gras ? Font.semiboldSystemFont(taille) : Font.systemFont(taille);
  t.textColor = couleur || C.texte;
  t.lineLimit = 1;
  return t;
}

function heureMaj(d) {
  const h = new Date(d.maj || Date.now());
  const f = new DateFormatter();
  f.dateFormat = "HH:mm";
  return (d.horsLigne ? "hors ligne · " : "") + f.string(h);
}

function resumeTaches(d) {
  const p = [];
  if (d.taches.retard) p.push(d.taches.retard + " en retard");
  if (d.taches.aujourdhui) p.push(d.taches.aujourdhui + " aujourd'hui");
  return p.length ? p.join(" · ") : d.taches.ouvertes ? "rien d'urgent" : "tout est fait";
}

function ligneTache(stack, t, avecQuand, taille) {
  const l = stack.addStack();
  l.centerAlignContent();
  texte(l, "●", taille - 4, tonCouleur(t.ton));
  l.addSpacer(5);
  const x = texte(l, t.t, taille, C.texte, t.haute);
  x.minimumScaleFactor = 0.9;
  if (avecQuand && t.quand) {
    l.addSpacer(6);
    texte(l, t.quand, taille - 2, tonCouleur(t.ton));
  }
  stack.addSpacer(3);
}

function ligneEvent(stack, e, taille) {
  const l = stack.addStack();
  l.centerAlignContent();
  const c = texte(l, e.court, taille - 1, e.ton ? tonCouleur(e.ton) : C.doux, true);
  c.minimumScaleFactor = 0.8;
  l.addSpacer(5);
  texte(l, (e.deadline ? "⚑ " : "") + e.t, taille, C.texte);
  stack.addSpacer(3);
}

function colonneTaches(parent, d, n, avecQuand, taille) {
  const s = parent.addStack();
  s.layoutVertically();
  s.url = LIEN_TACHES;
  texte(s, "À faire · " + d.taches.ouvertes, taille + 1, C.texte, true);
  texte(s, resumeTaches(d), taille - 2, d.taches.retard ? C.retard : d.taches.aujourdhui ? C.jour : C.doux);
  s.addSpacer(6);
  for (const t of d.taches.liste.slice(0, n)) ligneTache(s, t, avecQuand, taille);
  if (!d.taches.liste.length) texte(s, "Aucune tâche ouverte", taille, C.doux);
  return s;
}

function colonnePlanning(parent, d, n, taille) {
  const s = parent.addStack();
  s.layoutVertically();
  s.url = LIEN_PLANNING;
  texte(s, "Planning", taille + 1, C.texte, true);
  texte(s, d.planning.total ? d.planning.total + " sur 7 jours" : "rien sur 7 jours", taille - 2, C.doux);
  s.addSpacer(6);
  for (const e of d.planning.liste.slice(0, n)) ligneEvent(s, e, taille);
  return s;
}

function widgetErreur(w, msg) {
  texte(w, "TTP Suite", 13, C.texte, true);
  w.addSpacer(4);
  const t = w.addText(msg);
  t.font = Font.systemFont(11);
  t.textColor = C.doux;
}

function construire(d, famille) {
  const w = new ListWidget();
  w.url = LIEN_TACHES;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const ecranVerrouille = famille.startsWith("accessory");
  if (!ecranVerrouille) {
    w.backgroundColor = C.fond;
    w.setPadding(14, 14, 12, 14);
  }
  if (d.erreur) {
    widgetErreur(w, d.erreur);
    return w;
  }
  const prochain = d.planning.liste[0];

  if (famille === "accessoryInline") {
    w.addText(d.taches.ouvertes + " tâches" + (prochain ? " · " + prochain.court + " " + prochain.t : ""));
    return w;
  }
  if (famille === "accessoryCircular") {
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    const n = s.addText(String(d.taches.retard || d.taches.ouvertes));
    n.font = Font.boldRoundedSystemFont(22);
    n.centerAlignText();
    const l = s.addText(d.taches.retard ? "retard" : "tâches");
    l.font = Font.systemFont(9);
    l.centerAlignText();
    return w;
  }
  if (famille === "accessoryRectangular") {
    const a = w.addText("À faire " + d.taches.ouvertes + " · " + resumeTaches(d));
    a.font = Font.semiboldSystemFont(12);
    a.lineLimit = 1;
    if (d.taches.liste[0]) {
      const b = w.addText(d.taches.liste[0].t);
      b.font = Font.systemFont(12);
      b.lineLimit = 1;
    }
    if (prochain) {
      const c = w.addText(prochain.court + " " + prochain.t);
      c.font = Font.systemFont(12);
      c.lineLimit = 1;
    }
    return w;
  }

  if (famille === "small") {
    texte(w, "À faire", 12, C.doux, true);
    const n = w.addText(String(d.taches.ouvertes));
    n.font = Font.boldRoundedSystemFont(34);
    n.textColor = C.texte;
    texte(w, resumeTaches(d), 11, d.taches.retard ? C.retard : d.taches.aujourdhui ? C.jour : C.doux);
    w.addSpacer();
    if (prochain) {
      texte(w, prochain.court, 11, prochain.ton ? tonCouleur(prochain.ton) : C.doux, true);
      const t = w.addText((prochain.deadline ? "⚑ " : "") + prochain.t);
      t.font = Font.systemFont(12);
      t.textColor = C.texte;
      t.lineLimit = 2;
    } else texte(w, "Planning libre", 11, C.doux);
    return w;
  }

  if (famille === "medium") {
    const row = w.addStack();
    row.topAlignContent();
    colonneTaches(row, d, 4, false, 12);
    row.addSpacer(12);
    colonnePlanning(row, d, 4, 12);
    w.addSpacer();
    const pied = texte(w, "maj " + heureMaj(d), 9, C.doux);
    pied.rightAlignText();
    return w;
  }

  // Grand (et très grand sur iPad).
  colonneTaches(w, d, famille === "large" ? 8 : 10, true, 13);
  w.addSpacer(8);
  const trait = w.addStack();
  trait.size = new Size(0, 1);
  trait.backgroundColor = C.trait;
  trait.addSpacer();
  w.addSpacer(8);
  colonnePlanning(w, d, famille === "large" ? 6 : 8, 13);
  w.addSpacer();
  const pied = texte(w, "maj " + heureMaj(d), 9, C.doux);
  pied.rightAlignText();
  return w;
}

const donnees = await charger();
const famille = config.widgetFamily || "medium";
const w = construire(donnees, famille);
if (config.runsInWidget) Script.setWidget(w);
else if (famille === "small") await w.presentSmall();
else if (famille === "large") await w.presentLarge();
else await w.presentMedium();
Script.complete();
`;
}

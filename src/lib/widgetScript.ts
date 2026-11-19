// ============================================================================
// widgetScript.ts : le widget iPhone de TTP Suite, dessiné par l'app Scriptable.
// ----------------------------------------------------------------------------
// Une webapp ne peut pas poser de widget sur l'écran d'accueil d'un iPhone. L'app
// Scriptable (gratuite) le fait avec un script : Paramètres › Résumés › Widget iPhone
// crée une clé, puis copie ce script (clé comprise) à coller dans Scriptable.
// Ce script n'est qu'un LANCEUR : il télécharge le dessin du widget (fonction `widget`,
// ?script=1 ; code dans supabase/functions/_shared/widgetRenderer.ts), le garde pour
// rester lisible hors connexion, puis l'exécute. Retoucher le dessin ne demande donc
// jamais de recoller le script. Données et règles : supabase/functions/_shared/widget.ts.
// ============================================================================

import { KEY_RE } from "../../supabase/functions/_shared/widget.ts";
import { RENDERER_TAG } from "../../supabase/functions/_shared/widgetRenderer.ts";

export const SCRIPTABLE_APP_STORE = "https://apps.apple.com/app/scriptable/id1405459188";

/** Clé neuve : 32 octets aléatoires en base64url (43 caractères). */
export function nouvelleCle(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type WidgetScriptOpts = { supabaseUrl: string; anonKey: string; cle: string; creeLe?: Date };

/** Le script Scriptable complet, clé comprise (à ne pas partager). */
export function widgetScript(o: WidgetScriptOpts): string {
  if (!KEY_RE.test(o.cle)) throw new Error("clé de widget invalide");
  const api = `${o.supabaseUrl.replace(/\/+$/, "")}/functions/v1/widget`;
  const le = (o.creeLe ?? new Date()).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `// TTP Suite · widget iPhone (Scriptable), créé le ${le}.
// Tâches, planning et mails non lus, en lecture seule.
// Vue au choix : touche le widget en mode édition, champ « Parameter » :
//   vide = tâches + planning · mails · taches · planning
// Ce script contient la clé du widget : ne le partage pas.
// Clé perdue ou partagée : TTP Suite › Paramètres › Widget iPhone › Nouvelle clé.

const API = ${JSON.stringify(api)};
const CLE = ${JSON.stringify(o.cle)};
const ANON = ${JSON.stringify(o.anonKey)};

const fm = FileManager.local();
const DESSIN = fm.joinPath(fm.cacheDirectory(), "ttp-widget-dessin.js");
let code = null;
try {
  const r = new Request(API + "?script=1");
  r.headers = { Authorization: "Bearer " + CLE, apikey: ANON };
  r.timeoutInterval = 15;
  const s = await r.loadString();
  if (r.response && r.response.statusCode === 200 && s.indexOf(${JSON.stringify(RENDERER_TAG)}) === 0) {
    code = s;
    fm.writeString(DESSIN, s);
  }
} catch (e) {}
if (!code && fm.fileExists(DESSIN)) code = fm.readString(DESSIN);
if (code) {
  const Dessin = Object.getPrototypeOf(async function () {}).constructor;
  await new Dessin("API", "CLE", "ANON", code)(API, CLE, ANON);
} else {
  const w = new ListWidget();
  const t = w.addText("TTP Suite : pas de connexion, ou clé refusée (Paramètres › Widget iPhone).");
  t.font = Font.systemFont(12);
  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentMedium();
  Script.complete();
}
`;
}

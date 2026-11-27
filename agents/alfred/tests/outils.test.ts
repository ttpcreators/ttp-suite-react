import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Les droits d'Alfred (listes de alfred.sh) suivent les outils du connecteur (supabase/functions/ttp-mcp).
// Alfred ne reçoit que le dossier agents/alfred : un outil ajouté au connecteur sans être classé ici lui
// est refusé, sans bruit, dans tous les passages où Marc n'a pas écrit (audit du 27 novembre 2026, T1).
// Ce test tourne dans le contrôle « build » des PR, celles de la session de Gianni comprises.
const ici = fileURLToPath(new URL("..", import.meta.url));
const dossierMcp = join(ici, "..", "..", "supabase", "functions", "ttp-mcp");
const alfred = readFileSync(join(ici, "alfred.sh"), "utf8");

const sources = readdirSync(dossierMcp)
  .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
  .map((n) => ({ fichier: n, texte: readFileSync(join(dossierMcp, n), "utf8") }));

type Outil = { nom: string; fichier: string; ecrit: boolean };

// Un outil du connecteur : la ligne « name: "…", » indentée de deux espaces, dans tools.ts, admin.ts,
// autonomie.ts, envois.ts, prospection.ts… L'en-tête de l'outil (jusqu'à « run: ») dit s'il écrit.
const outils: Outil[] = sources.flatMap(({ fichier, texte }) => {
  const lignes = [...texte.matchAll(/^ {2}name: "([a-z][a-z0-9_]*)",$/gm)];
  return lignes.map((m, i) => {
    const bloc = texte.slice(m.index, i + 1 < lignes.length ? lignes[i + 1].index : texte.length);
    const run = bloc.search(/^ {2}run:/m);
    return { nom: m[1], fichier, ecrit: /^ {2}write: true,$/m.test(run >= 0 ? bloc.slice(0, run) : bloc) };
  });
});
const noms = new Set(outils.map((o) => o.nom));

function liste(nom: string): string[] {
  const m = alfred.match(new RegExp(`^${nom}="([^"]*)"$`, "m"));
  if (!m) throw new Error(`La liste ${nom}="…" est introuvable dans agents/alfred/alfred.sh.`);
  return m[1].split(/\s+/).filter(Boolean);
}
const listes = { lire: liste("lire"), agir: liste("agir"), sur_oui: liste("sur_oui"), interdits: liste("interdits") };
const validesApp = liste("valides_app");

const QUOI_FAIRE =
  "Classe chaque outil dans UNE liste de agents/alfred/alfred.sh : " +
  "lire (lecture seule et gratuite, permise à Alfred sans message de Marc), " +
  "agir (écrit dans l'app sans risque, permise aussi), " +
  "sur_oui (envoie ou programme : seulement quand Marc a écrit, dans une délégation avec envoi autorisé, ou validé dans la page Agents), " +
  "interdits (refusé quand Marc n'a pas écrit). " +
  "Par défaut, un outil qui écrit, envoie, programme ou coûte (crédits FullEnrich, quota Meta) va dans interdits : " +
  "le mettre dans lire ou agir est une décision de Marc. " +
  "S'il envoie ou ne se défait pas, ajoute-le aussi à besoinValidation (supabase/functions/_shared/verrouAgent.ts), " +
  "et cite-le dans la fiche d'Alfred qui s'en sert (agents/alfred/fiches/), jamais dans son CLAUDE.md.";

describe("Alfred : les droits suivent les outils du connecteur", () => {
  it("les outils du connecteur sont tous lus", () => {
    expect(outils.length, "Aucun outil trouvé dans supabase/functions/ttp-mcp : le dossier a bougé ?").toBeGreaterThan(80);
    // Un outil écrit autrement (« name: » sur la même ligne que l'accolade, par exemple) serait oublié ici.
    const vus = sources.reduce((n, { texte }) => n + [...texte.matchAll(/\bname: "[a-z][a-z0-9_]*"/g)].length, 0);
    expect(vus, "Un outil du connecteur est déclaré autrement : garde « name: \"…\", » seul sur sa ligne, indenté de deux espaces.").toBe(outils.length);
  });

  it("chaque outil du connecteur est classé pour Alfred, dans une seule liste", () => {
    const places = (nom: string) => Object.entries(listes).filter(([, l]) => l.includes(nom)).map(([k]) => k);
    const oublies = outils.filter((o) => places(o.nom).length === 0).map((o) => `${o.nom} (${o.fichier})`);
    expect(oublies, `Outil du connecteur pas classé pour Alfred. ${QUOI_FAIRE}`).toEqual([]);
    const doubles = outils.filter((o) => places(o.nom).length > 1).map((o) => `${o.nom} : ${places(o.nom).join(" et ")}`);
    expect(doubles, `Outil classé dans plusieurs listes de agents/alfred/alfred.sh : garde-le dans une seule. ${QUOI_FAIRE}`).toEqual([]);
  });

  it("aucune liste de alfred.sh ne vise un outil disparu", () => {
    const tout = [...Object.values(listes).flat(), ...validesApp];
    const inconnus = [...new Set(tout.filter((n) => !noms.has(n)))];
    expect(inconnus, "Nom absent du connecteur (supabase/functions/ttp-mcp) : retire-le de agents/alfred/alfred.sh, ou corrige son nom s'il a été renommé.").toEqual([]);
    for (const k of Object.keys(listes) as (keyof typeof listes)[]) {
      const deux = listes[k].filter((n, i) => listes[k].indexOf(n) !== i);
      expect(deux, `Nom répété dans la liste ${k} de agents/alfred/alfred.sh.`).toEqual([]);
    }
  });

  it("un outil qui écrit n'est jamais dans lire", () => {
    const ecrivent = outils.filter((o) => o.ecrit && listes.lire.includes(o.nom)).map((o) => o.nom);
    expect(ecrivent, `Outil marqué write: true rangé dans lire (agents/alfred/alfred.sh). ${QUOI_FAIRE}`).toEqual([]);
  });

  it("envoyer ou programmer un mail n'est jamais permis sans « oui »", () => {
    const envois = ["envoyer_brouillon", "envoyer_brouillons_valides", "programmer_envoi", "envoyer_mail", "envoyer_dm"];
    const ouverts = envois.filter((n) => listes.lire.includes(n) || listes.agir.includes(n));
    expect(ouverts, "Un outil d'envoi est dans lire ou agir de agents/alfred/alfred.sh : il va dans sur_oui (ou interdits).").toEqual([]);
    expect(listes.sur_oui, "Un lot de prospection passe par la file d'envoi (programmer_envoi), dans sur_oui.").toContain("programmer_envoi");
  });
});

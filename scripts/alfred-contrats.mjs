/**
 * Fabrique agents/alfred/contrats.mjs : les moteurs de documents de l'app (src/lib/alfredDocs.ts :
 * contrats et rapport de fin de collab, avec ce qu'ils importent) en un seul fichier JavaScript, sans dépendance, pour Alfred sur l'iMac
 * (qui ne reçoit que le dossier agents/alfred). À relancer après tout changement des contrats :
 *   npm run alfred:contrats
 * Le test agents/alfred/tests/contrats.test.ts échoue si le fichier n'est plus à jour.
 */
import { rolldown } from "rolldown";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
export const SORTIE = `${racine}agents/alfred/contrats.mjs`;
const ENTETE =
  "// FICHIER GÉNÉRÉ par `npm run alfred:contrats` depuis src/lib/alfredDocs.ts : ne pas le modifier à la main.\n" +
  "// Les moteurs de documents de l'app TTP Suite (contrats, rapport de fin de collab), pour qu'Alfred envoie exactement ce que l'app ferait.\n";

/** Le contenu du fichier, tel qu'il doit être. */
export async function fabriquer() {
  const b = await rolldown({
    input: `${racine}src/lib/alfredDocs.ts`,
    resolve: { alias: { "@": `${racine}src` } },
    logLevel: "silent",
  });
  const { output } = await b.generate({ format: "esm" });
  await b.close();
  return ENTETE + output[0].code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(SORTIE, await fabriquer());
  console.log(`Écrit : agents/alfred/contrats.mjs`);
}

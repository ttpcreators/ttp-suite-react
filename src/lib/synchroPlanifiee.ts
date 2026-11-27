/**
 * Relance groupée d'une synchro après des écritures rapprochées (logique pure : le lancement
 * est passé en paramètre, sans réseau ni React).
 *
 * Sert à la synchro Google Agenda (src/lib/googleCalendar.ts) : depuis la fin de la boucle avec
 * Google (27/11/2026), plus rien ne relançait un passage après un enregistrement de rendez-vous,
 * qui attendait le cron horaire (jusqu'à 1 h). Pendant cette attente, un changement fait dans
 * Google sur le même rendez-vous (réponse d'un invité, lien Meet) pouvait l'emporter, et la
 * modification de l'app était alors perdue (« dernier modifié gagne »).
 *
 * - Un seul lancement, `delaiMs` après la dernière écriture (la création d'un rendez-vous et son
 *   lien vers une collab, écrit juste après, partent ensemble).
 * - Un passage tourne déjà côté serveur (« verrou ») : il a pu lire la ligne avant l'écriture,
 *   donc nouvel essai après `attenteVerrouMs`, `essaisVerrou` fois au plus.
 * - Une écriture faite pendant un lancement en relance un autre juste après lui.
 * - Une erreur (Google pas connecté, réseau) : rien de plus, le cron horaire rattrape.
 */

export type IssueLancement = "fait" | "verrou" | "erreur";

export interface OptionsPlanif {
  delaiMs?: number;
  attenteVerrouMs?: number;
  essaisVerrou?: number;
}

export function creerPlanificateur(
  lancer: () => Promise<IssueLancement>,
  { delaiMs = 2000, attenteVerrouMs = 5000, essaisVerrou = 2 }: OptionsPlanif = {},
): { planifier: () => void } {
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let enCours = false;
  let aRefaire = false;

  const programmer = (ms: number, essai: number) => {
    if (minuterie) clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      minuterie = null;
      void executer(essai);
    }, ms);
  };

  async function executer(essai: number): Promise<void> {
    if (enCours) {
      aRefaire = true;
      return;
    }
    enCours = true;
    let issue: IssueLancement = "erreur";
    try {
      issue = await lancer();
    } catch {
      issue = "erreur";
    }
    enCours = false;
    if (aRefaire) {
      aRefaire = false;
      void executer(0);
      return;
    }
    // Une nouvelle écriture a déjà reprogrammé un lancement : il suffit.
    if (issue === "verrou" && essai < essaisVerrou && !minuterie) programmer(attenteVerrouMs, essai + 1);
  }

  return { planifier: () => programmer(delaiMs, 0) };
}

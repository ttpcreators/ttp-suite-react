// ============================================================================
// _shared/rdv.ts : la page publique « Réserver une visio avec Marc » (app.ttpcreators.pro/rdv/).
// ----------------------------------------------------------------------------
// Organisation Gianni / Marc (20/11/2026) : dès qu'un contact montre un vrai intérêt, il
// reçoit un lien pour réserver une visio dans l'agenda de Marc, sur ses 2 demi-journées
// fixes par semaine. Réglages : Paramètres › Résumés et rappels › Rendez-vous (clé du blob
// `rdvMarc`). Les créneaux libres tiennent compte de Google Agenda (liste des évènements).
// Règles PURES (heure de Paris), testées par rdv.test.ts.
// ============================================================================

import { couper } from "./texteSur.ts";

export const RDV_KEY = "rdvMarc";
export const RDV_URL = "https://app.ttpcreators.pro/rdv/";
export const RDV_ORIGINS = ["https://app.ttpcreators.pro", "http://localhost:5173", "http://localhost:4173"];
const TZ = "Europe/Paris";

/** Une demi-journée : jour de la semaine (1 = lundi … 7 = dimanche), heures de Paris. */
export type Plage = { jour: number; debut: string; fin: string };
export type RdvConfig = { actif: boolean; plages: Plage[]; duree: number; delaiHeures: number; horizonJours: number };

export const RDV_DEFAUT: RdvConfig = {
  actif: false,
  plages: [{ jour: 2, debut: "14:00", fin: "18:00" }, { jour: 4, debut: "09:00", fin: "12:30" }],
  duree: 30,
  delaiHeures: 20,
  horizonJours: 14,
};

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Réglages lus dans le blob (tolérant), complétés par les valeurs par défaut. */
export function lireRdv(v: unknown): RdvConfig {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const plages = Array.isArray(o.plages)
    ? (o.plages as Record<string, unknown>[])
        .map((p) => ({ jour: Number(p?.jour), debut: String(p?.debut ?? ""), fin: String(p?.fin ?? "") }))
        .filter((p) => p.jour >= 1 && p.jour <= 7 && HEURE.test(p.debut) && HEURE.test(p.fin) && minutes(p.fin) > minutes(p.debut))
        .slice(0, 7)
    : RDV_DEFAUT.plages;
  const n = (x: unknown, d: number, min: number, max: number) => {
    const v = Math.round(Number(x));
    return Number.isFinite(v) && v >= min && v <= max ? v : d;
  };
  return {
    actif: o.actif === true,
    plages,
    duree: n(o.duree, RDV_DEFAUT.duree, 15, 120),
    delaiHeures: n(o.delaiHeures, RDV_DEFAUT.delaiHeures, 0, 96),
    horizonJours: n(o.horizonJours, RDV_DEFAUT.horizonJours, 3, 60),
  };
}

/** Jour (AAAA-MM-JJ), jour de la semaine (1-7) et heure à Paris d'un instant. */
export function paris(d: Date): { jour: string; semaine: number; heure: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const semaine = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(String(p.weekday)) + 1;
  return { jour: `${p.year}-${p.month}-${p.day}`, semaine, heure: `${p.hour}:${p.minute}` };
}

/** L'instant (ms) qui correspond à « jour heure » à Paris (heure d'été comprise). */
export function instantParis(jour: string, heure: string): number {
  const naif = Date.parse(`${jour}T${heure}:00Z`);
  // Décalage de Paris à cet instant : on corrige une fois, puis on revérifie (changement d'heure).
  let t = naif;
  for (let i = 0; i < 2; i++) {
    const p = paris(new Date(t));
    const vu = Date.parse(`${p.jour}T${p.heure}:00Z`);
    t += naif - vu;
  }
  return t;
}

function addDays(jour: string, n: number): string {
  const d = new Date(jour + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type Occupe = { debut: number; fin: number };

/** Un évènement de Google Agenda, réduit à ce qui dit s'il occupe l'agenda. */
export type EvenementAgenda = {
  status?: string;
  transparency?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

/**
 * Les moments occupés d'après la liste des évènements de l'agenda (events.list), avec les
 * règles de freeBusy : annulé, marqué « disponible », refusé par Marc ou simple lieu de
 * travail = libre. Une journée entière compte de minuit à minuit, heure de Paris.
 */
export function occupeDepuisEvenements(items: readonly EvenementAgenda[] | null | undefined): Occupe[] {
  const out: Occupe[] = [];
  const instant = (x?: { date?: string; dateTime?: string }) =>
    x?.dateTime ? Date.parse(x.dateTime) : x?.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? instantParis(x.date, "00:00") : NaN;
  for (const e of items ?? []) {
    if (!e || e.status === "cancelled" || e.transparency === "transparent" || e.eventType === "workingLocation") continue;
    if ((e.attendees ?? []).some((p) => p?.self && p.responseStatus === "declined")) continue;
    const debut = instant(e.start), fin = instant(e.end);
    if (Number.isFinite(debut) && Number.isFinite(fin) && fin > debut) out.push({ debut, fin });
  }
  return out;
}
export type Creneau = { jour: string; heure: string; debut: number };

/** Créneaux libres de `now + délai` à l'horizon, dans les plages, hors rendez-vous déjà pris. */
export function creneauxLibres(c: RdvConfig, now: Date, occupe: readonly Occupe[]): Creneau[] {
  const out: Creneau[] = [];
  const min = now.getTime() + c.delaiHeures * 3_600_000;
  const auj = paris(now).jour;
  for (let i = 0; i <= c.horizonJours; i++) {
    const jour = addDays(auj, i);
    const semaine = paris(new Date(instantParis(jour, "12:00"))).semaine;
    for (const p of c.plages.filter((x) => x.jour === semaine)) {
      for (let m = minutes(p.debut); m + c.duree <= minutes(p.fin); m += c.duree) {
        const debut = instantParis(jour, hhmm(m));
        const fin = debut + c.duree * 60_000;
        if (debut < min) continue;
        if (occupe.some((o) => o.debut < fin && o.fin > debut)) continue;
        out.push({ jour, heure: hhmm(m), debut });
      }
    }
  }
  return out.sort((a, b) => a.debut - b.debut);
}

export type Reservation = { jour: string; heure: string; nom: string; email: string; marque: string; message: string };

// Coupe sans casser d'emoji (couper, _shared/texteSur.ts) : le texte va en base (contact, tâche).
const propre = (v: unknown, max: number) => couper(String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim(), max);
// « * » refusé, comme dans _shared/siteLead.ts : dans un filtre ilike, PostgREST le lit comme un
// joker et rien ne peut l'échapper.
const EMAIL_RE = /^[^@\s<>"',;:*]{1,64}@[^@\s<>"',;:*]{1,190}\.[a-z]{2,24}$/i;

/** Demande de réservation lue et nettoyée, ou la raison du refus. `site` rempli = robot. */
export function lireReservation(body: unknown): { r: Reservation } | { robot: true } | { erreur: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (propre(b.site, 200)) return { robot: true };
  const jour = propre(b.jour, 10), heure = propre(b.heure, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || !HEURE.test(heure)) return { erreur: "creneau" };
  const email = propre(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { erreur: "email" };
  const nom = propre(b.nom, 80);
  if (!nom) return { erreur: "nom" };
  const marque = propre(b.marque, 80);
  if (!marque) return { erreur: "marque" };
  return { r: { jour, heure, nom, email, marque, message: couper(String(b.message ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").trim(), 1500) } };
}

/**
 * L'invitation Google envoyée à l'adresse saisie : titre et texte fixes. Rien de ce que le
 * visiteur a écrit (nom, marque, message) n'y figure : ces textes restent dans la tâche interne
 * et le mail à l'agence. Google ajoute lui-même le lien Meet à l'invitation.
 */
export const INVITATION_RDV = {
  titre: "Visio TTP Creators",
  texte: "Visio avec l'agence TTP Creators. Le lien Google Meet est dans cette invitation.",
} as const;

/** Ce que le carnet de contacts a fait de l'adresse saisie : fiche existante (jamais modifiée), nouveau contact, ou rien (lecture ou écriture ratée). */
export type CarnetRdv =
  | { etat: "fiche"; marque: string; historique: string; sequenceEnCours: boolean }
  | { etat: "nouveau" }
  | { etat: "rate" };

/**
 * La tâche interne d'une réservation : titre et description. L'adresse saisie n'est pas confirmée
 * par mail, donc une fiche existante n'est pas modifiée (la description dit quoi vérifier), et une
 * tâche « Visio : marque » déjà ouverte n'est jamais réécrite : la réservation fait alors sa propre
 * tâche « Réservation : marque » (`visioOuverte`).
 */
export function tacheRdv(o: { r: Reservation; duree: number; meet?: string; carnet: CarnetRdv; visioOuverte: boolean }): { text: string; descr: string } {
  const { r, carnet } = o;
  const marque = couper(r.marque, 80);
  const fiche = carnet.etat === "fiche"
    ? `Déjà au carnet (${carnet.marque || "sans marque"}) : fiche non modifiée, l'adresse n'a pas été confirmée par mail.${carnet.sequenceEnCours ? " Sa séquence de prospection continue : l'arrêter (sequence_contact) si c'est bien ce contact." : ""}`
    : carnet.etat === "nouveau"
      ? "Nouveau contact (ajouté au carnet, étiquette « Lead site »)."
      : "Contact pas ajouté au carnet (lecture ou écriture ratée) : à vérifier.";
  return {
    text: o.visioOuverte ? `Réservation : ${marque}` : `Visio : ${marque}`,
    descr: [
      `Visio réservée par ${r.nom} (${r.email}) pour le ${quandFr(r.jour, r.heure)} (${o.duree} min).`,
      o.meet ? `Lien Meet : ${o.meet}` : "",
      r.message ? `Son besoin : ${r.message}` : "",
      fiche,
      carnet.etat === "fiche" && carnet.historique ? `Historique :\n${carnet.historique}` : "",
      o.visioOuverte ? `Une tâche « Visio : ${marque} » était déjà ouverte : elle n'a pas été modifiée.` : "",
      "La visio en 5 points : le besoin, le budget, qui décide, notre proposition orale, et un devis envoyé le jour même.",
    ].filter(Boolean).join("\n"),
  };
}

/** Le créneau demandé est-il toujours libre et dans les règles ? */
export function creneauOk(c: RdvConfig, now: Date, occupe: readonly Occupe[], jour: string, heure: string): boolean {
  return creneauxLibres(c, now, occupe).some((x) => x.jour === jour && x.heure === heure);
}

/** « mardi 24 novembre à 14:30 » */
export function quandFr(jour: string, heure: string): string {
  const d = new Date(jour + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  return `${d} à ${heure.replace(":", " h ")}`.replace(" h 00", " h");
}

/**
 * Message Telegram envoyé à Marc quand une visio est réservée : le jour, l'heure et la durée.
 * Aucun texte du visiteur (nom, marque, besoin), comme pour le push : la page est publique.
 */
export function texteTelegramRdv(jour: string, heure: string, duree: number): string {
  return `Visio réservée : ${quandFr(jour, heure)} (${duree} min). La fiche du contact est dans la to-do de l'app.`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const uneLigne = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/**
 * Mail envoyé à la boîte de l'agence quand une visio est réservée : qui, quand, le lien Meet
 * et le message du contact. Tout ce que le visiteur a écrit est échappé, l'objet tient sur
 * une ligne.
 */
export function mailRdv(o: { nom: string; email: string; marque: string; message?: string; jour: string; heure: string; duree: number; meet?: string }): { subject: string; html: string } {
  const quand = quandFr(o.jour, o.heure);
  const html = [
    `<p><b>Visio réservée : ${esc(quand)} (${o.duree} min)</b></p>`,
    `<p>${esc(uneLigne(o.nom))}, ${esc(uneLigne(o.marque))}<br>${esc(uneLigne(o.email))}</p>`,
    o.meet ? `<p>Lien Meet : <a href="${esc(o.meet)}">${esc(o.meet)}</a></p>` : "",
    o.message ? `<p>Son message (écrit par le contact) :<br>${esc(o.message).replace(/\r?\n/g, "<br>")}</p>` : "",
    `<p style="color:#777;font-size:12px">Envoyé par la page de rendez-vous de TTP Suite. La fiche complète est dans la to-do de l'app, le rendez-vous est dans Google Agenda.</p>`,
  ].filter(Boolean).join("");
  return { subject: `Visio réservée : ${uneLigne(o.marque).slice(0, 60)}, ${quand}`, html };
}

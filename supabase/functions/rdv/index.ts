// ============================================================================
// rdv/index.ts : la page publique « Réserver une visio avec Marc » (app.ttpcreators.pro/rdv/).
// ----------------------------------------------------------------------------
// GET  → { actif, duree, jours: [{ jour, label, heures[] }] } : créneaux libres de Marc
//        (ses demi-journées réglées dans Paramètres, moins ce qui est déjà dans Google Agenda).
// POST { jour, heure, nom, email, marque, message?, site? (piège à robots) } →
//        rendez-vous Google Agenda avec lien Meet et invitation Google au contact,
//        contact noté au carnet (séquence arrêtée : il a répondu), tâche « Visio : marque »
//        avec la fiche pour Marc, push générique à l'agence, message Telegram à Marc
//        (secrets ALFRED_BOT_TOKEN et TELEGRAM_CHAT_ID, comme agent-watchdog ; sans eux, rien)
//        et mail à la boîte partnerships@ (qui, quand, lien Meet, message du contact).
// AUTH : verify_jwt = false (page publique). Garde-fous : CORS app seulement, piège à
// robots, créneau revérifié au moment de réserver, 10 réservations par heure au plus,
// aucun texte du visiteur dans la notification. Règles : _shared/rdv.ts.
// ============================================================================

import { APP_TIMEZONE, CALENDAR_ID, gcalFetch, getAccessToken, getServiceClient, triggerSync } from "../_shared/google.ts";
import { mimeMessage } from "../_shared/backup.ts";
import { readAppState } from "../_shared/appState.ts";
import { meetEventBody, meetLinkOf } from "../_shared/meetEvent.ts";
import { makePayload, pushReady, sendTo } from "../_shared/push.ts";
import { arreter, lireSequence } from "../_shared/sequence.ts";
import { LEAD_TAG } from "../_shared/siteLead.ts";
import { RDV_KEY, RDV_ORIGINS, creneauOk, creneauxLibres, lireRdv, lireReservation, mailRdv, occupeDepuisEvenements, quandFr, texteTelegramRdv, type EvenementAgenda, type Occupe, type RdvConfig } from "../_shared/rdv.ts";

type Sb = ReturnType<typeof getServiceClient>;

const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();

/** Message sur le Telegram de Marc, par le bot d'Alfred (mêmes secrets qu'agent-watchdog). */
async function telegramMarc(text: string): Promise<void> {
  const bot = Deno.env.get("ALFRED_BOT_TOKEN") ?? "";
  const chat = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
  if (!bot || !chat) return;
  await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
    signal: AbortSignal.timeout(4000),
  });
}

/** Mail de la boîte partnerships@ à elle-même (connexion Google de l'app, comme monthly-backup). */
async function mailAgence(sb: Sb, m: { subject: string; html: string }): Promise<void> {
  const boite = `partnerships@${AGENCY_DOMAIN}`;
  const token = await getAccessToken(sb);
  const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
    body: mimeMessage({ from: `TTP Suite <${boite}>`, to: [boite], subject: m.subject, html: m.html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) console.error("rdv mail agence", res.status);
}

async function occupe(sb: Sb, c: RdvConfig, now: Date): Promise<Occupe[]> {
  // La liste des évènements, pas freeBusy : la connexion Google de l'app a le droit
  // `calendar.events`, que freeBusy refuse (403 : la page n'affichait aucun créneau).
  // Les règles de freeBusy sont refaites dans occupeDepuisEvenements.
  const items: EvenementAgenda[] = [];
  let page = "";
  for (let i = 0; i < 6; i++) {
    const q = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + (c.horizonJours + 1) * 86_400_000).toISOString(),
      singleEvents: "true",
      maxResults: "250",
      fields: "nextPageToken,items(status,transparency,eventType,start,end,attendees(self,responseStatus))",
    });
    if (page) q.set("pageToken", page);
    const res = await gcalFetch(sb, `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${q.toString()}`, {}, { maxRetries: 2 });
    if (!res.ok) throw new Error(`agenda_${res.status}`);
    const j = await res.json() as { items?: EvenementAgenda[]; nextPageToken?: string };
    items.push(...(j.items ?? []));
    page = j.nextPageToken ?? "";
    if (!page) return occupeDepuisEvenements(items);
  }
  // Agenda lu en partie seulement : mieux vaut ne rien proposer qu'un créneau déjà pris.
  throw new Error("agenda_trop_long");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
    ...(origin && RDV_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (origin && !RDV_ORIGINS.includes(origin)) return json({ error: "origin" }, 403);

  const sb = getServiceClient();
  const now = new Date();
  let c: RdvConfig;
  try {
    c = lireRdv((await readAppState(sb))[RDV_KEY]);
  } catch {
    return json({ error: "indisponible" }, 503);
  }
  if (!c.actif) return json({ actif: false });

  if (req.method === "GET") {
    try {
      const libres = creneauxLibres(c, now, await occupe(sb, c, now));
      const jours: { jour: string; label: string; heures: string[] }[] = [];
      for (const x of libres) {
        let j = jours.find((d) => d.jour === x.jour);
        if (!j) {
          j = { jour: x.jour, label: new Date(x.jour + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }), heures: [] };
          jours.push(j);
        }
        j.heures.push(x.heure);
      }
      return json({ actif: true, duree: c.duree, jours });
    } catch (e) {
      console.error("rdv créneaux", (e as Error).message);
      return json({ error: "agenda" }, 503);
    }
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const lu = lireReservation(await req.json().catch(() => null));
  if ("robot" in lu) return json({ ok: true });
  if ("erreur" in lu) return json({ error: lu.erreur }, 400);
  const r = lu.r;

  const { count } = await sb.from("todos").select("id", { count: "exact", head: true }).like("text", "Visio : %").gte("created_at", new Date(now.getTime() - 3_600_000).toISOString());
  if ((count ?? 0) >= 10) return json({ error: "trop" }, 429);

  try {
    if (!creneauOk(c, now, await occupe(sb, c, now), r.jour, r.heure)) return json({ error: "pris" }, 409);
  } catch {
    return json({ error: "agenda" }, 503);
  }

  // Le rendez-vous, avec Meet et l'invitation Google au contact.
  const cal = `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
  const note = [`Visio réservée depuis la page de rendez-vous par ${r.nom} (${r.email}), ${r.marque}.`, r.message ? `Son besoin : ${r.message}` : ""].filter(Boolean).join("\n");
  const res = await gcalFetch(sb, `${cal}?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    body: JSON.stringify(meetEventBody({ title: `Visio TTP Creators × ${r.marque}`, date: r.jour, time: r.heure, duration: c.duree, guests: [r.email], meet: true, invite: true, note, who: null }, APP_TIMEZONE, crypto.randomUUID())),
  }, { maxRetries: 2 }).catch(() => null);
  const ev = res ? await res.json().catch(() => ({})) as { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } } : {};
  if (!res?.ok || !ev.id) {
    console.error("rdv évènement", res?.status);
    return json({ error: "agenda" }, 503);
  }
  const meet = meetLinkOf(ev);

  // Carnet : le contact a répondu (sa séquence s'arrête), la visio est notée dans son journal.
  const jour = r.jour;
  const touche = { id: `rdv${now.getTime().toString(36)}`, date: new Date().toISOString().slice(0, 10), canal: "email", kind: "reponse", note: `Visio réservée pour le ${quandFr(r.jour, r.heure)}` };
  const { data: ex } = await sb.from("contacts").select("*").ilike("email", r.email.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(1);
  const contact = ((ex ?? []) as Record<string, unknown>[])[0];
  let historique = "";
  if (contact) {
    const touches = Array.isArray(contact.touches) ? (contact.touches as Record<string, unknown>[]) : [];
    historique = touches.slice(0, 6).map((t) => `- ${String(t.date ?? "").slice(0, 10)} · ${t.canal ?? ""} · ${t.kind ?? ""}${t.note ? ` · ${String(t.note).slice(0, 120)}` : ""}`).join("\n");
    const patch: Record<string, unknown> = { touches: [touche, ...touches] };
    const seq = lireSequence(contact.sequence);
    if (seq && seq.statut === "en_cours") patch.sequence = arreter(seq, "visio réservée", now, "positive");
    await sb.from("contacts").update(patch).eq("id", contact.id).then(() => {}, () => {});
  } else {
    await sb.from("contacts").insert({ brand: r.marque, person: r.nom, email: r.email, tag: LEAD_TAG, touches: [touche] }).then(() => {}, () => {});
  }

  // Tâche « Visio : marque » avec la fiche avant l'appel (une seule ouverte par marque).
  const text = `Visio : ${r.marque.slice(0, 80)}`;
  const descr = [
    `Visio réservée par ${r.nom} (${r.email}) pour le ${quandFr(r.jour, r.heure)} (${c.duree} min).`,
    meet ? `Lien Meet : ${meet}` : "",
    r.message ? `Son besoin : ${r.message}` : "",
    contact ? `Déjà au carnet (${String(contact.brand ?? "")}).` : "Nouveau contact (ajouté au carnet, étiquette « Lead site »).",
    historique ? `Historique :\n${historique}` : "",
    "La visio en 5 points : le besoin, le budget, qui décide, notre proposition orale, et un devis envoyé le jour même.",
  ].filter(Boolean).join("\n");
  const { data: deja } = await sb.from("todos").select("id").eq("text", text).or("done.is.null,done.eq.false").limit(1);
  if ((deja ?? []).length) await sb.from("todos").update({ descr, due: jour, priority: "haute" }).eq("id", (deja as { id: string }[])[0].id).then(() => {}, () => {});
  else await sb.from("todos").insert({ text, descr, priority: "haute", due: jour, done: false }).then(() => {}, () => {});

  if (pushReady()) {
    await sendTo(sb, { agency: true }, makePayload({ kind: "team", title: "Visio réservée", body: "Un contact a réservé une visio. Détail dans la to-do et le planning.", url: "/?open=view&view=todo", tag: "ttp-rdv" })).catch(() => {});
  }
  // Deux traces en plus du push (qui n'arrive que sur un téléphone abonné), envoyées en même
  // temps. Le rendez-vous est déjà pris : un envoi raté ne fait jamais échouer la réservation.
  await Promise.allSettled([telegramMarc(texteTelegramRdv(r.jour, r.heure, c.duree)), mailAgence(sb, mailRdv({ ...r, duree: c.duree, meet: meet || undefined }))]);
  try {
    triggerSync("webhook");
  } catch {
    /* la synchro horaire l'amènera dans le Planning */
  }
  return json({ ok: true, quand: quandFr(r.jour, r.heure), duree: c.duree, meet });
});

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getAppState, invalidateAppState, refreshAppState, saveAppStateKey } from "./appState";
import { useLiveKey } from "./useLive";
import { EMPTY, fmtAgoSince, fmtDay, todayISO } from "./dates";
import { titleCase } from "./utils";
import { conceptColumnsMissing, conceptState } from "./briefConcept";
import { toast } from "@/components/ui/toast";
import type { NotificationItem } from "@/components/ui/notifications";
import { teamNames } from "./team";
import { closeMailThreadNotifications } from "./appBadge";
import { activityText } from "../../supabase/functions/_shared/activityText";
import { isOverdueInvoice } from "./relance";
import { upcomingBirthdays } from "../../supabase/functions/_shared/birthdays";
import { couper } from "../../supabase/functions/_shared/texteSur.ts";

type Deadline = { creator: string; type: string; start: string; months: number };
function ctEnd(start: string, months: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1 + (months || 0), Number(m[3]));
}
function ctDaysLeft(d: Date): number {
  const t = new Date();
  return Math.round((d.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
}
/** Durée depuis un created_at, format commun : « 23 j », « 4 mois » ; « — » sans date. */
function agoLabel(iso: string | null): string {
  return fmtAgoSince(iso) || EMPTY;
}

// File d'attente d'effacements (module-level) : sérialise les écritures du blob
// `notifDismissed` pour éviter la course read-merge-write entre deux dismiss.
let dismissQueue: Promise<void> = Promise.resolve();
// Dernier blob agence bien lu (repli quand une relecture échoue).
let lastApp: Record<string, unknown> = {};

/** Notifications dérivées des vraies données : activité créateur, factures en retard, briefs et concepts à valider, événements.
 *  Les IDs sont STABLES (contenu, pas index) pour que l'effacement persiste :
 *  les ids effacés sont mémorisés dans le blob agence `notifDismissed`. */
export function useNotifications(): { items: NotificationItem[]; dismiss: (ids: string[]) => void } {
  const [items, setItems] = useState<NotificationItem[]>([]);
  // Rejoue le fetch à chaque tick live : indispensable après une connexion par
  // formulaire (le premier fetch part AVANT l'auth → RLS renvoie vide) et pour
  // garder la cloche à jour sans recharger la page.
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    const run = async () => {
    // Attend la restauration de la session : un fetch pré-auth renvoie des
    // listes vides (RLS) et mettrait en cache un blob vide → les notifications
    // effacées réapparaîtraient au refresh. On repart toujours d'un blob frais.
    const { data: s } = await supabase.auth.getSession();
    if (!alive) return;
    if (!s.session) {
      setItems([]);
      return;
    }
    const todayStr = todayISO();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const emailSince = new Date(Date.now() - 3 * 86400000).toISOString(); // emails reçus : 72 h
    Promise.all([
      // Factures en retard : même règle que Facturation (statut « retard », ou « attente » échue).
      supabase.from("invoices").select("id,party,amount,status,date").in("status", ["retard", "attente"]),
      supabase.from("briefs").select("id,brand,creator,status").eq("status", "valider"),
      supabase.from("events").select("id,date,time,title").or("deleted.is.null,deleted.eq.false").gte("date", todayStr).order("date").limit(3),
      // Blob frais, mais partagé avec le rafraîchissement des pages (une seule lecture par
      // tick). Lecture échouée ≠ blob vide : on garde le dernier lu, sinon les
      // notifications effacées (notifDismissed) réapparaissaient à la moindre coupure.
      refreshAppState().then(
        (st) => (lastApp = st),
        () => lastApp,
      ),
      supabase.from("todos").select("text,creator,created_at").eq("source", "creator").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
      supabase.from("ideas").select("text,creator,created_at").eq("source", "creator").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
      supabase.from("events").select("title,who,created_at").eq("source", "creator").or("deleted.is.null,deleted.eq.false").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
      // « * » : marche avant/après la colonne read_at (mail ouvert dans Gmail ou Spark).
      supabase.from("email_activity").select("*").eq("direction", "in").gte("created_at", emailSince).order("created_at", { ascending: false }).limit(8),
      // Bugs remontés par l'app (agence uniquement via RLS). « * » : marche avant/après la colonne resolved_at.
      supabase.from("error_log").select("*").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(100),
      // Mails créatrices : leurs avis (En cours / Validé / Refusé) et leurs messages non lus.
      supabase.from("creator_mail_status_log").select("id,creator,status,comment,created_at").eq("by_role", "creator")
        .gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
      supabase.from("creator_mail_notes").select("id,creator,body,created_at").is("agency_read_at", null)
        .gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
      // Équipe agence : ce que les AUTRES ont fait (3 derniers jours).
      supabase.from("agency_activity").select("*").neq("actor_id", s.session.user.id)
        .gte("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
        .order("created_at", { ascending: false }).limit(15),
      teamNames(),
      supabase.from("creators").select("name,birth,status"),
      // Concepts proposés par les créateurs (colonnes du SQL 2026-11-23 ; absentes : aucune ligne).
      supabase.from("briefs").select("id,brand,creator,concept,concept_status,concept_at").eq("concept_status", "propose"),
    ]).then(([inv, br, ev, app, tdC, idC, evC, mailIn, bugs, mailAvis, mailNotes, team, names, crea, conc]) => {
      if (!alive) return;
      if (inv.error || br.error || ev.error) {
        console.error("Chargement des notifications échoué:", { inv: inv.error, br: br.error, ev: ev.error });
        setItems([]);
        return;
      }
      const out: NotificationItem[] = [];
      // Bugs non résolus (7 j) : une seule alerte, id = dernier bug (réapparaît si un nouveau survient).
      if (!bugs.error) {
        const openBugs = ((bugs.data as { id: string; message: string | null; created_at: string; resolved_at?: string | null }[]) ?? []).filter((b) => !b.resolved_at);
        if (openBugs.length) {
          const kinds = new Set(openBugs.map((b) => b.message ?? ""));
          out.push({
            id: `bug:${openBugs[0].id}`,
            title: kinds.size > 1 ? `${kinds.size} bugs à regarder` : "Un bug à regarder",
            description: `${(openBugs[0].message ?? "").slice(0, 90)} · Réglages → Diagnostic`,
            time: agoLabel(openBugs[0].created_at),
            kind: "bug",
            page: "diagnostique",
          });
        }
      }
      // Activité créateur en premier (7 derniers jours) — désactivable dans Paramètres.
      const prefs = ((app as Record<string, unknown>).notifPrefs as Record<string, boolean | undefined>) ?? {};
      // Anniversaires des créateurs : la veille et le jour J (même réglage que le résumé du matin).
      if (prefs.digestBirthdays !== false && !crea.error) {
        for (const b of upcomingBirthdays((crea.data ?? []) as { name: string; birth: string | null; status: string | null }[], todayStr)) {
          const who = titleCase(b.name);
          const age = b.age ? `${b.age} ans` : "";
          out.push({
            id: `${b.when === "today" ? "bday" : "bday-eve"}:${b.date}:${b.name}`,
            title: b.when === "today" ? `Anniversaire de ${who} aujourd'hui` : `Anniversaire de ${who} demain`,
            description: [age, b.when === "today" ? "Pense à lui souhaiter" : "Un message ou un petit cadeau ?"].filter(Boolean).join(" · "),
            time: b.when === "today" ? "aujourd'hui" : "demain",
            kind: "event",
            page: "roster",
          });
        }
      }
      // Équipe : « Gianni a terminé la tâche … » (désactivable dans Paramètres).
      if (prefs.bellTeamActivity !== false && !team.error) {
        for (const a of (team.data ?? []) as { id: string; actor_id: string | null; actor_name: string | null; verb: string; entity: string; label: string; detail: string | null; created_at: string }[]) {
          const t = activityText(a);
          const who = (a.actor_id && names.get(a.actor_id)) || a.actor_name || "L'équipe";
          out.push({ id: `team:${a.id}`, title: `${who} ${t.action}`, description: t.what, time: agoLabel(a.created_at), kind: "team", page: "activite" });
        }
      }
      const bellCreator = prefs.bellCreatorActivity !== false;
      if (bellCreator && !tdC.error) {
        ((tdC.data as { text: string; creator: string | null; created_at: string | null }[]) ?? []).forEach((t) =>
          out.push({
            // Texte coupé sans séparer un emoji (couper) : l'id effacé est écrit en base, et une
            // moitié d'emoji y serait refusée. Même clé dans l'outil notifications (ttp-mcp/tools.ts).
            id: `ctd:${t.created_at}:${couper(t.text, 40)}`,
            title: "Nouvelle tâche d'un créateur",
            page: "todo",
            description: `${t.creator ? titleCase(t.creator) : "Créateur"} · ${t.text}`,
            time: agoLabel(t.created_at),
            kind: "creator",
          }),
        );
      }
      if (bellCreator && !idC.error) {
        ((idC.data as { text: string; creator: string | null; created_at: string | null }[]) ?? []).forEach((i) =>
          out.push({
            id: `cid:${i.created_at}:${couper(i.text, 40)}`,
            title: "Nouvelle idée d'un créateur",
            page: "ideas",
            description: `${i.creator ? titleCase(i.creator) : "Créateur"} · ${i.text}`,
            time: agoLabel(i.created_at),
            kind: "creator",
          }),
        );
      }
      if (bellCreator && evC && !evC.error) {
        ((evC.data as { title: string | null; who: string | null; created_at: string | null }[]) ?? []).forEach((e) =>
          out.push({
            id: `cev:${e.created_at}:${couper(e.title ?? "", 40)}`,
            title: "Nouvel évènement d'un créateur",
            page: "planning",
            description: `${e.who ? titleCase(e.who) : "Créateur"} · ${e.title ?? ""}`,
            time: agoLabel(e.created_at),
            kind: "creator",
          }),
        );
      }
      if (bellCreator && !mailAvis.error) {
        const AVIS: Record<string, string> = { encours: "En cours", valide: "Validé", refuse: "Refusé" };
        ((mailAvis.data as { id: string; creator: string; status: string; comment: string | null; created_at: string }[]) ?? []).forEach((a) =>
          out.push({
            id: `cma:${a.id}`,
            title: "Avis sur un mail",
            page: "mails",
            description: `${titleCase(a.creator)} · ${AVIS[a.status] ?? a.status}${a.comment ? ` · « ${a.comment.slice(0, 80)} »` : ""}`,
            time: agoLabel(a.created_at),
            kind: "creator",
          }),
        );
      }
      if (bellCreator && !mailNotes.error) {
        ((mailNotes.data as { id: string; creator: string; body: string; created_at: string }[]) ?? []).forEach((n) =>
          out.push({
            id: `cmn:${n.id}`,
            title: "Message sur un mail",
            page: "mails",
            description: `${titleCase(n.creator)} · ${n.body.slice(0, 100)}`,
            time: agoLabel(n.created_at),
            kind: "creator",
          }),
        );
      }
      // Emails reçus sur la boîte agence (remplis par gmail-poll) — désactivable.
      const bellEmail = prefs.emailReceivedBell !== false;
      if (bellEmail && mailIn && !mailIn.error) {
        const rowsIn = (mailIn.data as { id: string; subject: string | null; contact_name: string | null; contact_email: string | null; created_at: string | null; gmail_message_id: string | null; thread_id: string | null; box?: string | null; read_at?: string | null }[]) ?? [];
        // Lus dans Gmail, Spark ou ici : leurs notifications se ferment aussi sur ce téléphone.
        void closeMailThreadNotifications(rowsIn.filter((e) => e.read_at && e.thread_id).map((e) => e.thread_id!));
        rowsIn.forEach((e) =>
          out.push({
            id: `mail:${e.gmail_message_id ?? e.created_at}`,
            title: "Nouvel email reçu",
            page: "mails",
            description: `${e.contact_name || e.contact_email || "Contact"} · ${e.subject || "(sans objet)"}`,
            time: agoLabel(e.created_at),
            kind: "email",
            read: !!e.read_at,
            mail: e.thread_id ? { activityId: e.id, threadId: e.thread_id, box: e.box ?? null } : undefined,
          }),
        );
      }
      ((inv.data as { id: string; party: string; amount: string; status: string; date: string | null }[]) ?? []).filter((i) => isOverdueInvoice(i)).forEach((i) =>
        out.push({
          id: `inv:${i.id}`,
          title: "Facture en retard",
          page: "relances",
          description: `${i.party} · ${i.amount}`,
          time: "à relancer",
          kind: "facture",
        }),
      );
      ((br.data as { id: string; brand: string; creator: string | null }[]) ?? []).forEach((b) =>
        out.push({
          id: `br:${b.id}`,
          title: "Brief à valider",
          page: "briefs",
          description: `${b.brand}${b.creator ? ` × ${titleCase(b.creator)}` : ""}`,
          time: "en attente",
          kind: "brief",
        }),
      );
      // Concept à valider : le créateur attend l'agence, qui valide dans la fiche collab (page
      // Collabs, bloc « Côté créateur »). Un nouveau concept refait une ligne (sa date dans l'id).
      if (conc.error) {
        if (!conceptColumnsMissing(conc.error)) console.warn("Concepts à valider non lus:", conc.error.message);
      } else {
        ((conc.data as { id: string; brand: string | null; creator: string | null; concept: string | null; concept_status: string | null; concept_at: string | null }[]) ?? [])
          .filter((b) => conceptState(b) === "propose")
          .forEach((b) =>
            out.push({
              id: `concept:${b.id}:${b.concept_at ?? ""}`,
              title: "Concept à valider",
              page: "collabs",
              description: `${b.brand?.trim() || EMPTY}${b.creator ? ` × ${titleCase(b.creator)}` : ""}`,
              time: b.concept_at ? agoLabel(b.concept_at) : "en attente",
              kind: "brief",
            }),
          );
      }
      ((ev.data as { id: string; date: string; time: string; title: string }[]) ?? []).forEach((e) =>
        out.push({
          id: `ev:${e.id}`,
          title: "Événement à venir",
          description: `${e.title}${e.time && e.time !== "—" ? ` · ${e.time}` : ""}`,
          time: fmtDay(e.date) || e.date,
          kind: "event",
        }),
      );
      // Contrats bientôt échus (≤ 60 jours) ou déjà expirés.
      (((app as Record<string, unknown>).contractDeadlines as Deadline[]) ?? []).forEach((d) => {
        const end = ctEnd(d.start, d.months);
        if (!end) return;
        const left = ctDaysLeft(end);
        if (left > 60) return;
        out.push({
          id: `ct:${d.creator}:${d.type}:${d.start}`,
          title: left < 0 ? "Contrat expiré" : "Contrat à renouveler",
          page: "echeances",
          description: `${titleCase(d.creator)} · ${d.type}`,
          time: left < 0 ? `expiré depuis ${-left} j` : `expire dans ${left} j`,
          kind: "contrat",
        });
      });
      // Ne réaffiche jamais ce qui a été effacé (persisté dans le blob).
      const dismissed = new Set(((app as Record<string, unknown>).notifDismissed as string[]) ?? []);
      setItems(out.filter((n) => !dismissed.has(n.id)));
    }).catch((e) => {
      if (!alive) return;
      console.error("Notifications — échec réseau:", e);
      setItems([]);
    });
    };
    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  /** Efface définitivement (persiste les ids dans le blob agence, tous appareils).
   *  Sérialisé : deux effacements rapprochés ne se court-circuitent pas (chacun
   *  relit le blob frais APRÈS le précédent, sinon le 1er réapparaîtrait). */
  const dismiss = (ids: string[]) => {
    if (!ids.length) return;
    setItems((prev) => prev.filter((n) => !ids.includes(n.id)));
    // Chaque étape attrape sa propre erreur : un échec réseau ne bloque pas la
    // file pour les effacements suivants (comme mutateBin dans trash.ts).
    dismissQueue = dismissQueue.then(async () => {
      let ok = false;
      try {
        invalidateAppState();
        const cur = (((await getAppState())["notifDismissed"] as string[]) ?? []);
        const merged = [...new Set([...cur, ...ids])].slice(-300); // borne la liste
        ok = await saveAppStateKey("notifDismissed", merged);
      } catch {
        /* relecture impossible (réseau) : signalé ci-dessous */
      }
      if (!ok) toast("Effacement non synchronisé, réessaie");
    });
  };

  return { items, dismiss };
}

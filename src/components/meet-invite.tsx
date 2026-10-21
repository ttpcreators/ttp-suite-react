import { useState } from "react";
import { CalendarDays, Video, X } from "@/components/icons";
import { Overlay } from "@/components/mobile/ios-sheet";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { parseEmails } from "@/lib/mailSend";
import { cn } from "@/lib/utils";

/**
 * « Rendez-vous » (zone de réponse d'un mail) : on choisit une date, l'app crée le
 * rendez-vous dans Google Agenda avec un lien Google Meet (fonction meet-invite),
 * Google envoie l'invitation aux invités, et le lien est ajouté à la réponse.
 */
export type MeetResult = { meetUrl: string; when: string; invited: number };

const field = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary";
const DURATIONS = [15, 30, 45, 60, 90];

const pad = (n: number) => String(n).padStart(2, "0");
/** Demain (ou lundi si on est vendredi / samedi), au format AAAA-MM-JJ. */
function nextWorkday(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** « mardi 28 octobre, 14 h 30 (30 min) » */
export function meetWhen(date: string, time: string, duration: number): string {
  const d = new Date(`${date}T12:00:00`);
  const day = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(d);
  const [h, m] = time.split(":");
  return `${day}, ${Number(h)} h${m === "00" ? "" : ` ${m}`} (${duration} min)`;
}
/** Texte ajouté à la réponse. */
export function meetReplyText(r: MeetResult): string {
  return [`Rendez-vous : ${r.when}`, r.meetUrl ? `Lien Google Meet : ${r.meetUrl}` : ""].filter(Boolean).join("\n");
}

const ERR: Record<string, string> = {
  titre_requis: "Donne un titre au rendez-vous.",
  date_invalide: "Date invalide.",
  heure_invalide: "Heure invalide.",
  duree_invalide: "Durée invalide.",
  invite_invalide: "Une adresse d'invité est invalide.",
  trop_d_invites: "30 invités au plus.",
  google_non_connecte: "Reconnecte Google Agenda (Planning) pour créer le rendez-vous.",
  agenda_droit_manquant: "Google Agenda refuse : reconnecte Google (Planning) en acceptant l'agenda.",
  unauthorized: "Session expirée, recharge la page.",
};

async function createMeet(body: Record<string, unknown>): Promise<{ ok: true; meetUrl: string; invited: number } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("meet-invite", { body });
    if (error) {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const j = ctx && typeof ctx.json === "function" ? ((await ctx.json().catch(() => null)) as { error?: string; code?: string } | null) : null;
      if (j?.code === "NOT_FOUND" || /not found/i.test(error.message)) return { ok: false, error: "absente" };
      return { ok: false, error: j?.error ?? "reseau" };
    }
    const d = (data ?? {}) as { ok?: boolean; meetUrl?: string; invited?: number; error?: string };
    return d.ok ? { ok: true, meetUrl: d.meetUrl ?? "", invited: d.invited ?? 0 } : { ok: false, error: d.error ?? "agenda_echec" };
  } catch {
    return { ok: false, error: "reseau" };
  }
}

export function MeetDialog({ guests, title, who, onClose, onDone }: { guests: string[]; title: string; who?: string | null; onClose: () => void; onDone: (r: MeetResult) => void }) {
  const [t, setT] = useState(title);
  const [date, setDate] = useState(nextWorkday);
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(30);
  const [to, setTo] = useState(guests.join(", "));
  const [meet, setMeet] = useState(true);
  const [invite, setInvite] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const g = parseEmails(to);
    if (g.bad.length) return toast(`Adresse invalide : ${g.bad[0]}`);
    if (!date || !time) return toast("Choisis une date et une heure");
    setBusy(true);
    const r = await createMeet({ title: t, date, time, duration, guests: g.ok, meet, invite, note, who: who ?? undefined });
    setBusy(false);
    if (!r.ok) {
      return toast(r.error === "absente" ? "Rendez-vous pas encore installé : la fonction meet-invite n'est pas encore déployée." : ERR[r.error] ?? (r.error === "reseau" ? "Pas de réponse du serveur, réessaie." : "Google Agenda a refusé le rendez-vous, réessaie."));
    }
    const when = meetWhen(date, time, duration);
    toast(r.invited ? `Invitation envoyée à ${r.invited} invité${r.invited > 1 ? "s" : ""} ✓` : "Rendez-vous ajouté à l'agenda ✓");
    onDone({ meetUrl: r.meetUrl, when, invited: r.invited });
    onClose();
  };

  const check = "flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground";
  return (
    <Overlay className="fixed inset-0 z-[130] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={onClose} label="Proposer un rendez-vous">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">Proposer un rendez-vous</span>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted-foreground">Titre</span>
            <input value={t} onChange={(e) => setT(e.target.value)} className={field} />
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-muted-foreground">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-muted-foreground">Heure</span>
              <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className={cn(field, "w-[110px]")} />
            </label>
          </div>
          <div className="space-y-1">
            <span className="text-[12px] font-medium text-muted-foreground">Durée</span>
            <div role="group" aria-label="Durée" className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={duration === d}
                  onClick={() => setDuration(d)}
                  className={cn("h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors", duration === d ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted-foreground">Invités</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="adresse@marque.com, autre@exemple.com" className={field} inputMode="email" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted-foreground">Note dans l'invitation (facultatif)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary" placeholder="Ordre du jour, numéro à appeler…" />
          </label>
          <div className="space-y-2 pt-1">
            <label className={check}>
              <input type="checkbox" checked={meet} onChange={(e) => setMeet(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
              <Video className="h-4 w-4 text-faint" /> Ajouter un lien Google Meet
            </label>
            <label className={check}>
              <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
              <CalendarDays className="h-4 w-4 text-faint" /> Envoyer l'invitation Google Agenda aux invités
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-rowhover hover:text-foreground">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !t.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <CalendarDays className="h-4 w-4" /> {busy ? "Création…" : invite && to.trim() ? "Envoyer l'invitation" : "Créer le rendez-vous"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Bouton du pied de la zone de réponse. */
export function MeetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Proposer un rendez-vous avec lien Google Meet" className="flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground">
      <Video className="h-3.5 w-3.5" /> Rendez-vous
    </button>
  );
}

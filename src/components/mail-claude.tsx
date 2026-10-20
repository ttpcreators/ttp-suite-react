import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";
import type { MailBox } from "@/lib/mailSend";

/**
 * « Rédiger avec Claude » dans la zone de réponse d'un mail, SANS clé API payante :
 * on passe par l'abonnement Claude et le connecteur TTP Suite.
 *   1. Le bouton ouvre Claude avec la demande déjà écrite (fil, boîte, consigne).
 *   2. Claude lit le fil (lire_mail), applique les consignes du Talent manager, puis
 *      dépose sa réponse avec l'outil « preparer_reponse_mail » (table mail_reply_drafts).
 *   3. De retour sur l'app, la réponse arrive toute seule dans la zone de réponse.
 * Rien n'est envoyé sans l'équipe.
 */
type Draft = { id: string; body: string; created_at: string };

const DAY = 86400000;

function buildPrompt(threadId: string, box: MailBox, subject: string, consigne: string, current: string): string {
  return [
    `Prépare la réponse au mail « ${subject || "sans objet"} » (boîte ${box}@, fil ${threadId}).`,
    `1. Lis le fil avec l'outil lire_mail (fil ${threadId}, boîte ${box}).`,
    "2. Lis tes consignes avec lire_agent (Talent manager) et applique-les.",
    `3. Rédige la réponse${consigne ? ` en suivant cette consigne : ${consigne}` : ""}. N'invente aucun prix, date ou engagement absent du fil : mets [à compléter] à la place. Pas de signature (l'app l'ajoute).`,
    current ? `Pars de ce brouillon déjà commencé : « ${current.slice(0, 800)} »` : "",
    `4. Dépose-la dans l'app avec preparer_reponse_mail (fil ${threadId}, boîte ${box}). N'envoie rien.`,
    "Puis résume-moi la réponse en une phrase.",
  ].filter(Boolean).join("\n");
}

/** Réponse de Claude en attente pour ce fil (la plus récente, pas encore utilisée, de moins de 24 h). */
async function pending(threadId: string, since: string): Promise<Draft | null> {
  const { data, error } = await supabase
    .from("mail_reply_drafts")
    .select("id, body, created_at")
    .eq("thread_id", threadId)
    .is("used_at", null)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null; // table pas encore installée : la fonction reste discrète
  return ((data as Draft[] | null) ?? [])[0] ?? null;
}

export function useClaudeReply(opts: { threadId: string; box: MailBox; subject: string } | undefined, current: string, apply: (text: string) => void) {
  const [ready, setReady] = useState<Draft | null>(null);
  const [waiting, setWaiting] = useState(false);
  const since = useRef(new Date(Date.now() - DAY).toISOString());
  const threadId = opts?.threadId ?? "";

  const check = useCallback(async () => {
    if (!threadId) return;
    const d = await pending(threadId, since.current);
    if (!d) return;
    setWaiting(false);
    setReady(d);
  }, [threadId]);

  // À l'ouverture du fil : une réponse déposée plus tôt (téléphone, autre poste) attend peut-être.
  useEffect(() => {
    setReady(null);
    setWaiting(false);
    void check();
  }, [check]);

  // En attente de Claude : on regarde au retour sur l'onglet, et toutes les 5 s (10 min max).
  useEffect(() => {
    if (!waiting) return;
    const onBack = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    const timer = window.setInterval(() => void check(), 5000);
    const stop = window.setTimeout(() => setWaiting(false), 10 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [waiting, check]);

  const markUsed = async (d: Draft) => {
    await supabase.from("mail_reply_drafts").update({ used_at: new Date().toISOString() }).eq("id", d.id).then(() => {}, () => {});
  };

  // Zone vide : la réponse se met directement en place ; sinon on demande avant de remplacer.
  useEffect(() => {
    if (!ready || current.trim()) return;
    apply(ready.body);
    void markUsed(ready);
    setReady(null);
    toast("Réponse de Claude insérée : relis-la avant d'envoyer");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const start = async (consigne: string) => {
    if (!opts) return;
    const prompt = buildPrompt(opts.threadId, opts.box, opts.subject, consigne.trim(), current.trim());
    since.current = new Date(Date.now() - 60 * 1000).toISOString();
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      /* presse-papiers indisponible : le lien suffit */
    }
    window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, "_blank", "noopener");
    setWaiting(true);
    toast("Claude s'ouvre avec la demande (aussi copiée : Cmd+V si besoin). La réponse arrivera ici.");
  };

  return {
    ready: ready && current.trim() ? ready : null,
    waiting,
    start,
    insert: () => {
      if (!ready) return;
      apply(ready.body);
      void markUsed(ready);
      setReady(null);
      toast("Réponse de Claude insérée : relis-la avant d'envoyer");
    },
    dismiss: () => {
      if (ready) void markUsed(ready);
      setReady(null);
    },
    cancelWait: () => setWaiting(false),
  };
}

/** Bouton de la barre du bas de la zone de réponse (ouvre la ligne de consigne). */
export function ClaudeReplyButton({ open, onToggle, waiting, onCancel }: { open: boolean; onToggle: () => void; waiting: boolean; onCancel: () => void }) {
  if (waiting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" /> En attente de Claude…
        <button type="button" onClick={onCancel} aria-label="Arrêter d'attendre" className="grid h-5 w-5 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className={`inline-flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${open ? "text-foreground" : "text-muted-foreground"}`}>
      <Sparkles className="h-3.5 w-3.5 text-primary" /> Rédiger avec Claude
    </button>
  );
}

/** Ligne de consigne, dans le cadre de réponse (au-dessus de la barre du bas). */
export function ClaudeConsigne({ onStart, onClose }: { onStart: (consigne: string) => void; onClose: () => void }) {
  const [consigne, setConsigne] = useState("");
  const go = () => { onStart(consigne); setConsigne(""); onClose(); };
  return (
    <div className="border-t border-border bg-primary/[0.04] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <input
          autoFocus
          value={consigne}
          onChange={(e) => setConsigne(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); go(); }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Consigne pour Claude (facultatif) : accepte pour le 14, décline poliment…"
          aria-label="Consigne pour Claude"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-foreground outline-none placeholder:text-faint focus:border-primary"
        />
        <button type="button" onClick={onClose} className="h-8 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:bg-rowhover">Annuler</button>
        <button type="button" onClick={go} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90">
          Ouvrir Claude
        </button>
      </div>
      <p className="mt-1.5 pl-5 text-[11px] leading-snug text-faint">Claude lit le fil, applique tes consignes du Talent manager et dépose sa réponse ici. Rien n'est envoyé.</p>
    </div>
  );
}

/** Bandeau « réponse prête » quand l'équipe avait déjà commencé à écrire. */
export function ClaudeReadyBanner({ onInsert, onDismiss }: { onInsert: () => void; onDismiss: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/[0.06] px-3.5 py-2 text-[12.5px]">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-foreground">La réponse de Claude est prête.</span>
      <button type="button" onClick={onInsert} className="h-7 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90">Remplacer mon texte</button>
      <button type="button" onClick={onDismiss} className="h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:bg-rowhover">Ignorer</button>
    </div>
  );
}

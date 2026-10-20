import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Sparkles, X } from "@/components/icons";
import { AgentAvatar } from "@/components/agent-avatar";
import { assignFigurines } from "@/lib/agentAvatars";
import { useAppState } from "@/lib/appState";
import { claudeUrl, contextPrompt, threadTranscript, type ContextMessage } from "@/lib/mailThreadContext";
import { cn } from "@/lib/utils";
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

/** Fil affiché dans le lecteur : son texte complet part avec la demande (un seul geste). */
export type ClaudeThread = { threadId: string; box: MailBox; subject: string; messages?: readonly ContextMessage[] };

export function useClaudeReply(opts: ClaudeThread | undefined, current: string, apply: (text: string) => void) {
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

  /**
   * Demande complète : avec le fil sous les yeux (texte de tous les messages), on l'envoie
   * en entier, sinon Claude va le lire lui-même avec le connecteur (ancienne demande).
   */
  const promptFor = (consigne: string, agent?: string | null) => {
    if (!opts) return "";
    if (opts.messages?.length) {
      const transcript = threadTranscript(opts.subject, opts.box, opts.messages);
      return contextPrompt({ transcript, threadId: opts.threadId, box: opts.box, agent, consigne, draft: current });
    }
    return buildPrompt(opts.threadId, opts.box, opts.subject, consigne.trim(), current.trim());
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  /** « Copier le fil » : la demande et tout l'échange, à coller où l'on veut (Claude, ChatGPT…). */
  const copy = async (consigne: string, agent?: string | null) => {
    if (!opts) return;
    toast((await copyText(promptFor(consigne, agent))) ? "Fil complet copié avec la demande : colle-le dans Claude (Cmd+V)" : "Copie impossible sur cet appareil");
  };

  /** « Demander à Claude / à un agent » : ouvre Claude avec tout le contexte. */
  const start = async (consigne: string, agent?: string | null) => {
    if (!opts) return;
    const prompt = promptFor(consigne, agent);
    since.current = new Date(Date.now() - 60 * 1000).toISOString();
    const copied = await copyText(prompt);
    const { url, full } = claudeUrl(prompt);
    window.open(url, "_blank", "noopener");
    setWaiting(true);
    toast(
      full
        ? `${agent ?? "Claude"} s'ouvre avec tout l'échange${copied ? " (aussi copié)" : ""}. La réponse arrivera ici.`
        : copied
          ? "Échange long : il est copié, colle-le dans Claude (Cmd+V). La réponse arrivera ici."
          : "Échange trop long pour le lien et copie impossible : utilise « Copier le fil » sur un autre appareil.",
    );
  };

  return {
    ready: ready && current.trim() ? ready : null,
    waiting,
    start,
    copy,
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

type AgentLite = { id: string; nom: string; actif: boolean };

/** Agents de l'app (fondateurs : la liste est protégée, sinon on reste sur « Claude » seul). */
function useAgents(): AgentLite[] {
  const [agents, setAgents] = useState<AgentLite[]>([]);
  useEffect(() => {
    let alive = true;
    void supabase.schema("agent").from("agents").select("id, nom, actif, sort_order").order("sort_order").then(({ data, error }) => {
      if (alive && !error) setAgents((data as AgentLite[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);
  return agents;
}

/**
 * Panneau « Rédiger avec Claude », dans le cadre de réponse : à qui demander (Claude
 * seul ou un agent de TTP), une consigne facultative, puis un seul geste. Tout l'échange
 * part avec la demande : « Copier le fil » pour le coller où l'on veut, ou « Demander ».
 */
export function ClaudeConsigne({ onStart, onCopy, onClose, withThread }: {
  onStart: (consigne: string, agent?: string | null) => void;
  onCopy?: (consigne: string, agent?: string | null) => void;
  onClose: () => void;
  /** Le texte du fil est disponible (il part avec la demande). */
  withThread?: boolean;
}) {
  const [consigne, setConsigne] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const agents = useAgents();
  const { data: chosen } = useAppState<Record<string, string>>((st) => (st["agentAvatars"] as Record<string, string>) ?? {});
  const figs = assignFigurines(agents, chosen);
  const agent = agents.find((a) => a.id === agentId) ?? null;
  const who = agent ? agent.nom : "Claude";
  const go = () => { onStart(consigne, agent?.nom ?? null); setConsigne(""); onClose(); };
  const chip = (on: boolean) =>
    cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-[12.5px] font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "bg-field text-foreground hover:bg-rowhover");
  return (
    <div className="flex flex-col gap-2.5 border-t border-border bg-primary/[0.04] px-3.5 py-3">
      {/* À qui demander */}
      <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" role="radiogroup" aria-label="Qui rédige la réponse">
        <button type="button" role="radio" aria-checked={!agent} onClick={() => setAgentId("")} className={chip(!agent)}>
          <span className={cn("grid h-6 w-6 place-items-center rounded-full", !agent ? "bg-primary-foreground/20" : "bg-surface")}><Sparkles className="h-3.5 w-3.5" /></span>
          Claude
        </button>
        {agents.filter((a) => a.actif).map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={agentId === a.id} onClick={() => setAgentId(a.id)} className={chip(agentId === a.id)}>
            <AgentAvatar figurine={figs[a.id]} className="h-6 w-6 rounded-full" />
            {a.nom}
          </button>
        ))}
      </div>
      <input
        autoFocus
        value={consigne}
        onChange={(e) => setConsigne(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); go(); }
          if (e.key === "Escape") onClose();
        }}
        placeholder="Consigne (facultatif) : accepte pour le 14, décline poliment, demande le budget…"
        aria-label="Consigne pour la réponse"
        className="h-9 min-w-0 rounded-[10px] border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
      />
      <p className="text-[11.5px] leading-snug text-faint">
        {withThread ? "Tout l'échange part avec la demande." : "Claude lit le fil avec le connecteur."} La réponse revient ici, rien n'est envoyé.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="h-8 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:bg-rowhover">Annuler</button>
        {onCopy && (
          <button type="button" onClick={() => { onCopy(consigne, agent?.nom ?? null); }} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-field px-3.5 text-[12px] font-semibold text-foreground hover:bg-rowhover">
            <Copy className="h-3.5 w-3.5" /> Copier le fil
          </button>
        )}
        <button type="button" onClick={go} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90">
          Demander à {who}
        </button>
      </div>
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

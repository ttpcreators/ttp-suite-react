import { useEffect, useState } from "react";
import { Check, Copy, Plus, Trash2, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

/**
 * Fiche d'un agent de TTP (section Agents) : identité, consignes, routines et
 * « kit de démarrage » à coller dans Claude (instructions de projet + tâches planifiées).
 * L'agent relit ses consignes dans l'app à chaque conversation (outil lire_agent du
 * connecteur) : les modifier ici suffit.
 */
export type Routine = { nom: string; quand: string; consigne: string };
export type AgentRow = {
  id: string; slug: string; nom: string; emoji: string; role: string | null; moteur: "claude" | "externe";
  consignes: string; routines: Routine[]; actif: boolean; sort_order: number; maj_le?: string;
};
export type AgentDraft = Omit<AgentRow, "id" | "slug" | "sort_order"> & { id?: string };

const FIELD = "w-full rounded-[10px] border border-input bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground";

/** Instructions à coller dans un projet Claude pour jouer cet agent. */
export function projectInstructions(a: { nom: string; role: string | null }): string {
  return [
    `Tu es « ${a.nom} », agent de l'agence TTP Creators${a.role ? ` (${a.role.replace(/\.$/, "")})` : ""}.`,
    `Au début de CHAQUE conversation, appelle l'outil « lire_agent » du connecteur TTP Suite avec « ${a.nom} » pour lire tes consignes à jour et les leçons apprises, puis applique-les.`,
    `Tu ne fais jamais rien partir toi-même : les mails vont en brouillon (creer_brouillon_mail), les messages WhatsApp, Instagram et LinkedIn dans la file « À valider » (proposer_action). Quand Marc te corrige, enregistre la leçon (noter_lecon).`,
    `Réponds en français, court et actionnable.`,
  ].join("\n");
}
/** Texte d'une tâche planifiée Claude pour une routine. */
export function routinePrompt(a: { nom: string }, r: Routine): string {
  return `Tu es « ${a.nom} », agent de TTP Creators. Commence par lire tes consignes avec l'outil « lire_agent » (connecteur TTP Suite), puis fais ta routine « ${r.nom} » : ${r.consigne}`;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copié ✓`);
  } catch {
    toast("Copie impossible, sélectionne le texte à la main");
  }
}

export function AgentEditor({ agent, onSave, onDelete, onClose }: {
  agent: AgentDraft;
  onSave: (a: AgentDraft) => Promise<boolean>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<AgentDraft>(agent);
  const [busy, setBusy] = useState(false);
  const [armDel, setArmDel] = useState(false);
  useEffect(() => setD(agent), [agent]);
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setRoutine = (i: number, patch: Partial<Routine>) => set("routines", d.routines.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!d.nom.trim()) return toast("Donne un nom à l'agent");
    setBusy(true);
    const ok = await onSave({ ...d, nom: d.nom.trim(), emoji: d.emoji.trim() || "🤖", routines: d.routines.filter((r) => r.nom.trim() || r.consigne.trim()) });
    setBusy(false);
    if (ok) toast("Agent enregistré ✓");
  };

  return (
    <div className="flex flex-col gap-4 rounded-[20px] bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <input value={d.emoji} onChange={(e) => set("emoji", e.target.value.slice(0, 4))} aria-label="Emoji"
          className="h-12 w-12 shrink-0 rounded-[14px] border border-input bg-surface text-center text-[22px] outline-none focus:border-foreground" />
        <div className="min-w-0 flex-1">
          <input value={d.nom} onChange={(e) => set("nom", e.target.value)} placeholder="Nom de l'agent (ex. Léa, talent manager)"
            className="w-full bg-transparent text-[20px] font-semibold tracking-tight text-foreground outline-none placeholder:text-faint" />
          <input value={d.role ?? ""} onChange={(e) => set("role", e.target.value)} placeholder="Son rôle en une phrase"
            className="mt-0.5 w-full bg-transparent text-[13px] text-muted-foreground outline-none placeholder:text-faint" />
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["claude", "externe"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={d.moteur === m} onClick={() => set("moteur", m)}
            className={cn("h-8 rounded-full border px-3 text-[12px] font-medium transition-colors", d.moteur === m ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-rowhover")}>
            {m === "claude" ? "Joué par Claude" : "Programme externe"}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-pressed={d.actif} onClick={() => set("actif", !d.actif)}
          className={cn("h-8 rounded-full px-3 text-[12px] font-semibold transition-colors", d.actif ? "bg-signal/12 text-signaltext" : "bg-muted text-muted-foreground")}>
          {d.actif ? "● En service" : "○ En pause"}
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-foreground">Consignes</span>
        <span className="text-[11px] text-faint">Son manuel : rôle, ton, règles, ce qu'il ne doit jamais faire. Il le relit à chaque conversation.</span>
        <textarea value={d.consignes} onChange={(e) => set("consignes", e.target.value)} rows={14}
          placeholder={"# Rôle\n…\n\n# Ton\n…\n\n# Règles\n1. …"} className={cn(FIELD, "min-h-[260px] resize-y font-mono text-[12.5px] leading-relaxed")} />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-foreground">Routines</span>
          <span className="text-[11px] text-faint">Ce qu'il fait tout seul, à heure fixe (tâches planifiées de Claude).</span>
        </div>
        {d.routines.map((r, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-[14px] bg-muted/50 p-3">
            <div className="flex flex-wrap gap-2">
              <input value={r.nom} onChange={(e) => setRoutine(i, { nom: e.target.value })} placeholder="Nom (ex. Le point du matin)" className={cn(FIELD, "min-w-[160px] flex-1")} />
              <input value={r.quand} onChange={(e) => setRoutine(i, { quand: e.target.value })} placeholder="Quand (ex. Chaque jour à 8 h)" className={cn(FIELD, "min-w-[160px] flex-1")} />
              <button type="button" onClick={() => set("routines", d.routines.filter((_, j) => j !== i))} aria-label="Retirer la routine"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-dangertext"><Trash2 className="h-4 w-4" /></button>
            </div>
            <textarea value={r.consigne} onChange={(e) => setRoutine(i, { consigne: e.target.value })} rows={3} placeholder="Ce qu'il doit faire" className={cn(FIELD, "resize-y")} />
            {d.moteur === "claude" && d.nom.trim() && (
              <button type="button" onClick={() => void copy(routinePrompt(d, r), "Texte de la tâche planifiée")}
                className="flex h-8 items-center gap-1.5 self-start rounded-full border border-border px-3 text-[11.5px] font-medium text-muted-foreground hover:bg-rowhover hover:text-foreground">
                <Copy className="h-3.5 w-3.5" /> Copier pour une tâche planifiée Claude
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => set("routines", [...d.routines, { nom: "", quand: "", consigne: "" }])}
          className="flex h-9 items-center gap-1.5 self-start rounded-full border border-dashed border-border px-3 text-[12px] font-medium text-muted-foreground hover:bg-rowhover hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> Ajouter une routine
        </button>
      </div>

      {d.moteur === "claude" && d.nom.trim() && (
        <div className="rounded-[14px] border border-border p-3">
          <div className="text-[12px] font-semibold text-foreground">Kit de démarrage dans Claude</div>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
            <li>Sur claude.ai : Projets, puis « Nouveau projet » nommé « {d.nom} ».</li>
            <li>Dans « Instructions du projet », colle le texte ci-dessous (bouton Copier).</li>
            <li>Dans une conversation du projet, active le connecteur TTP Suite.</li>
            <li>Pour chaque routine : Tâches planifiées, nouvelle tâche, colle son texte et choisis l'heure.</li>
          </ol>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[10px] bg-muted px-3 py-2 text-[11.5px] leading-relaxed text-foreground">{projectInstructions(d)}</pre>
          <button type="button" onClick={() => void copy(projectInstructions(d), "Instructions du projet")}
            className="mt-2 flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[11.5px] font-medium text-muted-foreground hover:bg-rowhover hover:text-foreground">
            <Copy className="h-3.5 w-3.5" /> Copier les instructions du projet
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {onDelete && (armDel ? (
          <button type="button" onClick={() => void onDelete()} className="h-9 rounded-full bg-danger/10 px-3 text-[12px] font-semibold text-dangertext">Supprimer l'agent ?</button>
        ) : (
          <button type="button" onClick={() => setArmDel(true)} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-faint hover:bg-rowhover hover:text-dangertext">
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="h-9 rounded-full border border-border px-4 text-[12px] font-semibold text-muted-foreground hover:bg-rowhover">Fermer</button>
        <button type="button" onClick={() => void save()} disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          <Check className="h-3.5 w-3.5" /> Enregistrer
        </button>
      </div>
    </div>
  );
}

/**
 * Photos de profil des agents IA : les figurines matière choisies par Marc (2026-10-21),
 * dans public/agents/. Chaque agent garde la sienne ; un agent créé plus tard reçoit la
 * première figurine encore libre (puis on recommence la série quand toutes sont prises).
 * Un choix fait dans la fiche de l'agent (blob partagé `agentAvatars` : id → figurine)
 * passe avant l'attribution automatique.
 */
export const AGENT_FIGURINES = ["circuit", "neon", "cuir", "jardin", "terrazzo", "perles", "pointes"] as const;
export type AgentFigurine = (typeof AGENT_FIGURINES)[number];

export const FIGURINE_LABEL: Record<AgentFigurine, string> = {
  circuit: "Circuit",
  neon: "Néon",
  cuir: "Cuir",
  jardin: "Jardin",
  terrazzo: "Terrazzo",
  perles: "Perles",
  pointes: "Pointes",
};

export const figurineSrc = (f: AgentFigurine) => `${import.meta.env?.BASE_URL ?? "/"}agents/${f}.webp`;

const isFigurine = (v: unknown): v is AgentFigurine => typeof v === "string" && (AGENT_FIGURINES as readonly string[]).includes(v);

/**
 * Figurine de chaque agent. `agents` dans l'ordre du menu (sort_order) ; `chosen` =
 * choix enregistrés. Pure et stable : même liste → mêmes figurines.
 */
export function assignFigurines(agents: readonly { id: string }[], chosen: Record<string, unknown> | null | undefined): Record<string, AgentFigurine> {
  const out: Record<string, AgentFigurine> = {};
  const used = new Set<AgentFigurine>();
  for (const a of agents) {
    const c = chosen?.[a.id];
    if (isFigurine(c)) {
      out[a.id] = c;
      used.add(c);
    }
  }
  let cycle = 0;
  for (const a of agents) {
    if (out[a.id]) continue;
    let f = AGENT_FIGURINES.find((x) => !used.has(x));
    if (!f) {
      f = AGENT_FIGURINES[cycle % AGENT_FIGURINES.length];
      cycle++;
    }
    out[a.id] = f;
    used.add(f);
  }
  return out;
}

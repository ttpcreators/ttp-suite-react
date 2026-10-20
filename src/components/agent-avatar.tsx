import { figurineSrc, type AgentFigurine } from "@/lib/agentAvatars";
import { cn } from "@/lib/utils";

/** Photo de profil d'un agent IA : sa figurine, sur fond noir (comme les visuels d'origine). */
export function AgentAvatar({ figurine, name, className }: { figurine: AgentFigurine; name?: string; className?: string }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden rounded-[12px] bg-black", className)}>
      <img src={figurineSrc(figurine)} alt={name ? `Photo de ${name}` : ""} draggable={false} loading="lazy" className="h-full w-full object-cover" />
    </span>
  );
}

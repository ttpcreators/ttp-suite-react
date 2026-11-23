import { useEffect, useState } from "react";
import { BarChart3, Check, ExternalLink, Eye, Sparkles } from "@/components/icons";
import { StatusPill } from "@/components/ui/status-pill";
import { HelpTip } from "@/components/ui/help-tip";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { fmtDay } from "@/lib/dates";
import { fmtCompact } from "@/lib/timeSeries";
import { useLiveKey } from "@/lib/useLive";
import { notifyCreator } from "@/lib/push";
import { openLater } from "@/lib/openLater";
import { briefForCollab, conceptState, type BriefConcept } from "@/lib/briefConcept";
import { loadBriefConcepts, reachConceptStep, validateConcept } from "@/lib/briefConceptDb";
import { hasStats, platformLabel, POST_METRICS, type CollabPost } from "@/lib/collabPosts";
import { loadCollabPosts } from "@/lib/collabPostsDb";

/*
 * Fiche collab (agence) : ce que le créateur a fait depuis son espace.
 *   • brief lu (« J'ai lu ») et concept proposé, avec « Valider » : la collab passe alors
 *     à l'étape 3 « Concept validé » (`onConceptValidated`) ;
 *   • liens de ses posts publiés et ses stats à 7 jours (table collab_posts).
 * Avant le SQL 2026-11-23-espace-createur-collab.sql : rien ne s'affiche.
 */

type Collab = { id: string; brand: string; creator: string | null };
type BriefLite = { id: string; brand: string | null; creator: string | null; collab_id?: string | null; created_at?: string | null };

/** `onStepReached` : la collab vient de passer à l'étape 3 en base (à refléter à l'écran). */
export function CollabCreatorPanel({ collab, onStepReached }: { collab: Collab; onStepReached: (step: number) => void }) {
  const live = useLiveKey();
  const [concept, setConcept] = useState<BriefConcept | null | undefined>(undefined); // undefined = colonnes absentes
  const [posts, setPosts] = useState<CollabPost[] | null>(null); // null = table absente
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await loadCollabPosts({ collabId: collab.id });
      if (alive && !p.error) setPosts(p.missing ? null : p.posts);
      if (!collab.creator) return alive ? setConcept(undefined) : undefined;
      const [col, br] = await Promise.all([
        supabase.from("collabs").select("brief_id").eq("id", collab.id).maybeSingle<{ brief_id: string | null }>(),
        supabase.from("briefs").select("*").eq("creator", collab.creator),
      ]);
      if (!alive || br.error) return;
      const brief = briefForCollab({ ...collab, brief_id: col.data?.brief_id ?? null }, (br.data as BriefLite[] | null) ?? []);
      if (!brief) return setConcept(null);
      const c = await loadBriefConcepts({ ids: [brief.id] });
      if (!alive || c.error) return;
      setConcept(c.missing ? undefined : c.rows[0] ?? null);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab.id, collab.creator, collab.brand, live]);

  if (concept === undefined && posts === null) return null;
  const cs = conceptState(concept);

  const validate = async () => {
    if (!concept) return;
    setBusy(true);
    const r = await validateConcept(concept.id);
    setBusy(false);
    if (!r) return toast("Erreur, réessaie");
    setConcept(r);
    if (collab.creator) notifyCreator("brief-update", collab.creator, `Concept validé · ${collab.brand}`, concept.id);
    // Étape 3 posée en base sous condition (jamais de recul), puis reflétée à l'écran.
    if (await reachConceptStep(collab.id)) {
      onStepReached(3);
      toast("Concept validé ✓ Étape 3 · Concept validé");
    } else toast("Concept validé ✓");
  };

  const openCapture = (path: string) =>
    void openLater(async () => {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
      return error || !data?.signedUrl ? null : data.signedUrl;
    });

  return (
    <div className="rounded-[20px] bg-panel p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-[17px] font-semibold text-foreground">Côté créateur</h3>
        <HelpTip title="Côté créateur">
          Ce que le créateur a fait depuis son espace : brief lu, concept proposé, liens de ses posts et stats à 7 jours. Valider le concept fait passer la collab à l'étape « Concept validé ».
        </HelpTip>
      </div>

      {concept !== undefined && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 rounded-[12px] bg-surface px-3 py-2">
            <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-[13px] text-muted-foreground">Brief</span>
            <span className="ml-auto text-[13px] font-medium text-foreground">
              {!concept ? "Aucun" : concept.read_at ? `Lu le ${fmtDay(concept.read_at)}` : "Pas encore lu"}
            </span>
          </div>
          {concept && cs !== "aucun" && (
            <div className="rounded-[12px] bg-surface px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-[13px] text-muted-foreground">Concept{concept.concept_at ? ` du ${fmtDay(concept.concept_at)}` : ""}</span>
                <StatusPill tone={cs === "valide" ? "ok" : "wait"} size="xs" className="ml-auto">{cs === "valide" ? "Validé" : "À valider"}</StatusPill>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{concept.concept}</p>
              {concept.concept_link && (
                <a href={concept.concept_link} target="_blank" rel="noreferrer" className="mt-1.5 flex w-fit max-w-full items-center gap-1.5 text-[13px] font-semibold text-primary hover:opacity-80">
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{concept.concept_link}</span>
                </a>
              )}
              {cs === "propose" && (
                <button
                  type="button"
                  onClick={() => void validate()}
                  disabled={busy}
                  className="mt-2.5 flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" /> Valider
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {posts !== null && (
        <div className={concept !== undefined ? "mt-2 flex flex-col gap-2" : "flex flex-col gap-2"}>
          {posts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-[12px] bg-surface px-3 py-2">
              <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-[13px] text-muted-foreground">Post publié</span>
              <span className="ml-auto text-[13px] font-medium text-foreground">Aucun</span>
            </div>
          ) : (
            posts.map((p) => (
              <div key={p.id} className="rounded-[12px] bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={p.platform ?? ""} className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[13px] font-semibold text-primary hover:opacity-80">
                    {platformLabel(p.platform)} du {fmtDay(p.created_at)}
                  </a>
                  <StatusPill tone={hasStats(p) ? "ok" : "wait"} size="xs" className="ml-auto">{hasStats(p) ? "Stats reçues" : "Stats attendues"}</StatusPill>
                </div>
                {hasStats(p) && (
                  <div className="mt-1.5 text-[13px] text-muted-foreground">
                    {POST_METRICS.filter(({ key }) => typeof p[key] === "number").map(({ key, label }) => `${fmtCompact(p[key] as number)} ${label.toLowerCase()}`).join(" · ")}
                  </div>
                )}
                {p.capture_path && (
                  <button type="button" onClick={() => openCapture(p.capture_path as string)} className="mt-1.5 text-[13px] font-semibold text-primary hover:opacity-80">
                    Voir la capture
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

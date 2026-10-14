import { useState } from "react";
import { Hash, Heart, MessageCircle, ExternalLink, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Tabs } from "@/components/ui/animated-tabs";
import { fmtCompact } from "@/lib/timeSeries";
import { fmtAgo, igWhyText, noteQuota, postKind, type IgPostLite } from "@/lib/instagram";

/**
 * Scouting : posts Instagram d'un hashtag (fonction ig-hashtag, outil officiel de
 * Meta). Meta ne donne pas l'auteur d'un post : on l'ouvre pour voir le compte.
 * Demande la validation de l'app par Meta ; avant, la raison s'affiche.
 * Limite Meta : 30 hashtags différents par semaine.
 */
export function HashtagSearch({ onClose }: { onClose: () => void }) {
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<"top" | "recent">("top");
  const [busy, setBusy] = useState(false);
  const [posts, setPosts] = useState<IgPostLite[] | null>(null);
  const [why, setWhy] = useState("");

  const run = async (k = kind) => {
    const q = tag.trim().replace(/^#/, "");
    if (!q) return;
    setBusy(true);
    setWhy("");
    const { data, error } = await supabase.functions.invoke("ig-hashtag", { body: { tag: q, kind: k } });
    setBusy(false);
    noteQuota(data);
    const res = data as { posts?: IgPostLite[]; why?: string } | null;
    if (error || !res) {
      setPosts(null);
      setWhy("reseau");
      return;
    }
    setPosts(res.posts ?? null);
    setWhy(res.why ?? "");
  };

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Hash className="h-4 w-4 text-muted-foreground" /> Chercher par hashtag
        </div>
        <button type="button" onClick={onClose} className="text-faint transition-colors hover:text-foreground" title="Fermer">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary">
          <Hash className="h-3.5 w-3.5 shrink-0 text-faint" />
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ex : modeparis, ugcfrance" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
        </div>
        <Tabs
          size="sm"
          label="Quels posts"
          value={kind}
          onValueChange={(v) => {
            setKind(v as "top" | "recent");
            if (posts) void run(v as "top" | "recent");
          }}
          items={[
            { value: "top", label: "Les meilleurs" },
            { value: "recent", label: "Dernières 24 h" },
          ]}
        />
        <button type="submit" disabled={busy || !tag.trim()} className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Chercher
        </button>
      </form>
      <p className="mt-2 text-[11px] text-faint">Meta ne dit pas qui a publié : ouvre un post pour voir le compte, puis ajoute-le au scouting. 30 hashtags différents par semaine au maximum.</p>

      {why && <div className="mt-3 rounded-lg bg-panel px-3 py-2.5 text-[12px] text-muted-foreground">{igWhyText(why)}</div>}
      {posts && posts.length === 0 && !why && <div className="mt-3 text-[12px] text-faint">Aucun post pour ce hashtag.</div>}
      {posts && posts.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {posts.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group flex flex-col gap-1.5 rounded-xl border border-border bg-panel/40 px-3 py-2.5 transition-colors hover:bg-rowhover">
              <div className="flex items-center gap-2 text-[11px] text-faint">
                <span className="rounded-full bg-surface px-2 py-0.5 font-medium text-muted-foreground">{postKind(p)}</span>
                <span>{fmtAgo(p.at)}</span>
                <span className="ml-auto flex items-center gap-2 font-semibold tabular-nums text-foreground">
                  {p.likes != null && <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmtCompact(p.likes)}</span>}
                  <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{fmtCompact(p.comments)}</span>
                </span>
              </div>
              <div className="line-clamp-2 text-[12px] text-foreground">{p.caption || "Sans légende"}</div>
              <div className="flex items-center gap-1 text-[11px] font-medium text-primary">Ouvrir le post <ExternalLink className="h-3 w-3" /></div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

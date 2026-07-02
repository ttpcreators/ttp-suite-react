import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type SearchHit = {
  kind: "creator" | "contact" | "todo" | "invoice" | "brief" | "prospect";
  label: string;
  sub?: string;
  value: string;
};

/**
 * Recherche globale (agence) sur les principales entités. Débounce léger +
 * `ilike` sur les champs clés. La RLS garantit que seule l'agence voit tout.
 */
export function useGlobalSearch(query: string): { hits: SearchHit[]; loading: boolean } {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = query.trim();
    if (s.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setHits([]);
    const t = setTimeout(async () => {
      const safe = s.replace(/[,()%*]/g, " ").trim();
      if (!safe) {
        if (alive) {
          setHits([]);
          setLoading(false);
        }
        return;
      }
      const like = `%${safe}%`;
      const [cr, co, td, inv, br, pr] = await Promise.all([
        supabase.from("creators").select("name,handle,niche").or(`name.ilike.${like},handle.ilike.${like},niche.ilike.${like}`).limit(6),
        supabase.from("contacts").select("brand,person,email").or(`brand.ilike.${like},person.ilike.${like},email.ilike.${like}`).limit(6),
        supabase.from("todos").select("text,creator").ilike("text", like).limit(6),
        supabase.from("invoices").select("party,ref").or(`party.ilike.${like},ref.ilike.${like}`).limit(6),
        supabase.from("briefs").select("brand,creator").ilike("brand", like).limit(5),
        supabase.from("prospects").select("brand,contact").or(`brand.ilike.${like},contact.ilike.${like}`).limit(5),
      ]);
      if (!alive) return;
      const out: SearchHit[] = [];
      ((cr.data as { name: string; handle: string | null; niche: string | null }[] | null) ?? []).forEach((r) =>
        out.push({ kind: "creator", label: r.name, sub: [r.handle, r.niche].filter(Boolean).join(" · "), value: r.name }),
      );
      ((co.data as { brand: string; person: string | null; email: string | null }[] | null) ?? []).forEach((r) =>
        out.push({ kind: "contact", label: r.person || r.brand, sub: [r.brand, r.email].filter(Boolean).join(" · "), value: r.brand }),
      );
      ((td.data as { text: string; creator: string | null }[] | null) ?? []).forEach((r) =>
        out.push({ kind: "todo", label: r.text, sub: r.creator || "Agence", value: r.text }),
      );
      ((inv.data as { party: string | null; ref: string | null }[] | null) ?? []).forEach((r) =>
        out.push({ kind: "invoice", label: r.party || "—", sub: r.ref ? `#${r.ref}` : undefined, value: r.ref ?? r.party ?? "" }),
      );
      ((br.data as { brand: string; creator: string | null }[] | null) ?? []).forEach((r) =>
        out.push({ kind: "brief", label: r.brand, sub: r.creator || "", value: r.brand }),
      );
      ((pr.data as { brand: string; contact: string | null }[] | null) ?? []).forEach((r) =>
        out.push({ kind: "prospect", label: r.brand, sub: r.contact || "", value: r.brand }),
      );
      setHits(out);
      setLoading(false);
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  return { hits, loading };
}

import { useEffect, useState } from "react";
import { Check, ExternalLink, Search, UserPlus, X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { Overlay } from "@/components/mobile/ios-sheet";
import { toast } from "@/components/ui/toast";
import { dbInsert } from "@/lib/db";
import { feCredits, feEnrich, feSearch, type FePerson } from "@/lib/fullenrich";
import { cn } from "@/lib/utils";

/**
 * « Trouver des contacts » (page Contacts, FullEnrich) : les bonnes personnes d'une marque
 * (influence, partenariats, marketing…), puis « Ajouter » : l'email pro est cherché et la
 * fiche contact créée. Coûts affichés : 0,25 crédit par personne trouvée, 1 crédit par
 * email trouvé (rien si rien n'est trouvé).
 */
export function FindContactsDialog({ initialCompany = "", knownEmails, onClose, onAdded }: {
  initialCompany?: string;
  /** Emails déjà dans les contacts (pour signaler les doublons). */
  knownEmails: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [company, setCompany] = useState(initialCompany);
  const [titles, setTitles] = useState("influence, partenariat, partnership, marketing, communication, brand manager, relations presse");
  const [france, setFrance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ people: FePerson[]; total: number } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({}); // id → email trouvé ("" si aucun)
  useEffect(() => {
    void feCredits().then(setBalance).catch(() => setBalance(null));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const search = async (offset = 0) => {
    if (!company.trim() || busy) return;
    setBusy(true);
    try {
      const r = await feSearch(company.trim(), { titles: titles.split(",").map((t) => t.trim()).filter(Boolean), country: france ? "France" : undefined, limit: 10, offset });
      setRes((cur) => (offset && cur ? { people: [...cur.people, ...r.people], total: r.total } : { people: r.people, total: r.total }));
      void feCredits().then(setBalance).catch(() => {});
      if (!r.people.length) toast("Personne trouvée : essaie le site de la marque (ex. sephora.fr) ou d'autres postes");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async (p: FePerson) => {
    setAdding(p.id);
    try {
      let email = "";
      try {
        email = (await feEnrich({ linkedin: p.linkedin, first: p.first, last: p.last, company: p.company, domain: p.domain })).email;
      } catch (e) {
        toast((e as Error).message);
      }
      if (email && knownEmails.has(email)) {
        setAdded((a) => ({ ...a, [p.id]: email }));
        return toast(`${p.name} est déjà dans tes contacts (${email})`);
      }
      const created = await dbInsert("contacts", {
        brand: p.company || company.trim(), person: p.name, first_name: p.first || null, last_name: p.last || null,
        role: p.title || null, email: email || null, city: p.location.split(",")[0]?.trim() || null, tag: "Marque", tone: "cyan",
      });
      if (!created) return toast("Contact non créé, réessaie");
      setAdded((a) => ({ ...a, [p.id]: email }));
      toast(email ? `${p.name} ajouté avec son email ✓` : `${p.name} ajouté (email introuvable)`);
      onAdded();
      void feCredits().then(setBalance).catch(() => {});
    } finally {
      setAdding(null);
    }
  };

  const field = "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-primary max-md:text-[16px]";
  return (
    <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={onClose} label="Trouver des contacts">
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-foreground">Trouver des contacts</div>
            <div className="text-[12px] text-muted-foreground">Les bonnes personnes d'une marque, avec leur email pro (FullEnrich){balance != null ? ` · ${balance.toLocaleString("fr-FR")} crédits restants` : ""}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void search(0); }} className="grid gap-2.5 border-b border-border px-5 py-3.5">
          <div className="flex gap-2">
            <input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Marque ou site (ex. sephora.fr)" className={field} aria-label="Marque ou site" />
            <button type="submit" disabled={!company.trim() || busy} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
              {busy ? <Spin size={14} /> : <Search className="h-4 w-4" />} Chercher
            </button>
          </div>
          <input value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="Postes recherchés, séparés par des virgules" className={field} aria-label="Postes recherchés" />
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <input type="checkbox" checked={france} onChange={(e) => setFrance(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Seulement en France
            <span className="ml-auto text-[11.5px] text-faint">0,25 crédit par personne trouvée · 1 crédit par email trouvé</span>
          </label>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {res === null ? (
            <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">Écris la marque (ou mieux, son site) puis « Chercher ». Le site donne les résultats les plus justes.</p>
          ) : res.people.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">Personne ne correspond. Essaie le site de la marque, d'autres postes, ou décoche « France ».</p>
          ) : (
            <>
              {res.people.map((p) => {
                const done = p.id in added;
                return (
                  <div key={p.id} className="flex items-center gap-3 border-b border-border/60 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-semibold text-foreground">{p.name}</span>
                        {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" title="Profil LinkedIn" className="shrink-0 text-faint hover:text-foreground"><ExternalLink className="h-3 w-3" /></a>}
                      </div>
                      <div className="truncate text-[12px] text-muted-foreground">{[p.title, p.company, p.location].filter(Boolean).join(" · ")}</div>
                      {done && <div className="truncate text-[12px] font-medium text-primary">{added[p.id] || "Email introuvable"}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void add(p)}
                      disabled={done || !!adding}
                      className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors disabled:opacity-60", done ? "bg-ok/10 text-ok" : "bg-field text-foreground hover:bg-rowhover")}
                    >
                      {adding === p.id ? <Spin size={13} /> : done ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                      {done ? "Ajouté" : adding === p.id ? "Recherche de l'email…" : "Ajouter + email"}
                    </button>
                  </div>
                );
              })}
              {res.people.length < res.total && (
                <div className="px-5 py-3 text-center">
                  <button type="button" onClick={() => void search(res.people.length)} disabled={busy} className="text-[13px] font-medium text-primary hover:underline disabled:opacity-50">
                    {busy ? "Recherche…" : `Voir 10 de plus (${res.total - res.people.length} autres)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

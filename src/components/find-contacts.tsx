import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search, UserPlus, X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { Overlay } from "@/components/mobile/ios-sheet";
import { MailAvatar } from "@/components/mail-avatar";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { toast } from "@/components/ui/toast";
import { dbInsert } from "@/lib/db";
import { mergeAppStateKey, useAppState, type AppState } from "@/lib/appState";
import { feCredits, feEnrich, feSearch, type FePerson } from "@/lib/fullenrich";
import { cn, initials } from "@/lib/utils";

/** Postes proposés : chaque pastille ajoute ses mots-clés à la recherche. */
const ROLES: { label: string; words: string[] }[] = [
  { label: "Influence", words: ["influence", "influencer", "creator"] },
  { label: "Partenariats", words: ["partenariat", "partnership", "collaboration"] },
  { label: "Marketing", words: ["marketing", "growth"] },
  { label: "Communication", words: ["communication"] },
  { label: "Brand manager", words: ["brand manager", "brand"] },
  { label: "Relations presse", words: ["relations presse", "public relations", "PR"] },
  { label: "Social media", words: ["social media", "community"] },
  { label: "Direction", words: ["CEO", "founder", "fondateur", "directeur", "director"] },
];
const DEFAULT_ROLES = ["Influence", "Partenariats", "Marketing", "Communication", "Brand manager"];
const RECENT_KEY = "ttp:fe-recent";
const readRecent = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 6);
  } catch {
    return [];
  }
};

/** Personne déjà trouvée (historique partagé de l'agence, blob `feHistory`). */
type Seen = FePerson & { at: number; email?: string; added?: boolean };
const personKey = (name: string, company: string) => `${name.trim().toLowerCase()}|${company.trim().toLowerCase()}`;

/**
 * « Trouver des contacts » (page Contacts, FullEnrich) : les bonnes personnes d'une marque
 * (pastilles de postes), puis « Ajouter à Contacts » : l'email pro est cherché et la fiche
 * contact créée. Onglet « Historique » : toutes les personnes déjà trouvées par l'agence,
 * à reprendre sans repayer la recherche. Coûts : 0,25 crédit par personne trouvée,
 * 1 crédit par email trouvé.
 */
export function FindContactsDialog({ initialCompany = "", knownEmails, knownPeople, onClose, onAdded }: {
  initialCompany?: string;
  /** Emails déjà dans les contacts (pour signaler les doublons). */
  knownEmails: Set<string>;
  /** « nom|marque » (minuscules) des contacts existants. */
  knownPeople: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [company, setCompany] = useState(initialCompany);
  const [roles, setRoles] = useState<string[]>(DEFAULT_ROLES);
  const [extra, setExtra] = useState<string[]>([]); // postes tapés à la main
  const [extraDraft, setExtraDraft] = useState("");
  const [france, setFrance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ people: FePerson[]; total: number; query: string } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({}); // id → email trouvé ("" si aucun)
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [tab, setTab] = useState<"results" | "history">("results");
  const [histQ, setHistQ] = useState("");
  const { data: histData } = useAppState<Record<string, Seen>>((st: AppState) => (st["feHistory"] as Record<string, Seen> | undefined) ?? {});
  const [histLocal, setHistLocal] = useState<Record<string, Seen>>({});
  const history = useMemo(() => {
    const all = { ...(histData ?? {}), ...histLocal };
    return Object.values(all).filter((x) => x && x.name).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }, [histData, histLocal]);
  const remember = (entries: Record<string, Seen>) => {
    setHistLocal((cur) => ({ ...cur, ...entries }));
    void mergeAppStateKey("feHistory", entries);
  };
  const seenOf = (id: string) => histLocal[id] ?? histData?.[id];
  const inContacts = (p: FePerson) => {
    const email = added[p.id] || seenOf(p.id)?.email || "";
    return !!seenOf(p.id)?.added || (p.id in added) || (!!email && knownEmails.has(email)) || knownPeople.has(personKey(p.name, p.company || company));
  };
  useEffect(() => {
    void feCredits().then(setBalance).catch(() => setBalance(null));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const titles = useMemo(() => [...ROLES.filter((r) => roles.includes(r.label)).flatMap((r) => r.words), ...extra], [roles, extra]);

  const search = async (offset = 0, q = company) => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    if (!offset) setRes(null);
    try {
      const r = await feSearch(query, { titles, country: france ? "France" : undefined, limit: 10, offset });
      setRes((cur) => (offset && cur ? { ...cur, people: [...cur.people, ...r.people], total: r.total } : { people: r.people, total: r.total, query }));
      setTab("results");
      // Historique : chaque personne trouvée est gardée (sans écraser un email déjà trouvé).
      const now = Date.now();
      remember(Object.fromEntries(r.people.map((p) => [p.id, { ...(seenOf(p.id) ?? {}), ...p, at: now } as Seen])));
      if (!offset) {
        const next = [query, ...recent.filter((x) => x.toLowerCase() !== query.toLowerCase())].slice(0, 6);
        setRecent(next);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          /* stockage indisponible */
        }
      }
      void feCredits().then(setBalance).catch(() => {});
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
        remember({ [p.id]: { ...(seenOf(p.id) ?? p), ...p, at: Date.now(), email, added: true } });
        return toast(`${p.name} est déjà dans tes contacts (${email})`);
      }
      const fields = {
        brand: p.company || company.trim(), person: p.name, first_name: p.first || null, last_name: p.last || null,
        role: p.title || null, email: email || null, city: p.location.split(",")[0]?.trim() || null, tag: "Marque", tone: "cyan",
      };
      // Profil LinkedIn gardé sur la fiche (colonne contacts.linkedin, SQL 2026-10-28) ; sans la colonne, fiche sans lui.
      const created = (p.linkedin ? await dbInsert("contacts", { ...fields, linkedin: p.linkedin }) : null) ?? await dbInsert("contacts", fields);
      if (!created) return toast("Contact non créé, réessaie");
      setAdded((a) => ({ ...a, [p.id]: email }));
      remember({ [p.id]: { ...(seenOf(p.id) ?? p), ...p, at: Date.now(), email, added: true } });
      toast(email ? `${p.name} ajouté à Contacts avec son email ✓` : `${p.name} ajouté à Contacts (email introuvable)`);
      onAdded();
      void feCredits().then(setBalance).catch(() => {});
    } finally {
      setAdding(null);
    }
  };

  // Une personne (résultat ou historique) : logo de sa marque, poste, et « Ajouter à Contacts ».
  const card = (p: FePerson, when?: number) => {
    const done = inContacts(p);
    const email = added[p.id] || seenOf(p.id)?.email || "";
    return (
      <div key={p.id} className="flex items-center gap-3 rounded-[16px] bg-surface p-3.5 shadow-sm shadow-black/[0.03]">
        <span className="relative shrink-0">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-field text-[13px] font-semibold text-muted-foreground">{initials(p.name)}</span>
          <MailAvatar name={p.company} brand={p.company} brandDomain={p.domain || null} size="sm" className="absolute -bottom-1 -right-1 h-5 w-5 text-[9px] ring-2 ring-surface" fallback={null} fallbackClassName="hidden" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-semibold text-foreground">{p.name}</span>
            {p.linkedin && (
              <a href={p.linkedin} target="_blank" rel="noreferrer" title="Voir le profil LinkedIn" aria-label="Profil LinkedIn" className="shrink-0 text-faint transition-colors hover:text-[#0a66c2]"><PlatformIcon platform="linkedin" className="h-3.5 w-3.5" /></a>
            )}
          </div>
          <div className="truncate text-[13px] text-muted-foreground">{p.title || "Poste non précisé"}</div>
          <div className="truncate text-[12px] text-faint">{[p.company, p.location, when ? `trouvé le ${new Date(when).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ")}</div>
          {email ? <div className="mt-0.5 truncate text-[12.5px] font-medium text-primary">{email}</div> : (p.id in added) ? <div className="mt-0.5 text-[12.5px] text-muted-foreground">Email introuvable</div> : null}
        </div>
        <button
          type="button"
          onClick={() => void add(p)}
          disabled={done || !!adding}
          title={done ? "Déjà dans tes contacts" : "Crée la fiche contact et cherche son email pro (1 crédit s'il est trouvé)"}
          className={cn(
            "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:cursor-default",
            done ? "bg-ok/10 text-ok" : "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50",
          )}
        >
          {adding === p.id ? <Spin size={13} /> : done ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          <span className="max-sm:hidden">{done ? "Dans Contacts" : adding === p.id ? "Recherche de l'email…" : "Ajouter à Contacts"}</span>
        </button>
      </div>
    );
  };
  const hq = histQ.trim().toLowerCase();
  const histShown = hq ? history.filter((x) => `${x.name} ${x.company} ${x.title} ${x.email ?? ""}`.toLowerCase().includes(hq)) : history;

  const toggleRole = (label: string) => setRoles((cur) => (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]));
  const addExtra = () => {
    const v = extraDraft.trim();
    if (v && !extra.includes(v)) setExtra((cur) => [...cur, v]);
    setExtraDraft("");
  };
  const chip = (on: boolean) => cn("flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-medium transition-colors", on ? "bg-foreground text-background" : "bg-field text-muted-foreground hover:text-foreground");

  return (
    <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={onClose} label="Trouver des contacts">
      <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* En-tête : titre, crédits, fermer */}
        <div className="flex items-start gap-3 px-6 pb-2 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold tracking-[-0.01em] text-foreground">Trouver des contacts</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Les bonnes personnes d'une marque, avec leur email pro.</p>
          </div>
          {balance != null && (
            <span className="mt-1 shrink-0 rounded-full bg-field px-3 py-1 text-[12px] font-medium tabular-nums text-muted-foreground" title="Crédits FullEnrich restants">
              {balance.toLocaleString("fr-FR")} crédits
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-field text-muted-foreground transition-colors hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Recherche */}
        <form onSubmit={(e) => { e.preventDefault(); void search(0); }} className="flex flex-col gap-3 px-6 pb-4 pt-2">
          <div className="flex items-center gap-2 rounded-[16px] bg-field p-1.5 pl-4 ring-1 ring-transparent transition-shadow focus-within:ring-primary/40">
            <Search className="h-4 w-4 shrink-0 text-faint" />
            <input
              autoFocus
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Marque ou site, ex. sephora.fr"
              aria-label="Marque ou site"
              className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint max-md:text-[16px]"
            />
            <button type="submit" disabled={!company.trim() || busy} className="flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
              {busy ? <Spin size={14} /> : null} Chercher
            </button>
          </div>
          {!res && !busy && recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className="mr-0.5">Récentes :</span>
              {recent.map((r) => (
                <button key={r} type="button" onClick={() => { setCompany(r); void search(0, r); }} className="rounded-full bg-field px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-rowhover">{r}</button>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Postes recherchés</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {ROLES.map((r) => (
                <button key={r.label} type="button" aria-pressed={roles.includes(r.label)} onClick={() => toggleRole(r.label)} className={chip(roles.includes(r.label))}>
                  {roles.includes(r.label) && <Check className="h-3 w-3" />}{r.label}
                </button>
              ))}
              {extra.map((x) => (
                <button key={x} type="button" onClick={() => setExtra((cur) => cur.filter((y) => y !== x))} className={chip(true)} title="Retirer">
                  {x}<X className="h-3 w-3" />
                </button>
              ))}
              <span className="flex h-8 items-center gap-1 rounded-full bg-field pl-3 pr-1">
                <input
                  value={extraDraft}
                  onChange={(e) => setExtraDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExtra();
                    }
                  }}
                  placeholder="Autre poste"
                  aria-label="Autre poste"
                  className="h-full w-24 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-faint max-md:text-[16px]"
                />
                <button type="button" onClick={addExtra} disabled={!extraDraft.trim()} aria-label="Ajouter ce poste" className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-rowhover disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Pays" className="flex rounded-full bg-field p-0.5">
              {[{ v: true, l: "France" }, { v: false, l: "Partout" }].map((o) => (
                <button key={o.l} type="button" aria-pressed={france === o.v} onClick={() => setFrance(o.v)} className={cn("h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors", france === o.v ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{o.l}</button>
              ))}
            </div>
            <span className="text-[11.5px] text-faint">0,25 crédit par personne trouvée · 1 crédit par email trouvé</span>
          </div>
        </form>

        {/* Résultats / Historique */}
        <div className="min-h-[220px] flex-1 overflow-y-auto border-t border-border bg-panel/50 px-4 py-3">
          <div role="tablist" aria-label="Affichage" className="mb-3 flex w-fit rounded-full bg-field p-0.5">
            {([["results", "Résultats"], ["history", `Historique${history.length ? ` · ${history.length}` : ""}`]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors", tab === k ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
          {tab === "history" ? (
            history.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted-foreground">Les personnes trouvées s'afficheront ici, pour les retrouver sans repayer la recherche.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 rounded-[12px] bg-surface px-3 shadow-sm shadow-black/[0.03]">
                  <Search className="h-3.5 w-3.5 text-faint" />
                  <input value={histQ} onChange={(e) => setHistQ(e.target.value)} placeholder="Chercher dans l'historique (nom, marque, poste)" aria-label="Chercher dans l'historique" className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint max-md:text-[16px]" />
                </div>
                {histShown.length ? histShown.slice(0, 200).map((x) => card(x, x.at)) : <p className="py-6 text-center text-[13px] text-muted-foreground">Rien ne correspond.</p>}
              </div>
            )
          ) : busy && !res ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 rounded-[16px] bg-surface p-3.5">
                  <div className="h-11 w-11 rounded-full bg-field" />
                  <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-field" /><div className="h-3 w-2/3 rounded bg-field" /></div>
                </div>
              ))}
            </div>
          ) : res === null ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-surface text-muted-foreground shadow-sm"><UserPlus className="h-5 w-5" /></span>
              <p className="text-[14px] font-medium text-foreground">Cherche une marque</p>
              <p className="max-w-sm text-[13px] text-muted-foreground">Son site (ex. sephora.fr) donne les résultats les plus justes. Choisis les postes qui t'intéressent, puis ajoute les bonnes personnes en un clic.</p>
            </div>
          ) : res.people.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <p className="text-[14px] font-medium text-foreground">Personne chez « {res.query} »</p>
              <p className="max-w-sm text-[13px] text-muted-foreground">Essaie le site de la marque, d'autres postes, ou « Partout ».</p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-[13px] font-semibold text-foreground">{res.total} personne{res.total > 1 ? "s" : ""} chez {res.people[0]?.company || res.query}</span>
                <span className="text-[12px] text-muted-foreground">{res.people.length} affichée{res.people.length > 1 ? "s" : ""}</span>
              </div>
              <div className="flex flex-col gap-2">
                {res.people.map((p) => card(p))}
              </div>
              {res.people.length < res.total && (
                <button type="button" onClick={() => void search(res.people.length, res.query)} disabled={busy} className="mx-auto mt-3 flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[13px] font-medium text-foreground shadow-sm transition-colors hover:bg-rowhover disabled:opacity-50">
                  {busy ? <Spin size={13} /> : null} Voir 10 de plus · {res.total - res.people.length} autres
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

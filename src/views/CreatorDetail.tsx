import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase, initials } from "@/lib/utils";
import { dbUpdate } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

type Creator = {
  id: string;
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  followers: string | null;
  reach: string | null;
  er: string | null;
  ca: string | null;
  status: string | null;
  photo_url: string | null;
  ville: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  siren: string | null;
  birth: string | null;
  commission: string | null;
};
type Inv = { ref: string; party: string; amount: string; date: string };
type Td = { id: string; text: string; done: boolean };
type Br = { brand: string; deliverables: string | null; due: string | null };
type Idea = { text: string };

type Coord = Pick<Creator, "ville" | "phone" | "email" | "address" | "siren" | "birth">;

const statusBadge = (s: string | null) =>
  s === "pause" ? "warning" : s === "inactif" ? "neutral" : "success";

export function CreatorDetail({
  name,
  onBack,
  onOpenPortal,
}: {
  name: string;
  onBack: () => void;
  onOpenPortal: (n: string) => void;
}) {
  const [c, setC] = useState<Creator | null>(null);
  const [inv, setInv] = useState<Inv[]>([]);
  const [td, setTd] = useState<Td[]>([]);
  const [br, setBr] = useState<Br[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [form, setForm] = useState<Coord>({
    ville: "",
    phone: "",
    email: "",
    address: "",
    siren: "",
    birth: "",
  });

  useEffect(() => {
    let alive = true;
    supabase.from("creators").select("*").eq("name", name).limit(1).then(({ data }) => {
      if (!alive) return;
      const row = (data?.[0] as Creator) ?? null;
      setC(row);
      if (row)
        setForm({
          ville: row.ville ?? "",
          phone: row.phone ?? "",
          email: row.email ?? "",
          address: row.address ?? "",
          siren: row.siren ?? "",
          birth: row.birth ?? "",
        });
    });
    supabase.from("invoices").select("ref,party,amount,date").eq("creator", name).then(({ data }) => alive && setInv((data as Inv[]) ?? []));
    supabase.from("todos").select("id,text,done").eq("creator", name).then(({ data }) => alive && setTd((data as Td[]) ?? []));
    supabase.from("briefs").select("brand,deliverables,due").eq("who", name).then(({ data }) => alive && setBr((data as Br[]) ?? []));
    supabase.from("ideas").select("text").eq("creator", name).then(({ data }) => alive && setIdeas((data as Idea[]) ?? []));
    return () => {
      alive = false;
    };
  }, [name]);

  const save = async () => {
    if (!c) return;
    const ok = await dbUpdate("creators", c.id, { ...form });
    toast(ok ? "Infos enregistrées ✓" : "Erreur — réessaie");
  };

  const field = (label: string, key: keyof Coord) => (
    <div>
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <input
        value={form[key] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder="—"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </div>
  );

  const stat = (label: string, val: string | null) => (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-2 whitespace-nowrap text-2xl font-bold tracking-tight">{val || "—"}</div>
    </div>
  );

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Roster
      </button>

      <div className="mb-5 flex flex-wrap items-center gap-4">
        {c?.photo_url ? (
          <img src={c.photo_url} alt={titleCase(name)} className="h-16 w-16 rounded-2xl object-cover" />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-lg font-semibold text-muted-foreground">
            {initials(name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="text-2xl font-semibold tracking-tight">{titleCase(name)}</div>
            <AnimatedBadge status={statusBadge(c?.status ?? null)} size="sm">
              {c?.status ? titleCase(c.status) : "Actif"}
            </AnimatedBadge>
          </div>
          <div className="mt-1 text-sm text-faint">
            {[c?.handle, c?.niche, c?.platform].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <button
          onClick={() => onOpenPortal(name)}
          className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-xs font-semibold text-background transition-opacity hover:opacity-90"
        >
          <ExternalLink className="h-4 w-4" /> Voir le portail
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stat("Abonnés", c?.followers ?? null)}
        {stat("Engagement", c?.er ?? null)}
        {stat("CA · mois", c?.ca ?? null)}
        {stat("Reach", c?.reach ?? null)}
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Coordonnées &amp; informations</div>
          {c?.commission && (
            <div className="rounded-lg bg-signalsoft px-3 py-1.5 text-xs font-semibold text-signaltext">
              Commission {c.commission}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field("Ville", "ville")}
          {field("Téléphone", "phone")}
          {field("Email", "email")}
          {field("Adresse", "address")}
          {field("SIREN", "siren")}
          {field("Naissance", "birth")}
        </div>
        <button
          onClick={save}
          className="mt-4 rounded-lg bg-signal px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-onsignal transition-opacity hover:opacity-90"
        >
          Enregistrer
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Facturation</div>
          {inv.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucune facture.</div>
          ) : (
            inv.map((v, i) => (
              <div key={i} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{v.party}</div>
                  <div className="text-[10px] text-faint">#{v.ref} · {v.date}</div>
                </div>
                <span className="text-xs font-semibold">{v.amount}</span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">À faire</div>
          {td.length === 0 ? (
            <div className="text-xs text-muted-foreground">Rien à faire.</div>
          ) : (
            td.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5 py-1.5">
                <span className={"h-4 w-4 shrink-0 rounded-[5px] border " + (t.done ? "border-signal bg-signal" : "border-faint")} />
                <span className={"text-xs " + (t.done ? "text-faint line-through" : "")}>{t.text}</span>
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Briefs</div>
          {br.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucun brief.</div>
          ) : (
            br.map((b, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{b.brand}</div>
                  <div className="truncate text-[10px] text-faint">{b.deliverables} · {b.due}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Idées de contenu</div>
          {ideas.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucune idée.</div>
          ) : (
            ideas.map((x, i) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-indigo" />
                <span className="text-xs">{x.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

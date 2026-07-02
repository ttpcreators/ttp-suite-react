import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Copy, Pencil, Check, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { dbUpdate } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLiveKey } from "@/lib/useLive";
import { AvatarUpload } from "@/components/ui/avatar-upload";

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
  const [editing, setEditing] = useState(false);

  const live = useLiveKey();
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    let alive = true;
    supabase.from("creators").select("*").eq("name", name).limit(1).then(({ data }) => {
      if (!alive) return;
      const row = (data?.[0] as Creator) ?? null;
      setC(row);
      if (row && !editingRef.current)
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
  }, [name, live]);

  const save = async () => {
    if (!c) return;
    const ok = await dbUpdate("creators", c.id, { ...form });
    if (!ok) {
      toast("Erreur — réessaie");
      return;
    }
    setC({ ...c, ...form });
    setEditing(false);
    toast("Infos enregistrées ✓");
  };

  const cancel = () => {
    if (c)
      setForm({
        ville: c.ville ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        address: c.address ?? "",
        siren: c.siren ?? "",
        birth: c.birth ?? "",
      });
    setEditing(false);
  };

  const copyAll = () => {
    const text = [
      titleCase(name),
      [c?.handle, c?.niche].filter(Boolean).join(" · "),
      form.email && `Email : ${form.email}`,
      form.phone && `Tél : ${form.phone}`,
      form.ville && `Ville : ${form.ville}`,
      form.address && `Adresse : ${form.address}`,
      form.siren && `SIREN : ${form.siren}`,
      form.birth && `Naissance : ${form.birth}`,
      c?.commission && `Commission : ${c.commission}`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard?.writeText(text);
    toast("Infos copiées ✓");
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

  const copyRow = (label: string, value: string) => {
    const v = value?.trim() ?? "";
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
          <div className="truncate text-sm">{v || "—"}</div>
        </div>
        {v && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(v);
              toast(`${label} copié ✓`);
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            title={`Copier ${label.toLowerCase()}`}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

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
        <AvatarUpload
          creatorId={c?.id}
          name={name}
          photoUrl={c?.photo_url ?? null}
          size={64}
          onUploaded={(url) => setC((prev) => (prev ? { ...prev, photo_url: url } : prev))}
        />
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
          <div className="flex items-center gap-2">
            {c?.commission && (
              <div className="hidden rounded-lg bg-signalsoft px-3 py-1.5 text-xs font-semibold text-signaltext sm:block">
                Commission {c.commission}
              </div>
            )}
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" /> Enregistrer
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  title="Annuler"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" /> Modifier
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {field("Ville", "ville")}
            {field("Téléphone", "phone")}
            {field("Email", "email")}
            {field("Adresse", "address")}
            {field("SIREN", "siren")}
            {field("Naissance", "birth")}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {copyRow("Ville", form.ville ?? "")}
              {copyRow("Téléphone", form.phone ?? "")}
              {copyRow("Email", form.email ?? "")}
              {copyRow("Adresse", form.address ?? "")}
              {copyRow("SIREN", form.siren ?? "")}
              {copyRow("Naissance", form.birth ?? "")}
            </div>
            <button
              type="button"
              onClick={copyAll}
              className="mt-3 flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" /> Copier toutes les infos
            </button>
          </>
        )}
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
                <span className={"h-4 w-4 shrink-0 rounded-[5px] border " + (t.done ? "border-primary bg-primary" : "border-faint")} />
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

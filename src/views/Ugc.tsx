import { useEffect, useState } from "react";
import { Pencil, Copy, Trash2 } from "lucide-react";
import { useAppState, saveAppStateKey } from "@/lib/appState";
import { useSearch, matchQuery } from "@/lib/search";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { cn, titleCase } from "@/lib/utils";

/**
 * Roster UGC — indépendant du roster créateurs. Ces profils n'ont PAS d'accès à
 * l'app (aucun compte auth) : c'est un suivi interne pour l'agence. Stocké dans
 * le blob de réglages `__app_state__` (clé `ugcRoster`, RLS agence-only), donc
 * aucune table ni auth à créer, et zéro impact sur le roster principal.
 */
type Ugc = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  niche: string;
  rate: string;
  email: string;
  phone: string;
  city: string;
  status: string;
  notes: string;
};

const PLATFORMS = [
  { value: "Instagram", label: "Instagram" },
  { value: "TikTok", label: "TikTok" },
  { value: "YouTube", label: "YouTube" },
  { value: "UGC", label: "UGC only" },
  { value: "Autre", label: "Autre" },
];
const STATUSES = [
  { value: "actif", label: "Actif" },
  { value: "test", label: "En test" },
  { value: "pause", label: "Pause" },
];
const statusMeta = (s: string): { status: "success" | "warning" | "neutral"; label: string } =>
  s === "test" ? { status: "warning", label: "En test" } : s === "pause" ? { status: "neutral", label: "Pause" } : { status: "success", label: "Actif" };

const ALL = "__all__";
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
const blank = (): Ugc => ({ id: uid(), name: "", handle: "", platform: "Instagram", niche: "", rate: "", email: "", phone: "", city: "", status: "actif", notes: "" });

export function Ugc() {
  const { data } = useAppState<Ugc[]>((s) => ((s as Record<string, unknown>).ugcRoster as Ugc[]) ?? []);
  const [list, setList] = useState<Ugc[]>([]);
  const [dirty, setDirty] = useState(false);
  const { query } = useSearch();
  const [platFilter, setPlatFilter] = useState<string>(ALL);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Ugc>(blank());

  useEffect(() => {
    if (data && !dirty) setList(data);
  }, [data, dirty]);

  const persist = async (next: Ugc[]) => {
    setDirty(true);
    setList(next);
    const ok = await saveAppStateKey("ugcRoster", next);
    if (!ok) toast("Erreur — réessaie");
  };

  const openAdd = () => {
    setDraft(blank());
    setEditId(null);
    setFormOpen(true);
  };
  const openEdit = (u: Ugc) => {
    setDraft({ ...u });
    setEditId(u.id);
    setFormOpen(true);
  };
  const set = (k: keyof Ugc, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    if (!draft.name.trim()) {
      toast("Renseigne le nom");
      return;
    }
    const clean = { ...draft, name: draft.name.trim() };
    const next = editId ? list.map((u) => (u.id === editId ? clean : u)) : [clean, ...list];
    await persist(next);
    toast(editId ? "UGC modifié ✓" : "UGC ajouté ✓");
    setFormOpen(false);
    setEditId(null);
    setDraft(blank());
  };

  const del = async (id: string) => {
    await persist(list.filter((u) => u.id !== id));
    toast("Supprimé");
  };

  const platList = Array.from(new Set(list.map((u) => u.platform).filter(Boolean)));
  const filtered = list.filter((u) => {
    if (platFilter !== ALL && u.platform !== platFilter) return false;
    return matchQuery(query, u.name, u.handle, u.niche, u.city, u.email, u.platform);
  });

  const pillBase = "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors";
  const pillActive = "bg-primary text-primary-foreground";
  const pillInactive = "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {filtered.length} créateur{filtered.length > 1 ? "s" : ""} UGC
          {(platFilter !== ALL || query.trim()) && <span className="text-faint"> / {list.length}</span>}
        </div>
        <AddButton label="UGC" onClick={openAdd} />
      </div>

      {platList.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setPlatFilter(ALL)} className={cn(pillBase, platFilter === ALL ? pillActive : pillInactive)}>
            Tous
          </button>
          {platList.map((p) => (
            <button key={p} type="button" onClick={() => setPlatFilter(p)} className={cn(pillBase, platFilter === p ? pillActive : pillInactive)}>
              {p}
            </button>
          ))}
        </div>
      )}

      <InlineForm
        open={formOpen}
        title={editId ? "Modifier le créateur UGC" : "Nouveau créateur UGC"}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSubmit={submit}
        submitLabel={editId ? "Enregistrer" : "Ajouter"}
      >
        <TextField label="Nom" value={draft.name} onChange={(v) => set("name", v)} />
        <TextField label="Handle / @" value={draft.handle} onChange={(v) => set("handle", v)} />
        <SelectField label="Plateforme" value={draft.platform} onChange={(v) => set("platform", v)} options={PLATFORMS} />
        <TextField label="Niche" value={draft.niche} onChange={(v) => set("niche", v)} />
        <TextField label="Tarif" value={draft.rate} onChange={(v) => set("rate", v)} placeholder="ex 150 € / vidéo" />
        <SelectField label="Statut" value={draft.status} onChange={(v) => set("status", v)} options={STATUSES} />
        <TextField label="Email" value={draft.email} onChange={(v) => set("email", v)} type="email" />
        <TextField label="Téléphone" value={draft.phone} onChange={(v) => set("phone", v)} />
        <TextField label="Ville" value={draft.city} onChange={(v) => set("city", v)} />
        <TextField label="Notes" value={draft.notes} onChange={(v) => set("notes", v)} />
      </InlineForm>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
          {list.length === 0 ? "Aucun créateur UGC pour l'instant. Ajoute le premier 🎬" : "Aucun résultat pour ces filtres."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((u) => {
            const b = statusMeta(u.status);
            const contact = [u.email, u.phone].filter(Boolean).join(" · ");
            return (
              <div key={u.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <CreatorAvatar name={u.name} photoUrl={null} className="h-11 w-11 shrink-0 rounded-xl text-xs" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold">{titleCase(u.name)}</div>
                      <AnimatedBadge status={b.status} size="sm">{b.label}</AnimatedBadge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-faint">
                      {[u.handle, u.platform, u.niche].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {(u.rate || u.city) && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {[u.rate, u.city].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {u.notes && <div className="mt-1 line-clamp-2 text-[11px] text-faint">{u.notes}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ActionMenu
                      items={[
                        ...(contact ? [{ key: "copy", label: "Copier le contact", icon: Copy, onClick: () => { navigator.clipboard?.writeText(contact); toast("Contact copié ✓"); } }] : []),
                        { key: "edit", label: "Modifier", icon: Pencil, onClick: () => openEdit(u) },
                        { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => del(u.id), confirm: { title: "Supprimer le créateur UGC", message: `Supprimer « ${u.name} » ? Cette action est irréversible.` } },
                      ]}
                    />
                  </div>
                </div>
                {contact && (
                  <div className="mt-3 truncate rounded-lg bg-panel px-3 py-2 text-xs text-foreground">{contact}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

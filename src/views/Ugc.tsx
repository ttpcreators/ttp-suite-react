import { useEffect, useState } from "react";
import { Pencil, Copy, Trash2 } from "lucide-react";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState } from "@/lib/appState";
import { useSearch, matchQuery } from "@/lib/search";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { cn, titleCase } from "@/lib/utils";
import { PageHeaderRow } from "@/components/ui/page-header";

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
  const { query } = useSearch();
  const [platFilter, setPlatFilter] = useState<string>(ALL);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Ugc>(blank());

  // On resynchronise en continu depuis la donnée live (les 2 comptes agence voient
  // les MÀJ de l'autre), sauf pendant qu'un formulaire est ouvert (ne pas bouger sous
  // les doigts). Plus de gel « dirty » permanent qui masquait les écritures concurrentes.
  useEffect(() => {
    if (data && !formOpen) setList(data);
  }, [data, formOpen]);

  // Écrit en RELISANT l'état frais juste avant (jamais depuis un `list` local périmé) :
  // évite l'écrasement d'une écriture concurrente ET le clobber au tout premier chargement.
  const persist = async (mutate: (fresh: Ugc[]) => Ugc[]): Promise<boolean> => {
    invalidateAppState();
    const fresh = (((await getAppState()) as Record<string, unknown>).ugcRoster as Ugc[]) ?? [];
    const next = mutate(fresh);
    setList(next);
    const ok = await saveAppStateKey("ugcRoster", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
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
    const ok = await persist((fresh) => (editId ? fresh.map((u) => (u.id === editId ? clean : u)) : [clean, ...fresh]));
    if (ok) toast(editId ? "UGC modifié ✓" : "UGC ajouté ✓");
    setFormOpen(false);
    setEditId(null);
    setDraft(blank());
  };

  const del = async (id: string) => {
    const ok = await persist((fresh) => fresh.filter((u) => u.id !== id));
    if (ok) toast("Supprimé");
  };

  const platList = Array.from(new Set(list.map((u) => u.platform).filter(Boolean)));
  const filtered = list.filter((u) => {
    if (platFilter !== ALL && u.platform !== platFilter) return false;
    return matchQuery(query, u.name, u.handle, u.niche, u.city, u.email, u.platform);
  });

  const pillBase = "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors";
  const pillActive = "bg-foreground text-background";
  const pillInactive = "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground";

  return (
    <>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {filtered.length} créateur{filtered.length > 1 ? "s" : ""} UGC
          {(platFilter !== ALL || query.trim()) && <span className="text-faint"> / {list.length}</span>}
        </div>
        <AddButton label="UGC" onClick={openAdd} />
      </PageHeaderRow>

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
        <div className="rounded-2xl border border-border bg-surface p-6 text-[13px] text-muted-foreground">
          {list.length === 0 ? "Aucun créateur UGC pour l'instant. Ajoute le premier avec le bouton « UGC »." : "Aucun résultat pour ces filtres."}
        </div>
      ) : (
        /* Liste dans UN panneau, lignes séparées par des filets (langage Aperçu) */
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {filtered.map((u) => {
            const b = statusMeta(u.status);
            const contact = [u.email, u.phone].filter(Boolean).join(" · ");
            return (
              <div key={u.id} className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-rowhover sm:items-center sm:px-5">
                <CreatorAvatar name={u.name} photoUrl={null} className="h-10 w-10 shrink-0 rounded-full text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-[13px] font-semibold text-foreground">{titleCase(u.name)}</div>
                    <AnimatedBadge status={b.status} size="sm">{b.label}</AnimatedBadge>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {[u.handle, u.platform, u.niche].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {u.notes && <div className="mt-1 line-clamp-1 text-[12px] text-faint">{u.notes}</div>}
                  {contact && <div className="mt-1 truncate text-[12px] text-muted-foreground md:hidden">{contact}</div>}
                </div>
                {(u.rate || u.city) && (
                  <div className="hidden w-40 shrink-0 text-right text-[13px] lg:block">
                    {u.rate && <div className="truncate font-medium tabular-nums text-foreground">{u.rate}</div>}
                    {u.city && <div className="truncate text-[12px] text-muted-foreground">{u.city}</div>}
                  </div>
                )}
                {contact && <div className="hidden w-56 shrink-0 truncate text-right text-[13px] text-muted-foreground md:block">{contact}</div>}
                <div className="flex shrink-0 items-center">
                  <ActionMenu
                    items={[
                      ...(contact ? [{ key: "copy", label: "Copier le contact", icon: Copy, onClick: () => { navigator.clipboard?.writeText(contact); toast("Contact copié ✓"); } }] : []),
                      { key: "edit", label: "Modifier", icon: Pencil, onClick: () => openEdit(u) },
                      { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => del(u.id), confirm: { title: "Supprimer le créateur UGC", message: `Supprimer « ${u.name} » ? Cette action est irréversible.` } },
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

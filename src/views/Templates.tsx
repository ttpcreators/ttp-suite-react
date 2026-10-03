import { useState, useEffect } from "react";
import { Copy, Search, Eye, X, LayoutGrid, List as ListIcon, Pencil, Trash2 } from "lucide-react";
import { useSearch, matchQuery } from "@/lib/search";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, AutoGrowTextField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { cn } from "@/lib/utils";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";

/** `id` : présent sur les modèles perso (généré à l'écriture pour les anciens). */
type Template = { id?: string; category: string; title: string; body: string };

/** Même modèle perso : par id si les deux en ont un, sinon par contenu (anciens sans id). */
function sameTpl(a: Template, b: Template): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.title === b.title && a.body === b.body && a.category === b.category;
}
let _tplSeq = 0;
function newTplId(): string {
  _tplSeq += 1;
  return `tpl${Date.now().toString(36)}${_tplSeq}`;
}
/** Donne un id aux anciens modèles perso qui n'en ont pas. */
function withIds(list: Template[]): Template[] {
  return list.map((t) => (t.id ? t : { ...t, id: newTplId() }));
}

/** Ordre d'affichage des catégories (les autres viennent après, par ordre d'apparition). */
const CATEGORY_ORDER = ["Prospection", "Négociation", "Suivi", "Facturation"];

/** Teinte par catégorie pour le badge. */
const CATEGORY_TONE: Record<string, string> = {
  Prospection: "text-indigo",
  Négociation: "text-amber",
  Suivi: "text-cyan",
  Facturation: "text-signal",
};

/** Jeu de modèles par défaut, en français, avec variables {marque}/{créateur}. */
const DEFAULT_TEMPLATES: Template[] = [
  {
    category: "Prospection",
    title: "DM marque à froid",
    body:
      "Bonjour {marque} 👋\n\n" +
      "Je gère les collaborations de {créateur} chez TTP Agency. On adore votre univers et on pense qu'une campagne ensemble aurait du sens : audience engagée, contenu qui performe.\n\n" +
      "Puis-je vous envoyer le media kit de {créateur} par mail ?\n\n" +
      "Belle journée,\nTTP Agency",
  },
  {
    category: "Prospection",
    title: "Relance après devis",
    body:
      "Bonjour {marque},\n\n" +
      "Je me permets de revenir vers vous concernant le devis envoyé pour la collaboration avec {créateur}.\n\n" +
      "Avez-vous eu l'occasion d'en discuter en interne ? Je reste disponible pour ajuster le format ou le budget si besoin.\n\n" +
      "Au plaisir d'échanger,\nTTP Agency",
  },
  {
    category: "Négociation",
    title: "Contre-proposition tarif",
    body:
      "Bonjour {marque},\n\n" +
      "Merci pour votre retour. Pour ce format, le tarif de {créateur} est de [Montant], droits et exclusivité inclus.\n\n" +
      "Nous pouvons ajuster selon le volume ou la durée de diffusion : dites-moi ce qui correspond à votre budget et je vous fais une proposition sur-mesure.\n\n" +
      "Bien à vous,\nTTP Agency",
  },
  {
    category: "Suivi",
    title: "Brief validé",
    body:
      "Bonjour {marque},\n\n" +
      "Bonne nouvelle : {créateur} a validé le brief 🎉 La production démarre.\n\n" +
      "Livraison prévue le [Date]. Je vous tiens informé(e) de l'avancement et reviens vers vous dès que les premiers contenus sont prêts pour relecture.\n\n" +
      "Merci de votre confiance,\nTTP Agency",
  },
  {
    category: "Suivi",
    title: "Rappel deadline",
    body:
      "Bonjour {marque},\n\n" +
      "Petit rappel amical : la livraison des contenus de {créateur} est prévue pour le [Date].\n\n" +
      "Il nous manque encore [élément manquant] de votre côté pour finaliser. Pourriez-vous nous le transmettre d'ici [Date] afin de tenir la deadline ?\n\n" +
      "Merci !\nTTP Agency",
  },
  {
    category: "Facturation",
    title: "Envoi de facture",
    body:
      "Bonjour {marque},\n\n" +
      "Comme convenu, vous trouverez ci-joint la facture #[Réf] pour la collaboration avec {créateur}, d'un montant de [Montant].\n\n" +
      "Le règlement est attendu sous [30] jours. N'hésitez pas si vous avez besoin d'un justificatif complémentaire.\n\n" +
      "Merci et à bientôt,\nTTP Agency",
  },
  {
    category: "Facturation",
    title: "Relance impayé",
    body:
      "Bonjour {marque},\n\n" +
      "Sauf erreur de notre part, la facture #[Réf] d'un montant de [Montant] (échéance le [Date]) reste en attente de règlement.\n\n" +
      "Pourriez-vous nous indiquer une date de paiement ? Je reste à disposition pour tout justificatif.\n\n" +
      "Merci d'avance,\nTTP Agency",
  },
];

export function Templates() {
  const { query } = useSearch();
  const { data: custom, loading } = useAppState<Template[]>(
    (s: AppState) => (s["customTemplates"] as Template[]) ?? [],
  );

  const [local, setLocal] = useState<Template[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORY_ORDER[0]);
  const [body, setBody] = useState("");

  // Filtres de vue locaux à la page (catégorie active + recherche locale).
  const [activeCategory, setActiveCategory] = useState<string>("Tous");
  const [localQuery, setLocalQuery] = useState("");
  // Vue des modèles (mémorisée) + aperçu plein texte (le corps est tronqué en carte).
  // Défaut = LISTE ; on ne retombe sur « cartes » que si c'est le choix explicite mémorisé.
  // localStorage protégé : peut lever (navigation privée, stockage bloqué).
  const [viewT, setViewT] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem("ttp:tpl-view") === "cards" ? "cards" : "list";
    } catch {
      return "list";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ttp:tpl-view", viewT);
    } catch {
      /* stockage indisponible : préférence non mémorisée */
    }
  }, [viewT]);
  const [preview, setPreview] = useState<Template | null>(null);

  // On repasse en mode « live » (local=null) dès que la donnée du blob change : ainsi les
  // ajouts faits par l'autre compte agence apparaissent, au lieu de rester gelés sur `local`.
  useEffect(() => {
    setLocal(null);
  }, [custom]);

  // custom du blob (live) + éventuel ajout local optimiste en attendant le prochain tick.
  const customList = local ?? custom ?? [];
  const all = [...DEFAULT_TEMPLATES, ...customList];

  // Catégories distinctes présentes dans l'ensemble des modèles (pour les chips).
  const allCategories = Array.from(new Set(all.map((t) => t.category))).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const lq = localQuery.trim().toLowerCase();
  const filtered = all.filter(
    (t) =>
      // recherche globale existante
      matchQuery(query, t.title, t.body, t.category) &&
      // filtre catégorie (chips)
      (activeCategory === "Tous" || t.category === activeCategory) &&
      // recherche locale par titre/contenu
      (lq === "" || t.title.toLowerCase().includes(lq) || t.body.toLowerCase().includes(lq)),
  );

  // Regroupement par catégorie, catégories connues d'abord.
  const categories = Array.from(new Set(filtered.map((t) => t.category))).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copié ✓");
    } catch {
      toast("Copie impossible");
    }
  }

  // Modèle perso en cours d'édition (null = création).
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setTitle("");
    setBody("");
    setCategory(CATEGORY_ORDER[0]);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setTitle(t.title);
    setBody(t.body);
    setCategory(t.category);
    setShowForm(true);
  };

  // Relecture fraîche du blob avant merge : ne jamais repartir d'un `customList` périmé
  // (écrasement d'un ajout concurrent) ni d'un état non encore chargé (clobber à froid).
  async function writeFresh(mutate: (fresh: Template[]) => Template[]): Promise<boolean> {
    try {
      invalidateAppState();
      const fresh = withIds(((await getAppState())["customTemplates"] as Template[]) ?? []);
      const next = mutate(fresh);
      setLocal(next);
      const ok = await saveAppStateKey("customTemplates", next);
      if (!ok) setLocal(null); // retour aux données live
      return ok;
    } catch {
      setLocal(null);
      return false;
    }
  }

  async function submit() {
    if (saving) return;
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      toast("Renseigne un titre et un message");
      return;
    }
    const cat = category.trim() || "Divers";
    const target = editing;
    setSaving(true);
    const ok = await writeFresh((fresh) =>
      target
        ? fresh.map((x) => (sameTpl(x, target) ? { ...x, category: cat, title: t, body: b } : x))
        : [{ id: newTplId(), category: cat, title: t, body: b }, ...fresh],
    );
    setSaving(false);
    if (!ok) {
      toast("Erreur, réessaie"); // formulaire conservé
      return;
    }
    closeForm();
    toast(target ? "Template modifié ✓" : "Template ajouté ✓");
  }

  async function removeTpl(t: Template) {
    const ok = await writeFresh((fresh) => fresh.filter((x) => !sameTpl(x, t)));
    toast(ok ? "Template supprimé" : "Erreur, réessaie");
  }

  // Menu Modifier / Supprimer, uniquement pour les modèles perso.
  const tplMenu = (t: Template) =>
    customList.includes(t) ? (
      <span onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          items={[
            { key: "edit", label: "Modifier", icon: Pencil, onClick: () => openEdit(t) },
            {
              key: "del",
              label: "Supprimer",
              icon: Trash2,
              danger: true,
              onClick: () => removeTpl(t),
              confirm: { title: "Supprimer le template", message: `Supprimer « ${t.title} » ? Cette action est irréversible.` },
            },
          ]}
        />
      </span>
    ) : null;

  return (
    <div>
      <PageHeaderRow>
        {!showForm && (
          <AddButton
            label="Template"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          />
        )}
      </PageHeaderRow>
      <p className="mb-4 text-sm text-muted-foreground">
        Bibliothèque de modèles réutilisables. Variables :{" "}
        <code className="rounded bg-rowhover px-1 py-0.5 text-xs text-foreground">{"{marque}"}</code>{" "}
        <code className="rounded bg-rowhover px-1 py-0.5 text-xs text-foreground">{"{créateur}"}</code>
      </p>

      <InlineForm
        open={showForm}
        title={editing ? "Modifier le template" : "Nouveau template"}
        submitLabel={editing ? "Enregistrer" : "Ajouter"}
        onClose={closeForm}
        onSubmit={submit}
      >
        <TextField label="Titre" value={title} onChange={setTitle} placeholder="Ex : Relance après devis" />
        <SelectField
          label="Catégorie"
          value={category}
          onChange={setCategory}
          options={Array.from(new Set([...CATEGORY_ORDER, category])).map((c) => ({ value: c, label: c }))}
        />
        <AutoGrowTextField
          label="Message"
          value={body}
          onChange={setBody}
          placeholder="Bonjour {marque}, …"
          minRows={5}
          className="min-w-full"
        />
      </InlineForm>

      {!loading && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            className="min-w-0"
            label="Filtrer par catégorie"
            wrap
            items={[{ value: "Tous", label: "Tous" }, ...allCategories.map((cat) => ({ value: cat, label: cat }))]}
            value={activeCategory}
            onValueChange={setActiveCategory}
          />
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Rechercher un template…"
              className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-faint outline-none transition-colors focus:border-primary"
            />
          </div>
          <Tabs
            className="shrink-0 self-start sm:self-auto"
            label="Affichage"
            items={[
              { value: "cards", label: "Cartes", icon: <LayoutGrid className="h-4 w-4" />, hideLabel: "mobile" },
              { value: "list", label: "Liste", icon: <ListIcon className="h-4 w-4" />, hideLabel: "mobile" },
            ]}
            value={viewT}
            onValueChange={(v) => setViewT(v as "cards" | "list")}
          />
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">
          {query.trim() || localQuery.trim() || activeCategory !== "Tous"
            ? "Aucun modèle ne correspond à votre recherche."
            : "Aucun modèle pour le moment."}
        </div>
      )}

      {!loading &&
        categories.map((cat) => {
          const items = filtered.filter((t) => t.category === cat);
          return (
            <section key={cat} className="mb-8">
              <div className="mb-3 flex items-center gap-2.5">
                <h2 className="text-sm font-semibold text-foreground">{cat}</h2>
                <span className="text-xs text-faint">
                  {items.length} {items.length > 1 ? "modèles" : "modèle"}
                </span>
              </div>
              {viewT === "cards" ? (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                  {items.map((t, i) => (
                    <article
                      key={cat + t.title + i}
                      className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              "shrink-0 rounded-full bg-rowhover px-2.5 py-1 text-[11px] font-medium",
                              CATEGORY_TONE[t.category] ?? "text-muted-foreground",
                            )}
                          >
                            {t.category}
                          </span>
                          {tplMenu(t)}
                        </div>
                      </div>
                      {/* Aperçu tronqué : le texte complet s'ouvre via « Voir ». */}
                      <p className="mt-2.5 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground line-clamp-5">
                        {t.body}
                      </p>
                      <div className="mt-3.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreview(t)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                        >
                          <Eye className="h-3.5 w-3.5" /> Voir
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(t.body)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-foreground py-2.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
                        >
                          <Copy className="h-3.5 w-3.5" /> Copier
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                  {items.map((t, i) => (
                    <div
                      key={cat + t.title + i}
                      onClick={() => setPreview(t)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover",
                        i > 0 && "border-t border-border",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-foreground">{t.title}</div>
                        <div className="mt-0.5 truncate text-[11px] text-faint">{t.body.replace(/\s+/g, " ")}</div>
                      </div>
                      <span
                        className={cn(
                          "hidden shrink-0 rounded-full bg-rowhover px-2.5 py-1 text-[11px] font-medium sm:inline",
                          CATEGORY_TONE[t.category] ?? "text-muted-foreground",
                        )}
                      >
                        {t.category}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copy(t.body);
                        }}
                        title="Copier"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-panel hover:text-foreground"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      {tplMenu(t)}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

      {/* Aperçu plein texte — le corps est tronqué dans les cartes/lignes. */}
      {preview && (
        <div
          className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="my-2 w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">{preview.title}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{preview.category}</div>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{preview.body}</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button
                type="button"
                onClick={() => copy(preview.body)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Copy className="h-3.5 w-3.5" /> Copier le message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

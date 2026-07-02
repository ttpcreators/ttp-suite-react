import { useState } from "react";
import { Copy, Search } from "lucide-react";
import { useSearch, matchQuery } from "@/lib/search";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { cn } from "@/lib/utils";

type Template = { category: string; title: string; body: string };

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

  // custom du blob (chargé une fois) + éventuels ajouts locaux de la session.
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

  async function submit() {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) return;
    const item: Template = { category: category.trim() || "Divers", title: t, body: b };
    const next = [item, ...customList];
    setLocal(next);
    setShowForm(false);
    setTitle("");
    setBody("");
    setCategory(CATEGORY_ORDER[0]);
    await saveAppStateKey("customTemplates", next);
    toast("Template ajouté ✓");
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Bibliothèque de modèles réutilisables. Variables :{" "}
          <code className="rounded bg-rowhover px-1 py-0.5 text-xs text-foreground">{"{marque}"}</code>{" "}
          <code className="rounded bg-rowhover px-1 py-0.5 text-xs text-foreground">{"{créateur}"}</code>
        </p>
        {!showForm && <AddButton label="Template" onClick={() => setShowForm(true)} />}
      </div>

      <InlineForm
        open={showForm}
        title="Nouveau template"
        onClose={() => setShowForm(false)}
        onSubmit={submit}
      >
        <TextField label="Titre" value={title} onChange={setTitle} placeholder="Ex : Relance après devis" />
        <SelectField
          label="Catégorie"
          value={category}
          onChange={setCategory}
          options={CATEGORY_ORDER.map((c) => ({ value: c, label: c }))}
        />
        <TextField
          label="Message"
          value={body}
          onChange={setBody}
          placeholder="Bonjour {marque}, …"
          className="min-w-full"
        />
      </InlineForm>

      {!loading && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveCategory("Tous")}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                activeCategory === "Tous"
                  ? "bg-primary text-primary-foreground"
                  : "bg-rowhover text-muted-foreground hover:text-foreground",
              )}
            >
              Tous
            </button>
            {allCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-rowhover text-muted-foreground hover:text-foreground",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
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
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                {items.map((t, i) => (
                  <article
                    key={cat + t.title + i}
                    className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
                      <span
                        className={cn(
                          "shrink-0 rounded-full bg-rowhover px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide",
                          CATEGORY_TONE[t.category] ?? "text-muted-foreground",
                        )}
                      >
                        {t.category}
                      </span>
                    </div>
                    <p className="mt-2.5 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground line-clamp-5">
                      {t.body}
                    </p>
                    <button
                      type="button"
                      onClick={() => copy(t.body)}
                      className="mt-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-foreground py-2.5 text-[10px] font-semibold uppercase tracking-wide text-background transition-opacity hover:opacity-90"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copier
                    </button>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}

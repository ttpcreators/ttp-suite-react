import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { parseAmount, formatEuro } from "@/lib/money";
import { useAppState, type AppState } from "@/lib/appState";
import { fmtCompact } from "@/lib/timeSeries";
import { useSearch, matchQuery } from "@/lib/search";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { Trash2, Check, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { PageHeaderRow } from "@/components/ui/page-header";

type CreatorRow = {
  id: string;
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  followers: string | null;
  er: string | null;
  ca: string | null;
  status: string | null;
  photo_url: string | null;
  sort_order: number | null;
  stats_month: string | null;
};

type Creator = {
  id: string;
  name: string;
  handle: string;
  niche: string;
  platform: string;
  followers: string;
  er: string;
  ca: string;
  status: string;
  photo: string;
  sort_order: number | null;
  statsMonth: string;
};

function mapCreator(r: CreatorRow): Creator {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle ?? "",
    niche: r.niche ?? "",
    platform: r.platform ?? "",
    followers: r.followers ?? "—",
    er: r.er ?? "—",
    ca: r.ca ?? "—",
    status: (r.status ?? "actif").toLowerCase(),
    photo: r.photo_url ?? "",
    sort_order: r.sort_order,
    statsMonth: r.stats_month ?? "",
  };
}

/** Mois courant "YYYY-MM" (fuseau local agence) + libellé "juillet 2026". */
const NOW_MONTH = new Intl.DateTimeFormat("fr-CA", { year: "numeric", month: "2-digit" }).format(new Date());
const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date());

const STATUS_LABEL: Record<string, string> = {
  live: "LIVE",
  actif: "ACTIF",
  pause: "PAUSE",
  inactif: "INACTIF",
};
/** Point de couleur du statut (remplace le badge « Actif » : vert = actif). */
const statusDot = (status: string): string =>
  status === "inactif" ? "bg-neutral-400" : status === "pause" ? "bg-amber" : status === "live" ? "bg-rose-500" : "bg-emerald-500";

export function Roster({ onOpen }: { onOpen?: (name: string) => void }) {
  const [rows, setRows] = useState<Creator[] | null>(() => getCache<Creator[]>("roster"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");

  useEffect(() => {
    supabase
      .from("creators")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else {
          const list = ((data as CreatorRow[]) ?? []).map(mapCreator);
          setCache("roster", list);
          setRows(list);
        }
      });
  }, [live]);

  // CA par créateur = somme de SES factures payées (auto, plus de saisie manuelle).
  const [caByCreator, setCaByCreator] = useState<Record<string, number>>(() => getCache<Record<string, number>>("rosterCA") ?? {});
  useEffect(() => {
    supabase.from("invoices").select("amount,status,creator").eq("status", "payee").then(({ data }) => {
      const m: Record<string, number> = {};
      for (const iv of (data as { amount: string | null; creator: string | null }[]) ?? []) {
        const c = (iv.creator ?? "").trim();
        if (!c) continue;
        m[c] = (m[c] ?? 0) + parseAmount(iv.amount);
      }
      setCache("rosterCA", m);
      setCaByCreator(m);
    });
  }, [live]);

  // Abonnés CUMULÉS par créateur = somme du DERNIER relevé de chaque plateforme
  // (mesures d'engagement, blob `engagementHistory`). Clé = nom en minuscules.
  const { data: engHist } = useAppState<{ creator?: string; platform?: string; followers?: string; date?: string }[]>(
    (s: AppState) => (s["engagementHistory"] as { creator?: string; platform?: string; followers?: string; date?: string }[]) ?? [],
  );
  const cumFollowers = useMemo(() => {
    const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
    const ts = (d?: string) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d ?? ""); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; };
    const byCreator = new Map<string, { platform?: string; followers?: string; date?: string }[]>();
    for (const h of engHist ?? []) {
      const k = (h.creator ?? "").trim().toLowerCase();
      if (!k) continue;
      const arr = byCreator.get(k) ?? [];
      arr.push(h);
      byCreator.set(k, arr);
    }
    const out: Record<string, number> = {};
    for (const [k, list] of byCreator) {
      const ordered = [...list].sort((a, b) => ts(b.date) - ts(a.date));
      const seen = new Set<string>();
      let sum = 0;
      for (const h of ordered) {
        const pf = (h.platform ?? "").toLowerCase();
        if (!pf || seen.has(pf)) continue;
        seen.add(pf);
        sum += num(h.followers);
      }
      if (sum > 0) out[k] = sum;
    }
    return out;
  }, [engHist]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Impossible de charger le roster.
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">
          Chargement du roster…
        </AnimatedBadge>
      </div>
    );
  }

  const submit = async () => {
    if (!name.trim()) {
      toast("Renseigne le nom du créateur");
      return;
    }
    const row = {
      name: name.trim(),
      handle: handle.trim() || null,
      niche: niche.trim() || null,
      sort_order: nextOrder(rows),
    };
    const created = await dbInsert("creators", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([mapCreator(created as unknown as CreatorRow), ...rows]);
    toast("Créateur ajouté ✓");
    setFormOpen(false);
    setName("");
    setHandle("");
    setNiche("");
  };

  // Marque (ou annule) « données à jour ce mois » pour un créateur.
  const markUpToDate = async (c: Creator, done: boolean) => {
    const next = done ? NOW_MONTH : "";
    setRows(rows.map((r) => (r.id === c.id ? { ...r, statsMonth: next } : r)));
    // Requête directe (pas dbUpdate) pour lire le message d'erreur : on ne parle du SQL
    // manquant QUE si l'erreur concerne vraiment la colonne.
    const { data, error } = await supabase.from("creators").update({ stats_month: next || null }).eq("id", c.id).select("id");
    if (error || !data?.length) {
      setRows(rows); // rollback optimiste
      const missingCol = !!error && (error.code === "42703" || error.code === "PGRST204" || /stats_month/i.test(error.message));
      toast(missingCol ? "Enregistrement impossible : la colonne « stats_month » manque (lance le SQL 11)" : "Enregistrement impossible, réessaie");
      return;
    }
    toast(done ? `${titleCase(c.name)} · données à jour ✓` : "Marqué à mettre à jour");
  };

  // Réordonner (flèches ↑↓) — l'ordre `creators.sort_order` pilote le Roster,
  // le media kit AGENCE et le site vitrine (vue public_roster triée par sort_order).
  const move = async (id: string, dir: "up" | "down") => {
    const full = [...rows];
    const i = full.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= full.length) return;
    [full[i], full[j]] = [full[j], full[i]];
    // Réindexe 0..n-1 (ordre propre, sans collision) puis persiste ce qui a changé.
    const prev = new Map(rows.map((r) => [r.id, r.sort_order]));
    const reindexed = full.map((r, idx) => ({ ...r, sort_order: idx }));
    setRows(reindexed);
    setCache("roster", reindexed);
    const changed = reindexed.filter((r) => prev.get(r.id) !== r.sort_order);
    const oks = await Promise.all(changed.map((r) => dbUpdate("creators", r.id, { sort_order: r.sort_order })));
    if (oks.some((ok) => !ok)) {
      setRows(rows); // rollback optimiste
      setCache("roster", rows);
      toast("Ordre non enregistré — réessaie");
    }
  };

  const filtered = rows.filter((c) =>
    matchQuery(query, c.name, c.handle, c.niche, c.platform),
  );

  // Créateurs actifs pas encore à jour pour le mois courant (pour la bannière).
  const staleCount = rows.filter(
    (c) => c.status !== "inactif" && c.statsMonth !== NOW_MONTH,
  ).length;

  // Chiffres clés du roster (bandeau façon Aperçu).
  const numOf = (v: string | null | undefined): number => {
    const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".").toUpperCase();
    const m = /^([0-9.]+)([KM]?)/.exec(t);
    if (!m) return 0;
    const n = parseFloat(m[1]) || 0;
    return m[2] === "K" ? n * 1e3 : m[2] === "M" ? n * 1e6 : n;
  };
  const actives = rows.filter((c) => c.status !== "inactif");
  const followersOf = (c: Creator) => cumFollowers[c.name.trim().toLowerCase()] || numOf(c.followers);
  const totalFollowers = actives.reduce((a, c) => a + followersOf(c), 0);
  const ers = actives.map((c) => numOf(c.er)).filter((n) => n > 0);
  const avgEr = ers.length ? ers.reduce((a, n) => a + n, 0) / ers.length : 0;
  const totalCa = Object.values(caByCreator).reduce((a, n) => a + n, 0);
  const kpis = [
    { label: "Créatrices actives", value: String(actives.length), foot: `sur ${rows.length} au roster` },
    { label: "Abonnés cumulés", value: totalFollowers ? fmtCompact(totalFollowers) : "—", foot: "tous réseaux, créatrices actives" },
    { label: "Engagement moyen", value: avgEr ? `${avgEr.toFixed(2).replace(".", ",")} %` : "—", foot: `sur ${ers.length} mesure${ers.length > 1 ? "s" : ""}` },
    { label: "CA encaissé", value: formatEuro(totalCa), foot: "factures payées" },
  ];

  // Dernière piste FIXE (72px) et non `auto` : sinon l'en-tête (col vide) et les
  // lignes (flèches + menu ≈ 64px) répartissent différemment l'espace fr → décalage.
  const cols =
    "grid-cols-[2.4fr_1fr_0.9fr_0.8fr_1.1fr_0.9fr_72px] gap-3";

  return (
    <>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {rows.length} créateur{rows.length > 1 ? "s" : ""} représenté
          {rows.length > 1 ? "s" : ""}
        </div>
        <AddButton label="Créateur" onClick={() => setFormOpen(true)} />
      </PageHeaderRow>

      {/* Chiffres clés (bandeau à filets, comme l'Aperçu) */}
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5 sm:py-5">
              <span className="text-[12px] text-muted-foreground sm:text-[13px]">{k.label}</span>
              <span className="mt-2 truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]">{k.value}</span>
              <span className="mt-3 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{k.foot}</span>
            </div>
          ))}
        </div>
      )}

      {staleCount > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-border bg-surface px-5 py-3.5 text-[13px] text-muted-foreground">
          <RefreshCw className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold text-foreground">{staleCount} créateur{staleCount > 1 ? "s" : ""}</span> à mettre à jour pour <span className="font-semibold capitalize">{MONTH_LABEL}</span> — coche « à jour » sur chaque ligne une fois les données saisies.
          </span>
        </div>
      )}

      <InlineForm
        open={formOpen}
        title="Nouveau créateur"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Nom" value={name} onChange={setName} />
        <TextField
          label="Handle"
          value={handle}
          onChange={setHandle}
          placeholder="@pseudo"
        />
        <TextField label="Niche" value={niche} onChange={setNiche} />
      </InlineForm>

      {query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {/* En-tête de tableau (desktop) */}
          <div
            className={cn(
              "hidden items-center border-b border-border px-5 py-3 text-[12px] text-muted-foreground md:grid",
              cols,
            )}
          >
            <span>Créateur</span>
            <span>Niche</span>
            <span className="text-right">Abonnés</span>
            <span className="text-right">ER</span>
            <span className="text-right">CA · encaissé</span>
            <span className="text-right">Statut</span>
            <span />
          </div>

          <div className="divide-y divide-border">
          {filtered.map((c) => {
            const label = STATUS_LABEL[c.status] ?? "ACTIF";
            const dot = statusDot(c.status);
            return (
              <div
                key={c.id}
                onClick={() => onOpen?.(c.name)}
                className={cn(
                  "cursor-pointer px-4 py-3 transition-colors hover:bg-rowhover sm:px-5",
                  "flex items-center gap-3 md:grid",
                  cols,
                )}
              >
                {/* Créateur : avatar carré + nom titleCase + @handle */}
                <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
                  <CreatorAvatar
                    name={c.name}
                    photoUrl={c.photo}
                    className="h-10 w-10 shrink-0 rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {titleCase(c.name)}
                    </div>
                    <div className="truncate text-xs text-faint">
                      {c.handle}
                      {c.niche && <span className="md:hidden"> · {c.niche}</span>}
                    </div>
                  </div>
                </div>

                {/* Niche : texte sur desktop (sur mobile, affichée sous le nom) */}
                <span className="hidden truncate text-[13px] text-muted-foreground md:inline">
                  {c.niche}
                </span>

                {/* Abonnés (cumul tous réseaux depuis les mesures ; repli = valeur fiche) / ER / CA — masqués sur mobile */}
                <span className="hidden text-right text-[13px] font-medium tabular-nums text-foreground md:inline">
                  {followersOf(c) > 0 ? fmtCompact(followersOf(c)) : c.followers}
                </span>
                <span className="hidden text-right text-[13px] font-medium tabular-nums text-foreground md:inline">
                  {c.er}
                </span>
                <span className="hidden text-right text-[13px] font-medium tabular-nums text-foreground md:inline">
                  {caByCreator[c.name] ? formatEuro(caByCreator[c.name]) : "—"}
                </span>

                {/* Bloc droit mobile : à jour + statut (point de couleur) */}
                <div className="flex shrink-0 items-center gap-2 md:contents">
                  <div className="flex items-center justify-end gap-2 md:col-start-6">
                    {c.status !== "inactif" &&
                      (c.statsMonth === NOW_MONTH ? (
                        <button
                          type="button"
                          title={`Données à jour · ${MONTH_LABEL} (clique pour annuler)`}
                          onClick={(e) => { e.stopPropagation(); markUpToDate(c, false); }}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title={`Marquer les données à jour · ${MONTH_LABEL}`}
                          onClick={(e) => { e.stopPropagation(); markUpToDate(c, true); }}
                          className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-foreground/[0.06] px-2 py-1 text-[10px] font-semibold text-amber transition-colors hover:bg-foreground/[0.06] dark:text-amber"
                        >
                          <RefreshCw className="h-3 w-3" /><span className="hidden sm:inline"> à jour ?</span>
                        </button>
                      ))}
                    <span className="flex items-center gap-1.5" title={titleCase(label.toLowerCase())}>
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
                      <span className="hidden text-xs font-medium text-muted-foreground md:inline">{titleCase(label.toLowerCase())}</span>
                    </span>
                  </div>
                </div>

                {/* Réordonner (↑↓) + action supprimer */}
                <div className="flex shrink-0 items-center justify-end gap-1 md:col-start-7">
                  {!query.trim() && (() => {
                    const idx = rows.findIndex((r) => r.id === c.id);
                    return (
                      <div className="hidden flex-col sm:flex" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={idx <= 0}
                          onClick={() => move(c.id, "up")}
                          title="Monter"
                          aria-label="Monter"
                          className="grid h-4 w-6 place-items-center rounded text-faint transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
                        >
                          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2.25} />
                        </button>
                        <button
                          type="button"
                          disabled={idx >= rows.length - 1}
                          onClick={() => move(c.id, "down")}
                          title="Descendre"
                          aria-label="Descendre"
                          className="grid h-4 w-6 place-items-center rounded text-faint transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
                        >
                          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.25} />
                        </button>
                      </div>
                    );
                  })()}
                  <ActionMenu
                    items={[
                      {
                        key: "delete",
                        label: "Supprimer",
                        icon: Trash2,
                        danger: true,
                        onClick: async () => {
                          if (await dbTrash("creators", c.id, titleCase(c.name), c.handle || undefined)) {
                            setRows(rows.filter((r) => r.id !== c.id));
                            toast("Déplacé dans la corbeille");
                          }
                        },
                        confirm: { title: "Supprimer le créateur", message: `Supprimer « ${titleCase(c.name)} » du roster ? Tu pourras le restaurer depuis la corbeille.` },
                      },
                    ]}
                  />
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </>
  );
}

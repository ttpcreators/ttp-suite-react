import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { parseAmount, formatEuro } from "@/lib/money";
import { useSearch, matchQuery } from "@/lib/search";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { Trash2, Check, RefreshCw } from "lucide-react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

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
};

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
    const ok = await dbUpdate("creators", c.id, { stats_month: next || null });
    if (!ok) {
      setRows(rows); // rollback optimiste
      toast("Erreur — réessaie");
      return;
    }
    toast(done ? `${titleCase(c.name)} · données à jour ✓` : "Marqué à mettre à jour");
  };

  const filtered = rows.filter((c) =>
    matchQuery(query, c.name, c.handle, c.niche, c.platform),
  );

  // Créateurs actifs pas encore à jour pour le mois courant (pour la bannière).
  const staleCount = rows.filter(
    (c) => c.status !== "inactif" && c.statsMonth !== NOW_MONTH,
  ).length;

  const cols =
    "grid-cols-[2.4fr_1fr_0.9fr_0.8fr_1.1fr_0.9fr_auto] gap-3";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows.length} créateur{rows.length > 1 ? "s" : ""} représenté
          {rows.length > 1 ? "s" : ""}
        </div>
        <AddButton label="Créateur" onClick={() => setFormOpen(true)} />
      </div>

      {staleCount > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
          <RefreshCw className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{staleCount} créateur{staleCount > 1 ? "s" : ""}</span> à mettre à jour pour <span className="font-semibold capitalize">{MONTH_LABEL}</span> — coche « à jour » sur chaque ligne une fois les données saisies.
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
        <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          {/* En-tête de tableau (desktop) */}
          <div
            className={cn(
              "hidden items-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-faint md:grid",
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

          {filtered.map((c) => {
            const label = STATUS_LABEL[c.status] ?? "ACTIF";
            const badgeStatus =
              c.status === "live"
                ? "danger"
                : c.status === "pause"
                  ? "warning"
                  : "success";
            return (
              <div
                key={c.id}
                onClick={() => onOpen?.(c.name)}
                className={cn(
                  "cursor-pointer rounded-xl px-4 py-2.5 transition-colors hover:bg-rowhover",
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
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {titleCase(c.name)}
                    </div>
                    <div className="truncate text-xs text-faint">
                      {c.handle}
                    </div>
                  </div>
                </div>

                {/* Niche : pastille sur mobile, texte sur desktop */}
                <span className="hidden truncate text-xs text-muted-foreground md:inline">
                  {c.niche}
                </span>

                {/* Abonnés / ER / CA — masqués sur mobile */}
                <span className="hidden text-right text-xs font-semibold text-foreground md:inline">
                  {c.followers}
                </span>
                <span className="hidden text-right text-xs font-semibold text-foreground md:inline">
                  {c.er}
                </span>
                <span className="hidden text-right text-xs font-semibold text-foreground md:inline">
                  {caByCreator[c.name] ? formatEuro(caByCreator[c.name]) : "—"}
                </span>

                {/* Bloc droit mobile : niche + statut */}
                <div className="flex shrink-0 items-center gap-2 md:contents">
                  {c.niche && (
                    <span className="rounded-md bg-surface px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground md:hidden">
                      {c.niche}
                    </span>
                  )}
                  <div className="flex items-center justify-end gap-1.5 md:col-start-6">
                    {c.status !== "inactif" &&
                      (c.statsMonth === NOW_MONTH ? (
                        <button
                          type="button"
                          title={`Données à jour · ${MONTH_LABEL} (clique pour annuler)`}
                          onClick={(e) => { e.stopPropagation(); markUpToDate(c, false); }}
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title={`Marquer les données à jour · ${MONTH_LABEL}`}
                          onClick={(e) => { e.stopPropagation(); markUpToDate(c, true); }}
                          className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
                        >
                          <RefreshCw className="h-3 w-3" /> à jour ?
                        </button>
                      ))}
                    <AnimatedBadge status={badgeStatus} size="sm">
                      {titleCase(label.toLowerCase())}
                    </AnimatedBadge>
                  </div>
                </div>

                {/* Action supprimer */}
                <div className="flex shrink-0 items-center justify-end md:col-start-7">
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
      )}
    </>
  );
}

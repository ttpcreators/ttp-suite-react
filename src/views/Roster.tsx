import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { Trash2 } from "lucide-react";
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
  };
}

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

  const filtered = rows.filter((c) =>
    matchQuery(query, c.name, c.handle, c.niche, c.platform),
  );

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
            <span className="text-right">CA · Mois</span>
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
                  {c.ca}
                </span>

                {/* Bloc droit mobile : niche + statut */}
                <div className="flex shrink-0 items-center gap-2 md:contents">
                  {c.niche && (
                    <span className="rounded-md bg-surface px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground md:hidden">
                      {c.niche}
                    </span>
                  )}
                  <div className="flex items-center justify-end md:col-start-6">
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
                          if (await dbDelete("creators", c.id)) {
                            setRows(rows.filter((r) => r.id !== c.id));
                            toast("Supprimé");
                          }
                        },
                        confirm: { title: "Supprimer le créateur", message: `Supprimer « ${titleCase(c.name)} » du roster ? Cette action est irréversible.` },
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

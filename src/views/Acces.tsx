import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { initials, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { useAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

type AccessAccount = {
  email: string;
  pwd: string;
  role: "creator" | "agency";
  creator?: string;
  cloud?: string;
};

function cloudBadge(cloud: string | undefined) {
  if (cloud === "ok")
    return { status: "success" as const, label: "Actif" };
  if (cloud === "pending")
    return { status: "warning" as const, label: "En attente" };
  return { status: "neutral" as const, label: "Cloud" };
}

function AccountRow({ a }: { a: AccessAccount }) {
  const [shown, setShown] = useState(false);
  const avatarSource =
    a.role === "creator" && a.creator ? titleCase(a.creator) : a.email;
  const subtitle =
    a.role === "creator"
      ? "Créateur"
      : `Agence / Équipe${a.creator ? ` · ${titleCase(a.creator)}` : ""}`;
  const cloud = a.cloud ? cloudBadge(a.cloud) : null;

  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-rowhover">
      {/* Avatar : initiales du créateur ou de l'email */}
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-xs font-semibold text-muted-foreground">
        {initials(avatarSource)}
      </div>

      {/* Email + sous-titre rôle */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {a.email}
        </div>
        <div className="truncate text-xs text-faint">{subtitle}</div>
      </div>

      {/* Chip de statut cloud si présent */}
      {cloud && (
        <div className="hidden shrink-0 sm:block">
          <AnimatedBadge status={cloud.status} size="sm">
            {cloud.label}
          </AnimatedBadge>
        </div>
      )}

      {/* Mot de passe masqué + bouton œil */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="min-w-[7ch] text-right font-mono text-xs tracking-wide text-muted-foreground">
          {shown ? a.pwd : "••••••"}
        </span>
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={
            shown ? "Masquer le mot de passe" : "Révéler le mot de passe"
          }
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          {shown ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

export function Acces() {
  const { data: accounts, loading } = useAppState<AccessAccount[]>(
    (s: AppState) => (s["accessAccounts"] as AccessAccount[]) ?? [],
  );
  const { query } = useSearch();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">
          Chargement des accès…
        </AnimatedBadge>
      </div>
    );
  }

  const rows = accounts ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
        Aucun accès créateur configuré.
      </div>
    );
  }

  const filtered = rows.filter((a) =>
    matchQuery(query, a.email, a.creator),
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows.length} accès
        </div>
      </div>

      {query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          {filtered.map((a, i) => (
            <AccountRow key={`${a.email}-${i}`} a={a} />
          ))}
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { Eye, EyeOff, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { initials, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";

type AccessAccount = {
  email: string;
  pwd: string;
  role: "creator" | "agency";
  creator?: string;
  cloud?: string;
};

function cloudBadge(cloud: string | undefined) {
  if (cloud === "ok") return { status: "success" as const, label: "Actif" };
  if (cloud === "pending") return { status: "warning" as const, label: "En attente" };
  return { status: "neutral" as const, label: "Cloud" };
}

/** Mot de passe lisible mais solide (à communiquer au créateur). */
function genPwd(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = "abcdefghijkmnpqrstuvwxyz";
  const n = "23456789";
  const pick = (s: string, k: number) => Array.from({ length: k }, () => s[Math.floor(Math.random() * s.length)]).join("");
  return `${pick(a, 2)}${pick(b, 4)}${pick(n, 3)}!`;
}

function AccountRow({ a, onDelete }: { a: AccessAccount; onDelete: (a: AccessAccount) => void }) {
  const [shown, setShown] = useState(false);
  const avatarSource = a.role === "creator" && a.creator ? titleCase(a.creator) : a.email;
  const subtitle =
    a.role === "creator" ? "Créateur" : `Agence / Équipe${a.creator ? ` · ${titleCase(a.creator)}` : ""}`;
  const cloud = a.cloud ? cloudBadge(a.cloud) : null;

  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-rowhover">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-xs font-semibold text-muted-foreground">
        {initials(avatarSource)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{a.email}</div>
        <div className="truncate text-xs text-faint">{subtitle}</div>
      </div>

      {cloud && (
        <div className="hidden shrink-0 sm:block">
          <AnimatedBadge status={cloud.status} size="sm">
            {cloud.label}
          </AnimatedBadge>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <span className="min-w-[7ch] text-right font-mono text-xs tracking-wide text-muted-foreground">
          {shown ? a.pwd : "••••••"}
        </span>
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Masquer le mot de passe" : "Révéler le mot de passe"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <ActionMenu
          items={[
            {
              key: "copy",
              label: "Copier le mot de passe",
              icon: RefreshCw,
              onClick: () => {
                navigator.clipboard?.writeText(a.pwd);
                toast("Mot de passe copié ✓");
              },
            },
            {
              key: "del",
              label: "Retirer de la liste",
              icon: Trash2,
              danger: true,
              onClick: () => onDelete(a),
              confirm: {
                title: "Retirer l'accès",
                message: `Retirer ${a.email} de cette liste ? (Le compte de connexion, lui, n'est pas supprimé.)`,
                confirmLabel: "Retirer",
              },
            },
          ]}
        />
      </div>
    </div>
  );
}

export function Acces() {
  const { data: accounts, loading, error } = useAppState<AccessAccount[]>(
    (s: AppState) => (s["accessAccounts"] as AccessAccount[]) ?? [],
  );
  const { query } = useSearch();
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState(genPwd());
  const [role, setRole] = useState<"creator" | "agency">("creator");
  const [creatorName, setCreatorName] = useState("");
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setEmail("");
    setPwd(genPwd());
    setRole("creator");
    setCreatorName("");
  };

  const submit = async () => {
    if (busy) return;
    const mail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      toast("Email invalide");
      return;
    }
    if (pwd.length < 6) {
      toast("Mot de passe trop court (6 caractères min)");
      return;
    }
    if (role === "creator" && !creatorName) {
      toast("Choisis le créateur");
      return;
    }
    setBusy(true);
    try {
      // 1) Crée le VRAI compte de connexion (fonction serveur, clé admin).
      const { data, error: fnErr } = await supabase.functions.invoke("create-access", {
        body: { email: mail, password: pwd, role, creator: role === "creator" ? creatorName : "" },
      });
      // supabase-js met le corps JSON des réponses non-2xx dans error.context, pas data.
      let res = data as { ok?: boolean; error?: string } | null;
      if (fnErr && (fnErr as { context?: { json?: () => Promise<unknown> } }).context?.json)
        res = (await (fnErr as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as typeof res;
      if (fnErr || !res?.ok) {
        const map: Record<string, string> = {
          email_deja_utilise: "Cet email a déjà un compte",
          email_invalide: "Email invalide",
          mot_de_passe_trop_court: "Mot de passe trop court",
          createur_requis: "Choisis le créateur",
          unauthorized: "Action réservée à l'agence",
        };
        toast(map[res?.error ?? ""] ?? "Création du compte échouée — réessaie");
        return;
      }
      // 2) Ajoute la fiche à la liste (blob agence, relu FRAIS avant fusion).
      invalidateAppState();
      const fresh = ((await getAppState())["accessAccounts"] as AccessAccount[]) ?? [];
      const entry: AccessAccount = {
        email: mail,
        pwd,
        role,
        creator: role === "creator" ? creatorName : undefined,
        cloud: "ok",
      };
      const next = [entry, ...fresh.filter((a) => a.email.toLowerCase() !== mail)];
      const ok = await saveAppStateKey("accessAccounts", next);
      if (!ok) {
        toast("Compte créé, mais liste non enregistrée — réessaie");
        return;
      }
      toast("Accès créé ✓ — le créateur peut se connecter");
      setFormOpen(false);
      resetForm();
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (a: AccessAccount) => {
    invalidateAppState();
    const fresh = ((await getAppState())["accessAccounts"] as AccessAccount[]) ?? [];
    const next = fresh.filter((x) => x.email.toLowerCase() !== a.email.toLowerCase());
    const ok = await saveAppStateKey("accessAccounts", next);
    toast(ok ? "Accès retiré de la liste" : "Erreur — réessaie");
  };

  const rows = accounts ?? [];
  const filtered = rows.filter((a) => matchQuery(query, a.email, a.creator));

  const form = (
    <InlineForm open={formOpen} title="Nouvel accès" onClose={() => setFormOpen(false)} onSubmit={submit}>
      <TextField label="Email" value={email} onChange={setEmail} placeholder="prenom@exemple.com" />
      <div className="flex items-end gap-2">
        <TextField label="Mot de passe" value={pwd} onChange={setPwd} />
        <button
          type="button"
          onClick={() => setPwd(genPwd())}
          title="Générer un mot de passe"
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <SelectField
        label="Rôle"
        value={role}
        onChange={(v) => setRole(v as "creator" | "agency")}
        options={[
          { value: "creator", label: "Créateur" },
          { value: "agency", label: "Agence / Équipe" },
        ]}
      />
      {role === "creator" && (
        <SelectField
          label="Créateur"
          value={creatorName}
          onChange={setCreatorName}
          options={[
            { value: "", label: "— Choisir —" },
            ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) })),
          ]}
        />
      )}
    </InlineForm>
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {loading ? "Chargement…" : `${rows.length} accès`}
        </div>
        <AddButton label="Accès" onClick={() => setFormOpen(true)} />
      </div>

      {form}

      {error ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
          Impossible de charger les accès. Réessaie plus tard.
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AnimatedBadge status="loading" size="sm">
            Chargement des accès…
          </AnimatedBadge>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          Aucun accès pour le moment. Clique sur « + Accès » pour créer le premier compte créateur.
        </div>
      ) : query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Aucun résultat pour « {query} »</div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          {filtered.map((a, i) => (
            <AccountRow key={`${a.email}-${i}`} a={a} onDelete={removeAccount} />
          ))}
        </div>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Trash2, RefreshCw, Copy, X, Crown, KeyRound, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useNavSub, useSetNavSub } from "@/lib/navSub";
import { CredentialVault } from "@/views/CredentialVault";
import { useSearch, matchQuery } from "@/lib/search";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { AgencyAvatar } from "@/components/ui/agency-avatar";
import { guessName, saveAgencyName } from "@/lib/team";

type AccessAccount = {
  email: string;
  /** ANCIEN champ (mot de passe en clair) : n'est plus jamais écrit, retiré à chaque sauvegarde. */
  pwd?: string;
  role: "creator" | "agency";
  /** Niveau agence : 'founder' (accès total) | 'member' (tout sauf Finance & Accès). */
  level?: "founder" | "member";
  creator?: string;
  cloud?: string;
};

type AgencyAccount = { user_id: string; email: string; agency_role: string; display_name: string | null; last_sign_in_at: string | null };

/** Bouton visible « Nouveau mot de passe » d'un compte (fondateurs), avec confirmation. */
function ResetPasswordButton({ email, onReset }: { email: string; onReset: (email: string) => void }) {
  const [ask, setAsk] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAsk(true)}
        title={`Nouveau mot de passe pour ${email}`}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover"
      >
        <KeyRound className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Nouveau mot de passe</span>
      </button>
      {ask && (
        <ConfirmDialog
          title="Nouveau mot de passe"
          message={`Créer un nouveau mot de passe pour ${email} ? L'ancien ne marchera plus : tu verras le nouveau une seule fois, pour le transmettre.`}
          confirmLabel="Créer"
          onConfirm={() => {
            setAsk(false);
            onReset(email);
          }}
          onCancel={() => setAsk(false)}
        />
      )}
    </>
  );
}

/** Nom + photo d'un compte agence, modifiables par un fondateur. */
function AgencyAccountEditor({ a, onSaved, onClose }: { a: AgencyAccount; onSaved: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(a.display_name ?? guessName(a.email));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    const n = name.trim();
    if (!n) {
      toast("Écris un nom");
      return;
    }
    setSaving(true);
    const r = await saveAgencyName(a.user_id, n);
    setSaving(false);
    if (r === "sql") return toast("Lance d'abord le SQL « nom fondateur » dans Supabase.");
    if (r === "erreur") return toast("Nom non enregistré, réessaie");
    onSaved(n);
    toast("Nom enregistré ✓");
  };
  return (
    <div className="flex flex-col gap-3 bg-muted/40 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3">
        <AgencyAvatar userId={a.user_id} className="h-14 w-14" rounded="rounded-full" />
        <span className="max-w-[9rem] text-[11px] leading-snug text-muted-foreground">Clique sur la photo pour la changer.</span>
      </div>
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">Nom affiché</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Prénom"
          className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
        />
      </label>
      <div className="flex shrink-0 justify-end gap-2 sm:self-end">
        <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground">Fermer</button>
        <button type="button" onClick={() => void save()} disabled={saving}
          className="h-9 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
          Enregistrer
        </button>
      </div>
    </div>
  );
}

/**
 * Comptes AGENCE réels, lus dans la base (fonction agency_accounts, fondateurs
 * seulement) : qui est propriétaire (fondateur) et qui est membre. Un fondateur peut
 * changer le nom et la photo de chacun (« Modifier »). Masqué tant que le SQL
 * « équipe, activité, routines » n'est pas lancé.
 */
function AgencyAccountsPanel({ onReset }: { onReset: (email: string) => void }) {
  const [list, setList] = useState<AgencyAccount[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    void supabase.rpc("agency_accounts").then(({ data, error }) => setList(error ? null : ((data ?? []) as AgencyAccount[])));
  }, []);
  if (!list?.length) return null;
  const when = (iso: string | null) =>
    iso ? `connecté le ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}` : "jamais connecté";
  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Crown className="h-4 w-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold text-foreground">Comptes de l'agence</span>
        <span className="text-[12px] text-faint">· tels qu'enregistrés dans la base</span>
      </div>
      <ul className="divide-y divide-border">
        {list.map((a) => (
          <li key={a.user_id}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <AgencyAvatar userId={a.user_id} readOnly className="h-9 w-9" rounded="rounded-full" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold text-foreground">{a.display_name || guessName(a.email)}</span>
                <span className="truncate text-[12px] text-muted-foreground">{a.email}</span>
              </span>
              <span className="text-[11px] text-faint max-sm:hidden">{when(a.last_sign_in_at)}</span>
              <AnimatedBadge status={a.agency_role === "founder" ? "success" : "neutral"} size="sm">
                {a.agency_role === "founder" ? "Propriétaire" : "Membre"}
              </AnimatedBadge>
              <button
                type="button"
                onClick={() => setEditing((e) => (e === a.user_id ? null : a.user_id))}
                aria-expanded={editing === a.user_id}
                title="Changer le nom et la photo"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover"
              >
                <Pencil className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Modifier</span>
              </button>
              <ResetPasswordButton email={a.email} onReset={onReset} />
            </div>
            {editing === a.user_id && (
              <AgencyAccountEditor
                a={a}
                onClose={() => setEditing(null)}
                onSaved={(n) => {
                  setList((l) => l?.map((x) => (x.user_id === a.user_id ? { ...x, display_name: n } : x)) ?? l);
                  setEditing(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const pick = (s: string, k: number) => Array.from(crypto.getRandomValues(new Uint32Array(k)), (x) => s[x % s.length]).join("");
  return `${pick(a, 2)}${pick(b, 4)}${pick(n, 3)}!`;
}

/** Retire tout mot de passe en clair avant d'écrire la liste. */
function stripPwd(list: AccessAccount[]): AccessAccount[] {
  return list.map((a) => {
    const copy = { ...a };
    delete copy.pwd;
    return copy;
  });
}

function AccountRow({ a, onDelete, onReset, photoUrl }: { a: AccessAccount; onDelete: (a: AccessAccount) => void; onReset: (email: string) => void; photoUrl?: string | null }) {
  const avatarSource = a.role === "creator" && a.creator ? titleCase(a.creator) : a.email;
  const subtitle =
    a.role === "creator"
      ? "Créateur"
      : a.level === "founder"
        ? "Agence · Fondateur"
        : a.level === "member"
          ? "Agence · Membre"
          : "Agence / Équipe";
  const cloud = a.cloud ? cloudBadge(a.cloud) : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover">
      <CreatorAvatar name={avatarSource} photoUrl={photoUrl ?? null} className="h-10 w-10 shrink-0 rounded-xl" />

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
        {/* Mot de passe jamais stocké : montré une seule fois (création ou « Nouveau mot de passe »). */}
        <ResetPasswordButton email={a.email} onReset={onReset} />
        <ActionMenu
          items={[
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

  // Sous-page (nav 3e niveau) : « Comptes app » (défaut) ou « E-mails créateurs » (coffre).
  const navSub = useNavSub();
  const setNavSub = useSetNavSub(); // remonte le choix à la sidebar
  const [section, setSection] = useState<"comptes" | "emails">("comptes");
  useEffect(() => {
    if (navSub === "comptes" || navSub === "emails") setSection(navSub);
  }, [navSub]);

  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState(genPwd());
  const [role, setRole] = useState<"creator" | "agency">("creator");
  const [agencyLevel, setAgencyLevel] = useState<"founder" | "member">("member");
  const [creatorName, setCreatorName] = useState("");
  const [busy, setBusy] = useState(false);
  // Override local (comme Échéances) : la liste se met à jour tout de suite après
  // création / retrait, puis le live reprend dès que la donnée du blob change.
  const [local, setLocal] = useState<AccessAccount[] | null>(null);
  useEffect(() => {
    setLocal(null);
  }, [accounts]);
  // Identifiants à montrer UNE fois après création ou « Nouveau mot de passe » (jamais persistés).
  const [created, setCreated] = useState<{ email: string; pwd: string; reset?: boolean } | null>(null);
  const createdRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (created) createdRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [created]);
  // Compte créé mais liste non enregistrée : on peut réessayer sans recréer le compte.
  const [pendingEntry, setPendingEntry] = useState<AccessAccount | null>(null);

  const resetForm = () => {
    setEmail("");
    setPwd(genPwd());
    setRole("creator");
    setAgencyLevel("member");
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
        body: { email: mail, password: pwd, role, creator: role === "creator" ? creatorName : "", agencyRole: role === "agency" ? agencyLevel : undefined },
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
      // 2) Identifiants montrés une seule fois, puis ajout de la fiche (sans mot de passe).
      setCreated({ email: mail, pwd });
      const entry: AccessAccount = {
        email: mail,
        role,
        level: role === "agency" ? agencyLevel : undefined,
        creator: role === "creator" ? creatorName : undefined,
        cloud: "ok",
      };
      setFormOpen(false);
      resetForm();
      await saveEntry(entry);
    } finally {
      setBusy(false);
    }
  };

  // Nouveau mot de passe pour un compte existant (fondateurs ; vérifié aussi côté serveur).
  const resetPassword = async (mail: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const newPwd = genPwd();
      const { data, error: fnErr } = await supabase.functions.invoke("create-access", {
        body: { action: "reset", email: mail.trim().toLowerCase(), password: newPwd },
      });
      let res = data as { ok?: boolean; error?: string } | null;
      if (fnErr && (fnErr as { context?: { json?: () => Promise<unknown> } }).context?.json)
        res = (await (fnErr as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as typeof res;
      if (fnErr || !res?.ok) {
        const map: Record<string, string> = {
          compte_introuvable: "Aucun compte de connexion pour cet email",
          unauthorized: "Action réservée aux fondateurs",
          email_invalide: "Email invalide",
        };
        toast(map[res?.error ?? ""] ?? "Nouveau mot de passe impossible, réessaie");
        return;
      }
      setCreated({ email: mail, pwd: newPwd, reset: true });
      toast("Nouveau mot de passe créé ✓ Copie-le maintenant");
    } finally {
      setBusy(false);
    }
  };

  // Ajoute la fiche à la liste (blob agence, relu FRAIS avant fusion).
  const saveEntry = async (entry: AccessAccount): Promise<boolean> => {
    let ok = false;
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["accessAccounts"] as AccessAccount[]) ?? [];
      const next = stripPwd([entry, ...fresh.filter((a) => a.email.toLowerCase() !== entry.email)]);
      ok = await saveAppStateKey("accessAccounts", next);
      if (ok) setLocal(next);
    } catch {
      ok = false;
    }
    if (!ok) {
      setPendingEntry(entry);
      toast("Compte créé, mais liste non enregistrée. Utilise « Réessayer ».");
      return false;
    }
    setPendingEntry(null);
    toast("Accès créé ✓ Le créateur peut se connecter");
    return true;
  };

  const retryPending = async () => {
    if (!pendingEntry || busy) return;
    setBusy(true);
    try {
      await saveEntry(pendingEntry);
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (a: AccessAccount) => {
    let ok = false;
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["accessAccounts"] as AccessAccount[]) ?? [];
      const next = stripPwd(fresh.filter((x) => x.email.toLowerCase() !== a.email.toLowerCase()));
      ok = await saveAppStateKey("accessAccounts", next);
      if (ok) setLocal(next);
    } catch {
      ok = false;
    }
    toast(ok ? "Accès retiré de la liste" : "Erreur, réessaie");
  };

  const rows = local ?? accounts ?? [];
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
      {role === "agency" && (
        <SelectField
          label="Niveau d'accès"
          value={agencyLevel}
          onChange={(v) => setAgencyLevel(v as "founder" | "member")}
          options={[
            { value: "member", label: "Membre (tout sauf Finance & Accès)" },
            { value: "founder", label: "Fondateur (accès total)" },
          ]}
        />
      )}
      {role === "creator" && (
        <SelectField
          label="Créateur"
          value={creatorName}
          onChange={setCreatorName}
          options={[
            { value: "", label: "— Choisir —" },
            ...creators.map((c) => ({ value: c.name, label: titleCase(c.name), img: c.photo_url })),
          ]}
        />
      )}
    </InlineForm>
  );

  return (
    <>
      {/* Sous-pages : Comptes app / E-mails créateurs */}
      <Tabs
        className="mb-4"
        label="Sous-pages des accès"
        items={[
          { value: "comptes", label: "Comptes app" },
          { value: "emails", label: "E-mails créateurs" },
        ]}
        value={section}
        onValueChange={(v) => {
          const id = v as "comptes" | "emails";
          setSection(id);
          setNavSub(id);
        }}
      />

      {section === "emails" ? (
        <CredentialVault />
      ) : (
      <>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {loading ? "Chargement…" : `${rows.length} accès`}
        </div>
        <AddButton label="Accès" onClick={() => setFormOpen(true)} />
      </PageHeaderRow>

      {form}

      <AgencyAccountsPanel onReset={(m) => void resetPassword(m)} />

      {/* Identifiants affichés une seule fois (non stockés dans l'app). */}
      {created && (
        <div ref={createdRef} className="mb-4 scroll-mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-foreground">{created.reset ? "Nouveau mot de passe à transmettre" : "Identifiants à transmettre"}</div>
              <div className="mt-0.5 text-[11px] text-faint">
                {created.reset ? "L'ancien ne marche plus. " : ""}Le mot de passe n'est pas conservé dans l'app : copie-le maintenant.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCreated(null)}
              aria-label="Fermer"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="truncate text-sm text-foreground">{created.email}</span>
            <span className="rounded-md bg-rowhover px-2 py-1 font-mono text-xs tracking-wide text-foreground">{created.pwd}</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(`${created.email}\n${created.pwd}`)
                  .then(() => toast("Identifiants copiés ✓"))
                  .catch(() => toast("Copie impossible"));
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" /> Copier
            </button>
          </div>
          {pendingEntry && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-rose-500">
              Compte créé mais pas encore ajouté à la liste.
              <button
                type="button"
                onClick={retryPending}
                disabled={busy}
                className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
              >
                Réessayer
              </button>
            </div>
          )}
        </div>
      )}
      {!created && pendingEntry && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-[12px] text-rose-500 shadow-sm">
          Compte {pendingEntry.email} créé mais pas encore ajouté à la liste.
          <button
            type="button"
            onClick={retryPending}
            disabled={busy}
            className="rounded-lg border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
          >
            Réessayer
          </button>
        </div>
      )}

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
          Aucun accès pour le moment. Clique sur « + Accès » pour créer le premier compte créateur.
        </div>
      ) : query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Aucun résultat pour « {query} »</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
          {filtered.map((a, i) => (
            <AccountRow
              key={`${a.email}-${i}`}
              a={a}
              onDelete={removeAccount}
              onReset={(m) => void resetPassword(m)}
              photoUrl={a.role === "creator" && a.creator ? creators.find((c) => c.name.trim().toLowerCase() === a.creator!.trim().toLowerCase())?.photo_url ?? null : null}
            />
          ))}
        </div>
      )}
      </>
      )}
    </>
  );
}

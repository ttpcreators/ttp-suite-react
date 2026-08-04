import { useEffect, useState } from "react";
import { KeyRound, Eye, EyeOff, Copy, Plus, Trash2, Save } from "lucide-react";
import { useAppState, saveAppStateKey, invalidateAppState, type AppState } from "@/lib/appState";
import { toast } from "@/components/ui/toast";

/**
 * Coffre d'identifiants : adresses e-mail + mots de passe des boîtes que l'agence
 * gère pour certains créateurs. Blob agence-only `credVault` (RLS : invisible aux
 * créateurs). ⚠️ Stocké EN CLAIR côté base (choix assumé) — jamais partagé créateur.
 * Utilisé dans Accès → sous-page « E-mails créateurs ».
 */
type CredEntry = { id: string; label: string; email: string; password: string; note: string };
const CRED_KEY = "credVault";
let _cid = 0;
const cid = () => `c${Date.now().toString(36)}${(_cid += 1)}`;
const CIN = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";

export function CredentialVault() {
  const { data, loading } = useAppState<CredEntry[]>((s: AppState) => (s[CRED_KEY] as CredEntry[]) ?? []);
  const [list, setList] = useState<CredEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  // Initialisée UNE fois (ne pas écraser une saisie en cours à chaque rafraîchissement).
  useEffect(() => {
    if (!loading && list === null) setList((data ?? []).slice());
  }, [loading, data, list]);

  const rows = list ?? [];
  const add = () => setList([{ id: cid(), label: "", email: "", password: "", note: "" }, ...rows]);
  const edit = (id: string, patch: Partial<CredEntry>) => setList(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const del = (id: string) => { setList(rows.filter((r) => r.id !== id)); setConfirmDel(null); };
  const copy = async (text: string, what: string) => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast(`${what} copié ✓`); } catch { toast("Copie impossible"); }
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    invalidateAppState(); // ce blob-clé porte TOUTE la liste : on écrit l'état courant.
    const ok = await saveAppStateKey(CRED_KEY, rows);
    setSaving(false);
    toast(ok ? "Coffre enregistré ✓" : "Erreur — réessaie");
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span>
          <div>
            <div className="text-sm font-semibold text-foreground">Coffre identifiants créateurs</div>
            <div className="text-[11px] text-faint">Boîtes e-mail que tu gères. Agence uniquement — ⚠️ stocké en clair, n'ajoute que ce que tu acceptes.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={add} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
          <button type="button" onClick={save} disabled={saving || loading} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
            Aucun identifiant enregistré. « Ajouter » crée une entrée (créateur, e-mail, mot de passe).
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-panel/40 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <input value={r.label} onChange={(e) => edit(r.id, { label: e.target.value })} placeholder="Créateur / libellé (ex : Carla — boîte pro)" className={CIN + " font-semibold"} />
                  {confirmDel === r.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => del(r.id)} className="rounded-lg bg-[#E5484D] px-2.5 py-2 text-[11px] font-semibold text-white">Supprimer</button>
                      <button type="button" onClick={() => setConfirmDel(null)} className="rounded-lg border border-border px-2.5 py-2 text-[11px] font-semibold text-muted-foreground hover:bg-rowhover">Non</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDel(r.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* E-mail */}
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">Adresse e-mail</label>
                <div className="mb-2 flex items-center gap-2">
                  <input value={r.email} onChange={(e) => edit(r.id, { email: e.target.value })} placeholder="prenom@domaine.com" autoComplete="off" spellCheck={false} className={CIN} />
                  <button type="button" onClick={() => copy(r.email, "E-mail")} title="Copier l'e-mail" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>

                {/* Mot de passe */}
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">Mot de passe</label>
                <div className="flex items-center gap-2">
                  <input type={reveal[r.id] ? "text" : "password"} value={r.password} onChange={(e) => edit(r.id, { password: e.target.value })} placeholder="••••••••" autoComplete="new-password" spellCheck={false} className={CIN + " font-mono"} />
                  <button type="button" onClick={() => setReveal((s) => ({ ...s, [r.id]: !s[r.id] }))} title={reveal[r.id] ? "Masquer" : "Afficher"} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    {reveal[r.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => copy(r.password, "Mot de passe")} title="Copier le mot de passe" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>

                {/* Note */}
                <input value={r.note} onChange={(e) => edit(r.id, { note: e.target.value })} placeholder="Note (ex : hébergeur, e-mail de récupération, question secrète…)" className={CIN + " mt-2 text-[12px]"} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

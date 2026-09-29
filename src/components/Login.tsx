import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, AtSign, Building2, Eye, EyeOff, Loader2, Lock, Sparkles, Store } from "lucide-react";
import { supabase, setRemember } from "@/lib/supabase";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;
const LEGAL_URL = "https://ttpcreators.pro/mentions-legales/";

/*
 * Page de connexion façon Efferd (auth 14), refaite à la main et adaptée à TTP :
 * écran partagé sur fond uni, formulaire étroit et centré à gauche, et à droite
 * un mur de tuiles grises qui s'estompent sur les bords, avec la carte de la
 * marque au centre. Monochrome ; seul le bouton de connexion prend l'accent.
 * Pas de connexion Google & co : les accès sont créés par l'agence.
 */

// Mur de tuiles : hauteurs par colonne. `dim` = tuile plus effacée ; `kind` = esquisse d'interface.
type Tile = { h: number; dim?: boolean; kind?: "brand" | "kpi" | "bars" | "rows" | "person" };
const WALL: Tile[][] = [
  [{ h: 176, kind: "kpi" }, { h: 200, dim: true }, { h: 176, kind: "rows" }, { h: 200, dim: true }, { h: 176, kind: "bars" }, { h: 176 }],
  [{ h: 120, kind: "person" }, { h: 250, kind: "brand" }, { h: 176, kind: "bars" }, { h: 240, kind: "rows" }, { h: 144, kind: "kpi" }, { h: 144 }],
  [{ h: 200, kind: "rows" }, { h: 176, dim: true }, { h: 240, kind: "kpi" }, { h: 176, dim: true }, { h: 176, kind: "person" }, { h: 176 }],
];

const bone = "rounded-full bg-foreground/[0.08]";

/** Esquisse très discrète d'un bout d'interface (évoque l'app sans rien afficher de réel). */
function Sketch({ kind }: { kind: Tile["kind"] }) {
  if (kind === "kpi")
    return (
      <div className="flex h-full flex-col justify-end gap-2.5 p-5">
        <div className={cn(bone, "h-2 w-16")} />
        <div className={cn(bone, "h-5 w-28")} />
        <div className={cn(bone, "h-2 w-20 opacity-60")} />
      </div>
    );
  if (kind === "bars")
    return (
      <div className="flex h-full items-end gap-2 p-5">
        {[40, 62, 48, 78, 56, 90, 70].map((v, i) => (
          <div key={i} className="flex-1 rounded-md bg-foreground/[0.08]" style={{ height: `${v}%` }} />
        ))}
      </div>
    );
  if (kind === "rows")
    return (
      <div className="flex h-full flex-col justify-center gap-3.5 p-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-5 w-5 shrink-0 rounded-full bg-foreground/[0.08]" />
            <div className={cn(bone, "h-2")} style={{ width: `${[70, 52, 64, 44][i]}%` }} />
          </div>
        ))}
      </div>
    );
  if (kind === "person")
    return (
      <div className="flex h-full items-center gap-3 p-5">
        <div className="h-10 w-10 shrink-0 rounded-full bg-foreground/[0.07]" />
        <div className="flex flex-1 flex-col gap-2">
          <div className={cn(bone, "h-2 w-24")} />
          <div className={cn(bone, "h-2 w-16 opacity-60")} />
        </div>
      </div>
    );
  return null;
}

/** Carte de la marque au centre du mur (la « touche avatar »). */
function BrandCard() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface px-6 py-7 dark:bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-16px_rgb(0_0_0/0.18)] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 overflow-hidden rounded-[6px] bg-[#14181E] ring-1 ring-border">
          <img src={`${BASE}cover.png`} alt="" className="h-full w-full object-cover" />
        </div>
        <span className="text-[14px] font-semibold tracking-tight text-foreground">TTP Creators</span>
      </div>
      <p className="mt-6 text-balance text-[18px] leading-snug tracking-tight text-muted-foreground">
        <span className="font-medium text-foreground">Briefs, factures, planning et stats</span> se suivent ici, sans rien perdre en route.
      </p>
      <div className="mt-auto flex items-center gap-3 pt-5">
        {/* Touche « avatars » : les trois publics de l'app, en pastilles superposées */}
        <div className="flex -space-x-2">
          {[Building2, Sparkles, Store].map((I, i) => (
            <span key={i} className="grid h-8 w-8 place-items-center rounded-full border-2 border-surface bg-muted text-muted-foreground dark:border-panel">
              <I className="h-3.5 w-3.5" />
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">Agence et talents</div>
          <div className="truncate text-[12px] text-muted-foreground">Lyon · Genève</div>
        </div>
      </div>
    </div>
  );
}

const fieldCls =
  "h-10 w-full rounded-lg border border-border bg-surface text-[14px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10";

export function Login() {
  const reduced = useReducedMotion();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [remember, setRememberChecked] = useState(true);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setNotice("");
    setIsLoading(true);
    setRemember(remember); // route le stockage de session AVANT la connexion
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      const m = (error.message || "").toLowerCase();
      const status = (error as { status?: number }).status ?? 0;
      if (
        status === 402 ||
        status >= 500 ||
        m.includes("egress") ||
        m.includes("restricted") ||
        m.includes("quota") ||
        m.includes("unavailable") ||
        m.includes("failed to fetch")
      ) {
        setError("Service temporairement indisponible (Supabase). Réessaie dans un moment.");
      } else {
        setError("Identifiants incorrects.");
      }
    }
    setIsLoading(false);
  };

  const resetPassword = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Entre d'abord ton email.");
      return;
    }
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (resetErr) setError("Une erreur est survenue. Réessaie dans un moment.");
    else setNotice("Email de réinitialisation envoyé. Regarde ta boîte de réception.");
  };

  const rise = (y: number, delay: number) =>
    reduced ? {} : { initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div className="flex min-h-[100dvh] bg-surface text-foreground">
      {/* ── Formulaire ── */}
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center px-6 py-12">
        <motion.div {...rise(16, 0.1)} className="flex w-full max-w-[320px] flex-col gap-6">
          <div className="flex items-center justify-center gap-2.5">
            <div className="h-8 w-8 overflow-hidden rounded-[8px] bg-[#14181E] ring-1 ring-border">
              <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
            </div>
            <span className="text-[16px] font-semibold tracking-tight">TTP Suite</span>
          </div>

          <div className="text-center">
            <h1 className="text-balance text-[20px] font-semibold tracking-tight">Connecte-toi à ton espace.</h1>
            <p className="mt-1.5 text-balance text-[13px] text-muted-foreground">Avec l'email et le mot de passe fournis par l'agence.</p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="relative block">
              <span className="sr-only">Email</span>
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                placeholder="Ton adresse email"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                required
                className={cn(fieldCls, "pl-9 pr-3")}
              />
            </label>

            <label className="relative block">
              <span className="sr-only">Mot de passe</span>
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Mot de passe"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                required
                className={cn(fieldCls, "pl-9 pr-10")}
              />
              <button
                type="button"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 py-0.5">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(v) => setRememberChecked(v === true)} />
                Se souvenir de moi
              </label>
              <button type="button" onClick={resetPassword} className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
                Mot de passe oublié ?
              </button>
            </div>

            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">{error}</div>}
            {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-400">{notice}</div>}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[14px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isLoading ? "Connexion…" : "Se connecter"}
              {!isLoading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            Pas encore d'accès ?
            <span className="h-px flex-1 bg-border" />
          </div>
          <p className="-mt-3 text-balance text-center text-[13px] text-muted-foreground">Les comptes sont créés par l'agence. Demande le tien à Marc ou Gianni.</p>

          <p className="text-balance text-center text-[12px] leading-relaxed text-muted-foreground">
            En te connectant, tu acceptes les{" "}
            <a href={LEGAL_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 transition-colors hover:text-foreground">
              mentions légales
            </a>{" "}
            de TTP Creators.
          </p>
        </motion.div>
      </main>

      {/* ── Panneau de marque (ordinateur) : titre + mur de tuiles estompé ── */}
      <aside className="relative hidden w-[36%] min-w-[440px] flex-col overflow-hidden border-l border-border lg:flex">
        <div className="px-10 pb-10 pt-24 text-center">
          <h2 className="text-balance text-[30px] font-bold leading-tight tracking-tight">Trust the Process.</h2>
          <p className="mx-auto mt-3 max-w-sm text-balance text-[15px] leading-relaxed text-muted-foreground">
            L'espace de travail de l'agence TTP Creators et de ses talents.
          </p>
        </div>
        <div
          className="relative min-h-0 flex-1"
          style={{
            maskImage: "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent), linear-gradient(to bottom, transparent, #000 10%, #000 95%, transparent)",
            maskComposite: "intersect",
            WebkitMaskImage: "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent), linear-gradient(to bottom, transparent, #000 10%, #000 95%, transparent)",
            WebkitMaskComposite: "source-in",
          }}
        >
          <div className="absolute left-1/2 top-0 flex w-[992px] -translate-x-1/2 gap-4" aria-hidden>
            {WALL.map((col, ci) => (
              <motion.div key={ci} {...rise(48, 0.1 + ci * 0.12)} className="flex w-[320px] shrink-0 flex-col gap-4">
                {col.map((t, ti) =>
                  t.kind === "brand" ? (
                    <div key={ti} style={{ height: t.h }}>
                      <BrandCard />
                    </div>
                  ) : (
                    <div key={ti} className={cn("rounded-xl", t.dim ? "bg-foreground/[0.025]" : "bg-foreground/[0.05]")} style={{ height: t.h }}>
                      <Sketch kind={t.kind} />
                    </div>
                  ),
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

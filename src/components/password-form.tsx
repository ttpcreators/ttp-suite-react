import { useEffect, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Lock } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { IosGroup, IosRow } from "@/components/mobile/ios-shell";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { LangProvider, langOf, useT, type Lang } from "@/lib/i18n";
import { messageErreurMotDePasse, motDePasseInvalide } from "@/lib/passwordRecovery";
import { cn } from "@/lib/utils";

/*
 * Nouveau mot de passe, pour l'agence comme pour les créateurs (constat W3) :
 *   - l'écran « Choisis ton nouveau mot de passe », ouvert par le lien du mail « Mot de passe
 *     oublié » (App.tsx le montre à la place de l'espace) ;
 *   - « Mot de passe » dans les réglages (Paramètres › Compte côté agence, Réglages de
 *     l'espace créateur).
 * Textes passés par t() : français côté agence, langue de l'espace côté créateur
 * (traductions dans src/lib/i18n/en-shared.ts). Règles pures : src/lib/passwordRecovery.ts.
 */

const fieldCls =
  "h-11 w-full rounded-xl border border-border bg-surface pl-3.5 pr-11 text-[15px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10";

/** Les deux champs et « Enregistrer ». `onSaved` : appelé une fois le mot de passe changé. */
export function PasswordForm({ onSaved, onCancel, autoFocus }: { onSaved: () => void; onCancel?: () => void; autoFocus?: boolean }) {
  const t = useT();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const bad = motDePasseInvalide(pw, pw2);
    if (bad) {
      setError(t(bad));
      return;
    }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) {
      setError(t(messageErreurMotDePasse(err)));
      return;
    }
    setPw("");
    setPw2("");
    onSaved();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <label className="relative block">
        <span className="sr-only">{t("Nouveau mot de passe")}</span>
        <input
          type={show ? "text" : "password"}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t("Nouveau mot de passe")}
          autoComplete="new-password"
          autoFocus={autoFocus}
          className={fieldCls}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? t("Masquer le mot de passe") : t("Afficher le mot de passe")}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </label>
      <label className="block">
        <span className="sr-only">{t("Confirme le mot de passe")}</span>
        <input
          type={show ? "text" : "password"}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder={t("Confirme le mot de passe")}
          autoComplete="new-password"
          className={cn(fieldCls, "pr-3.5")}
        />
      </label>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">{error}</div>}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-10 rounded-full bg-field px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-rowhover">
            {t("Annuler")}
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Spin size={14} /> : null}
          {busy ? t("Enregistrement…") : t("Enregistrer")}
        </button>
      </div>
    </form>
  );
}

/**
 * « Mot de passe » dans les réglages. `ios` : une ligne des Réglages de l'espace créateur ;
 * sinon le contenu d'une carte de Paramètres (agence). Jamais dans l'aperçu d'un espace
 * créateur par l'agence : le mot de passe changé serait celui du compte agence.
 */
export function PasswordSettings({ variant = "card" }: { variant?: "card" | "ios" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const saved = () => {
    setOpen(false);
    toast(t("Mot de passe changé ✓"), { variant: "success" });
  };
  if (variant === "ios") {
    return (
      <IosGroup>
        <IosRow icon={Lock} label={t("Mot de passe")} detail={open ? undefined : t("Changer")} onClick={() => setOpen((v) => !v)} />
        {open && (
          <div className="px-3.5 pb-3.5 pt-1">
            <PasswordForm autoFocus onSaved={saved} onCancel={() => setOpen(false)} />
          </div>
        )}
      </IosGroup>
    );
  }
  return open ? (
    <PasswordForm autoFocus onSaved={saved} onCancel={() => setOpen(false)} />
  ) : (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[14px] text-foreground">
        <Lock className="h-4 w-4 text-muted-foreground" /> {t("Mot de passe")}
      </span>
      <button type="button" onClick={() => setOpen(true)} className="h-9 rounded-full bg-field px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover">
        {t("Changer")}
      </button>
    </div>
  );
}

/**
 * Écran ouvert par le lien du mail « Mot de passe oublié » (session de récupération). Pour un
 * créateur, dans la langue de son espace. Ensuite : se reconnecter dans l'app installée avec
 * ce mot de passe (sur iPhone, le lien s'ouvre dans Safari, séparé de l'app).
 */
export function PasswordRecoveryScreen({ creatorName, onDone }: { creatorName: string | null; onDone: () => void }) {
  const [lang, setLang] = useState<Lang>("fr");
  useEffect(() => {
    if (!creatorName) return;
    let alive = true;
    void supabase
      .from("creators")
      .select("lang")
      .eq("name", creatorName)
      .limit(1)
      .then(({ data }) => {
        if (alive) setLang(langOf((data?.[0] as { lang?: string | null } | undefined)?.lang));
      });
    return () => {
      alive = false;
    };
  }, [creatorName]);
  return (
    <LangProvider lang={lang}>
      <RecoveryBody onDone={onDone} />
    </LangProvider>
  );
}

function RecoveryBody({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-surface px-6 py-12 text-foreground">
      <div className="flex w-full max-w-[340px] flex-col gap-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="h-8 w-8 overflow-hidden rounded-[8px] bg-brand ring-1 ring-border">
            <img src={`${import.meta.env.BASE_URL}cover.png?v=3`} alt="TTP" className="h-full w-full object-cover" />
          </div>
          <span className="text-[16px] font-semibold tracking-tight">TTP Suite</span>
        </div>
        {done ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-ok-soft text-ok">
              <Check className="h-5 w-5" />
            </span>
            <h1 className="text-balance text-[20px] font-semibold tracking-tight">{t("Ton nouveau mot de passe est enregistré.")}</h1>
            <p className="text-balance text-[14px] leading-relaxed text-muted-foreground">
              {t("Si tu utilises l'app installée sur ton téléphone, ouvre-la et connecte-toi avec ce mot de passe.")}
            </p>
            <button type="button" onClick={onDone} className="mt-2 h-11 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              {t("Continuer")}
            </button>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-balance text-[20px] font-semibold tracking-tight">{t("Choisis ton nouveau mot de passe")}</h1>
              <p className="mt-1.5 text-balance text-[13px] text-muted-foreground">{t("Tu l'utiliseras pour te connecter à ton espace.")}</p>
            </div>
            <PasswordForm autoFocus onSaved={() => setDone(true)} />
            <button type="button" onClick={onDone} className="self-center text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
              {t("Plus tard")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

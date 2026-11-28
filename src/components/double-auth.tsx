import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, ShieldCheck } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { IosGroup, IosRow } from "@/components/mobile/ios-shell";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { useT } from "@/lib/i18n";
import { cleLisible, codeComplet, facteursTotp, messageErreurDoubleAuth, nettoyerCode, sourceQr } from "@/lib/doubleAuth";

/*
 * Double authentification FACULTATIVE (application TOTP), pour l'agence comme pour les
 * créateurs (audit des 14 attaques, correction 5) :
 *   - DoubleAuthSettings : « Double authentification » dans Paramètres › Compte (agence) et
 *     les Réglages de l'espace créateur : activer (QR code, clé, premier code), désactiver
 *     (avec un code de l'application).
 *   - DoubleAuthCodeScreen : le code demandé après la connexion à qui l'a activée (App.tsx).
 * API MFA de Supabase Auth (enroll, challengeAndVerify, unenroll). Rien n'est exigé côté
 * serveur : c'est une décision de Marc, une fois les fondateurs inscrits. Textes passés par
 * t() (traductions dans src/lib/i18n/en-shared.ts). Règles pures : src/lib/doubleAuth.ts.
 */

const fieldCls =
  "h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-center font-mono text-[18px] tracking-[0.3em] text-foreground outline-none transition-[border-color,box-shadow] placeholder:tracking-normal placeholder:font-sans placeholder:text-[15px] placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10";
const btnPlein =
  "flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";
const btnGris = "h-10 rounded-full bg-field px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-60";

/** Champ du code à 6 chiffres (clavier numérique, code proposé par le téléphone). */
function ChampCode({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const t = useT();
  return (
    <label className="block">
      <span className="sr-only">{t("Code à 6 chiffres")}</span>
      <input
        value={value}
        onChange={(e) => onChange(nettoyerCode(e.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        placeholder={t("Code à 6 chiffres")}
        className={fieldCls}
      />
    </label>
  );
}

const Erreur = ({ texte }: { texte: string }) =>
  texte ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">{texte}</div> : null;

type Etat =
  | { vue: "chargement" }
  | { vue: "inactive" }
  | { vue: "active"; facteur: string }
  | { vue: "activer"; facteur: string; qr: string; cle: string }
  | { vue: "desactiver"; facteur: string };

/** Le contenu : état, activation, désactivation. */
function DoubleAuthBody({ onEtat }: { onEtat?: (active: boolean | null) => void }) {
  const t = useT();
  const [etat, setEtat] = useState<Etat>({ vue: "chargement" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const relire = useCallback(async () => {
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    if (err) {
      setEtat({ vue: "inactive" });
      return;
    }
    const { actif } = facteursTotp(data?.all);
    setEtat(actif ? { vue: "active", facteur: actif } : { vue: "inactive" });
  }, []);

  useEffect(() => {
    void relire();
  }, [relire]);
  useEffect(() => {
    onEtat?.(etat.vue === "chargement" ? null : etat.vue === "active" || etat.vue === "desactiver");
  }, [etat.vue, onEtat]);

  const commencer = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setCode("");
    // Une inscription laissée en route bloquerait la suivante : on l'efface d'abord.
    const { data: liste } = await supabase.auth.mfa.listFactors();
    for (const id of facteursTotp(liste?.all).enCours) await supabase.auth.mfa.unenroll({ factorId: id });
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "TTP Suite" });
    setBusy(false);
    if (err || !data) {
      setError(t(messageErreurDoubleAuth(err)));
      return;
    }
    setEtat({ vue: "activer", facteur: data.id, qr: sourceQr(data.totp.qr_code), cle: data.totp.secret });
  };

  const annulerActivation = async (facteur: string) => {
    setError("");
    setCode("");
    setEtat({ vue: "inactive" });
    await supabase.auth.mfa.unenroll({ factorId: facteur });
  };

  const verifier = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (etat.vue !== "activer" && etat.vue !== "desactiver")) return;
    if (!codeComplet(code)) {
      setError(t("Tape les 6 chiffres affichés dans l'application."));
      return;
    }
    setBusy(true);
    setError("");
    const facteur = etat.facteur;
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: facteur, code });
    if (err) {
      setBusy(false);
      setError(t(messageErreurDoubleAuth(err)));
      return;
    }
    if (etat.vue === "activer") {
      setBusy(false);
      setCode("");
      setEtat({ vue: "active", facteur });
      toast(t("Double authentification activée ✓"), { variant: "success" });
      return;
    }
    // Désactiver : le code vient de faire passer la session au niveau exigé par Supabase.
    const { error: err2 } = await supabase.auth.mfa.unenroll({ factorId: facteur });
    setBusy(false);
    if (err2) {
      setError(t(messageErreurDoubleAuth(err2)));
      return;
    }
    setCode("");
    setEtat({ vue: "inactive" });
    toast(t("Double authentification désactivée"));
  };

  if (etat.vue === "chargement") return <div className="flex justify-center py-2"><Spin size={16} /></div>;

  if (etat.vue === "inactive" || etat.vue === "active") {
    const active = etat.vue === "active";
    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {active
            ? t("Activée : un code de ton application est demandé à chaque connexion.")
            : t("Facultative : en plus du mot de passe, un code à 6 chiffres donné par une application (Google Authenticator, 1Password…) à chaque connexion.")}
        </p>
        <Erreur texte={error} />
        <div className="flex justify-end">
          {active ? (
            <button type="button" onClick={() => { setError(""); setCode(""); setEtat({ vue: "desactiver", facteur: etat.facteur }); }} className={btnGris}>
              {t("Désactiver")}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void commencer()} className={btnPlein}>
              {busy ? <Spin size={14} /> : null}
              {t("Activer")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={verifier} className="flex flex-col gap-3">
      {etat.vue === "activer" ? (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("Scanne ce QR code avec ton application, puis tape le code à 6 chiffres qu'elle affiche.")}
          </p>
          {etat.qr && (
            <div className="self-center rounded-xl bg-white p-2.5 ring-1 ring-border">
              <img src={etat.qr} alt={t("QR code à scanner")} className="h-44 w-44" />
            </div>
          )}
          <div className="text-center text-[12px] text-muted-foreground">
            {t("Sans appareil photo : entre cette clé dans l'application.")}
            <div className="mt-1 select-all break-all font-mono text-[13px] text-foreground">{cleLisible(etat.cle)}</div>
          </div>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t("Pour désactiver, tape un code de ton application.")}</p>
      )}
      <ChampCode value={code} onChange={setCode} autoFocus />
      <Erreur texte={error} />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => (etat.vue === "activer" ? void annulerActivation(etat.facteur) : (setError(""), setCode(""), setEtat({ vue: "active", facteur: etat.facteur })))}
          className={btnGris}
        >
          {t("Annuler")}
        </button>
        <button type="submit" disabled={busy} className={btnPlein}>
          {busy ? <Spin size={14} /> : null}
          {etat.vue === "activer" ? t("Activer") : t("Désactiver")}
        </button>
      </div>
    </form>
  );
}

/**
 * « Double authentification » dans les réglages. `ios` : une ligne des Réglages de l'espace
 * créateur ; sinon le contenu d'une carte de Paramètres (agence). Jamais dans l'aperçu d'un
 * espace créateur par l'agence (elle toucherait le compte agence).
 */
export function DoubleAuthSettings({ variant = "card" }: { variant?: "card" | "ios" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<boolean | null>(null);
  if (variant === "ios") {
    return (
      <IosGroup>
        <IosRow
          icon={ShieldCheck}
          label={t("Double authentification")}
          detail={open ? undefined : active == null ? undefined : active ? t("Activée") : t("Désactivée")}
          onClick={() => setOpen((v) => !v)}
        />
        <div className={open ? "px-3.5 pb-3.5 pt-1" : "hidden"}>
          <DoubleAuthBody onEtat={setActive} />
        </div>
      </IosGroup>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex items-center gap-2 text-[14px] text-foreground">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" /> {t("Double authentification")}
        {active && <Check className="h-3.5 w-3.5 text-ok" />}
      </span>
      <DoubleAuthBody onEtat={setActive} />
    </div>
  );
}

/**
 * Code demandé après la connexion, pour un compte qui a activé la double authentification
 * (session sans code : App.tsx, page d'accord du connecteur). `onDone` : code accepté.
 */
export function DoubleAuthCodeScreen({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-surface px-6 py-12 text-foreground">
      <div className="flex w-full max-w-[340px] flex-col gap-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="h-8 w-8 overflow-hidden rounded-[8px] bg-brand ring-1 ring-border">
            <img src={`${import.meta.env.BASE_URL}cover.png?v=3`} alt="TTP" className="h-full w-full object-cover" />
          </div>
          <span className="text-[16px] font-semibold tracking-tight">TTP Suite</span>
        </div>
        <DoubleAuthCodeForm onDone={onDone} onLogout={onLogout} />
      </div>
    </div>
  );
}

/** Le formulaire du code seul (titre, champ, « Valider », « Se déconnecter »). */
export function DoubleAuthCodeForm({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!codeComplet(code)) {
      setError(t("Tape les 6 chiffres affichés dans l'application."));
      return;
    }
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    const facteur = err ? null : facteursTotp(data?.all).actif;
    if (!facteur) {
      setBusy(false);
      setError(t(messageErreurDoubleAuth(err)));
      return;
    }
    const { error: err2 } = await supabase.auth.mfa.challengeAndVerify({ factorId: facteur, code });
    setBusy(false);
    if (err2) {
      setCode("");
      setError(t(messageErreurDoubleAuth(err2)));
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={valider} className="flex flex-col gap-3">
      <div className="text-center">
        <h1 className="text-balance text-[20px] font-semibold tracking-tight">{t("Code de connexion")}</h1>
        <p className="mt-1.5 text-balance text-[13px] text-muted-foreground">{t("Tape le code à 6 chiffres affiché dans ton application d'authentification.")}</p>
      </div>
      <ChampCode value={code} onChange={setCode} autoFocus />
      <Erreur texte={error} />
      <button type="submit" disabled={busy} className={`${btnPlein} h-11 w-full`}>
        {busy ? <Spin size={14} /> : null}
        {t("Valider")}
      </button>
      <button type="button" onClick={onLogout} className="self-center text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
        {t("Se déconnecter")}
      </button>
    </form>
  );
}

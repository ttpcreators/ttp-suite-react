import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";

const BASE = import.meta.env.BASE_URL;

export function Login() {
  const [tab, setTab] = useState<"agency" | "creator">("agency");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: pwd,
    });
    if (error) setError("Identifiants incorrects.");
    setBusy(false);
    // succès → onAuthStateChange (App) bascule automatiquement
  };

  const seg = (active: boolean) =>
    "flex flex-1 items-center justify-center gap-2 rounded-[11px] py-[13px] text-xs font-semibold tracking-[.2px] transition-all " +
    (active ? "bg-white text-[#0A0A0B]" : "text-white/50");

  const ctaLabel = busy
    ? "Connexion…"
    : tab === "agency"
      ? "Se connecter à l’espace agence"
      : "Se connecter à mon espace";

  return (
    <div className="min-h-screen bg-[#FAFAFA] p-[14px] dark:bg-[#09090B]">
      <div
        className="flex flex-col overflow-hidden rounded-[22px] text-white md:flex-row"
        style={{ minHeight: "calc(100vh - 28px)", background: "#0A0A0B" }}
      >
        {/* ===== LEFT : brand + starburst ===== */}
        <div className="relative min-h-[150px] flex-1 overflow-hidden">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <line x1="32" y1="0" x2="32" y2="100" stroke="rgba(255,255,255,.07)" strokeWidth="0.25" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,.07)" strokeWidth="0.25" />
            <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(255,255,255,.045)" strokeWidth="0.25" />
            <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,.045)" strokeWidth="0.25" />
          </svg>

          <div className="absolute left-[34px] top-[30px] z-[2] flex items-center gap-[11px]">
            <div className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-[8px] bg-[#14181E]">
              <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
            </div>
            <span className="text-[15px] font-bold tracking-[.3px]">
              TTP <span className="font-normal opacity-55">Suite</span>
            </span>
          </div>

          <div className="absolute left-[32%] top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2">
            <svg width="118" height="118" viewBox="0 0 120 120" fill="none" stroke="#fff" strokeWidth="2.4">
              <line x1="60" y1="52" x2="60" y2="9" />
              <line x1="60" y1="68" x2="60" y2="111" />
              <line x1="52" y1="60" x2="9" y2="60" />
              <line x1="68" y1="60" x2="111" y2="60" />
              <line x1="65.6" y1="54.4" x2="86.9" y2="33.1" />
              <line x1="54.4" y1="54.4" x2="33.1" y2="33.1" />
              <line x1="65.6" y1="65.6" x2="86.9" y2="86.9" />
              <line x1="54.4" y1="65.6" x2="33.1" y2="86.9" />
            </svg>
          </div>

          <div className="absolute bottom-[26px] left-[34px] z-[2] hidden text-[10px] text-white/40 md:block">
            © TTP Agency 2026. Tous droits réservés.
          </div>
        </div>

        {/* ===== RIGHT : form ===== */}
        <div
          className="relative flex w-full flex-col px-[42px] pb-[42px] pt-[30px] md:w-[46%] md:min-w-[330px]"
          style={{
            background:
              "radial-gradient(130% 90% at 82% 14%, #1c1c20 0%, #121214 58%, #0e0e10 100%)",
          }}
        >
          <form onSubmit={submit} className="mx-auto my-auto w-full max-w-[460px]">
            <div className="mb-[10px] text-xs text-white/45">
              Je me connecte en tant que
            </div>

            <div
              className="mb-[26px] flex max-w-[360px] gap-[6px] rounded-lg p-[5px]"
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)",
              }}
            >
              <button type="button" onClick={() => setTab("agency")} className={seg(tab === "agency")}>
                <span className="text-sm">⊞</span> Espace agence
              </button>
              <button type="button" onClick={() => setTab("creator")} className={seg(tab === "creator")}>
                <span className="text-sm">◵</span> Espace créateur
              </button>
            </div>

            <h1 className="mb-[28px] text-[52px] font-light leading-none tracking-[-1.5px]">
              Connexion
            </h1>

            <div className="flex flex-col gap-[30px] sm:flex-row">
              <div className="min-w-0 flex-1">
                <div className="mb-[9px] text-[11px] font-medium text-white/55">Email</div>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={tab === "agency" ? "agence@ttp.com" : "prenom@ttp.com"}
                  className="w-full border-0 border-b border-white/20 bg-transparent py-2 text-sm font-medium text-white outline-none placeholder:text-white/30 focus:border-white/60"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-[9px] text-[11px] font-medium text-white/55">Mot de passe</div>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder="••••••••"
                    className="w-full border-0 border-b border-white/20 bg-transparent py-2 pr-6 text-sm font-medium text-white outline-none placeholder:text-white/30 focus:border-white/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-0 top-1.5 text-white/45 transition-colors hover:text-white/80"
                    title="Afficher / masquer"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-[18px] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setRemember((r) => !r)}
                className="flex items-center gap-[9px]"
              >
                <span
                  className={
                    "grid h-4 w-4 place-items-center rounded-[5px] border text-[10px] transition-colors " +
                    (remember
                      ? "border-white bg-white text-[#0A0A0B]"
                      : "border-white/30")
                  }
                >
                  {remember ? "✓" : ""}
                </span>
                <span className="text-xs text-white/60">Se souvenir de moi</span>
              </button>
              <span className="cursor-pointer text-xs text-white/45 hover:text-white/70">
                Mot de passe oublié ?
              </span>
            </div>

            {error && (
              <div className="mt-4 text-[11px] font-medium text-[#FF6B6B]">{error}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-[28px] flex w-full max-w-[360px] items-center justify-center gap-[10px] rounded-[13px] bg-white p-[15px] text-[13px] font-semibold tracking-[.2px] text-[#0A0A0B] transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {ctaLabel} <span className="text-[15px]">→</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { StrictMode, useEffect, useState } from "react";
import { Spin } from "@/components/ui/loader";
import { createRoot } from "react-dom/client";
import { Check, LogOut, ShieldCheck, X } from "@/components/icons";
import "@/index.css";
import { supabase } from "@/lib/supabase";

/**
 * Page « Autoriser Claude » (app.ttpcreators.pro/connecteur/) : étape d'accord du
 * connecteur Claude (OAuth 2.1). Claude y envoie l'utilisateur avec client_id,
 * redirect_uri, code_challenge (PKCE) et state. Si la session TTP Suite est ouverte
 * (même navigateur que l'app), on montre l'accord ; sinon, on se connecte ici.
 * « Autoriser » : la fonction ttp-mcp crée la connexion et renvoie vers Claude avec un
 * code à usage unique. « Refuser » : retour vers Claude avec error=access_denied.
 */
const FN = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ttp-mcp";
const P = new URLSearchParams(location.search);
const req = {
  client_id: P.get("client_id") ?? "",
  redirect_uri: P.get("redirect_uri") ?? "",
  code_challenge: P.get("code_challenge") ?? "",
  code_challenge_method: P.get("code_challenge_method") ?? "",
  state: P.get("state") ?? "",
  scope: P.get("scope") ?? "",
  resource: P.get("resource") ?? "",
};

async function post(path: string, body: unknown, jwt?: string) {
  const res = await fetch(`${FN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  return { ok: res.ok, data };
}

const CAN = [
  "Lire les mails de partnerships@ et talent@, et les DM Instagram",
  "Voir le roster, le scouting (créateurs et sportifs), les contacts, le pipeline et les collabs",
  "Voir le planning, les tâches et, pour les fondateurs, les factures",
  "Avec ton accord à chaque fois : créer une tâche, un rendez-vous, un brouillon de mail, noter un échange, ajouter au scouting",
];
const NEVER = ["Envoyer un mail à ta place", "Voir les mots de passe du coffre, les IBAN ou les accès Google / Meta"];

function App() {
  const [step, setStep] = useState<"check" | "login" | "consent" | "busy" | "error">("check");
  const [err, setErr] = useState("");
  const [client, setClient] = useState("Claude");
  const [email, setEmail] = useState("");
  const [who, setWho] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void (async () => {
      if (!req.client_id || !req.redirect_uri || !req.code_challenge) {
        setErr("Lien incomplet : relance la connexion depuis Claude (Paramètres → Connecteurs).");
        return setStep("error");
      }
      const c = await post("/authorize/check", { client_id: req.client_id, redirect_uri: req.redirect_uri });
      if (!c.ok) {
        setErr(c.data.error_description ?? "Connexion inconnue : relance-la depuis Claude.");
        return setStep("error");
      }
      setClient(c.data.client_name || "Claude");
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setWho(data.session.user.email ?? "");
        setStep("consent");
      } else setStep("login");
    })();
  }, []);

  const login = async () => {
    setStep("busy");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPassword("");
    if (error || !data.session) {
      setErr("Email ou mot de passe incorrect.");
      return setStep("login");
    }
    setErr("");
    setWho(data.session.user.email ?? "");
    setStep("consent");
  };

  const allow = async () => {
    setStep("busy");
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt) return setStep("login");
    const r = await post("/authorize/approve", req, jwt);
    if (!r.ok || !r.data.redirect) {
      setErr(r.data.error_description ?? "Autorisation impossible, réessaie.");
      return setStep("consent");
    }
    location.replace(r.data.redirect);
  };

  const deny = () => {
    const u = new URL(req.redirect_uri);
    u.searchParams.set("error", "access_denied");
    if (req.state) u.searchParams.set("state", req.state);
    location.replace(u.toString());
  };

  const switchAccount = async () => {
    await supabase.auth.signOut();
    setWho("");
    setStep("login");
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[440px] rounded-[20px] bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png?v=2" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <div className="text-[15px] font-semibold">TTP Suite</div>
            <div className="text-[12px] text-muted-foreground">Connexion de {client}</div>
          </div>
        </div>

        {step === "check" || step === "busy" ? (
          <div className="flex items-center gap-2 py-6 text-[14px] text-muted-foreground"><Spin size={16} /> Un instant…</div>
        ) : step === "error" ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-[14px] text-foreground">{err}</p>
        ) : step === "login" ? (
          <form onSubmit={(e) => { e.preventDefault(); void login(); }} className="flex flex-col gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight">Connecte-toi à TTP Suite</h1>
            <p className="text-[13px] text-muted-foreground">Avec ton compte de l'agence, pour autoriser {client}.</p>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              className="h-11 rounded-[10px] border border-input bg-surface px-3 text-[16px] outline-none focus:border-foreground" />
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe"
              className="h-11 rounded-[10px] border border-input bg-surface px-3 text-[16px] outline-none focus:border-foreground" />
            {err && <p className="text-[13px] text-dangertext">{err}</p>}
            <button type="submit" className="mt-1 h-11 rounded-full bg-primary text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">Se connecter</button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <h1 className="text-[22px] font-semibold leading-snug tracking-tight">Autoriser {client} à accéder à TTP Suite ?</h1>
            <div className="rounded-xl bg-muted/60 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><ShieldCheck className="h-4 w-4" /> {client} pourra</div>
              <ul className="flex flex-col gap-1.5">
                {CAN.map((t) => <li key={t} className="flex gap-2 text-[13px] leading-snug"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signaltext" />{t}</li>)}
              </ul>
              <div className="mb-2 mt-3 text-[13px] font-semibold">Jamais</div>
              <ul className="flex flex-col gap-1.5">
                {NEVER.map((t) => <li key={t} className="flex gap-2 text-[13px] leading-snug"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-dangertext" />{t}</li>)}
              </ul>
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Chaque consultation et chaque action sont notées. Tu peux couper cet accès à tout moment dans Paramètres → Claude.
            </p>
            {err && <p className="text-[13px] text-dangertext">{err}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" onClick={deny} className="h-11 flex-1 rounded-full border border-border text-[14px] font-semibold transition-colors hover:bg-rowhover">Refuser</button>
              <button type="button" onClick={() => void allow()} className="h-11 flex-1 rounded-full bg-primary text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">Autoriser</button>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3 text-[12px] text-muted-foreground">
              <span className="truncate">Connecté : {who}</span>
              <button type="button" onClick={() => void switchAccount()} className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"><LogOut className="h-3.5 w-3.5" /> Changer de compte</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

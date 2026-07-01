import { useState, useEffect, useRef, type FormEvent, type RefObject } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const BASE = import.meta.env.BASE_URL;

function Pupil({
  size = 12,
  maxDistance = 5,
  pupilColor = "black",
  forceLookX,
  forceLookY,
}: {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);
  let x = 0;
  let y = 0;
  if (forceLookX !== undefined && forceLookY !== undefined) {
    x = forceLookX;
    y = forceLookY;
  } else if (ref.current) {
    const r = ref.current.getBoundingClientRect();
    const dx = mouseX - (r.left + r.width / 2);
    const dy = mouseY - (r.top + r.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const a = Math.atan2(dy, dx);
    x = Math.cos(a) * dist;
    y = Math.sin(a) * dist;
  }
  return (
    <div
      ref={ref}
      className="rounded-full"
      style={{ width: size, height: size, backgroundColor: pupilColor, transform: `translate(${x}px, ${y}px)`, transition: "transform 0.1s ease-out" }}
    />
  );
}

function EyeBall({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = "white",
  pupilColor = "black",
  isBlinking = false,
  forceLookX,
  forceLookY,
}: {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);
  let x = 0;
  let y = 0;
  if (forceLookX !== undefined && forceLookY !== undefined) {
    x = forceLookX;
    y = forceLookY;
  } else if (ref.current) {
    const r = ref.current.getBoundingClientRect();
    const dx = mouseX - (r.left + r.width / 2);
    const dy = mouseY - (r.top + r.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const a = Math.atan2(dy, dx);
    x = Math.cos(a) * dist;
    y = Math.sin(a) * dist;
  }
  return (
    <div
      ref={ref}
      className="flex items-center justify-center rounded-full transition-all duration-150"
      style={{ width: size, height: isBlinking ? 2 : size, backgroundColor: eyeColor, overflow: "hidden" }}
    >
      {!isBlinking && (
        <div className="rounded-full" style={{ width: pupilSize, height: pupilSize, backgroundColor: pupilColor, transform: `translate(${x}px, ${y}px)`, transition: "transform 0.1s ease-out" }} />
      )}
    </div>
  );
}

export function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  useEffect(() => {
    let t: number;
    const schedule = () => {
      t = window.setTimeout(() => {
        setIsPurpleBlinking(true);
        window.setTimeout(() => {
          setIsPurpleBlinking(false);
          schedule();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    schedule();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let t: number;
    const schedule = () => {
      t = window.setTimeout(() => {
        setIsBlackBlinking(true);
        window.setTimeout(() => {
          setIsBlackBlinking(false);
          schedule();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    schedule();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const t = window.setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(t);
    }
    setIsLookingAtEachOther(false);
  }, [isTyping]);

  useEffect(() => {
    if (password.length > 0 && showPassword) {
      const t = window.setTimeout(() => {
        setIsPurplePeeking(true);
        window.setTimeout(() => setIsPurplePeeking(false), 800);
      }, Math.random() * 3000 + 2000);
      return () => clearTimeout(t);
    }
    setIsPurplePeeking(false);
  }, [password, showPassword, isPurplePeeking]);

  const calc = (ref: RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const r = ref.current.getBoundingClientRect();
    const dx = mouseX - (r.left + r.width / 2);
    const dy = mouseY - (r.top + r.height / 3);
    return {
      faceX: Math.max(-15, Math.min(15, dx / 20)),
      faceY: Math.max(-10, Math.min(10, dy / 30)),
      bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
    };
  };

  const purplePos = calc(purpleRef);
  const blackPos = calc(blackRef);
  const yellowPos = calc(yellowRef);
  const orangePos = calc(orangeRef);
  const pwShown = password.length > 0 && showPassword;
  const pwHidden = password.length > 0 && !showPassword;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) setError("Identifiants incorrects.");
    setIsLoading(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left : characters */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary/90 via-primary to-primary/80 p-12 text-primary-foreground lg:flex">
        <div className="relative z-20 flex items-center gap-2 text-lg font-semibold">
          <div className="h-8 w-8 overflow-hidden rounded-lg bg-white/10">
            <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
          </div>
          <span>TTP Suite</span>
        </div>

        <div className="relative z-20 flex h-[500px] items-end justify-center">
          <div className="relative" style={{ width: 550, height: 400 }}>
            {/* Purple */}
            <div
              ref={purpleRef}
              className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: 70,
                width: 180,
                height: isTyping || pwHidden ? 440 : 400,
                backgroundColor: "#6C3FF5",
                borderRadius: "10px 10px 0 0",
                zIndex: 1,
                transform: pwShown ? "skewX(0deg)" : isTyping || pwHidden ? `skewX(${purplePos.bodySkew - 12}deg) translateX(40px)` : `skewX(${purplePos.bodySkew}deg)`,
                transformOrigin: "bottom center",
              }}
            >
              <div
                className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                style={{ left: pwShown ? 20 : isLookingAtEachOther ? 55 : 45 + purplePos.faceX, top: pwShown ? 35 : isLookingAtEachOther ? 65 : 40 + purplePos.faceY }}
              >
                <EyeBall size={18} pupilSize={7} maxDistance={5} pupilColor="#2D2D2D" isBlinking={isPurpleBlinking} forceLookX={pwShown ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined} forceLookY={pwShown ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined} />
                <EyeBall size={18} pupilSize={7} maxDistance={5} pupilColor="#2D2D2D" isBlinking={isPurpleBlinking} forceLookX={pwShown ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined} forceLookY={pwShown ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined} />
              </div>
            </div>

            {/* Black */}
            <div
              ref={blackRef}
              className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: 240,
                width: 120,
                height: 310,
                backgroundColor: "#2D2D2D",
                borderRadius: "8px 8px 0 0",
                zIndex: 2,
                transform: pwShown ? "skewX(0deg)" : isLookingAtEachOther ? `skewX(${blackPos.bodySkew * 1.5 + 10}deg) translateX(20px)` : isTyping || pwHidden ? `skewX(${blackPos.bodySkew * 1.5}deg)` : `skewX(${blackPos.bodySkew}deg)`,
                transformOrigin: "bottom center",
              }}
            >
              <div className="absolute flex gap-6 transition-all duration-700 ease-in-out" style={{ left: pwShown ? 10 : isLookingAtEachOther ? 32 : 26 + blackPos.faceX, top: pwShown ? 28 : isLookingAtEachOther ? 12 : 32 + blackPos.faceY }}>
                <EyeBall size={16} pupilSize={6} maxDistance={4} pupilColor="#2D2D2D" isBlinking={isBlackBlinking} forceLookX={pwShown ? -4 : isLookingAtEachOther ? 0 : undefined} forceLookY={pwShown ? -4 : isLookingAtEachOther ? -4 : undefined} />
                <EyeBall size={16} pupilSize={6} maxDistance={4} pupilColor="#2D2D2D" isBlinking={isBlackBlinking} forceLookX={pwShown ? -4 : isLookingAtEachOther ? 0 : undefined} forceLookY={pwShown ? -4 : isLookingAtEachOther ? -4 : undefined} />
              </div>
            </div>

            {/* Orange */}
            <div ref={orangeRef} className="absolute bottom-0 transition-all duration-700 ease-in-out" style={{ left: 0, width: 240, height: 200, zIndex: 3, backgroundColor: "#FF9B6B", borderRadius: "120px 120px 0 0", transform: pwShown ? "skewX(0deg)" : `skewX(${orangePos.bodySkew}deg)`, transformOrigin: "bottom center" }}>
              <div className="absolute flex gap-8 transition-all duration-200 ease-out" style={{ left: pwShown ? 50 : 82 + orangePos.faceX, top: pwShown ? 85 : 90 + orangePos.faceY }}>
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={pwShown ? -5 : undefined} forceLookY={pwShown ? -4 : undefined} />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={pwShown ? -5 : undefined} forceLookY={pwShown ? -4 : undefined} />
              </div>
            </div>

            {/* Yellow */}
            <div ref={yellowRef} className="absolute bottom-0 transition-all duration-700 ease-in-out" style={{ left: 310, width: 140, height: 230, backgroundColor: "#E8D754", borderRadius: "70px 70px 0 0", zIndex: 4, transform: pwShown ? "skewX(0deg)" : `skewX(${yellowPos.bodySkew}deg)`, transformOrigin: "bottom center" }}>
              <div className="absolute flex gap-6 transition-all duration-200 ease-out" style={{ left: pwShown ? 20 : 52 + yellowPos.faceX, top: pwShown ? 35 : 40 + yellowPos.faceY }}>
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={pwShown ? -5 : undefined} forceLookY={pwShown ? -4 : undefined} />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={pwShown ? -5 : undefined} forceLookY={pwShown ? -4 : undefined} />
              </div>
              <div className="absolute h-[4px] w-20 rounded-full bg-[#2D2D2D] transition-all duration-200 ease-out" style={{ left: pwShown ? 10 : 40 + yellowPos.faceX, top: pwShown ? 88 : 88 + yellowPos.faceY }} />
            </div>
          </div>
        </div>

        <div className="relative z-20 text-sm text-primary-foreground/60">© TTP Agency 2026 — Trust the Process</div>
        <div className="absolute right-1/4 top-1/4 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Right : form */}
      <div className="flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-12 flex items-center justify-center gap-2 text-lg font-semibold lg:hidden">
            <div className="h-8 w-8 overflow-hidden rounded-lg bg-[#14181E]">
              <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
            </div>
            <span>TTP Suite</span>
          </div>

          <div className="mb-10 text-center">
            <h1 className="mb-2 text-3xl font-bold tracking-tight">Bon retour 👋</h1>
            <p className="text-sm text-muted-foreground">Connecte-toi à ton espace TTP</p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="prenom@email.com"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 pr-10"
                />
                <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" defaultChecked />
                <Label htmlFor="remember" className="cursor-pointer font-normal">
                  Se souvenir de moi
                </Label>
              </div>
              <span className="cursor-pointer text-sm font-medium text-primary hover:underline">Mot de passe oublié ?</span>
            </div>

            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            <Button type="submit" className="h-12 w-full text-base font-medium" size="lg" disabled={isLoading}>
              {isLoading ? "Connexion…" : "Se connecter"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

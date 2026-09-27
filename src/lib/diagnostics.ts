/**
 * Diagnostic de santé de l'app. Lance une série de vérifications (connectivité +
 * intégrité des données) et enregistre un instantané horodaté dans le blob agence
 * `diagnosticHistory` → on suit l'état dans le temps (barres d'uptime + incidents).
 *
 * Auto-exécution : `maybeAutoRun()` (appelé au chargement de l'app) relance un audit
 * si le dernier date de plus de 8 h → couvre matin + soir dès que l'app est ouverte.
 * Réservé à l'agence FONDATEUR (les checks lisent des données finance/RLS).
 */
import { supabase } from "@/lib/supabase";
import { saveAppStateKey, getAppState, invalidateAppState } from "@/lib/appState";

const SUPABASE_URL = "https://zizvggziggswhrbuyhuo.supabase.co";

export type DiagStatus = "ok" | "warn" | "down";
export type DiagCheck = { key: string; label: string; status: DiagStatus; detail: string };
export type DiagSnapshot = { ts: number; overall: DiagStatus; checks: DiagCheck[] };

const worst = (a: DiagStatus, b: DiagStatus): DiagStatus =>
  a === "down" || b === "down" ? "down" : a === "warn" || b === "warn" ? "warn" : "ok";
const short = (s: unknown) => String(s ?? "").slice(0, 90);

async function checkDb(): Promise<DiagCheck> {
  try {
    const { count, error } = await supabase.from("creators").select("id", { count: "exact", head: true });
    if (error) return { key: "db", label: "Base de données", status: "down", detail: short(error.message) };
    return { key: "db", label: "Base de données", status: "ok", detail: `Lecture OK${count != null ? ` · ${count} créateurs` : ""}` };
  } catch (e) {
    return { key: "db", label: "Base de données", status: "down", detail: short((e as Error).message) };
  }
}

async function checkAuth(): Promise<DiagCheck> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { key: "auth", label: "Authentification", status: "down", detail: short(error.message) };
    return data.session
      ? { key: "auth", label: "Authentification", status: "ok", detail: "Session active" }
      : { key: "auth", label: "Authentification", status: "warn", detail: "Aucune session" };
  } catch (e) {
    return { key: "auth", label: "Authentification", status: "down", detail: short((e as Error).message) };
  }
}

async function checkStorage(): Promise<DiagCheck> {
  try {
    const { error } = await supabase.storage.from("avatars").list("", { limit: 1 });
    if (error) return { key: "storage", label: "Stockage (photos / docs)", status: "warn", detail: short(error.message) };
    return { key: "storage", label: "Stockage (photos / docs)", status: "ok", detail: "Accessible" };
  } catch (e) {
    return { key: "storage", label: "Stockage (photos / docs)", status: "warn", detail: short((e as Error).message) };
  }
}

async function checkEdge(): Promise<DiagCheck> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-digest`, { method: "OPTIONS" });
    return res.status >= 200 && res.status < 500
      ? { key: "edge", label: "Fonctions serveur (notifs / e-mails)", status: "ok", detail: "Joignables" }
      : { key: "edge", label: "Fonctions serveur (notifs / e-mails)", status: "warn", detail: `Réponse ${res.status}` };
  } catch {
    return { key: "edge", label: "Fonctions serveur (notifs / e-mails)", status: "warn", detail: "Injoignables" };
  }
}

/** Scanne quelques tables à la recherche de lignes cassées (signe d'un bug). */
async function checkIntegrity(): Promise<DiagCheck> {
  try {
    const issues: string[] = [];
    const [inv, cr, td] = await Promise.all([
      supabase.from("invoices").select("ref,amount").limit(2000),
      supabase.from("creators").select("name").limit(2000),
      supabase.from("todos").select("text").limit(2000),
    ]);
    if (inv.error || cr.error || td.error) return { key: "data", label: "Intégrité des données", status: "warn", detail: "Vérification partielle (accès restreint)" };
    const badInv = (inv.data ?? []).filter((r) => !String((r as { ref?: string }).ref ?? "").trim()).length;
    const badCr = (cr.data ?? []).filter((r) => !String((r as { name?: string }).name ?? "").trim()).length;
    const badTd = (td.data ?? []).filter((r) => !String((r as { text?: string }).text ?? "").trim()).length;
    if (badInv) issues.push(`${badInv} facture(s) sans réf.`);
    if (badCr) issues.push(`${badCr} créateur(s) sans nom`);
    if (badTd) issues.push(`${badTd} tâche(s) vide(s)`);
    return issues.length
      ? { key: "data", label: "Intégrité des données", status: "warn", detail: issues.join(" · ") }
      : { key: "data", label: "Intégrité des données", status: "ok", detail: "Aucune anomalie détectée" };
  } catch {
    return { key: "data", label: "Intégrité des données", status: "warn", detail: "Vérification impossible" };
  }
}

/** Lance tous les checks, enregistre l'instantané (plafonné à 60), et le renvoie. */
export async function runDiagnostics(): Promise<DiagSnapshot> {
  const checks = await Promise.all([checkDb(), checkAuth(), checkStorage(), checkEdge(), checkIntegrity()]);
  const overall = checks.reduce((acc, c) => worst(acc, c.status), "ok" as DiagStatus);
  const snap: DiagSnapshot = { ts: Date.now(), overall, checks };
  try {
    invalidateAppState();
    const hist = ((await getAppState())["diagnosticHistory"] as DiagSnapshot[]) ?? [];
    await saveAppStateKey("diagnosticHistory", [snap, ...hist].slice(0, 60));
  } catch {
    /* l'enregistrement de l'historique est best-effort */
  }
  return snap;
}

const EIGHT_H = 8 * 3600 * 1000;
/** Relance un audit si le dernier date de +8 h (→ matin + soir à l'ouverture de l'app). */
export async function maybeAutoRun(): Promise<void> {
  try {
    const hist = ((await getAppState())["diagnosticHistory"] as DiagSnapshot[]) ?? [];
    const last = hist[0];
    if (last && Date.now() - last.ts < EIGHT_H) return;
    await runDiagnostics();
  } catch {
    /* silencieux */
  }
}

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { changeText, throttlePush, type ActivityWhat } from "@/lib/activityEvents";

/** Clé publique VAPID — sûre à exposer côté client (la privée est un secret Supabase). */
export const VAPID_PUBLIC_KEY =
  "BC1CL1rIGuOMhpgrdJmpR4HF9npc3kO_bIv-8uJDv_zbVkQN9b7oq7XR6x9i8ebo_6vFtx3RQOB3dK8trmFbqas";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Signale à l'agence (push immédiat) qu'un créateur a ajouté quelque chose.
 *  Best-effort : ne bloque jamais l'action du créateur en cas d'échec.
 *  `item` : id de l'objet, pour que la notification l'ouvre directement. */
export function notifyAgency(
  kind: "tache" | "idee" | "evenement" | "contact" | "gift" | "facture" | "stats" | "mail" | "contenu" | "tache-maj" | "idee-maj" | "brief-maj",
  creator: string,
  text: string,
  item?: string,
) {
  try {
    supabase.functions
      .invoke("daily-digest", { body: { event: "creator_activity", kind, creator, text: text.slice(0, 140), ...(item ? { item } : {}) } })
      .catch(() => {});
  } catch {
    /* jamais bloquant */
  }
}

/** Notifie UN créateur (push immédiat sur ses appareils) quand l'agence lui
 *  ajoute quelque chose (tâche, document…). Best-effort : jamais bloquant. */
export function notifyCreator(
  kind: "task" | "task-done" | "document" | "brief" | "debrief" | "event" | "mediakit" | "gift" | "idea" | "invoice" | "roadmap" | "mail" | "task-update" | "idea-update" | "brief-update",
  creator: string,
  text: string,
  item?: string,
) {
  const who = creator.trim();
  if (!who) return;
  try {
    supabase.functions
      .invoke("daily-digest", { body: { event: "agency_activity", kind, creator: who, text: text.slice(0, 140), ...(item ? { item } : {}) } })
      .catch(() => {});
  } catch {
    /* jamais bloquant */
  }
}

// ── Du nouveau sur un objet partagé (texte, sous-tâche, avancement…) ─────────
// Le repère « nouveau » dans l'app est écrit par la base (activity_events) ; ici, le
// push sur le téléphone, une seule fois par objet et par changement toutes les 10 min.
const THROTTLE_KEY = "ttp:push-throttle";
let throttleMem: Record<string, number> = {};
function allowPush(key: string): boolean {
  let last = throttleMem;
  try {
    last = { ...JSON.parse(localStorage.getItem(THROTTLE_KEY) || "{}"), ...throttleMem };
  } catch {
    /* stockage indisponible : mémoire de la session */
  }
  const next = throttlePush(last, key, Date.now());
  if (!next) return false;
  throttleMem = next;
  try {
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(next));
  } catch {
    /* sans gravité */
  }
  return true;
}
const CREATOR_KIND = { todo: "task-update", idea: "idea-update", brief: "brief-update" } as const;
const AGENCY_KIND = { todo: "tache-maj", idea: "idee-maj", brief: "brief-maj" } as const;

/** L'agence a écrit du nouveau sur un objet partagé : push aux créateurs concernés. */
export function notifyCreatorsChange(object: "todo" | "idea" | "brief", creators: readonly string[], what: ActivityWhat, title: string, item: string) {
  for (const name of creators) {
    if (!name.trim() || !allowPush(`c:${name}:${object}:${item}:${what}`)) continue;
    // `change` + `title` : le serveur recompose le texte dans la langue du créateur.
    supabase.functions
      .invoke("daily-digest", {
        body: { event: "agency_activity", kind: CREATOR_KIND[object], creator: name.trim(), text: changeText(what, title), item, change: what, title: title.slice(0, 60) },
      })
      .catch(() => {});
  }
}

/** Un créateur a écrit du nouveau sur un objet partagé : push à l'agence. */
export function notifyAgencyChange(object: "todo" | "idea" | "brief", creator: string, what: ActivityWhat, title: string, item: string) {
  if (creator.trim() && allowPush(`a:${creator}:${object}:${item}:${what}`)) notifyAgency(AGENCY_KIND[object], creator, changeText(what, title), item);
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iOS n'autorise le push que si l'app est lancée depuis l'écran d'accueil (mode standalone). */
export function isStandalone(): boolean {
  return (
    (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches === true) ||
    (typeof navigator !== "undefined" && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}
export function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
}

async function getReg(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? (await navigator.serviceWorker.register("/sw.js"));
}

export type PushState =
  | "unsupported" // navigateur incompatible
  | "needs-install" // iOS : à ouvrir depuis l'écran d'accueil
  | "default" // supporté, pas encore activé
  | "denied" // permission refusée
  | "enabled" // abonné ✓
  | "disabled"; // permission accordée mais désabonné

export function usePush() {
  const [state, setState] = useState<PushState>("default");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      setState(isIOS() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) {
      setState("needs-install");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await getReg();
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "enabled" : Notification.permission === "granted" ? "disabled" : "default");
    } catch {
      setState("default");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Doit être appelé depuis un clic utilisateur (exigence iOS).
   *  Renvoie true si l'abonnement est bien enregistré côté serveur. */
  const enable = useCallback(async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const reg = await getReg();
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "default");
        return false;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const j = sub.toJSON();
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          endpoint: j.endpoint,
          p256dh: j.keys?.p256dh,
          auth: j.keys?.auth,
          user_id: auth.user?.id ?? null,
          ua: navigator.userAgent.slice(0, 300),
        },
        { onConflict: "endpoint" },
      );
      if (error) {
        // Le serveur n'a jamais reçu l'abonnement → ne pas afficher « Activées ».
        await sub.unsubscribe().catch(() => {});
        setState("default");
        return false;
      }
      setState("enabled");
      return true;
    } catch {
      setState("default");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await getReg();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("disabled");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  /** Déclenche une notification de test vers SES propres appareils (agence ou créateur). */
  const sendTest = useCallback(async (): Promise<{ ok: boolean; sent: number; total: number; detail: string | null }> => {
    const { data, error } = await supabase.functions.invoke("daily-digest", { body: { event: "self_test" } });
    if (error) return { ok: false, sent: 0, total: 0, detail: error.message ?? null };
    const d = (data as { sent?: number; total?: number; firstError?: string | null } | null) ?? {};
    return { ok: true, sent: d.sent ?? 0, total: d.total ?? 0, detail: d.firstError ?? null };
  }, []);

  return { state, busy, enable, disable, refresh, sendTest };
}

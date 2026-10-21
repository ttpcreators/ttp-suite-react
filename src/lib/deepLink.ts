/**
 * Liens d'ouverture des notifications (« deep links »).
 *
 * Une notification porte une adresse interne :
 *   • `/?open=mails&thread=<id>&box=<partnerships|talent>` : Mails de l'agence, sur ce fil ;
 *   • `/?open=cs-mails&thread=<id>` : onglet Mail de l'espace créateur, sur ce fil.
 * Miroir côté serveur : supabase/functions/_shared/pushPayload.ts (deepLinkUrl).
 *
 * Au démarrage, l'adresse est lue UNE fois puis retirée de la barre d'adresse. Quand
 * l'app est déjà ouverte, le service worker lui transmet l'adresse (message
 * « ttp-open ») au lieu de recharger la page. Il demande aussi où l'on se trouve
 * (« ttp-where ») pour ne pas afficher un mail qu'on est en train de regarder.
 */

export type MailBoxName = "partnerships" | "talent";
export type DeepLink = { open: "mails"; thread?: string; box?: MailBoxName } | { open: "cs-mails"; thread?: string };

const THREAD_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PARAMS = ["open", "thread", "box"];

/** Lit un lien (adresse complète, chemin ou simple « ?… »). null si ce n'en est pas un. */
export function parseDeepLink(input: string): DeepLink | null {
  let q: URLSearchParams;
  try {
    const s = String(input ?? "");
    const i = s.indexOf("?");
    q = new URLSearchParams(i >= 0 ? s.slice(i + 1).split("#")[0] : "");
  } catch {
    return null;
  }
  const open = q.get("open");
  const t = q.get("thread") ?? "";
  const thread = THREAD_RE.test(t) ? t : undefined;
  if (open === "mails") {
    const b = q.get("box");
    const box: MailBoxName | undefined = b === "talent" || b === "partnerships" ? b : undefined;
    return { open, ...(thread ? { thread } : {}), ...(thread && box ? { box } : {}) };
  }
  if (open === "cs-mails") return { open, ...(thread ? { thread } : {}) };
  return null;
}

/** Adresse d'un lien (même forme que le serveur). */
export function buildDeepLink(l: DeepLink): string {
  const q = new URLSearchParams({ open: l.open });
  if (l.thread && THREAD_RE.test(l.thread)) q.set("thread", l.thread);
  if (l.open === "mails" && l.thread && l.box) q.set("box", l.box);
  return `/?${q.toString()}`;
}

/** L'adresse sans les paramètres du lien (le reste est gardé). */
export function stripDeepLink(href: string): string {
  const u = new URL(href, "https://x.invalid");
  for (const p of PARAMS) u.searchParams.delete(p);
  const qs = u.searchParams.toString();
  return `${u.pathname}${qs ? `?${qs}` : ""}${u.hash}`;
}

// ─── Branchement dans l'app (navigateur) ─────────────────────────────────────
const EVENT = "ttp-deeplink";
let pending: DeepLink | null = null;
let started = false;
let place = ""; // page affichée, pour le service worker (« mails », « cs-mails »…)

function deliver(l: DeepLink) {
  pending = l;
  window.dispatchEvent(new CustomEvent<DeepLink>(EVENT, { detail: l }));
}

/** À appeler une fois au démarrage : lit le lien de l'adresse, écoute le service worker. */
export function initDeepLinks(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const first = parseDeepLink(window.location.search);
  if (first) {
    pending = first;
    try {
      window.history.replaceState(window.history.state, "", stripDeepLink(window.location.href));
    } catch {
      /* adresse non modifiable : sans gravité */
    }
  }
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null;
    const port = e.ports?.[0];
    if (d?.type === "ttp-open") {
      const l = parseDeepLink(d.url ?? "");
      if (l) deliver(l);
      port?.postMessage({ ok: !!l });
    } else if (d?.type === "ttp-where") {
      port?.postMessage({ place: document.visibilityState === "visible" ? place : "" });
    }
  });
}

/** Page affichée (agence : id de la vue ; créateur : « cs-<onglet> »). */
export function setCurrentPlace(p: string): void {
  place = p;
}

/** Prend le lien en attente (une seule fois), s'il correspond au filtre. */
export function takeDeepLink(accept: (l: DeepLink) => boolean): DeepLink | null {
  if (!pending || !accept(pending)) return null;
  const l = pending;
  pending = null;
  return l;
}

/** S'abonne aux liens qui arrivent pendant que l'app est ouverte. */
export function onDeepLink(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/* TTP Suite — service worker.
   1. Web Push : reçoit les notifications et les affiche, même app fermée, comme les
      grandes apps : icône de l'app + petite icône blanche (barre d'état Android),
      un mail par fil (le suivant du même fil remplace le précédent), au-delà de 3 fils
      un résumé « N nouveaux mails », bouton « Ouvrir », pastille sur l'icône de l'app.
      Un clic ouvre le bon endroit (le fil du mail) dans la fenêtre déjà ouverte.
      Format des charges : supabase/functions/_shared/pushPayload.ts.
   2. Ouverture rapide / hors ligne : les fichiers de l'app (JS, CSS, images) sont
      gardés sur l'appareil ; la page d'accueil est toujours redemandée au réseau
      (dernière version, jamais une copie périmée du navigateur), avec repli sur la
      copie gardée seulement hors ligne. Une page d'accueil périmée pointe vers des
      fichiers supprimés par la mise en ligne suivante : écran « Mise à jour de l'app ». Les données (Supabase, Google…) ne passent JAMAIS
      par ce cache : seules les requêtes vers app.ttpcreators.pro sont concernées. */

const SHELL = "ttp-shell-v2"; // page d'accueil (navigations)
const ASSETS = "ttp-assets-v2"; // fichiers versionnés /assets/* + images
const META = "ttp-meta"; // petits états du service worker (pastille de l'icône)
const KEEP = [SHELL, ASSETS, META];
const MAX_ASSETS = 400;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then((c) => c.add("/")).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("ttp-") && !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Google, avatars… : jamais touchés
  if (req.mode === "navigate") {
    if (url.pathname.startsWith("/yt-callback")) return; // page relais du retour de Google : jamais gardée
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webp|jpe?g|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  }
});

// Page d'accueil : le réseau, revalidé auprès du serveur (pas le cache du navigateur,
// gardé 10 min par GitHub Pages) ; la copie gardée ne sert que hors ligne.
// Chaque page garde SA copie : l'accord du connecteur (/connecteur/) ne remplace jamais
// la page de l'app (sinon, hors ligne, l'app s'ouvrait sur l'accord Claude).
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const path = new URL(req.url).pathname;
  const key = path === "/index.html" ? "/" : path;
  try {
    const res = await fetch(req.url, { cache: "no-cache", credentials: "same-origin" });
    // Réponse venue d'une redirection (« /connecteur » → « /connecteur/ ») : le navigateur
    // refuse de l'afficher telle quelle pour une navigation, on lui renvoie la redirection.
    if (res.redirected) return Response.redirect(res.url, 302);
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match(key)) || Response.error();
  }
}

// Fichiers versionnés (le nom change à chaque mise en ligne) : la copie gardée d'abord.
async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {});
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ASSETS) return;
  await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)));
}

// ─── Notifications ──────────────────────────────────────────────────────────
const ICON = "/icon-192.png?v=3"; // icône en couleur de l'app
const BADGE = "/badge-96.png"; // monogramme blanc sur fond transparent (barre d'état Android)
const MAX_MAIL_NOTES = 3; // au-delà : un seul résumé « N nouveaux mails »
const MAIL_KINDS = ["mail", "mail-summary", "creator-mail", "creator-mail-summary"];
// Safari (iPhone, Mac) peut couper l'abonnement si un push n'affiche rien : là, on
// affiche toujours, en silence quand on regarde déjà les mails.
const APPLE_WEBKIT = /AppleWebKit/.test(self.navigator.userAgent) && !/Chrome|Chromium|Android|Edg\//.test(self.navigator.userAgent);

const isCreatorKind = (k) => k === "creator-mail" || k === "creator-mail-summary";
const manyText = (n, lang) => (lang === "en" ? `${n} new emails` : `${n} nouveaux mails`);
const openText = (lang) => (lang === "en" ? "Open" : "Ouvrir");

// Pastille de l'icône : le compteur est gardé dans le cache META (le service worker
// peut être arrêté entre deux pushs) ; l'app le remet au bon chiffre (message « ttp-badge »).
async function readBadge() {
  try {
    const res = await (await caches.open(META)).match("/__badge");
    return res ? Number(await res.text()) || 0 : 0;
  } catch {
    return 0;
  }
}
async function writeBadge(n) {
  try {
    await (await caches.open(META)).put("/__badge", new Response(String(n)));
  } catch {
    /* sans gravité */
  }
}
async function bumpBadge(by) {
  const n = (await readBadge()) + by;
  await writeBadge(n);
  try {
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
  } catch {
    /* pastille non prise en charge */
  }
}

// Question à une fenêtre de l'app, réponse attendue au plus `ms` millisecondes.
function ask(client, msg, ms) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data || null);
    };
    try {
      client.postMessage(msg, [ch.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// Regarde-t-on déjà les mails (fenêtre au premier plan, page Mails / onglet Mail) ?
async function viewingMails(kind) {
  const want = isCreatorKind(kind) ? "cs-mails" : "mails";
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) {
    if (!c.focused || c.visibilityState !== "visible") continue;
    const r = await ask(c, { type: "ttp-where" }, 400);
    if (r && r.place === want) return true;
  }
  return false;
}

async function showPush(data) {
  const kind = data.kind || "info";
  const lang = data.lang === "en" ? "en" : "fr";
  const isMail = MAIL_KINDS.includes(kind);
  let title = data.title || "TTP Suite";
  let body = data.body || "";
  let tag = data.tag || "ttp";
  let url = data.url || "/";
  let count = Math.max(1, Number(data.count) || 1);

  await bumpBadge(isMail ? count : 1);

  let silent = false;
  if (isMail && (await viewingMails(kind))) {
    if (!APPLE_WEBKIT) return; // déjà sous les yeux : la pastille suffit
    silent = true;
  }

  const shown = await self.registration.getNotifications();
  if (isMail) {
    // Plus de 3 fils affichés : on les remplace par un seul résumé, comme Android / Gmail.
    const mailNotes = shown.filter((n) => n.tag.startsWith("mail:") && n.tag !== tag);
    const threadNotes = mailNotes.filter((n) => n.tag !== "mail:summary");
    if (tag !== "mail:summary" && threadNotes.length >= MAX_MAIL_NOTES) {
      let total = count;
      const names = [data.sender || title];
      for (const n of mailNotes) {
        const d = n.data || {};
        total += Math.max(1, Number(d.count) || 1);
        for (const s of d.senders || [d.sender]) if (s && !names.includes(s)) names.push(s);
        n.close();
      }
      title = manyText(total, lang);
      body = names.slice(0, 3).join(", ") + (names.length > 3 ? (lang === "en" ? ` and ${names.length - 3} more` : ` et ${names.length - 3} autre${names.length - 3 > 1 ? "s" : ""}`) : "");
      tag = "mail:summary";
      url = isCreatorKind(kind) ? "/?open=cs-mails" : "/?open=mails";
      count = total;
      data = { ...data, kind: isCreatorKind(kind) ? "creator-mail-summary" : "mail-summary", senders: names };
    } else if (tag === "mail:summary") {
      // Nouveau résumé : il reprend les fils déjà affichés (fermés) et le résumé précédent.
      const old = shown.find((n) => n.tag === "mail:summary");
      let total = count;
      for (const n of mailNotes) {
        total += Math.max(1, Number((n.data || {}).count) || 1);
        n.close();
      }
      if (old) total += Math.max(1, Number((old.data || {}).count) || 1);
      if (total !== count) {
        title = manyText(total, lang);
        count = total;
      }
    }
  }

  const replacing = shown.some((n) => n.tag === tag);
  const options = {
    body,
    icon: ICON,
    badge: BADGE,
    tag,
    renotify: replacing && !silent, // re-sonner seulement quand on remplace une notification du même tag
    silent,
    timestamp: Number(data.ts) || Date.now(),
    vibrate: silent ? undefined : [70, 40, 70],
    lang,
    data: { url, kind: data.kind || kind, count, sender: data.sender || "", senders: data.senders || undefined, threadId: data.threadId || "" },
  };
  if (data.image) options.image = data.image;
  if (isMail) options.actions = [{ action: "open", title: openText(lang) }];
  await self.registration.showNotification(title, options);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    showPush(data).catch(() =>
      // Filet : une notification simple plutôt que rien (exigé par les navigateurs).
      self.registration.showNotification(data.title || "TTP Suite", { body: data.body || "", icon: ICON, badge: BADGE, tag: data.tag || "ttp", data: { url: data.url || "/" } }),
    ),
  );
});

// L'app donne le vrai compteur (cloche / mails non vus) : la pastille repart de là.
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "ttp-badge") event.waitUntil(writeBadge(Math.max(0, Number(d.count) || 0)));
});

// Clic (ou bouton « Ouvrir ») : la fenêtre déjà ouverte va au bon endroit sans se
// recharger (message « ttp-open » à l'app) ; sinon on la dirige vers l'adresse ;
// sans fenêtre ouverte, on en ouvre une.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  // Adresse interne seulement (« //autre-site » commence aussi par « / »).
  const url = new URL(raw.startsWith("/") && !raw.startsWith("//") ? raw : "/", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = list.find((c) => c.focused) || list.find((c) => c.visibilityState === "visible") || list[0];
      if (!client) {
        if (self.clients.openWindow) await self.clients.openWindow(url);
        return;
      }
      let target = client;
      try {
        target = (await client.focus()) || client;
      } catch {
        /* focus refusé : on continue */
      }
      if (raw === "/") return;
      const r = await ask(target, { type: "ttp-open", url }, 1500);
      if (r && r.ok) return;
      try {
        if ("navigate" in target) await target.navigate(url);
      } catch {
        if (self.clients.openWindow) await self.clients.openWindow(url);
      }
    })(),
  );
});

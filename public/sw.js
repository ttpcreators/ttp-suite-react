/* TTP Suite — service worker.
   1. Web Push : reçoit les notifications et les affiche, même app fermée.
   2. Ouverture rapide / hors ligne : les fichiers de l'app (JS, CSS, images) sont
      gardés sur l'appareil ; la page d'accueil est toujours redemandée au réseau
      (dernière version, jamais une copie périmée du navigateur), avec repli sur la
      copie gardée seulement hors ligne. Une page d'accueil périmée pointe vers des
      fichiers supprimés par la mise en ligne suivante : écran « Mise à jour de l'app ». Les données (Supabase, Google…) ne passent JAMAIS
      par ce cache : seules les requêtes vers app.ttpcreators.pro sont concernées. */

const SHELL = "ttp-shell-v2"; // page d'accueil (navigations)
const ASSETS = "ttp-assets-v2"; // fichiers versionnés /assets/* + images
const KEEP = [SHELL, ASSETS];
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
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webp|jpe?g|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  }
});

// Page d'accueil : le réseau, revalidé auprès du serveur (pas le cache du navigateur,
// gardé 10 min par GitHub Pages) ; la copie gardée ne sert que hors ligne.
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req.url, { cache: "no-cache", credentials: "same-origin" });
    if (res.ok) cache.put("/", res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match("/")) || Response.error();
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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TTP Suite";
  const options = {
    body: data.body || "",
    icon: "/logo.png?v=2",
    badge: "/logo.png?v=2",
    tag: data.tag || "ttp-digest",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

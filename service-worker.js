const CACHE_NAME = "presidenten-2.0.0-beta.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./game.js",
  "./multiplayer.js",
  "./settings.js",
  "./ui-components.js",
  "./version.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const network = fetch(event.request);
    event.waitUntil(
      network
        .then((response) => response.ok && caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", response.clone())))
        .catch(() => {})
    );
    event.respondWith(
      network.catch(() => caches.match("./index.html"))
    );
    return;
  }

  const network = fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  event.respondWith(
    caches.match(event.request).then((cached) => cached || network)
  );
});

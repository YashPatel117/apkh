// Service worker: makes the app installable and lets it open offline.
// Pages are network-first: each one loaded online is kept, so offline the app
// shell still opens (the library then comes from the copy in localStorage).
// API calls always go to the network; build assets are cache-first.
const CACHE = "kh-static-v2";
const OFFLINE_URL = "/offline.html";
const SHELL_URLS = ["/notes", OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // The notes page is best-effort: the offline page alone is enough to install.
      .then((cache) => cache.add(OFFLINE_URL).then(() => cache.addAll(SHELL_URLS).catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function keep(request, response) {
  if (response.ok && response.type === "basic" && !response.redirected) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Kept by path: the shell doesn't depend on the query string.
    event.respondWith(
      fetch(request)
        .then((res) => keep(new Request(url.pathname), res))
        .catch(async () => (await caches.match(url.pathname)) || caches.match(OFFLINE_URL))
    );
    return;
  }

  // Immutable build assets and icons: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => keep(request, res))));
  }
});

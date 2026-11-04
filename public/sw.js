/* Tuki caches public resources only. No background sync, tokens or financial queue. */
const PUBLIC_CACHE = "tuki-public-brand-v2";
const OWNED_PREFIX = "tuki-public-";
const OFFLINE_URL = "/offline.html";
const ICON_PATHS = new Set([
  "/icons/icon-192.png", "/icons/icon-512.png",
]);

function canStore(response, immutable = false) {
  if (!response.ok || response.redirected || response.type === "opaque") return false;
  const policy = response.headers.get("cache-control") || "";
  const vary = response.headers.get("vary") || "";
  if (/no-store|private|no-cache/i.test(policy) || /(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/i.test(vary)) return false;
  return /(?:^|,)\s*public\s*(?:,|$)/i.test(policy) && (!immutable || /(?:^|,)\s*immutable\s*(?:,|$)/i.test(policy));
}

async function installPublicResources() {
  const cache = await caches.open(PUBLIC_CACHE);
  const response = await fetch(OFFLINE_URL, { credentials: "omit", cache: "reload" });
  if (!canStore(response)) throw new Error("Public offline page is not cacheable.");
  await cache.put(OFFLINE_URL, response);
  // Icon failures must not turn public navigation recovery into an install failure.
  await Promise.all([...ICON_PATHS].map(async path => {
    try {
      const icon = await fetch(path, { credentials: "omit", cache: "reload" });
      if (canStore(icon) && /^image\/png(?:;|$)/i.test(icon.headers.get("content-type") || "")) await cache.put(path, icon);
    } catch { /* Retry through ordinary network loading, never replay an action. */ }
  }));
}

self.addEventListener("install", event => {
  event.waitUntil(installPublicResources());
  // Deliberately no skipWaiting: finish operations and close all Tuki windows to update.
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(OWNED_PREFIX) && name !== PUBLIC_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function excluded(request, url) {
  return request.method !== "GET" || url.origin !== self.location.origin || url.searchParams.has("_rsc") ||
    request.headers.has("authorization") || request.headers.has("rsc") || request.headers.has("next-action") ||
    request.headers.has("next-router-prefetch") || request.headers.has("next-router-segment-prefetch") ||
    /^\/(?:api|auth)(?:\/|$)/.test(url.pathname) ||
    /\/(?:exportar|comprobante|ticket)(?:\/|$)/.test(url.pathname);
}

self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (excluded(request, url)) return;

  if (request.mode === "navigate" && request.destination === "document") {
    // Private HTML always goes to the network and is NEVER inserted in Cache Storage.
    // A public recovery page replaces only failed full-document requests, never RSC.
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(PUBLIC_CACHE);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }));
    return;
  }

  // Public static assets use canonical URLs only. Ordinary document filters may
  // still recover to the public offline page without storing their HTML or query.
  if (url.search) return;

  const icon = ICON_PATHS.has(url.pathname);
  const versionedStatic = url.pathname.startsWith("/_next/static/") && /\.(?:js|css|woff2?)$/.test(url.pathname);
  if (!icon && !versionedStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(PUBLIC_CACHE);
    if (icon) {
      try {
        const response = await fetch(request);
        if (canStore(response) && /^image\/png(?:;|$)/i.test(response.headers.get("content-type") || "")) await cache.put(request, response.clone());
        else await cache.delete(request);
        return response;
      } catch (error) {
        const stored = await cache.match(request);
        if (stored) return stored;
        throw error;
      }
    }
    const stored = await cache.match(request);
    if (stored) return stored;
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    const publicType = icon ? /^image\/png(?:;|$)/i.test(type) : /^(?:text\/(?:css|javascript)|application\/(?:javascript|x-javascript)|font\/(?:woff|woff2)|application\/font-woff)(?:;|$)/i.test(type);
    if (publicType && canStore(response, versionedStatic)) await cache.put(request, response.clone());
    return response;
  })());
});

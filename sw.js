/* ============================================================
   RAWX MOTION LAB - SERVICE WORKER
   Caches UI assets, thumbnails, posters & catalog data for
   Mega Wall & Super Album offline / intermittent connectivity.
============================================================ */

const CACHE_NAME = 'rawx-motion-lab-v2';
const THUMB_CACHE_NAME = 'rawx-thumbnails-v2';

// Core UI shell assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/desktop.css',
  '/super.css',
  '/super-album.css',
  '/chatbot.css',
  '/content-studio.css',
  '/super-album.js',
  '/app.js',
  '/super.js',
  '/chatbot.js',
  '/content-studio.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Core precache partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== THUMB_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Helper to notify clients that cached content was served
function notifyClientCacheHit(url) {
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'RAWX_CACHE_SERVED',
        url: url,
        timestamp: Date.now()
      });
    });
  }).catch(() => {});
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Ignore Range requests (video media streaming chunks shouldn't be fully cached in SW)
  if (req.headers.has('range')) return;

  // 1. Thumbnail & Poster Strategy: Stale-While-Revalidate with dedicated thumb cache
  const isImageOrPoster =
    req.destination === 'image' ||
    url.pathname.match(/\.(png|jpe?g|webp|svg|gif|avif)$/i) ||
    url.hostname.includes('imagedelivery.net') ||
    url.hostname.includes('drive.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.pathname.includes('/posters/') ||
    url.searchParams.has('w=');

  if (isImageOrPoster) {
    event.respondWith(
      caches.open(THUMB_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          notifyClientCacheHit(req.url);
        }

        const fetchPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached); // On offline/network failure, return cached image

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 2. Google Fonts / External CDNs: Cache First with network fallback
  if (url.origin.includes('fonts.googleapis.com') || url.origin.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          notifyClientCacheHit(req.url);
          return cached;
        }
        try {
          const res = await fetch(req);
          if (res.status === 200) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return cached;
        }
      })
    );
    return;
  }

  // 3. UI App Shell Assets (HTML/CSS/JS): Stale-While-Revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached && !navigator.onLine) {
        notifyClientCacheHit(req.url);
      }

      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && req.url.startsWith(self.location.origin)) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => {
          if (cached) {
            notifyClientCacheHit(req.url);
            return cached;
          }
        });

      return cached || networkFetch;
    })
  );
});

// Familien-App 2.0 – Service Worker
// Cache-First für App-Shell, Network-First für Firebase / Wetter / Fonts.
// Bei jedem Deployment CACHE_VERSION hochzählen → erzwingt frischen Cache.

const CACHE_VERSION = 'v2.1.0';
const SHELL_CACHE = `heinecke-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `heinecke-runtime-${CACHE_VERSION}`;

// Pfade relativ zum SW-Scope (also /v2/ auf GitHub Pages)
const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

// ---------- Install: Shell vorab cachen ----------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ---------- Activate: alte Caches aufräumen ----------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Nur GET cachen
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Firebase Realtime DB → IMMER Network (Daten müssen frisch sein)
    if (url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('firebasedatabase.app') ||
        url.hostname.includes('googleapis.com')) {
        return; // Browser-Default → kein SW-Eingriff
    }

    // Open-Meteo Wetter → Network-First, fallback auf Cache
    if (url.hostname.includes('open-meteo.com')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // Google Fonts → Cache-First (CSS) + Stale-While-Revalidate
    if (url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    // Firebase SDK von gstatic → Cache-First
    if (url.hostname.includes('gstatic.com')) {
        event.respondWith(cacheFirst(req));
        return;
    }

    // Eigene App-Shell (same-origin) → Cache-First mit Network-Fallback
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(req));
        return;
    }
});

// ---------- Strategien ----------
async function cacheFirst(req) {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, fresh.clone());
        }
        return fresh;
    } catch (e) {
        // Offline & nicht im Cache → Fallback auf index.html für Navigations-Requests
        if (req.mode === 'navigate') {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
        }
        throw e;
    }
}

async function networkFirst(req) {
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, fresh.clone());
        }
        return fresh;
    } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw e;
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
    }).catch(() => cached);
    return cached || networkPromise;
}

// ---------- Optional: Hard-Refresh Trigger via Message ----------
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

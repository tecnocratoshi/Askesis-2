/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file sw.js
 * @description Service Worker: Proxy de Rede e Gerenciador de Cache (Offline Engine).
 */

try {
    importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (e) {
    // Non-blocking failure for optional SDK
}

// CONSTANTS (Version Bump to Force Update)
const CACHE_NAME = 'askesis-v1769646734971';

// PERF: Static Asset List (Pre-allocated)
const CACHE_FILES = [
    '/',
    '/index.html',
    '/bundle.js',
    '/bundle.css',
    '/manifest.json',
    '/locales/pt.json',
    '/locales/en.json',
    '/locales/es.json',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg',
    '/icons/icon-maskable-512.svg',
    '/icons/badge.svg'
];

const RELOAD_OPTS = { cache: 'reload' };
const HTML_FALLBACK = '/index.html';
const MATCH_OPTS = { ignoreSearch: true };
const NETWORK_TIMEOUT_MS = 3000;

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Network Timeout')), ms));

const updateShellCache = (res) => {
    if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(HTML_FALLBACK, copy));
    }
    return res;
};

// --- INSTALL & ACTIVATE ---

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.all(CACHE_FILES.map(url => 
                fetch(url, RELOAD_OPTS).then(res => {
                    if (!res.ok) throw new Error(`[SW] Failed to cache: ${url}`);
                    return cache.put(url, res);
                })
            ));
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            self.registration.navigationPreload ? self.registration.navigationPreload.enable() : Promise.resolve(),
            caches.keys().then(keys => Promise.all(
                keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())
            ))
        ])
    );
});

// --- BACKGROUND SYNC ---

/**
 * BACKGROUND SYNC EVENT:
 * Disparado pelo navegador quando a conectividade é restabelecida para tags registradas.
 */
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-cloud-pending') {
        console.log('[SW] Conectividade recuperada. Solicitando sincronização às abas ativas...');
        event.waitUntil(
            self.clients.matchAll({ type: 'window' }).then(clients => {
                // Notifica todas as abas abertas para que tentem sincronizar agora
                clients.forEach(client => {
                    client.postMessage({ type: 'REQUEST_SYNC' });
                });
            })
        );
    }
});

// --- FETCH PHASE ---

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url); 

    if (url.pathname.startsWith('/api/')) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const preloadResp = await event.preloadResponse;
                    if (preloadResp) return updateShellCache(preloadResp);
                    const networkResp = await Promise.race([fetch(req), timeout(NETWORK_TIMEOUT_MS)]);
                    return updateShellCache(networkResp);
                } catch (error) {
                    return caches.match(HTML_FALLBACK, MATCH_OPTS);
                }
            })()
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(networkResponse => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') return networkResponse;
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(req, responseToCache));
                return networkResponse;
            }).catch(() => new Response(null, { status: 408 }));
        })
    );
});
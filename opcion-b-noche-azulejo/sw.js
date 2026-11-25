/* VOEG · service worker: funciona sin internet (app shell en caché) */
const CACHE = 'voeg-b-v1';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest',
  '../shared/base.css', '../shared/app.js', '../shared/plugins.js', '../shared/xlsx.js',
  '../shared/icons/icon.svg', '../shared/icons/icon-192.png', '../shared/icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;            // POST al servidor (wavelet/IA) nunca se cachea
  const u = new URL(r.url);
  if (u.origin !== location.origin && !u.host.includes('fonts.')) return;
  e.respondWith(caches.match(r).then(hit => {
    const red = fetch(r).then(res => { if (res.ok || res.type === 'opaque') caches.open(CACHE).then(c => c.put(r, res.clone())); return res; }).catch(() => hit);
    return hit || red;
  }));
});

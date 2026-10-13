// Service Worker: hält die App-Dateien offline bereit (Daten kommen immer frisch von GitHub, mit Zwischenspeicher in der App)
const CACHE = "traderjim-v4";
const DATEIEN = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN))));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // GitHub-API und CDN nicht anfassen
  e.respondWith(fetch(e.request).then(r => { const k = r.clone(); caches.open(CACHE).then(c => c.put(e.request, k)); return r; })
    .catch(() => caches.match(e.request)));
});

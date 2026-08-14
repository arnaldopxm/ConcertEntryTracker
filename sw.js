// sw.js — service worker de la taquilla.
//
// Dos estrategias y ninguna más:
//   · App shell (HTML, CSS, JS, manifest, iconos): cache-first. La app abre
//     aunque el bar no tenga cobertura.
//   · SDK de Firebase en gstatic: cache-first también. Son URLs versionadas e
//     inmutables; sin ellas en caché, recargar la página sin red rompería la
//     app entera.
//   · API de Firestore (googleapis.com): nunca se toca. El SDK ya tiene su
//     propia caché en IndexedDB y su cola de escrituras offline.
//
// Sube el número de CACHE al publicar cambios: invalida la caché anterior.

const CACHE = 'taquilla-v1';

const SHELL = [
  './',
  './index.html',
  './app.js',
  './store.js',
  './qr.js',
  './firebase-config.js',
  './views/door.js',
  './views/desk.js',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un recurso falla; así no queda una caché a medias.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Firestore y auth: siempre a la red, sin intermediarios.
  if (/(^|\.)googleapis\.com$/.test(url.hostname) || url.hostname === 'firebaseinstallations.googleapis.com') {
    return;
  }

  // SDK de Firebase: cache-first, y si no está, se guarda al vuelo.
  if (url.hostname === 'www.gstatic.com') {
    evento.respondWith(cacheAndUpdate(peticion));
    return;
  }

  // Solo gestionamos lo que es nuestro.
  if (url.origin !== self.location.origin) return;

  // Navegaciones: el shell cacheado, con la red como respaldo.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      caches.match('./index.html').then((res) => res || fetch(peticion))
    );
    return;
  }

  evento.respondWith(cacheAndUpdate(peticion));
});

async function cacheAndUpdate(peticion) {
  const cache = await caches.open(CACHE);
  const enCache = await cache.match(peticion, { ignoreSearch: false });
  if (enCache) return enCache;

  const respuesta = await fetch(peticion);
  if (respuesta && respuesta.ok && respuesta.type !== 'opaque') {
    cache.put(peticion, respuesta.clone());
  }
  return respuesta;
}

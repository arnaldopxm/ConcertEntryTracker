// @ts-check
/// <reference lib="webworker" />
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

/** El scope de un service worker no es Window: TS necesita que se lo digamos. */
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

const CACHE = 'taquilla-v3';

const SHELL = [
  './',
  './index.html',
  './app.js',
  './store.js',
  './calc.js',
  './errores.js',
  './mis-eventos.js',
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

sw.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un recurso falla; así no queda una caché a medias.
      .then((cache) => cache.addAll(SHELL))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => sw.clients.claim())
  );
});

/**
 * La API de Firestore no se cachea nunca: el SDK ya trae su propia caché en
 * IndexedDB y su cola de escrituras. Meter el service worker por medio solo
 * podría servir respuestas viejas de algo que ya está resuelto mejor.
 *
 * @param {URL} url
 * @returns {boolean}
 */
function esAPIdeGoogle(url) {
  return /(^|\.)googleapis\.com$/.test(url.hostname);
}

sw.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Firestore, auth e instalaciones: siempre a la red, sin intermediarios.
  if (esAPIdeGoogle(url)) return;

  // SDK de Firebase: cache-first, y si no está, se guarda al vuelo.
  if (url.hostname === 'www.gstatic.com') {
    evento.respondWith(cacheAndUpdate(peticion));
    return;
  }

  // Solo gestionamos lo que es nuestro.
  if (url.origin !== sw.location.origin) return;

  // Navegaciones: el shell cacheado, con la red como respaldo.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      caches.match('./index.html').then((res) => res || fetch(peticion))
    );
    return;
  }

  evento.respondWith(cacheAndUpdate(peticion));
});

/**
 * @param {Request} peticion
 * @returns {Promise<Response>}
 */
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

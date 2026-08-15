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
// El nombre de CACHE lo genera scripts/version.mjs a partir del hash del
// contenido publicado. NO se toca a mano: `npm run version` lo pone al día y
// `npm run version:check` (en CI) falla si alguien lo olvida. Cambiar un byte
// de la app cambia el hash, con lo que cambia el nombre de la caché y el
// navegador ve un sw.js distinto: sin eso, un despliegue podría no llegar nunca
// a un móvil que ya tiene la app instalada.
//
// La actualización NO se aplica sola. Un service worker nuevo se queda en
// espera y la app ofrece un botón: recargar por sorpresa a quien está contando
// gente en la puerta sería peor que ir una noche con la versión anterior.

/** El scope de un service worker no es Window: TS necesita que se lo digamos. */
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

const CACHE = 'taquilla-1.0.0-99debb25cafd';

const SHELL = [
  './',
  './index.html',
  './app.js',
  './version.js',
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
  evento.waitUntil(precachear());
});

/**
 * Precacheo con `cache: 'reload'`, que es el detalle que se olvida siempre:
 * cache.addAll() pasa por la caché HTTP del navegador, y GitHub Pages sirve con
 * max-age. Sin forzar red, un service worker nuevo puede acabar guardando los
 * bytes VIEJOS de los archivos y dejar la app en un estado imposible de
 * diagnosticar. Si algo falla, la instalación entera falla y se conserva la
 * versión anterior, que funcionaba.
 *
 * @returns {Promise<void>}
 */
async function precachear() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    SHELL.map(async (recurso) => {
      const respuesta = await fetch(new Request(recurso, { cache: 'reload' }));
      if (!respuesta.ok) throw new Error(`No se pudo precachear ${recurso}: ${respuesta.status}`);
      await cache.put(recurso, respuesta);
    })
  );
}

// La app pide el relevo cuando el usuario acepta actualizar.
sw.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'SKIP_WAITING') sw.skipWaiting();
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

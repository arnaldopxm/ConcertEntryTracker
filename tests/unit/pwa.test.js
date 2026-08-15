// @ts-check
// Comprobaciones del empaquetado: manifest, service worker y rutas.
//
// El test que más disgustos evita es el de la lista de precacheo: si mañana se
// añade un módulo y nadie lo mete en sw.js, la app instalada en el móvil deja de
// abrir sin cobertura. Aquí salta antes de llegar al bar.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} rel */
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('el manifest es válido y sirve en una subruta', () => {
  const manifest = JSON.parse(leer('manifest.webmanifest'));

  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  assert.equal(manifest.theme_color, '#0B0B0F');
  assert.equal(manifest.background_color, '#0B0B0F');
});

test('los iconos del manifest existen y cubren los tamaños que pide una PWA', () => {
  const manifest = JSON.parse(leer('manifest.webmanifest'));
  const tamaños = manifest.icons.map((/** @type {{sizes: string}} */ i) => i.sizes);

  assert.ok(tamaños.includes('192x192'));
  assert.ok(tamaños.includes('512x512'));
  assert.ok(
    manifest.icons.some((/** @type {{purpose: string}} */ i) => i.purpose === 'maskable'),
    'hace falta un icono maskable para que Android no lo recorte mal'
  );

  for (const icono of manifest.icons) {
    assert.ok(icono.src.startsWith('./'), `${icono.src} debe ser una ruta relativa`);
    const archivo = path.join(RAIZ, icono.src);
    assert.ok(fs.existsSync(archivo), `falta el archivo ${icono.src}`);
    assert.ok(fs.statSync(archivo).size > 0);
  }
});

/**
 * Sigue los imports desde app.js y devuelve todos los módulos locales que la
 * app acaba cargando, estáticos y dinámicos. Así la lista no se escribe a mano
 * y añadir un módulo nuevo no puede pasar desapercibido.
 *
 * @returns {Set<string>} rutas relativas a la raíz, en formato './x.js'
 */
function modulosDeLaApp() {
  const pendientes = ['app.js'];
  const vistos = new Set();

  while (pendientes.length) {
    const actual = pendientes.pop();
    if (!actual || vistos.has(actual)) continue;
    vistos.add(actual);

    const codigo = leer(actual);
    const referencias = [
      ...codigo.matchAll(/from\s+'(\.[^']+)'/g),
      ...codigo.matchAll(/import\('(\.[^']+)'\)/g)
    ].map((m) => m[1]);

    for (const ref of referencias) {
      const resuelto = path.normalize(path.join(path.dirname(actual), ref)).replace(/\\/g, '/');
      pendientes.push(resuelto);
    }
  }

  return new Set([...vistos].map((m) => './' + m));
}

test('el service worker precachea todos los módulos de la app', () => {
  const sw = leer('sw.js');
  const lista = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(lista, 'no se encuentra la lista SHELL en sw.js');

  const precacheados = [...lista[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  for (const modulo of modulosDeLaApp()) {
    assert.ok(
      precacheados.includes(modulo),
      `sw.js no precachea ${modulo}: la app instalada dejaría de abrir sin cobertura`
    );
  }

  for (const recurso of ['./index.html', './styles.css', './manifest.webmanifest']) {
    assert.ok(precacheados.includes(recurso), `sw.js no precachea ${recurso}`);
  }

  // Y todo lo precacheado tiene que existir de verdad.
  for (const recurso of precacheados) {
    if (recurso === './') continue;
    assert.ok(fs.existsSync(path.join(RAIZ, recurso)), `sw.js precachea ${recurso}, que no existe`);
  }
});

test('el service worker nunca cachea la API de Firestore', () => {
  const sw = leer('sw.js');
  assert.match(sw, /googleapis\.com/, 'debe reconocer el dominio de la API');
  assert.match(
    sw,
    /function esAPIdeGoogle\(url\)/,
    'la guarda tiene que estar definida, no solo invocada'
  );
  assert.match(
    sw,
    /if \(esAPIdeGoogle\(url\)\) return;/,
    'las peticiones a googleapis salen del handler sin pasar por la caché'
  );

  // Y no aparecen en la lista de precacheo por ningún lado.
  const lista = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(lista);
  assert.doesNotMatch(lista[1], /googleapis/);
});

test('la caché del service worker está versionada por contenido', () => {
  // El detalle de cómo se genera vive en tests/unit/version.test.js.
  assert.match(leer('sw.js'), /const CACHE = 'taquilla-\d+\.\d+\.\d+-[0-9a-f]{12}';/);
});

test('index.html solo usa rutas relativas', () => {
  const html = leer('index.html');
  const rutas = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

  assert.ok(rutas.length > 0);
  for (const ruta of rutas) {
    assert.ok(
      ruta.startsWith('./'),
      `${ruta} no es relativa y rompería el despliegue en una subruta de GitHub Pages`
    );
    assert.ok(fs.existsSync(path.join(RAIZ, ruta)), `falta el archivo ${ruta}`);
  }
});

test('index.html declara el tema oscuro y el viewport de móvil', () => {
  const html = leer('index.html');
  assert.match(html, /name="theme-color" content="#0B0B0F"/);
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /<html lang="es">/);
});

test('la app se carga como módulo ES, sin bundler', () => {
  const html = leer('index.html');
  assert.match(html, /<script type="module" src="\.\/app\.js">/);
  assert.doesNotMatch(html, /require\(|webpack|vite/i);
});

test('el SDK de Firebase se carga por CDN con la versión clavada', () => {
  const store = leer('store.js');
  const urls = [...store.matchAll(/https:\/\/www\.gstatic\.com\/firebasejs\/([\d.]+)\//g)];
  assert.ok(urls.length >= 3, 'app, auth y firestore');

  const versiones = new Set(urls.map((m) => m[1]));
  assert.equal(versiones.size, 1, 'todos los módulos deben venir de la misma versión');

  // Y los tipos de desarrollo tienen que apuntar a esa misma versión.
  const declaraciones = leer('types/firebase-cdn.d.ts');
  assert.ok(declaraciones.includes([...versiones][0]), 'types/firebase-cdn.d.ts está desfasado');

  const pkg = JSON.parse(leer('package.json'));
  assert.equal(
    pkg.devDependencies.firebase,
    [...versiones][0],
    'la versión de los tipos debe coincidir con la de la URL'
  );
});

test('firebase-config.js expone lo que store.js espera', () => {
  const config = leer('firebase-config.js');
  assert.match(config, /export const firebaseConfig/);
  assert.match(config, /export function configPendiente/);

  for (const clave of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) {
    assert.match(config, new RegExp(clave + ':'), `falta ${clave}`);
  }
});

test('las reglas de Firestore prohíben borrar y validan los métodos', () => {
  const reglas = leer('firestore.rules');

  assert.match(reglas, /rules_version = '2'/);
  assert.equal(
    (reglas.match(/allow delete: if false/g) || []).length,
    2,
    'delete prohibido en events y en entries'
  );
  assert.match(reglas, /request\.auth != null/, 'exige sesión');
  assert.match(
    reglas,
    /affectedKeys\(\)\.hasOnly\(\['voided'\]\)/,
    'de una entry solo se puede tocar voided'
  );
  assert.match(
    reglas,
    /resource\.data\.closedAt == null/,
    'el evento solo se edita con la caja abierta'
  );
  for (const metodo of ['cash', 'bizum', 'already_paid', 'guest']) {
    assert.match(reglas, new RegExp(`'${metodo}'`), `las reglas no validan ${metodo}`);
  }
});

test('la app no usa localStorage para el estado de negocio', () => {
  for (const archivo of ['app.js', 'store.js', 'calc.js', 'views/door.js', 'views/desk.js']) {
    assert.doesNotMatch(
      leer(archivo),
      /localStorage|sessionStorage/,
      `${archivo} usa almacenamiento local: la fuente de verdad es Firestore`
    );
  }
});

test('la agenda local es el único sitio con localStorage, y solo guarda atajos', () => {
  const agenda = leer('mis-eventos.js');
  assert.match(agenda, /localStorage/);

  // Ni euros, ni asistentes, ni talonario: si aparece algo de eso, la fuente de
  // verdad ha dejado de ser Firestore sin que nadie lo decidiera.
  assert.doesNotMatch(
    agenda,
    /price|barPct|tickets|entries|facturado|asistentes|soldCash|soldBizum/,
    'la agenda local no puede guardar estado de negocio'
  );
});

test('toda escritura rechazada acaba en el estado, no solo en la consola', () => {
  // Solo las escrituras: el fallo de login sin red sí se traga a propósito,
  // porque se reintenta al recuperar señal.
  const store = leer('store.js');
  const escrituras = [...store.matchAll(/\b(setDoc|updateDoc)\(/g)];
  assert.ok(escrituras.length >= 4, 'crear evento, registrar, anular, configurar y cerrar');

  for (const escritura of escrituras) {
    const cuerpo = store.slice(escritura.index || 0, (escritura.index || 0) + 320);
    assert.ok(
      /\.catch\(fallo\)|throw err/.test(cuerpo),
      `escritura sin propagar el rechazo: ${cuerpo.split('\n')[0]}`
    );
  }
});

test('la vista de puerta no menciona dinero', () => {
  const door = leer('views/door.js');
  assert.doesNotMatch(door, /fmtEuros|facturado|corteBar|paraBanda/);
});

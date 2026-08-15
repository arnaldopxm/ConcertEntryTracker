// @ts-check
// La versión publicada y el mecanismo de actualización.
//
// El riesgo que cubren estos tests: publicar un cambio y que un móvil que ya
// tiene la app instalada siga sirviendo la versión anterior para siempre. Pasa
// cuando el nombre de la caché no cambia, y con un número escrito a mano pasa
// tarde o temprano.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calcularHash, generar, comprobar, PUBLICADOS } from '../../scripts/version.mjs';
import { VERSION, BUILD, ETIQUETA_VERSION } from '../../version.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} rel */
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('version.js y sw.js están al día con el contenido publicado', () => {
  const problemas = comprobar();
  assert.deepEqual(problemas, [], 'ejecuta `npm run version` y vuelve a commitear');
});

test('el hash es estable: mismo contenido, mismo hash', () => {
  assert.equal(calcularHash(), calcularHash());
  assert.match(calcularHash(), /^[0-9a-f]{12}$/);
});

test('el hash cambia si cambia un byte de lo publicado', () => {
  const rutaCSS = path.join(RAIZ, 'styles.css');
  const original = fs.readFileSync(rutaCSS, 'utf8');
  const antes = calcularHash();

  try {
    fs.writeFileSync(rutaCSS, original + '\n/* prueba */\n');
    assert.notEqual(calcularHash(), antes, 'un cambio real tiene que mover el hash');
  } finally {
    fs.writeFileSync(rutaCSS, original);
  }

  assert.equal(calcularHash(), antes, 'y al deshacerlo, vuelve al mismo');
});

test('el hash no depende del propio nombre de caché de sw.js', () => {
  // Si dependiera, nunca convergería: cambiar el nombre cambiaría el hash, que
  // cambiaría el nombre...
  const rutaSw = path.join(RAIZ, 'sw.js');
  const original = fs.readFileSync(rutaSw, 'utf8');
  const antes = calcularHash();

  try {
    fs.writeFileSync(rutaSw, original.replace(/^const CACHE = '[^']*';$/m, "const CACHE = 'otro';"));
    assert.equal(calcularHash(), antes);
  } finally {
    fs.writeFileSync(rutaSw, original);
  }
});

test('todo lo que la app carga está en la lista de publicados', () => {
  // Se sigue la cadena de imports desde app.js: un módulo nuevo que nadie
  // añada aquí quedaría fuera del hash y del despliegue.
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
      pendientes.push(path.normalize(path.join(path.dirname(actual), ref)).replace(/\\/g, '/'));
    }
  }

  for (const modulo of vistos) {
    assert.ok(PUBLICADOS.includes(modulo), `${modulo} no está en PUBLICADOS`);
  }
  assert.ok(PUBLICADOS.includes('index.html'));
  assert.ok(PUBLICADOS.includes('styles.css'));
  assert.ok(PUBLICADOS.includes('sw.js'));
});

test('todo lo publicado existe', () => {
  for (const rel of PUBLICADOS) {
    assert.ok(fs.existsSync(path.join(RAIZ, rel)), `PUBLICADOS incluye ${rel}, que no existe`);
  }
});

test('version.js es exactamente lo que genera el script', () => {
  assert.equal(leer('version.js'), generar().versionJs, 'no se edita a mano');
});

test('la versión que exporta el módulo coincide con package.json y con el hash', () => {
  const pkg = JSON.parse(leer('package.json'));
  assert.equal(VERSION, pkg.version);
  assert.equal(BUILD, calcularHash());
  assert.equal(ETIQUETA_VERSION, `v${VERSION} · ${BUILD}`);
});

test('el nombre de la caché lleva versión y hash', () => {
  const sw = leer('sw.js');
  const nombre = /const CACHE = '([^']+)';/.exec(sw);
  assert.ok(nombre);
  assert.equal(nombre[1], `taquilla-${VERSION}-${BUILD}`);
});

/**
 * Quita comentarios para poder afirmar cosas sobre el código y no sobre lo que
 * dicen los comentarios (que hablan justamente de lo que NO se hace).
 * @param {string} codigo
 */
function sinComentarios(codigo) {
  return codigo
    .split('\n')
    .filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea))
    .join('\n');
}

test('el precacheo fuerza red y no se fía de la caché HTTP', () => {
  const sw = sinComentarios(leer('sw.js'));
  assert.match(
    sw,
    /cache:\s*'reload'/,
    'sin esto, un despliegue nuevo puede precachear los archivos viejos que GitHub Pages tenga cacheados'
  );
  assert.doesNotMatch(sw, /cache\.addAll\(/, 'addAll no permite saltarse la caché HTTP');
});

test('una instalación a medias no reemplaza a la versión que funcionaba', () => {
  const sw = leer('sw.js');
  assert.match(sw, /throw new Error\(`No se pudo precachear/, 'si un recurso falla, falla la instalación');
});

test('la versión nueva no se activa sola', () => {
  const sw = sinComentarios(leer('sw.js'));

  // skipWaiting solo puede estar dentro del manejador de mensajes: si se llama
  // durante install, la app se recarga sola en mitad de una cola en la puerta.
  const enInstall = /addEventListener\('install'[\s\S]*?\n\}\);/.exec(sw);
  assert.ok(enInstall);
  assert.doesNotMatch(enInstall[0], /skipWaiting/, 'install no debe forzar el relevo');

  assert.match(sw, /addEventListener\('message'[\s\S]*?SKIP_WAITING[\s\S]*?skipWaiting\(\)/);
});

test('la app pide permiso antes de actualizar y limpia cachés viejas', () => {
  const app = leer('app.js');
  assert.match(app, /Hay una versión nueva/);
  assert.match(app, /accion: 'Actualizar'/);
  assert.match(app, /SKIP_WAITING/);

  const sw = leer('sw.js');
  assert.match(sw, /caches\.keys\(\)[\s\S]*?caches\.delete/, 'al activar se borran las cachés anteriores');
});

test('la versión se enseña en las tres pantallas', () => {
  assert.match(leer('app.js'), /pie-version/, 'pantalla de arranque');
  assert.match(leer('views/desk.js'), /pie-version/, 'tesorería');
  assert.match(leer('views/door.js'), /pie-version/, 'puerta, en el panel de puesto');
});

// @ts-check
// El camino de actualización, que es el que nadie prueba hasta que falla.
//
// Se despliega la app en una copia temporal, se instala el service worker, se
// simula un despliegue nuevo (regenerando la versión como haría `npm run
// version`) y se comprueba que el móvil se entera, que precachea los bytes
// nuevos y que la caché vieja se borra.
//
// El servidor imita la cabecera cache-control de GitHub Pages a propósito: sin
// ella no se puede detectar el fallo clásico de precachear archivos viejos.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { abrirNavegador, nuevaPagina, RAIZ } from '../helpers/arnes.js';
import { PUBLICADOS } from '../../scripts/version.mjs';

const CACHE_PAGES = 'max-age=600';

/**
 * Copia lo que se publica a un directorio temporal: el despliegue.
 * @returns {string}
 */
function desplegar() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'taquilla-'));
  for (const rel of PUBLICADOS) {
    const salida = path.join(destino, rel);
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    fs.copyFileSync(path.join(RAIZ, rel), salida);
  }
  return destino;
}

/**
 * Publica una versión nueva sobre el mismo despliegue: cambia un archivo y
 * recalcula el nombre de la caché igual que hace scripts/version.mjs.
 *
 * @param {string} raiz
 * @param {string} marca
 * @returns {string} el nombre de caché nuevo
 */
function publicarVersionNueva(raiz, marca) {
  const estilos = path.join(raiz, 'styles.css');
  fs.writeFileSync(estilos, fs.readFileSync(estilos, 'utf8') + `\n/* ${marca} */\n`);

  const rutaSw = path.join(raiz, 'sw.js');
  const sw = fs.readFileSync(rutaSw, 'utf8');
  const nuevo = `taquilla-${marca}`;
  fs.writeFileSync(rutaSw, sw.replace(/^const CACHE = '[^']*';$/m, `const CACHE = '${nuevo}';`));
  return nuevo;
}

/** @param {import('playwright').Page} pagina */
function esperarActivo(pagina) {
  return pagina.evaluate(async () => {
    const registro = await navigator.serviceWorker.ready;
    return !!registro.active;
  });
}

/** @param {import('playwright').Page} pagina */
function nombresDeCache(pagina) {
  return pagina.evaluate(() => caches.keys());
}

test('actualización de la app publicada', async (t) => {
  const raiz = desplegar();
  const { contexto, base, errores, cerrar } = await abrirNavegador({ raiz, cacheHTTP: CACHE_PAGES });
  t.after(async () => {
    await cerrar();
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  const pagina = await nuevaPagina(contexto, errores);
  await pagina.goto(base, { waitUntil: 'networkidle' });

  let cacheInicial = '';

  await t.test('el service worker se instala y precachea el shell', async () => {
    assert.equal(await esperarActivo(pagina), true);

    const claves = await nombresDeCache(pagina);
    assert.equal(claves.length, 1, `debería haber una sola caché: ${claves.join(', ')}`);
    cacheInicial = claves[0];

    const guardados = await pagina.evaluate(async (nombre) => {
      const cache = await caches.open(nombre);
      return (await cache.keys()).map((p) => new URL(p.url).pathname);
    }, cacheInicial);

    for (const recurso of ['/index.html', '/app.js', '/store.js', '/calc.js', '/styles.css']) {
      assert.ok(guardados.some((p) => p.endsWith(recurso)), `no se precacheó ${recurso}`);
    }
  });

  await t.test('el nombre de la caché lleva versión y hash del contenido', async () => {
    assert.match(cacheInicial, /^taquilla-\d+\.\d+\.\d+-[0-9a-f]{12}$/, cacheInicial);
  });

  await t.test('la versión se ve en pantalla', async () => {
    const pie = await pagina.textContent('.pie-version');
    assert.match(pie || '', /^v\d+\.\d+\.\d+ · [0-9a-f]{12}$/, `pie raro: ${pie}`);

    // Y coincide con lo que cachea el service worker: si se separan, nadie
    // podría saber qué versión lleva el móvil de la puerta.
    const [, version, build] = /^v(\d+\.\d+\.\d+) · ([0-9a-f]{12})$/.exec(pie || '') || [];
    assert.equal(cacheInicial, `taquilla-${version}-${build}`);
  });

  await t.test('la app abre sin red porque el shell está cacheado', async () => {
    await contexto.setOffline(true);
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('.formulario', { timeout: 10000 });
    await contexto.setOffline(false);
  });

  // --- A partir de aquí, se publica una versión nueva ------------------------

  const cacheNueva = publicarVersionNueva(raiz, '9.9.9-ffffffffffff');

  await t.test('al recargar, el móvil detecta la versión nueva y avisa', async () => {
    await pagina.reload({ waitUntil: 'networkidle' });

    // El aviso llega por toast, con acción explícita: nada se recarga solo.
    await pagina.waitForSelector('.toast:has-text("Hay una versión nueva")', { timeout: 15000 });
    assert.equal(await pagina.textContent('.toast-accion'), 'Actualizar');
  });

  await t.test('mientras no se acepte, sigue mandando la versión anterior', async () => {
    const claves = await nombresDeCache(pagina);
    assert.ok(claves.includes(cacheInicial), 'la caché vieja sigue sirviendo la app en uso');

    const controlador = await pagina.evaluate(
      () => navigator.serviceWorker.controller?.state || 'ninguno'
    );
    assert.equal(controlador, 'activated', 'el service worker viejo sigue al mando');
  });

  let navegaciones = 0;
  pagina.on('framenavigated', (marco) => {
    if (marco === pagina.mainFrame()) navegaciones++;
  });

  await t.test('al aceptar, entra la nueva y se borra la vieja', async () => {
    await Promise.all([
      pagina.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }),
      pagina.click('.toast-accion')
    ]);

    await pagina.waitForFunction(
      async (esperada) => (await caches.keys()).includes(esperada),
      cacheNueva,
      { timeout: 15000 }
    );

    const claves = await nombresDeCache(pagina);
    assert.ok(claves.includes(cacheNueva), `falta la caché nueva: ${claves.join(', ')}`);
    assert.ok(!claves.includes(cacheInicial), `la caché vieja no se ha borrado: ${claves.join(', ')}`);
  });

  await t.test('la caché nueva trae los bytes nuevos, no los que había en la caché HTTP', async () => {
    // Este es el fallo clásico: cache.addAll() pasa por la caché del navegador y
    // con max-age=600 se guardaría el archivo viejo. El precacheo fuerza red.
    const css = await pagina.evaluate(async (nombre) => {
      const cache = await caches.open(nombre);
      const respuesta = await cache.match('./styles.css');
      return respuesta ? respuesta.text() : '';
    }, cacheNueva);

    assert.match(css, /9\.9\.9-ffffffffffff/, 'se ha precacheado la versión vieja del CSS');
  });

  await t.test('la app se recarga una sola vez, sin entrar en bucle', async () => {
    // Un controllerchange mal gestionado recarga en bucle y deja el móvil
    // inservible. Se deja margen para que se manifestaría si lo hubiera.
    await pagina.waitForSelector('.formulario');
    await pagina.waitForTimeout(2500);
    assert.equal(navegaciones, 1, `la página ha navegado ${navegaciones} veces tras actualizar`);
  });

  await t.test('y la app sigue abriendo sin red con la versión nueva', async () => {
    // En una pestaña nueva, que comparte service worker y cachés: así se prueba
    // un arranque en frío sin cruzarse con la recarga de la pestaña anterior.
    await contexto.setOffline(true);

    const otra = await nuevaPagina(contexto, errores);
    await otra.goto(base, { waitUntil: 'domcontentloaded' });
    await otra.waitForSelector('.formulario', { timeout: 10000 });

    const css = await otra.evaluate(() =>
      [...document.styleSheets].some((h) => h.href && h.href.endsWith('styles.css'))
    );
    assert.ok(css, 'el CSS se sirve desde la caché');

    await otra.close();
    await contexto.setOffline(false);
  });

  await t.test('sin errores de consola', () => {
    const relevantes = errores.filter((e) => !/Failed to load resource/.test(e));
    assert.deepEqual(relevantes, []);
  });
});

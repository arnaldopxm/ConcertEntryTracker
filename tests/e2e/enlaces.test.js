// @ts-check
// Volver a ver los enlaces y el QR.
//
// La pantalla que sale al crear el evento no puede ser la única: en la puerta
// hace falta enseñar el QR más de una vez, y el enlace hay que poder pasarlo
// por WhatsApp a media noche.

import test from 'node:test';
import assert from 'node:assert/strict';

import { abrirNavegador, nuevaPagina, crearEvento } from '../helpers/arnes.js';

test('enlaces y QR', async (t) => {
  const { contexto, base, errores, cerrar } = await abrirNavegador();
  t.after(cerrar);

  const pagina = await nuevaPagina(contexto, errores);
  const enlaces = await crearEvento(pagina, base, { nombre: 'Sala Aguere' });

  await t.test('al crear el evento se aterriza en una URL propia', async () => {
    assert.ok(pagina.url().includes('r=links'), `URL rara: ${pagina.url()}`);
    assert.equal(await pagina.textContent('.titulo'), 'Evento creado');
  });

  await t.test('hay QR para los dos puestos, no solo para la puerta', async () => {
    const qrs = await pagina.$$('.qr svg');
    assert.equal(qrs.length, 2);

    const titulos = await pagina.$$eval('.bloque-enlace .subtitulo', (ns) =>
      ns.map((n) => n.textContent)
    );
    assert.deepEqual(titulos, ['Puerta', 'Tesorería']);
  });

  await t.test('cada bloque ofrece copiar y compartir', async () => {
    const acciones = await pagina.$$eval('.bloque-enlace button', (ns) =>
      ns.map((n) => n.textContent)
    );
    assert.deepEqual(acciones, ['Copiar', 'Compartir', 'Copiar', 'Compartir']);
  });

  await t.test('copiar deja el enlace en el portapapeles', async () => {
    await contexto.grantPermissions(['clipboard-read', 'clipboard-write']);
    await pagina.click('.bloque-enlace:first-of-type button:has-text("Copiar")');
    await pagina.waitForSelector('.toast');

    const copiado = await pagina.evaluate(() => navigator.clipboard.readText());
    assert.equal(copiado, enlacesEsperados(copiado, 'door'));

    /** @param {string} valor @param {string} rol */
    function enlacesEsperados(valor, rol) {
      return valor.includes('r=' + rol) ? valor : 'no coincide';
    }
  });

  await t.test('compartir usa la hoja del sistema cuando existe', async () => {
    await pagina.evaluate(() => {
      // Chromium de escritorio no trae navigator.share: se simula para
      // comprobar que se le pasa la URL correcta.
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (/** @type {{url: string, text: string}} */ datos) => {
          /** @type {any} */ (window).__compartido = datos;
          return Promise.resolve();
        }
      });
    });

    await pagina.click('.bloque-enlace:last-of-type button:has-text("Compartir")');
    await pagina.waitForFunction(() => /** @type {any} */ (window).__compartido);

    const datos = await pagina.evaluate(() => /** @type {any} */ (window).__compartido);
    assert.ok(datos.url.includes('r=desk'), `URL compartida: ${datos.url}`);
    assert.match(datos.text, /tesorería/i);
  });

  await t.test('si el sistema no sabe compartir, se copia y se avisa', async () => {
    await pagina.evaluate(() => {
      // @ts-ignore
      delete navigator.share;
    });
    await pagina.click('.bloque-enlace:first-of-type button:has-text("Compartir")');
    await pagina.waitForSelector('.toast:has-text("copiado")');
  });

  await t.test('se puede volver a la pantalla desde tesorería', async () => {
    await pagina.goto(enlaces.mesa, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.saldo');

    await pagina.click('a:has-text("Enlaces y QR")');
    await pagina.waitForSelector('.qr svg');
    assert.equal(await pagina.textContent('.titulo'), 'Enlaces del evento');
    assert.match(await pagina.textContent('.parrafo') || '', /Sala Aguere/);
  });

  await t.test('y desde la lista de eventos', async () => {
    await pagina.goto(base, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.eventos');

    await pagina.click('.evento a:has-text("Enlaces y QR")');
    await pagina.waitForSelector('.qr svg');
    assert.ok(pagina.url().includes(enlaces.eventId));
  });

  await t.test('desde ahí se entra a cualquiera de los dos puestos', async () => {
    await pagina.click('a:has-text("Ir a la puerta")');
    await pagina.waitForSelector('.pad-btn');
    assert.ok(pagina.url().includes('r=door'));
  });

  await t.test('el QR lleva el enlace del puesto que dice, no otro', async () => {
    await pagina.goto(`${base}#e=${enlaces.eventId}&r=links`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.qr svg');

    // Los dos QR tienen que ser distintos: si alguien duplica el de puerta en
    // los dos sitios, nadie lo nota hasta que el tesorero abre la vista mala.
    const [uno, dos] = await pagina.$$eval('.qr svg path', (ns) =>
      ns.map((n) => n.getAttribute('d'))
    );
    assert.notEqual(uno, dos);
  });

  await t.test('sin errores de consola', () => {
    assert.deepEqual(errores, []);
  });
});

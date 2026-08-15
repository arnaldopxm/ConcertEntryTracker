// @ts-check
// Criterio de aceptación 1: abrir la app sin eventId, crear un evento y obtener
// dos enlaces distintos más un QR.

import test from 'node:test';
import assert from 'node:assert/strict';

import { abrirNavegador, nuevaPagina, crearEvento } from '../helpers/arnes.js';

test('arranque', async (t) => {
  const { contexto, base, errores, cerrar } = await abrirNavegador();
  t.after(cerrar);

  const pagina = await nuevaPagina(contexto, errores);

  await t.test('sin eventId muestra el formulario de creación', async () => {
    await pagina.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await pagina.textContent('.titulo'), 'Taquilla');
    assert.ok(await pagina.$('.formulario'));
  });

  const enlaces = await crearEvento(pagina, base, { nombre: 'Sala Aguere', entregadas: '40' });

  await t.test('genera dos enlaces, uno por puesto', async () => {
    assert.ok(enlaces.puerta.includes('r=door'));
    assert.ok(enlaces.mesa.includes('r=desk'));
    assert.notEqual(enlaces.puerta, enlaces.mesa);
  });

  await t.test('el eventId es aleatorio y de 20 caracteres', async () => {
    assert.equal(enlaces.eventId.length, 20);
    assert.match(enlaces.eventId, /^[A-Za-z0-9]{20}$/);

    const otra = await nuevaPagina(contexto, errores);
    const segundo = await crearEvento(otra, base);
    assert.notEqual(segundo.eventId, enlaces.eventId);
    await otra.close();
  });

  await t.test('los enlaces son relativos al despliegue, no a la raíz', async () => {
    assert.ok(enlaces.puerta.startsWith(base), `${enlaces.puerta} debería colgar de ${base}`);
  });

  await t.test('el QR se dibuja en cliente, sin pedir imágenes fuera', async () => {
    const svg = await pagina.$eval('.qr svg', (n) => n.outerHTML);
    assert.ok(svg.includes('<path'));
    assert.ok(!/<img|<image|xlink:href/.test(svg));
  });

  await t.test('un enlace sin rol ofrece elegir puesto', async () => {
    await pagina.goto(`${base}#e=${enlaces.eventId}`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.acciones-columna');
    const textos = await pagina.$$eval('.acciones-columna a', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(textos, ['Puerta', 'Tesorería']);
  });

  await t.test('sin errores de consola', () => {
    assert.deepEqual(errores, []);
  });
});

// @ts-check
// Comportamiento sin cobertura.
//
// OJO con el alcance: aquí se comprueba lo que hace NUESTRO código cuando el
// navegador se queda sin red (avisar sin estorbar y no bloquear el registro).
// La cola de escrituras offline es del SDK de Firestore, y como en los tests el
// SDK está sustituido por un doble, eso NO queda cubierto: el criterio 3 hay que
// probarlo en un móvil real con modo avión.

import test from 'node:test';
import assert from 'node:assert/strict';

import { abrirNavegador, nuevaPagina, crearEvento, registrar, oculto } from '../helpers/arnes.js';

test('sin conexión', async (t) => {
  const { contexto, base, errores, cerrar } = await abrirNavegador();
  t.after(cerrar);

  const puerta = await nuevaPagina(contexto, errores);
  const enlaces = await crearEvento(puerta, base, { entregadas: '10' });
  await puerta.goto(enlaces.puerta, { waitUntil: 'networkidle' });
  await puerta.waitForSelector('.pad-btn');

  await t.test('con red no hay barra de aviso', async () => {
    assert.equal(await oculto(puerta, '.barra-red'), true);
  });

  await t.test('al caerse la red aparece un aviso discreto', async () => {
    await contexto.setOffline(true);
    await puerta.evaluate(() => window.dispatchEvent(new Event('offline')));
    await puerta.waitForSelector('.barra-red:not([hidden])');

    const texto = await puerta.textContent('.barra-red');
    assert.match(texto || '', /Sin conexión/);
    assert.match(texto || '', /se envía al recuperar señal/);
  });

  await t.test('el aviso no roba sitio a los botones', async () => {
    const pad = await (await puerta.$('.pad'))?.boundingBox();
    const alto = puerta.viewportSize()?.height || 0;
    assert.ok(pad, 'la rejilla sigue en pantalla');
    assert.ok(pad.height > alto * 0.4, 'la rejilla mantiene la mitad inferior');
  });

  await t.test('se sigue registrando gente sin red', async () => {
    await registrar(puerta, 'cash', true);
    await registrar(puerta, 'invitado');
    await registrar(puerta, 'bizum', false);
    assert.equal(await puerta.textContent('.contador'), '3');
  });

  await t.test('el talonario se sigue descontando en local', async () => {
    assert.match(await puerta.textContent('.contador-pie') || '', /Quedan 9 entradas/);
  });

  await t.test('al volver la red el aviso desaparece', async () => {
    await contexto.setOffline(false);
    await puerta.evaluate(() => window.dispatchEvent(new Event('online')));
    await puerta.waitForFunction(() => document.querySelector('.barra-red')?.hasAttribute('hidden'));
  });

  await t.test('sin errores de consola', () => {
    assert.deepEqual(errores, []);
  });
});

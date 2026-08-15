// @ts-check
// Moverse por la app: saltar entre puerta y tesorería, volver a un evento ya
// creado desde la agenda local, y qué se ve cuando el evento no está.

import test from 'node:test';
import assert from 'node:assert/strict';

import { abrirNavegador, nuevaPagina, crearEvento } from '../helpers/arnes.js';

test('navegación', async (t) => {
  const { contexto, base, errores, cerrar } = await abrirNavegador();
  t.after(cerrar);

  const pagina = await nuevaPagina(contexto, errores);
  const enlaces = await crearEvento(pagina, base, { nombre: 'Sala Aguere', entregadas: '10' });

  await t.test('desde la puerta se puede saltar a tesorería en dos toques', async () => {
    await pagina.goto(enlaces.puerta, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.pad-btn');

    await pagina.click('.cambiar-puesto');
    await pagina.waitForSelector('.sheet');
    assert.equal(await pagina.textContent('.sheet-titulo'), 'Cambiar de puesto');

    await pagina.click('a:has-text("Ir a tesorería")');
    await pagina.waitForSelector('.saldo');
    assert.ok(pagina.url().includes('r=desk'));
  });

  await t.test('y desde tesorería se vuelve a la puerta', async () => {
    await pagina.click('.cambiar-puesto');
    await pagina.waitForSelector('.sheet');
    await pagina.click('a:has-text("Ir a la puerta")');
    await pagina.waitForSelector('.pad-btn');
    assert.ok(pagina.url().includes('r=door'));
  });

  await t.test('el cambio de puesto no se dispara por un roce', async () => {
    await pagina.click('.cambiar-puesto');
    await pagina.waitForSelector('.sheet');
    await pagina.click('.btn-sheet-no');
    await pagina.waitForSelector('.sheet', { state: 'detached' });
    assert.ok(pagina.url().includes('r=door'), 'sigue en la puerta');
  });

  await t.test('el botón de puesto no invade la rejilla', async () => {
    const cajaBoton = await (await pagina.$('.cambiar-puesto'))?.boundingBox();
    const cajaPad = await (await pagina.$('.pad'))?.boundingBox();
    assert.ok(cajaBoton && cajaPad);
    assert.ok(cajaBoton.y + cajaBoton.height < cajaPad.y);
    assert.ok(cajaBoton.height <= 44, 'pequeño: compite con nada');
  });

  await t.test('la pantalla de arranque recuerda los eventos de este móvil', async () => {
    await pagina.goto(base, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.eventos');

    const nombres = await pagina.$$eval('.evento-nombre', (ns) => ns.map((n) => n.textContent));
    assert.ok(nombres.includes('Sala Aguere'), `no aparece el evento: ${nombres.join(', ')}`);
    assert.ok(!nombres.includes('Evento sin nombre'), 'todos los apuntes traen nombre');

    const fechas = await pagina.$$eval('.evento-fecha', (ns) => ns.map((n) => n.textContent));
    assert.ok(fechas.every((f) => /^\d{2}\/\d{2}\/\d{4}$/.test(f || '')), `fecha en crudo: ${fechas}`);

    const enlacesFila = await pagina.$$eval('.evento .btn', (ns) =>
      ns.map((n) => ({ texto: n.textContent, href: n.getAttribute('href') }))
    );
    assert.equal(enlacesFila[0].texto, 'Puerta');
    assert.ok(enlacesFila[0].href?.includes('r=door'));
    assert.equal(enlacesFila[1].texto, 'Tesorería');
    assert.ok(enlacesFila[1].href?.includes('r=desk'));
  });

  await t.test('desde la agenda se entra directo al puesto', async () => {
    await pagina.click('.evento a:has-text("Tesorería")');
    await pagina.waitForSelector('.saldo');
    assert.ok(pagina.url().includes(enlaces.eventId));
  });

  await t.test('la agenda no guarda dinero ni asistentes', async () => {
    const guardado = await pagina.evaluate(() => localStorage.getItem('taquilla:mis-eventos'));
    assert.ok(guardado);
    const datos = JSON.parse(guardado);
    for (const evento of datos) {
      assert.deepEqual(
        Object.keys(evento).sort(),
        ['date', 'id', 'name', 'visto'],
        'solo atajos: la fuente de verdad sigue siendo Firestore'
      );
    }
  });

  await t.test('se puede quitar un evento de la lista', async () => {
    await pagina.goto(base, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.eventos');

    const antes = await pagina.$$eval('.evento', (ns) => ns.length);
    await pagina.click('.evento .evento-quitar');
    await pagina.waitForFunction(
      (esperado) => document.querySelectorAll('.evento').length === esperado,
      antes - 1
    );

    // Y desaparece también del almacenamiento, no solo de la pantalla.
    const guardados = await pagina.evaluate(
      () => JSON.parse(localStorage.getItem('taquilla:mis-eventos') || '[]').length
    );
    assert.equal(guardados, antes - 1);
  });

  await t.test('quitar se puede deshacer', async () => {
    await pagina.click('.toast-accion');
    await pagina.waitForSelector('.evento');

    const guardados = await pagina.evaluate(
      () => JSON.parse(localStorage.getItem('taquilla:mis-eventos') || '[]').length
    );
    assert.ok(guardados >= 1, 'el atajo vuelve a la agenda');
  });

  await t.test('quitar no borra el evento de la base de datos', async () => {
    // El enlace tiene que seguir funcionando: la agenda es solo un atajo local.
    await pagina.goto(enlaces.mesa, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.saldo');
    assert.ok(!(await pagina.$('.problema:not([hidden])')), 'el evento sigue existiendo');
  });

  await t.test('un enlace roto no ensucia la agenda', async () => {
    await pagina.goto(`${base}#e=otroQueNoExiste000&r=desk`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.problema:not([hidden])');

    const guardados = await pagina.evaluate(() =>
      JSON.parse(localStorage.getItem('taquilla:mis-eventos') || '[]').map(
        (/** @type {{id: string}} */ e) => e.id
      )
    );
    assert.ok(!guardados.includes('otroQueNoExiste000'), 'solo se recuerda lo que existe');
  });

  await t.test('un evento inexistente lo dice, en vez de dejar botones muertos', async () => {
    await pagina.goto(`${base}#e=noExisteEsteEvento00&r=door`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.problema:not([hidden])');

    assert.equal(await pagina.textContent('.problema-titulo'), 'Este evento no existe');
    assert.ok(await pagina.$('.problema button'), 'ofrece reintentar');
  });

  await t.test('tesorería también lo dice', async () => {
    await pagina.goto(`${base}#e=noExisteEsteEvento00&r=desk`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.problema:not([hidden])');
    assert.equal(await pagina.textContent('.desk-evento'), 'Evento no disponible');
  });

  await t.test('sin errores de consola', () => {
    assert.deepEqual(errores, []);
  });
});

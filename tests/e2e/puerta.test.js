// @ts-check
// La vista de puerta: dos toques por persona, deshacer, aviso de talonario
// agotado y la regla de que aquí nunca se ve dinero.
// Cubre los criterios de aceptación 2 y 5.

import test from 'node:test';
import assert from 'node:assert/strict';

import { abrirNavegador, nuevaPagina, crearEvento, registrar, deshabilitado } from '../helpers/arnes.js';

test('vista de puerta', async (t) => {
  const { contexto, base, errores, cerrar } = await abrirNavegador();
  t.after(cerrar);

  const pagina = await nuevaPagina(contexto, errores);
  const enlaces = await crearEvento(pagina, base, { precio: '10', entregadas: '5' });
  await pagina.goto(enlaces.puerta, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.pad-btn');

  await t.test('arranca a cero y anuncia el talonario pendiente', async () => {
    assert.equal((await pagina.textContent('.contador'))?.trim(), '0');
    assert.match(await pagina.textContent('.contador-pie') || '', /Quedan 5 entradas/);
  });

  await t.test('hay exactamente cuatro botones y ningún menú', async () => {
    const textos = await pagina.$$eval('.pad-btn', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(textos, ['Efectivo', 'Bizum', 'Ya pagada', 'Invitado']);
  });

  await t.test('efectivo pregunta una sola cosa y registra en dos toques', async () => {
    await pagina.click('.pad-cash');
    await pagina.waitForSelector('.sheet');
    assert.equal(await pagina.textContent('.sheet-titulo'), '¿Traía entrada?');

    const opciones = await pagina.$$eval('.sheet-botones button', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(opciones, ['Sí, traía entrada', 'No traía']);

    await pagina.click('.btn-sheet-si');
    await pagina.waitForFunction(() => document.querySelector('.contador')?.textContent === '1');
    assert.ok(!(await pagina.$('.sheet')), 'el panel se cierra solo');
  });

  await t.test('confirma con un toast que repite el nombre del botón', async () => {
    assert.equal(await pagina.textContent('.toast-texto'), 'Registrado en efectivo');
    assert.equal(await pagina.textContent('.toast-accion'), 'Deshacer');
  });

  await t.test('deshacer devuelve el contador atrás', async () => {
    await pagina.click('.toast-accion');
    await pagina.waitForFunction(() => document.querySelector('.contador')?.textContent === '0');
  });

  await t.test('invitado y ya pagada no preguntan nada', async () => {
    await registrar(pagina, 'invitado');
    assert.equal(await pagina.textContent('.toast-texto'), 'Registrado como invitado');

    await registrar(pagina, 'ya');
    assert.equal(await pagina.textContent('.toast-texto'), 'Registrado como ya pagada');
  });

  await t.test('solo las entradas físicas descuentan talonario', async () => {
    // Van 1 invitado (sin entrada) y 1 ya pagada (con entrada): quedan 4.
    assert.match(await pagina.textContent('.contador-pie') || '', /Quedan 4 entradas/);

    await registrar(pagina, 'bizum', false);
    assert.match(
      await pagina.textContent('.contador-pie') || '',
      /Quedan 4 entradas/,
      'pagar sin traer papel no toca el talonario'
    );
  });

  await t.test('aquí no se ve dinero por ningún lado', async () => {
    const texto = await pagina.textContent('.vista-puerta');
    assert.ok(!texto?.includes('€'), 'la puerta no muestra euros');
    assert.ok(!/Facturado|Corte del bar|efectivo total/i.test(texto || ''));
  });

  await t.test('el toast no tapa la rejilla de botones', async () => {
    // Regresión: el toast se colocaba encima de "Ya pagada" e "Invitado".
    const toast = await pagina.$('.toast');
    assert.ok(toast, 'debería seguir habiendo un toast visible');
    const cajaToast = await toast.boundingBox();
    const cajaPad = await (await pagina.$('.pad'))?.boundingBox();
    assert.ok(cajaToast && cajaPad);
    assert.ok(
      cajaToast.y + cajaToast.height <= cajaPad.y + 1,
      'el toast tiene que quedar por encima de la rejilla'
    );
  });

  await t.test('agotar el talonario dispara el aviso rojo', async () => {
    // Van 1 con entrada de 5. Metemos 4 más con entrada para llegar a 0.
    for (let i = 0; i < 4; i++) await registrar(pagina, 'ya');
    await pagina.waitForFunction(() =>
      /No quedan entradas/.test(document.querySelector('.contador-pie')?.textContent || '')
    );

    await pagina.click('.pad-cash');
    await pagina.click('.btn-sheet-si');
    await pagina.waitForSelector('.aviso');
    assert.equal(await pagina.textContent('.aviso-titulo'), 'Hay más entradas de las repartidas');
  });

  await t.test('exige una nota antes de dejar continuar', async () => {
    assert.equal(await deshabilitado(pagina, '.btn-sheet-peligro'), true);

    await pagina.fill('.sheet .campo', '   ');
    assert.equal(
      await deshabilitado(pagina, '.btn-sheet-peligro'),
      true,
      'espacios en blanco no cuentan como nota'
    );

    await pagina.fill('.sheet .campo', 'entrada repetida');
    assert.equal(await deshabilitado(pagina, '.btn-sheet-peligro'), false);
  });

  await t.test('pero nunca bloquea: la persona entra igual', async () => {
    const antes = Number(await pagina.textContent('.contador'));
    await pagina.click('.btn-sheet-peligro');
    await pagina.waitForFunction(
      (esperado) => document.querySelector('.contador')?.textContent === String(esperado),
      antes + 1
    );
    assert.match(await pagina.textContent('.contador-pie') || '', /1 entrada de más/);
  });

  await t.test('se puede cancelar el aviso sin registrar a nadie', async () => {
    const antes = await pagina.textContent('.contador');
    await pagina.click('.pad-cash');
    await pagina.click('.btn-sheet-si');
    await pagina.waitForSelector('.aviso');
    await pagina.click('.btn-sheet-no');
    await pagina.waitForSelector('.sheet', { state: 'detached' });
    assert.equal(await pagina.textContent('.contador'), antes);
  });

  await t.test('sin errores de consola', () => {
    assert.deepEqual(errores, []);
  });
});

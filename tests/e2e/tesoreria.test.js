// @ts-check
// Tesorería con la puerta abierta en otra pestaña: sincronización en vivo,
// anulaciones, recálculo al tocar la configuración, cierre de caja y CSV.
// Cubre los criterios de aceptación 2, 4, 6 y 7.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { abrirNavegador, nuevaPagina, crearEvento, registrar, aNumero, deshabilitado } from '../helpers/arnes.js';

/**
 * @param {import('playwright').Page} mesa
 * @param {string} etiqueta
 * @returns {Promise<number>}
 */
async function lineaDe(mesa, etiqueta) {
  const texto = await mesa.evaluate((et) => {
    const filas = [...document.querySelectorAll('.linea')];
    const fila = filas.find((l) => l.textContent?.includes(et));
    return fila?.querySelector('.linea-valor')?.textContent || '';
  }, etiqueta);
  return aNumero(texto);
}

test('tesorería', async (t) => {
  const { contexto, base, errores, cerrar } = await abrirNavegador();
  t.after(cerrar);

  const puerta = await nuevaPagina(contexto, errores);
  const enlaces = await crearEvento(puerta, base, {
    nombre: 'Sala Aguere',
    precio: '10',
    barPct: '20',
    entregadas: '40'
  });

  const mesa = await nuevaPagina(contexto, errores);
  await mesa.goto(enlaces.mesa, { waitUntil: 'networkidle' });
  await mesa.waitForSelector('.saldo');

  await puerta.goto(enlaces.puerta, { waitUntil: 'networkidle' });
  await puerta.waitForSelector('.pad-btn');

  await t.test('empieza a cero', async () => {
    assert.equal(aNumero(await mesa.textContent('.saldo') || ''), 0);
  });

  await t.test('un registro en la puerta llega sin recargar', async () => {
    await registrar(puerta, 'cash', true);
    await mesa.waitForFunction(
      () => document.querySelector('.saldo')?.textContent?.includes('10,00'),
      null,
      { timeout: 5000 }
    );
  });

  await t.test('el movimiento aparece en el registro con su detalle', async () => {
    await mesa.waitForSelector('.movimiento');
    const fila = await mesa.textContent('.movimiento');
    assert.match(fila || '', /Efectivo/);
    assert.match(fila || '', /con entrada/);
    assert.match(fila || '', /10,00/);
  });

  await t.test('invitados y ya pagadas suman persona sin sumar dinero', async () => {
    await registrar(puerta, 'invitado');
    await registrar(puerta, 'ya');
    await mesa.waitForFunction(
      () => document.querySelectorAll('.movimiento').length === 3,
      null,
      { timeout: 5000 }
    );
    assert.equal(aNumero(await mesa.textContent('.saldo') || ''), 10);
    const asistentes = await mesa.$$eval('.tarjeta-valor', (ns) => ns.map((n) => n.textContent));
    assert.equal(asistentes[2], '3');
  });

  await t.test('anular desde tesorería decrementa la puerta', async () => {
    await mesa.click('.movimiento:not(.anulado) .mov-accion');
    await puerta.waitForFunction(
      () => document.querySelector('.contador')?.textContent === '2',
      null,
      { timeout: 5000 }
    );
  });

  await t.test('lo anulado sigue en la lista, tachado, no desaparece', async () => {
    const anulado = await mesa.$('.movimiento.anulado');
    assert.ok(anulado, 'la fila anulada debe seguir visible');
    const tachado = await mesa.$eval('.movimiento.anulado .mov-titulo', (n) =>
      getComputedStyle(n).textDecorationLine
    );
    assert.match(tachado, /line-through/);
  });

  await t.test('restaurar la devuelve al recuento', async () => {
    await mesa.click('.movimiento.anulado .mov-accion');
    await puerta.waitForFunction(
      () => document.querySelector('.contador')?.textContent === '3',
      null,
      { timeout: 5000 }
    );
  });

  await t.test('cambiar el precio recalcula todo al instante', async () => {
    await mesa.fill('.vista-mesa input[type=number] >> nth=0', '12');
    await mesa.waitForFunction(
      () => document.querySelector('.saldo')?.textContent?.includes('12,00'),
      null,
      { timeout: 5000 }
    );
    assert.equal(await lineaDe(mesa, 'Corte del bar'), 2.4);
    assert.equal(await lineaDe(mesa, 'Para la banda'), 9.6);
  });

  await t.test('cambiar el porcentaje del bar recalcula el reparto', async () => {
    await mesa.fill('.vista-mesa input[type=number] >> nth=1', '30');
    await mesa.waitForFunction(
      () => {
        const linea = [...document.querySelectorAll('.linea')].find((l) =>
          l.textContent?.includes('Corte del bar')
        );
        return linea?.textContent?.includes('30%');
      },
      null,
      { timeout: 5000 }
    );
    const bar = await lineaDe(mesa, 'Corte del bar');
    const banda = await lineaDe(mesa, 'Para la banda');
    const facturado = aNumero(await mesa.textContent('.saldo') || '');
    assert.equal(bar, 3.6);
    assert.equal(Math.round((bar + banda) * 100) / 100, facturado, 'bar + banda = facturado');
  });

  await t.test('el pendiente de cobro sale a la vista y en alerta', async () => {
    // 40 repartidas, 0 cobradas por adelantado, a 12 €.
    assert.equal(await lineaDe(mesa, 'Pendiente de cobro'), 480);
    const clases = await mesa.$eval(
      '.linea:has(.linea-etiqueta)',
      () => [...document.querySelectorAll('.linea')]
        .find((l) => l.textContent?.includes('Pendiente de cobro'))?.className || ''
    );
    assert.match(clases, /alerta/);
  });

  await t.test('apuntar preventa baja el pendiente y sube el facturado', async () => {
    await mesa.fill('.vista-mesa input[type=number] >> nth=4', '10'); // cobradas en efectivo
    await mesa.waitForFunction(
      () => document.querySelector('.saldo')?.textContent?.includes('132,00'),
      null,
      { timeout: 5000 }
    );
    assert.equal(await lineaDe(mesa, 'Pendiente de cobro'), 360);
  });

  await t.test('el talonario refleja devoluciones', async () => {
    await mesa.fill('.vista-mesa input[type=number] >> nth=3', '15'); // devueltas
    await mesa.waitForFunction(
      () => {
        const linea = [...document.querySelectorAll('.linea')].find((l) =>
          l.textContent?.includes('En circulación')
        );
        return linea?.textContent?.includes('25');
      },
      null,
      { timeout: 5000 }
    );
    assert.equal(await lineaDe(mesa, 'Pendiente de cobro'), 180);
  });

  await t.test('el CSV se descarga con movimientos y resumen', async () => {
    const descarga = mesa.waitForEvent('download');
    await mesa.click('button:has-text("Descargar CSV")');
    const fichero = await descarga;
    const ruta = await fichero.path();
    const csv = fs.readFileSync(ruta, 'utf8');

    assert.match(fichero.suggestedFilename(), /^taquilla-sala-aguere.*\.csv$/);
    assert.match(csv, /Movimientos/);
    assert.match(csv, /Resumen/);
    assert.match(csv, /Facturado;132,00/);
    assert.match(csv, /Pendiente de cobro;180,00/);
    assert.equal(csv.split('\r\n').filter((l) => /^\d/.test(l)).length, 3, 'tres movimientos');
  });

  await t.test('cerrar caja pide confirmación', async () => {
    await mesa.click('button:has-text("Cerrar caja")');
    await mesa.waitForSelector('.sheet');
    assert.equal(await mesa.textContent('.sheet-titulo'), '¿Cerrar la caja?');
  });

  await t.test('al cerrar, tesorería queda en solo lectura', async () => {
    await mesa.click('.btn-sheet-peligro');
    await mesa.waitForSelector('.barra-cerrado:not([hidden])');
    assert.equal(await deshabilitado(mesa, '.vista-mesa input[type=number]'), true);
    assert.equal(await deshabilitado(mesa, '.vista-mesa input[type=text]'), true);
    assert.ok(!(await mesa.$('.mov-accion')), 'ya no se puede anular nada');
  });

  await t.test('y la puerta se entera y deja de registrar', async () => {
    await puerta.waitForFunction(
      () => !document.querySelector('.barra-cerrado')?.hasAttribute('hidden'),
      null,
      { timeout: 5000 }
    );
    for (const clase of ['.pad-cash', '.pad-bizum', '.pad-ya', '.pad-invitado']) {
      assert.equal(await deshabilitado(puerta, clase), true, `${clase} sigue activo`);
    }
  });

  await t.test('el CSV se sigue pudiendo descargar con la caja cerrada', async () => {
    const descarga = mesa.waitForEvent('download');
    await mesa.click('button:has-text("Descargar CSV")');
    const csv = fs.readFileSync(await (await descarga).path(), 'utf8');
    assert.doesNotMatch(csv, /Cierre de caja;Sin cerrar/);
  });

  await t.test('sin errores de consola', () => {
    assert.deepEqual(errores, []);
  });
});

// @ts-check
// Tests de los cálculos del cuadre. Funciones puras: ni navegador ni mocks.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeTotals,
  talonarioVacio,
  euros,
  num,
  clamp,
  METODOS,
  ETIQUETA_METODO
} from '../../calc.js';

/**
 * @param {Partial<import('../../calc.js').Evento>} [parche]
 * @returns {import('../../calc.js').Evento}
 */
function evento(parche = {}) {
  return {
    name: 'Concierto',
    date: '2026-08-15',
    price: 10,
    barPct: 20,
    tickets: talonarioVacio(),
    createdAt: new Date('2026-08-15T18:00:00Z'),
    closedAt: null,
    ...parche
  };
}

let contador = 0;
/**
 * @param {import('../../calc.js').Metodo} method
 * @param {boolean} [hasTicket]
 * @param {Partial<import('../../calc.js').Entry>} [parche]
 * @returns {import('../../calc.js').Entry}
 */
function entry(method, hasTicket = false, parche = {}) {
  return {
    id: 'e' + contador++,
    ts: new Date('2026-08-15T22:00:00Z'),
    method,
    hasTicket,
    note: null,
    voided: false,
    ...parche
  };
}

test('sin evento todo vale cero', () => {
  const t = computeTotals(null, []);
  assert.equal(t.facturado, 0);
  assert.equal(t.asistentes, 0);
  assert.equal(t.corteBar, 0);
  assert.equal(t.paraBanda, 0);
  assert.equal(t.pendienteDeCobro, 0);
  assert.equal(t.entradasRestantes, 0);
});

test('sin nadie en la puerta, la preventa ya factura', () => {
  const t = computeTotals(
    evento({ tickets: { delivered: 40, soldCash: 6, soldBizum: 4, returned: 0 } }),
    []
  );
  assert.equal(t.ingresosPreventa, 100);
  assert.equal(t.ingresosPuerta, 0);
  assert.equal(t.facturado, 100);
  assert.equal(t.efectivoTotal, 60);
  assert.equal(t.bizumTotal, 40);
  assert.equal(t.asistentes, 0, 'cobrar por adelantado no mete a nadie en la sala');
});

test('efectivo y bizum en puerta suman persona y dinero', () => {
  const t = computeTotals(evento(), [entry('cash'), entry('cash'), entry('bizum')]);
  assert.equal(t.asistentes, 3);
  assert.equal(t.ingresosPuerta, 30);
  assert.equal(t.efectivoTotal, 20);
  assert.equal(t.bizumTotal, 10);
});

test('ya pagada suma persona y cero euros', () => {
  const t = computeTotals(evento(), [entry('already_paid', true)]);
  assert.equal(t.asistentes, 1);
  assert.equal(t.facturado, 0, 'su dinero ya está contado en la preventa');
  assert.equal(t.ingresosPuerta, 0);
});

test('invitado suma persona y cero euros', () => {
  const t = computeTotals(evento(), [entry('guest')]);
  assert.equal(t.asistentes, 1);
  assert.equal(t.facturado, 0);
  assert.equal(t.conteos.guest, 1);
});

test('las entries anuladas se ignoran en todo', () => {
  const t = computeTotals(evento(), [
    entry('cash'),
    entry('cash', true, { voided: true }),
    entry('bizum', false, { voided: true })
  ]);
  assert.equal(t.asistentes, 1);
  assert.equal(t.facturado, 10);
  assert.equal(t.conteos.anuladas, 2);
  assert.equal(t.conteos.conEntrada, 0, 'una anulada no descuenta talonario');
});

test('hasTicket es ortogonal al método de pago', () => {
  // Trae entrada física pero la paga en la puerta: cobra Y descuenta talonario.
  const t = computeTotals(
    evento({ tickets: { delivered: 10, soldCash: 0, soldBizum: 0, returned: 0 } }),
    [entry('cash', true)]
  );
  assert.equal(t.ingresosPuerta, 10);
  assert.equal(t.conteos.conEntrada, 1);
  assert.equal(t.entradasRestantes, 9);
});

test('entradas en circulación descuenta las devueltas', () => {
  const t = computeTotals(
    evento({ tickets: { delivered: 40, soldCash: 0, soldBizum: 0, returned: 15 } }),
    []
  );
  assert.equal(t.entradasEnCirculacion, 25);
  assert.equal(t.entradasRestantes, 25);
});

test('entradasRestantes se vuelve negativa si aparecen más de las repartidas', () => {
  const tickets = { delivered: 2, soldCash: 0, soldBizum: 0, returned: 0 };
  const t = computeTotals(evento({ tickets }), [
    entry('already_paid', true),
    entry('already_paid', true),
    entry('already_paid', true)
  ]);
  assert.equal(t.entradasRestantes, -1, 'esto es lo que dispara el aviso rojo en la puerta');
});

test('pendiente de cobro es el talonario repartido que nadie ha pagado', () => {
  const t = computeTotals(
    evento({ price: 12, tickets: { delivered: 40, soldCash: 10, soldBizum: 5, returned: 5 } }),
    []
  );
  // 40 repartidas - 5 devueltas - 15 cobradas = 20 sin cobrar, a 12 €
  assert.equal(t.pendienteDeCobro, 240);
});

test('el pendiente de cobro no lo mueve quien paga en la puerta', () => {
  const tickets = { delivered: 10, soldCash: 0, soldBizum: 0, returned: 0 };
  const sinNadie = computeTotals(evento({ tickets }), []);
  const conGente = computeTotals(evento({ tickets }), [entry('cash', true), entry('bizum', true)]);
  assert.equal(sinNadie.pendienteDeCobro, conGente.pendienteDeCobro);
});

test('el reparto respeta el porcentaje del bar', () => {
  const t = computeTotals(evento({ barPct: 30 }), [entry('cash'), entry('cash')]);
  assert.equal(t.facturado, 20);
  assert.equal(t.corteBar, 6);
  assert.equal(t.paraBanda, 14);
});

test('bar al 0% y al 100%', () => {
  const cero = computeTotals(evento({ barPct: 0 }), [entry('cash')]);
  assert.equal(cero.corteBar, 0);
  assert.equal(cero.paraBanda, 10);

  const todo = computeTotals(evento({ barPct: 100 }), [entry('cash')]);
  assert.equal(todo.corteBar, 10);
  assert.equal(todo.paraBanda, 0);
});

test('el reparto siempre suma el facturado, sin céntimos perdidos', () => {
  // Barrido determinista de combinaciones incómodas de precio y porcentaje.
  for (const price of [0.5, 3.33, 7, 8.5, 10, 12.75, 15]) {
    for (const barPct of [0, 7, 12.5, 20, 30, 33, 50, 66, 100]) {
      for (const n of [1, 3, 7, 13, 47]) {
        const entries = Array.from({ length: n }, () => entry('cash'));
        const t = computeTotals(evento({ price, barPct }), entries);
        assert.equal(
          euros(t.corteBar + t.paraBanda),
          t.facturado,
          `precio ${price}, bar ${barPct}%, ${n} entradas`
        );
      }
    }
  }
});

test('efectivo más bizum es igual al facturado', () => {
  const t = computeTotals(
    evento({ price: 8.5, tickets: { delivered: 20, soldCash: 3, soldBizum: 2, returned: 0 } }),
    [entry('cash'), entry('bizum'), entry('bizum'), entry('guest'), entry('already_paid', true)]
  );
  assert.equal(euros(t.efectivoTotal + t.bizumTotal), t.facturado);
});

test('precios decimales no arrastran basura de coma flotante', () => {
  const t = computeTotals(evento({ price: 0.1 }), [entry('cash'), entry('cash'), entry('cash')]);
  assert.equal(t.facturado, 0.3);

  const otro = computeTotals(evento({ price: 8.5, barPct: 33 }), [entry('cash'), entry('bizum')]);
  assert.equal(otro.facturado, 17);
  assert.equal(otro.corteBar, 5.61);
});

test('los conteos por método cuadran con las entries vivas', () => {
  const t = computeTotals(evento(), [
    entry('cash'),
    entry('cash'),
    entry('bizum'),
    entry('already_paid', true),
    entry('guest'),
    entry('guest', false, { voided: true })
  ]);
  assert.deepEqual(t.conteos, {
    cash: 2,
    bizum: 1,
    already_paid: 1,
    guest: 1,
    conEntrada: 1,
    anuladas: 1
  });
  assert.equal(t.asistentes, 5);
});

test('computeTotals es pura: no toca lo que recibe', () => {
  const ev = evento({ tickets: { delivered: 5, soldCash: 1, soldBizum: 1, returned: 0 } });
  const entries = [entry('cash', true), entry('guest')];
  const copiaEvento = structuredClone(ev);
  const copiaEntries = structuredClone(entries);

  computeTotals(ev, entries);

  assert.deepEqual(ev, copiaEvento);
  assert.deepEqual(entries, copiaEntries);
});

test('aguanta cientos de entries sin despeinarse', () => {
  const entries = Array.from({ length: 600 }, (_, i) =>
    entry(/** @type {import('../../calc.js').Metodo} */ (METODOS[i % 4]), i % 3 === 0)
  );
  const t = computeTotals(evento(), entries);
  assert.equal(t.asistentes, 600);
  assert.equal(t.conteos.cash + t.conteos.bizum, 300);
  assert.equal(t.facturado, 3000);
});

test('euros redondea a céntimos y aguanta valores raros', () => {
  assert.equal(euros(0.1 + 0.2), 0.3);
  assert.equal(euros(1.005), 1.01);
  assert.equal(euros(10), 10);
  assert.equal(euros(NaN), 0);
  assert.equal(euros(Infinity), 0);
});

test('num acepta coma decimal y descarta lo que no es número', () => {
  assert.equal(num('12,50'), 12.5);
  assert.equal(num('12.50'), 12.5);
  assert.equal(num(7), 7);
  assert.equal(num(''), 0);
  assert.equal(num('hola'), 0);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
});

test('clamp acota por los dos lados', () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-3, 0, 100), 0);
  assert.equal(clamp(30, 0, 100), 30);
});

test('los cuatro métodos tienen etiqueta', () => {
  assert.equal(METODOS.length, 4);
  for (const m of METODOS) {
    assert.equal(typeof ETIQUETA_METODO[m], 'string');
    assert.ok(ETIQUETA_METODO[m].length > 0);
  }
});

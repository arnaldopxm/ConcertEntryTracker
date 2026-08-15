// @ts-check
// Tests del CSV de cierre. Es el documento que queda cuando se reparte el
// dinero, así que se comprueba con detalle.

import test from 'node:test';
import assert from 'node:assert/strict';

import { toCSV, computeTotals } from '../../calc.js';

/** @returns {import('../../calc.js').Evento} */
function evento(parche = {}) {
  return {
    name: 'Sala Aguere',
    date: '2026-08-15',
    price: 10,
    barPct: 20,
    tickets: { delivered: 40, soldCash: 6, soldBizum: 4, returned: 5 },
    createdAt: new Date('2026-08-15T18:00:00Z'),
    closedAt: null,
    ...parche
  };
}

let contador = 0;
/**
 * @param {import('../../calc.js').Metodo} method
 * @param {Partial<import('../../calc.js').Entry>} [parche]
 * @returns {import('../../calc.js').Entry}
 */
function entry(method, parche = {}) {
  return {
    id: 'e' + contador++,
    ts: new Date('2026-08-15T22:00:00Z'),
    method,
    hasTicket: false,
    note: null,
    voided: false,
    ...parche
  };
}

/**
 * @param {import('../../calc.js').Evento} ev
 * @param {import('../../calc.js').Entry[]} entries
 */
function generar(ev, entries) {
  const csv = toCSV(ev, entries, computeTotals(ev, entries));
  return { csv, lineas: csv.split('\r\n') };
}

/**
 * @param {string[]} lineas
 * @param {string} etiqueta
 * @returns {string}
 */
function valorDe(lineas, etiqueta) {
  const fila = lineas.find((l) => l.startsWith(etiqueta + ';'));
  assert.ok(fila, `no aparece la fila "${etiqueta}"`);
  return fila.slice(etiqueta.length + 1);
}

test('empieza por BOM para que Excel en español no rompa los acentos', () => {
  const { csv } = generar(evento(), []);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('usa punto y coma y salto de línea de Windows', () => {
  const { csv, lineas } = generar(evento(), [entry('cash')]);
  assert.ok(csv.includes('\r\n'));
  assert.ok(lineas[1].startsWith('Fecha;Hora;Método;Entrada física;Importe;Nota;Anulada'));
});

test('lista una fila por movimiento, anulados incluidos', () => {
  const { lineas } = generar(evento(), [
    entry('cash'),
    entry('bizum'),
    entry('guest', { voided: true })
  ]);
  const filas = lineas.slice(2, 5);
  assert.equal(filas.length, 3);
  assert.ok(filas[2].includes('Invitado'));
});

test('el importe de cada fila refleja lo que se cobró de verdad', () => {
  const { lineas } = generar(evento(), [
    entry('cash'),
    entry('bizum'),
    entry('already_paid', { hasTicket: true }),
    entry('guest'),
    entry('cash', { voided: true })
  ]);
  const importes = lineas.slice(2, 7).map((l) => l.split(';')[4]);
  assert.deepEqual(importes, ['10,00', '10,00', '0,00', '0,00', '0,00']);
});

test('marca las anuladas y las cobra a cero', () => {
  const { lineas } = generar(evento(), [entry('cash', { voided: true })]);
  const campos = lineas[2].split(';');
  assert.equal(campos[4], '0,00');
  assert.equal(campos[6], 'Sí');
});

test('los movimientos salen en orden cronológico aunque entren al revés', () => {
  const entries = [
    entry('cash', { ts: new Date('2026-08-15T23:30:00Z'), note: 'tercera' }),
    entry('cash', { ts: new Date('2026-08-15T22:10:00Z'), note: 'primera' }),
    entry('cash', { ts: new Date('2026-08-15T22:50:00Z'), note: 'segunda' })
  ];
  const { lineas } = generar(evento(), entries);
  const notas = lineas.slice(2, 5).map((l) => l.split(';')[5]);
  assert.deepEqual(notas, ['primera', 'segunda', 'tercera']);
});

test('escapa las notas que llevan punto y coma o comillas', () => {
  const { lineas } = generar(evento(), [
    entry('cash', { note: 'venía con Ana; sin entrada' }),
    entry('cash', { note: 'dijo "que ya pagó"' })
  ]);
  assert.ok(lineas[2].includes('"venía con Ana; sin entrada"'));
  assert.ok(lineas[3].includes('"dijo ""que ya pagó"""'));

  // Y al reabrirlo, el número de columnas sigue siendo el correcto.
  assert.equal(partirCSV(lineas[2]).length, 7);
  assert.equal(partirCSV(lineas[3]).length, 7);
});

test('la hora y la fecha van en columnas separadas y con formato fijo', () => {
  const { lineas } = generar(evento(), [entry('cash')]);
  const [fecha, hora] = lineas[2].split(';');
  assert.match(fecha, /^\d{1,2}\/\d{1,2}\/\d{4}$/);
  assert.match(hora, /^\d{1,2}:\d{2}:\d{2}$/);
});

test('el resumen trae el cuadre completo', () => {
  const entries = [entry('cash'), entry('bizum'), entry('guest')];
  const { lineas } = generar(evento(), entries);

  assert.equal(valorDe(lineas, 'Evento'), 'Sala Aguere');
  assert.equal(valorDe(lineas, 'Precio entrada'), '10,00');
  assert.equal(valorDe(lineas, 'Asistentes'), '3');
  assert.equal(valorDe(lineas, 'Ingresos preventa'), '100,00');
  assert.equal(valorDe(lineas, 'Ingresos puerta'), '20,00');
  assert.equal(valorDe(lineas, 'Facturado'), '120,00');
  assert.equal(valorDe(lineas, 'Efectivo total'), '70,00');
  assert.equal(valorDe(lineas, 'Bizum total'), '50,00');
  assert.equal(valorDe(lineas, 'Corte del bar (20%)'), '24,00');
  assert.equal(valorDe(lineas, 'Para la banda'), '96,00');
});

test('el resumen trae el estado del talonario', () => {
  const { lineas } = generar(evento(), [entry('cash', { hasTicket: true })]);
  assert.equal(valorDe(lineas, 'Entradas entregadas'), '40');
  assert.equal(valorDe(lineas, 'Entradas cobradas en efectivo (preventa)'), '6');
  assert.equal(valorDe(lineas, 'Entradas cobradas por bizum (preventa)'), '4');
  assert.equal(valorDe(lineas, 'Entradas devueltas'), '5');
  assert.equal(valorDe(lineas, 'Entradas en circulación'), '35');
  assert.equal(valorDe(lineas, 'Entradas sin aparecer'), '34');
  assert.equal(valorDe(lineas, 'Pendiente de cobro'), '250,00');
});

test('los números van con coma decimal, como espera Excel en español', () => {
  const { lineas } = generar(evento({ price: 8.5 }), [entry('cash')]);
  assert.equal(valorDe(lineas, 'Precio entrada'), '8,50');
  assert.ok(!valorDe(lineas, 'Facturado').includes('.'));
});

test('indica si la caja quedó sin cerrar', () => {
  const { lineas } = generar(evento(), []);
  assert.equal(valorDe(lineas, 'Cierre de caja'), 'Sin cerrar');

  const cerrada = generar(evento({ closedAt: new Date('2026-08-16T02:30:00Z') }), []);
  assert.notEqual(valorDe(cerrada.lineas, 'Cierre de caja'), 'Sin cerrar');
});

test('sin movimientos sigue generando un resumen válido', () => {
  const { lineas } = generar(evento(), []);
  assert.equal(valorDe(lineas, 'Asistentes'), '0');
  assert.equal(valorDe(lineas, 'Anuladas'), '0');
  assert.ok(lineas.length > 20);
});

/**
 * Parser mínimo de una línea CSV con comillas, para comprobar el escapado.
 * @param {string} linea
 * @returns {string[]}
 */
function partirCSV(linea) {
  const campos = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (enComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') {
        enComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ';') {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
}

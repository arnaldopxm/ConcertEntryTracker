// @ts-check
// calc.js — cálculos del cuadre. Funciones puras, sin Firestore ni DOM.
//
// Vive separado de store.js para que se pueda testear en Node directamente, sin
// navegador y sin dobles del SDK. store.js lo reexporta, así que las vistas
// siguen viendo una única superficie.

/** @typedef {'cash'|'bizum'|'already_paid'|'guest'} Metodo */

/**
 * @typedef {object} Talonario
 * @property {number} delivered  Entradas físicas que salieron de las manos del tesorero.
 * @property {number} soldCash   De esas, cobradas en efectivo ANTES del evento.
 * @property {number} soldBizum  De esas, cobradas por bizum ANTES del evento.
 * @property {number} returned   Talonario sobrante que vuelve.
 */

/**
 * @typedef {object} Evento
 * @property {string} name
 * @property {string} date
 * @property {number} price
 * @property {number} barPct
 * @property {Talonario} tickets
 * @property {Date|null} createdAt
 * @property {Date|null} closedAt
 */

/**
 * @typedef {object} Entry
 * @property {string} id
 * @property {Date|null} ts
 * @property {Metodo} method
 * @property {boolean} hasTicket
 * @property {string|null} note
 * @property {boolean} voided
 */

/**
 * @typedef {object} Conteos
 * @property {number} cash
 * @property {number} bizum
 * @property {number} already_paid
 * @property {number} guest
 * @property {number} conEntrada
 * @property {number} anuladas
 */

/**
 * @typedef {object} Totales
 * @property {number} price
 * @property {number} barPct
 * @property {Conteos} conteos
 * @property {number} asistentes
 * @property {number} ingresosPreventa
 * @property {number} ingresosPuerta
 * @property {number} facturado
 * @property {number} efectivoTotal
 * @property {number} bizumTotal
 * @property {number} corteBar
 * @property {number} paraBanda
 * @property {number} entradasEnCirculacion
 * @property {number} entradasRestantes
 * @property {number} pendienteDeCobro
 */

/** @type {Metodo[]} */
export const METODOS = ['cash', 'bizum', 'already_paid', 'guest'];

/** @type {Record<Metodo, string>} */
export const ETIQUETA_METODO = {
  cash: 'Efectivo',
  bizum: 'Bizum',
  already_paid: 'Ya pagada',
  guest: 'Invitado'
};

/** @returns {Talonario} */
export function talonarioVacio() {
  return { delivered: 0, soldCash: 0, soldBizum: 0, returned: 0 };
}

/**
 * Convierte a número lo que venga de un input, aceptando coma decimal.
 * @param {unknown} v
 * @returns {number}
 */
export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Redondeo a céntimos, evitando la basura del coma flotante.
 * @param {number} n
 * @returns {number}
 */
export function euros(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Todos los cálculos del cuadre. Función pura: mismo evento y mismas entries,
 * mismo resultado. Ignora siempre las entries anuladas.
 *
 * @param {Evento|null} evento
 * @param {Entry[]} entries
 * @returns {Totales}
 */
export function computeTotals(evento, entries) {
  const price = evento ? num(evento.price) : 0;
  const barPct = evento ? num(evento.barPct) : 0;
  const t = evento ? evento.tickets : talonarioVacio();

  const todas = entries || [];
  const vivas = todas.filter((e) => !e.voided);

  const nCash = vivas.filter((e) => e.method === 'cash').length;
  const nBizum = vivas.filter((e) => e.method === 'bizum').length;
  const nYaPagada = vivas.filter((e) => e.method === 'already_paid').length;
  const nInvitado = vivas.filter((e) => e.method === 'guest').length;
  const nConEntrada = vivas.filter((e) => e.hasTicket).length;

  const ingresosPreventa = euros((t.soldCash + t.soldBizum) * price);
  const ingresosPuerta = euros((nCash + nBizum) * price);
  const facturado = euros(ingresosPreventa + ingresosPuerta);

  const efectivoTotal = euros(t.soldCash * price + nCash * price);
  const bizumTotal = euros(t.soldBizum * price + nBizum * price);

  const corteBar = euros(facturado * (barPct / 100));
  const paraBanda = euros(facturado - corteBar);

  const entradasEnCirculacion = t.delivered - t.returned;
  const entradasRestantes = entradasEnCirculacion - nConEntrada;
  const pendienteDeCobro = euros(
    (t.delivered - t.returned - t.soldCash - t.soldBizum) * price
  );

  return {
    price,
    barPct,
    conteos: {
      cash: nCash,
      bizum: nBizum,
      already_paid: nYaPagada,
      guest: nInvitado,
      conEntrada: nConEntrada,
      anuladas: todas.length - vivas.length
    },
    asistentes: vivas.length,
    ingresosPreventa,
    ingresosPuerta,
    facturado,
    efectivoTotal,
    bizumTotal,
    corteBar,
    paraBanda,
    entradasEnCirculacion,
    entradasRestantes,
    pendienteDeCobro
  };
}

/**
 * CSV del cuadre completo: movimientos y resumen. Separador punto y coma y BOM
 * para que Excel en español lo abra bien de un doble clic.
 *
 * @param {Evento} evento
 * @param {Entry[]} entries
 * @param {Totales} totales
 * @returns {string}
 */
export function toCSV(evento, entries, totales) {
  /** @param {unknown} v */
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  /** @param {unknown[]} campos */
  const linea = (campos) => campos.map(esc).join(';');
  /** @param {number} n */
  const dinero = (n) => euros(n).toFixed(2).replace('.', ',');

  const filas = [];
  filas.push(linea(['Movimientos']));
  filas.push(linea(['Fecha', 'Hora', 'Método', 'Entrada física', 'Importe', 'Nota', 'Anulada']));

  const cronologico = [...entries].sort(
    (a, b) => (a.ts ? a.ts.getTime() : 0) - (b.ts ? b.ts.getTime() : 0)
  );
  for (const e of cronologico) {
    const cobra = e.method === 'cash' || e.method === 'bizum';
    filas.push(
      linea([
        e.ts ? e.ts.toLocaleDateString('es-ES') : '',
        e.ts
          ? e.ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '',
        ETIQUETA_METODO[e.method] || e.method,
        e.hasTicket ? 'Sí' : 'No',
        e.voided ? dinero(0) : dinero(cobra ? totales.price : 0),
        e.note || '',
        e.voided ? 'Sí' : 'No'
      ])
    );
  }

  filas.push('');
  filas.push(linea(['Resumen']));
  filas.push(linea(['Evento', evento.name]));
  filas.push(linea(['Fecha', evento.date]));
  filas.push(linea(['Precio entrada', dinero(totales.price)]));
  filas.push(linea(['Asistentes', totales.asistentes]));
  filas.push('');
  filas.push(linea(['Entradas entregadas', evento.tickets.delivered]));
  filas.push(linea(['Entradas cobradas en efectivo (preventa)', evento.tickets.soldCash]));
  filas.push(linea(['Entradas cobradas por bizum (preventa)', evento.tickets.soldBizum]));
  filas.push(linea(['Entradas devueltas', evento.tickets.returned]));
  filas.push(linea(['Entradas en circulación', totales.entradasEnCirculacion]));
  filas.push(linea(['Entradas sin aparecer', totales.entradasRestantes]));
  filas.push(linea(['Pendiente de cobro', dinero(totales.pendienteDeCobro)]));
  filas.push('');
  filas.push(linea(['Registradas en puerta: efectivo', totales.conteos.cash]));
  filas.push(linea(['Registradas en puerta: bizum', totales.conteos.bizum]));
  filas.push(linea(['Registradas en puerta: ya pagada', totales.conteos.already_paid]));
  filas.push(linea(['Registradas en puerta: invitado', totales.conteos.guest]));
  filas.push(linea(['Anuladas', totales.conteos.anuladas]));
  filas.push('');
  filas.push(linea(['Ingresos preventa', dinero(totales.ingresosPreventa)]));
  filas.push(linea(['Ingresos puerta', dinero(totales.ingresosPuerta)]));
  filas.push(linea(['Facturado', dinero(totales.facturado)]));
  filas.push(linea(['Efectivo total', dinero(totales.efectivoTotal)]));
  filas.push(linea(['Bizum total', dinero(totales.bizumTotal)]));
  filas.push(linea([`Corte del bar (${totales.barPct}%)`, dinero(totales.corteBar)]));
  filas.push(linea(['Para la banda', dinero(totales.paraBanda)]));
  filas.push(
    linea(['Cierre de caja', evento.closedAt ? evento.closedAt.toLocaleString('es-ES') : 'Sin cerrar'])
  );

  return '﻿' + filas.join('\r\n');
}

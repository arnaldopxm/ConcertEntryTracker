// store.js — única capa que habla con Firestore.
//
// Las vistas no importan nada de firebase: piden estado a openEvent() y llaman
// a sus acciones. Todos los cálculos derivados viven aquí, en computeTotals().
//
// Nota importante sobre escrituras: NINGUNA acción hace await de la promesa de
// Firestore. Sin red, esas promesas no se resuelven hasta que vuelve la señal,
// pero la caché local ya tiene el dato y el listener dispara al instante. Si la
// interfaz esperase al await, la puerta se quedaría congelada en cuanto fallase
// la cobertura del bar.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { firebaseConfig, configPendiente } from './firebase-config.js';

export const METODOS = ['cash', 'bizum', 'already_paid', 'guest'];

export const ETIQUETA_METODO = {
  cash: 'Efectivo',
  bizum: 'Bizum',
  already_paid: 'Ya pagada',
  guest: 'Invitado'
};

let _init = null;
let _db = null;
let _auth = null;
let _hayAuth = false;

/** Arranca Firebase una sola vez. Devuelve { db, auth }. */
export function initApp() {
  if (_init) return _init;

  _init = (async () => {
    if (configPendiente()) {
      throw new Error('CONFIG_PENDIENTE');
    }

    const app = initializeApp(firebaseConfig);

    try {
      _db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    } catch (err) {
      // Navegación privada o IndexedDB bloqueado: seguimos sin caché en disco.
      console.warn('Sin caché persistente, se usa memoria:', err);
      _db = initializeFirestore(app, {});
    }

    _auth = getAuth(app);

    // Si ya hay sesión anónima guardada, se restaura sin red. Solo pedimos una
    // nueva cuando no la hay.
    const usuario = await new Promise((resolve) => {
      const off = onAuthStateChanged(_auth, (u) => {
        off();
        resolve(u);
      });
    });

    if (usuario) {
      _hayAuth = true;
    } else {
      await intentarLogin();
      // Sin red no habrá sesión todavía: se reintenta al recuperar señal.
      window.addEventListener('online', intentarLogin);
    }

    return { db: _db, auth: _auth };
  })();

  return _init;
}

async function intentarLogin() {
  if (_hayAuth) return;
  try {
    await signInAnonymously(_auth);
    _hayAuth = true;
  } catch (err) {
    console.warn('No se pudo iniciar sesión anónima (¿sin red?):', err);
  }
}

export function haySesion() {
  return _hayAuth;
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Identificador aleatorio de 20 caracteres, con el generador criptográfico. */
export function nuevoEventId() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += ALFABETO[b % ALFABETO.length];
  return id;
}

export function talonarioVacio() {
  return { delivered: 0, soldCash: 0, soldBizum: 0, returned: 0 };
}

/**
 * Crea el documento del evento. No espera confirmación del servidor: la caché
 * local ya lo tiene y la navegación puede seguir.
 */
export function crearEvento(eventId, { name, date, price, barPct, tickets }) {
  const ref = doc(_db, 'events', eventId);
  const datos = {
    name: String(name || '').slice(0, 120),
    date: String(date || '').slice(0, 40),
    price: num(price),
    barPct: clamp(num(barPct), 0, 100),
    tickets: { ...talonarioVacio(), ...(tickets || {}) },
    createdAt: Timestamp.now(),
    closedAt: null
  };
  setDoc(ref, datos).catch((err) => console.error('Error creando evento:', err));
  return datos;
}

/**
 * Abre un evento: suscribe a su documento y a toda la subcolección de entries,
 * recalcula los totales en cada cambio y notifica a quien escuche.
 *
 * Devuelve un objeto con las acciones y un subscribe(fn) que entrega el estado
 * completo y devuelve la función para desuscribirse.
 */
export function openEvent(eventId) {
  const oyentes = new Set();

  const estado = {
    eventId,
    cargando: true,
    existe: false,
    evento: null,
    entries: [],
    totales: computeTotals(null, []),
    online: navigator.onLine,
    pendientes: 0,
    desdeCache: false,
    error: null
  };

  const emitir = () => {
    for (const fn of oyentes) fn(estado);
  };

  const recalcular = () => {
    estado.totales = computeTotals(estado.evento, estado.entries);
  };

  const refEvento = doc(_db, 'events', eventId);
  const refEntries = query(
    collection(_db, 'events', eventId, 'entries'),
    orderBy('ts', 'desc')
  );

  let listoEvento = false;
  let listoEntries = false;
  const marcarListo = () => {
    if (listoEvento && listoEntries) estado.cargando = false;
  };

  const offEvento = onSnapshot(
    refEvento,
    { includeMetadataChanges: true },
    (snap) => {
      listoEvento = true;
      estado.existe = snap.exists();
      estado.evento = snap.exists() ? normalizarEvento(snap.data()) : null;
      recalcular();
      marcarListo();
      emitir();
    },
    (err) => {
      listoEvento = true;
      estado.error = err;
      marcarListo();
      emitir();
    }
  );

  const offEntries = onSnapshot(
    refEntries,
    { includeMetadataChanges: true },
    (snap) => {
      listoEntries = true;
      estado.entries = snap.docs.map((d) => normalizarEntry(d.id, d.data()));
      estado.pendientes = snap.docs.filter((d) => d.metadata.hasPendingWrites).length;
      estado.desdeCache = snap.metadata.fromCache;
      recalcular();
      marcarListo();
      emitir();
    },
    (err) => {
      listoEntries = true;
      estado.error = err;
      marcarListo();
      emitir();
    }
  );

  const alCambiarRed = () => {
    estado.online = navigator.onLine;
    emitir();
  };
  window.addEventListener('online', alCambiarRed);
  window.addEventListener('offline', alCambiarRed);

  return {
    eventId,

    getState: () => estado,

    subscribe(fn) {
      oyentes.add(fn);
      fn(estado);
      return () => oyentes.delete(fn);
    },

    /**
     * Registra una persona. Devuelve el id del documento de inmediato para que
     * el botón Deshacer del toast pueda anularlo sin esperar al servidor.
     */
    addEntry({ method, hasTicket, note = null }) {
      if (!METODOS.includes(method)) throw new Error('Método desconocido: ' + method);
      const ref = doc(collection(_db, 'events', eventId, 'entries'));
      const datos = {
        ts: Timestamp.now(),
        method,
        hasTicket: !!hasTicket,
        note: note ? String(note).slice(0, 200) : null,
        voided: false
      };
      setDoc(ref, datos).catch((err) => console.error('Error registrando entrada:', err));
      return ref.id;
    },

    /** Anulación lógica. Nunca se borra el documento. */
    setVoided(entryId, voided) {
      const ref = doc(_db, 'events', eventId, 'entries', entryId);
      updateDoc(ref, { voided: !!voided }).catch((err) =>
        console.error('Error anulando entrada:', err)
      );
    },

    /** Cambia configuración del evento (nombre, precio, %, talonario…). */
    updateConfig(patch) {
      const limpio = {};
      if ('name' in patch) limpio.name = String(patch.name).slice(0, 120);
      if ('date' in patch) limpio.date = String(patch.date).slice(0, 40);
      if ('price' in patch) limpio.price = Math.max(0, num(patch.price));
      if ('barPct' in patch) limpio.barPct = clamp(num(patch.barPct), 0, 100);
      for (const k of ['delivered', 'soldCash', 'soldBizum', 'returned']) {
        if (k in patch) limpio['tickets.' + k] = Math.max(0, Math.round(num(patch[k])));
      }
      if (!Object.keys(limpio).length) return;
      updateDoc(refEvento, limpio).catch((err) =>
        console.error('Error guardando configuración:', err)
      );
    },

    cerrarCaja() {
      updateDoc(refEvento, { closedAt: Timestamp.now() }).catch((err) =>
        console.error('Error cerrando caja:', err)
      );
    },

    destroy() {
      offEvento();
      offEntries();
      window.removeEventListener('online', alCambiarRed);
      window.removeEventListener('offline', alCambiarRed);
      oyentes.clear();
    }
  };
}

function normalizarEvento(d) {
  return {
    name: d.name || '',
    date: d.date || '',
    price: num(d.price),
    barPct: num(d.barPct),
    tickets: { ...talonarioVacio(), ...(d.tickets || {}) },
    createdAt: aFecha(d.createdAt),
    closedAt: aFecha(d.closedAt)
  };
}

function normalizarEntry(id, d) {
  return {
    id,
    ts: aFecha(d.ts),
    method: d.method,
    hasTicket: !!d.hasTicket,
    note: d.note || null,
    voided: !!d.voided
  };
}

function aFecha(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  return null;
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Redondeo a céntimos, evitando la basura del coma flotante. */
export function euros(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Todos los cálculos del cuadre. Función pura: mismo evento y mismas entries,
 * mismo resultado. Ignora siempre las entries anuladas.
 */
export function computeTotals(evento, entries) {
  const price = evento ? num(evento.price) : 0;
  const barPct = evento ? num(evento.barPct) : 0;
  const t = evento ? evento.tickets : talonarioVacio();

  const vivas = (entries || []).filter((e) => !e.voided);

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
      anuladas: (entries || []).length - vivas.length
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
 */
export function toCSV(evento, entries, totales) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const linea = (campos) => campos.map(esc).join(';');
  const dinero = (n) => euros(n).toFixed(2).replace('.', ',');

  const filas = [];
  filas.push(linea(['Movimientos']));
  filas.push(linea(['Fecha', 'Hora', 'Método', 'Entrada física', 'Importe', 'Nota', 'Anulada']));

  const cronologico = [...entries].sort((a, b) => (a.ts?.getTime() || 0) - (b.ts?.getTime() || 0));
  for (const e of cronologico) {
    const cobra = e.method === 'cash' || e.method === 'bizum';
    filas.push(
      linea([
        e.ts ? e.ts.toLocaleDateString('es-ES') : '',
        e.ts ? e.ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
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
  filas.push(linea(['Cierre de caja', evento.closedAt ? evento.closedAt.toLocaleString('es-ES') : 'Sin cerrar']));

  return '﻿' + filas.join('\r\n');
}

// @ts-check
// store.js — única capa que habla con Firestore.
//
// Las vistas no importan nada de firebase: piden estado a openEvent() y llaman
// a sus acciones. Los cálculos derivados viven en calc.js y se reexportan aquí,
// para que la superficie que ven las vistas siga siendo una sola.
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
import { computeTotals, num, clamp, talonarioVacio, METODOS } from './calc.js';

export {
  METODOS,
  ETIQUETA_METODO,
  computeTotals,
  talonarioVacio,
  euros,
  toCSV
} from './calc.js';

/**
 * @typedef {import('./calc.js').Evento} Evento
 * @typedef {import('./calc.js').Entry} Entry
 * @typedef {import('./calc.js').Metodo} Metodo
 * @typedef {import('./calc.js').Talonario} Talonario
 * @typedef {import('./calc.js').Totales} Totales
 */

/**
 * @typedef {object} EstadoEvento
 * @property {string} eventId
 * @property {boolean} cargando
 * @property {boolean} existe
 * @property {Evento|null} evento
 * @property {Entry[]} entries
 * @property {Totales} totales
 * @property {boolean} online     Hay red según el navegador.
 * @property {number} pendientes  Escrituras aún sin confirmar por el servidor.
 * @property {boolean} desdeCache
 * @property {unknown} error
 */

/** @type {Promise<{db: import('firebase/firestore').Firestore, auth: import('firebase/auth').Auth}>|null} */
let _init = null;
/** @type {import('firebase/firestore').Firestore} */
let _db;
/** @type {import('firebase/auth').Auth} */
let _auth;
let _hayAuth = false;

/** Arranca Firebase una sola vez. */
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

/** @type {Promise<void>|null} */
let _loginEnCurso = null;

/**
 * Pide sesión anónima como mucho una vez a la vez. El evento 'online' puede
 * dispararse varias veces seguidas al recuperar cobertura y no queremos abrir
 * tres sesiones en paralelo.
 */
function intentarLogin() {
  if (_hayAuth) return Promise.resolve();
  if (_loginEnCurso) return _loginEnCurso;

  _loginEnCurso = signInAnonymously(_auth)
    .then(() => {
      _hayAuth = true;
    })
    .catch((err) => {
      console.warn('No se pudo iniciar sesión anónima (¿sin red?):', err);
    })
    .finally(() => {
      _loginEnCurso = null;
    });

  return _loginEnCurso;
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

/**
 * Crea el documento del evento. No espera confirmación del servidor: la caché
 * local ya lo tiene y la navegación puede seguir.
 *
 * @param {string} eventId
 * @param {{name: string, date: string, price: unknown, barPct: unknown, tickets?: Partial<Talonario>}} datos
 */
export function crearEvento(eventId, { name, date, price, barPct, tickets }) {
  const ref = doc(_db, 'events', eventId);
  const documento = {
    name: String(name || '').slice(0, 120),
    date: String(date || '').slice(0, 40),
    price: Math.max(0, num(price)),
    barPct: clamp(num(barPct), 0, 100),
    tickets: { ...talonarioVacio(), ...(tickets || {}) },
    createdAt: Timestamp.now(),
    closedAt: null
  };
  setDoc(ref, documento).catch((err) => console.error('Error creando evento:', err));
  return documento;
}

/**
 * Abre un evento: suscribe a su documento y a toda la subcolección de entries,
 * recalcula los totales en cada cambio y notifica a quien escuche.
 *
 * @param {string} eventId
 */
export function openEvent(eventId) {
  /** @type {Set<(estado: EstadoEvento) => void>} */
  const oyentes = new Set();

  /** @type {EstadoEvento} */
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

    /** @param {(estado: EstadoEvento) => void} fn */
    subscribe(fn) {
      oyentes.add(fn);
      fn(estado);
      return () => oyentes.delete(fn);
    },

    /**
     * Registra una persona. Devuelve el id del documento de inmediato para que
     * el botón Deshacer del toast pueda anularlo sin esperar al servidor.
     *
     * @param {{method: Metodo, hasTicket: boolean, note?: string|null}} datos
     * @returns {string}
     */
    addEntry({ method, hasTicket, note = null }) {
      // Guardia en tiempo de ejecución además del tipo: un método inválido lo
      // rechazarían las reglas en silencio y la entrada desaparecería sola.
      if (!METODOS.includes(method)) throw new Error('Método desconocido: ' + method);
      const ref = doc(collection(_db, 'events', eventId, 'entries'));
      const documento = {
        ts: Timestamp.now(),
        method,
        hasTicket: !!hasTicket,
        note: note ? String(note).slice(0, 200) : null,
        voided: false
      };
      setDoc(ref, documento).catch((err) => console.error('Error registrando entrada:', err));
      return ref.id;
    },

    /**
     * Anulación lógica. Nunca se borra el documento.
     * @param {string} entryId
     * @param {boolean} voided
     */
    setVoided(entryId, voided) {
      const ref = doc(_db, 'events', eventId, 'entries', entryId);
      updateDoc(ref, { voided: !!voided }).catch((err) =>
        console.error('Error anulando entrada:', err)
      );
    },

    /**
     * Cambia configuración del evento (nombre, precio, %, talonario…).
     * @param {Record<string, unknown>} patch
     */
    updateConfig(patch) {
      /** @type {Record<string, unknown>} */
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

/** @typedef {ReturnType<typeof openEvent>} Store */

/**
 * @param {Record<string, any>} d
 * @returns {Evento}
 */
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

/**
 * @param {string} id
 * @param {Record<string, any>} d
 * @returns {Entry}
 */
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

/**
 * @param {unknown} v
 * @returns {Date|null}
 */
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && 'toDate' in v && typeof v.toDate === 'function') {
    return v.toDate();
  }
  return null;
}

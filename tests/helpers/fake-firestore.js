// @ts-nocheck — es un doble deliberadamente laxo: imita la forma del SDK, no
// sus tipos. Comprobarlo estáticamente solo añadiría ruido.
// Doble del SDK de Firestore para los tests de navegador.
//
// Se sirve en lugar de gstatic e implementa solo la superficie que usa
// store.js. La base vive en memoria y se propaga entre pestañas por
// BroadcastChannel, así que dos páginas abiertas se sincronizan igual que con
// los listeners reales.
//
// El payload viaja dentro del mensaje y no se relee de localStorage: entre
// procesos de renderizado, localStorage no es coherente al instante y la otra
// pestaña leería datos viejos.

const CLAVE = '__fakedb__';
const canal = new BroadcastChannel('__fakedb__');
const oyentes = new Set();

let memoria = null;

function leerDB() {
  if (memoria) return memoria;
  try {
    memoria = JSON.parse(localStorage.getItem(CLAVE) || '{}');
  } catch {
    memoria = {};
  }
  return memoria;
}

function escribirDB(db) {
  memoria = db;
  localStorage.setItem(CLAVE, JSON.stringify(db));
  canal.postMessage(db);
  notificar();
}

function notificar() {
  for (const fn of [...oyentes]) fn();
}

canal.onmessage = (ev) => {
  memoria = ev.data;
  notificar();
};

function serializar(v) {
  if (v instanceof Timestamp) return { __ts: v.ms };
  if (Array.isArray(v)) return v.map(serializar);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = serializar(x);
    return out;
  }
  return v;
}

function deserializar(v) {
  if (v && typeof v === 'object' && '__ts' in v) return new Timestamp(v.__ts);
  if (Array.isArray(v)) return v.map(deserializar);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deserializar(x);
    return out;
  }
  return v;
}

export class Timestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static now() {
    return new Timestamp(Date.now());
  }
  toDate() {
    return new Date(this.ms);
  }
}

export function initializeApp(config) {
  return { config };
}

export function getAuth() {
  return { currentUser: { uid: 'test' } };
}

export async function signInAnonymously() {
  return { user: { uid: 'test' } };
}

export function onAuthStateChanged(auth, cb) {
  setTimeout(() => cb({ uid: 'test' }), 0);
  return () => {};
}

export function initializeFirestore() {
  return { __db: true };
}

export function persistentLocalCache() {
  return {};
}

export function persistentMultipleTabManager() {
  return {};
}

let contador = 0;
function idAleatorio() {
  return 'id' + contador++ + Math.random().toString(36).slice(2, 8);
}

export function doc(...args) {
  if (args[0] && args[0].__coleccion) {
    // Ojo: el id se calcula UNA vez. Generarlo dos veces devolvía una ruta y un
    // .id distintos, y cualquier update posterior apuntaba al vacío.
    const id = args[1] || idAleatorio();
    return { ruta: args[0].ruta + '/' + id, id };
  }
  const segmentos = args.slice(1);
  return { ruta: segmentos.join('/'), id: segmentos[segmentos.length - 1] };
}

export function collection(...args) {
  const primero = args[0];
  const base = primero && primero.ruta ? primero.ruta : '';
  const ruta = [base, ...args.slice(1)].filter(Boolean).join('/');
  return { ruta, __coleccion: true };
}

export function query(coll, ...constraints) {
  return { ...coll, __query: true, orden: constraints.find((c) => c && c.__orderBy) || null };
}

export function orderBy(campo, dir = 'asc') {
  return { __orderBy: true, campo, dir };
}

export async function setDoc(ref, datos) {
  const db = leerDB();
  db[ref.ruta] = serializar(datos);
  escribirDB(db);
}

export async function updateDoc(ref, patch) {
  const db = leerDB();
  const actual = db[ref.ruta];
  if (!actual) throw new Error('No existe ' + ref.ruta);
  for (const [clave, valor] of Object.entries(patch)) {
    const partes = clave.split('.');
    let nodo = actual;
    while (partes.length > 1) nodo = nodo[partes.shift()];
    nodo[partes[0]] = serializar(valor);
  }
  db[ref.ruta] = actual;
  escribirDB(db);
}

const META = { fromCache: false, hasPendingWrites: false };

export function onSnapshot(ref, opciones, siguiente) {
  if (typeof opciones === 'function') siguiente = opciones;

  const emitir = () => {
    const db = leerDB();
    if (ref.__coleccion || ref.__query) {
      const prefijo = ref.ruta + '/';
      const docs = Object.keys(db)
        .filter((k) => k.startsWith(prefijo) && !k.slice(prefijo.length).includes('/'))
        .map((k) => ({ id: k.slice(prefijo.length), datos: deserializar(db[k]) }));
      if (ref.orden) {
        const { campo, dir } = ref.orden;
        docs.sort((a, b) => {
          const va = a.datos[campo] ? a.datos[campo].ms : 0;
          const vb = b.datos[campo] ? b.datos[campo].ms : 0;
          return dir === 'desc' ? vb - va : va - vb;
        });
      }
      siguiente({
        docs: docs.map((d) => ({ id: d.id, data: () => d.datos, metadata: META })),
        metadata: META
      });
    } else {
      const bruto = db[ref.ruta];
      siguiente({
        exists: () => !!bruto,
        data: () => (bruto ? deserializar(bruto) : undefined),
        metadata: META
      });
    }
  };

  oyentes.add(emitir);
  setTimeout(emitir, 0);
  return () => oyentes.delete(emitir);
}

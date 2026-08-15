// @ts-check
// mis-eventos.js — índice local de los eventos creados en ESTE dispositivo.
//
// Sí, usa localStorage, y no contradice la regla de que la fuente de verdad es
// Firestore: aquí no vive ni un euro ni un asistente. Es una agenda de atajos
// (id, nombre y fecha) para poder volver a un evento y saltar entre puerta y
// tesorería sin tener que guardar el enlace a mano. Si se borra, no se pierde
// nada: los datos siguen en Firestore y el enlace sigue funcionando.

const CLAVE = 'taquilla:mis-eventos';
const MAXIMO = 20;

/**
 * @typedef {object} EventoLocal
 * @property {string} id
 * @property {string} name
 * @property {string} date
 * @property {number} visto  Milisegundos de la última vez que se abrió.
 */

/**
 * @returns {EventoLocal[]} Del más reciente al más antiguo.
 */
export function listar() {
  try {
    const bruto = localStorage.getItem(CLAVE);
    if (!bruto) return [];
    const datos = JSON.parse(bruto);
    if (!Array.isArray(datos)) return [];
    return datos
      .filter((e) => e && typeof e.id === 'string' && e.id.length > 0)
      .map((e) => ({
        id: e.id,
        name: typeof e.name === 'string' ? e.name : '',
        date: typeof e.date === 'string' ? e.date : '',
        visto: typeof e.visto === 'number' ? e.visto : 0
      }))
      .sort((a, b) => b.visto - a.visto)
      .slice(0, MAXIMO);
  } catch {
    // Modo privado o almacenamiento lleno: seguimos sin agenda.
    return [];
  }
}

/**
 * Guarda o actualiza un evento en la agenda local.
 *
 * @param {{id: string, name?: string, date?: string}} evento
 */
export function recordar({ id, name = '', date = '' }) {
  if (!id) return;
  try {
    const previos = listar().filter((e) => e.id !== id);
    const anterior = listar().find((e) => e.id === id);
    const entrada = {
      id,
      name: name || (anterior ? anterior.name : ''),
      date: date || (anterior ? anterior.date : ''),
      visto: Date.now()
    };
    localStorage.setItem(CLAVE, JSON.stringify([entrada, ...previos].slice(0, MAXIMO)));
  } catch {
    // Sin almacenamiento no hay agenda, pero la app funciona igual.
  }
}

/** @param {string} id */
export function olvidar(id) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(listar().filter((e) => e.id !== id)));
  } catch {
    // Nada que hacer.
  }
}

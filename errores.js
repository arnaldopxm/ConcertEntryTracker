// @ts-check
// errores.js — traduce los fallos de Firestore a algo accionable.
//
// La app escribe sin esperar confirmación (a propósito: sin cobertura esa
// promesa no vuelve). El precio de esa decisión es que los rechazos del
// servidor llegan tarde y por un canal aparte, así que hay que enseñarlos
// explícitamente o el usuario se queda mirando una pantalla muerta.

/**
 * @param {unknown} err
 * @returns {string}
 */
export function codigoDeError(err) {
  if (err && typeof err === 'object' && 'code' in err) return String(err.code);
  return '';
}

/**
 * Mensaje para pantalla: qué ha pasado y qué hacer. Sin disculpas.
 *
 * @param {unknown} err
 * @returns {{titulo: string, detalle: string, pasos: string[]}}
 */
export function explicarError(err) {
  const codigo = codigoDeError(err);

  if (codigo === 'permission-denied') {
    return {
      titulo: 'Firestore ha rechazado el acceso',
      detalle: 'La base de datos existe, pero las reglas no dejan leer ni escribir con esta sesión.',
      pasos: [
        'Firebase > Authentication > Sign-in method: activa "Anonymous".',
        'Firebase > Firestore Database > Rules: publica el contenido de firestore.rules.',
        'Vuelve a cargar esta página.'
      ]
    };
  }

  if (codigo === 'unauthenticated') {
    return {
      titulo: 'No hay sesión',
      detalle: 'La app no ha podido abrir una sesión anónima con Firebase.',
      pasos: [
        'Firebase > Authentication > Sign-in method: activa "Anonymous".',
        'Comprueba que el dominio está en Authentication > Settings > Authorized domains.',
        'Vuelve a cargar esta página.'
      ]
    };
  }

  if (codigo === 'unavailable' || codigo === 'deadline-exceeded') {
    return {
      titulo: 'Sin conexión con Firestore',
      detalle: 'Se sigue trabajando en local y se enviará al recuperar señal.',
      pasos: []
    };
  }

  if (codigo === 'not-found') {
    return {
      titulo: 'Falta la base de datos',
      detalle: 'El proyecto de Firebase no tiene Firestore activado, o el projectId no es el correcto.',
      pasos: [
        'Firebase > Firestore Database > Crear base de datos.',
        'Comprueba el projectId en firebase-config.js.'
      ]
    };
  }

  return {
    titulo: 'No se pudo hablar con Firestore',
    detalle: codigo ? `Error ${codigo}.` : String(err && /** @type {Error} */ (err).message || err),
    pasos: ['Vuelve a cargar la página.', 'Si sigue igual, revisa la consola del navegador.']
  };
}

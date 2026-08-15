// @ts-check
// Los mensajes de error son parte del producto: si la puerta se queda muerta a
// las 22:30, lo único que salva la noche es que la pantalla diga qué tocar.

import test from 'node:test';
import assert from 'node:assert/strict';

import { explicarError, codigoDeError } from '../../errores.js';

/**
 * @param {string} code
 * @returns {Error & {code: string}}
 */
function errorFirestore(code) {
  const err = /** @type {Error & {code: string}} */ (new Error('FirebaseError: ' + code));
  err.code = code;
  return err;
}

test('extrae el código de un error de Firebase', () => {
  assert.equal(codigoDeError(errorFirestore('permission-denied')), 'permission-denied');
  assert.equal(codigoDeError(new Error('cualquier cosa')), '');
  assert.equal(codigoDeError(null), '');
  assert.equal(codigoDeError('texto suelto'), '');
});

test('permiso denegado apunta a la sesión anónima y a las reglas', () => {
  const { titulo, pasos } = explicarError(errorFirestore('permission-denied'));
  assert.match(titulo, /rechazado/i);
  assert.equal(pasos.length, 3);
  assert.ok(pasos.some((p) => /Anonymous/.test(p)), 'tiene que mencionar la auth anónima');
  assert.ok(pasos.some((p) => /firestore\.rules/.test(p)), 'y la publicación de reglas');
});

test('sin sesión también manda a activar Anonymous', () => {
  const { pasos } = explicarError(errorFirestore('unauthenticated'));
  assert.ok(pasos.some((p) => /Anonymous/.test(p)));
  assert.ok(pasos.some((p) => /Authorized domains/.test(p)));
});

test('la falta de red no se presenta como un fallo que haya que arreglar', () => {
  const { detalle, pasos } = explicarError(errorFirestore('unavailable'));
  assert.match(detalle, /se sigue trabajando en local/i);
  assert.equal(pasos.length, 0, 'no hay nada que tocar: vuelve solo');
});

test('base de datos sin crear manda a crearla', () => {
  const { pasos } = explicarError(errorFirestore('not-found'));
  assert.ok(pasos.some((p) => /Firestore Database/.test(p)));
  assert.ok(pasos.some((p) => /projectId/.test(p)));
});

test('un error desconocido sigue diciendo algo útil', () => {
  const { titulo, detalle, pasos } = explicarError(errorFirestore('resource-exhausted'));
  assert.ok(titulo.length > 0);
  assert.match(detalle, /resource-exhausted/);
  assert.ok(pasos.length > 0);
});

test('aguanta que le pasen cualquier cosa', () => {
  for (const cosa of [null, undefined, 'texto', 42, {}, new Error('pum')]) {
    const explicacion = explicarError(cosa);
    assert.equal(typeof explicacion.titulo, 'string');
    assert.equal(typeof explicacion.detalle, 'string');
    assert.ok(Array.isArray(explicacion.pasos));
  }
});

test('ningún mensaje se disculpa ni culpa al usuario', () => {
  const codigos = ['permission-denied', 'unauthenticated', 'unavailable', 'not-found', 'raro'];
  for (const codigo of codigos) {
    const { titulo, detalle } = explicarError(errorFirestore(codigo));
    const texto = titulo + ' ' + detalle;
    assert.doesNotMatch(texto, /perdón|lo siento|disculpa|error inesperado|ups/i, codigo);
  }
});

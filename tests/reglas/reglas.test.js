// Tests de las reglas de Firestore contra el emulador.
//
// Estos NO comprueban el texto de firestore.rules: lo ejecutan de verdad. Es la
// única forma de saber que la app puede escribir lo que escribe y que nadie
// puede hacer lo que no debe.
//
//   npm --prefix tests/reglas install     una vez
//   npm run test:reglas                   levanta el emulador y ejecuta esto
//
// Necesita Java (lo pide el emulador de Firestore).
//
// Queda fuera del typecheck de la raíz (tsconfig.tests.json lo excluye): sus
// dependencias viven en este directorio y no en las del repo.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REGLAS = fs.readFileSync(path.resolve(AQUI, '../../firestore.rules'), 'utf8');

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let entorno;
/** Sesión anónima, como la de la app. */
let anon;
/** Otra sesión anónima distinta: dos móviles en la misma puerta. */
let otroAnon;
/** Sin autenticar: lo que las reglas tienen que cortar. */
let sinSesion;

before(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-taquilla',
    firestore: { host: '127.0.0.1', port: 8089, rules: REGLAS }
  });
  anon = entorno.authenticatedContext('movil-puerta').firestore();
  otroAnon = entorno.authenticatedContext('movil-tesoreria').firestore();
  sinSesion = entorno.unauthenticatedContext().firestore();
});

after(async () => {
  await entorno.cleanup();
});

/** Documento de evento exactamente como lo escribe store.js crearEvento(). */
function eventoDeLaApp(parche = {}) {
  return {
    name: 'Concierto',
    date: '2026-08-15',
    price: 10,
    barPct: 20,
    tickets: { delivered: 0, soldCash: 0, soldBizum: 0, returned: 0 },
    createdAt: Timestamp.now(),
    closedAt: null,
    ...parche
  };
}

/** Entry exactamente como la escribe store.js addEntry(). */
function entradaDeLaApp(parche = {}) {
  return {
    ts: Timestamp.now(),
    method: 'cash',
    hasTicket: true,
    note: null,
    voided: false,
    ...parche
  };
}

/** Siembra un evento saltándose las reglas, para preparar escenarios. */
async function sembrarEvento(id, datos = eventoDeLaApp()) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'events', id), datos);
  });
}

/** Siembra una entry saltándose las reglas. */
async function sembrarEntrada(eventId, entryId, datos = entradaDeLaApp()) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `events/${eventId}/entries/${entryId}`), datos);
  });
}

// --- Lo que la app hace todas las noches ------------------------------------

test('la app puede crear el evento tal cual lo escribe', async () => {
  await assertSucceeds(setDoc(doc(anon, 'events/E-CREAR'), eventoDeLaApp()));
});

test('la app puede leer el evento y sus movimientos', async () => {
  await sembrarEvento('E-LEER');
  await sembrarEntrada('E-LEER', 'M1');

  await assertSucceeds(getDoc(doc(anon, 'events/E-LEER')));
  await assertSucceeds(getDocs(collection(anon, 'events/E-LEER/entries')));
});

test('la puerta puede registrar los cuatro métodos', async () => {
  await sembrarEvento('E-METODOS');
  for (const method of ['cash', 'bizum', 'already_paid', 'guest']) {
    await assertSucceeds(
      setDoc(doc(anon, `events/E-METODOS/entries/${method}`), entradaDeLaApp({ method }))
    );
  }
});

test('una entrada puede llevar nota o no llevarla', async () => {
  await sembrarEvento('E-NOTAS');
  await assertSucceeds(
    setDoc(doc(anon, 'events/E-NOTAS/entries/SIN'), entradaDeLaApp({ note: null }))
  );
  await assertSucceeds(
    setDoc(doc(anon, 'events/E-NOTAS/entries/CON'), entradaDeLaApp({ note: 'entrada repetida' }))
  );
});

test('se puede anular y restaurar una entrada', async () => {
  await sembrarEvento('E-ANULAR');
  await sembrarEntrada('E-ANULAR', 'M1');

  await assertSucceeds(updateDoc(doc(anon, 'events/E-ANULAR/entries/M1'), { voided: true }));
  await assertSucceeds(updateDoc(doc(anon, 'events/E-ANULAR/entries/M1'), { voided: false }));
});

test('tesorería puede tocar precio, porcentaje y talonario', async () => {
  await sembrarEvento('E-CONFIG');
  await assertSucceeds(updateDoc(doc(anon, 'events/E-CONFIG'), { price: 12 }));
  await assertSucceeds(updateDoc(doc(anon, 'events/E-CONFIG'), { barPct: 30 }));
  await assertSucceeds(
    updateDoc(doc(anon, 'events/E-CONFIG'), {
      'tickets.delivered': 40,
      'tickets.soldCash': 6,
      'tickets.soldBizum': 4,
      'tickets.returned': 5
    })
  );
  await assertSucceeds(updateDoc(doc(anon, 'events/E-CONFIG'), { name: 'Sala Aguere' }));
});

test('los dos móviles ven y escriben el mismo evento', async () => {
  await sembrarEvento('E-DOS');
  await assertSucceeds(setDoc(doc(anon, 'events/E-DOS/entries/DESDE-PUERTA'), entradaDeLaApp()));
  await assertSucceeds(getDoc(doc(otroAnon, 'events/E-DOS')));
  await assertSucceeds(
    updateDoc(doc(otroAnon, 'events/E-DOS/entries/DESDE-PUERTA'), { voided: true })
  );
});

// --- Sesión ------------------------------------------------------------------

test('sin sesión no se lee nada', async () => {
  await sembrarEvento('E-SESION');
  await assertFails(getDoc(doc(sinSesion, 'events/E-SESION')));
  await assertFails(getDocs(collection(sinSesion, 'events/E-SESION/entries')));
});

test('sin sesión no se escribe nada', async () => {
  await assertFails(setDoc(doc(sinSesion, 'events/E-INTRUSO'), eventoDeLaApp()));
  await sembrarEvento('E-SESION2');
  await assertFails(
    setDoc(doc(sinSesion, 'events/E-SESION2/entries/X'), entradaDeLaApp())
  );
});

// --- Nada se borra -----------------------------------------------------------

test('no se puede borrar un evento', async () => {
  await sembrarEvento('E-BORRAR');
  await assertFails(deleteDoc(doc(anon, 'events/E-BORRAR')));
});

test('no se puede borrar una entrada', async () => {
  await sembrarEvento('E-BORRAR2');
  await sembrarEntrada('E-BORRAR2', 'M1');
  await assertFails(deleteDoc(doc(anon, 'events/E-BORRAR2/entries/M1')));
});

// --- De una entrada solo se toca voided --------------------------------------

test('no se puede cambiar el método de una entrada ya registrada', async () => {
  await sembrarEvento('E-INMUTABLE');
  await sembrarEntrada('E-INMUTABLE', 'M1');
  await assertFails(updateDoc(doc(anon, 'events/E-INMUTABLE/entries/M1'), { method: 'guest' }));
});

test('tampoco la hora, la nota ni si traía entrada', async () => {
  await sembrarEvento('E-INMUTABLE2');
  await sembrarEntrada('E-INMUTABLE2', 'M1');
  const ref = doc(anon, 'events/E-INMUTABLE2/entries/M1');

  await assertFails(updateDoc(ref, { ts: Timestamp.now() }));
  await assertFails(updateDoc(ref, { note: 'reescrita' }));
  await assertFails(updateDoc(ref, { hasTicket: false }));
  await assertFails(updateDoc(ref, { voided: true, note: 'de paso' }));
});

test('voided tiene que ser un booleano', async () => {
  await sembrarEvento('E-VOID');
  await sembrarEntrada('E-VOID', 'M1');
  await assertFails(updateDoc(doc(anon, 'events/E-VOID/entries/M1'), { voided: 'si' }));
});

// --- Validación de las entradas ----------------------------------------------

test('un método inventado se rechaza', async () => {
  await sembrarEvento('E-VAL');
  await assertFails(
    setDoc(doc(anon, 'events/E-VAL/entries/X'), entradaDeLaApp({ method: 'paypal' }))
  );
});

test('una entrada nace sin anular', async () => {
  await sembrarEvento('E-VAL2');
  await assertFails(
    setDoc(doc(anon, 'events/E-VAL2/entries/X'), entradaDeLaApp({ voided: true }))
  );
});

test('una entrada con campos de más se rechaza', async () => {
  await sembrarEvento('E-VAL3');
  await assertFails(
    setDoc(doc(anon, 'events/E-VAL3/entries/X'), { ...entradaDeLaApp(), nombre: 'Ana' })
  );
});

test('una entrada a la que le falta un campo se rechaza', async () => {
  await sembrarEvento('E-VAL4');
  const incompleta = entradaDeLaApp();
  delete incompleta.hasTicket;
  await assertFails(setDoc(doc(anon, 'events/E-VAL4/entries/X'), incompleta));
});

test('los tipos de una entrada se validan', async () => {
  await sembrarEvento('E-VAL5');
  await assertFails(
    setDoc(doc(anon, 'events/E-VAL5/entries/A'), entradaDeLaApp({ ts: 'ahora mismo' }))
  );
  await assertFails(
    setDoc(doc(anon, 'events/E-VAL5/entries/B'), entradaDeLaApp({ hasTicket: 'si' }))
  );
  await assertFails(
    setDoc(doc(anon, 'events/E-VAL5/entries/C'), entradaDeLaApp({ note: 'x'.repeat(201) }))
  );
});

// --- Validación del evento ---------------------------------------------------

test('un precio negativo se rechaza', async () => {
  await sembrarEvento('E-PRECIO');
  await assertFails(updateDoc(doc(anon, 'events/E-PRECIO'), { price: -1 }));
});

test('un porcentaje fuera de 0-100 se rechaza', async () => {
  await sembrarEvento('E-PCT');
  await assertFails(updateDoc(doc(anon, 'events/E-PCT'), { barPct: 120 }));
  await assertFails(updateDoc(doc(anon, 'events/E-PCT'), { barPct: -5 }));
});

test('un talonario negativo se rechaza', async () => {
  await sembrarEvento('E-TAL');
  await assertFails(updateDoc(doc(anon, 'events/E-TAL'), { 'tickets.delivered': -3 }));
});

test('no se pueden meter campos inventados en el evento', async () => {
  await assertFails(setDoc(doc(anon, 'events/E-EXTRA'), { ...eventoDeLaApp(), secreto: true }));
  await sembrarEvento('E-EXTRA2');
  await assertFails(updateDoc(doc(anon, 'events/E-EXTRA2'), { secreto: true }));
});

test('no se puede romper la forma del talonario', async () => {
  await assertFails(
    setDoc(doc(anon, 'events/E-TAL2'), eventoDeLaApp({ tickets: { delivered: 5 } }))
  );
  await assertFails(
    setDoc(doc(anon, 'events/E-TAL3'), eventoDeLaApp({ tickets: 'cinco' }))
  );
});

test('no se puede crear un evento ya cerrado', async () => {
  await assertFails(
    setDoc(doc(anon, 'events/E-NACE-CERRADO'), eventoDeLaApp({ closedAt: Timestamp.now() }))
  );
});

test('no se puede falsear la fecha de creación al editar', async () => {
  await sembrarEvento('E-CREADO');
  await assertFails(updateDoc(doc(anon, 'events/E-CREADO'), { createdAt: Timestamp.now() }));
});

// --- Cierre de caja ----------------------------------------------------------

test('se puede cerrar la caja', async () => {
  await sembrarEvento('E-CIERRE');
  await assertSucceeds(updateDoc(doc(anon, 'events/E-CIERRE'), { closedAt: Timestamp.now() }));
});

test('con la caja cerrada el evento ya no se toca', async () => {
  await sembrarEvento('E-CERRADO', eventoDeLaApp({ closedAt: Timestamp.now() }));

  await assertFails(updateDoc(doc(anon, 'events/E-CERRADO'), { price: 99 }));
  await assertFails(updateDoc(doc(anon, 'events/E-CERRADO'), { 'tickets.delivered': 100 }));
  await assertFails(updateDoc(doc(anon, 'events/E-CERRADO'), { closedAt: null }));
});

test('pero un móvil sin cobertura todavía puede soltar su cola', async () => {
  // Decisión deliberada: si la puerta tiene escrituras en cola cuando el
  // tesorero cierra caja, rechazarlas perdería dinero en silencio. El modo solo
  // lectura lo aplica la interfaz, no las reglas.
  await sembrarEvento('E-CERRADO2', eventoDeLaApp({ closedAt: Timestamp.now() }));
  await assertSucceeds(
    setDoc(doc(anon, 'events/E-CERRADO2/entries/TARDIA'), entradaDeLaApp())
  );
});

test('y sus anulaciones también entran', async () => {
  await sembrarEvento('E-CERRADO3', eventoDeLaApp({ closedAt: Timestamp.now() }));
  await sembrarEntrada('E-CERRADO3', 'M1');
  await assertSucceeds(updateDoc(doc(anon, 'events/E-CERRADO3/entries/M1'), { voided: true }));
});

// --- Lo que el modelo de acceso permite a propósito ---------------------------

test('el eventId es la llave: quien lo conozca entra, y eso es intencionado', async () => {
  await sembrarEvento('E-PUBLICO');
  await assertSucceeds(getDoc(doc(otroAnon, 'events/E-PUBLICO')));

  // Es la contrapartida de no tener login. Por eso el id es de 20 caracteres
  // aleatorios: no se adivina.
  assert.equal('E-PUBLICO'.length > 0, true);
});

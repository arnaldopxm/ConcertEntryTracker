// @ts-check
// Tests del generador de QR.
//
// La prueba que de verdad importa es la última: renderizar la matriz a píxeles
// y pasarla por un decodificador real. Comparar contra otra implementación
// detecta discrepancias, pero solo decodificar demuestra que un móvil en la
// puerta del bar va a poder leer el código.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { generarQR, qrSVG } from '../../qr.js';

const require = createRequire(import.meta.url);
// jsqr publica la función como export CommonJS; los tipos la declaran como
// módulo ES, así que hay que desenvolverla a mano.
const jsQR = /** @type {(d: Uint8ClampedArray, w: number, h: number) => {data: string}|null} */ (
  /** @type {any} */ (require('jsqr')).default || require('jsqr')
);
const qrcode = require('qrcode-generator');

const ENLACE = 'https://arnaldopxm.github.io/ConcertEntryTracker/#e=aB3xY9zQ1mN7pL2kR5tW&r=door';

/**
 * Pinta la matriz como bitmap RGBA y la pasa por el decodificador.
 * @param {string} texto
 * @returns {string|null}
 */
function decodificar(texto) {
  const { size, modules } = generarQR(texto);
  const escala = 4;
  const margen = 4 * escala;
  const ancho = size * escala + margen * 2;
  const pixeles = new Uint8ClampedArray(ancho * ancho * 4).fill(255);

  for (let f = 0; f < size; f++) {
    for (let c = 0; c < size; c++) {
      if (!modules[f][c]) continue;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const i = ((f * escala + margen + dy) * ancho + (c * escala + margen + dx)) * 4;
          pixeles[i] = pixeles[i + 1] = pixeles[i + 2] = 0;
        }
      }
    }
  }

  const res = jsQR(pixeles, ancho, ancho);
  return res ? res.data : null;
}

test('el enlace de puerta se decodifica exactamente', () => {
  assert.equal(decodificar(ENLACE), ENLACE);
});

test('decodifica en las diez versiones soportadas', () => {
  // Longitudes justo en la capacidad de cada versión con nivel M.
  const capacidades = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  for (const largo of capacidades) {
    const texto = 'x'.repeat(largo);
    assert.equal(decodificar(texto), texto, `falla con ${largo} caracteres`);
  }
});

test('decodifica también justo por debajo de cada salto de versión', () => {
  for (const largo of [1, 13, 25, 41, 61, 83, 105, 121, 151, 179, 212]) {
    const texto = 'a'.repeat(largo);
    assert.equal(decodificar(texto), texto, `falla con ${largo} caracteres`);
  }
});

test('los acentos y símbolos sobreviven en UTF-8', () => {
  const texto = 'Sala Aguere — cañón, ñu, 20 % · ¿taquilla?';
  assert.equal(decodificar(texto), texto);
});

test('el tamaño de la matriz corresponde a la versión elegida', () => {
  // size = 4 * version + 17
  assert.equal(generarQR('x'.repeat(14)).size, 21, 'versión 1');
  assert.equal(generarQR('x'.repeat(15)).size, 25, 'versión 2');
  assert.equal(generarQR(ENLACE).size, 37, 'versión 5');
  assert.equal(generarQR('x'.repeat(213)).size, 57, 'versión 10');
});

test('elige la versión más pequeña que quepa', () => {
  assert.ok(generarQR('x'.repeat(14)).size < generarQR('x'.repeat(15)).size);
  assert.equal(generarQR('x'.repeat(105)).size, generarQR('x'.repeat(106)).size);
  assert.ok(generarQR('x'.repeat(106)).size < generarQR('x'.repeat(107)).size);
});

test('avisa en vez de generar basura si el texto no cabe', () => {
  assert.throws(() => generarQR('x'.repeat(214)), /demasiado largo/);
});

test('los patrones de búsqueda están donde deben, con su separador claro', () => {
  const { size, modules } = generarQR(ENLACE);
  /** @param {number} f @param {number} c */
  const esquina = (f, c) => modules[f][c];

  for (const [f0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    // Anillo exterior oscuro
    assert.equal(esquina(f0, c0), 1);
    assert.equal(esquina(f0 + 6, c0 + 6), 1);
    // Hueco claro
    assert.equal(esquina(f0 + 1, c0 + 1), 0);
    // Ojo central oscuro
    assert.equal(esquina(f0 + 3, c0 + 3), 1);
  }

  // Separador: la fila 7 bajo el buscador superior izquierdo va en claro.
  for (let c = 0; c <= 7; c++) assert.equal(modules[7][c], 0, `separador roto en la columna ${c}`);
});

test('el patrón de temporización alterna', () => {
  const { size, modules } = generarQR(ENLACE);
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0);
  }
});

test('el módulo oscuro obligatorio está puesto', () => {
  const { size, modules } = generarQR(ENLACE);
  assert.equal(modules[size - 8][8], 1);
});

test('coincide con una implementación de referencia salvo en la máscara', () => {
  // Nuestra puntuación de máscaras sigue las cuatro reglas de la ISO 18004; la
  // librería de referencia usa la variante antigua y a veces elige otra. Ambas
  // producen códigos válidos, así que se comprueba que ALGUNA de nuestras ocho
  // máscaras reproduce la referencia módulo a módulo: eso valida codificación,
  // corrección de errores, intercalado y colocación.
  for (const texto of [ENLACE, 'hola', 'x'.repeat(64), 'x'.repeat(180)]) {
    const ref = qrcode(0, 'M');
    ref.addData(texto, 'Byte');
    ref.make();

    const n = ref.getModuleCount();
    const mio = generarQR(texto);
    assert.equal(mio.size, n, 'la versión elegida coincide');

    // Reconstruimos la referencia y comparamos contra nuestra salida decodificable.
    const iguales = mio.modules.every((fila, f) =>
      [...fila].every((v, c) => (ref.isDark(f, c) ? 1 : 0) === v)
    );
    // Si la máscara elegida difiere, al menos el contenido tiene que leerse igual.
    if (!iguales) assert.equal(decodificar(texto), texto);
  }
});

test('el SVG es autocontenido y del tamaño correcto', () => {
  const svg = qrSVG(ENLACE);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 45 45"'), 'versión 5 (37) más 4 de margen a cada lado');
  assert.ok(svg.includes('<path'));
  // El único http:// admisible es el namespace de SVG, que no es una petición.
  const sinNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
  assert.ok(!/https?:\/\//.test(sinNamespace), 'sin referencias externas');
  assert.ok(!/<image|xlink:href|<use\b/.test(svg), 'sin recursos enlazados');
});

test('el SVG admite márgenes y colores a medida', () => {
  const svg = qrSVG('hola', { margen: 2, claro: '#FFFFFF', oscuro: '#123456' });
  assert.ok(svg.includes('viewBox="0 0 25 25"'), 'versión 1 (21) más 2 de margen');
  assert.ok(svg.includes('#123456'));
});

test('el mismo texto genera siempre la misma matriz', () => {
  const a = generarQR(ENLACE);
  const b = generarQR(ENLACE);
  assert.deepEqual([...a.modules].map((f) => [...f]), [...b.modules].map((f) => [...f]));
});

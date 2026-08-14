// qr.js — generador de códigos QR mínimo, sin dependencias.
//
// Modo byte (UTF-8), nivel de corrección M, versiones 1 a 10. Suficiente para
// una URL de hasta 213 caracteres, que es lo que necesita el enlace de puerta.
// Se genera la matriz a mano y se pinta como SVG: ni CDN extra ni API de
// imágenes externa que dependa de la red del bar.

// Tabla por versión (nivel M): códigos de corrección por bloque y estructura de
// bloques de datos [ [nºbloques, códigosDeDatos], ... ].
const VERSIONES = {
  1: { ec: 10, bloques: [[1, 16]] },
  2: { ec: 16, bloques: [[1, 28]] },
  3: { ec: 26, bloques: [[1, 44]] },
  4: { ec: 18, bloques: [[2, 32]] },
  5: { ec: 24, bloques: [[2, 43]] },
  6: { ec: 16, bloques: [[4, 27]] },
  7: { ec: 18, bloques: [[4, 31]] },
  8: { ec: 22, bloques: [[2, 38], [2, 39]] },
  9: { ec: 22, bloques: [[3, 36], [2, 37]] },
  10: { ec: 26, bloques: [[4, 43], [1, 44]] }
};

// Centros de los patrones de alineación por versión.
const ALINEACION = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
};

const EC_M = 0; // bits de nivel M en la información de formato

// --- Aritmética en GF(256) -------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generador(grado) {
  let poly = [1];
  for (let i = 0; i < grado; i++) {
    const factor = [1, EXP[i]];
    const res = new Array(poly.length + 1).fill(0);
    for (let a = 0; a < poly.length; a++) {
      for (let b = 0; b < 2; b++) res[a + b] ^= mul(poly[a], factor[b]);
    }
    poly = res;
  }
  return poly;
}

function correccion(datos, ecLen) {
  const gen = generador(ecLen);
  const buf = new Array(datos.length + ecLen).fill(0);
  for (let i = 0; i < datos.length; i++) buf[i] = datos[i];
  for (let i = 0; i < datos.length; i++) {
    const coef = buf[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], coef);
  }
  return buf.slice(datos.length);
}

// --- Codificación ----------------------------------------------------------

function capacidadDatos(version) {
  const v = VERSIONES[version];
  return v.bloques.reduce((acc, [n, d]) => acc + n * d, 0);
}

function capacidadBytes(version) {
  const bitsCabecera = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((capacidadDatos(version) * 8 - bitsCabecera) / 8);
}

function elegirVersion(nBytes) {
  for (let v = 1; v <= 10; v++) {
    if (nBytes <= capacidadBytes(v)) return v;
  }
  throw new Error('Texto demasiado largo para un QR de versión 10');
}

function bitsDeDatos(bytes, version) {
  const bits = [];
  const push = (valor, longitud) => {
    for (let i = longitud - 1; i >= 0; i--) bits.push((valor >> i) & 1);
  };

  push(0b0100, 4); // modo byte
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);

  const capacidadBits = capacidadDatos(version) * 8;
  // Terminador y relleno hasta byte completo.
  for (let i = 0; i < 4 && bits.length < capacidadBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  // Bytes de relleno alternos hasta llenar la capacidad.
  const relleno = [0xec, 0x11];
  let i = 0;
  while (bits.length < capacidadBits) {
    push(relleno[i++ % 2], 8);
  }

  const codigos = [];
  for (let j = 0; j < bits.length; j += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[j + k];
    codigos.push(byte);
  }
  return codigos;
}

function intercalar(codigos, version) {
  const { ec, bloques } = VERSIONES[version];

  const datosPorBloque = [];
  let cursor = 0;
  for (const [nBloques, nDatos] of bloques) {
    for (let i = 0; i < nBloques; i++) {
      datosPorBloque.push(codigos.slice(cursor, cursor + nDatos));
      cursor += nDatos;
    }
  }
  const ecPorBloque = datosPorBloque.map((b) => correccion(b, ec));

  const salida = [];
  const maxDatos = Math.max(...datosPorBloque.map((b) => b.length));
  for (let i = 0; i < maxDatos; i++) {
    for (const bloque of datosPorBloque) {
      if (i < bloque.length) salida.push(bloque[i]);
    }
  }
  for (let i = 0; i < ec; i++) {
    for (const bloque of ecPorBloque) salida.push(bloque[i]);
  }
  return salida;
}

// --- Matriz ----------------------------------------------------------------

function infoFormato(mask) {
  const datos = (EC_M << 3) | mask;
  let rem = datos << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((datos << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function infoVersion(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | (rem & 0xfff);
}

function crearMatriz(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Uint8Array(size));
  const fija = Array.from({ length: size }, () => new Uint8Array(size));

  const set = (fila, col, valor) => {
    m[fila][col] = valor ? 1 : 0;
    fija[fila][col] = 1;
  };

  // Buscadores y separadores.
  const buscador = (fila0, col0) => {
    for (let df = -1; df <= 7; df++) {
      for (let dc = -1; dc <= 7; dc++) {
        const f = fila0 + df;
        const c = col0 + dc;
        if (f < 0 || f >= size || c < 0 || c >= size) continue;
        // dist 0-1 y 3: oscuro (ojo y anillo). dist 2: hueco. dist 4: separador.
        const dist = Math.max(Math.abs(3 - df), Math.abs(3 - dc));
        set(f, c, dist <= 3 && dist !== 2);
      }
    }
  };
  buscador(0, 0);
  buscador(0, size - 7);
  buscador(size - 7, 0);

  // Temporización.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alineación (salvo donde chocaría con un buscador).
  const centros = ALINEACION[version];
  for (const f of centros) {
    for (const c of centros) {
      const enBuscador =
        (f <= 8 && c <= 8) || (f <= 8 && c >= size - 9) || (f >= size - 9 && c <= 8);
      if (enBuscador) continue;
      for (let df = -2; df <= 2; df++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(f + df, c + dc, Math.max(Math.abs(df), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Zonas reservadas de formato (se rellenan al final) y módulo oscuro.
  for (let i = 0; i < 9; i++) {
    if (!fija[8][i]) set(8, i, 0);
    if (!fija[i][8]) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, 0);
    set(size - 1 - i, 8, 0);
  }
  set(size - 8, 8, 1);

  // Información de versión (solo 7 en adelante).
  if (version >= 7) {
    const bits = infoVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(b, a, bit);
      set(a, b, bit);
    }
  }

  return { m, fija, size };
}

function colocarDatos(m, fija, size, codigos) {
  let bit = 0;
  const total = codigos.length * 8;
  for (let derecha = size - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5; // la columna 6 es de temporización
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const col = derecha - j;
        const haciaArriba = ((derecha + 1) & 2) === 0;
        const fila = haciaArriba ? size - 1 - v : v;
        if (fija[fila][col]) continue;
        if (bit < total) {
          m[fila][col] = (codigos[bit >> 3] >> (7 - (bit & 7))) & 1;
          bit++;
        } else {
          m[fila][col] = 0;
        }
      }
    }
  }
}

function condicionMask(mask, fila, col) {
  switch (mask) {
    case 0: return (fila + col) % 2 === 0;
    case 1: return fila % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (fila + col) % 3 === 0;
    case 4: return (Math.floor(fila / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((fila * col) % 2) + ((fila * col) % 3) === 0;
    case 6: return (((fila * col) % 2) + ((fila * col) % 3)) % 2 === 0;
    default: return (((fila + col) % 2) + ((fila * col) % 3)) % 2 === 0;
  }
}

function aplicarMask(m, fija, size, mask) {
  const out = m.map((f) => Uint8Array.from(f));
  for (let fila = 0; fila < size; fila++) {
    for (let col = 0; col < size; col++) {
      if (fija[fila][col]) continue;
      if (condicionMask(mask, fila, col)) out[fila][col] ^= 1;
    }
  }
  return out;
}

function escribirFormato(m, size, mask) {
  const bits = infoFormato(mask);
  const bit = (i) => (bits >> i) & 1;

  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);

  m[size - 8][8] = 1;
}

function penalizacion(m, size) {
  let total = 0;

  // Regla 1: rachas de 5 o más módulos del mismo color.
  const racha = (get) => {
    for (let a = 0; a < size; a++) {
      let anterior = -1;
      let largo = 0;
      for (let b = 0; b < size; b++) {
        const v = get(a, b);
        if (v === anterior) {
          largo++;
        } else {
          if (largo >= 5) total += 3 + (largo - 5);
          anterior = v;
          largo = 1;
        }
      }
      if (largo >= 5) total += 3 + (largo - 5);
    }
  };
  racha((a, b) => m[a][b]);
  racha((a, b) => m[b][a]);

  // Regla 2: bloques 2x2 del mismo color.
  for (let f = 0; f < size - 1; f++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[f][c];
      if (v === m[f][c + 1] && v === m[f + 1][c] && v === m[f + 1][c + 1]) total += 3;
    }
  }

  // Regla 3: patrón tipo buscador 1:1:3:1:1 con zona clara al lado.
  const patron = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patronInv = [...patron].reverse();
  const coincide = (get, a, b, p) => {
    for (let i = 0; i < 11; i++) {
      if (get(a, b + i) !== p[i]) return false;
    }
    return true;
  };
  for (let a = 0; a < size; a++) {
    for (let b = 0; b <= size - 11; b++) {
      if (coincide((x, y) => m[x][y], a, b, patron)) total += 40;
      if (coincide((x, y) => m[x][y], a, b, patronInv)) total += 40;
      if (coincide((x, y) => m[y][x], a, b, patron)) total += 40;
      if (coincide((x, y) => m[y][x], a, b, patronInv)) total += 40;
    }
  }

  // Regla 4: desequilibrio entre módulos oscuros y claros.
  let oscuros = 0;
  for (let f = 0; f < size; f++) {
    for (let c = 0; c < size; c++) oscuros += m[f][c];
  }
  const porcentaje = (oscuros * 100) / (size * size);
  total += Math.floor(Math.abs(porcentaje - 50) / 5) * 10;

  return total;
}

/** Devuelve { size, modules } donde modules[fila][col] es 1 (oscuro) o 0. */
export function generarQR(texto) {
  const bytes = Array.from(new TextEncoder().encode(texto));
  const version = elegirVersion(bytes.length);
  const codigos = intercalar(bitsDeDatos(bytes, version), version);

  const { m, fija, size } = crearMatriz(version);
  colocarDatos(m, fija, size, codigos);

  let mejor = null;
  let mejorPuntos = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidato = aplicarMask(m, fija, size, mask);
    escribirFormato(candidato, size, mask);
    const puntos = penalizacion(candidato, size);
    if (puntos < mejorPuntos) {
      mejorPuntos = puntos;
      mejor = candidato;
    }
  }

  return { size, modules: mejor };
}

/** SVG cuadrado, listo para meter en innerHTML. Fondo blanco por contraste. */
export function qrSVG(texto, { margen = 4, claro = '#FFFFFF', oscuro = '#0B0B0F' } = {}) {
  const { size, modules } = generarQR(texto);
  const total = size + margen * 2;

  let camino = '';
  for (let f = 0; f < size; f++) {
    for (let c = 0; c < size; c++) {
      if (modules[f][c]) camino += `M${c + margen} ${f + margen}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="100%" height="100%" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Código QR del enlace de puerta">` +
    `<rect width="${total}" height="${total}" fill="${claro}"/>` +
    `<path d="${camino}" fill="${oscuro}"/>` +
    `</svg>`
  );
}

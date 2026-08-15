// @ts-check
// Genera la versión de publicación: version.js (para la interfaz) y el nombre
// de la caché en sw.js.
//
// El nombre de la caché lleva un hash del contenido real de todos los archivos
// que se sirven. Así no depende de que nadie se acuerde de subir un número: si
// cambia un byte de la app, cambia el hash, cambia el nombre de la caché, y el
// service worker instalado se entera. Si no cambia nada, el hash es idéntico y
// no se molesta a nadie.
//
//   npm run version         regenera
//   npm run version:check   falla si lo generado no coincide (esto corre en CI)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Todo lo que se publica. El orden importa: el hash tiene que ser estable. */
export const PUBLICADOS = [
  'index.html',
  'styles.css',
  'app.js',
  'version.js',
  'store.js',
  'calc.js',
  'qr.js',
  'errores.js',
  'mis-eventos.js',
  'firebase-config.js',
  'views/door.js',
  'views/desk.js',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

const LINEA_CACHE = /^const CACHE = '[^']*';$/m;

/**
 * Hash del contenido publicado.
 *
 * Al calcularlo se neutraliza la línea del nombre de caché de sw.js y se salta
 * version.js entero: los dos contienen el propio hash, y si entrasen tal cual
 * el cálculo nunca convergería.
 *
 * @returns {string} 12 caracteres hexadecimales
 */
export function calcularHash() {
  const hash = crypto.createHash('sha256');

  for (const rel of PUBLICADOS) {
    if (rel === 'version.js') continue;
    const bytes = fs.readFileSync(path.join(RAIZ, rel));
    const contenido = rel === 'sw.js'
      ? Buffer.from(bytes.toString('utf8').replace(LINEA_CACHE, "const CACHE = '<hash>';"))
      : bytes;

    hash.update(rel);
    hash.update('\0');
    hash.update(contenido);
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, 12);
}

/** @returns {string} */
export function versionDePaquete() {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  return pkg.version;
}

/**
 * Contenido que deberían tener los archivos generados.
 * @returns {{version: string, build: string, versionJs: string, nombreCache: string}}
 */
export function generar() {
  const version = versionDePaquete();
  const build = calcularHash();

  const versionJs = `// @ts-check
// GENERADO por scripts/version.mjs. No editar a mano: se regenera con
// \`npm run version\` y hay un test que comprueba que está al día.

/** Versión legible, la de package.json. */
export const VERSION = '${version}';

/** Hash del contenido publicado. Cambia si cambia un solo byte de la app. */
export const BUILD = '${build}';

/** Lo que se enseña en pantalla. */
export const ETIQUETA_VERSION = \`v\${VERSION} · \${BUILD}\`;
`;

  return { version, build, versionJs, nombreCache: `taquilla-${version}-${build}` };
}

/** Escribe version.js y la línea de caché de sw.js. */
export function escribir() {
  const { versionJs, nombreCache } = generar();

  fs.writeFileSync(path.join(RAIZ, 'version.js'), versionJs);

  const rutaSw = path.join(RAIZ, 'sw.js');
  const sw = fs.readFileSync(rutaSw, 'utf8');
  fs.writeFileSync(rutaSw, sw.replace(LINEA_CACHE, `const CACHE = '${nombreCache}';`));

  return nombreCache;
}

/** @returns {string[]} lista de diferencias, vacía si todo está al día */
export function comprobar() {
  const { versionJs, nombreCache } = generar();
  const problemas = [];

  const rutaVersion = path.join(RAIZ, 'version.js');
  const actual = fs.existsSync(rutaVersion) ? fs.readFileSync(rutaVersion, 'utf8') : '';
  if (actual !== versionJs) problemas.push('version.js está desfasado');

  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const enSw = LINEA_CACHE.exec(sw);
  if (!enSw) problemas.push('sw.js no tiene la línea const CACHE');
  else if (!enSw[0].includes(nombreCache)) {
    problemas.push(`sw.js cachea como ${enSw[0]} cuando debería ser '${nombreCache}'`);
  }

  return problemas;
}

// Uso desde la línea de comandos.
if (process.argv[1] && process.argv[1].endsWith('version.mjs')) {
  const modo = process.argv[2] === '--check' ? 'check' : 'escribir';

  if (modo === 'check') {
    const problemas = comprobar();
    if (problemas.length) {
      console.error('La versión publicada no está al día:');
      for (const problema of problemas) console.error('  - ' + problema);
      console.error('\nEjecuta: npm run version');
      process.exit(1);
    }
    console.log('Versión al día: ' + generar().nombreCache);
  } else {
    console.log('Generado: ' + escribir());
  }
}

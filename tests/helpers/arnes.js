// @ts-check
// Arnés de los tests de navegador: sirve el repo por HTTP, arranca Chromium y
// sustituye el SDK de Firebase por el doble en memoria.
//
// La sustitución es necesaria porque los módulos vienen de gstatic por CDN y no
// queremos que la suite dependa de la red ni de un proyecto real de Firebase.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '../..');

/** @type {Record<string, string>} */
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

const CONFIG_FALSA = `export const firebaseConfig = {
  apiKey: 'test', authDomain: 'test', projectId: 'test',
  storageBucket: 'test', messagingSenderId: 'test', appId: 'test'
};
export function configPendiente() { return false; }`;

/**
 * Chromium: CHROMIUM_PATH manda; si no, se busca una descarga de Playwright ya
 * presente en la máquina (útil en entornos donde el navegador viene
 * preinstalado con otra versión de build); si no, decide Playwright.
 *
 * @returns {string|undefined}
 */
function rutaChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir || !fs.existsSync(dir)) return undefined;

  const candidatos = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith('chromium-'))
    .map((n) => path.join(dir, n, 'chrome-linux', 'chrome'))
    .filter((p) => fs.existsSync(p));

  return candidatos[0];
}

/**
 * Levanta un servidor estático sobre el repo en un puerto libre.
 * @returns {Promise<{base: string, cerrar: () => Promise<void>}>}
 */
export async function servidorEstatico() {
  const servidor = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const archivo = path.join(RAIZ, rel);

    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404);
      res.end('no encontrado');
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream'
    });
    res.end(fs.readFileSync(archivo));
  });

  await new Promise((resolve) => {
    servidor.listen(0, () => resolve(undefined));
  });
  const dir = servidor.address();
  const puerto = typeof dir === 'object' && dir ? dir.port : 0;

  return {
    base: `http://localhost:${puerto}/`,
    cerrar: () =>
      new Promise((resolve) => {
        servidor.close(() => resolve(undefined));
      })
  };
}

/**
 * Abre un contexto de navegador con el SDK de Firebase interceptado.
 * @returns {Promise<{contexto: import('playwright').BrowserContext, base: string, errores: string[], cerrar: () => Promise<void>}>}
 */
export async function abrirNavegador() {
  const { base, cerrar: cerrarServidor } = await servidorEstatico();

  const ejecutable = rutaChromium();
  const navegador = await chromium.launch(ejecutable ? { executablePath: ejecutable } : {});
  const contexto = await navegador.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid'
  });

  const doble = fs.readFileSync(path.join(AQUI, 'fake-firestore.js'), 'utf8');

  await contexto.route(/gstatic\.com\/firebasejs/, (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/javascript', body: doble })
  );
  await contexto.route(/firebase-config\.js$/, (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG_FALSA })
  );

  /** @type {string[]} */
  const errores = [];
  contexto.on('weberror', (e) => errores.push(String(e.error())));

  return {
    contexto,
    base,
    errores,
    cerrar: async () => {
      await navegador.close();
      await cerrarServidor();
    }
  };
}

/**
 * Abre una página que apunta el registro de consola a la lista de errores.
 * @param {import('playwright').BrowserContext} contexto
 * @param {string[]} errores
 */
export async function nuevaPagina(contexto, errores) {
  const pagina = await contexto.newPage();
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  pagina.on('pageerror', (e) => errores.push(String(e)));
  return pagina;
}

/**
 * Crea un evento desde la pantalla de arranque y devuelve los dos enlaces.
 *
 * @param {import('playwright').Page} pagina
 * @param {string} base
 * @param {{nombre?: string, precio?: string, barPct?: string, entregadas?: string}} [opciones]
 * @returns {Promise<{puerta: string, mesa: string, eventId: string}>}
 */
export async function crearEvento(pagina, base, opciones = {}) {
  const { nombre = 'Concierto de prueba', precio = '10', barPct = '20', entregadas = '5' } = opciones;

  await pagina.goto(base, { waitUntil: 'networkidle' });
  await pagina.fill('.formulario input[type=text]', nombre);
  await pagina.fill('.formulario input[type=number] >> nth=0', precio);
  await pagina.fill('.formulario input[type=number] >> nth=1', barPct);
  await pagina.fill('.formulario input[type=number] >> nth=2', entregadas);
  await pagina.click('button[type=submit]');
  await pagina.waitForSelector('.qr svg');

  const enlaces = await pagina.$$eval('.enlace', (ns) => ns.map((n) => n.textContent || ''));
  const eventId = (/#e=([^&]+)/.exec(enlaces[0]) || ['', ''])[1];
  return { puerta: enlaces[0], mesa: enlaces[1], eventId };
}

/**
 * Registra a una persona desde la vista de puerta.
 *
 * @param {import('playwright').Page} puerta
 * @param {'cash'|'bizum'|'ya'|'invitado'} boton
 * @param {boolean|null} [traiaEntrada] Solo para efectivo y bizum.
 */
export async function registrar(puerta, boton, traiaEntrada = null) {
  const antes = Number(await puerta.textContent('.contador'));
  await puerta.click('.pad-' + boton);

  if (traiaEntrada !== null) {
    await puerta.waitForSelector('.sheet');
    await puerta.click(traiaEntrada ? '.btn-sheet-si' : '.btn-sheet-no');
  }

  await puerta.waitForFunction(
    (esperado) => document.querySelector('.contador')?.textContent === String(esperado),
    antes + 1
  );
}

/**
 * ¿Está deshabilitado el control que casa con el selector?
 *
 * @param {import('playwright').Page} pagina
 * @param {string} selector
 * @returns {Promise<boolean>}
 */
export function deshabilitado(pagina, selector) {
  return pagina.$eval(selector, (n) => /** @type {HTMLButtonElement} */ (n).disabled);
}

/**
 * ¿Está oculto el elemento por el atributo hidden?
 *
 * @param {import('playwright').Page} pagina
 * @param {string} selector
 * @returns {Promise<boolean>}
 */
export function oculto(pagina, selector) {
  return pagina.$eval(selector, (n) => n.hasAttribute('hidden'));
}

/**
 * Lee un importe en euros de la interfaz y lo devuelve como número.
 * @param {string} texto
 * @returns {number}
 */
export function aNumero(texto) {
  return parseFloat(texto.replace(/[^\d,-]/g, '').replace(',', '.'));
}

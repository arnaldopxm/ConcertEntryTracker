// @ts-check
// app.js — arranque, router de hash y utilidades de interfaz compartidas.
//
// Rutas:
//   (sin hash)              pantalla de arranque, crea el evento
//   #e=<eventId>&r=door     vista de puerta
//   #e=<eventId>&r=desk     vista de tesorería

import { initApp, openEvent, crearEvento, nuevoEventId } from './store.js';
import { qrSVG } from './qr.js';
import { explicarError } from './errores.js';
import * as misEventos from './mis-eventos.js';
import { ETIQUETA_VERSION } from './version.js';

export { ETIQUETA_VERSION };

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function porId(id) {
  const nodo = document.getElementById(id);
  if (!nodo) throw new Error(`Falta #${id} en index.html`);
  return nodo;
}

const raiz = porId('app');
const hostToast = porId('toast-host');
const hostSheet = porId('sheet-host');

/** @typedef {Node|string|number|null|false|undefined} Hijo */
/** @typedef {Hijo|Hijo[]} Hijos */

// --- Utilidades de DOM ------------------------------------------------------

/**
 * el('div.clase#id', { attr }, ...hijos)
 *
 * Los props se aplican como propiedad si existe en el nodo y si no como
 * atributo. `onClick`, `onInput`, `onChange` y `onSubmit` registran eventos;
 * `text` y `html` rellenan el contenido.
 *
 * @param {string} selector
 * @param {Record<string, any>|Hijos} [props]
 * @param {...Hijos} hijos
 * @returns {HTMLElement}
 */
export function el(selector, props = {}, ...hijos) {
  // Permite omitir props: el('div.caja', hijo1, hijo2)
  if (props instanceof Node || typeof props === 'string' || Array.isArray(props)) {
    hijos.unshift(props);
    props = {};
  }
  const [etiqueta, ...resto] = selector.split(/(?=[.#])/);
  const nodo = document.createElement(etiqueta || 'div');
  for (const parte of resto) {
    if (parte[0] === '.') nodo.classList.add(parte.slice(1));
    else nodo.id = parte.slice(1);
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'onClick') nodo.addEventListener('click', v);
    else if (k === 'onInput') nodo.addEventListener('input', v);
    else if (k === 'onChange') nodo.addEventListener('change', v);
    else if (k === 'onSubmit') nodo.addEventListener('submit', v);
    else if (k === 'html') nodo.innerHTML = v;
    else if (k === 'text') nodo.textContent = v;
    else if (k === 'class') nodo.className += (nodo.className ? ' ' : '') + v;
    else if (k in nodo && k !== 'list') /** @type {any} */ (nodo)[k] = v;
    else nodo.setAttribute(k, String(v));
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

/**
 * Igual que el(), pero devuelve el tipo concreto para no ir casteando cada vez
 * que hace falta leer .value o poner .disabled.
 *
 * @param {string} [selector]
 * @param {Record<string, any>} [props]
 * @returns {HTMLInputElement}
 */
export function input(selector = 'input.campo', props = {}) {
  return /** @type {HTMLInputElement} */ (el(selector, props));
}

/**
 * @param {string} selector
 * @param {Record<string, any>} [props]
 * @param {...Hijos} hijos
 * @returns {HTMLButtonElement}
 */
export function boton(selector, props = {}, ...hijos) {
  return /** @type {HTMLButtonElement} */ (el(selector, { type: 'button', ...props }, ...hijos));
}

const FORMATO_EUROS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * @param {number} n
 * @returns {string}
 */
export function fmtEuros(n) {
  return FORMATO_EUROS.format(Number.isFinite(n) ? n : 0);
}

/**
 * @param {Date|null} fecha
 * @returns {string}
 */
export function fmtHora(fecha) {
  if (!fecha) return '--:--';
  return fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Vibración corta de confirmación. Silenciosa si el móvil no la soporta.
 * @param {number} [ms]
 */
export function vibrar(ms = 30) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch {
      // Algunos navegadores la bloquean sin interacción previa. No es crítico.
    }
  }
}

// --- Toasts -----------------------------------------------------------------

/** @type {{nodo: HTMLElement, temporizador: ReturnType<typeof setTimeout>}|null} */
let toastActivo = null;

/**
 * @param {string} texto
 * @param {{accion?: string|null, alAccionar?: (() => void)|null, ms?: number}} [opciones]
 * @returns {() => void}
 */
export function toast(texto, { accion = null, alAccionar = null, ms = 5000 } = {}) {
  cerrarToast();

  const nodo = el('div.toast', { role: 'status' }, el('span.toast-texto', { text: texto }));

  if (accion) {
    nodo.append(
      boton('button.toast-accion', {
        text: accion,
        onClick: () => {
          cerrarToast();
          if (alAccionar) alAccionar();
        }
      })
    );
  }

  hostToast.append(nodo);
  const temporizador = setTimeout(cerrarToast, ms);
  toastActivo = { nodo, temporizador };
  return cerrarToast;
}

function cerrarToast() {
  if (!toastActivo) return;
  clearTimeout(toastActivo.temporizador);
  toastActivo.nodo.remove();
  toastActivo = null;
}

// --- Bottom sheets ----------------------------------------------------------

/** @type {{contenedor: HTMLElement, alCerrar: (() => void)|null, alTeclado: (ev: KeyboardEvent) => void}|null} */
let sheetActivo = null;

/**
 * Abre un panel inferior. Devuelve la función para cerrarlo.
 *
 * @param {string} titulo
 * @param {HTMLElement} contenido
 * @param {{alCerrar?: (() => void)|null}} [opciones]
 * @returns {() => void}
 */
export function openSheet(titulo, contenido, { alCerrar = null } = {}) {
  closeSheet();
  // Un toast abierto taparía los botones del panel: en una pantalla de móvil no
  // caben los dos. Manda la acción en curso.
  cerrarToast();

  const panel = el(
    'div.sheet',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    el('div.sheet-asa'),
    titulo ? el('h2.sheet-titulo', { text: titulo }) : null,
    contenido
  );

  const fondo = el('div.sheet-fondo', { onClick: () => closeSheet() });
  const contenedor = el('div.sheet-wrap', {}, fondo, panel);

  /** @param {KeyboardEvent} ev */
  const alTeclado = (ev) => {
    if (ev.key === 'Escape') closeSheet();
  };
  document.addEventListener('keydown', alTeclado);

  hostSheet.append(contenedor);
  sheetActivo = { contenedor, alCerrar, alTeclado };

  const primerBoton = panel.querySelector('button, input');
  if (primerBoton instanceof HTMLButtonElement) primerBoton.focus({ preventScroll: true });

  return closeSheet;
}

export function closeSheet() {
  if (!sheetActivo) return;
  const { contenedor, alCerrar, alTeclado } = sheetActivo;
  sheetActivo = null;
  document.removeEventListener('keydown', alTeclado);
  contenedor.remove();
  if (alCerrar) alCerrar();
}

// --- Enlaces ----------------------------------------------------------------

export function baseURL() {
  return location.origin + location.pathname;
}

/**
 * @param {string} eventId
 * @param {'door'|'desk'} rol
 * @returns {string}
 */
export function enlaceDe(eventId, rol) {
  return `${baseURL()}#e=${encodeURIComponent(eventId)}&r=${rol}`;
}

/**
 * @param {string} texto
 * @param {string} [etiqueta]
 */
export async function copiar(texto, etiqueta = 'Enlace copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(etiqueta, { ms: 2500 });
  } catch {
    // Sin permiso de portapapeles: seleccionamos el texto para copiar a mano.
    const campo = input('input.copia-fallback', { value: texto, readOnly: true });
    document.body.append(campo);
    campo.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    campo.remove();
    toast(ok ? etiqueta : 'Copia el enlace a mano: ' + texto, { ms: ok ? 2500 : 8000 });
  }
}

// --- Router -----------------------------------------------------------------

/** @returns {{eventId: string, rol: string}} */
function leerHash() {
  const bruto = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(bruto);
  return {
    eventId: params.get('e') || '',
    rol: params.get('r') || ''
  };
}

/** @type {(() => void)|null} */
let desmontarVista = null;
/** @type {ReturnType<typeof openEvent>|null} */
let tiendaActiva = null;

function limpiar() {
  closeSheet();
  if (desmontarVista) {
    try {
      desmontarVista();
    } catch (err) {
      console.error(err);
    }
    desmontarVista = null;
  }
  if (tiendaActiva) {
    tiendaActiva.destroy();
    tiendaActiva = null;
  }
  raiz.textContent = '';
}

async function enrutar() {
  limpiar();
  const { eventId, rol } = leerHash();

  try {
    await initApp();
  } catch (err) {
    if (err instanceof Error && err.message === 'CONFIG_PENDIENTE') return pantallaConfig();
    return pantallaError(err);
  }

  if (!eventId) return pantallaArranque();
  if (rol !== 'door' && rol !== 'desk') return pantallaRol(eventId);

  tiendaActiva = openEvent(eventId);

  // La agenda solo apunta eventos que existen de verdad, con su nombre ya
  // cargado. Así un enlace roto no ensucia la lista.
  const dejarDeMirar = tiendaActiva.subscribe((estado) => {
    if (!estado.existe || !estado.evento) return;
    misEventos.recordar({ id: eventId, name: estado.evento.name, date: estado.evento.date });
    dejarDeMirar();
  });

  const modulo = rol === 'door'
    ? await import('./views/door.js')
    : await import('./views/desk.js');
  desmontarVista = modulo.mount(raiz, tiendaActiva);
}

// --- Pantallas de arranque --------------------------------------------------

function pantallaConfig() {
  raiz.append(
    el('div.pantalla',
      el('div.tarjeta',
        el('h1.titulo', { text: 'Falta la configuración de Firebase' }),
        el('p.parrafo', { text: 'Abre firebase-config.js y pega ahí la configuración de tu proyecto. Sin eso la app no puede guardar nada.' }),
        el('ol.lista-pasos',
          el('li', { text: 'Consola de Firebase > Configuración del proyecto > Tus apps.' }),
          el('li', { text: 'Copia el objeto firebaseConfig.' }),
          el('li', { text: 'Pégalo en firebase-config.js y vuelve a publicar.' })
        )
      )
    )
  );
}

/** @param {unknown} err */
function pantallaError(err) {
  const mensaje = err instanceof Error ? err.message : String(err);
  raiz.append(
    el('div.pantalla',
      el('div.tarjeta',
        el('h1.titulo', { text: 'No se pudo arrancar' }),
        el('p.parrafo', { text: mensaje }),
        boton('button.btn.btn-primario', { text: 'Reintentar', onClick: () => location.reload() })
      )
    )
  );
}

/** @param {string} eventId */
function pantallaRol(eventId) {
  raiz.append(
    el('div.pantalla',
      el('div.tarjeta',
        el('h1.titulo', { text: 'Elige tu puesto' }),
        el('p.parrafo', { text: 'Este enlace no dice si eres puerta o tesorería.' }),
        el('div.acciones-columna',
          el('a.btn.btn-primario', { href: enlaceDe(eventId, 'door'), text: 'Puerta' }),
          el('a.btn.btn-secundario', { href: enlaceDe(eventId, 'desk'), text: 'Tesorería' })
        )
      )
    )
  );
}

function pantallaArranque() {
  const hoy = new Date().toISOString().slice(0, 10);

  const campos = {
    name: input('input.campo', { type: 'text', value: 'Concierto', required: true, maxLength: 120 }),
    date: input('input.campo', { type: 'date', value: hoy }),
    price: input('input.campo', { type: 'number', value: '10', min: '0', step: '0.5', inputMode: 'decimal' }),
    barPct: input('input.campo', { type: 'number', value: '20', min: '0', max: '100', step: '1', inputMode: 'numeric' }),
    delivered: input('input.campo', { type: 'number', value: '0', min: '0', step: '1', inputMode: 'numeric' })
  };

  const formulario = el('form.formulario', {
    /** @param {SubmitEvent} ev */
    onSubmit: (ev) => {
      ev.preventDefault();
      const eventId = nuevoEventId();
      const nombre = campos.name.value.trim() || 'Concierto';

      const { guardado } = crearEvento(eventId, {
        name: nombre,
        date: campos.date.value,
        price: campos.price.value,
        barPct: campos.barPct.value,
        tickets: {
          delivered: Math.max(0, Math.round(Number(campos.delivered.value) || 0)),
          soldCash: 0,
          soldBizum: 0,
          returned: 0
        }
      });

      misEventos.recordar({ id: eventId, name: nombre, date: campos.date.value });

      // No se espera al servidor para navegar, pero si rechaza hay que decirlo:
      // un evento que no se guardó deja la puerta muerta sin explicación.
      guardado.catch((err) => mostrarFalloDeGuardado(err));

      limpiar();
      pantallaEnlaces(eventId);
    }
  },
    etiquetado('Nombre', campos.name),
    etiquetado('Fecha', campos.date),
    el('div.rejilla-2',
      etiquetado('Precio de la entrada (€)', campos.price),
      etiquetado('Corte del bar (%)', campos.barPct)
    ),
    etiquetado('Entradas repartidas', campos.delivered, 'El talonario que ya salió de tus manos. Se puede cambiar luego.'),
    el('button.btn.btn-primario.btn-ancho', { type: 'submit', text: 'Crear evento' })
  );

  raiz.append(
    el('div.pantalla',
      el('div.tarjeta',
        el('h1.titulo', { text: 'Taquilla' }),
        el('p.parrafo', { text: 'Crea el evento y reparte los dos enlaces: uno para la puerta y otro para tesorería.' }),
        formulario
      ),
      tarjetaMisEventos(),
      el('p.pie.pie-version', { text: ETIQUETA_VERSION })
    )
  );
}

/**
 * Agenda local de eventos creados o abiertos en este móvil. No es la fuente de
 * verdad de nada: solo evita tener que guardar los enlaces a mano.
 *
 * @returns {HTMLElement|null}
 */
function tarjetaMisEventos() {
  const eventos = misEventos.listar();
  if (!eventos.length) return null;

  const lista = el('div.eventos');
  const tarjeta = el('section.tarjeta',
    el('h2.tarjeta-titulo', { text: 'Tus eventos' }),
    lista,
    el('p.pie', { text: 'Guardados solo en este móvil. Los datos viven en Firestore.' })
  );

  for (const evento of eventos) lista.append(filaDeEvento(evento, lista, tarjeta));

  return tarjeta;
}

/**
 * @param {import('./mis-eventos.js').EventoLocal} evento
 * @param {HTMLElement} lista
 * @param {HTMLElement} tarjeta
 * @returns {HTMLElement}
 */
function filaDeEvento(evento, lista, tarjeta) {
  const fila = el('div.evento',
    el('div.evento-cabecera',
      el('div',
        el('div.evento-nombre', { text: evento.name || 'Evento sin nombre' }),
        evento.date ? el('div.evento-fecha', { text: fmtFecha(evento.date) }) : null
      ),
      boton('button.evento-quitar', {
        text: 'Quitar',
        'aria-label': `Quitar ${evento.name || 'este evento'} de la lista`,
        onClick: () => quitarDeLaLista(evento, fila, lista, tarjeta)
      })
    ),
    el('div.acciones-fila',
      el('a.btn.btn-secundario', { href: enlaceDe(evento.id, 'door'), text: 'Puerta' }),
      el('a.btn.btn-primario', { href: enlaceDe(evento.id, 'desk'), text: 'Tesorería' })
    )
  );
  return fila;
}

/**
 * Quita el atajo de este móvil. No borra nada en Firestore: el evento sigue
 * ahí y su enlace sigue funcionando, por eso no se pide confirmación y basta
 * con poder deshacerlo.
 *
 * @param {import('./mis-eventos.js').EventoLocal} evento
 * @param {HTMLElement} fila
 * @param {HTMLElement} lista
 * @param {HTMLElement} tarjeta
 */
function quitarDeLaLista(evento, fila, lista, tarjeta) {
  const contenedor = tarjeta.parentElement;
  misEventos.olvidar(evento.id);
  fila.remove();
  if (!lista.querySelector('.evento')) tarjeta.remove();

  toast('Quitado de la lista', {
    accion: 'Deshacer',
    alAccionar: () => {
      misEventos.recordar(evento);
      if (!tarjeta.isConnected && contenedor) contenedor.append(tarjeta);
      lista.prepend(fila);
    }
  });
}

/**
 * Fecha ISO a formato de aquí. Si no es ISO, se enseña tal cual.
 * @param {string} iso
 * @returns {string}
 */
function fmtFecha(iso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : iso;
}

/** @param {unknown} err */
function mostrarFalloDeGuardado(err) {
  const explicacion = explicarError(err);
  const aviso = el('div.problema',
    el('p.problema-titulo', { text: 'El evento no se ha guardado' }),
    el('p.problema-detalle', { text: explicacion.detalle }),
    explicacion.pasos.length
      ? el('ol.problema-pasos', explicacion.pasos.map((paso) => el('li', { text: paso })))
      : null
  );
  const pantalla = raiz.querySelector('.pantalla');
  if (pantalla) pantalla.prepend(aviso);
  else raiz.prepend(aviso);
}

/**
 * El QR no es imprescindible: si la URL fuese enorme, el enlace sigue ahí.
 * @param {string} enlace
 * @returns {HTMLElement}
 */
function qrDe(enlace) {
  try {
    return el('div.qr', { html: qrSVG(enlace) });
  } catch (err) {
    console.warn('No se pudo generar el QR:', err);
    return el('p.pie', { text: 'El enlace es demasiado largo para un QR. Cópialo a mano.' });
  }
}

/**
 * @param {string} texto
 * @param {HTMLElement} campo
 * @param {string|null} [ayuda]
 * @returns {HTMLElement}
 */
function etiquetado(texto, campo, ayuda = null) {
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  campo.id = id;
  return el('label.etiqueta', { htmlFor: id },
    el('span.etiqueta-texto', { text: texto }),
    campo,
    ayuda ? el('span.etiqueta-ayuda', { text: ayuda }) : null
  );
}

/** @param {string} eventId */
function pantallaEnlaces(eventId) {
  const enlacePuerta = enlaceDe(eventId, 'door');
  const enlaceMesa = enlaceDe(eventId, 'desk');

  raiz.append(
    el('div.pantalla',
      el('div.tarjeta',
        el('h1.titulo', { text: 'Evento creado' }),
        el('p.parrafo', { text: 'Guarda estos dos enlaces. Quien los tenga, entra: no hay contraseña.' }),

        el('div.bloque-enlace',
          el('h2.subtitulo', { text: 'Puerta' }),
          el('code.enlace', { text: enlacePuerta }),
          el('div.acciones-fila',
            boton('button.btn.btn-secundario', { text: 'Copiar', onClick: () => copiar(enlacePuerta) }),
            el('a.btn.btn-primario', { href: enlacePuerta, text: 'Abrir' })
          ),
          qrDe(enlacePuerta),
          el('p.pie', { text: 'Escanea este código con el móvil de la puerta.' })
        ),

        el('div.bloque-enlace',
          el('h2.subtitulo', { text: 'Tesorería' }),
          el('code.enlace', { text: enlaceMesa }),
          el('div.acciones-fila',
            boton('button.btn.btn-secundario', { text: 'Copiar', onClick: () => copiar(enlaceMesa) }),
            el('a.btn.btn-primario', { href: enlaceMesa, text: 'Abrir' })
          )
        )
      )
    )
  );
}

// --- Arranque ---------------------------------------------------------------

window.addEventListener('hashchange', enrutar);
enrutar();

// --- Service worker ---------------------------------------------------------
//
// La versión nueva NO entra sola: se queda esperando y se ofrece un botón. En
// mitad de una cola en la puerta, una recarga por sorpresa es peor que seguir
// una noche con la versión anterior.

if ('serviceWorker' in navigator) {
  const habiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Solo se recarga si el usuario ha aceptado: el primer control (cuando no
    // había ninguno) no debe mover la pantalla de nadie.
    if (!habiaControlador || recargando) return;
    recargando = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registro = await navigator.serviceWorker.register('./sw.js');

      if (registro.waiting) avisarDeActualizacion(registro);

      registro.addEventListener('updatefound', () => {
        const entrante = registro.installing;
        if (!entrante) return;
        entrante.addEventListener('statechange', () => {
          if (entrante.state === 'installed' && navigator.serviceWorker.controller) {
            avisarDeActualizacion(registro);
          }
        });
      });
    } catch (err) {
      console.warn('No se pudo registrar el service worker:', err);
    }
  });
}

/** @param {ServiceWorkerRegistration} registro */
function avisarDeActualizacion(registro) {
  toast('Hay una versión nueva', {
    accion: 'Actualizar',
    ms: 30000,
    alAccionar: () => {
      const esperando = registro.waiting;
      if (esperando) esperando.postMessage({ tipo: 'SKIP_WAITING' });
    }
  });
}

// app.js — arranque, router de hash y utilidades de interfaz compartidas.
//
// Rutas:
//   (sin hash)              pantalla de arranque, crea el evento
//   #e=<eventId>&r=door     vista de puerta
//   #e=<eventId>&r=desk     vista de tesorería

import { initApp, openEvent, crearEvento, nuevoEventId } from './store.js';
import { qrSVG } from './qr.js';

const raiz = document.getElementById('app');
const hostToast = document.getElementById('toast-host');
const hostSheet = document.getElementById('sheet-host');

// --- Utilidades de DOM ------------------------------------------------------

/** el('div.clase#id', { attr }, ...hijos) */
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
    else if (k in nodo && k !== 'list') nodo[k] = v;
    else nodo.setAttribute(k, v);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

const FORMATO_EUROS = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function fmtEuros(n) {
  return FORMATO_EUROS.format(Number.isFinite(n) ? n : 0);
}

export function fmtHora(fecha) {
  if (!fecha) return '--:--';
  return fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/** Vibración corta de confirmación. Silenciosa si el móvil no la soporta. */
export function vibrar(ms = 30) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* algunos navegadores lo bloquean */ }
  }
}

// --- Toasts -----------------------------------------------------------------

let toastActivo = null;

export function toast(texto, { accion = null, alAccionar = null, ms = 5000 } = {}) {
  cerrarToast();

  const nodo = el('div.toast', { role: 'status' }, el('span.toast-texto', { text: texto }));

  if (accion) {
    nodo.append(
      el('button.toast-accion', {
        type: 'button',
        text: accion,
        onClick: () => {
          cerrarToast();
          alAccionar && alAccionar();
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

let sheetActivo = null;

/** Abre un panel inferior. Devuelve la función para cerrarlo. */
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

  const alTeclado = (ev) => {
    if (ev.key === 'Escape') closeSheet();
  };
  document.addEventListener('keydown', alTeclado);

  hostSheet.append(contenedor);
  sheetActivo = { contenedor, alCerrar, alTeclado };

  const primerBoton = panel.querySelector('button, input');
  if (primerBoton && !primerBoton.matches('input')) primerBoton.focus({ preventScroll: true });

  return closeSheet;
}

export function closeSheet() {
  if (!sheetActivo) return;
  const { contenedor, alCerrar, alTeclado } = sheetActivo;
  sheetActivo = null;
  document.removeEventListener('keydown', alTeclado);
  contenedor.remove();
  alCerrar && alCerrar();
}

// --- Enlaces ----------------------------------------------------------------

export function baseURL() {
  return location.origin + location.pathname;
}

export function enlaceDe(eventId, rol) {
  return `${baseURL()}#e=${encodeURIComponent(eventId)}&r=${rol}`;
}

export async function copiar(texto, etiqueta = 'Enlace copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(etiqueta, { ms: 2500 });
  } catch {
    // Sin permiso de portapapeles: seleccionamos el texto para copiar a mano.
    const campo = el('input', { value: texto, readOnly: true, class: 'copia-fallback' });
    document.body.append(campo);
    campo.select();
    const ok = document.execCommand && document.execCommand('copy');
    campo.remove();
    toast(ok ? etiqueta : 'Copia el enlace a mano: ' + texto, { ms: ok ? 2500 : 8000 });
  }
}

// --- Router -----------------------------------------------------------------

function leerHash() {
  const bruto = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(bruto);
  return {
    eventId: params.get('e') || '',
    rol: params.get('r') || ''
  };
}

let desmontarVista = null;
let tiendaActiva = null;

function limpiar() {
  closeSheet();
  if (desmontarVista) {
    try { desmontarVista(); } catch (err) { console.error(err); }
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

  let firebaseListo = true;
  try {
    await initApp();
  } catch (err) {
    firebaseListo = false;
    if (err.message === 'CONFIG_PENDIENTE') return pantallaConfig();
    return pantallaError(err);
  }
  if (!firebaseListo) return;

  if (!eventId) return pantallaArranque();
  if (rol !== 'door' && rol !== 'desk') return pantallaRol(eventId);

  tiendaActiva = openEvent(eventId);
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

function pantallaError(err) {
  raiz.append(
    el('div.pantalla',
      el('div.tarjeta',
        el('h1.titulo', { text: 'No se pudo arrancar' }),
        el('p.parrafo', { text: String(err && err.message ? err.message : err) }),
        el('button.btn.btn-primario', { type: 'button', text: 'Reintentar', onClick: () => location.reload() })
      )
    )
  );
}

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
    name: el('input.campo', { type: 'text', value: 'Concierto', required: true, maxLength: 120 }),
    date: el('input.campo', { type: 'date', value: hoy }),
    price: el('input.campo', { type: 'number', value: '10', min: '0', step: '0.5', inputMode: 'decimal' }),
    barPct: el('input.campo', { type: 'number', value: '20', min: '0', max: '100', step: '1', inputMode: 'numeric' }),
    delivered: el('input.campo', { type: 'number', value: '0', min: '0', step: '1', inputMode: 'numeric' })
  };

  const formulario = el('form.formulario', {
    onSubmit: (ev) => {
      ev.preventDefault();
      const eventId = nuevoEventId();
      crearEvento(eventId, {
        name: campos.name.value.trim() || 'Concierto',
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
      )
    )
  );
}

/** El QR no es imprescindible: si la URL fuese enorme, el enlace sigue ahí. */
function qrDe(enlace) {
  try {
    return el('div.qr', { html: qrSVG(enlace) });
  } catch (err) {
    console.warn('No se pudo generar el QR:', err);
    return el('p.pie', { text: 'El enlace es demasiado largo para un QR. Cópialo a mano.' });
  }
}

function etiquetado(texto, campo, ayuda = null) {
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  campo.id = id;
  return el('label.etiqueta', { htmlFor: id },
    el('span.etiqueta-texto', { text: texto }),
    campo,
    ayuda ? el('span.etiqueta-ayuda', { text: ayuda }) : null
  );
}

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
            el('button.btn.btn-secundario', { type: 'button', text: 'Copiar', onClick: () => copiar(enlacePuerta) }),
            el('a.btn.btn-primario', { href: enlacePuerta, text: 'Abrir' })
          ),
          qrDe(enlacePuerta),
          el('p.pie', { text: 'Escanea este código con el móvil de la puerta.' })
        ),

        el('div.bloque-enlace',
          el('h2.subtitulo', { text: 'Tesorería' }),
          el('code.enlace', { text: enlaceMesa }),
          el('div.acciones-fila',
            el('button.btn.btn-secundario', { type: 'button', text: 'Copiar', onClick: () => copiar(enlaceMesa) }),
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('No se pudo registrar el service worker:', err);
    });
  });
}

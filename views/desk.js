// @ts-check
// views/desk.js — vista de tesorería.
//
// Estructura de app de banco: cifra grande arriba, tarjetas debajo. Aquí sí
// está todo el dinero, la configuración del evento y el cierre de caja.

import { el, boton, input, fmtEuros, fmtHora, toast, openSheet, closeSheet, copiar, enlaceDe, ETIQUETA_VERSION } from '../app.js';
import { explicarError } from '../errores.js';
import { toCSV, ETIQUETA_METODO } from '../store.js';

/** @typedef {import('../store.js').Store} Store */
/** @typedef {import('../store.js').EstadoEvento} EstadoEvento */
/** @typedef {import('../calc.js').Entry} Entry */

/**
 * @param {HTMLElement} raiz
 * @param {Store} store
 * @returns {() => void} desmontar
 */
export function mount(raiz, store) {
  // --- Cabecera y saldo
  const barraRed = el('div.barra-red', { hidden: true });
  const avisoCerrado = el('div.barra-cerrado', { hidden: true, text: 'Caja cerrada. Solo lectura.' });
  const nombreEvento = el('div.desk-evento', { text: ' ' });
  const problema = el('div.problema', { hidden: true });
  const facturado = el('div.saldo', { text: fmtEuros(0) });

  // --- Tarjetas de desglose
  const valEfectivo = el('div.tarjeta-valor', { text: fmtEuros(0) });
  const valBizum = el('div.tarjeta-valor', { text: fmtEuros(0) });
  const valAsistentes = el('div.tarjeta-valor', { text: '0' });
  const subEfectivo = el('div.tarjeta-sub', { text: ' ' });
  const subBizum = el('div.tarjeta-sub', { text: ' ' });
  const subAsistentes = el('div.tarjeta-sub', { text: ' ' });

  const desglose = el('div.rejilla-3',
    tarjetaMini('Efectivo', valEfectivo, subEfectivo, 'acento-cash'),
    tarjetaMini('Bizum', valBizum, subBizum, 'acento-bizum'),
    tarjetaMini('Asistentes', valAsistentes, subAsistentes, 'acento-neutro')
  );

  // --- Reparto
  const valBar = el('span.linea-valor', { text: fmtEuros(0) });
  const valBanda = el('span.linea-valor', { text: fmtEuros(0) });
  const etiqBar = el('span.linea-etiqueta', { text: 'Corte del bar' });
  const tarjetaReparto = el('section.tarjeta',
    el('h2.tarjeta-titulo', { text: 'Reparto' }),
    linea(etiqBar, valBar),
    linea(el('span.linea-etiqueta', { text: 'Para la banda' }), valBanda, 'destacada')
  );

  // --- Talonario
  const valEntregadas = el('span.linea-valor', { text: '0' });
  const valCobradas = el('span.linea-valor', { text: '0' });
  const valDevueltas = el('span.linea-valor', { text: '0' });
  const valCirculacion = el('span.linea-valor', { text: '0' });
  const valPendiente = el('span.linea-valor', { text: fmtEuros(0) });
  const lineaPendiente = linea(el('span.linea-etiqueta', { text: 'Pendiente de cobro' }), valPendiente, 'destacada');

  const tarjetaTalonario = el('section.tarjeta',
    el('h2.tarjeta-titulo', { text: 'Talonario' }),
    lineaPendiente,
    linea(el('span.linea-etiqueta', { text: 'Entregadas' }), valEntregadas),
    linea(el('span.linea-etiqueta', { text: 'Cobradas por adelantado' }), valCobradas),
    linea(el('span.linea-etiqueta', { text: 'Devueltas' }), valDevueltas),
    linea(el('span.linea-etiqueta', { text: 'En circulación' }), valCirculacion)
  );

  // --- Configuración
  const campos = {
    name: input('input.campo', { type: 'text', maxLength: 120 }),
    date: input('input.campo', { type: 'date' }),
    price: input('input.campo', { type: 'number', min: '0', step: '0.5', inputMode: 'decimal' }),
    barPct: input('input.campo', { type: 'number', min: '0', max: '100', step: '1', inputMode: 'numeric' }),
    delivered: input('input.campo', { type: 'number', min: '0', step: '1', inputMode: 'numeric' }),
    soldCash: input('input.campo', { type: 'number', min: '0', step: '1', inputMode: 'numeric' }),
    soldBizum: input('input.campo', { type: 'number', min: '0', step: '1', inputMode: 'numeric' }),
    returned: input('input.campo', { type: 'number', min: '0', step: '1', inputMode: 'numeric' })
  };

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const temporizadores = new Map();
  for (const [clave, campo] of Object.entries(campos)) {
    const guardar = () => {
      clearTimeout(temporizadores.get(clave));
      temporizadores.set(clave, setTimeout(() => store.updateConfig({ [clave]: campo.value }), 250));
    };
    campo.addEventListener('input', guardar);
    campo.addEventListener('change', guardar);
  }

  const tarjetaConfig = el('section.tarjeta',
    el('h2.tarjeta-titulo', { text: 'Evento' }),
    etiquetado('Nombre', campos.name),
    etiquetado('Fecha', campos.date),
    el('div.rejilla-2',
      etiquetado('Precio (€)', campos.price),
      etiquetado('Corte del bar (%)', campos.barPct)
    ),
    el('h3.tarjeta-subtitulo', { text: 'Talonario' }),
    el('div.rejilla-2',
      etiquetado('Entregadas', campos.delivered),
      etiquetado('Devueltas', campos.returned)
    ),
    el('div.rejilla-2',
      etiquetado('Cobradas en efectivo', campos.soldCash),
      etiquetado('Cobradas por bizum', campos.soldBizum)
    ),
    boton('button.btn.btn-secundario.btn-ancho', {
      text: 'Copiar enlace de puerta',
      onClick: () => copiar(enlaceDe(store.eventId, 'door'))
    })
  );

  // --- Movimientos
  const listaMovimientos = el('div.movimientos');
  const tarjetaMovimientos = el('section.tarjeta',
    el('h2.tarjeta-titulo', { text: 'Movimientos' }),
    listaMovimientos
  );

  // --- Cierre
  const botonCerrar = boton('button.btn.btn-peligro.btn-ancho', {
    text: 'Cerrar caja',
    onClick: confirmarCierre
  });
  const botonCSV = boton('button.btn.btn-secundario.btn-ancho', {
    text: 'Descargar CSV',
    onClick: descargarCSV
  });
  const tarjetaCierre = el('section.tarjeta',
    el('h2.tarjeta-titulo', { text: 'Cierre de caja' }),
    el('p.parrafo', { text: 'Al cerrar, la app pasa a solo lectura en los dos móviles. El CSV se puede descargar antes y después.' }),
    botonCerrar,
    botonCSV
  );

  const vista = el('div.vista-mesa',
    barraRed,
    avisoCerrado,
    el('header.desk-cabecera',
      el('div.desk-barra',
        nombreEvento,
        boton('button.cambiar-puesto', { text: 'Tesorería', 'aria-label': 'Cambiar de puesto', onClick: abrirCambioDePuesto })
      ),
      problema,
      el('div.saldo-etiqueta', { text: 'Facturado' }),
      facturado
    ),
    desglose,
    tarjetaReparto,
    tarjetaTalonario,
    tarjetaConfig,
    tarjetaMovimientos,
    tarjetaCierre,
    el('p.pie.pie-version', { text: ETIQUETA_VERSION })
  );

  raiz.append(vista);

  let estado = store.getState();
  const desuscribir = store.subscribe(/** @param {EstadoEvento} nuevo */ (nuevo) => {
    estado = nuevo;
    pintar();
  });

  function pintar() {
    const { evento, totales, entries } = estado;
    const cerrado = !!(evento && evento.closedAt);

    pintarProblema();

    if (!estado.existe && !estado.cargando) {
      nombreEvento.textContent = 'Evento no disponible';
    } else if (evento) {
      nombreEvento.textContent = [evento.name, formatearFecha(evento.date)].filter(Boolean).join(' · ');
    }

    facturado.textContent = fmtEuros(totales.facturado);

    valEfectivo.textContent = fmtEuros(totales.efectivoTotal);
    valBizum.textContent = fmtEuros(totales.bizumTotal);
    valAsistentes.textContent = String(totales.asistentes);
    subEfectivo.textContent = `${totales.conteos.cash} en puerta`;
    subBizum.textContent = `${totales.conteos.bizum} en puerta`;
    subAsistentes.textContent = `${totales.conteos.guest} invitados`;

    etiqBar.textContent = `Corte del bar (${redondear(totales.barPct)}%)`;
    valBar.textContent = fmtEuros(totales.corteBar);
    valBanda.textContent = fmtEuros(totales.paraBanda);

    const t = evento ? evento.tickets : { delivered: 0, soldCash: 0, soldBizum: 0, returned: 0 };
    valEntregadas.textContent = String(t.delivered);
    valCobradas.textContent = String(t.soldCash + t.soldBizum);
    valDevueltas.textContent = String(t.returned);
    valCirculacion.textContent = String(totales.entradasEnCirculacion);
    valPendiente.textContent = fmtEuros(totales.pendienteDeCobro);
    lineaPendiente.classList.toggle('alerta', totales.pendienteDeCobro > 0);

    if (evento) {
      poner(campos.name, evento.name);
      poner(campos.date, evento.date);
      poner(campos.price, evento.price);
      poner(campos.barPct, evento.barPct);
      poner(campos.delivered, t.delivered);
      poner(campos.soldCash, t.soldCash);
      poner(campos.soldBizum, t.soldBizum);
      poner(campos.returned, t.returned);
    }

    for (const campo of Object.values(campos)) campo.disabled = cerrado;
    botonCerrar.hidden = cerrado;
    avisoCerrado.hidden = !cerrado;
    botonCSV.disabled = !evento;

    if (!estado.online || estado.pendientes > 0) {
      barraRed.hidden = false;
      barraRed.textContent = !estado.online
        ? 'Sin conexión. Los totales pueden estar incompletos hasta que vuelva la señal.'
        : `Enviando ${estado.pendientes} ${estado.pendientes === 1 ? 'registro' : 'registros'}…`;
      barraRed.classList.toggle('offline', !estado.online);
    } else {
      barraRed.hidden = true;
    }

    pintarMovimientos(entries, cerrado);
  }

  function pintarProblema() {
    const hayFallo = !!estado.error || (!estado.existe && !estado.cargando);
    if (!hayFallo) {
      problema.hidden = true;
      return;
    }

    const explicacion = estado.error
      ? explicarError(estado.error)
      : {
          titulo: 'Este evento no existe',
          detalle: 'El enlace apunta a un evento que no está en la base de datos.',
          pasos: []
        };

    problema.hidden = false;
    problema.textContent = '';
    problema.append(
      el('p.problema-titulo', { text: explicacion.titulo }),
      el('p.problema-detalle', { text: explicacion.detalle })
    );
    if (explicacion.pasos.length) {
      problema.append(el('ol.problema-pasos', explicacion.pasos.map((paso) => el('li', { text: paso }))));
    }
    problema.append(
      boton('button.btn.btn-secundario', { text: 'Reintentar', onClick: () => location.reload() })
    );
  }

  function abrirCambioDePuesto() {
    openSheet('Cambiar de puesto',
      el('div.sheet-contenido',
        el('p.parrafo', { text: 'Estás en tesorería. La puerta solo cuenta gente, sin dinero a la vista.' }),
        el('div.sheet-botones',
          el('a.btn-sheet.btn-sheet-si', {
            href: enlaceDe(store.eventId, 'door'),
            text: 'Ir a la puerta',
            onClick: () => closeSheet()
          }),
          boton('button.btn-sheet.btn-sheet-no', { text: 'Seguir en tesorería', onClick: () => closeSheet() })
        )
      )
    );
  }

  /**
   * @param {Entry[]} entries
   * @param {boolean} cerrado
   */
  function pintarMovimientos(entries, cerrado) {
    listaMovimientos.textContent = '';

    if (!entries.length) {
      listaMovimientos.append(
        el('p.vacio', { text: estado.cargando ? 'Cargando movimientos…' : 'Todavía no ha entrado nadie. En cuanto la puerta registre a la primera persona, aparecerá aquí.' })
      );
      return;
    }

    for (const entrada of entries) {
      const cobra = entrada.method === 'cash' || entrada.method === 'bizum';
      const fila = el('div.movimiento' + (entrada.voided ? '.anulado' : ''),
        el('div.mov-punto.punto-' + entrada.method),
        el('div.mov-cuerpo',
          el('div.mov-titulo', { text: ETIQUETA_METODO[entrada.method] || entrada.method }),
          el('div.mov-detalle', {
            text: [
              fmtHora(entrada.ts),
              entrada.hasTicket ? 'con entrada' : 'sin entrada',
              entrada.note ? '· ' + entrada.note : null
            ].filter(Boolean).join(' · ')
          })
        ),
        el('div.mov-importe', { text: fmtEuros(cobra && !entrada.voided ? estado.totales.price : 0) }),
        cerrado
          ? null
          : boton('button.mov-accion', {
              text: entrada.voided ? 'Restaurar' : 'Anular',
              onClick: () => {
                store.setVoided(entrada.id, !entrada.voided);
                toast(entrada.voided ? 'Registro restaurado' : 'Registro anulado', { ms: 2500 });
              }
            })
      );
      listaMovimientos.append(fila);
    }
  }

  function confirmarCierre() {
    const contenido = el('div.sheet-contenido',
      el('p.parrafo', { text: 'Se guarda la hora del cierre y la app deja de aceptar registros en los dos móviles. No se puede reabrir desde aquí.' }),
      el('div.sheet-botones',
        boton('button.btn-sheet.btn-sheet-peligro', {
          text: 'Cerrar caja',
          onClick: () => {
            store.cerrarCaja();
            closeSheet();
            toast('Caja cerrada');
          }
        }),
        boton('button.btn-sheet.btn-sheet-no', { text: 'Cancelar', onClick: () => closeSheet() })
      )
    );
    openSheet('¿Cerrar la caja?', contenido);
  }

  function descargarCSV() {
    const { evento, entries, totales } = estado;
    if (!evento) return;

    const csv = toCSV(evento, entries, totales);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const nombre = `taquilla-${(evento.name || 'evento').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${evento.date || ''}.csv`;

    const enlace = el('a', { href: url, download: nombre });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return function desmontar() {
    desuscribir();
    for (const t of temporizadores.values()) clearTimeout(t);
    vista.remove();
  };
}

// --- Piezas -----------------------------------------------------------------

/**
 * @param {string} titulo
 * @param {HTMLElement} valor
 * @param {HTMLElement} sub
 * @param {string} clase
 * @returns {HTMLElement}
 */
function tarjetaMini(titulo, valor, sub, clase) {
  return el('section.tarjeta.tarjeta-mini.' + clase,
    el('div.tarjeta-mini-titulo', { text: titulo }),
    valor,
    sub
  );
}

/**
 * @param {HTMLElement} etiqueta
 * @param {HTMLElement} valor
 * @param {string} [extra]
 * @returns {HTMLElement}
 */
function linea(etiqueta, valor, extra = '') {
  return el('div.linea' + (extra ? '.' + extra : ''), etiqueta, valor);
}

/**
 * @param {string} texto
 * @param {HTMLElement} campo
 * @returns {HTMLElement}
 */
function etiquetado(texto, campo) {
  const id = 'd' + Math.random().toString(36).slice(2, 8);
  campo.id = id;
  return el('label.etiqueta', { htmlFor: id }, el('span.etiqueta-texto', { text: texto }), campo);
}

/**
 * No pisa lo que el tesorero está escribiendo en ese momento.
 * @param {HTMLInputElement} campo
 * @param {string|number} valor
 */
function poner(campo, valor) {
  if (document.activeElement === campo) return;
  const nuevo = String(valor ?? '');
  if (campo.value !== nuevo) campo.value = nuevo;
}

/**
 * @param {number} n
 * @returns {number}
 */
function redondear(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {string} iso
 * @returns {string}
 */
function formatearFecha(iso) {
  if (!iso) return '';
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

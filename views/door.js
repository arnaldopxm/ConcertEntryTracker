// @ts-check
// views/door.js — vista de puerta.
//
// Una pantalla, sin scroll, sin menús y sin dinero: aquí solo se cuenta gente.
// Dos toques por persona como máximo.

import { el, boton, input, toast, openSheet, closeSheet, vibrar, enlaceDe } from '../app.js';
import { explicarError } from '../errores.js';

/** @typedef {import('../store.js').Store} Store */
/** @typedef {import('../calc.js').Metodo} Metodo */

/** @type {Record<Metodo, string>} */
const CONFIRMACION = {
  cash: 'Registrado en efectivo',
  bizum: 'Registrado en bizum',
  already_paid: 'Registrado como ya pagada',
  guest: 'Registrado como invitado'
};

/**
 * @param {HTMLElement} raiz
 * @param {Store} store
 * @returns {() => void} desmontar
 */
export function mount(raiz, store) {
  const contador = el('div.contador', { text: '0' });
  const talonario = el('div.contador-pie', { text: ' ' });
  const barraRed = el('div.barra-red', { hidden: true });
  const avisoCerrado = el('div.barra-cerrado', { hidden: true, text: 'Caja cerrada. Ya no se registran entradas.' });

  /** @type {Record<Metodo, HTMLButtonElement>} */
  const botones = {
    cash: botonPad('Efectivo', 'cash'),
    bizum: botonPad('Bizum', 'bizum'),
    already_paid: botonPad('Ya pagada', 'ya'),
    guest: botonPad('Invitado', 'invitado')
  };

  const pad = el('div.pad', botones.cash, botones.bizum, botones.already_paid, botones.guest);

  // Botón pequeño y arriba del todo: cambiar de puesto no puede competir con la
  // rejilla, pero tampoco puede ser imposible.
  const cambiarPuesto = boton('button.cambiar-puesto', {
    text: 'Puerta',
    'aria-label': 'Cambiar de puesto',
    onClick: abrirCambioDePuesto
  });

  const problema = el('div.problema', { hidden: true });

  const vista = el('div.vista-puerta',
    barraRed,
    avisoCerrado,
    el('div.puerta-barra', cambiarPuesto),
    el('div.puerta-top',
      el('div.contador-caja', contador, el('div.contador-etiqueta', { text: 'asistentes' })),
      talonario,
      problema
    ),
    pad
  );

  raiz.append(vista);
  // Sube los toasts por encima de la rejilla: aquí no pueden tapar botones.
  document.body.classList.add('modo-puerta');

  let estado = store.getState();
  /** @type {number|null} */
  let ultimoTotal = null;

  const desuscribir = store.subscribe(/** @param {import('../store.js').EstadoEvento} nuevo */ (nuevo) => {
    estado = nuevo;
    pintar();
  });

  function pintar() {
    const { totales, evento, cargando } = estado;
    const cerrado = !!(evento && evento.closedAt);

    // Contador
    const asistentes = totales.asistentes;
    contador.textContent = cargando && !evento ? '·' : String(asistentes);
    if (ultimoTotal !== null && asistentes !== ultimoTotal) {
      contador.classList.remove('bump');
      void contador.offsetWidth; // reinicia la animación
      contador.classList.add('bump');
    }
    ultimoTotal = asistentes;

    // Talonario pendiente de aparecer
    const enCirculacion = totales.entradasEnCirculacion;
    const restantes = totales.entradasRestantes;
    talonario.classList.toggle('alerta', restantes < 0);
    if (!evento) {
      talonario.textContent = ' ';
    } else if (enCirculacion <= 0) {
      talonario.textContent = 'Sin talonario repartido';
    } else if (restantes > 0) {
      talonario.textContent = `Quedan ${restantes} ${restantes === 1 ? 'entrada' : 'entradas'} por aparecer`;
    } else if (restantes === 0) {
      talonario.textContent = 'No quedan entradas por aparecer';
    } else {
      const extra = Math.abs(restantes);
      talonario.textContent = `${extra} ${extra === 1 ? 'entrada' : 'entradas'} de más`;
    }

    // Estado de red
    const sinRed = !estado.online;
    const pendientes = estado.pendientes;
    if (sinRed || pendientes > 0) {
      barraRed.hidden = false;
      barraRed.textContent = sinRed
        ? 'Sin conexión. Se guarda en el móvil y se envía al recuperar señal.'
        : `Enviando ${pendientes} ${pendientes === 1 ? 'registro' : 'registros'}…`;
      barraRed.classList.toggle('offline', sinRed);
    } else {
      barraRed.hidden = true;
    }

    // Cierre de caja
    avisoCerrado.hidden = !cerrado;

    // Si el evento no está disponible, hay que decir por qué. Un teclado de
    // botones apagados sin explicación es lo peor que puede pasar en la puerta.
    const disponible = estado.existe;
    pintarProblema(disponible, cargando);

    for (const boton of Object.values(botones)) boton.disabled = cerrado || !disponible;
  }

  /**
   * @param {string} texto
   * @param {string} clase
   * @returns {HTMLButtonElement}
   */
  /**
   * @param {boolean} disponible
   * @param {boolean} cargando
   */
  function pintarProblema(disponible, cargando) {
    if (disponible || cargando) {
      problema.hidden = true;
      vista.classList.remove('con-problema');
      return;
    }

    // Sin evento, la rejilla no sirve para nada: fuera. Un teclado de botones
    // apagados solo confunde a quien está de pie en la puerta.
    vista.classList.add('con-problema');

    const explicacion = estado.error
      ? explicarError(estado.error)
      : {
          titulo: 'Este evento no existe',
          detalle: 'El enlace apunta a un evento que no está en la base de datos.',
          pasos: ['Comprueba que has abierto el enlace correcto.', 'Si lo acabas de crear, revisa que se guardó.']
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

  /** Cambio de puesto en dos toques, para que no pase por un roce. */
  function abrirCambioDePuesto() {
    openSheet('Cambiar de puesto',
      el('div.sheet-contenido',
        el('p.parrafo', { text: 'Estás en la puerta. Tesorería enseña el dinero y el cuadre.' }),
        el('div.sheet-botones',
          el('a.btn-sheet.btn-sheet-si', {
            href: enlaceDe(store.eventId, 'desk'),
            text: 'Ir a tesorería',
            onClick: () => closeSheet()
          }),
          boton('button.btn-sheet.btn-sheet-no', { text: 'Seguir en la puerta', onClick: () => closeSheet() })
        )
      )
    );
  }

  /**
   * @param {string} texto
   * @param {string} clase
   * @returns {HTMLButtonElement}
   */
  function botonPad(texto, clase) {
    return boton('button.pad-btn.pad-' + clase, {}, el('span.pad-texto', { text: texto }));
  }

  botones.cash.addEventListener('click', () => preguntarEntrada('cash'));
  botones.bizum.addEventListener('click', () => preguntarEntrada('bizum'));
  botones.already_paid.addEventListener('click', () => {
    // Quien llega con la entrada ya pagada siempre trae papel en la mano.
    if (estado.totales.entradasRestantes <= 0) avisarTalonario('already_paid', true);
    else registrar('already_paid', true);
  });
  botones.guest.addEventListener('click', () => registrar('guest', false));

  /** Paso 1: la única pregunta del flujo. */
  /** @param {Metodo} metodo */
  function preguntarEntrada(metodo) {
    const sinTalonario = estado.totales.entradasRestantes <= 0;

    const contenido = el('div.sheet-contenido',
      el('div.sheet-botones',
        boton('button.btn-sheet.btn-sheet-si', {
          text: 'Sí, traía entrada',
          onClick: () => (sinTalonario ? avisarTalonario(metodo, true) : registrar(metodo, true))
        }),
        boton('button.btn-sheet.btn-sheet-no', {
          text: 'No traía',
          onClick: () => registrar(metodo, false)
        })
      )
    );

    openSheet('¿Traía entrada?', contenido);
  }

  /**
   * Paso 2, solo cuando el talonario ya no da para más. Avisa, pide nota y
   * deja continuar. Nunca bloquea: nadie se queda fuera por culpa de la app.
   */
  /**
   * @param {Metodo} metodo
   * @param {boolean} hasTicket
   */
  function avisarTalonario(metodo, hasTicket) {
    const nota = input('input.campo', {
      type: 'text',
      maxLength: 200,
      placeholder: 'Ej.: entrada repetida, la trajo un amigo…',
      'aria-label': 'Nota'
    });

    const confirmar = boton('button.btn-sheet.btn-sheet-peligro', {
      text: 'Registrar igualmente',
      disabled: true,
      onClick: () => registrar(metodo, hasTicket, nota.value.trim())
    });

    nota.addEventListener('input', () => {
      confirmar.disabled = nota.value.trim().length === 0;
    });

    const contenido = el('div.sheet-contenido',
      el('div.aviso',
        el('p.aviso-titulo', { text: 'Hay más entradas de las repartidas' }),
        el('p.aviso-texto', { text: 'El talonario en circulación ya está agotado. Escribe qué ha pasado y sigue adelante.' })
      ),
      nota,
      el('div.sheet-botones',
        confirmar,
        boton('button.btn-sheet.btn-sheet-no', { text: 'Cancelar', onClick: () => closeSheet() })
      )
    );

    openSheet('Atención', contenido);
    setTimeout(() => nota.focus(), 50);
  }

  /**
   * @param {Metodo} metodo
   * @param {boolean} hasTicket
   * @param {string|null} [nota]
   */
  function registrar(metodo, hasTicket, nota = null) {
    if (estado.evento && estado.evento.closedAt) {
      closeSheet();
      toast('Caja cerrada. Habla con tesorería.');
      return;
    }

    const id = store.addEntry({ method: metodo, hasTicket, note: nota });

    closeSheet();
    vibrar(30);

    toast(CONFIRMACION[metodo], {
      accion: 'Deshacer',
      alAccionar: () => {
        store.setVoided(id, true);
        toast('Registro anulado', { ms: 2500 });
      }
    });
  }

  return function desmontar() {
    desuscribir();
    document.body.classList.remove('modo-puerta');
    vista.remove();
  };
}

# Taquilla

PWA de una sola página para la taquilla de un concierto: control de acceso en la
puerta y cuadre de caja para el tesorero. Sin backend propio, sin build step, sin
bundler y sin framework. HTML, CSS y JavaScript modular nativo, con Firestore
como única capa de persistencia y sincronización.

Dos pantallas, cada una en un móvil distinto:

- **Puerta** (`#e=<eventId>&r=door`): cuatro botones y un contador. No muestra
  dinero.
- **Tesorería** (`#e=<eventId>&r=desk`): facturado, reparto, talonario,
  configuración, movimientos y cierre de caja.

No hay login ni contraseña: el `eventId` de la URL, aleatorio de 20 caracteres,
es la llave. Quien tenga el enlace, entra.

---

## Puesta en marcha

### 1. Crear el proyecto en Firebase

1. Entra en <https://console.firebase.google.com> y pulsa **Agregar proyecto**.
2. Ponle nombre. Puedes desactivar Google Analytics: no hace falta.

### 2. Activar Firestore

1. En el menú lateral, **Compilación > Firestore Database > Crear base de datos**.
2. Elige **modo de producción** (las reglas las pones tú en el paso 5) y la
   región más cercana (`eur3` si estás en España).

### 3. Activar la autenticación anónima

1. **Compilación > Authentication > Comenzar**.
2. Pestaña **Sign-in method > Anónimo > Habilitar > Guardar**.

Sin este paso, las reglas rechazan todas las escrituras.

### 4. Pegar la configuración

1. **Configuración del proyecto** (rueda dentada) **> Tus apps > Web** (`</>`).
2. Registra la app y copia el objeto `firebaseConfig`.
3. Pega los valores en [`firebase-config.js`](firebase-config.js), sustituyendo
   los `PEGA_AQUI_…`.

La `apiKey` es pública y es correcto que lo sea: identifica al proyecto, no
autoriza nada por sí sola. La seguridad vive en las reglas.

### 5. Desplegar las reglas

Copia el contenido de [`firestore.rules`](firestore.rules) en
**Firestore Database > Reglas** y pulsa **Publicar**. El propio archivo explica
también cómo hacerlo con la CLI.

Resumen de lo que hacen: lectura y escritura para cualquier sesión anónima que
conozca el `eventId`, validación de tipos, `update` de una entry solo si el único
campo que cambia es `voided`, `update` del evento solo mientras la caja siga
abierta, y `delete` prohibido en todo.

### 6. Publicar en GitHub Pages

1. Sube el repo a GitHub.
2. **Settings > Pages > Build and deployment**: source **Deploy from a branch**,
   rama `main` (o la que uses) y carpeta `/ (root)`.
3. Espera un minuto y abre `https://<usuario>.github.io/<repo>/`.

Todas las rutas del proyecto son relativas (`./`), así que funciona en una
subruta sin tocar nada.

### 7. Antes del concierto

1. Abre la app, rellena nombre, fecha, precio, corte del bar y **entradas
   repartidas**, y pulsa **Crear evento**.
2. Guarda los dos enlaces. El de puerta lleva un QR: escanéalo con el móvil que
   va a estar en la entrada.
3. En Tesorería, apunta cuántas entradas del talonario ya cobraste por
   adelantado (en efectivo y por bizum). De ahí sale el **pendiente de cobro**.
4. Instala la app en ambos móviles ("Añadir a pantalla de inicio") para que
   arranque a pantalla completa y con la caché ya caliente.

---

## Cómo se usa en la puerta

Cuatro botones y como mucho dos toques por persona:

| Botón | Qué registra | Dinero en puerta | Entrada física |
|---|---|---|---|
| **Efectivo** | `cash` | + precio | pregunta |
| **Bizum** | `bizum` | + precio | pregunta |
| **Ya pagada** | `already_paid` | 0 € | sí |
| **Invitado** | `guest` | 0 € | no |

"Ya pagada" suma persona y no suma dinero porque ese cobro ya está contado en el
talonario de preventa. "Invitado" es banda, personal del bar y gente de la casa.

Tras cada registro hay vibración, el contador salta y aparece un toast con
**Deshacer** durante cinco segundos. Pasado ese tiempo, se anula desde
Tesorería: los borrados son lógicos y nada desaparece de la lista.

Cuando el talonario en circulación se agota y alguien llega con entrada física,
la app avisa en rojo y pide una nota corta, pero **nunca bloquea el registro**.
Si dejas `entradas repartidas` a 0, ese aviso salta con cada entrada física: es
lo esperado, porque significa que hay papel que no salió de tus manos.

### Sin cobertura

La persistencia local de Firestore está activada. Sin red, los registros se
guardan en el móvil y se envían solos al recuperar señal; una barra fina lo
indica. Se puede seguir registrando gente toda la noche sin conexión.

## Cómo cuadra la caja

```
ingresosPreventa = (tickets.soldCash + tickets.soldBizum) * price
ingresosPuerta   = (nº entries cash + nº entries bizum) * price
facturado        = ingresosPreventa + ingresosPuerta

efectivoTotal = tickets.soldCash * price + (nº entries cash) * price
bizumTotal    = tickets.soldBizum * price + (nº entries bizum) * price

corteBar  = facturado * (barPct / 100)
paraBanda = facturado - corteBar

entradasEnCirculacion = tickets.delivered - tickets.returned
entradasRestantes     = entradasEnCirculacion - (nº entries con hasTicket)
pendienteDeCobro      = (delivered - returned - soldCash - soldBizum) * price
```

Todo se calcula en el cliente sumando la subcolección completa en tiempo real.
Las entries anuladas se ignoran siempre. Cambiar el precio o el porcentaje
recalcula al instante en los dos móviles.

**Pendiente de cobro** es el talonario repartido que nadie ha pagado todavía. Es
la cifra que más dinero salva y por eso va la primera en su tarjeta, en ámbar
cuando es mayor que cero.

Al cerrar la caja se escribe `closedAt`, la app pasa a solo lectura en ambos
dispositivos y el CSV (movimientos + resumen, separador `;` y BOM para Excel en
español) se puede descargar antes y después.

---

## Modelo de datos

```
events/{eventId}
  name, date, price, barPct
  tickets: { delivered, soldCash, soldBizum, returned }
  createdAt, closedAt

events/{eventId}/entries/{autoId}
  ts, method: 'cash'|'bizum'|'already_paid'|'guest', hasTicket, note, voided
```

- `delivered`: talonario que salió de las manos del tesorero, vendido o no.
- `soldCash` / `soldBizum`: talonario **ya cobrado antes del evento**. Es el
  único sitio donde vive el dinero de la preventa.
- `returned`: talonario sobrante que vuelve.
- `hasTicket` es ortogonal al método de pago: se puede traer entrada física y
  pagarla en la puerta.

Las marcas de tiempo son de cliente, no `serverTimestamp()`, para que un registro
hecho sin cobertura tenga hora y orden desde el primer momento en lugar de llegar
vacío a la caché local.

## Estructura

```
index.html            arranque y hosts de toast y bottom sheet
app.js                router de hash, pantallas de arranque y utilidades de UI
store.js              única capa que habla con Firestore
calc.js               cálculos del cuadre: funciones puras, sin Firestore ni DOM
views/door.js         vista de puerta
views/desk.js         vista de tesorería
qr.js                 generador de QR propio (modo byte, nivel M, versiones 1-10)
styles.css            sistema visual
firebase-config.js    lo único que hay que rellenar
manifest.webmanifest  PWA
sw.js                 service worker
firestore.rules       reglas de seguridad
icons/                iconos 192, 512 y maskable
tests/                unitarios, de navegador y el doble del SDK
types/                declaraciones para los módulos que vienen por CDN
```

`calc.js` está separado de `store.js` a propósito: al no importar nada de
Firebase se puede testear en Node directamente, sin navegador y sin mocks.
`store.js` lo reexporta, así que las vistas siguen viendo una única superficie.

Las vistas no hablan con Firestore: reciben el store y llaman a sus acciones.
Ninguna escritura espera confirmación del servidor, porque sin red esa promesa no
se resuelve y la puerta se quedaría congelada; la caché local ya tiene el dato y
el listener dispara al instante.

El QR se genera en el repo, sin CDN ni API de imágenes: en el bar puede no haber
red cuando lo necesites.

## Desarrollo

`package.json` y `node_modules/` son **solo para desarrollar**. Lo que se
publica en GitHub Pages son los archivos del repo tal cual: la app no tiene
build step, ni bundler, ni dependencias en tiempo de ejecución más allá del SDK
de Firebase por CDN.

```bash
npm install     # herramientas de desarrollo
npm test        # linter + tipos + unitarios + navegador
```

Por partes:

| Comando | Qué hace |
|---|---|
| `npm run lint` | ESLint sobre app, service worker y tests |
| `npm run typecheck` | TypeScript en modo `checkJs` sobre los tres proyectos |
| `npm run test:unit` | Cálculos, CSV, QR y empaquetado (Node, sin navegador) |
| `npm run test:e2e` | Chromium real, dos pestañas, SDK sustituido por un doble |

### Tipos sin TypeScript

El código es JavaScript y se sirve sin compilar, pero está anotado con JSDoc y
se comprueba con `tsc --checkJs`. Se tipa igual y lo que corre en el móvil es
exactamente lo que hay en el repo: a las 21:50 en un bar, eso importa.

Los módulos de Firebase se importan por URL, que TypeScript no sabe resolver.
`types/firebase-cdn.d.ts` mapea esas URLs al paquete npm, clavado a la misma
versión. **Si subes la versión de la URL en `store.js`, sube también la de
`package.json`**: hay un test que lo comprueba.

### Qué cubren los tests

- **Cálculos** (`tests/unit/calc.test.js`): la semántica completa del cuadre.
  Que "ya pagada" e "invitado" sumen persona y cero euros, que las anuladas se
  ignoren, que `hasTicket` sea ortogonal al método de pago, y un barrido de
  precios y porcentajes comprobando que bar + banda siempre suman el facturado
  sin perder céntimos.
- **CSV** (`tests/unit/csv.test.js`): BOM, separadores, escapado de notas con
  punto y coma, orden cronológico e importes.
- **QR** (`tests/unit/qr.test.js`): las diez versiones **decodificadas con un
  lector real**, más los patrones de la especificación.
- **Empaquetado** (`tests/unit/pwa.test.js`): que el manifest sea válido, que
  las rutas sean relativas, que las reglas prohíban borrar y —el que más
  disgustos evita— que `sw.js` precachee todos los módulos. Si añades un
  archivo y olvidas meterlo ahí, la app instalada deja de abrir sin cobertura;
  este test lo caza antes de llegar al bar.
- **Versión** (`tests/unit/version.test.js`): que el hash sea estable, que
  cambie al cambiar un byte, que no dependa de sí mismo, que todo módulo que la
  app importa esté en la lista de publicados y que el service worker no se
  active solo.
- **Errores** (`tests/unit/errores.test.js`): que cada código de Firestore
  produzca pasos accionables y que ningún mensaje se disculpe.
- **Navegador** (`tests/e2e/`): los criterios de aceptación, con la puerta y
  tesorería abiertas a la vez y sincronizando en vivo, más el cambio de puesto,
  la agenda de eventos y el camino de actualización completo.

### Lo que los tests NO cubren

La cola de escrituras offline es del SDK de Firestore, y en los tests el SDK
está sustituido por un doble. `tests/e2e/offline.test.js` comprueba nuestra
parte (avisar sin estorbar, no bloquear el registro), pero **que tres entradas
hechas en modo avión lleguen al recuperar señal hay que probarlo en un móvil
real**. Es el punto que más probablemente falle en el bar.

Tampoco se ejecutan las reglas de Firestore: se comprueba su contenido, no su
comportamiento. Para eso haría falta el emulador de Firebase.

## Versiones y actualizaciones

La app enseña su versión abajo del todo: en la pantalla de arranque, en
tesorería, y en la puerta dentro del panel de "cambiar de puesto". El formato es
`v1.0.0 · 423eef544b75`: número de `package.json` y hash del contenido
publicado.

### Al publicar cambios

```bash
npm run version   # regenera version.js y el nombre de caché de sw.js
git commit -am "..."
git push
```

Y ya. **No hay ningún número que subir a mano.** El hash sale del contenido real
de todo lo que se sirve, así que cambiar un byte cambia el nombre de la caché.
Si se te olvida ejecutarlo, `npm test` y CI fallan con el comando exacto que
tienes que correr.

Para cambiar el número visible, sube la `version` de `package.json` y regenera.

### Qué pasa en el móvil que ya tiene la app instalada

1. Al abrir la app, el navegador comprueba `sw.js`. Como el nombre de la caché
   lleva el hash, un despliegue nuevo produce un `sw.js` distinto byte a byte y
   la actualización se detecta. Sin ese hash, editar `app.js` sin tocar `sw.js`
   dejaría al móvil con la versión vieja **para siempre**: es el fallo clásico
   de las PWA y por eso se genera.
2. El service worker nuevo precachea todo con `cache: 'reload'`, que salta la
   caché HTTP del navegador. GitHub Pages sirve con `max-age`, así que sin eso
   se podrían guardar los bytes viejos de archivos que acaban de cambiar.
3. Si algún archivo falla al descargarse, la instalación entera falla y se
   conserva la versión anterior, que funcionaba. Nunca queda una caché a medias.
4. La versión nueva **no entra sola**: se queda en espera y la app enseña un
   aviso con un botón "Actualizar". Recargar por sorpresa a quien está contando
   gente en la puerta sería peor que pasar la noche con la versión anterior.
5. Al aceptar, el service worker nuevo toma el relevo, borra las cachés
   anteriores y la página se recarga una sola vez.

Todo esto lo comprueba [`tests/e2e/actualizacion.test.js`](tests/e2e/actualizacion.test.js),
que despliega la app en un directorio temporal, la instala, publica encima una
versión nueva y verifica cada paso: que se avisa, que hasta aceptar sigue
mandando la versión anterior, que la caché nueva trae los bytes nuevos y no los
que había en la caché HTTP, que la vieja se borra, y que después sigue abriendo
sin red.

## Licencia

Todos los derechos reservados. Código propietario de Arnaldo Quintero. No se
concede licencia de uso, copia, modificación ni distribución.

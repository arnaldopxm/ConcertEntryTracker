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
store.js              única capa que habla con Firestore + todos los cálculos
views/door.js         vista de puerta
views/desk.js         vista de tesorería
qr.js                 generador de QR propio (modo byte, nivel M, versiones 1-10)
styles.css            sistema visual
firebase-config.js    lo único que hay que rellenar
manifest.webmanifest  PWA
sw.js                 service worker
firestore.rules       reglas de seguridad
icons/                iconos 192, 512 y maskable
```

Las vistas no hablan con Firestore: reciben el store y llaman a sus acciones.
Ninguna escritura espera confirmación del servidor, porque sin red esa promesa no
se resuelve y la puerta se quedaría congelada; la caché local ya tiene el dato y
el listener dispara al instante.

El QR se genera en el repo, sin CDN ni API de imágenes: en el bar puede no haber
red cuando lo necesites.

## Al publicar cambios

Sube el número de versión de la caché en [`sw.js`](sw.js) (`const CACHE =
'taquilla-v1'`). Si no, los móviles que ya tienen la app instalada seguirán
sirviendo la versión vieja.

## Licencia

Todos los derechos reservados. Código propietario de Arnaldo Quintero. No se
concede licencia de uso, copia, modificación ni distribución.

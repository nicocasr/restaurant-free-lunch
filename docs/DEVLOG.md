# Jornada de Almuerzo Gratis — Bitácora de desarrollo

> Cómo evolucionó el proyecto: qué se construyó en cada fase, qué encontraron las pruebas y qué
> se cambió por ello. Las decisiones vigentes están en [PLANNING.md](PLANNING.md) y el diseño
> actual en [ARCHITECTURE.md](ARCHITECTURE.md).

Cada hallazgo sigue la misma forma: **qué se vio**, **la causa** y **la corrección**, con su
medición cuando la hubo.

---

## Fases

### 15-16/10 — Análisis, setup y contratos

- Se escribió y aprobó el plan antes de la primera línea de código (v1.0).
- Monorepo con npm workspaces, TypeScript strict, ESLint, Prettier, Jest y CI en GitHub Actions.
- Contratos de los eventos en `packages/contracts`, validados con zod.

**Antes de escribir código, el plan se refinó cuatro veces** al recorrer los casos difíciles:

| Se vio                                                                                     | Corrección                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| R4 ("la bodega inicia siempre con 5") choca con la persistencia                            | Concepto de **jornada** (v1.1)                                        |
| `StockShortage` es por ingrediente: no dice qué pedido espera ni qué le falta              | Nuevo evento `OrderWaitingIngredients` (v1.2)                         |
| Los tipos de TypeScript no existen en ejecución                                            | Validación con zod en cada frontera (v1.3)                            |
| Si el proceso muere entre guardar y publicar, un duplicado "ya procesado" no publicaría nada | Ante un duplicado, **republicar** el evento resultante (v1.4)        |

### 17/10 — Dominio con TDD

Los tests de warehouse y market sacaron a la luz casos que el plan no cubría:

| Se vio (al escribir el test)                                                                                                                 | Corrección                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Un Ajiaco espera cebolla; mientras tanto otros pedidos gastan la papa que sí había, y nadie la compra: el pedido queda atascado para siempre | La espera suma a la demanda **todos** los ingredientes del pedido (v1.5)    |
| Tres Changuas seguidas emitían tres faltantes de 1 cebolla; market compraba los tres aunque el primero ya trajera suficiente                 | **Un solo faltante activo por ingrediente** (v1.6)                           |
| Si el proceso muere entre fijar `inFlight` y publicar el faltante, nadie vuelve a pedir la compra                                           | El faltante se guarda **pendiente** y se republica (v1.6)                    |
| Si muere entre sacar un pedido de la espera y avisar a la cocina, el plato se pierde                                                         | La reserva se guarda **pendiente de publicar** (v1.7)                        |
| Una compra en curso al cerrar la jornada entraría al stock de la siguiente                                                                    | La nueva jornada reinicia la demanda e ignora compras atrasadas (v1.8)      |
| Los reintentos de varios ingredientes llegaban a la plaza en el mismo instante                                                               | *Backoff* con **full jitter** (v1.10)                                        |
| Dormir dentro de la Lambda para reintentar se paga por segundo y choca con su límite de 15 minutos                                           | Los reintentos los hace la **cola** con `ChangeMessageVisibility` (v1.11)   |

### 18/10 — Adaptadores y Docker local

- Adaptadores de DynamoDB, SNS, SQS y la plaza, con pruebas de integración contra LocalStack. Los
  repositorios pasan el mismo contrato de pruebas con los fakes y con DynamoDB.
- Dockerfile por servicio y `docker compose up` con el flujo completo.

| Se vio                                                                                                    | Corrección                                                                       |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Un lote de 1000 platos no cabe en una transacción (máximo 100 ítems)                                       | El lote guarda sus `orderId` y los pedidos se escriben "si no existe" (v1.12)   |
| `WorkdayStarted` puede llegar a warehouse **después** de un pedido de la jornada nueva                    | Warehouse solo atiende pedidos de una jornada que ya inició (v1.13)             |
| LocalStack 2026.03 empezó a exigir cuenta y *auth token*                                                  | Versión fijada en **4.14.0**, la última que arranca sin registro (v1.14)        |
| AWS no permite suscribir una cola FIFO a un topic estándar                                                | Segundo topic `shortages.fifo` solo para `StockShortage` (v1.14)                |
| Listar los pedidos de una jornada con *scan* no escala                                                    | Pedidos en 10 particiones por jornada y un contador de pedidos en curso (v1.15) |

#### Prueba de usuario: compras duplicadas y lentas (v1.17)

**Se vio:** con 50 platos, los pedidos pasaban mucho tiempo esperando ingredientes y la bodega
terminó con **83 cebollas de sobra**: se pidió comprar 48 y se compraron **158**.

**Causa:**

- Una compra grande (97 papas ≈ 40 llamadas, más esperas por los `0`) **superaba los 30 s de
  visibilidad** del mensaje: SQS la daba por perdida y se la entregaba a un **segundo comprador**.
- Una cola FIFO puede entregar varios mensajes del mismo grupo en un lote, y se procesaban en paralelo.
- Cada comprador **sobrescribía** el progreso con su propio total.

Los tests no lo detectaban porque usaban compras pequeñas, que nunca llegaban a los 30 s.

**Corrección:**

1. **Compras por tramos** de ~10 s: ninguna entrega supera la visibilidad.
2. **El consumidor respeta los grupos FIFO:** grupos distintos en paralelo, mismo grupo en orden.
3. **Progreso por suma atómica** (`ADD`) en la misma escritura que registra cada venta.
4. **Rondas de hasta 5 llamadas en paralelo**, según lo que falte (`⌈faltante / 2,5⌉`).

Una segunda medición encontró más cuellos de botella:

| Se vio                                                                                                             | Corrección                                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Un proceso que se apagaba durante el *long polling* recibía un mensaje que ya no procesaría; quedaba oculto 30 s   | Al apagarse, cada trabajador **termina el mensaje en curso**; espera de 5 s y 30 s de margen        |
| LocalStack **no bloquea el grupo FIFO** al recibir varios mensajes en un lote, aunque AWS sí                        | Varios trabajadores que toman **un mensaje cada uno**                                              |
| Warehouse recibía un evento por cada llamada a la plaza y reevaluaba los 10 ingredientes en serie                  | Market publica **un evento por ronda** (93 → 27); warehouse evalúa solo lo necesario, en paralelo |
| Errores transitorios reintentados hasta 30 s                                                                        | Tope de 10 s                                                                                       |

**Resultado con 50 platos contra la plaza real:** sobras de 83 cebollas → **0 a 2**; errores 192 →
**0**; tiempo total 165 s → **62 s**. El límite que quedó fue LocalStack (125-145 % de CPU,
mientras los servicios estaban por debajo del 25 %).

#### Prueba de usuario: dos pedidos mezclados en una fila (v1.18)

**Se vio:** el historial del dashboard juntaba dos pedidos distintos en una sola fila.

**Causa:** realtime, desplegado con el contrato anterior, **descartaba** el campo nuevo `batchId`
de `OrderPlaced` antes de reenviarlo.

**Corrección:** los contratos son **lectores tolerantes** (conservan los campos que no conocen), y
la regla de versiones quedó explícita: agregar un campo opcional no cambia la versión.

### 18-19/10 — Realtime y dashboard

- WebSocket con `ws` en local; el dashboard carga los datos de cada servicio y aplica los eventos (v1.16).
- Las pruebas de usuario ajustaron la interfaz:
  - compras como una sola tabla siempre visible (cuántas compras y cuántas unidades por ingrediente);
  - historial como tabla resumen por pedido, con **todos** los platos servidos y sus cantidades;
  - el aviso del pedido se borra al cambiar la cantidad.

### 19/10 — AWS

- Adaptadores Lambda para cada servicio, que reutilizan las mismas reglas que el contenedor.
- Un `serverless.yml` por servicio, el stack compartido `infra/aws`, el dashboard en S3 + CloudFront
  y `npm run deploy:aws` para desplegarlo todo.

| Se vio                                                                                                              | Causa                                                                                         | Corrección                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Toda llamada en `us-east-1` era rechazada                                                                            | La organización del plan gratuito solo permite `us-east-2`                                    | Todo en `us-east-2` (v1.20)                                                                      |
| La alerta de presupuesto nunca avisaría                                                                              | Por defecto descuenta los créditos: la factura neta siempre es US$0                           | La alerta cuenta el consumo **sin créditos** (v1.20)                                             |
| La cuenta nueva solo permitía 10 Lambdas a la vez                                                                   | Límite inicial de las cuentas nuevas                                                          | Cada cola limitada a 2 mientras AWS aprobaba la ampliación a 1000 (v1.20)                       |
| "The kitchen did not answer" al pedir desde el dashboard en AWS                                                      | CORS solo permitía `content-type`, y el pedido envía `Idempotency-Key`                        | El HTTP API permite ese encabezado                                                               |
| Los últimos eventos de un pedido llegaban al dashboard **~20 s tarde**; el backend ya había entregado todo            | La cola de realtime tenía ventana de agrupación: con poco tráfico, el resto esperaba la siguiente consulta | Lotes de hasta 10 sin ventana: los eventos llegan en **~0,2 s** (v1.21)                        |
| Serverless Compose no podía desplegar                                                                                | Guarda su estado a través de `us-east-1`                                                      | Un script despliega los stacks en orden; los servicios leen las salidas con `${cf:...}` (v1.22) |
| Cualquier sitio podía llamar al API desde un navegador                                                               | CORS con `*`                                                                                  | Solo el dominio del dashboard (v1.22)                                                            |
| AWS aprobó 1000 Lambdas a la vez                                                                                     | —                                                                                             | 10 ejecuciones reservadas por Lambda y hasta 10 por cola (v1.23)                                 |
| Serverless advertía que la Lambda HTTP de market podía agotar los 30 s del API                                      | Heredaba el *timeout* de 30 s de la compra                                                    | 10 s para la consulta                                                                            |

### 19/10 — Calidad

- `npm run e2e` en local, en AWS y en el CI; `npm run load` con Artillery; README y ARCHITECTURE.

| Se vio                                                                                     | Causa                                                                                              | Corrección                                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Una prueba del consumidor FIFO falló en el CI y no en local                                | Solo detectaba el paralelismo si la papa **empezaba** durante una cebolla, no al revés              | Detecta la superposición en cualquier orden                             |
| Avisos del SDK en cada prueba de integración de SQS                                        | LocalStack responde las URLs de las colas con su propio dominio                                     | Las pruebas usan siempre el endpoint configurado                        |
| El aviso "50 dishes sent to the kitchen" seguía tras "New workday"                         | El formulario conservaba su estado entre jornadas                                                   | El formulario se reinicia con cada jornada                              |
| El inventario mostraba "+1 on its way" con todos los platos entregados; el backend tenía 0 | La compra llega al dashboard y a warehouse a la vez: la relectura del inventario podía adelantarse | Una lectura más 1 s después del último cambio                           |
| Al repetir la carga con la cuota ampliada, 40 platos quedaron **46 s detenidos**, sin errores y sin ninguna Lambda ejecutándose | Warehouse llegó a su tope de 10 Lambdas y su cola entregó 19 mensajes habiendo recibido solo 3: lo más probable es que AWS tomara mensajes que no alcanzó a pasarle a la Lambda, y quedaron ocultos los 60 s de visibilidad de la cola | Visibilidad de 60 a 20 s en las colas estándar, y **20 Lambdas** para la cola de warehouse, por donde pasan todos los platos y las compras (v2.1) |

**Resultados en AWS:**

| Prueba                     | Resultado                                                                        |
| -------------------------- | -------------------------------------------------------------------------------- |
| End-to-end, 3 platos       | entregados en 7 s                                                                |
| Carga, 200 platos a la vez | 20/20 lotes aceptados, p95 de 400 ms; todos entregados en 1 min 48 s, con 10 Lambdas en la cuenta |
| Colas de mensajes inválidos | vacías                                                                          |
| Stock sobrante             | 0 a 2 unidades por ingrediente                                                   |
| Créditos                   | centavos por prueba; ningún cobro                                                |

---

## Versiones del plan

| Versión | Fecha      | Cambio                                                                                                                                                         |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 16/10/2026 | Planificación inicial aprobada                                                                                                                                 |
| 1.1     | 16/10/2026 | Origen y justificación de las jornadas (no forman parte del enunciado). Se retira el riesgo del free tier de AWS                                              |
| 1.2     | 16/10/2026 | Nuevo evento `OrderWaitingIngredients`: `StockShortage` es por ingrediente, así que no sirve para marcar qué pedido espera ni qué le falta                     |
| 1.3     | 16/10/2026 | Justificación de la validación en tiempo de ejecución con zod                                                                                                 |
| 1.4     | 16/10/2026 | Ante un duplicado, el handler **republica** el evento resultante                                                                                               |
| 1.5     | 17/10/2026 | El pedido en espera suma a `waitingNeed` **todos** sus ingredientes, no solo los faltantes                                                                     |
| 1.6     | 17/10/2026 | **Un faltante activo por ingrediente**; el faltante se guarda como pendiente junto con `inFlight` y se republica hasta publicarse                              |
| 1.7     | 17/10/2026 | La reserva de un pedido que sale de la espera se guarda como **pendiente de publicar**                                                                         |
| 1.8     | 17/10/2026 | La nueva jornada reinicia los contadores de demanda, y warehouse ignora las compras atrasadas de jornadas anteriores                                          |
| 1.9     | 17/10/2026 | El catálogo de recetas de kitchen vive en el código, no en su tabla                                                                                           |
| 1.10    | 17/10/2026 | El backoff de market usa **full jitter**                                                                                                                       |
| 1.11    | 17/10/2026 | Los reintentos de market los hace la cola, con la DLQ sin `maxReceiveCount` y esperas en segundos enteros                                                      |
| 1.12    | 18/10/2026 | El lote guarda sus `orderId` y los pedidos se escriben "si no existe"; `correlationId` = `orderId`                                                              |
| 1.13    | 18/10/2026 | La jornada nueva queda pendiente de publicar; dos clics simultáneos reciben la misma jornada; warehouse solo atiende pedidos de la jornada que ya inició       |
| 1.14    | 18/10/2026 | LocalStack fijado en 4.14.0. Segundo topic `shortages.fifo`, filtros por `type` y colas sin `maxReceiveCount`                                                  |
| 1.15    | 18/10/2026 | Pedidos agrupados por jornada en 10 particiones y contador de pedidos en curso por jornada                                                                    |
| 1.16    | 18/10/2026 | API de consulta en cada servicio dueño para el dashboard; realtime envía eventos y el inventario se vuelve a consultar                                         |
| 1.17    | 18/10/2026 | Hallazgo de la prueba de usuario (compras duplicadas y lentas) y sus correcciones                                                                              |
| 1.18    | 18/10/2026 | Los contratos son lectores tolerantes y regla de evolución de versiones                                                                                       |
| 1.19    | 19/10/2026 | Cuenta de AWS con el plan gratuito y medidas para cuidar los créditos                                                                                          |
| 1.20    | 19/10/2026 | Región `us-east-2`; la alerta de Budgets excluye los créditos; límite de Lambdas por cola mientras se amplía la cuota                                           |
| 1.21    | 19/10/2026 | En AWS, realtime envía lotes de hasta 10 eventos sin ventana de agrupación                                                                                     |
| 1.22    | 19/10/2026 | CORS solo para el dominio del dashboard; un script despliega los stacks en orden en lugar de Serverless Compose                                               |
| 1.23    | 19/10/2026 | AWS amplió la cuota de Lambda a 1000; cada función reserva 10 ejecuciones y cada cola dispara hasta 10                                                         |
| 2.0     | 19/10/2026 | El plan se divide en tres documentos: PLANNING (qué y por qué), ARCHITECTURE (cómo) y este DEVLOG (el camino)                                                 |
| 2.1     | 19/10/2026 | La cola de warehouse reserva 20 Lambdas; las colas estándar devuelven en 20 s los mensajes que no alcanzaron a entregarse                                      |

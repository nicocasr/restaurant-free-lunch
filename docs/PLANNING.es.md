# Jornada de Almuerzo Gratis — Planificación

> Qué se quiere lograr, qué se decidió y por qué, y el plan de trabajo. Se escribió **antes de
> la primera línea de código** y se actualizó con lo aprendido en el camino.
>
> - **Cómo está construido:** [ARCHITECTURE.es.md](ARCHITECTURE.es.md).
> - **Cómo evolucionó** (cada versión de este plan, lo que encontraron las pruebas y lo que se
>   cambió por ello): [DEVLOG.es.md](DEVLOG.es.md).
> - **English version:** [PLANNING.md](PLANNING.md).

---

## 1. Entendimiento del problema

Un restaurante regala almuerzos durante una jornada masiva. Hoy el flujo es manual:

```
Gerente presiona botón → Cocina elige receta al azar → pide ingredientes a la Bodega
→ si faltan, la Bodega compra en la Plaza de mercado → Cocina prepara y entrega
```

**Objetivo:** automatizar el flujo al 100%. Debe soportar miles de comensales y permitir
que el gerente, que no es técnico, vea la operación en tiempo real.

### Reglas de negocio (del enunciado)

| #   | Regla                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------ |
| R1  | El gerente pide **X platos** con un botón.                                                                               |
| R2  | Cada plato recibe una receta **aleatoria** entre 6.                                                                      |
| R3  | Cada receta usa ingredientes de: tomato, lemon, potato, rice, ketchup, lettuce, onion, cheese, meat, chicken.            |
| R4  | La bodega **inicia con 5 unidades** de cada ingrediente.                                                                 |
| R5  | Si falta stock, se compra en la plaza (`GET https://recruitment.alegra.com/api/farmers-market/buy?ingredient=<name>`).   |
| R6  | La plaza responde `{ quantitySold }`. Si es `0` no hay disponibilidad; la compra es exitosa si es un entero > 0.         |
| R7  | El plato se entrega **solo cuando están todos sus ingredientes**; al prepararlo, se descuentan del inventario.           |

### Requisitos no funcionales

- Microservicios en Node.js + TypeScript, **sin Express/Nest ni frameworks similares**.
- Cada microservicio con su **Dockerfile**, más despliegue **Serverless** (PLUS).
- **Persistencia** que sobreviva reinicios.
- **Escalabilidad y robustez**: muchos pedidos simultáneos sin fallar.
- Despliegue público en **AWS** sin costo.
- **Bonus IA** integrado y funcional en el despliegue.

**Fechas:** reto recibido el **15/10/2026**; entrega a más tardar el **22/10/2026**.

---

## 2. Decisiones tomadas

### Tecnología y forma de trabajo

| Tema             | Decisión                                                                                         | Motivo                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Arquitectura     | **Hexagonal** (puertos y adaptadores); cada servicio corre en Docker (local) y en Lambda (nube)  | Cumple Docker y Serverless con el mismo núcleo de dominio: solo cambian los *entrypoints*    |
| Lenguaje         | TypeScript (strict)                                                                              | Seguridad de tipos y mejor soporte para TDD                                                  |
| Runtime          | Node.js 24 LTS (`nodejs24.x` en Lambda)                                                          | La versión más reciente que soporta Lambda; la misma en local, Docker y nube                 |
| Monorepo         | npm workspaces                                                                                   | Viene con Node, sin herramientas extra                                                       |
| HTTP             | Módulo nativo `node:http` con un router mínimo propio                                            | El reto prohíbe Express, Nest y similares                                                    |
| WebSocket local  | Librería `ws` sobre `node:http`                                                                  | Librería sin dependencias, no un framework; en AWS se usa API Gateway WebSocket              |
| Validación       | zod (librería, no framework)                                                                     | Valida en ejecución lo que entra de afuera (ver §3.6)                                        |
| Frontend         | React + Vite                                                                                     | —                                                                                            |
| Testing          | Jest (+ ts-jest) con TDD                                                                         | Red → Green → Refactor en dominio y casos de uso                                             |
| Prueba de carga  | Artillery                                                                                        | Escenarios en YAML; corre sobre Node                                                         |
| Calidad          | ESLint + Prettier                                                                                | Estilo consistente y verificado en CI                                                        |
| CI               | GitHub Actions: formato, lint, tipos, tests, build, integración y E2E sobre los contenedores    | Valida cada push automáticamente                                                             |
| Commits          | Conventional Commits; `test:` (rojo) y `feat:` (verde) por separado                              | El ciclo TDD queda visible en el historial de Git                                            |
| Idioma           | **Inglés** en código, documentación, commits e interfaz                                          | Estándar en equipos. Todos los documentos existen también en español                         |
| Repositorio      | `alegra-lunch` (privado)                                                                         | —                                                                                            |
| IA               | Asistente operativo conversacional con **Gemini** (free tier)                                    | Costo cero; responde con datos reales del sistema (ver §5)                                   |
| Menú             | 6 platos bogotanos (ver §4)                                                                      | —                                                                                            |

### Infraestructura

| Tema                 | Decisión                                                                                                                                         | Motivo                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bus de eventos       | **SNS → SQS** (fan-out), una cola por servicio con DLQ                                                                                           | Publicar una vez y que cada consumidor tenga su cola; agregar consumidores no modifica al productor (ver §3.2)                                                                                                         |
| Base de datos        | DynamoDB on-demand, **una tabla por servicio**                                                                                                  | Escala sola, sin servidores ni capacidad que administrar; cada servicio es dueño de sus datos                                                                                                                           |
| IaC / despliegue     | Serverless Framework **v4**: un `serverless.yml` por servicio más el stack compartido `infra/aws`; `npm run deploy:aws` los despliega en orden | Mencionado en el reto. No se usa Serverless Compose (la herramienta para desplegar varios servicios juntos): no funciona con las restricciones de región de la cuenta ([DEVLOG](DEVLOG.es.md)), y no hace falta, porque cada servicio lee de CloudFormation lo que necesita del stack compartido |
| Emulación local      | LocalStack **4.14.0** (SQS, SNS, DynamoDB), versión fijada                                                                                       | Mismos adaptadores en local y en la nube. Las versiones posteriores exigen cuenta y *auth token*; la 4.14.0 es la última que arranca sin token, así que los reviewers corren `docker compose up` sin registrarse (§9) |
| Tiempo real          | API Gateway WebSocket                                                                                                                            | El servidor empuja cada cambio al instante                                                                                                                                                                              |
| Dashboard en AWS     | S3 privado + CloudFront                                                                                                                          | HTTPS y la capa siempre gratis de CloudFront                                                                                                                                                                            |
| Cuenta de AWS        | Cuenta con el **plan gratuito** (`FREE`, créditos hasta el 19/04/2027), en `us-east-2`                                                          | El plan gratuito **no puede generar facturas**: si los créditos se agotaran, la cuenta se pausa. La organización de la cuenta solo permite `us-east-2`                                                                  |

### Costo cero

Que los créditos duren y que un abuso no pueda agotarlos (eso pausaría la cuenta durante la evaluación):

- sin VPC ni NAT Gateway; DynamoDB on-demand sin PITR ni streams; sin X-Ray;
- logs con retención de 7 días;
- *reserved concurrency* de 10 por Lambda (gratis, a diferencia de la *provisioned*) y hasta 10 Lambdas por cola; 20 para la cola de warehouse, por donde pasan todos los platos y las compras;
- *throttling* en el HTTP API (50 peticiones/s, picos de 100) y CORS solo para el dominio del dashboard;
- secretos en SSM estándar;
- alerta de AWS Budgets si el mes se proyecta sobre US$10, **sin descontar los créditos** (si los incluyera, la factura neta sería US$0 y nunca avisaría).

Costo conocido y aceptado: las Lambdas que leen SQS consultan las colas aunque no haya mensajes (~US$1,30 al mes en créditos).

### Producto

| Tema                 | Decisión                                                                                                                                                                    | Motivo                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Compras en la plaza  | **Demanda agregada por ingrediente**: la bodega solo pide comprar lo que falta, descontando el stock y lo que ya está en camino                                             | La plaza decide cuánto vende; comprar por pedido generaría compras innecesarias (§3.3)                     |
| Lista de espera      | **FIFO flexible**                                                                                                                                                           | Prioriza el throughput: si el pedido más antiguo no alcanza, se atiende al siguiente que sí (§3.3)         |
| Idempotencia         | **La base de datos es el árbitro** (escrituras condicionales)                                                                                                              | Las Lambdas no comparten memoria; solo la BD ve todos los intentos (§3.4)                                  |
| Plaza sin stock      | Reintentos **indefinidos** con *backoff* exponencial y *full jitter*, tope de **10 s**                                                                                     | La plaza eventualmente vende; el pedido espera, nunca falla                                                |
| Jornadas             | Botón **"Nueva jornada"**, solo sin pedidos en curso: reinicia la bodega a 5 y conserva el historial por jornada                                                          | Concilia "la bodega inicia con 5" con la persistencia (§3.5)                                               |
| Datos del dashboard  | Al abrirse, carga con la API de consulta **de cada servicio dueño** (`/orders`, `/inventory`, `/purchases`, `/recipes`) y luego aplica los eventos que llegan por WebSocket | Respeta que cada servicio es dueño de sus datos. Los eventos no llevan el stock completo: el inventario se vuelve a consultar |
| Envío al dashboard   | realtime agrupa los eventos (~500 ms en el contenedor; lotes de hasta 10 en AWS)                                                                                           | Para el ojo humano sigue siendo tiempo real, y no satura el navegador                                      |
| Tamaño del pedido    | Límite máximo **configurable** y validado                                                                                                                                  | Protege el sistema de pedidos absurdos                                                                     |
| Acceso               | Sin login; *rate limiting* en la API y en el asistente                                                                                                                     | Facilita las pruebas de usuario y protege la operación y la cuota de Gemini                               |
| Tiempo en espera     | El dashboard muestra, por pedido en espera, cuánto lleva esperando y qué le falta                                                                                          | Con la FIFO flexible, deja visible cualquier pedido que se demore                                          |

---

## 3. Diseño: los problemas y cómo se resuelven

El detalle de cada mecanismo está en [ARCHITECTURE.es.md](ARCHITECTURE.es.md). Aquí va el problema
que resuelve, la decisión y lo que se descartó.

### 3.1 Microservicios

Un *bounded context* por servicio y **una tabla por servicio**: ningún servicio lee ni escribe
la tabla de otro.

| Servicio      | Responsabilidad                                                          |
| ------------- | ------------------------------------------------------------------------ |
| **orders**    | API del gerente: lotes de pedidos, jornadas e historial                  |
| **kitchen**   | Elige la receta al azar, pide los ingredientes y entrega el plato        |
| **warehouse** | Inventario, reserva **atómica**, lista de espera y demanda agregada      |
| **market**    | Compra en la plaza con reintentos; historial de compras                  |
| **realtime**  | Empuja los eventos al dashboard por WebSocket                            |
| **assistant** | Asistente IA (§5)                                                        |
| **web**       | Dashboard React del gerente                                              |

### 3.2 Comunicación por eventos (coreografía)

**Problema:** si un servicio llama directo a otro, una caída o una carga alta de uno detiene a
los demás.

**Decisión:** eventos por **SNS → SQS**, con una cola por servicio consumidor. Si un consumidor
cae, sus mensajes esperan en su cola. Cada suscripción filtra por el tipo de evento.

- **Dos topics:** AWS no permite que una cola **FIFO** se suscriba a un topic estándar, y la
  cola de market es FIFO. `StockShortage` va por `shortages.fifo` y el resto por `events`.
- **Contratos versionados** en `packages/contracts`, validados al publicar y al recibir.
  Son **lectores tolerantes**: agregar un campo opcional no cambia la versión.

| Alternativa           | Por qué se descarta                                                      |
| --------------------- | ------------------------------------------------------------------------ |
| Llamadas HTTP directas | Acopla la disponibilidad de los servicios                               |
| Un orquestador central | Un punto único de falla y de cuello de botella; Step Functions cobra por transición |

### 3.3 Concurrencia (el punto crítico)

| Riesgo                                       | Decisión                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Miles de clics o pedidos de golpe            | `POST /orders` responde **202** de inmediato y el trabajo se encola; *throttling* en API Gateway                    |
| Dos pedidos consumen la misma unidad         | Reserva **todo o nada** en una sola transacción de DynamoDB, con la condición `stock >= n` en cada ingrediente     |
| Avalancha de compras del mismo ingrediente   | **Un solo faltante activo por ingrediente** por la demanda acumulada, y cola FIFO agrupada por ingrediente         |
| La plaza responde `0`                        | Reintentos indefinidos con *backoff*; los hace la cola (`ChangeMessageVisibility`), no un proceso dormido          |
| Un pedido antiguo bloquea a los demás        | Lista de espera **FIFO flexible**: el más antiguo tiene la primera oportunidad, pero no bloquea                    |
| Miles de eventos hacia el dashboard          | realtime agrupa los eventos; el frontend descarta los ya aplicados                                                 |

**Por qué un solo faltante activo:** la plaza decide cuánto vende. Si cada pedido emitiera su
propio faltante, 3 Changuas seguidas generarían 3 compras de 1 cebolla, y market, que no conoce
el stock, las compraría las tres aunque la primera trajera suficiente. Con la demanda agregada,
200 platos esperando cebolla generan 2 faltantes, no 200.

**Por qué la espera suma todos los ingredientes del pedido y no solo los faltantes:** un Ajiaco
espera cebolla, pero sí había papa. Mientras espera, otros pedidos gastan la papa. Si la demanda
de papa no incluyera al Ajiaco, nadie la compraría y el pedido quedaría atascado para siempre.

| Alternativa descartada                  | Por qué                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Bodega con un único consumidor          | Más simple, pero convierte la bodega en un cuello de botella secuencial                   |
| FIFO estricto en la espera              | Un pedido atascado detendría toda la cocina (*head-of-line blocking*)                     |
| Dormir dentro de la Lambda al reintentar | Se paga cada segundo dormido y Lambda corta a los 15 minutos                             |
| Reencolar con `DelaySeconds`            | Las colas FIFO no aceptan retraso por mensaje                                             |
| Step Functions con estados `Wait`       | Otro servicio, cobra por transición y LocalStack lo emula a medias                        |

### 3.4 Idempotencia: la base de datos es el árbitro

**Problema:** SQS entrega cada mensaje **al menos una vez**, y dos copias pueden procesarse a la
vez en instancias distintas.

**Decisión:** el efecto y la marca de "ya procesado" se escriben en la **misma escritura
condicional**. Ante un duplicado, el handler lo trata como éxito y **vuelve a publicar** el evento
resultante, por si el proceso murió entre guardar y publicar. Todos los consumidores son
idempotentes, así que publicar dos veces es seguro.

| Alternativa descartada                       | Por qué                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Un `Set` en memoria de eventos vistos        | Solo protege a su instancia y se pierde en cada reinicio                        |
| "Leer si existe → si no, escribir"           | Tiene la misma *race condition* que se quiere evitar                            |
| *Transactional outbox* con DynamoDB Streams  | Más robusto, pero un stream y una Lambda más por servicio, difícil de emular    |

**Limitación honesta:** la plaza no es idempotente y no hay transacción que abarque nuestra base
de datos y su API. En el peor caso se compra **de más**, nunca de menos, y el excedente lo usan
los siguientes pedidos.

### 3.5 Jornadas

> ⚠️ **Este concepto no está en el enunciado.** Es una decisión de diseño propia.

**Origen: dos requisitos en tensión.** R4 dice que "la bodega **inicia siempre** con 5 unidades",
y la persistencia exige que el estado **sobreviva reinicios**. Reiniciar la bodega al arrancar el
servidor viola la persistencia; no reiniciarla nunca hace que el "inicia con 5" solo se cumpla
la primera vez.

**Interpretación adoptada:** "siempre" se refiere a **cada jornada de donación**, no a cada
arranque del proceso. El reinicio pasa a ser una acción de negocio explícita ("Nueva jornada").

- Solo se permite **sin pedidos en curso**: reiniciar con reservas a medias descuadraría el
  inventario.
- Todo pedido y toda compra pertenecen a una jornada, y el historial no se borra.
- Una compra atrasada de una jornada anterior no entra al stock de la nueva.
- La primera jornada se crea sola.

**Valor agregado:** el historial por jornada no mezcla eventos distintos, y cada reviewer puede
empezar desde el estado inicial del reto.

**Alternativa descartada:** un botón "Reiniciar bodega" sin concepto de jornada. Es más simple,
pero mezcla el historial y no aporta valor de análisis.

### 3.6 Validación en tiempo de ejecución (zod)

> El reto **no exige** zod. Es una decisión propia.

**El problema:** los tipos de TypeScript se borran al compilar. Un dato que llega de afuera (un
mensaje SQS, un body HTTP, la respuesta de la plaza) no se verifica: el código lo trata como si
fuera del tipo declarado aunque no lo sea. Por ejemplo, un `IngredientPurchased` con
`{ ingredient: "garlic", quantity: -3 }` restaría unidades de un ingrediente que no existe.

**Qué hace zod:** con un solo esquema se obtiene la **validación en ejecución** y el **tipo de
TypeScript** (`z.infer`), así que nunca se desalinean.

| Frontera                        | Qué protege                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| Eventos SNS/SQS                 | Un mensaje mal formado va a la DLQ y no corrompe el estado              |
| Requests HTTP                   | Responde `400` ante `quantity: 0`, negativos o texto                    |
| Variables de entorno            | El servicio no arranca, con un mensaje claro, si falta configuración    |
| Respuesta de la plaza           | Verifica que `quantitySold` sea un entero ≥ 0                           |
| Pregunta y respuesta de la IA   | La pregunta tiene de 1 a 500 caracteres; una respuesta inesperada de Gemini se trata como "no disponible" (§5) |

| Alternativa                  | Por qué se descarta                                              |
| ---------------------------- | ---------------------------------------------------------------- |
| Validación manual (`typeof`) | Más código y más errores; el tipo se declara aparte (duplicado) |
| JSON Schema + `ajv`          | Más verboso y no genera los tipos de TypeScript                  |

**Cumple la restricción del reto:** zod es una librería de validación, no un framework.

---

## 4. Menú bogotano (6 recetas)

| #   | Plato              | Ingredientes                             |
| --- | ------------------ | ---------------------------------------- |
| 1   | Ajiaco santafereño | chicken ×2, potato ×3, onion ×1, rice ×1 |
| 2   | Caldo de costilla  | meat ×2, potato ×2, onion ×1             |
| 3   | Changua con queso  | cheese ×2, onion ×1                      |
| 4   | Picada bogotana    | meat ×2, potato ×2, onion ×1, lemon ×1   |
| 5   | Arroz con pollo    | rice ×2, chicken ×1, tomato ×1, onion ×1 |
| 6   | Mazamorra chiquita | meat ×1, potato ×2, onion ×1             |

> Notas:
>
> - `ketchup` y `lettuce` no se usan (el reto solo exige "al menos un ingrediente de la lista").
> - `onion` está en los 6 platos y `potato` en 4: son los ingredientes más comprados en la plaza.

---

## 5. Bonus IA — Asistente operativo

**Problema real:** el gerente no es técnico y durante el evento no tiene tiempo de leer tablas.
Necesita respuestas rápidas en lenguaje natural:

- "¿Cuántos pedidos están esperando ingredientes y por qué?"
- "¿Qué ingrediente compramos más en la plaza?"
- "¿Cuántos ajiacos hemos entregado?"

**Enfoque: el contexto en una sola llamada.** Ante cada pregunta, el servicio `assistant` lee la
jornada de las APIs de consulta de cada servicio dueño (`/orders`, `/inventory`, `/purchases`,
`/recipes`), la **resume** en unos cientos de tokens y se la envía a Gemini junto con la pregunta.
El modelo responde **solo con esos datos**. Es de **solo lectura**: no puede ejecutar acciones.

| Alternativa                    | Por qué se descarta                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| *Function calling* (el plan inicial) | El modelo pide los datos herramienta por herramienta: 2 a 4 llamadas por pregunta, más lento, y gasta la cuota gratuita, que Google no publica fija, de 2 a 4 veces más rápido. Los datos de una jornada caben de sobra en una sola llamada |

**Salvaguardas:**

- las reglas viajan como *system instruction*, separadas de la pregunta, así que lo que escriba el
  gerente no puede reescribirlas;
- límite de preguntas por minuto y por día, contado en DynamoDB para que todas las Lambdas vean el
  mismo número, por debajo de la cuota gratuita de Gemini;
- tiempo límite por llamada y un mensaje claro si Gemini no responde o se agota su cuota;
- API key en SSM Parameter Store en AWS y en un `.env` ignorado por Git en local; sin key, el
  sistema funciona igual y el asistente avisa que no está configurado.

El detalle está en [AI.es.md](AI.es.md).

---

## 6. Estrategia de pruebas (TDD)

1. **Dominio (unit):** primero el test que falla. Cubre selección aleatoria con semilla inyectable, reserva todo-o-nada, política de compra y reintentos, y máquina de estados del pedido.
2. **Casos de uso (unit):** con adaptadores en memoria (fakes) de los puertos.
3. **Adaptadores (integration):** contra LocalStack; los repositorios pasan el mismo contrato de pruebas con los fakes y con DynamoDB.
4. **Contratos:** validación de esquemas de eventos entre productor y consumidor.
5. **End-to-end:** `npm run e2e` pide N platos y verifica que todos lleguen a `DELIVERED` y que ningún stock quede negativo, en local y en AWS.
6. **Carga:** `npm run load` (Artillery) simula muchos gerentes pidiendo a la vez.
7. **Pruebas de usuario:** una persona usa el dashboard contra la plaza real; sus hallazgos están en el [DEVLOG](DEVLOG.es.md).

Meta de cobertura: ≥ 90% en `domain` y `application`.

---

## 7. Estructura del repositorio

```
alegra-lunch/
├── docs/                 # PLANNING, ARCHITECTURE, DEVLOG y AI, cada uno también en español (.es.md)
├── packages/
│   ├── contracts/        # eventos y DTOs compartidos (tipos + esquemas)
│   └── shared/           # router HTTP, publicador SNS, consumidor SQS, adaptadores Lambda, logger
├── services/
│   ├── orders/  kitchen/  warehouse/  market/  realtime/  assistant/
├── apps/web/             # React + Vite
├── infra/localstack/     # tablas, topics y colas para docker compose
├── infra/aws/            # stack compartido: topics, HTTP API, alerta de presupuesto
├── scripts/              # despliegue en AWS y prueba end-to-end
├── load/                 # prueba de carga con Artillery
├── docker-compose.yml
└── .github/workflows/    # CI
```

---

## 8. Plan de trabajo

| Plan  | Fase                  | Tareas                                                                                  | Estado                                        |
| ----- | --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| 15/10 | **Análisis**          | Lectura del reto, decisiones, este documento                                            | ✅ 16/10                                      |
| 16/10 | **0. Setup**          | Monorepo, TS, ESLint/Prettier, Jest, CI; repo privado e invitación a `scouting@alegra.com` | ✅ 16/10                                    |
| 16/10 | **1. Contratos**      | Eventos y DTOs en `packages/contracts`                                                  | ✅ 16/10                                      |
| 17/10 | **2. Dominio (TDD)**  | warehouse, kitchen, market, orders                                                      | ✅ 17/10                                      |
| 18/10 | **3. Adaptadores**    | DynamoDB, SNS/SQS, cliente de la plaza, `node:http`                                     | ✅ 18/10                                      |
| 18/10 | **4. Docker local**   | Dockerfiles + docker-compose + LocalStack                                               | ✅ 18/10                                      |
| 19/10 | **5. Realtime + Web** | WebSocket + dashboard                                                                   | ✅ 19/10                                      |
| 20/10 | **7. AWS**            | `serverless.yml` por servicio, despliegue, S3/CloudFront                                | ✅ 19/10, adelantada a la IA                  |
| 21/10 | **8. Calidad**        | Pruebas E2E y de carga, pruebas de usuario, README y ARCHITECTURE                       | ✅ 19/10                                      |
| 20/10 | **6. IA**             | Servicio assistant + chat en el dashboard, `docs/AI.md`                                 | ✅ 20/10                                      |
| 22/10 | **Traducción**        | Todos los documentos en inglés y en español                                             | ✅ 20/10                                      |
| 22/10 | **Entrega**           | Revisión final y envío del formulario                                                   | ⏳                                            |

La fase de AWS se adelantó a la de IA para asegurar la URL pública y medir el sistema en la nube
antes de agregar el asistente.

### Checklist de entregables del reto

- [x] URL de la aplicación desplegada: https://d2dy6tdbg4ssp2.cloudfront.net
- [x] Repositorio privado en GitHub con `scouting@alegra.com` como colaborador (invitación enviada)
- [x] `docs/PLANNING.md`
- [x] Anexos: `docs/ARCHITECTURE.md`, `docs/DEVLOG.md`, `docs/AI.md`

---

## 9. Riesgos

| Riesgo                                          | Plan                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Límites del free tier de Gemini                 | Manejo de errores 429 y mensaje claro en el chat                                                                       |
| LocalStack no emula algo (p. ej. WebSocket API) | realtime tiene en local un adaptador WebSocket con `ws` sobre `node:http`                                              |
| LocalStack 4.14.0 ya no recibe actualizaciones  | Solo se usa en local. Si dejara de estar disponible, los adaptadores no cambian; basta con otro emulador               |
| La plaza de mercado se cae o es lenta           | Timeouts y reintentos indefinidos con tope de 10 s; los pedidos quedan en espera, no fallan                            |
| Se agotan los créditos de AWS                   | Plan gratuito sin facturas, topes de concurrencia y de peticiones, alerta de presupuesto y pruebas en AWS con cantidades mínimas |

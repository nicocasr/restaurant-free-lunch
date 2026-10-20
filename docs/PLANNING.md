# Free Lunch Day — Planning

> What the project sets out to do, what was decided and why, and the work plan. It was written
> **before the first line of code** and updated with what was learned along the way.
>
> - **How it is built:** [ARCHITECTURE.md](ARCHITECTURE.md).
> - **How it evolved** (every version of this plan, what the tests found and what changed
>   because of it): [DEVLOG.md](DEVLOG.md).
> - **Versión en español:** [PLANNING.es.md](PLANNING.es.md).

---

## 1. Understanding the problem

A restaurant gives away lunches during a massive one-day event. Today the flow is manual:

```
Manager presses a button → Kitchen picks a random recipe → asks the Warehouse for ingredients
→ if some are missing, the Warehouse buys them at the Farmers market → Kitchen cooks and serves
```

**Goal:** automate the whole flow. It must handle thousands of diners and let the manager, who
is not technical, follow the operation in real time.

### Business rules (from the challenge)

| #   | Rule                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| R1  | The manager orders **X dishes** with a button.                                                                             |
| R2  | Each dish gets a **random** recipe out of 6.                                                                               |
| R3  | Each recipe uses ingredients from: tomato, lemon, potato, rice, ketchup, lettuce, onion, cheese, meat, chicken.            |
| R4  | The warehouse **starts with 5 units** of each ingredient.                                                                  |
| R5  | When stock is short, it is bought at the market (`GET https://recruitment.alegra.com/api/farmers-market/buy?ingredient=<name>`). |
| R6  | The market answers `{ quantitySold }`. `0` means none available; a purchase succeeds when it is an integer > 0.            |
| R7  | A dish is served **only when all its ingredients are there**; preparing it deducts them from the inventory.                |

### Non-functional requirements

- Microservices in Node.js + TypeScript, **without Express, Nest or similar frameworks**.
- Each microservice with its own **Dockerfile**, plus a **Serverless** deployment (a PLUS).
- **Persistence** that survives restarts.
- **Scalability and robustness**: many simultaneous orders without failing.
- A public deployment on **AWS** at no cost.
- An **AI bonus**, integrated and working in the deployment.

**Dates:** challenge received on **15/10/2026**; due on **22/10/2026** at the latest.

---

## 2. Decisions

### Technology and way of working

| Topic           | Decision                                                                                        | Reason                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Architecture    | **Hexagonal** (ports and adapters); each service runs in Docker (locally) and in Lambda (cloud) | Meets Docker and Serverless with the same domain core: only the entrypoints change       |
| Language        | TypeScript (strict)                                                                             | Type safety and better support for TDD                                                   |
| Runtime         | Node.js 24 LTS (`nodejs24.x` in Lambda)                                                         | The newest version Lambda supports; the same locally, in Docker and in the cloud         |
| Monorepo        | npm workspaces                                                                                  | Comes with Node, no extra tools                                                          |
| HTTP            | The native `node:http` module with a small router of our own                                    | The challenge forbids Express, Nest and similar                                          |
| Local WebSocket | The `ws` library on `node:http`                                                                 | A library without dependencies, not a framework; AWS uses API Gateway WebSocket          |
| Validation      | zod (a library, not a framework)                                                                | Validates at runtime whatever comes from outside (see §3.6)                              |
| Frontend        | React + Vite                                                                                    | —                                                                                        |
| Testing         | Jest (+ ts-jest) with TDD                                                                       | Red → Green → Refactor on the domain and the use cases                                   |
| Load test       | Artillery                                                                                       | Scenarios in YAML; runs on Node                                                          |
| Quality         | ESLint + Prettier                                                                               | Consistent style, checked in CI                                                          |
| CI              | GitHub Actions: format, lint, types, tests, build, integration and E2E on the containers       | Checks every push automatically                                                          |
| Commits         | Conventional Commits; `test:` (red) and `feat:` (green) apart                                   | The TDD cycle stays visible in the Git history                                           |
| Language        | **English** in code, documentation, commits and interface                                       | The team standard. Every document also exists in Spanish                                 |
| Repository      | `alegra-lunch` (private)                                                                        | —                                                                                        |
| AI              | A conversational operations assistant with **Gemini** (free tier)                               | Zero cost; answers with the real data of the system (see §5)                             |
| Menu            | 6 dishes from Bogotá (see §4)                                                                   | —                                                                                        |

### Infrastructure

| Topic              | Decision                                                                                                                                       | Reason                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event bus          | **SNS → SQS** (fan-out), one queue per service with a DLQ                                                                                      | Publish once and give each consumer its own queue; adding consumers does not touch the producer (see §3.2)                                                                                                         |
| Database           | DynamoDB on demand, **one table per service**                                                                                                  | Scales on its own, with no servers or capacity to manage; each service owns its data                                                                                                                                 |
| IaC / deployment   | Serverless Framework **v4**: one `serverless.yml` per service plus the shared stack `infra/aws`; `npm run deploy:aws` deploys them in order | Named in the challenge. Serverless Compose (the tool to deploy several services together) is not used: it does not work with the region restrictions of the account ([DEVLOG](DEVLOG.md)), and it is not needed, since each service reads what it needs of the shared stack from CloudFormation |
| Local emulation    | LocalStack **4.14.0** (SQS, SNS, DynamoDB), pinned                                                                                             | The same adapters locally and in the cloud. Later versions require an account and an auth token; 4.14.0 is the last one that starts without one, so reviewers run `docker compose up` without signing up (§9)     |
| Real time          | API Gateway WebSocket                                                                                                                          | The server pushes every change at once                                                                                                                                                                               |
| Dashboard in AWS   | Private S3 + CloudFront                                                                                                                        | HTTPS and the always-free tier of CloudFront                                                                                                                                                                         |
| AWS account        | An account on the **free plan** (`FREE`, credits until 19/04/2027), in `us-east-2`                                                             | The free plan **cannot produce bills**: if the credits ran out, the account would pause. The account's organization only allows `us-east-2`                                                                          |

### Zero cost

So that the credits last, and an abuse cannot exhaust them (that would pause the account during
the review):

- no VPC or NAT Gateway; DynamoDB on demand without PITR or streams; no X-Ray;
- logs kept 7 days;
- *reserved concurrency* of 10 per Lambda (free, unlike *provisioned*) and up to 10 Lambdas per
  queue; 20 for the warehouse queue, which every dish and every purchase goes through;
- *throttling* on the HTTP API (50 requests/s, bursts of 100) and CORS only for the dashboard's
  domain;
- secrets in standard SSM;
- an AWS Budgets alert when the month is projected over US$10, **without subtracting the
  credits** (if it counted them, the net bill would be US$0 and it would never alert).

A known and accepted cost: the Lambdas that read SQS poll the queues even when there are no
messages (~US$1.30 a month in credits).

### Product

| Topic               | Decision                                                                                                                                                         | Reason                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Market purchases    | **Aggregated demand per ingredient**: the warehouse only asks to buy what is missing, minus the stock and what is already on its way                             | The market decides how much it sells; buying per order would make needless purchases (§3.3)            |
| Waiting list        | **Flexible FIFO**                                                                                                                                                | Favors throughput: if the oldest order cannot be served, the next one that can goes first (§3.3)       |
| Idempotency         | **The database is the arbiter** (conditional writes)                                                                                                             | Lambdas share no memory; only the database sees every attempt (§3.4)                                    |
| Market out of stock | **Endless** retries with exponential backoff and full jitter, capped at **10 s**                                                                                 | The market sells eventually; the order waits, it never fails                                             |
| Workdays            | A **"New workday"** button, only with no order in progress: resets the warehouse to 5 and keeps the history per workday                                         | Reconciles "the warehouse starts with 5" with persistence (§3.5)                                          |
| Dashboard data      | On opening, it loads from the query API **of each owning service** (`/orders`, `/inventory`, `/purchases`, `/recipes`), then applies the events from the WebSocket | Respects that each service owns its data. Events do not carry the whole stock: the inventory is read again |
| Push to dashboard   | realtime batches the events (~500 ms in the container; batches of up to 10 in AWS)                                                                              | Still real time to the human eye, without flooding the browser                                           |
| Order size          | A **configurable** maximum, validated                                                                                                                            | Protects the system from absurd orders                                                                   |
| Access              | No login; *rate limiting* on the API and on the assistant                                                                                                        | Makes user tests easy and protects the operation and the Gemini quota                                    |
| Waiting time        | The dashboard shows, for each waiting order, how long it has waited and what it misses                                                                          | With the flexible FIFO, any order that lags behind stays visible                                         |

---

## 3. Design: the problems and how they are solved

The details of each mechanism are in [ARCHITECTURE.md](ARCHITECTURE.md). Here: the problem it
solves, the decision and what was discarded.

### 3.1 Microservices

One *bounded context* per service and **one table per service**: no service reads or writes
the table of another.

| Service       | Responsibility                                                           |
| ------------- | ------------------------------------------------------------------------ |
| **orders**    | Manager API: batches of orders, workdays and history                     |
| **kitchen**   | Picks the recipe at random, asks for the ingredients and serves the dish |
| **warehouse** | Inventory, **atomic** reservation, waiting list and aggregated demand    |
| **market**    | Buys at the market with retries; purchase history                        |
| **realtime**  | Pushes the events to the dashboard over WebSocket                        |
| **assistant** | AI assistant (§5)                                                        |
| **web**       | The manager's React dashboard                                            |

### 3.2 Communication through events (choreography)

**Problem:** if a service calls another directly, one going down or getting overloaded stops
the others.

**Decision:** events over **SNS → SQS**, with one queue per consuming service. If a consumer goes
down, its messages wait in its queue. Each subscription filters by event type.

- **Two topics:** AWS does not let a **FIFO** queue subscribe to a standard topic, and the
  market's queue is FIFO. `StockShortage` goes through `shortages.fifo` and everything else
  through `events`.
- **Versioned contracts** in `packages/contracts`, validated when publishing and when receiving.
  They are **tolerant readers**: adding an optional field does not change the version.

| Alternative             | Why it is discarded                                                          |
| ----------------------- | ---------------------------------------------------------------------------- |
| Direct HTTP calls       | Ties the availability of the services together                               |
| A central orchestrator  | A single point of failure and a bottleneck; Step Functions charges per transition |

### 3.3 Concurrency (the critical point)

| Risk                                       | Decision                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Thousands of clicks or orders at once      | `POST /orders` answers **202** at once and the work is queued; *throttling* on API Gateway                     |
| Two orders take the same unit              | An **all-or-nothing** reservation in one DynamoDB transaction, with the condition `stock >= n` on each ingredient |
| A flood of purchases of the same ingredient | **One active shortage per ingredient** for the accumulated demand, and a FIFO queue grouped by ingredient      |
| The market answers `0`                     | Endless retries with backoff, done by the queue (`ChangeMessageVisibility`), not by a sleeping process         |
| An old order blocks the rest               | A **flexible FIFO** waiting list: the oldest gets the first chance, but does not block                          |
| Thousands of events toward the dashboard   | realtime batches the events; the frontend drops the ones it already applied                                     |

**Why a single active shortage:** the market decides how much it sells. If each order raised its
own shortage, 3 Changuas in a row would make 3 purchases of 1 onion, and the market service,
which does not know the stock, would buy all three even if the first brought enough. With the
aggregated demand, 200 dishes waiting for onion make 2 shortages, not 200.

**Why a waiting order adds every ingredient of its recipe and not only the missing ones:** an
Ajiaco waits for onion, but there was potato. While it waits, other orders use up the potato. If
the potato demand did not include the Ajiaco, nobody would buy potato and the order would be
stuck forever.

| Discarded alternative                   | Why                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| A warehouse with a single consumer      | Simpler, but turns the warehouse into a sequential bottleneck                        |
| A strict FIFO waiting list              | One stuck order would stop the whole kitchen (*head-of-line blocking*)               |
| Sleeping inside the Lambda to retry     | Every second asleep is paid, and Lambda stops at 15 minutes                          |
| Requeuing with `DelaySeconds`           | FIFO queues do not accept a delay per message                                        |
| Step Functions with `Wait` states       | One more service, charges per transition, and LocalStack only partly emulates it    |

### 3.4 Idempotency: the database is the arbiter

**Problem:** SQS delivers every message **at least once**, and two copies may run at the same
time in different instances.

**Decision:** the effect and the "already processed" mark are saved in **the same conditional
write**. A duplicate is treated as a success that **publishes the resulting event again**, in
case the process died between saving and publishing. Every consumer is idempotent, so
publishing twice is safe.

| Discarded alternative                         | Why                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| An in-memory `Set` of seen events             | Only protects its own instance, and is lost on every restart                |
| "Read if it exists → otherwise write"         | Has the very *race condition* it tries to avoid                             |
| A *transactional outbox* with DynamoDB Streams | More robust, but one more stream and Lambda per service, and hard to emulate |

**An honest limit:** the market is not idempotent, and no transaction spans our database and its
API. In the worst case it buys **more**, never less, and the next orders use the extra units.

### 3.5 Workdays

> ⚠️ **This concept is not in the challenge.** It is a design decision of our own.

**Origin: two requirements in tension.** R4 says "the warehouse **always starts** with 5 units",
and persistence requires the state to **survive restarts**. Resetting the warehouse when the
server starts breaks persistence; never resetting it makes "starts with 5" true only the first
time.

**Adopted reading:** "always" refers to **each donation day**, not to each start of the process.
The reset becomes an explicit business action ("New workday").

- It is only allowed **with no order in progress**: resetting with half-made reservations would
  unbalance the inventory.
- Every order and every purchase belongs to a workday, and history is never deleted.
- A late purchase of a previous workday does not enter the new stock.
- The first workday is created automatically.

**Added value:** the history per workday does not mix different events, and every reviewer can
start from the initial state of the challenge.

**Discarded alternative:** a "Reset warehouse" button without the concept of a workday. Simpler,
but it mixes the history and adds no analysis value.

### 3.6 Runtime validation (zod)

> The challenge **does not require** zod. It is a decision of our own.

**The problem:** TypeScript types are erased when compiling. Data that comes from outside (an SQS
message, an HTTP body, the market's answer) is not checked: the code treats it as the declared
type even when it is not. For example, an `IngredientPurchased` with
`{ ingredient: "garlic", quantity: -3 }` would subtract units of an ingredient that does not
exist.

**What zod does:** a single schema gives both the **runtime validation** and the **TypeScript
type** (`z.infer`), so they never drift apart.

| Boundary                       | What it protects                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| SNS/SQS events                 | A malformed message goes to the DLQ and does not corrupt the state                        |
| HTTP requests                  | Answers `400` to `quantity: 0`, negatives or text                                         |
| Environment variables          | The service refuses to start, with a clear message, when configuration is missing         |
| The market's answer            | Checks that `quantitySold` is an integer ≥ 0                                              |
| The AI's question and answer   | The question has 1 to 500 characters; an unexpected answer from Gemini counts as "unavailable" (§5) |

| Alternative                  | Why it is discarded                                                  |
| ---------------------------- | -------------------------------------------------------------------- |
| Manual checks (`typeof`)     | More code and more mistakes; the type is declared apart (duplicated) |
| JSON Schema + `ajv`          | More verbose, and it does not produce the TypeScript types           |

**It meets the challenge's restriction:** zod is a validation library, not a framework.

---

## 4. Bogotá menu (6 recipes)

| #   | Dish               | Ingredients                              |
| --- | ------------------ | ---------------------------------------- |
| 1   | Ajiaco santafereño | chicken ×2, potato ×3, onion ×1, rice ×1 |
| 2   | Caldo de costilla  | meat ×2, potato ×2, onion ×1             |
| 3   | Changua con queso  | cheese ×2, onion ×1                      |
| 4   | Picada bogotana    | meat ×2, potato ×2, onion ×1, lemon ×1   |
| 5   | Arroz con pollo    | rice ×2, chicken ×1, tomato ×1, onion ×1 |
| 6   | Mazamorra chiquita | meat ×1, potato ×2, onion ×1             |

> Notes:
>
> - `ketchup` and `lettuce` are not used (the challenge only requires "at least one ingredient
>   from the list").
> - `onion` is in all 6 dishes and `potato` in 4: they are the most bought at the market.

---

## 5. AI bonus — Operations assistant

**The real problem:** the manager is not technical and has no time to read tables during the
event. They need quick answers in plain words:

- "How many orders are waiting for ingredients, and why?"
- "Which ingredient did we buy the most at the market?"
- "How many ajiacos have we served?"

**Approach: the context in a single call.** For each question, the `assistant` service reads the
workday from the query APIs of each owning service (`/orders`, `/inventory`, `/purchases`,
`/recipes`), **summarizes** it in a few hundred tokens and sends it to Gemini with the question.
The model answers **only from that data**. It is **read only**: it cannot take actions.

| Alternative                          | Why it is discarded                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| *Function calling* (the first plan)  | The model asks for the data tool by tool: 2 to 4 calls per question, slower, and it spends the free quota, which Google does not publish as fixed numbers, 2 to 4 times faster. A workday's data fits easily in one call |

**Guardrails:**

- the rules travel as the *system instruction*, apart from the question, so whatever the manager
  types cannot rewrite them;
- a limit of questions per minute and per day, counted in DynamoDB so every Lambda sees the same
  number, below Gemini's free quota;
- a time limit per call, and a clear message if Gemini does not answer or its quota runs out;
- the API key in SSM Parameter Store in AWS, and in a `.env` ignored by Git locally; without a
  key, the system works the same and the assistant says it is not configured.

The details are in [AI.md](AI.md).

---

## 6. Testing strategy (TDD)

1. **Domain (unit):** the failing test first. Covers the seeded random pick, the all-or-nothing reservation, the purchase and retry policy, and the order's state machine.
2. **Use cases (unit):** with in-memory adapters (fakes) of the ports.
3. **Adapters (integration):** against LocalStack; the repositories pass the same contract tests with the fakes and with DynamoDB.
4. **Contracts:** schema validation of the events between producer and consumer.
5. **End-to-end:** `npm run e2e` orders N dishes and checks they all reach `DELIVERED` and no stock goes negative, locally and in AWS.
6. **Load:** `npm run load` (Artillery) simulates many managers ordering at once.
7. **User tests:** a person uses the dashboard against the real market; their findings are in the [DEVLOG](DEVLOG.md).

Coverage target: ≥ 90% on `domain` and `application`.

---

## 7. Repository structure

```
alegra-lunch/
├── docs/                 # PLANNING, ARCHITECTURE, DEVLOG and AI, each also in Spanish (.es.md)
├── packages/
│   ├── contracts/        # events and DTOs shared by every service (types + schemas)
│   └── shared/           # HTTP router, SNS publisher, SQS consumer, Lambda adapters, logger
├── services/
│   ├── orders/  kitchen/  warehouse/  market/  realtime/  assistant/
├── apps/web/             # React + Vite
├── infra/localstack/     # tables, topics and queues for docker compose
├── infra/aws/            # shared stack: topics, HTTP API, budget alert
├── scripts/              # AWS deployment and end-to-end check
├── load/                 # Artillery load test
├── docker-compose.yml
└── .github/workflows/    # CI
```

---

## 8. Work plan

| Plan  | Phase                 | Tasks                                                                                         | Status                       |
| ----- | --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| 15/10 | **Analysis**          | Reading the challenge, decisions, this document                                               | ✅ 16/10                     |
| 16/10 | **0. Setup**          | Monorepo, TS, ESLint/Prettier, Jest, CI; private repo and invitation to `scouting@alegra.com` | ✅ 16/10                     |
| 16/10 | **1. Contracts**      | Events and DTOs in `packages/contracts`                                                       | ✅ 16/10                     |
| 17/10 | **2. Domain (TDD)**   | warehouse, kitchen, market, orders                                                            | ✅ 17/10                     |
| 18/10 | **3. Adapters**       | DynamoDB, SNS/SQS, the market's client, `node:http`                                           | ✅ 18/10                     |
| 18/10 | **4. Local Docker**   | Dockerfiles + docker-compose + LocalStack                                                     | ✅ 18/10                     |
| 19/10 | **5. Realtime + Web** | WebSocket + dashboard                                                                         | ✅ 19/10                     |
| 20/10 | **7. AWS**            | `serverless.yml` per service, deployment, S3/CloudFront                                       | ✅ 19/10, ahead of the AI    |
| 21/10 | **8. Quality**        | E2E and load tests, user tests, README and ARCHITECTURE                                       | ✅ 19/10                     |
| 20/10 | **6. AI**             | The assistant service + chat in the dashboard, `docs/AI.md`                                   | ✅ 20/10                     |
| 22/10 | **Translation**       | Every document in English and in Spanish                                                      | ✅ 20/10                     |
| 22/10 | **Delivery**          | Final review and sending the form                                                             | ⏳                           |

The AWS phase went before the AI one, to secure the public URL and measure the system in the
cloud before adding the assistant.

### Deliverables checklist

- [x] URL of the deployed application: https://d2dy6tdbg4ssp2.cloudfront.net
- [x] Private GitHub repository with `scouting@alegra.com` as a collaborator (invitation sent)
- [x] `docs/PLANNING.md`
- [x] Annexes: `docs/ARCHITECTURE.md`, `docs/DEVLOG.md`, `docs/AI.md`

---

## 9. Risks

| Risk                                          | Plan                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Limits of Gemini's free tier                  | Handling 429 errors and a clear message in the chat                                                                   |
| LocalStack does not emulate something (e.g. the WebSocket API) | realtime has a local WebSocket adapter with `ws` on `node:http`                                      |
| LocalStack 4.14.0 no longer gets updates      | It is only used locally. If it stopped being available, the adapters would not change; another emulator would do      |
| The farmers market goes down or is slow       | Timeouts and endless retries capped at 10 s; orders wait, they do not fail                                            |
| The AWS credits run out                       | A free plan without bills, caps on concurrency and requests, a budget alert, and AWS tests with minimal quantities    |

# Free Lunch Day — Development log

> How the project evolved: what was built in each phase, what the tests found and what changed
> because of it. The current decisions are in [PLANNING.md](PLANNING.md) and the current design
> in [ARCHITECTURE.md](ARCHITECTURE.md).
>
> **Versión en español:** [DEVLOG.es.md](DEVLOG.es.md).

Every finding follows the same shape: **what was seen**, **the cause** and **the fix**, with its
measurement when there was one.

---

## Phases

### 15-16/10 — Analysis, setup and contracts

- The plan was written and approved before the first line of code (v1.0).
- Monorepo with npm workspaces, strict TypeScript, ESLint, Prettier, Jest and CI on GitHub Actions.
- Event contracts in `packages/contracts`, validated with zod.

**Before writing code, the plan was refined four times** while walking through the hard cases:

| Seen                                                                                        | Fix                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| R4 ("the warehouse always starts with 5") clashes with persistence                          | The concept of a **workday** (v1.1)                             |
| `StockShortage` is per ingredient: it does not say which order waits or what it misses      | A new event, `OrderWaitingIngredients` (v1.2)                   |
| TypeScript types do not exist at runtime                                                    | Validation with zod at every boundary (v1.3)                    |
| If the process dies between saving and publishing, an "already processed" duplicate would publish nothing | A duplicate **publishes the resulting event again** (v1.4) |

### 17/10 — Domain with TDD

The tests of warehouse and market brought up cases the plan did not cover:

| Seen (while writing the test)                                                                                                       | Fix                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| An Ajiaco waits for onion; meanwhile other orders use up the potato that was there, and nobody buys it: the order is stuck forever | A waiting order adds **every** ingredient of its recipe to the demand (v1.5) |
| Three Changuas in a row raised three shortages of 1 onion; market bought all three even if the first brought enough                 | **One active shortage per ingredient** (v1.6)                               |
| If the process dies between setting `inFlight` and publishing the shortage, nobody asks for the purchase again                      | The shortage is saved as **pending** and published again (v1.6)            |
| If it dies between taking an order off the waiting list and telling the kitchen, the dish is lost                                    | The reservation is saved as **pending to publish** (v1.7)                  |
| A purchase in progress when a workday closes would enter the next workday's stock                                                    | A new workday resets the demand and ignores late purchases (v1.8)          |
| The retries of several ingredients reached the market at the same instant                                                            | Backoff with **full jitter** (v1.10)                                        |
| Sleeping inside the Lambda to retry is paid by the second and clashes with its 15-minute limit                                       | The **queue** does the retries, with `ChangeMessageVisibility` (v1.11)     |

### 18/10 — Adapters and local Docker

- Adapters for DynamoDB, SNS, SQS and the market, with integration tests against LocalStack. The
  repositories pass the same contract tests with the fakes and with DynamoDB.
- A Dockerfile per service, and `docker compose up` with the whole flow.

| Seen                                                                                         | Fix                                                                              |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A batch of 1000 dishes does not fit in a transaction (100 items at most)                     | The batch keeps its `orderId`s and the orders are written "if absent" (v1.12)    |
| `WorkdayStarted` may reach the warehouse **after** an order of the new workday               | The warehouse only serves orders of a workday it has already started (v1.13)     |
| LocalStack 2026.03 began to require an account and an auth token                             | Pinned to **4.14.0**, the last one that starts without signing up (v1.14)        |
| AWS does not let a FIFO queue subscribe to a standard topic                                  | A second topic, `shortages.fifo`, only for `StockShortage` (v1.14)               |
| Listing a workday's orders with a *scan* does not scale                                      | Orders in 10 partitions per workday, and a counter of orders in progress (v1.15) |

#### User test: duplicated and slow purchases (v1.17)

**Seen:** with 50 dishes, orders spent a long time waiting for ingredients, and the warehouse
ended with **83 spare onions**: 48 were asked for and **158** were bought.

**Cause:**

- A large purchase (97 potatoes ≈ 40 calls, plus the waits for the `0`s) **outlived the 30 s
  visibility** of its message: SQS took it for lost and handed it to a **second buyer**.
- A FIFO queue may hand several messages of the same group in one batch, and they ran in parallel.
- Each buyer **overwrote** the progress with its own total.

The tests did not catch it because they used small purchases, which never reached 30 s.

**Fix:**

1. **Purchases in slices** of ~10 s: no delivery outlives the visibility.
2. **The consumer respects FIFO groups:** different groups in parallel, the same group in order.
3. **Progress by atomic addition** (`ADD`), in the same write that records each sale.
4. **Rounds of up to 5 parallel calls**, sized by what is missing (`⌈missing / 2.5⌉`).

A second measurement found more bottlenecks:

| Seen                                                                                                                | Fix                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A process shutting down during *long polling* got a message it would never handle; it stayed hidden 30 s           | On shutdown, each worker **finishes the message in hand**; 5 s polls and 30 s of grace               |
| LocalStack **does not lock the FIFO group** when receiving several messages in one batch, although AWS does         | Several workers that take **one message each**                                                       |
| The warehouse got one event per call to the market and re-evaluated the 10 ingredients one after another            | Market publishes **one event per round** (93 → 27); the warehouse evaluates only what it needs, in parallel |
| Transient errors retried for up to 30 s                                                                              | A 10 s cap                                                                                           |

**Result with 50 dishes against the real market:** spare onions 83 → **0 to 2**; errors 192 →
**0**; total time 165 s → **62 s**. The remaining limit was LocalStack (125-145 % CPU, while the
services stayed below 25 %).

#### User test: two orders merged in one row (v1.18)

**Seen:** the dashboard's history put two different orders in one row.

**Cause:** realtime, deployed with the previous contract, **dropped** the new `batchId` field of
`OrderPlaced` before forwarding it.

**Fix:** the contracts are **tolerant readers** (they keep the fields they do not know), and the
versioning rule became explicit: adding an optional field does not change the version.

### 18-19/10 — Realtime and dashboard

- WebSocket with `ws` locally; the dashboard loads the data of each service and applies the events (v1.16).
- The user tests adjusted the interface:
  - purchases as a single, always visible table (how many purchases and units per ingredient);
  - the history as a summary table per order, with **every** dish served and its count;
  - the order notice clears when the quantity changes.

### 19/10 — AWS

- Lambda adapters for every service, reusing the same rules as the container.
- One `serverless.yml` per service, the shared stack `infra/aws`, the dashboard on S3 +
  CloudFront, and `npm run deploy:aws` to deploy it all.

| Seen                                                                                                    | Cause                                                                                              | Fix                                                                                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Every call in `us-east-1` was rejected                                                                   | The free plan's organization only allows `us-east-2`                                             | Everything in `us-east-2` (v1.20)                                                                  |
| The budget alert would never fire                                                                        | By default it subtracts the credits: the net bill is always US$0                                   | The alert counts usage **without credits** (v1.20)                                                 |
| The new account allowed only 10 Lambdas at a time                                                        | The initial limit of new accounts                                                                  | Each queue capped at 2 while AWS approved the increase to 1000 (v1.20)                             |
| "The kitchen did not answer" when ordering from the dashboard in AWS                                     | CORS only allowed `content-type`, and the order sends an `Idempotency-Key`                         | The HTTP API allows that header                                                                    |
| An order's last events reached the dashboard **~20 s late**; the backend had already delivered everything | The realtime queue had a batching window: with little traffic, the rest waited for the next poll   | Batches of up to 10 without a window: events arrive in **~0.2 s** (v1.21)                          |
| Serverless Compose could not deploy                                                                      | It keeps its state through `us-east-1`                                                             | A script deploys the stacks in order; the services read the outputs with `${cf:...}` (v1.22)       |
| Any website could call the API from a browser                                                            | CORS with `*`                                                                                      | Only the dashboard's domain (v1.22)                                                                |
| AWS approved 1000 Lambdas at a time                                                                      | —                                                                                                  | 10 reserved executions per Lambda and up to 10 per queue (v1.23)                                   |
| Serverless warned that the market's HTTP Lambda could use up the API's 30 s                              | It inherited the 30 s timeout of the purchase                                                      | 10 s for the query                                                                                 |

### 19/10 — Quality

- `npm run e2e` locally, in AWS and in the CI; `npm run load` with Artillery; README and ARCHITECTURE.

| Seen                                                                                     | Cause                                                                                             | Fix                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A test of the FIFO consumer failed in the CI and not locally                             | It only detected parallelism when the potato **started** during an onion, not the other way round | It detects the overlap in either order                                     |
| SDK warnings in every SQS integration test                                               | LocalStack answers queue URLs on its own domain                                                   | The tests always use the configured endpoint                               |
| The "50 dishes sent to the kitchen" notice stayed after "New workday"                    | The form kept its state between workdays                                                          | The form resets with every workday                                         |
| The inventory showed "+1 on its way" with every dish delivered; the backend had 0        | A purchase reaches the dashboard and the warehouse at once: re-reading the inventory could get ahead | One more read 1 s after the last change                                 |
| Repeating the load test with the raised quota, 40 dishes **stalled 46 s**, with no errors and no Lambda running | The warehouse reached its cap of 10 Lambdas and its queue handed out 19 messages after receiving only 3: most likely AWS took messages it could not pass to the Lambda, and they stayed hidden for the queue's 60 s visibility | Visibility from 60 to 20 s on the standard queues, and **20 Lambdas** for the warehouse queue, which every dish and purchase goes through (v2.1) |

**Results in AWS:**

| Test                                                    | Result                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| End-to-end, 3 dishes                                    | delivered in 7 to 13 s, depending on what the market sells                        |
| Load, 200 dishes at once, account with 10 Lambdas       | 20/20 batches accepted, p95 400 ms; all delivered in **1 min 48 s**               |
| The same load with the raised quota, before fixing the queues | all delivered in 82 s, with 46 s stalled                                    |
| The same load with the fixed queues (v2.1)              | 20/20 batches accepted, p95 296 ms; all delivered **24 s** after the first batch  |
| Dead-letter queues                                      | empty                                                                             |
| Final stock                                             | never negative; a few spare units                                                 |
| Credits                                                 | cents per test; no charge                                                         |

**p95** (95th percentile) is the time within which 95% of the orders were accepted: only the
slowest 5% took longer. It is used instead of the average because the average hides the users
who waited a long time.

In the last load test, 9 reservations collided on the same ingredient (6 transaction conflicts
and 3 brief DynamoDB throttles on onion, which is in every dish). All were retried within 1 s and
no dish was lost.

### 19-20/10 — AI assistant

- The `assistant` service with TDD: the workday summary, the rules for the model, the use case,
  the adapters (Gemini, the query APIs, a counter in DynamoDB) and the dashboard's chat panel.

| Seen                                                                                                      | Fix                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Google does not publish fixed quotas for Gemini's free tier, and function calling spends 2 to 4 calls per question | **The context in a single call**: the assistant summarizes the workday and sends it with the question (v2.2)    |
| Some well-known model IDs had already been retired                                                        | The account's model list was read and three models were tried with a minimal call; `gemini-3.5-flash-lite`, the fastest, was pinned |
| Two questions at the same instant collided on the DynamoDB counter, and the second was refused although there was room | A conflict is retried; only a full counter refuses. A test sends 20 questions with a limit of 5 and exactly 5 get through |
| The panel promised to compare with the previous workday, but orders offers no list of past workdays      | The panel only talks about the current workday; comparing workdays is left as an improvement                            |
| A question in English got an answer in Spanish                                                            | The Spanish dish names chose the language: the rules now say a question in English gets an answer in English            |
| "How long did the slowest order take?" could not be answered                                              | The summary had no batches: it now numbers each batch like the order history, with its time, dishes and duration       |
| The dashboard's order history was not in time order (#40 at 19:30, #39 at 20:21)                         | It was numbered in the order the API answers, and orders are spread over partitions: it now sorts by the time placed    |

**First real question:** "¿Qué ingrediente compramos más y cuántos platos se han entregado?". It
answered in Spanish in 3.8 s: "potato, with 153 units in 14 purchases… 100 dishes". The data said
exactly that.

### 20/10 — Cleanup and translation

| Seen                                                                                         | Fix                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 59 code comments pointed to planning sections that had changed number in v2.0               | Each one points to the current section; the 3 about the hexagonal layout point to ARCHITECTURE |
| 8 exported types that no other file imports                                                  | They stay, without `export`: each is used in its own file                           |
| knip (a tool that finds unused code) found no unused files, dependencies or variables       | —                                                                                    |

PLANNING and this DEVLOG were translated to English, and ARCHITECTURE and AI to Spanish: every
document exists in both languages (v2.3).

---

## Plan versions

| Version | Date       | Change                                                                                                                                             |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 16/10/2026 | First plan approved                                                                                                                                |
| 1.1     | 16/10/2026 | Origin and reasons of the workdays (not part of the challenge). The AWS free tier risk is withdrawn                                               |
| 1.2     | 16/10/2026 | New event `OrderWaitingIngredients`: `StockShortage` is per ingredient, so it cannot mark which order waits or what it misses                     |
| 1.3     | 16/10/2026 | Reasons for runtime validation with zod                                                                                                            |
| 1.4     | 16/10/2026 | A duplicate makes the handler **publish the resulting event again**                                                                                |
| 1.5     | 17/10/2026 | A waiting order adds **every** ingredient to `waitingNeed`, not only the missing ones                                                             |
| 1.6     | 17/10/2026 | **One active shortage per ingredient**; the shortage is saved as pending together with `inFlight` and published until it is marked as published   |
| 1.7     | 17/10/2026 | The reservation of an order taken off the waiting list is saved as **pending to publish**                                                         |
| 1.8     | 17/10/2026 | A new workday resets the demand counters, and the warehouse ignores late purchases of previous workdays                                            |
| 1.9     | 17/10/2026 | The kitchen's recipe catalog lives in the code, not in its table                                                                                   |
| 1.10    | 17/10/2026 | The market's backoff uses **full jitter**                                                                                                           |
| 1.11    | 17/10/2026 | The queue does the market's retries, with a DLQ without `maxReceiveCount` and waits in whole seconds                                              |
| 1.12    | 18/10/2026 | The batch keeps its `orderId`s and the orders are written "if absent"; `correlationId` = `orderId`                                                 |
| 1.13    | 18/10/2026 | A new workday stays pending to publish; two simultaneous clicks get the same workday; the warehouse only serves orders of a workday it started    |
| 1.14    | 18/10/2026 | LocalStack pinned to 4.14.0. A second topic `shortages.fifo`, filters by `type` and queues without `maxReceiveCount`                               |
| 1.15    | 18/10/2026 | Orders grouped per workday in 10 partitions, and a counter of orders in progress per workday                                                      |
| 1.16    | 18/10/2026 | A query API in each owning service for the dashboard; realtime sends events and the inventory is read again                                       |
| 1.17    | 18/10/2026 | The user test finding (duplicated and slow purchases) and its fixes                                                                               |
| 1.18    | 18/10/2026 | The contracts are tolerant readers, and the versioning rule                                                                                        |
| 1.19    | 19/10/2026 | An AWS account on the free plan, and measures to protect the credits                                                                               |
| 1.20    | 19/10/2026 | Region `us-east-2`; the Budgets alert leaves out the credits; a cap of Lambdas per queue while the quota is raised                                 |
| 1.21    | 19/10/2026 | In AWS, realtime sends batches of up to 10 events without a batching window                                                                        |
| 1.22    | 19/10/2026 | CORS only for the dashboard's domain; a script deploys the stacks in order instead of Serverless Compose                                           |
| 1.23    | 19/10/2026 | AWS raised the Lambda quota to 1000; each function reserves 10 executions and each queue starts up to 10                                           |
| 2.0     | 19/10/2026 | The plan splits into three documents: PLANNING (what and why), ARCHITECTURE (how) and this DEVLOG (the path)                                      |
| 2.1     | 19/10/2026 | The warehouse queue reserves 20 Lambdas; the standard queues return in 20 s the messages that could not be handed over                            |
| 2.2     | 20/10/2026 | The assistant uses the context in a single call instead of function calling; a limit of questions per minute and per day in DynamoDB              |
| 2.3     | 20/10/2026 | Every document in English and in Spanish                                                                                                           |

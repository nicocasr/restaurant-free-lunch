// End-to-end check (PLANNING §6): orders N dishes and waits until every one is DELIVERED.
// Local (docker compose up):  npm run e2e
// AWS (one HTTP API for all):  ORDERS_URL=<HttpApiUrl> WAREHOUSE_URL=<HttpApiUrl> npm run e2e
// Optional DISHES (default 5) and TIMEOUT_SECONDS (default 120). Keep DISHES small in AWS.
import { randomUUID } from 'node:crypto';

const ordersUrl = process.env.ORDERS_URL ?? 'http://localhost:3000';
const warehouseUrl = process.env.WAREHOUSE_URL ?? 'http://localhost:3001';
const dishes = Number(process.env.DISHES ?? 5);
const timeoutMs = Number(process.env.TIMEOUT_SECONDS ?? 120) * 1_000;

async function call(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} answered ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const startedAt = Date.now();
const batch = await call(`${ordersUrl}/orders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
  body: JSON.stringify({ quantity: dishes }),
});
console.log(`Ordered ${dishes} dishes (batch ${batch.batchId})`);

const ours = new Set(batch.orderIds);
for (;;) {
  const { orders } = await call(`${ordersUrl}/orders?workdayId=${batch.workdayId}`);
  const mine = orders.filter(({ orderId }) => ours.has(orderId));
  const byStatus = Object.groupBy(mine, ({ status }) => status);
  const delivered = byStatus.DELIVERED?.length ?? 0;
  const counts = Object.entries(byStatus).map(([status, list]) => `${status} ${list.length}`);
  console.log(`${((Date.now() - startedAt) / 1_000).toFixed(1)} s  ${counts.join(', ')}`);

  if (delivered === ours.size) break;
  if (Date.now() - startedAt > timeoutMs) {
    fail(`only ${delivered} of ${ours.size} dishes were delivered in ${timeoutMs / 1_000} s`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

// The warehouse never hands out a unit it does not have (PLANNING §3.3).
const { ingredients } = await call(`${warehouseUrl}/inventory`);
const negative = ingredients.filter(({ stock }) => stock < 0);
if (negative.length > 0) {
  fail(
    `negative stock: ${negative.map(({ ingredient, stock }) => `${ingredient} ${stock}`).join(', ')}`,
  );
}

console.log(`✔ ${dishes} dishes delivered in ${((Date.now() - startedAt) / 1_000).toFixed(1)} s`);

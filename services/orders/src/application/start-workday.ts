import { randomUUID } from 'node:crypto';

import { announcePendingWorkdays } from './announce-workdays';
import type { EventPublisher, OrdersRepository } from './ports';

/** A new workday was asked for while orders are still in progress; the entrypoint answers 409. */
export class WorkdayInProgressError extends Error {
  constructor(readonly ordersInProgress: number) {
    super(
      `A new workday can start once every order is delivered: ${String(ordersInProgress)} still in progress`,
    );
    this.name = 'WorkdayInProgressError';
  }
}

type Deps = { orders: OrdersRepository; publisher: EventPublisher };

/**
 * Switches the active workday, unless another request got there first: then the workday that
 * won is returned, since the manager wanted a new workday and it exists (PLANNING §3.7).
 */
async function switchTo(deps: Deps, from: string | undefined): Promise<{ workdayId: string }> {
  const next = randomUUID();
  if (!(await deps.orders.switchWorkday(from, next))) {
    return { workdayId: (await deps.orders.activeWorkday()) as string };
  }
  await announcePendingWorkdays(deps);
  return { workdayId: next };
}

/** Handles POST /workdays: the warehouse goes back to 5 units of each ingredient (§3.7). */
export function startWorkday(deps: Deps) {
  return async (): Promise<{ workdayId: string }> => {
    await announcePendingWorkdays(deps);

    const current = await deps.orders.activeWorkday();
    if (current) {
      const inProgress = await deps.orders.countInProgress(current);
      if (inProgress > 0) {
        throw new WorkdayInProgressError(inProgress);
      }
    }
    return switchTo(deps, current);
  };
}

/** Runs when the service starts: creates the first workday if there is none (idempotent). */
export function seedFirstWorkday(deps: Deps) {
  return async (): Promise<{ workdayId: string }> => {
    await announcePendingWorkdays(deps);

    const current = await deps.orders.activeWorkday();
    return current ? { workdayId: current } : switchTo(deps, undefined);
  };
}

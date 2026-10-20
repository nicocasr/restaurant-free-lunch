import { createEvent } from '@alegra-lunch/contracts';

import type { EventPublisher, OrdersRepository } from './ports';

/**
 * Publishes WorkdayStarted for every workday that became active without being announced,
 * because the process that switched to it died before publishing (PLANNING §3.5).
 */
export async function announcePendingWorkdays(deps: {
  orders: OrdersRepository;
  publisher: EventPublisher;
}): Promise<void> {
  for (const workdayId of await deps.orders.pendingWorkdays()) {
    await deps.publisher.publish(
      createEvent('WorkdayStarted', { workdayId }, { correlationId: workdayId }),
    );
    await deps.orders.markWorkdayAnnounced(workdayId);
  }
}

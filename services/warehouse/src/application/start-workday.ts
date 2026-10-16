import type { EventEnvelope } from '@alegra-lunch/contracts';

import { initialStock } from '../domain/stock';
import type { WarehouseRepository } from './ports';

/** Handles WorkdayStarted: every workday begins with the initial stock (PLANNING §3.7). */
export function startWorkday(deps: { warehouse: WarehouseRepository }) {
  return async (event: EventEnvelope<'WorkdayStarted'>): Promise<void> => {
    await deps.warehouse.startWorkday(event.payload.workdayId, initialStock());
  };
}

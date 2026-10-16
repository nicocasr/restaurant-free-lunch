import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';

import { startWorkday } from '../../src/application/start-workday';
import { initialStock } from '../../src/domain/stock';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';
import { stockOf } from '../support/stock';

function workdayStarted(workdayId: string) {
  return createEvent('WorkdayStarted', { workdayId }, { correlationId: randomUUID() });
}

describe('startWorkday', () => {
  it('fills the warehouse with 5 units of each ingredient', async () => {
    const warehouse = new InMemoryWarehouse();

    await startWorkday({ warehouse })(workdayStarted(randomUUID()));

    expect(warehouse.stock).toEqual(initialStock());
  });

  it('resets whatever the previous workday left', async () => {
    const warehouse = new InMemoryWarehouse();
    const handle = startWorkday({ warehouse });
    await handle(workdayStarted(randomUUID()));
    warehouse.stock = stockOf({ onion: 1, potato: 9 });

    await handle(workdayStarted(randomUUID()));

    expect(warehouse.stock).toEqual(initialStock());
  });

  it('ignores a repeated WorkdayStarted, so it never resets the stock in the middle of a workday', async () => {
    const warehouse = new InMemoryWarehouse();
    const handle = startWorkday({ warehouse });
    const event = workdayStarted(randomUUID());
    await handle(event);
    warehouse.stock = stockOf({ onion: 2 });

    await handle(event);

    expect(warehouse.stock).toEqual(stockOf({ onion: 2 }));
  });
});

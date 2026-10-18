import { randomUUID } from 'node:crypto';

import { INGREDIENTS } from '@alegra-lunch/contracts';

import { getInventory } from '../../src/application/get-inventory';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';
import { changua } from '../support/recipes';
import { stockOf } from '../support/stock';

describe('getInventory', () => {
  it('shows the stock and the demand of every ingredient, for the dashboard', async () => {
    const warehouse = new InMemoryWarehouse();
    const workdayId = randomUUID();
    await warehouse.startWorkday(workdayId, stockOf({ onion: 0, cheese: 5 }));
    await warehouse.enqueue({
      orderId: randomUUID(),
      workdayId,
      waitingSince: '2026-10-22T12:00:00.000Z',
      needs: changua,
    });

    const inventory = await getInventory({ warehouse })();

    expect(inventory.workdayId).toBe(workdayId);
    expect(inventory.waitingOrders).toBe(1);
    expect(inventory.ingredients.map(({ ingredient }) => ingredient)).toEqual([...INGREDIENTS]);
    expect(inventory.ingredients.find(({ ingredient }) => ingredient === 'onion')).toEqual({
      ingredient: 'onion',
      stock: 0,
      waitingNeed: 1,
      inFlight: 0,
    });
    expect(inventory.ingredients.find(({ ingredient }) => ingredient === 'cheese')?.stock).toBe(5);
  });
});

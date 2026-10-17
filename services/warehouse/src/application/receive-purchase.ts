import type { EventEnvelope } from '@alegra-lunch/contracts';

import type { EventPublisher, WarehouseRepository } from './ports';

/** Handles IngredientPurchased: adds what the market sold to the stock (§3.5, step 3). */
export function receivePurchase(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientPurchased'>): Promise<void> => {
    const { purchaseId, ingredient, quantity } = event.payload;
    await deps.warehouse.applyPurchase({ purchaseId, ingredient, quantity });
  };
}

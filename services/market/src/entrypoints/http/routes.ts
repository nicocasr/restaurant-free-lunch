import type { Route } from '@alegra-lunch/shared';
import { z } from 'zod';

import type { PurchaseRepository } from '../../application/ports';

const WorkdayIdSchema = z.uuid();

/** The query API of the market: what was bought at the farmers market (PLANNING §2). */
export function createRoutes(deps: { purchases: PurchaseRepository }): Route[] {
  return [
    {
      method: 'GET',
      path: '/purchases',
      handle: async ({ query }) => {
        // The market does not know the workdays: the dashboard asks for one by its id.
        const workdayId = WorkdayIdSchema.safeParse(query.get('workdayId'));
        if (!workdayId.success) {
          return { status: 400, body: { error: 'The workdayId query parameter must be a UUID' } };
        }
        const sales = await deps.purchases.listSales(workdayId.data);
        return { status: 200, body: { workdayId: workdayId.data, purchases: sales } };
      },
    },
  ];
}

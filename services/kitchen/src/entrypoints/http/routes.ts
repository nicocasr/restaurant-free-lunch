import type { Route } from '@alegra-lunch/shared';

import { MENU } from '../../domain/menu';

/** The query API of the kitchen: the menu it picks from (PLANNING §4). */
export function createRoutes(): Route[] {
  return [
    { method: 'GET', path: '/recipes', handle: () => Promise.resolve({ status: 200, body: MENU }) },
  ];
}

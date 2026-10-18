import { ordersRepositoryContract } from '../contract/orders-repository.contract';
import { InMemoryOrders } from '../support/in-memory-orders';

ordersRepositoryContract('InMemoryOrders', () =>
  Promise.resolve({ repository: new InMemoryOrders() }),
);

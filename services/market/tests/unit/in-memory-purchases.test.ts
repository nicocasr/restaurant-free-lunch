import { purchaseRepositoryContract } from '../contract/purchase-repository.contract';
import { InMemoryPurchases } from '../support/in-memory-purchases';

purchaseRepositoryContract('InMemoryPurchases', () =>
  Promise.resolve({ repository: new InMemoryPurchases() }),
);

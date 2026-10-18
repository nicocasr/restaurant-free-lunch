import { kitchenRepositoryContract } from '../contract/kitchen-repository.contract';
import { InMemoryKitchen } from '../support/in-memory-kitchen';

kitchenRepositoryContract('InMemoryKitchen', () =>
  Promise.resolve({ repository: new InMemoryKitchen() }),
);

import { warehouseRepositoryContract } from '../contract/warehouse-repository.contract';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';

warehouseRepositoryContract('InMemoryWarehouse', () =>
  Promise.resolve({ repository: new InMemoryWarehouse() }),
);

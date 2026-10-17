import { CreateOrdersRequestSchema } from '../../src';

describe('CreateOrdersRequest', () => {
  it('accepts a positive whole number of dishes', () => {
    expect(CreateOrdersRequestSchema.parse({ quantity: 20 })).toEqual({ quantity: 20 });
  });

  it.each([0, -3, 2.5, '10'])('rejects a quantity of %p', (quantity) => {
    expect(CreateOrdersRequestSchema.safeParse({ quantity }).success).toBe(false);
  });
});

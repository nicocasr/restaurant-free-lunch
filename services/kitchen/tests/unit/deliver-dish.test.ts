import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';
import { InMemoryPublisher } from '@alegra-lunch/testing';

import { deliverDish } from '../../src/application/deliver-dish';
import { InMemoryKitchen } from '../support/in-memory-kitchen';

function ingredientsReserved(orderId: string, workdayId: string) {
  return createEvent(
    'IngredientsReserved',
    { orderId, workdayId },
    { correlationId: randomUUID() },
  );
}

async function setupWithAssignment(recipeId: string) {
  const kitchen = new InMemoryKitchen();
  const publisher = new InMemoryPublisher();
  const assignment = { orderId: randomUUID(), workdayId: randomUUID(), recipeId };
  await kitchen.assignOnce(assignment);
  return { assignment, publisher, handle: deliverDish({ kitchen, publisher }) };
}

describe('deliverDish', () => {
  it('delivers the dish of the recipe assigned to the order', async () => {
    const { assignment, publisher, handle } = await setupWithAssignment('changua');
    const reserved = ingredientsReserved(assignment.orderId, assignment.workdayId);

    await handle(reserved);

    expect(publisher.ofType('OrderDelivered')).toEqual([
      expect.objectContaining({
        correlationId: reserved.correlationId,
        payload: {
          orderId: assignment.orderId,
          workdayId: assignment.workdayId,
          recipeId: 'changua',
        },
      }),
    ]);
  });

  it('announces the delivery again when the message arrives twice (orders only moves forward)', async () => {
    const { assignment, publisher, handle } = await setupWithAssignment('ajiaco');
    const reserved = ingredientsReserved(assignment.orderId, assignment.workdayId);

    await handle(reserved);
    await handle(reserved);

    expect(publisher.ofType('OrderDelivered')).toHaveLength(2);
  });

  it('fails without delivering anything when the order has no recipe assigned', async () => {
    const kitchen = new InMemoryKitchen();
    const publisher = new InMemoryPublisher();
    const reserved = ingredientsReserved(randomUUID(), randomUUID());

    await expect(deliverDish({ kitchen, publisher })(reserved)).rejects.toThrow(
      reserved.payload.orderId,
    );
    expect(publisher.events).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';
import { InMemoryPublisher } from '@alegra-lunch/testing';

import { assignRecipe } from '../../src/application/assign-recipe';
import { InMemoryKitchen } from '../support/in-memory-kitchen';

function orderPlaced() {
  return createEvent(
    'OrderPlaced',
    { orderId: randomUUID(), workdayId: randomUUID() },
    { correlationId: randomUUID() },
  );
}

/** A random source that returns the given values, one per call. */
function sequence(...values: number[]): () => number {
  return () => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error('The random sequence ran out');
    }
    return value;
  };
}

function setup(random: () => number) {
  const kitchen = new InMemoryKitchen();
  const publisher = new InMemoryPublisher();
  return { kitchen, publisher, handle: assignRecipe({ kitchen, publisher, random }) };
}

describe('assignRecipe', () => {
  it('asks the warehouse for the ingredients of a randomly picked recipe', async () => {
    const { publisher, handle } = setup(sequence(0)); // 0 picks the first recipe: Ajiaco
    const order = orderPlaced();

    await handle(order);

    expect(publisher.ofType('IngredientsRequested')).toEqual([
      expect.objectContaining({
        correlationId: order.correlationId,
        payload: {
          orderId: order.payload.orderId,
          workdayId: order.payload.workdayId,
          recipeId: 'ajiaco',
          recipeName: 'Ajiaco santafereño',
          ingredients: [
            { ingredient: 'chicken', quantity: 2 },
            { ingredient: 'potato', quantity: 3 },
            { ingredient: 'onion', quantity: 1 },
            { ingredient: 'rice', quantity: 1 },
          ],
        },
      }),
    ]);
  });

  it('remembers the recipe assigned to the order', async () => {
    const { kitchen, handle } = setup(sequence(0.99)); // the last recipe: Mazamorra
    const order = orderPlaced();

    await handle(order);

    expect(kitchen.assignmentOf(order.payload.orderId)).toEqual({
      orderId: order.payload.orderId,
      workdayId: order.payload.workdayId,
      recipeId: 'mazamorra',
    });
  });

  it('keeps the first recipe when the message arrives twice, instead of drawing again', async () => {
    // The second draw would pick Mazamorra: the dish must still be an Ajiaco
    const { publisher, handle } = setup(sequence(0, 0.99));
    const order = orderPlaced();

    await handle(order);
    await handle(order);

    const requests = publisher.ofType('IngredientsRequested');
    expect(requests.map(({ payload }) => payload.recipeId)).toEqual(['ajiaco', 'ajiaco']);
  });

  it('keeps a single recipe when two copies of the message are processed at the same time', async () => {
    const { kitchen, publisher, handle } = setup(sequence(0, 0.99));
    const order = orderPlaced();

    await Promise.all([handle(order), handle(order)]);

    const recipeIds = publisher
      .ofType('IngredientsRequested')
      .map(({ payload }) => payload.recipeId);
    expect(new Set(recipeIds).size).toBe(1);
    expect(kitchen.assignmentOf(order.payload.orderId)?.recipeId).toBe(recipeIds[0]);
  });
});

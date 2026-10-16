import { randomUUID } from 'node:crypto';

import { EVENT_TYPES, InvalidEventError, createEvent, parseEvent } from '../src';

const correlationId = randomUUID();
const workdayId = randomUUID();
const orderId = randomUUID();

function envelope(type: string, payload: unknown): Record<string, unknown> {
  return {
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId,
    payload,
  };
}

describe('event catalog', () => {
  it('defines one event per step of the order flow', () => {
    expect([...EVENT_TYPES].sort()).toEqual(
      [
        'WorkdayStarted',
        'OrderPlaced',
        'IngredientsRequested',
        'OrderWaitingIngredients',
        'IngredientsReserved',
        'StockShortage',
        'IngredientPurchased',
        'OrderDelivered',
      ].sort(),
    );
  });
});

describe('createEvent', () => {
  it('wraps the payload in a versioned envelope with a unique id and timestamp', () => {
    const event = createEvent('OrderPlaced', { orderId, workdayId }, { correlationId });

    expect(event.type).toBe('OrderPlaced');
    expect(event.version).toBe(1);
    expect(event.correlationId).toBe(correlationId);
    expect(event.payload).toEqual({ orderId, workdayId });
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
    expect(event.id).not.toBe(
      createEvent('OrderPlaced', { orderId, workdayId }, { correlationId }).id,
    );
  });

  it('produces events that parseEvent accepts (producer and consumer agree)', () => {
    const event = createEvent(
      'IngredientsRequested',
      {
        orderId,
        workdayId,
        recipeId: 'ajiaco',
        recipeName: 'Ajiaco santafereño',
        ingredients: [
          { ingredient: 'chicken', quantity: 2 },
          { ingredient: 'potato', quantity: 3 },
        ],
      },
      { correlationId },
    );

    expect(parseEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });

  it('refuses to create an event with an invalid payload', () => {
    expect(() =>
      createEvent(
        'StockShortage',
        { shortageId: randomUUID(), workdayId, ingredient: 'onion', quantity: 0 },
        { correlationId },
      ),
    ).toThrow(InvalidEventError);
  });
});

describe('parseEvent', () => {
  it.each([
    ['WorkdayStarted', { workdayId }],
    ['OrderPlaced', { orderId, workdayId }],
    [
      'IngredientsRequested',
      {
        orderId,
        workdayId,
        recipeId: 'changua',
        recipeName: 'Changua con queso',
        ingredients: [{ ingredient: 'cheese', quantity: 2 }],
      },
    ],
    [
      'OrderWaitingIngredients',
      { orderId, workdayId, missing: [{ ingredient: 'onion', quantity: 1 }] },
    ],
    ['IngredientsReserved', { orderId, workdayId }],
    ['StockShortage', { shortageId: randomUUID(), workdayId, ingredient: 'onion', quantity: 3 }],
    [
      'IngredientPurchased',
      {
        purchaseId: randomUUID(),
        shortageId: randomUUID(),
        workdayId,
        ingredient: 'onion',
        quantity: 4,
      },
    ],
    ['OrderDelivered', { orderId, workdayId, recipeId: 'ajiaco' }],
  ])('accepts a valid %s event', (type, payload) => {
    expect(parseEvent(envelope(type, payload)).type).toBe(type);
  });

  it('rejects an unknown event type', () => {
    expect(() => parseEvent(envelope('OrderCancelled', { orderId }))).toThrow(InvalidEventError);
  });

  it('rejects an unsupported version', () => {
    const event = { ...envelope('OrderPlaced', { orderId, workdayId }), version: 2 };
    expect(() => parseEvent(event)).toThrow(InvalidEventError);
  });

  it.each(['id', 'occurredAt', 'correlationId', 'payload'])(
    'rejects an envelope without %s',
    (field) => {
      const event = Object.fromEntries(
        Object.entries(envelope('OrderPlaced', { orderId, workdayId })).filter(
          ([key]) => key !== field,
        ),
      );
      expect(() => parseEvent(event)).toThrow(InvalidEventError);
    },
  );

  it('rejects an unknown ingredient', () => {
    const event = envelope('StockShortage', {
      shortageId: randomUUID(),
      workdayId,
      ingredient: 'garlic',
      quantity: 1,
    });
    expect(() => parseEvent(event)).toThrow(InvalidEventError);
  });

  it.each([0, -1, 1.5])('rejects a purchased quantity of %p', (quantity) => {
    const event = envelope('IngredientPurchased', {
      purchaseId: randomUUID(),
      shortageId: randomUUID(),
      workdayId,
      ingredient: 'onion',
      quantity,
    });
    expect(() => parseEvent(event)).toThrow(InvalidEventError);
  });

  it('rejects a recipe request without ingredients', () => {
    const event = envelope('IngredientsRequested', {
      orderId,
      workdayId,
      recipeId: 'ajiaco',
      recipeName: 'Ajiaco santafereño',
      ingredients: [],
    });
    expect(() => parseEvent(event)).toThrow(InvalidEventError);
  });

  it('rejects a waiting order without missing ingredients', () => {
    const event = envelope('OrderWaitingIngredients', { orderId, workdayId, missing: [] });
    expect(() => parseEvent(event)).toThrow(InvalidEventError);
  });

  it('reports which fields are invalid', () => {
    const event = envelope('OrderPlaced', { orderId: 'not-a-uuid', workdayId });
    expect(() => parseEvent(event)).toThrow(/orderId/);
  });
});

import { EVENT_TYPES } from '@alegra-lunch/contracts';

import { ORDER_STATUSES, advance, isInProgress, statusFor } from '../../src/domain/order-status';

describe('order status', () => {
  it('follows the order flow of PLANNING §3.2', () => {
    expect(ORDER_STATUSES).toEqual([
      'PLACED',
      'COOKING_REQUESTED',
      'WAITING_INGREDIENTS',
      'PREPARING',
      'DELIVERED',
    ]);
  });

  describe('statusFor', () => {
    it.each([
      ['OrderPlaced', 'PLACED'],
      ['IngredientsRequested', 'COOKING_REQUESTED'],
      ['OrderWaitingIngredients', 'WAITING_INGREDIENTS'],
      ['IngredientsReserved', 'PREPARING'],
      ['OrderDelivered', 'DELIVERED'],
    ] as const)('maps %s to %s', (type, status) => {
      expect(statusFor(type)).toBe(status);
    });

    it('ignores the events that do not move an order', () => {
      const orderEvents = new Set([
        'OrderPlaced',
        'IngredientsRequested',
        'OrderWaitingIngredients',
        'IngredientsReserved',
        'OrderDelivered',
      ]);
      for (const type of EVENT_TYPES.filter((each) => !orderEvents.has(each))) {
        expect(statusFor(type)).toBeUndefined();
      }
    });
  });

  describe('advance', () => {
    it('moves forward', () => {
      expect(advance('PLACED', 'COOKING_REQUESTED')).toBe('COOKING_REQUESTED');
      expect(advance('WAITING_INGREDIENTS', 'PREPARING')).toBe('PREPARING');
    });

    it('can skip the wait when the warehouse had every ingredient', () => {
      expect(advance('COOKING_REQUESTED', 'PREPARING')).toBe('PREPARING');
    });

    it('never moves back when an event arrives late or out of order', () => {
      expect(advance('DELIVERED', 'PREPARING')).toBe('DELIVERED');
      expect(advance('PREPARING', 'WAITING_INGREDIENTS')).toBe('PREPARING');
      expect(advance('COOKING_REQUESTED', 'PLACED')).toBe('COOKING_REQUESTED');
    });

    it('stays the same when the same event arrives twice', () => {
      expect(advance('PREPARING', 'PREPARING')).toBe('PREPARING');
    });
  });

  describe('isInProgress', () => {
    it('treats every status before DELIVERED as in progress', () => {
      expect(ORDER_STATUSES.filter(isInProgress)).toEqual([
        'PLACED',
        'COOKING_REQUESTED',
        'WAITING_INGREDIENTS',
        'PREPARING',
      ]);
    });
  });
});

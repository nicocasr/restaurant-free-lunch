import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { IngredientQuantitySchema, IngredientSchema } from './ingredients';

const positiveInt = z.int().positive();

/**
 * Tolerant reader: every schema keeps the fields it does not know instead of dropping them.
 * Services deploy one at a time, so a producer may add an optional field before a consumer
 * knows it; a service in between (realtime) must forward it untouched.
 *
 * Payload schemas, one per event. Every event carries the workday it belongs to,
 * so history can be grouped by workday (PLANNING §3.7).
 */
const payloadSchemas = {
  /** orders → warehouse: a new workday began; the warehouse resets to 5 units of each ingredient. */
  WorkdayStarted: z.looseObject({ workdayId: z.uuid() }),

  /** orders → kitchen: one event per dish. */
  OrderPlaced: z.looseObject({
    orderId: z.uuid(),
    workdayId: z.uuid(),
    // The click of the manager the dish belongs to. Optional, so consumers of version 1
    // keep working: adding a field this way does not break the contract.
    batchId: z.uuid().optional(),
  }),

  /** kitchen → warehouse: the randomly chosen recipe and the ingredients it needs. */
  IngredientsRequested: z.looseObject({
    orderId: z.uuid(),
    workdayId: z.uuid(),
    recipeId: z.string().min(1),
    recipeName: z.string().min(1),
    ingredients: z.array(IngredientQuantitySchema).nonempty(),
  }),

  /** warehouse → orders: the order joined the waiting list, with what it still lacks. */
  OrderWaitingIngredients: z.looseObject({
    orderId: z.uuid(),
    workdayId: z.uuid(),
    missing: z.array(IngredientQuantitySchema).nonempty(),
  }),

  /** warehouse → kitchen: every ingredient was reserved and deducted atomically. */
  IngredientsReserved: z.looseObject({ orderId: z.uuid(), workdayId: z.uuid() }),

  /** warehouse → market: aggregated demand for one ingredient, not tied to any order. */
  StockShortage: z.looseObject({
    shortageId: z.uuid(),
    workdayId: z.uuid(),
    ingredient: IngredientSchema,
    quantity: positiveInt,
  }),

  /** market → warehouse: one successful call to the farmers market. */
  IngredientPurchased: z.looseObject({
    purchaseId: z.uuid(),
    shortageId: z.uuid(),
    workdayId: z.uuid(),
    ingredient: IngredientSchema,
    quantity: positiveInt,
  }),

  /** kitchen → orders: the dish was prepared and handed out. */
  OrderDelivered: z.looseObject({
    orderId: z.uuid(),
    workdayId: z.uuid(),
    recipeId: z.string().min(1),
  }),
} as const;

type PayloadSchemas = typeof payloadSchemas;

export type EventType = keyof PayloadSchemas;
export const EVENT_TYPES = Object.keys(payloadSchemas) as EventType[];

export type EventPayload<T extends EventType> = z.infer<PayloadSchemas[T]>;

export interface EventEnvelope<T extends EventType = EventType> {
  id: string;
  type: T;
  version: 1;
  occurredAt: string;
  correlationId: string;
  payload: EventPayload<T>;
}

/** Any event of the catalog, narrowed by `type`. */
export type DomainEvent = { [T in EventType]: EventEnvelope<T> }[EventType];

function envelopeSchema<T extends EventType>(type: T) {
  return z.looseObject({
    id: z.uuid(),
    type: z.literal(type),
    version: z.literal(1),
    occurredAt: z.iso.datetime(),
    correlationId: z.uuid(),
    payload: payloadSchemas[type],
  });
}

const DomainEventSchema = z.discriminatedUnion(
  'type',
  EVENT_TYPES.map(envelopeSchema) as unknown as [
    ReturnType<typeof envelopeSchema>,
    ...ReturnType<typeof envelopeSchema>[],
  ],
);

/** Thrown when a message does not match the contract. Consumers send these to the DLQ. */
export class InvalidEventError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super(`Invalid event: ${z.prettifyError(new z.ZodError(issues))}`);
    this.name = 'InvalidEventError';
  }
}

/** Validates an incoming message at runtime and returns it typed. */
export function parseEvent(input: unknown): DomainEvent {
  const result = DomainEventSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidEventError(result.error.issues);
  }
  return result.data as DomainEvent;
}

/** Builds a valid event; producers never publish a payload that breaks the contract. */
export function createEvent<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
  context: { correlationId: string },
): EventEnvelope<T> {
  const event = {
    id: randomUUID(),
    type,
    version: 1 as const,
    occurredAt: new Date().toISOString(),
    correlationId: context.correlationId,
    payload,
  };
  parseEvent(event);
  return event;
}

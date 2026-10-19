import { parseEvent, type DomainEvent } from '@alegra-lunch/contracts';

/** What a handler may ask for: nothing (done), or to see the message again later. */
export type MessageHandler = (
  event: DomainEvent,
) => Promise<{ retryAfterSeconds: number } | undefined>;

/**
 * A failed message comes back after 1 s, 2 s, 4 s… up to this, instead of the full timeout.
 * Like the market retries, it stays at 10 s: a transient error should not hold an order long.
 */
const MAX_FAILURE_DELAY_SECONDS = 10;

export type MessageOutcome =
  | { kind: 'done'; event: DomainEvent }
  | { kind: 'retry'; seconds: number; event: DomainEvent; error?: unknown }
  | { kind: 'invalid'; error: unknown };

/**
 * What to do with one message of a queue (PLANNING §3.2 and §3.3), the same in a container and
 * in Lambda, which only differ in how they carry the outcome out:
 * - valid and handled: done, so it is deleted;
 * - the handler asks to retry later (the market had nothing to sell): retry after that long;
 * - the handler fails (a transient error): retry after a short delay that grows per receive;
 * - not JSON or breaks the contract: invalid, for the DLQ, since retrying never helps.
 */
export async function handleMessage(
  body: string,
  receiveCount: number,
  handle: MessageHandler,
): Promise<MessageOutcome> {
  let event: DomainEvent;
  try {
    event = parseEvent(JSON.parse(body));
  } catch (error) {
    return { kind: 'invalid', error };
  }

  try {
    const result = await handle(event);
    return result
      ? { kind: 'retry', seconds: result.retryAfterSeconds, event }
      : { kind: 'done', event };
  } catch (error) {
    const seconds = Math.min(MAX_FAILURE_DELAY_SECONDS, 2 ** (receiveCount - 1));
    return { kind: 'retry', seconds, event, error };
  }
}

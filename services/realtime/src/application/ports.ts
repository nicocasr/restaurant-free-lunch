/**
 * The dashboards connected right now: in memory with ws locally, in the connections table with
 * API Gateway WebSocket in AWS, where each Lambda is independent (PLANNING §3.1).
 */
export interface Connections {
  list(): Promise<string[]>;

  /** 'gone' means the dashboard closed without saying goodbye. */
  send(connectionId: string, message: string): Promise<'sent' | 'gone'>;

  remove(connectionId: string): Promise<void>;
}

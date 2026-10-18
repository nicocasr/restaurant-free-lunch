import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import WebSocket, { WebSocketServer } from 'ws';

import type { Connections } from '../application/ports';

/**
 * Local adapter of the connections port: a WebSocket server with ws on top of node:http
 * (PLANNING §2). In AWS, API Gateway WebSocket plays this role instead.
 */
export class WebSocketHub implements Connections {
  private readonly server: WebSocketServer;
  private readonly sockets = new Map<string, WebSocket>();

  constructor(deps: { server: Server; path: string }) {
    this.server = new WebSocketServer({ server: deps.server, path: deps.path });
    this.server.on('connection', (socket) => {
      const connectionId = randomUUID();
      this.sockets.set(connectionId, socket);
      socket.on('close', () => this.sockets.delete(connectionId));
    });
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.sockets.keys()]);
  }

  async send(connectionId: string, message: string): Promise<'sent' | 'gone'> {
    const socket = this.sockets.get(connectionId);
    if (socket?.readyState !== WebSocket.OPEN) {
      return 'gone';
    }
    await new Promise<void>((resolve, reject) => {
      socket.send(message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    return 'sent';
  }

  remove(connectionId: string): Promise<void> {
    this.sockets.get(connectionId)?.terminate();
    this.sockets.delete(connectionId);
    return Promise.resolve();
  }

  /** Closes every connection, so the process can stop. */
  async close(): Promise<void> {
    for (const socket of this.sockets.values()) {
      socket.terminate();
    }
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

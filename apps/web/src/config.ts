/** Where the services answer: localhost for docker compose, API Gateway URLs in AWS. */
export const config = {
  ordersUrl: import.meta.env.VITE_ORDERS_URL ?? 'http://localhost:3000',
  warehouseUrl: import.meta.env.VITE_WAREHOUSE_URL ?? 'http://localhost:3001',
  kitchenUrl: import.meta.env.VITE_KITCHEN_URL ?? 'http://localhost:3002',
  marketUrl: import.meta.env.VITE_MARKET_URL ?? 'http://localhost:3003',
  realtimeUrl: import.meta.env.VITE_REALTIME_URL ?? 'ws://localhost:3004/ws',
};

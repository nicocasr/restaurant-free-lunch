import { z } from 'zod';

/** Body of `POST /orders`. The upper limit is configured by the orders service. */
export const CreateOrdersRequestSchema = z.object({
  quantity: z.int().positive(),
});
export type CreateOrdersRequest = z.infer<typeof CreateOrdersRequestSchema>;

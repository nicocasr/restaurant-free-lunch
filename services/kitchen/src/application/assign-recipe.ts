import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import { MENU, type Recipe } from '../domain/menu';
import { pickRecipe, type RandomSource } from '../domain/pick-recipe';
import type { EventPublisher, KitchenRepository } from './ports';

/** Handles OrderPlaced: draws a recipe for the dish and asks the warehouse for its ingredients. */
export function assignRecipe(deps: {
  kitchen: KitchenRepository;
  publisher: EventPublisher;
  random?: RandomSource;
}) {
  return async (event: EventEnvelope<'OrderPlaced'>): Promise<void> => {
    const { orderId, workdayId } = event.payload;

    // The stored assignment wins over this draw, so a repeated message never changes the dish.
    const drawn = pickRecipe(deps.random);
    const { recipeId } = await deps.kitchen.assignOnce({ orderId, workdayId, recipeId: drawn.id });
    const recipe = MENU.find(({ id }) => id === recipeId) as Recipe;

    await deps.publisher.publish(
      createEvent(
        'IngredientsRequested',
        {
          orderId,
          workdayId,
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingredients: recipe.ingredients,
        },
        { correlationId: event.correlationId },
      ),
    );
  };
}

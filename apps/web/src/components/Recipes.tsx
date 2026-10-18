import type { Recipe } from '../api';

/** "Recetas disponibles con sus ingredientes" (PLANNING §4). */
export function Recipes(props: { recipes: Recipe[] }) {
  return (
    <section className="card">
      <h2>Menu</h2>
      <ul className="recipes">
        {props.recipes.map((recipe) => (
          <li key={recipe.id}>
            <strong>{recipe.name}</strong>
            <div>
              {recipe.ingredients.map(({ ingredient, quantity }) => (
                <span key={ingredient} className="chip small">
                  {ingredient} ×{quantity}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

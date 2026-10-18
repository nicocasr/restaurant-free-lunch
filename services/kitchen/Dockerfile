# Built from the repository root: docker build -f services/kitchen/Dockerfile .
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages
COPY services services
RUN npm ci
RUN npm run build -w @alegra-lunch/contracts -w @alegra-lunch/shared -w @alegra-lunch/kitchen
# Keep only what runs in production: no TypeScript, Jest or test doubles
RUN npm prune --omit=dev

FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/contracts packages/contracts
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/services/kitchen services/kitchen
USER node
CMD ["node", "services/kitchen/dist/entrypoints/container/main.js"]

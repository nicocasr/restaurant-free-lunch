# Built from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages
COPY services services
COPY apps apps
RUN npm ci
# The browser calls the services directly, so their URLs are fixed when the page is built.
ARG VITE_ORDERS_URL=http://localhost:3000
ARG VITE_WAREHOUSE_URL=http://localhost:3001
ARG VITE_KITCHEN_URL=http://localhost:3002
ARG VITE_MARKET_URL=http://localhost:3003
ARG VITE_REALTIME_URL=ws://localhost:3004/ws
RUN npm run build -w @alegra-lunch/web

FROM nginx:1.31.6-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

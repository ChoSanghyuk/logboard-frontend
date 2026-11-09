# Logboard frontend: Vite build served by nginx (SPA + /api, /mcp proxy to backend:8080).
# Classic builder compatible (no BuildKit features); the root docker-compose.yml builds it.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80

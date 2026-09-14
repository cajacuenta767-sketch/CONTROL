# CONTROL · imagen única: API + panel compilado
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PUERTO=4100 BASE_DATOS=/datos/control.db
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /datos && chown -R node:node /datos /app
USER node
VOLUME ["/datos"]
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4100/api/v1/salud || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "backend/src/index.js"]

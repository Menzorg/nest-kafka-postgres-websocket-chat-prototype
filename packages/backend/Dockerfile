# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем package.json из всех пакетов
COPY package*.json ./
COPY packages/common/package*.json ./packages/common/
COPY packages/backend/package*.json ./packages/backend/

# Копируем общие файлы монорепозитория
COPY tsconfig*.json ./
COPY packages/common/tsconfig*.json ./packages/common/
COPY packages/backend/tsconfig*.json ./packages/backend/

# Устанавливаем зависимости
RUN npm install

# Копируем и собираем common пакет
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npm run build

# Копируем исходники бэкенда
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/nest-cli.json ./packages/backend/

# Собираем бэкенд
WORKDIR /app/packages/backend
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Копируем package.json и устанавливаем только production зависимости
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/common/package*.json ./packages/common/
COPY --from=builder /app/packages/backend/package*.json ./packages/backend/
RUN npm install --production

# Копируем собранные файлы
COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

WORKDIR /app/packages/backend

# Запускаем сервер
CMD ["npm", "run", "start:prod"]

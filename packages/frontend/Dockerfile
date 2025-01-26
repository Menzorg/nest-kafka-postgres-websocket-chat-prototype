# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем package.json из всех пакетов
COPY package*.json ./
COPY packages/common/package*.json ./packages/common/
COPY packages/frontend/package*.json ./packages/frontend/

# Копируем общие файлы монорепозитория
COPY tsconfig*.json ./
COPY packages/common/tsconfig*.json ./packages/common/
COPY packages/frontend/tsconfig*.json ./packages/frontend/

# Устанавливаем зависимости
RUN npm install

# Копируем и собираем common пакет
COPY packages/common ./packages/common
RUN cd packages/common && npm run build

# Копируем все файлы фронтенда
COPY packages/frontend ./packages/frontend

# Собираем фронтенд
WORKDIR /app/packages/frontend
ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_PUBLIC_BACKEND_URL http://localhost:4000
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Создаем пользователя nextjs
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Копируем package.json и устанавливаем зависимости
COPY --from=builder /app/packages/frontend/package*.json ./
RUN npm install --production

# Копируем собранные файлы
COPY --from=builder /app/packages/frontend/.next/standalone/packages/frontend/* ./

# Копируем всю .next директорию
COPY --from=builder /app/packages/frontend/.next ./.next

# Копируем публичные файлы
COPY --from=builder /app/packages/frontend/public ./public

# Устанавливаем правильные разрешения
RUN chown -R nextjs:nodejs /app

# Переключаемся на пользователя nextjs
USER nextjs

# Устанавливаем переменные окружения для production
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV PORT 3000

# Открываем порт
EXPOSE 3000

# Запускаем сервер
CMD ["npm", "start"]

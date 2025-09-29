# Next.js подсистема

## Роль в проекте

Next.js используется как основной frontend фреймворк для создания пользовательского интерфейса чата. Он предоставляет:
- Server-Side Rendering (SSR) и Static Site Generation (SSG)
- Роутинг на основе файловой системы
- Оптимизация производительности с помощью TurboPack
- TypeScript поддержку из коробки
- Интеграцию с Tailwind CSS для стилизации
- React 19 для построения интерфейсов

## Структура приложения

### Главный layout

**Файл:** `packages/frontend/src/app/layout.tsx`

Root layout определяет общую структуру всех страниц приложения:
- Метаданные приложения
- Глобальные стили
- Обертка для всех страниц

### Основные страницы

**Главная страница** (`packages/frontend/src/app/page.tsx`):
- Проверка аутентификации
- Редирект на login или отображение чата
- Интеграция с WebSocket

**Страница входа** (`packages/frontend/src/app/login/page.tsx`):
- Форма аутентификации
- JWT токен получение
- Редирект после успешного входа

**Страница регистрации** (`packages/frontend/src/app/register/page.tsx`):
- Форма создания аккаунта
- Валидация данных
- Автоматический вход после регистрации

## Компоненты

### Chat Component

**Файл:** `packages/frontend/src/app/components/Chat.tsx`

Основной компонент чата, который:
- Отображает список сообщений
- Обрабатывает отправку новых сообщений
- Показывает статус доставки
- Управляет прокруткой и UI состоянием

### UsersList Component

**Файл:** `packages/frontend/src/app/components/UsersList.tsx`

Компонент списка пользователей:
- Отображение онлайн/офлайн статуса
- Возможность начать чат с пользователем
- Индикация активности

### UserStatus Component

**Файл:** `packages/frontend/src/app/components/UserStatus.tsx`

Компонент статуса пользователя:
- Индикатор онлайн/офлайн
- Отображение имени пользователя
- Время последней активности

## Сервисы

### SocketService

**Файл:** `packages/frontend/src/app/services/socketService.ts:1-200`

Централизованный сервис для управления WebSocket соединениями:

```typescript
class SocketService {
  private socket: Socket | null = null;
  private token: string | null = null;
  private connectionTimeout: number = 15000;
  private reconnectionAttempts: number = 3;

  // Настройка соединения (строки 17-41)
  private setupSocketConnection(): Socket {
    this.socket = io(this.backendUrl, {
      auth: { token: this.token ? `Bearer ${this.token}` : null },
      transports: ['websocket'],
      timeout: this.connectionTimeout,
      reconnection: true,
      reconnectionAttempts: this.reconnectionAttempts,
    });
  }

  // Подключение (строки 79-103)
  async connect(token: string): Promise<void> {
    this.token = token;
    this.setupSocketConnection();
  }

  // Отправка сообщения (строки 130-140)
  sendMessage(event: string, data: any): void {
    this.socket?.emit(event, data);
  }

  // Подписка на события (строки 142-150)
  on(event: string, callback: Function): void {
    this.socket?.on(event, callback);
  }
}
```

## State Management

### Zustand Store

**Используется библиотека:** `zustand@^5.0.3` (`packages/frontend/package.json:16`)

State management реализован с помощью Zustand для:
- Хранения данных пользователя
- Управления списком чатов
- Кэширования сообщений
- Синхронизации UI состояний

## Custom Hooks

### useAuth Hook

**Файл:** `packages/frontend/src/app/hooks/useAuth.ts`

Hook для управления аутентификацией:
- Проверка токена
- Автоматическое обновление токена
- Logout функциональность
- Защита приватных роутов

### useSocket Hook

**Файл:** `packages/frontend/src/app/hooks/useSocket.ts`

Hook для работы с WebSocket:
- Автоматическое переподключение
- Обработка событий
- Управление состоянием соединения
- Очистка при размонтировании

## Типизация

### Types Definition

**Файл:** `packages/frontend/src/app/types.ts`

Определение TypeScript типов для:
- Пользователей
- Сообщений
- Чатов
- WebSocket событий
- API ответов

### Общие типы

**Файл:** `packages/common/src/types/`

Использование общих типов между frontend и backend для:
- Консистентности данных
- Type safety
- Автокомплита в IDE

## Стилизация

### Tailwind CSS

**Конфигурация:** `packages/frontend/tailwind.config.js`

Используется для:
- Utility-first CSS подхода
- Responsive дизайна
- Dark mode поддержки
- Кастомных компонентов

### Global Styles

**Файл:** `packages/frontend/src/app/globals.css`

Глобальные стили и переменные CSS.

## Конфигурация

### Next.js Config

**Файл:** `packages/frontend/next.config.js` (если существует)

Настройки:
- API routes
- Image optimization
- Environment variables
- Webpack конфигурация

### Environment Variables

Используемые переменные:
- `NEXT_PUBLIC_BACKEND_URL` - URL backend сервера (`packages/frontend/src/app/services/socketService.ts:9`)

## Build и оптимизация

### NPM Scripts

**Файл:** `packages/frontend/package.json:5-10`

```json
{
  "scripts": {
    "dev": "next dev --turbopack",      // Разработка с TurboPack
    "build": "next build",               // Production сборка
    "start": "next start",               // Запуск production сервера
    "lint": "next lint"                  // Линтинг кода
  }
}
```

### TurboPack

Используется TurboPack для ускорения разработки (`packages/frontend/package.json:6`):
- Быстрая Hot Module Replacement
- Инкрементальная компиляция
- Оптимизированный bundling

## Docker конфигурация

**Файл:** `packages/frontend/Dockerfile`

Контейнеризация приложения для deployment:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

**Docker Compose** (`docker-compose.yml:73-83`):
```yaml
frontend:
  build:
    context: .
    dockerfile: packages/frontend/Dockerfile
  ports:
    - "3000:3000"
  depends_on:
    - backend
  environment:
    - NODE_ENV=production
    - NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

## Роутинг

### App Router

Next.js 14+ использует App Router с файловой структурой:
- `/app/page.tsx` - главная страница
- `/app/login/page.tsx` - страница входа
- `/app/register/page.tsx` - страница регистрации

### Навигация

Используется `next/navigation` для:
- Программной навигации
- Защищенных маршрутов
- URL параметров

## Производительность

### Оптимизации

1. **Code Splitting**: Автоматическое разделение кода по страницам
2. **Image Optimization**: Встроенная оптимизация изображений через `next/image`
3. **Font Optimization**: Оптимизация загрузки шрифтов
4. **Prefetching**: Автоматическая предзагрузка ссылок

### React 19 Features

Использование новых возможностей React 19 (`packages/frontend/package.json:13`):
- Server Components
- Streaming SSR
- Concurrent Features
- Improved Suspense

## Тестирование

### Unit тесты

Настройка Jest для тестирования компонентов и логики.

### E2E тесты

Возможность использования Cypress или Playwright для end-to-end тестирования.

## Security

### CSP (Content Security Policy)

Настройка политик безопасности для защиты от XSS атак.

### Санитизация данных

Валидация и очистка пользовательского ввода перед отправкой на сервер.

### HTTPS

Использование безопасного соединения в production окружении.

## Интеграция с Backend

### API вызовы

Взаимодействие с NestJS backend через:
- REST API для CRUD операций
- WebSocket для real-time обновлений
- JWT токены для аутентификации

### Error Handling

Обработка ошибок:
- Network errors
- API errors
- WebSocket disconnections
- Graceful degradation

## Deployment

### Production Build

Оптимизированная сборка для production:
```bash
npm run build
npm run start
```

### Static Export

Возможность статического экспорта для CDN хостинга:
```bash
next export
```
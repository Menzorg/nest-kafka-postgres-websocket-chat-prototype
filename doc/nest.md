# NestJS подсистема

## Роль в проекте

NestJS выступает в качестве основного backend-фреймворка, предоставляя:
- RESTful API для взаимодействия с клиентом
- Архитектуру на основе модулей и dependency injection
- Интеграцию с базой данных через TypeORM
- WebSocket сервер для real-time коммуникаций
- Интеграцию с Apache Kafka для обработки сообщений
- JWT-аутентификацию и авторизацию
- Swagger документацию API

## Архитектура приложения

### Точка входа

**Файл:** `packages/backend/src/main.ts:1-42`

Основная функция bootstrap инициализирует приложение:
```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS настройки (строки 13-19)
  app.enableCors({
    origin: configService.get('FRONTEND_URL', 'http://localhost:3000'),
    credentials: true,
  });

  // WebSocket адаптер (строка 22)
  app.useWebSocketAdapter(new SocketAdapter(app));

  // Глобальная валидация (строка 25)
  app.useGlobalPipes(new ValidationPipe());

  // Swagger документация (строки 28-35)
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(4000);
}
```

### Главный модуль

**Файл:** `packages/backend/src/app.module.ts:20-99`

AppModule объединяет все подсистемы:
- ConfigModule - управление конфигурацией (строка 21-24)
- TypeOrmModule - интеграция с PostgreSQL (строки 25-43)
- AuthModule - аутентификация (строка 44)
- UserModule - управление пользователями (строка 45)
- ChatModule - функциональность чата (строка 46)
- SocketModule - WebSocket коммуникации (строка 47)
- HealthModule - health checks (строка 48)

## Модули и их функции

### Auth Module (Аутентификация)

**Файл:** `packages/backend/src/auth/auth.module.ts:7-31`

Модуль аутентификации включает:
- JWT стратегию для токенов
- Passport интеграцию
- Guards для защиты маршрутов

**AuthService** (`packages/backend/src/auth/auth.service.ts:13-93`):
- `register()` - регистрация пользователя (строки 25-44)
- `login()` - вход пользователя (строки 46-65)
- `validateUser()` - валидация учетных данных (строки 67-77)
- `verifyToken()` - проверка JWT токена (строки 86-93)

**JWT Guards**:
- HTTP Guard: `packages/backend/src/auth/jwt-auth.guard.ts:4-7`
- WebSocket Guard: `packages/backend/src/auth/ws-jwt.guard.ts:11-54`

### User Module (Управление пользователями)

**Файл:** `packages/backend/src/user/user.module.ts:6-14`

**UserService** (`packages/backend/src/user/user.service.ts:8-56`):
- `create()` - создание пользователя (строки 14-39)
- `findByEmail()` - поиск по email (строки 41-43)
- `findById()` - поиск по ID (строки 45-47)
- `updateOnlineStatus()` - обновление статуса (строки 49-55)

### Chat Module (Функциональность чата)

**Файл:** `packages/backend/src/chat/chat.module.ts:10-23`

**ChatController** (`packages/backend/src/chat/chat.controller.ts:8-49`):
- `POST /chats` - создание чата (строки 17-21)
- `GET /chats` - получение списка чатов (строки 23-27)
- `GET /chats/:chatId/messages` - история сообщений (строки 29-36)
- `POST /chats/:chatId/messages` - отправка сообщения (строки 38-48)

**ChatService** (`packages/backend/src/chat/chat.service.ts:20-553`):
- Управление чатами (строки 67-111)
- Обработка сообщений (строки 113-218)
- Интеграция с Kafka (строки 220-264)
- Управление доставкой сообщений (строки 266-384)

### Socket Module (WebSocket)

**Файл:** `packages/backend/src/socket/socket.module.ts:12-21`

Модуль обеспечивает real-time коммуникации через Socket.IO.
Детальное описание см. в документации WebSocket.

### Health Module (Мониторинг)

**Файл:** `packages/backend/src/health/health.module.ts:7-18`

**HealthController** (`packages/backend/src/health/health.controller.ts:9-31`):
- `GET /health` - проверка состояния сервиса (строки 15-20)
- `GET /health/db` - проверка БД (строки 22-30)

## Middleware и Interceptors

### Exception Filters

**AllExceptionsFilter** (`packages/backend/src/common/filters/all-exceptions.filter.ts`):
Глобальный обработчик исключений для HTTP запросов.

**WsExceptionsFilter** (`packages/backend/src/common/filters/ws-exceptions.filter.ts`):
Обработчик исключений для WebSocket соединений.

### Logging Interceptor

**Файл:** `packages/backend/src/common/interceptors/logging.interceptor.ts`

Логирует все входящие запросы и исходящие ответы с временем выполнения.

## Dependency Injection

NestJS использует паттерн Dependency Injection для управления зависимостями:

**Пример из ChatService** (`packages/backend/src/chat/chat.service.ts:35-43`):
```typescript
constructor(
  @InjectRepository(Chat) private chatRepository: Repository<Chat>,
  @InjectRepository(Message) private messageRepository: Repository<Message>,
  @InjectRepository(User) private userRepository: Repository<User>,
  private kafkaAdapter: KafkaAdapter,
  private socketGateway: SocketGateway,
) {}
```

## Декораторы и их использование

### Controller декораторы

**Файл:** `packages/backend/src/chat/chat.controller.ts`
- `@Controller('chats')` - определение контроллера (строка 8)
- `@UseGuards(JwtAuthGuard)` - защита маршрутов (строка 10)
- `@Get()`, `@Post()` - HTTP методы (строки 23, 17)
- `@Param()`, `@Body()`, `@Request()` - параметры запроса

### Service декораторы

- `@Injectable()` - маркирует класс как provider
- `@InjectRepository()` - инжектирует TypeORM репозиторий

### Entity декораторы

**Файл:** `packages/backend/src/user/entities/user.entity.ts`
- `@Entity()` - определение сущности (строка 7)
- `@Column()` - колонка БД (строка 20)
- `@PrimaryGeneratedColumn()` - первичный ключ (строка 13)
- `@BeforeInsert()` - хук перед вставкой (строка 26)

## Конфигурация

### Environment переменные

Используются через ConfigService:
- `DB_*` - настройки PostgreSQL
- `KAFKA_*` - настройки Kafka
- `JWT_SECRET` - секрет для JWT
- `FRONTEND_URL` - URL фронтенда для CORS

### Nest CLI конфигурация

**Файл:** `packages/backend/nest-cli.json`
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

## Тестирование

### Unit тесты

**Пример:** `packages/backend/src/chat/__tests__/chat.service.spec.ts`

Используется Jest с моками:
```typescript
beforeEach(async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChatService,
      { provide: getRepositoryToken(Chat), useValue: mockChatRepository },
      // ...
    ],
  }).compile();
});
```

### E2E тесты

Конфигурация: `packages/backend/src/__tests__/jest-e2e.json`

## Build и развертывание

### Dockerfile

**Файл:** `packages/backend/Dockerfile`
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "run", "start:prod"]
```

### NPM скрипты

**Файл:** `packages/backend/package.json:6-21`
- `npm run dev` - запуск в режиме разработки с hot-reload
- `npm run build` - сборка проекта
- `npm run start:prod` - запуск production сборки
- `npm run test` - запуск тестов
- `npm run lint` - проверка кода

## Graceful Shutdown

**Файл:** `packages/backend/src/app.module.ts:81-98`

При завершении работы приложение корректно:
1. Закрывает WebSocket соединения (строка 85)
2. Отключается от Kafka (строка 89)
3. Закрывает соединение с БД (строка 93)

## Документация API

Swagger UI доступен по адресу: `http://localhost:4000/api/docs`

Конфигурация в `packages/backend/src/main.ts:28-35`:
```typescript
const config = new DocumentBuilder()
  .setTitle('WebChat API')
  .setDescription('The WebChat API description')
  .setVersion('1.0')
  .addBearerAuth()
  .build();
```
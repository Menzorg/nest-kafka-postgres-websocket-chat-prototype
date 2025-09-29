# WebSocket подсистема

## Роль в проекте

WebSocket обеспечивает двустороннюю real-time коммуникацию между клиентом и сервером для:
- Мгновенной доставки сообщений всем участникам чата
- Отображения статуса пользователей (онлайн/офлайн)
- Уведомлений о наборе текста
- Подтверждений доставки и прочтения сообщений
- Синхронизации состояния между клиентами

## Серверная реализация (Backend)

### Socket Gateway

**Файл:** `packages/backend/src/socket/socket.gateway.ts:25-400`

Основной класс для управления WebSocket соединениями:

```typescript
@WebSocketGateway({
  cors: {
    credentials: true
  }
})
export class SocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly io: Server;
  private connectedClients: Map<string, ConnectedClient> = new Map();
}
```

### Socket Adapter

**Файл:** `packages/backend/src/socket/socket.adapter.ts`

Кастомный адаптер для интеграции Socket.IO с NestJS:
- Конфигурация CORS
- JWT middleware для аутентификации
- Настройка транспортов и таймаутов

Инициализация в main.ts (`packages/backend/src/main.ts:22`):
```typescript
app.useWebSocketAdapter(new SocketAdapter(app));
```

### Socket Module

**Файл:** `packages/backend/src/socket/socket.module.ts:12-21`

```typescript
@Module({
  imports: [AuthModule, ChatModule, UserModule],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
```

## Жизненный цикл соединения

### Инициализация Gateway

**Файл:** `packages/backend/src/socket/socket.gateway.ts:95-110`

```typescript
afterInit(server: Server) {
  this.logger.log('WebSocket Gateway initialized');

  // Настройка CORS после инициализации
  const corsOrigin = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
  server.engine.on('initial_headers', (headers: any, req: any) => {
    headers['Access-Control-Allow-Credentials'] = true;
  });

  // Запуск очистки мертвых соединений
  this.startCleanupInterval();
}
```

### Подключение клиента

**Файл:** `packages/backend/src/socket/socket.gateway.ts:112-155`

```typescript
async handleConnection(socket: Socket) {
  try {
    // Извлекаем токен из handshake
    const token = socket.handshake.auth.token?.replace('Bearer ', '');

    // Валидируем токен
    const payload = await this.jwtService.verifyAsync(token);

    // Находим пользователя
    const user = await this.authService.findUserById(payload.sub);

    // Сохраняем соединение
    socket.data.userId = user.id;
    socket.data.user = user;

    this.connectedClients.set(socket.id, {
      socket,
      userId: user.id,
      lastActivity: new Date(),
    });

    // Присоединяем к комнатам чатов
    const userChats = await this.chatService.getUserChats(user.id);
    for (const chat of userChats) {
      socket.join(`chat-${chat.id}`);
    }

    // Уведомляем о подключении
    socket.emit('connected', { userId: user.id });
    socket.broadcast.emit('user-online', { userId: user.id });

  } catch (error) {
    socket.emit('error', { message: 'Authentication failed' });
    socket.disconnect();
  }
}
```

### Отключение клиента

**Файл:** `packages/backend/src/socket/socket.gateway.ts:157-175`

```typescript
async handleDisconnect(socket: Socket) {
  const userId = socket.data.userId;

  if (userId) {
    // Удаляем из списка подключенных
    this.connectedClients.delete(socket.id);

    // Проверяем, есть ли другие соединения пользователя
    const hasOtherConnections = Array.from(this.connectedClients.values())
      .some(client => client.userId === userId);

    if (!hasOtherConnections) {
      // Уведомляем об офлайн статусе
      socket.broadcast.emit('user-offline', { userId });
    }
  }

  this.logger.log(`Client disconnected: ${socket.id}`);
}
```

## События WebSocket

### Отправка сообщения

**Файл:** `packages/backend/src/socket/socket.gateway.ts:177-230`

```typescript
@SubscribeMessage('send-message')
async handleSendMessage(
  @MessageBody() data: SendMessageDto,
  @ConnectedSocket() socket: Socket
) {
  try {
    const userId = socket.data.userId;

    // Создаем сообщение через ChatService
    const message = await this.chatService.sendMessage(
      data.chatId,
      userId,
      data.content
    );

    // Отправляем сообщение всем участникам чата
    this.io.to(`chat-${data.chatId}`).emit('new-message', {
      ...message,
      deliveryStatus: MessageDeliveryStatus.SENT
    });

    // Отправляем в Kafka для обработки
    await this.kafkaAdapter.publish('chat-messages', message);

    return { success: true, messageId: message.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### Присоединение к чату

**Файл:** `packages/backend/src/socket/socket.gateway.ts:232-250`

```typescript
@SubscribeMessage('join-chat')
async handleJoinChat(
  @MessageBody() data: { chatId: string },
  @ConnectedSocket() socket: Socket
) {
  const userId = socket.data.userId;

  // Проверяем доступ к чату
  const hasAccess = await this.chatService.userHasAccessToChat(userId, data.chatId);

  if (hasAccess) {
    socket.join(`chat-${data.chatId}`);

    // Загружаем историю сообщений
    const messages = await this.chatService.getChatMessages(data.chatId);

    return { success: true, messages };
  }

  return { success: false, error: 'Access denied' };
}
```

### Индикатор набора текста

**Файл:** `packages/backend/src/socket/socket.gateway.ts:252-270`

```typescript
@SubscribeMessage('typing-start')
handleTypingStart(
  @MessageBody() data: { chatId: string },
  @ConnectedSocket() socket: Socket
) {
  const userId = socket.data.userId;

  socket.to(`chat-${data.chatId}`).emit('user-typing', {
    userId,
    chatId: data.chatId
  });
}

@SubscribeMessage('typing-stop')
handleTypingStop(
  @MessageBody() data: { chatId: string },
  @ConnectedSocket() socket: Socket
) {
  const userId = socket.data.userId;

  socket.to(`chat-${data.chatId}`).emit('user-stopped-typing', {
    userId,
    chatId: data.chatId
  });
}
```

## Клиентская реализация (Frontend)

### SocketService

**Файл:** `packages/frontend/src/app/services/socketService.ts:3-200`

Централизованный сервис для управления WebSocket:

```typescript
class SocketService {
  private socket: Socket | null = null;
  private token: string | null = null;
  private readonly backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

  private setupSocketConnection(): Socket {
    this.socket = io(this.backendUrl, {
      auth: {
        token: this.token ? `Bearer ${this.token}` : null
      },
      transports: ['websocket'],
      timeout: 15000,
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true
    });

    // Обработчики событий
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('error', this.handleError);

    return this.socket;
  }
}
```

### useSocket Hook

**Файл:** `packages/frontend/src/app/hooks/useSocket.ts`

React hook для интеграции WebSocket в компоненты:

```typescript
export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketService = SocketService.getInstance();

  useEffect(() => {
    // Подписка на события подключения
    socketService.on('connect', () => setIsConnected(true));
    socketService.on('disconnect', () => setIsConnected(false));

    return () => {
      // Очистка при размонтировании
      socketService.off('connect');
      socketService.off('disconnect');
    };
  }, []);

  return {
    socket: socketService,
    isConnected,
    sendMessage: socketService.sendMessage.bind(socketService),
    on: socketService.on.bind(socketService),
    off: socketService.off.bind(socketService),
  };
}
```

### Использование в компонентах

**Файл:** `packages/frontend/src/app/components/Chat.tsx`

```typescript
function Chat() {
  const { socket, isConnected } = useSocket();

  useEffect(() => {
    // Подписка на новые сообщения
    socket.on('new-message', handleNewMessage);
    socket.on('user-typing', handleUserTyping);
    socket.on('message-delivered', handleMessageDelivered);

    return () => {
      socket.off('new-message');
      socket.off('user-typing');
      socket.off('message-delivered');
    };
  }, []);

  const sendMessage = (content: string) => {
    socket.emit('send-message', {
      chatId: currentChatId,
      content
    });
  };
}
```

## Аутентификация и безопасность

### JWT валидация

**Файл:** `packages/backend/src/auth/ws-jwt.guard.ts:11-54`

WebSocket-специфичный guard для JWT:

```typescript
@Injectable()
export class WsJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const token = client.handshake.auth.token?.replace('Bearer ', '');

    if (!token) {
      throw new WsException('Missing authentication token');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      client.data.user = await this.authService.findUserById(payload.sub);
      return true;
    } catch {
      throw new WsException('Invalid token');
    }
  }
}
```

### Exception Filters

**Файл:** `packages/backend/src/common/filters/ws-exceptions.filter.ts`

Обработчик исключений для WebSocket:

```typescript
@Catch()
export class WsExceptionsFilter implements WsExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const error = exception instanceof WsException
      ? exception.getError()
      : 'Internal server error';

    client.emit('error', { error });
  }
}
```

## Управление состоянием соединений

### Очистка мертвых соединений

**Файл:** `packages/backend/src/socket/socket.gateway.ts:380-400`

```typescript
private startCleanupInterval() {
  this.cleanupInterval = setInterval(() => {
    const now = new Date();
    const timeout = 60000; // 60 секунд

    for (const [socketId, client] of this.connectedClients) {
      const inactiveTime = now.getTime() - client.lastActivity.getTime();

      if (inactiveTime > timeout) {
        this.logger.log(`Disconnecting inactive client: ${socketId}`);
        client.socket.disconnect();
        this.connectedClients.delete(socketId);
      }
    }
  }, 30000); // Проверка каждые 30 секунд
}
```

### Heartbeat механизм

Клиент периодически отправляет ping для поддержания соединения:

```typescript
// Frontend
setInterval(() => {
  socket.emit('ping');
}, 30000);

// Backend
@SubscribeMessage('ping')
handlePing(@ConnectedSocket() socket: Socket) {
  const client = this.connectedClients.get(socket.id);
  if (client) {
    client.lastActivity = new Date();
  }
  return { event: 'pong', data: Date.now() };
}
```

## Graceful Shutdown

**Файл:** `packages/backend/src/socket/socket.gateway.ts:45-89`

```typescript
public async closeServer() {
  try {
    // Очищаем интервал очистки
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.io) {
      // Отключаем все соединения
      const sockets = await this.io.fetchSockets();

      await Promise.all(
        Array.from(sockets).map((socket) => {
          return new Promise<void>((resolve) => {
            socket.disconnect(true);
            resolve();
          });
        })
      );

      // Закрываем сервер
      await new Promise<void>((resolve) => {
        this.io.close(() => resolve());
      });

      // Очищаем список клиентов
      this.connectedClients.clear();
    }
  } catch (error) {
    this.logger.error('Error closing Socket.IO server:', error);
    throw error;
  }
}
```

## Масштабирование

### Redis Adapter (для production)

Для горизонтального масштабирования рекомендуется использовать Redis adapter:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ host: 'localhost', port: 6379 });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

### Sticky Sessions

При использовании нескольких серверов необходимо настроить sticky sessions в load balancer.

## Мониторинг и метрики

### Активные соединения

**Файл:** `packages/backend/src/socket/socket.gateway.ts:91-93`

```typescript
public getActiveConnections(): number {
  return this.io?.sockets?.sockets?.size || 0;
}
```

### Health Check endpoint

Интеграция с HealthModule для мониторинга WebSocket сервера.

## Тестирование

### Unit тесты Gateway

**Файл:** `packages/backend/src/socket/__tests__/socket.gateway.spec.ts`

```typescript
describe('SocketGateway', () => {
  let gateway: SocketGateway;
  let mockSocket: Socket;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocketGateway,
        // ... mocks
      ],
    }).compile();

    gateway = module.get<SocketGateway>(SocketGateway);
  });

  it('should handle connection', async () => {
    await gateway.handleConnection(mockSocket);
    expect(mockSocket.emit).toHaveBeenCalledWith('connected');
  });
});
```

### E2E тестирование

Использование socket.io-client для тестирования:

```typescript
import { io } from 'socket.io-client';

describe('WebSocket E2E', () => {
  let socket: Socket;

  beforeEach((done) => {
    socket = io('http://localhost:4000', {
      auth: { token: validToken }
    });

    socket.on('connect', done);
  });

  it('should receive messages', (done) => {
    socket.on('new-message', (message) => {
      expect(message).toBeDefined();
      done();
    });

    socket.emit('send-message', { chatId, content });
  });
});
```

## Производительность

### Оптимизации

1. **Binary данные**: Использование бинарного формата для больших объемов данных
2. **Compression**: Включение сжатия для уменьшения трафика
3. **Throttling**: Ограничение частоты событий от клиента
4. **Rooms**: Использование комнат для эффективной рассылки сообщений

### Настройки транспорта

```typescript
// Предпочтительное использование WebSocket
transports: ['websocket', 'polling']

// Настройки ping/pong
pingInterval: 25000,
pingTimeout: 60000
```
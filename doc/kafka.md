# Apache Kafka подсистема

## Роль в проекте

Apache Kafka используется как распределенная система обмена сообщениями для:
- Асинхронной обработки сообщений чата
- Гарантированной доставки сообщений
- Масштабирования обработки сообщений
- Event-driven архитектуры
- Разделения ответственности между сервисами
- Обеспечения отказоустойчивости системы

## Архитектура и компоненты

### Docker конфигурация

**Файл:** `docker-compose.yml:18-55`

#### Zookeeper
```yaml
zookeeper:
  image: confluentinc/cp-zookeeper:latest
  ports:
    - "2181:2181"
  environment:
    - ZOOKEEPER_CLIENT_PORT=2181
    - ZOOKEEPER_TICK_TIME=2000
  healthcheck:
    test: ["CMD-SHELL", "echo ruok | nc localhost 2181 || exit 1"]
```

#### Kafka Broker
```yaml
kafka:
  image: confluentinc/cp-kafka:latest
  depends_on:
    zookeeper:
      condition: service_healthy
  ports:
    - "9092:9092"      # Внутренний listener
    - "29092:29092"    # Внешний listener для localhost
  environment:
    - KAFKA_BROKER_ID=1
    - KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
    - KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092,PLAINTEXT_HOST://localhost:29092
    - KAFKA_AUTO_CREATE_TOPICS_ENABLE=true
```

## KafkaAdapter - основной класс интеграции

### Инициализация и конфигурация

**Файл:** `packages/backend/src/adapters/kafka/kafka.adapter.ts:10-48`

```typescript
export class KafkaAdapter implements OnModuleInit, OnModuleDestroy {
  private producer: Producer;
  private consumer: Consumer;
  private readonly kafka: Kafka;

  constructor(config?: KafkaConfig) {
    this.kafka = new Kafka({
      clientId: config?.clientId || 'webchat',
      brokers: config?.brokers || ['kafka:9092'],
      retry: this.retryOptions,
    });

    this.producer = this.kafka.producer({
      retry: this.retryOptions,
      allowAutoTopicCreation: true
    });

    this.consumer = this.kafka.consumer({
      groupId: config?.groupId || 'webchat-group',
      retry: this.retryOptions,
      readUncommitted: false
    });
  }
}
```

### Retry стратегия

**Файл:** `packages/backend/src/adapters/kafka/kafka.adapter.ts:23-29`

```typescript
private readonly retryOptions: RetryOptions = {
  maxRetryTime: 30000,      // Максимальное время попыток (30 сек)
  initialRetryTime: 100,    // Начальная задержка (100 мс)
  factor: 2,                // Фактор увеличения задержки
  multiplier: 1.5,          // Множитель для расчета задержки
  retries: 5                // Количество попыток
};
```

### Жизненный цикл

**Инициализация** (`packages/backend/src/adapters/kafka/kafka.adapter.ts:50-59`):
```typescript
async onModuleInit() {
  try {
    await this.producer.connect();
    await this.consumer.connect();
    this.logger.log('Successfully connected to Kafka');
  } catch (error) {
    this.logger.error('Failed to connect to Kafka', error);
    throw error;
  }
}
```

**Graceful Shutdown** (`packages/backend/src/adapters/kafka/kafka.adapter.ts:61-83`):
```typescript
async onModuleDestroy() {
  this.isShuttingDown = true;

  // Перестаем принимать новые сообщения
  if (this.isConsumerRunning) {
    await this.consumer.pause([{ topic: '*' }]);
  }

  // Ждем завершения текущих операций
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Отключаем producer и consumer
  await Promise.all([
    this.producer.disconnect(),
    this.consumer.disconnect()
  ]);
}
```

## Публикация сообщений

### Метод publish

**Файл:** `packages/backend/src/adapters/kafka/kafka.adapter.ts:85-118`

```typescript
async publish<T>(topic: string, message: T, retries = 3): Promise<void> {
  if (this.isShuttingDown) {
    throw new Error('Service is shutting down');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await this.producer.send({
        topic,
        messages: [{
          key: (message as any).id || (message as any).messageId,
          value: JSON.stringify(message),
        }],
      });

      this.logger.log(`Message published to topic ${topic}`);
      return;
    } catch (error) {
      if (attempt === retries) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## Подписка и обработка сообщений

### Метод subscribe

**Файл:** `packages/backend/src/adapters/kafka/kafka.adapter.ts:120-180`

```typescript
async subscribe(topic: string, handler: (message: any) => Promise<void>): Promise<void> {
  // Сохраняем подписку для последующей обработки
  this.pendingSubscriptions.push({ topic, handler });

  if (!this.isConsumerRunning) {
    await this.startConsumer();
  } else {
    await this.consumer.subscribe({ topic });
  }
}

private async startConsumer(): Promise<void> {
  // Подписываемся на все накопленные топики
  for (const { topic } of this.pendingSubscriptions) {
    await this.consumer.subscribe({ topic });
  }

  await this.consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const handlers = this.pendingSubscriptions
        .filter(sub => sub.topic === topic)
        .map(sub => sub.handler);

      for (const handler of handlers) {
        await handler(parsedMessage);
      }
    },
  });

  this.isConsumerRunning = true;
}
```

## Использование в ChatService

### Отправка сообщений в Kafka

**Файл:** `packages/backend/src/chat/chat.service.ts:220-264`

```typescript
private async sendMessageToKafka(message: ChatMessage): Promise<void> {
  const maxRetries = 3;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.kafkaAdapter.publish('chat-messages', {
        messageId: message.id,
        chatId: message.chatId,
        senderId: message.sender.id,
        content: message.content,
        timestamp: message.timestamp,
      });

      this.logger.log(`Message sent to Kafka: ${message.id}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(`Failed to send message to Kafka after ${maxRetries} attempts`);
}
```

### Обработка сообщений из Kafka

**Файл:** `packages/backend/src/chat/chat.service.ts:45-65`

```typescript
async onModuleInit() {
  await this.kafkaAdapter.subscribe('chat-messages', async (message) => {
    try {
      this.logger.log(`Received message from Kafka: ${message.messageId}`);

      // Обработка сообщения
      await this.processKafkaMessage(message);

      // Отправка через WebSocket
      this.socketGateway.sendToChat(message.chatId, 'new-message', message);

    } catch (error) {
      this.logger.error(`Error processing Kafka message: ${error.message}`);
    }
  });

  this.logger.log('ChatService subscribed to Kafka topics');
}
```

## Топики Kafka

### chat-messages

Основной топик для сообщений чата:
- **Производитель**: ChatService при отправке сообщения
- **Потребитель**: ChatService для обработки и рассылки через WebSocket
- **Формат данных**:
```typescript
{
  messageId: string;
  chatId: string;
  senderId: string;
  content: string;
  timestamp: string;
}
```

### message-delivery-status

Топик для статусов доставки (планируется):
- Подтверждение доставки
- Подтверждение прочтения
- Ошибки доставки

## Мониторинг и отладка

### Health Check

**Файл:** `docker-compose.yml:51-55`

```yaml
healthcheck:
  test: ["CMD-SHELL", "kafka-topics --bootstrap-server localhost:9092 --list"]
  interval: 10s
  timeout: 5s
  retries: 5
```

### Логирование

Все операции с Kafka логируются через NestJS Logger:
- Успешное подключение/отключение
- Публикация сообщений
- Получение сообщений
- Ошибки и повторные попытки

## Тестирование

### Mock адаптер для тестов

**Файл:** `packages/backend/src/adapters/kafka/mock-kafka.adapter.ts:1-28`

```typescript
export class MockKafkaAdapter {
  private messages: Map<string, any[]> = new Map();

  async publish<T>(topic: string, message: T): Promise<void> {
    if (!this.messages.has(topic)) {
      this.messages.set(topic, []);
    }
    this.messages.get(topic)?.push(message);
  }

  async subscribe(topic: string, handler: (message: any) => Promise<void>): Promise<void> {
    // Mock implementation
  }

  getPublishedMessages(topic: string): any[] {
    return this.messages.get(topic) || [];
  }
}
```

### Unit тесты

**Файл:** `packages/backend/src/adapters/kafka/__tests__/kafka.adapter.spec.ts`

Тестирование:
- Подключения к Kafka
- Публикации сообщений
- Обработки ошибок
- Retry логики
- Graceful shutdown

## Производительность и оптимизация

### Batching

Возможность отправки сообщений батчами для увеличения пропускной способности.

### Partitioning

Использование ключей сообщений для распределения по партициям:
- Ключ: `messageId` или `chatId`
- Обеспечивает порядок сообщений в рамках чата

### Consumer Groups

Использование групп потребителей для горизонтального масштабирования:
- Group ID: `webchat-group`
- Автоматическая балансировка нагрузки между инстансами

## Безопасность

### Аутентификация

В production окружении рекомендуется настроить:
- SASL/SCRAM аутентификацию
- SSL/TLS шифрование
- ACL для контроля доступа к топикам

### Валидация данных

Все сообщения валидируются перед отправкой и после получения:
- JSON схема валидация
- Проверка обязательных полей
- Санитизация контента

## Отказоустойчивость

### Репликация

Настройка репликации для критичных топиков:
- `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1` (для dev)
- Рекомендуется 3+ для production

### Обработка ошибок

- Автоматические повторные попытки с экспоненциальной задержкой
- Dead Letter Queue для необработанных сообщений
- Circuit Breaker паттерн для предотвращения каскадных сбоев

## Интеграция с AppModule

**Файл:** `packages/backend/src/app.module.ts:60-71`

```typescript
{
  provide: KafkaAdapter,
  useFactory: (configService: ConfigService) => {
    const isDocker = configService.get('IS_DOCKER', 'false') === 'true';
    return new KafkaAdapter({
      clientId: configService.get('KAFKA_CLIENT_ID') || 'webchat',
      brokers: [configService.get('KAFKA_BROKERS') || (isDocker ? 'kafka:9092' : 'localhost:29092')],
      groupId: configService.get('KAFKA_GROUP_ID') || 'webchat-group'
    });
  },
  inject: [ConfigService],
}
```

## Конфигурация

### Environment переменные

- `KAFKA_CLIENT_ID` - идентификатор клиента Kafka
- `KAFKA_BROKERS` - адреса брокеров (comma-separated)
- `KAFKA_GROUP_ID` - идентификатор группы потребителей
- `IS_DOCKER` - флаг для определения окружения
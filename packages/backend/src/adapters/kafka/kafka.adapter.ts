import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Producer, Consumer, RetryOptions } from 'kafkajs';

export interface KafkaConfig {
  clientId?: string;
  brokers?: string[];
  groupId?: string;
}

@Injectable()
export class KafkaAdapter implements OnModuleInit, OnModuleDestroy {
  private isShuttingDown = false;
  private producer: Producer;
  private consumer: Consumer;
  private readonly kafka: Kafka;
  private isConsumerRunning = false;
  private readonly logger = new Logger(KafkaAdapter.name);
  private pendingSubscriptions: Array<{
    topic: string;
    handler: (message: any) => Promise<void>;
  }> = [];

  private readonly retryOptions: RetryOptions = {
    maxRetryTime: 30000,
    initialRetryTime: 100,
    factor: 2,
    multiplier: 1.5,
    retries: 5
  };

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

  async onModuleDestroy() {
    this.isShuttingDown = true;
    try {
      // Перестаем принимать новые сообщения
      if (this.isConsumerRunning) {
        await this.consumer.pause([{ topic: '*' }]);
        this.logger.log('Consumer paused');
      }

      // Ждем завершения текущих операций
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Отключаем producer и consumer
      await Promise.all([
        this.producer.disconnect(),
        this.consumer.disconnect()
      ]);

      this.logger.log('Successfully disconnected from Kafka');
    } catch (error) {
      this.logger.error('Error during graceful shutdown', error);
    }
  }

  async publish<T>(topic: string, message: T): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Service is shutting down');
    }
    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: (message as any).id || (message as any).messageId,
            value: JSON.stringify(message),
          },
        ],
      });
      this.logger.debug(`Message published to topic ${topic}`, message);
    } catch (error) {
      this.logger.error(`Failed to publish message to topic ${topic}`, error);
      throw error;
    }
  }

  async subscribe<T>(topic: string, handler: (message: T) => Promise<void>): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Service is shutting down');
    }
    try {
      // Добавляем подписку в очередь
      this.pendingSubscriptions.push({ topic, handler });
      this.logger.log(`Subscribing to topic ${topic}`);

      // Если consumer уже запущен, ничего не делаем
      if (this.isConsumerRunning) {
        this.logger.debug(`Consumer already running, subscription to ${topic} queued`);
        return;
      }

      // Подписываемся на топик
      await this.consumer.subscribe({ topic, fromBeginning: true });

      // Запускаем consumer только один раз
      if (!this.isConsumerRunning) {
        this.isConsumerRunning = true;
        await this.consumer.run({
          autoCommit: true,
          autoCommitInterval: 5000,
          autoCommitThreshold: 100,
          eachMessage: async ({ topic, partition, message }) => {
            try {
              const value = message.value?.toString();
              if (value) {
                const parsedMessage = JSON.parse(value);
                // Находим соответствующий handler для топика
                const subscription = this.pendingSubscriptions.find(sub => sub.topic === topic);
                if (subscription) {
                  this.logger.debug(`Processing message from topic ${topic}`, {
                    key: message.key?.toString(),
                    partition,
                    offset: message.offset,
                  });
                  await subscription.handler(parsedMessage);
                }
              }
            } catch (error) {
              this.logger.error(`Error processing message from topic ${topic}`, error);
              // Не выбрасываем ошибку, чтобы не остановить обработку сообщений
            }
          },
        });

        // Обработка ошибок consumer'а
        this.consumer.on('consumer.crash', async (error) => {
          this.logger.error('Consumer crashed', error);
          this.isConsumerRunning = false;
          // Пытаемся переподключиться
          try {
            await this.consumer.connect();
            await this.subscribe(topic, handler);
          } catch (reconnectError) {
            this.logger.error('Failed to reconnect consumer', reconnectError);
          }
        });

        this.consumer.on('consumer.disconnect', () => {
          this.logger.warn('Consumer disconnected');
          this.isConsumerRunning = false;
        });

        this.consumer.on('consumer.connect', () => {
          this.logger.log('Consumer connected');
        });

        this.consumer.on('consumer.rebalancing', () => {
          this.logger.log('Consumer rebalancing');
        });

        this.consumer.on('consumer.heartbeat', () => {
          this.logger.debug('Consumer heartbeat');
        });
      }
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic ${topic}`, error);
      throw error;
    }
  }
}

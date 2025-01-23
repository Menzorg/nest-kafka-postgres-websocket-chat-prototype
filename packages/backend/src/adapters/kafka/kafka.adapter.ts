import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer, Consumer, ConsumerSubscribeTopic } from 'kafkajs';

export interface KafkaConfig {
  clientId?: string;
  brokers?: string[];
  groupId?: string;
}

@Injectable()
export class KafkaAdapter implements OnModuleInit, OnModuleDestroy {
  private producer: Producer;
  private consumer: Consumer;
  private readonly kafka: Kafka;
  private isConsumerRunning = false;
  private pendingSubscriptions: Array<{
    topic: string;
    handler: (message: any) => Promise<void>;
  }> = [];

  constructor(config?: KafkaConfig) {
    this.kafka = new Kafka({
      clientId: config?.clientId || 'webchat',
      brokers: config?.brokers || [process.env.KAFKA_BROKER || 'localhost:29092'],
    });

    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ 
      groupId: config?.groupId || 'webchat-group' 
    });
  }

  async onModuleInit() {
    await this.producer.connect();
    await this.consumer.connect();
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
    await this.consumer.disconnect();
  }

  async publish<T>(topic: string, message: T): Promise<void> {
    await this.producer.send({
      topic,
      messages: [
        {
          key: (message as any).id || (message as any).messageId,
          value: JSON.stringify(message),
        },
      ],
    });
  }

  async subscribe<T>(topic: string, handler: (message: T) => Promise<void>): Promise<void> {
    // Добавляем подписку в очередь
    this.pendingSubscriptions.push({ topic, handler });

    // Если consumer уже запущен, ничего не делаем
    if (this.isConsumerRunning) {
      console.log(`Consumer already running, subscription to ${topic} queued`);
      return;
    }

    // Подписываемся на топик
    await this.consumer.subscribe({ topic, fromBeginning: true });

    // Запускаем consumer только один раз
    if (!this.isConsumerRunning) {
      this.isConsumerRunning = true;
      await this.consumer.run({
        eachMessage: async ({ topic, message }) => {
          const value = message.value?.toString();
          if (value) {
            const parsedMessage = JSON.parse(value);
            // Находим соответствующий handler для топика
            const subscription = this.pendingSubscriptions.find(sub => sub.topic === topic);
            if (subscription) {
              await subscription.handler(parsedMessage);
            }
          }
        },
      });
    }
  }
}

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer, Consumer } from 'kafkajs';

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

  constructor(config?: KafkaConfig) {
    this.kafka = new Kafka({
      clientId: config?.clientId || 'webchat',
      brokers: config?.brokers || [process.env.KAFKA_BROKER || 'localhost:9092'],
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
    await this.consumer.subscribe({ topic });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const value = message.value?.toString();
        if (value) {
          const parsedMessage = JSON.parse(value) as T;
          await handler(parsedMessage);
        }
      },
    });
  }
}

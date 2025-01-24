import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { KafkaConfig } from './kafka.adapter';

@Injectable()
export class MockKafkaAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MockKafkaAdapter.name);

  constructor(config?: KafkaConfig) {
    this.logger.log('Initializing Mock Kafka Adapter');
  }

  async onModuleInit() {
    this.logger.log('Mock Kafka Adapter initialized');
  }

  async onModuleDestroy() {
    this.logger.log('Mock Kafka Adapter destroyed');
  }

  async publish(topic: string, message: any) {
    this.logger.log(`Mock publish to ${topic}:`, message);
  }

  async subscribe(topic: string, handler: (message: any) => Promise<void>) {
    this.logger.log(`Mock subscribe to ${topic}`);
  }
}

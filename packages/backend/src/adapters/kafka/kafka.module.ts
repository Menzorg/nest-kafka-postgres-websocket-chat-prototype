import { Module } from '@nestjs/common';
import { KafkaAdapter } from './kafka.adapter';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KafkaAdapter,
      useFactory: (configService: ConfigService) => {
        const isDocker = configService.get('IS_DOCKER', 'false') === 'true';
        return new KafkaAdapter({
          clientId: configService.get('KAFKA_CLIENT_ID', 'webchat'),
          brokers: [configService.get('KAFKA_BROKERS', isDocker ? 'kafka:9092' : 'localhost:29092')],
          groupId: configService.get('KAFKA_GROUP_ID', 'webchat-group'),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [KafkaAdapter],
})
export class KafkaModule {}

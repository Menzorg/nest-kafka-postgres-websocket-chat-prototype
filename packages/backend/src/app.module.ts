import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { ChatModule } from './chat/chat.module';
import { SocketModule } from './socket/socket.module';
import { User } from './user/entities/user.entity';
import { Chat } from './chat/entities/chat.entity';
import { Message } from './chat/entities/message.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SocketGateway } from './socket/socket.gateway';
import { KafkaAdapter } from './adapters/kafka/kafka.adapter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: +configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [User, Chat, Message],
        synchronize: true,
        logging: true,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UserModule,
    ChatModule,
    SocketModule,
  ],
  providers: [
    {
      provide: KafkaAdapter,
      useFactory: (configService: ConfigService) => {
        return new KafkaAdapter({
          clientId: configService.get('KAFKA_CLIENT_ID') || 'webchat',
          brokers: [configService.get('KAFKA_BROKER') || 'localhost:29092'],
          groupId: configService.get('KAFKA_GROUP_ID') || 'webchat-group'
        });
      },
      inject: [ConfigService],
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(
    private readonly dataSource: DataSource,
    private readonly socketGateway: SocketGateway,
    private readonly kafkaAdapter: KafkaAdapter
  ) {}

  async onApplicationShutdown(signal?: string) {
    console.log(`Application shutdown (signal: ${signal})`);
    try {
      // Закрываем сокеты
      await this.socketGateway.onModuleDestroy();
      console.log('Socket connections closed');

      // Закрываем Kafka
      await this.kafkaAdapter.onModuleDestroy();
      console.log('Kafka connections closed');

      // Закрываем БД
      await this.dataSource.destroy();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}
import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { KafkaAdapter } from '../adapters/kafka/kafka.adapter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { Chat } from './entities/chat.entity';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../user/user.module';
import { WsJwtGuard } from '../auth/ws-jwt.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Chat]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'test',
      signOptions: { expiresIn: '1d' },
    }),
    UserModule,
  ],
  providers: [
    ChatGateway,
    ChatService,
    {
      provide: KafkaAdapter,
      useFactory: () => {
        return new KafkaAdapter({
          clientId: process.env.KAFKA_CLIENT_ID || 'webchat',
          brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
          groupId: process.env.KAFKA_GROUP_ID || 'webchat-group',
        });
      },
    },
    WsJwtGuard,
  ],
})
export class ChatModule {}

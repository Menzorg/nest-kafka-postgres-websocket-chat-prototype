import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { Chat } from './entities/chat.entity';
import { AuthModule } from '../auth/auth.module';
import { KafkaModule } from '../adapters/kafka/kafka.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Chat]),
    AuthModule,
    KafkaModule,
    UserModule,
  ],
  providers: [
    ChatGateway,
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}

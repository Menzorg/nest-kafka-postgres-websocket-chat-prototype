import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../auth/ws-jwt.guard';
import { ChatService } from './chat.service';
import { KafkaAdapter } from '../adapters/kafka/kafka.adapter';
import { ChatMessage, Message, MessageStatus, MessageDeliveryStatus } from '@webchat/common';

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly kafkaAdapter: KafkaAdapter,
  ) {
    // Подписываемся на события Kafka при создании шлюза
    this.subscribeToKafkaEvents();
  }

  private async subscribeToKafkaEvents() {
    // Подписываемся на сообщения
    await this.kafkaAdapter.subscribe<Message>('chat.messages', async (message) => {
      const room = `chat:${message.roomId}`;
      this.server.to(room).emit('message', message);
    });

    // Подписываемся на статусы сообщений
    await this.kafkaAdapter.subscribe<MessageStatus>('chat.message.status', async (status) => {
      const room = `user:${status.senderId}`;
      this.server.to(room).emit('message:status', status);
    });
  }

  async handleConnection(client: Socket) {
    const userId = client.data?.user?.id;
    if (!userId) {
      client.disconnect();
      return;
    }

    // Подключаем пользователя к его личной комнате
    client.join(`user:${userId}`);

    try {
      // Получаем чаты пользователя и подключаем его к комнатам чатов
      const chats = await this.chatService.getUserChats(userId);
      for (const chat of chats) {
        client.join(`chat:${chat.id}`);
      }

      // Получаем и отправляем недоставленные сообщения
      const undeliveredMessages = await this.chatService.getUndeliveredMessages(userId);
      for (const message of undeliveredMessages) {
        client.emit('message', message);
      }
    } catch (error) {
      console.error('Error in handleConnection:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Отключаем пользователя от всех комнат
    const userId = client.data?.user?.id;
    if (userId) {
      client.leave(`user:${userId}`);
    }
  }

  @SubscribeMessage('message')
  async handleMessage(message: ChatMessage, client: Socket) {
    try {
      // Проверяем существование чата
      await this.chatService.getChat(message.chatId);

      // Сохраняем сообщение
      const savedMessage = await this.chatService.saveMessage(message);

      // Публикуем сообщение в Kafka
      const kafkaMessage: Message = {
        id: savedMessage.id,
        roomId: savedMessage.chatId,
        senderId: savedMessage.senderId,
        content: savedMessage.content,
        timestamp: savedMessage.createdAt,
        status: MessageDeliveryStatus.SENT,
      };

      await this.kafkaAdapter.publish<Message>('chat.messages', kafkaMessage);

      // Отправляем подтверждение отправителю
      client.emit('message:ack', { messageId: savedMessage.id });
    } catch (error) {
      console.error('Error in handleMessage:', error);
      client.emit('message:error', {
        messageId: message.id,
        error: error.message || 'Chat not found',
      });
    }
  }

  @SubscribeMessage('message:read')
  async handleMessageRead(payload: { messageId: string }, client: Socket) {
    try {
      // Проверяем существование сообщения
      const message = await this.chatService.getMessage(payload.messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Публикуем статус в Kafka
      const status: MessageStatus = {
        messageId: payload.messageId,
        senderId: message.senderId,
        status: MessageDeliveryStatus.READ,
      };

      await this.kafkaAdapter.publish<MessageStatus>('chat.message.status', status);
    } catch (error) {
      console.error('Error in handleMessageRead:', error);
      client.emit('message:error', {
        messageId: payload.messageId,
        error: error.message || 'Message not found',
      });
    }
  }
}

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
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
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly kafkaAdapter: KafkaAdapter,
  ) {}

  async afterInit() {
    // Подписываемся на события Kafka после инициализации шлюза
    await this.subscribeToKafkaEvents();
  }

  private async subscribeToKafkaEvents() {
    try {
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
    } catch (error) {
      console.error('Failed to subscribe to Kafka events:', error);
    }
  }

  async handleConnection(client: Socket) {
    const userId = client.data?.user?.id;
    if (!userId) {
      client.disconnect();
      return;
    }

    // Подключаем пользователя к его личной комнате
    await client.join(`user:${userId}`);

    try {
      // Получаем чаты пользователя и подключаем его к комнатам чатов
      const chats = await this.chatService.getUserChats(userId);
      for (const chat of chats) {
        await client.join(`chat:${chat.id}`);
      }

      // Получаем и отправляем недоставленные сообщения
      const undeliveredMessages = await this.chatService.getUndeliveredMessages(userId);
      for (const message of undeliveredMessages) {
        client.emit('message', message);
      }
    } catch (error) {
      console.error('Failed to handle connection:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.user?.id;
    if (userId) {
      await client.leave(`user:${userId}`);
    }
  }

  @SubscribeMessage('message')
  async handleMessage(client: Socket, payload: ChatMessage) {
    const userId = client.data?.user?.id;
    if (!userId) {
      return;
    }

    try {
      // Проверяем существование чата
      await this.chatService.getChat(payload.chatId);

      // Сохраняем сообщение
      const message = await this.chatService.saveMessage({
        ...payload,
        senderId: userId,
      });

      // Отправляем сообщение в Kafka
      await this.kafkaAdapter.publish('chat.messages', {
        id: message.id,
        roomId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        timestamp: message.createdAt,
        status: MessageDeliveryStatus.SENT,
      });

      // Отправляем подтверждение отправителю
      client.emit('message:ack', { messageId: message.id });

      return {
        status: 'ok',
        data: message,
      };
    } catch (error) {
      console.error('Failed to handle message:', error);
      client.emit('message:error', {
        messageId: payload.id,
        error: error.message,
      });
      return {
        status: 'error',
        message: error.message,
      };
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

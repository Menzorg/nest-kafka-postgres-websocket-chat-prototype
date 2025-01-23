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
    await this.subscribeToKafkaEvents();
  }

  private async subscribeToKafkaEvents() {
    try {
      await this.kafkaAdapter.subscribe<Message>('chat.messages', async (message) => {
        const room = `chat:${message.roomId}`;
        this.server.to(room).emit('message', message);
      });

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
      console.log('=== Connection rejected: No user ID ===');
      client.disconnect();
      return;
    }

    try {
      console.log('=== New connection ===', {
        userId,
        socketId: client.id
      });

      // Присоединяем пользователя к его личной комнате
      const userRoom = `user:${userId}`;
      await client.join(userRoom);
      
      console.log('=== User joined personal room ===', {
        userId,
        socketId: client.id,
        room: userRoom
      });
    } catch (error) {
      console.error('=== Connection handler error ===', {
        userId,
        socketId: client.id,
        error: error.message
      });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.user?.id;
    if (!userId) {
      return;
    }

    try {
      console.log('=== Client disconnecting ===', {
        userId,
        socketId: client.id
      });

      // Отсоединяем от личной комнаты
      const userRoom = `user:${userId}`;
      await client.leave(userRoom);

      console.log('=== User left personal room ===', {
        userId,
        socketId: client.id,
        room: userRoom
      });
    } catch (error) {
      console.error('=== Disconnect handler error ===', {
        userId,
        socketId: client.id,
        error: error.message
      });
    }
  }

  @SubscribeMessage('chat:join')
  async handleJoinChat(client: Socket, payload: { chatId: string }) {
    const userId = client.data?.user?.id;
    if (!userId) {
      console.error('=== Chat Join Failed: No user ID ===', {
        socketId: client.id
      });
      return { status: 'error', message: 'Not authenticated' };
    }

    try {
      console.log('=== Chat Join Request ===', {
        userId,
        chatId: payload.chatId,
        socketId: client.id
      });

      // Проверяем существование чата и участие пользователя
      const chat = await this.chatService.getChat(payload.chatId);
      if (!chat) {
        console.error('=== Chat Join Failed: Chat not found ===', {
          userId,
          chatId: payload.chatId,
          socketId: client.id
        });
        return { status: 'error', message: 'Chat not found' };
      }

      // Проверяем, является ли пользователь участником чата
      if (!chat.participants.includes(userId)) {
        console.error('=== Chat Join Failed: User not participant ===', {
          userId,
          chatId: payload.chatId,
          participants: chat.participants,
          socketId: client.id
        });
        return { status: 'error', message: 'User is not a participant of this chat' };
      }

      // Присоединяем к комнате чата
      const room = `chat:${payload.chatId}`;
      await client.join(room);
      console.log('=== User joined chat room ===', {
        userId,
        chatId: payload.chatId,
        room,
        socketId: client.id
      });

      // Отправляем успешный ответ сразу
      const response = { status: 'ok' };
      
      // Асинхронно обновляем статусы сообщений
      this.updateMessageStatuses(userId, payload.chatId, client.id).catch(error => {
        console.error('=== Failed to update message statuses ===', {
          userId,
          chatId: payload.chatId,
          error: error.message,
          socketId: client.id
        });
      });

      console.log('=== Chat Join Completed ===', {
        userId,
        chatId: payload.chatId,
        socketId: client.id
      });

      return response;
    } catch (error) {
      console.error('=== Chat Join Failed ===', {
        userId,
        chatId: payload.chatId,
        error: error.message,
        socketId: client.id
      });
      return { status: 'error', message: error.message };
    }
  }

  private async updateMessageStatuses(userId: string, chatId: string, socketId: string) {
    // Обновляем статус всех непрочитанных сообщений на DELIVERED
    const undeliveredMessages = await this.chatService.getUndeliveredMessages(userId, chatId);
    console.log('=== Undelivered Messages ===', {
      count: undeliveredMessages.length,
      messages: undeliveredMessages.map(m => ({
        id: m.id,
        senderId: m.senderId,
        status: m.status
      })),
      socketId
    });

    // Обновляем статусы всех сообщений сразу
    const statusUpdates = await Promise.all(undeliveredMessages.map(async message => {
      console.log('=== Updating Message Status ===', {
        messageId: message.id,
        oldStatus: message.status,
        newStatus: MessageDeliveryStatus.DELIVERED,
        socketId
      });

      // Обновляем статус на DELIVERED
      await this.chatService.updateMessageStatus(message.id, MessageDeliveryStatus.DELIVERED);
      
      return {
        messageId: message.id,
        senderId: message.senderId,
        status: MessageDeliveryStatus.DELIVERED,
        timestamp: new Date().toISOString()
      };
    }));

    // Отправляем обновления статусов
    for (const update of statusUpdates) {
      const recipientRoom = `user:${update.senderId}`;
      console.log('=== Sending Status Update ===', {
        ...update,
        recipientRoom,
        socketId
      });
      
      this.server.to(recipientRoom).emit('message:status', {
        messageId: update.messageId,
        status: update.status,
        timestamp: update.timestamp
      });
    }

    console.log('=== Message Statuses Updated ===', {
      userId,
      chatId,
      updatedMessages: statusUpdates.length,
      socketId
    });
  }

  @SubscribeMessage('message')
  async handleMessage(client: Socket, payload: ChatMessage) {
    const userId = client.data?.user?.id;
    if (!userId) {
      return;
    }

    try {
      console.log('=== New Message Request ===', {
        userId,
        chatId: payload.chatId,
        content: payload.content
      });

      // Проверяем существование чата
      await this.chatService.getChat(payload.chatId);

      // Сохраняем сообщение
      const message = await this.chatService.saveMessage({
        ...payload,
        senderId: userId,
      });

      console.log('=== Message Saved ===', message);

      // Отправляем сообщение в Kafka
      const kafkaMessage = {
        id: message.id,
        roomId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        timestamp: message.createdAt,
        status: MessageDeliveryStatus.SENT,
      };
      console.log('=== Publishing Message to Kafka ===', kafkaMessage);
      
      await this.kafkaAdapter.publish('chat.messages', kafkaMessage);

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
  async handleMessageRead(client: Socket, payload: { messageId: string }) {
    const userId = client.data?.user?.id;
    if (!userId) {
      console.error('=== Message read failed: No user ID ===', {
        socketId: client.id
      });
      return { status: 'error', message: 'Unauthorized' };
    }

    try {
      console.log('=== Message read request ===', {
        userId,
        messageId: payload.messageId,
        socketId: client.id
      });

      const message = await this.chatService.getMessage(payload.messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Проверяем, что пользователь является участником чата
      const chat = await this.chatService.getChat(message.chatId);
      if (!chat.participants.includes(userId)) {
        throw new Error('User is not a participant of this chat');
      }

      // Обновляем статус только если сообщение от другого пользователя
      if (message.senderId !== userId) {
        await this.chatService.updateMessageStatus(payload.messageId, MessageDeliveryStatus.READ);
        
        // Отправляем обновление статуса отправителю сообщения
        const statusUpdate = {
          messageId: payload.messageId,
          status: MessageDeliveryStatus.READ,
          timestamp: new Date().toISOString()
        };

        console.log('=== Publishing read status ===', {
          ...statusUpdate,
          recipientId: userId,
          senderId: message.senderId,
          socketId: client.id
        });
        
        // Отправляем в личную комнату отправителя
        this.server.to(`user:${message.senderId}`).emit('message:status', statusUpdate);
      }

      return { status: 'ok' };
    } catch (error) {
      console.error('=== Failed to mark message as read ===', {
        error: error.message,
        userId,
        messageId: payload.messageId,
        socketId: client.id
      });
      return { status: 'error', message: error.message };
    }
  }
}

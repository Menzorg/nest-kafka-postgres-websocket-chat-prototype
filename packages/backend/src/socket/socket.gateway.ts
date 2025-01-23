import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import { ChatService } from '../chat/chat.service';
import { ChatMessage, MessageDeliveryStatus } from '@webchat/common';
import { v4 as uuidv4 } from 'uuid';

interface ConnectedClient {
  socket: Socket;
  userId: string;
  lastActivity: Date;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
})
export class SocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly io: Server;
  private connectedClients: Map<string, ConnectedClient> = new Map();
  private readonly logger = new Logger(SocketGateway.name);

  constructor(
    private jwtService: JwtService,
    private authService: AuthService,
    private chatService: ChatService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('=== WebSocket Gateway initialized ===');

    // Добавляем middleware для проверки токена
    server.use(async (socket: Socket, next) => {
      try {
        this.logger.log('=== Token verification middleware ===');
        this.logger.log(`Client ID: ${socket.id}`);
        
        const rawToken = socket.handshake?.auth?.token;
        if (!rawToken) {
          this.logger.error('No token provided');
          return next(new Error('No token provided'));
        }

        this.logger.log(`Raw token: ${rawToken}`);
        
        // Извлекаем токен из Bearer строки
        const token = rawToken.startsWith('Bearer ') 
          ? rawToken.substring(7) 
          : rawToken;

        try {
          const payload = await this.jwtService.verifyAsync(token);
          this.logger.log('Token verified successfully');
          
          const user = await this.authService.validateUser(payload);
          if (!user) {
            this.logger.error('User not found');
            return next(new Error('User not found'));
          }

          // Сохраняем информацию о пользователе в socket
          socket.data.user = user;
          next();
        } catch (error) {
          this.logger.error('=== Middleware error ===');
          this.logger.error('Error:', error.message);
          this.logger.error('Stack:', error.stack);
          next(error);
        }
      } catch (error) {
        this.logger.error('=== Unexpected middleware error ===');
        this.logger.error('Error:', error.message);
        this.logger.error('Stack:', error.stack);
        next(error);
      }
    });

    server.on('connection_error', (err: Error) => {
      this.logger.error('=== Server connection error ===');
      this.logger.error('Error:', err);
    });

    server.on('disconnect', (reason) => {
      this.logger.log('=== Server disconnect event ===');
      this.logger.log('Reason:', reason);
    });

    // Запускаем периодическую очистку мертвых соединений
    setInterval(() => this.cleanupDeadConnections(), 60000);
  }

  async handleConnection(client: Socket) {
    try {
      const user = client.data.user;
      if (!user) {
        this.logger.error('No user data in socket');
        client.disconnect();
        return;
      }

      this.logger.log(`Client connected: ${client.id}`);
      
      // Добавляем клиента в список подключенных
      this.connectedClients.set(client.id, {
        socket: client,
        userId: user.id,
        lastActivity: new Date()
      });

      // Отправляем подтверждение подключения
      client.emit('connection:established', { 
        userId: user.id 
      });

      // Оповещаем других пользователей
      this.broadcastUserStatus(user.id, true);
    } catch (error) {
      this.logger.error('Error in handleConnection:');
      this.logger.error(error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    try {
      const clientInfo = this.connectedClients.get(client.id);
      if (clientInfo) {
        // Оповещаем других пользователей
        this.broadcastUserStatus(clientInfo.userId, false);
        
        // Удаляем клиента из списка
        this.connectedClients.delete(client.id);
      }
      
      this.logger.log(`Client disconnected: ${client.id}`);
    } catch (error) {
      this.logger.error('Error in handleDisconnect:');
      this.logger.error(error);
    }
  }

  private broadcastUserStatus(userId: string, isOnline: boolean) {
    this.io.emit('users:update', { userId, isOnline });
  }

  @SubscribeMessage('chat:get')
  async handleGetChat(client: Socket, payload: { recipientId: string }) {
    try {
      const userId = client.data.user.id;
      let chat = await this.chatService.findChatByParticipants(userId, payload.recipientId);
      
      if (!chat) {
        chat = await this.chatService.createChat(userId, payload.recipientId);
      }

      const messages = await this.chatService.getChatMessages(chat.id);
      
      return { chatId: chat.id, messages };
    } catch (error) {
      this.logger.error('Error in handleGetChat:', error);
      throw error;
    }
  }

  @SubscribeMessage('message')
  async handleMessage(client: Socket, payload: { chatId: string; content: string }) {
    try {
      const senderId = client.data.user.id;
      const chat = await this.chatService.getChat(payload.chatId);
      
      if (!chat.participants.includes(senderId)) {
        throw new Error('User is not a participant of this chat');
      }

      const now = new Date();
      const message: ChatMessage = {
        id: uuidv4(),
        chatId: payload.chatId,
        senderId,
        content: payload.content,
        status: MessageDeliveryStatus.SENT,
        createdAt: now,
      };

      await this.chatService.saveMessage(message);

      // Отправляем сообщение всем участникам чата
      this.io.to(`chat:${payload.chatId}`).emit('message', message);

      return message;
    } catch (error) {
      this.logger.error('Error in handleMessage:', error);
      throw error;
    }
  }

  @SubscribeMessage('users:list')
  async handleUsersList(client: Socket) {
    try {
      const users = await this.authService.getAllUsers();
      const usersWithStatus = users.map(user => ({
        ...user,
        isOnline: Array.from(this.connectedClients.values())
          .some(client => client.userId === user.id)
      }));
      
      return { users: usersWithStatus };
    } catch (error) {
      this.logger.error('Error in handleUsersList:', error);
      return { users: [] };
    }
  }

  @SubscribeMessage('chat:join')
  async handleChatJoin(client: Socket, payload: { chatId: string }) {
    try {
      this.logger.log('=== Handling chat:join ===');
      this.logger.log('Payload:', payload);

      const userId = client.data.user.id;
      const chat = await this.chatService.getChat(payload.chatId);

      if (!chat) {
        this.logger.error(`Chat ${payload.chatId} not found`);
        return { status: 'error', message: 'Chat not found' };
      }

      if (!chat.participants.includes(userId)) {
        this.logger.error(`User ${userId} is not a participant of chat ${payload.chatId}`);
        return { status: 'error', message: 'User is not a participant of this chat' };
      }

      // Присоединяем клиента к комнате чата
      await client.join(`chat:${payload.chatId}`);
      this.logger.log(`User ${userId} joined chat ${payload.chatId}`);

      // Получаем непрочитанные сообщения
      const undeliveredMessages = await this.chatService.getUndeliveredMessages(userId, payload.chatId);
      
      // Обновляем статус сообщений на DELIVERED
      for (const message of undeliveredMessages) {
        await this.chatService.updateMessageStatus(message.id, MessageDeliveryStatus.DELIVERED);
        
        // Уведомляем отправителя об обновлении статуса
        this.io.to(`user:${message.senderId}`).emit('message:status', {
          messageId: message.id,
          status: MessageDeliveryStatus.DELIVERED,
          timestamp: new Date().toISOString()
        });
      }

      this.logger.log(`Updated status for ${undeliveredMessages.length} messages`);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Error in handleChatJoin:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('message:read')
  async handleMessageRead(client: Socket, payload: { messageId: string }) {
    try {
      this.logger.log('=== Handling message:read ===');
      this.logger.log('Payload:', payload);

      const userId = client.data.user.id;
      const message = await this.chatService.getMessage(payload.messageId);

      if (!message) {
        this.logger.error(`Message ${payload.messageId} not found`);
        return { status: 'error', message: 'Message not found' };
      }

      // Проверяем, что пользователь является участником чата
      const chat = await this.chatService.getChat(message.chatId);
      if (!chat.participants.includes(userId)) {
        this.logger.error(`User ${userId} is not a participant of chat ${message.chatId}`);
        return { status: 'error', message: 'User is not a participant of this chat' };
      }

      // Обновляем статус сообщения
      await this.chatService.updateMessageStatus(payload.messageId, MessageDeliveryStatus.READ);
      
      // Уведомляем отправителя об обновлении статуса
      this.io.to(`user:${message.senderId}`).emit('message:status', {
        messageId: payload.messageId,
        status: MessageDeliveryStatus.READ,
        timestamp: new Date().toISOString()
      });

      this.logger.log(`Message ${payload.messageId} marked as read by user ${userId}`);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Error in handleMessageRead:', error);
      return { status: 'error', message: error.message };
    }
  }

  private cleanupDeadConnections() {
    try {
      this.logger.log('=== Running periodic connection cleanup ===');
      
      // Логируем состояние до очистки
      this.logger.log('Before cleanup:');
      this.logger.log({
        totalConnections: this.connectedClients.size,
        connections: Array.from(this.connectedClients.values()).map(client => ({
          id: client.socket.id,
          userId: client.userId,
          connected: client.socket.connected,
          disconnected: client.socket.disconnected,
          lastActivity: client.lastActivity
        }))
      });

      let cleaned = 0;
      const now = new Date();
      const maxInactiveTime = 5 * 60 * 1000; // 5 минут

      for (const [userId, client] of this.connectedClients.entries()) {
        const isInactive = now.getTime() - client.lastActivity.getTime() > maxInactiveTime;
        if (!client.socket.connected || isInactive) {
          client.socket.disconnect(true);
          this.connectedClients.delete(userId);
          cleaned++;
          this.logger.log(`Cleaned up connection for user ${userId} (${isInactive ? 'inactive' : 'disconnected'})`);
        }
      }

      this.logger.log(`Cleaned up ${cleaned} dead connections`);
      this.logger.log(`Remaining connections: ${this.connectedClients.size}`);
      this.logger.log('Remaining clients:', Array.from(this.connectedClients.keys()));
    } catch (error) {
      this.logger.error('=== Cleanup error ===');
      this.logger.error('Error:', error);
    }
  }
}

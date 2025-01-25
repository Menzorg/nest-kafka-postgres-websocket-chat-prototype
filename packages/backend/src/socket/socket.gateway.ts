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
import { ConfigService } from '@nestjs/config';

interface ConnectedClient {
  socket: Socket;
  userId: string;
  lastActivity: Date;
}

@WebSocketGateway({
  cors: {
    credentials: true
  }
})
export class SocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly io: Server;
  private connectedClients: Map<string, ConnectedClient> = new Map();
  private readonly logger = new Logger(SocketGateway.name);
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private jwtService: JwtService,
    private authService: AuthService,
    private chatService: ChatService,
    private configService: ConfigService,
  ) {}

  public async closeServer() {
    try {
      // Очищаем интервал очистки мертвых соединений
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }

      if (this.io) {
        this.logger.log('Closing Socket.IO server...');
        
        // Отключаем все соединения
        const sockets = await this.io.fetchSockets();
        this.logger.log(`Disconnecting ${sockets.length} sockets...`);
        
        await Promise.all(
          Array.from(sockets).map((socket) => {
            return new Promise<void>((resolve) => {
              socket.disconnect(true);
              resolve();
            });
          })
        );

        // Удаляем все слушатели
        this.logger.log('Removing all listeners...');
        this.io.removeAllListeners();
        
        // Закрываем сервер
        this.logger.log('Closing server...');
        await new Promise<void>((resolve) => {
          this.io.close(() => resolve());
        });
        
        // Очищаем список клиентов
        this.logger.log('Clearing connected clients...');
        this.connectedClients.clear();
        
        this.logger.log('Socket.IO server closed successfully');
      }
    } catch (error) {
      this.logger.error('Error closing Socket.IO server:', error);
      throw error;
    }
  }

  public getActiveConnections(): number {
    return this.io?.sockets?.sockets?.size || 0;
  }

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    
    // Настраиваем CORS после инициализации
    if (server) {
      const corsOrigin = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
      this.logger.log(`Setting CORS origin: ${corsOrigin}`);
      server.engine.opts.cors = {
        origin: corsOrigin,
        credentials: true
      };
    }

    // Добавляем middleware для проверки токена
    server.use(async (socket: Socket, next) => {
      try {
        this.logger.log('=== Token verification middleware ===');
        this.logger.log(`Client ID: ${socket.id}`);
        this.logger.log('Auth data:', socket.handshake?.auth);
        
        const rawToken = socket.handshake?.auth?.token;
        if (!rawToken) {
          const error = new Error('No token provided');
          this.logger.error(error.message);
          return next(error);
        }

        this.logger.log(`Raw token: ${rawToken}`);
        
        // Извлекаем токен из Bearer строки
        const token = rawToken.startsWith('Bearer ') 
          ? rawToken.substring(7) 
          : rawToken;

        try {
          const payload = await this.jwtService.verifyAsync(token);
          this.logger.log('Token verified successfully');
          
          try {
            const user = await this.authService.validateUser(payload);
            this.logger.log('User validated successfully');
            
            // Сохраняем информацию о пользователе в socket
            socket.data.user = user;
            
            // Добавляем обработчик отключения для каждого сокета
            socket.on('disconnect', (reason) => {
              this.logger.log(`Socket ${socket.id} disconnected:`, reason);
              this.handleDisconnect(socket);
            });
            
            next();
          } catch (error) {
            this.logger.error('=== User validation error ===');
            this.logger.error('Error:', error.message);
            this.logger.error('Stack:', error.stack);
            next(new Error(error.message));
          }
        } catch (error) {
          this.logger.error('=== Token verification error ===');
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

    // Запускаем периодическую очистку мертвых соединений
    this.cleanupInterval = setInterval(() => this.cleanupDeadConnections(), 30000);
  }

  async handleConnection(client: Socket) {
    try {
      this.logger.log('=== New client connection ===');
      this.logger.log('Client ID:', client.id);
      this.logger.log('User data:', client.data.user);
      this.logger.log('Connected:', client.connected);
      this.logger.log('Disconnected:', client.disconnected);
      this.logger.log('Handshake:', client.handshake);
      this.logger.log('Rooms:', Array.from(client.rooms));
      this.logger.log('Connected clients before:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

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

      // Добавляем клиента в комнату пользователя для получения уведомлений
      client.join(`user:${user.id}`);
      this.logger.log(`Client joined room user:${user.id}`);

      this.logger.log('Connected clients after:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

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
      this.logger.log('=== Handling disconnect ===');
      this.logger.log('Client ID:', client.id);
      this.logger.log('Connected:', client.connected);
      this.logger.log('Disconnected:', client.disconnected);
      this.logger.log('Handshake:', client.handshake);
      this.logger.log('Rooms:', Array.from(client.rooms));
      this.logger.log('Connected clients before:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));
      
      const clientInfo = this.connectedClients.get(client.id);
      if (clientInfo) {
        this.logger.log('Client info found:', { 
          userId: clientInfo.userId,
          connected: clientInfo.socket.connected,
          rooms: Array.from(clientInfo.socket.rooms)
        });
        
        // Сначала удаляем клиента из списка
        this.connectedClients.delete(client.id);
        this.logger.log('Client removed from connected clients');
        
        // Отправляем событие через broadcast
        this.logger.log('Broadcasting offline status');
        this.io.sockets.except(client.id).emit('users:update', { 
          userId: clientInfo.userId, 
          isOnline: false 
        });
        this.logger.log('Status broadcasted');
      } else {
        this.logger.warn('Client info not found for disconnecting client');
      }

      this.logger.log('Connected clients after:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));
      
      this.logger.log(`Client disconnected: ${client.id}`);
    } catch (error) {
      this.logger.error('Error in handleDisconnect:');
      this.logger.error(error);
    }
  }

  private broadcastUserStatus(userId: string, isOnline: boolean) {
    this.logger.log(`=== Broadcasting user status ===`);
    this.logger.log(`User ID: ${userId}, online: ${isOnline}`);
    this.logger.log('Connected sockets:', this.io.sockets.sockets.size);
    
    const data = { userId, isOnline };
    this.logger.log('Emitting data:', data);
    
    // Отправляем всем подключенным клиентам, кроме отключающегося
    const disconnectingClientId = Array.from(this.connectedClients.entries())
      .find(([_, client]) => client.userId === userId)?.[0];

    if (disconnectingClientId && !isOnline) {
      this.io.sockets.except(disconnectingClientId).emit('users:update', data);
    } else {
      this.io.sockets.emit('users:update', data);
    }
    
    this.logger.log('Status broadcasted');
  }

  @SubscribeMessage('chat:get')
  async handleGetChat(client: Socket, payload: { recipientId: string }) {
    try {
      this.logger.log('=== Handling chat:get ===');
      this.logger.log('Client:', { 
        id: client.id, 
        userId: client.data?.user?.id,
        connected: client.connected,
        disconnected: client.disconnected,
        rooms: Array.from(client.rooms)
      });
      this.logger.log('Payload:', payload);
      this.logger.log('Connected clients:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

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
      this.logger.log('=== Handling message ===');
      this.logger.log('Client:', { 
        id: client.id, 
        userId: client.data?.user?.id,
        connected: client.connected,
        disconnected: client.disconnected,
        rooms: Array.from(client.rooms)
      });
      this.logger.log('Payload:', payload);
      this.logger.log('Connected clients:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

      const userId = client.data.user.id;
      const chat = await this.chatService.getChat(payload.chatId);

      if (!chat) {
        this.logger.error(`Chat ${payload.chatId} not found`);
        throw new Error('Chat not found');
      }

      if (!chat.participants.includes(userId)) {
        this.logger.error(`User ${userId} is not a participant of chat ${payload.chatId}`);
        throw new Error('User is not a participant of this chat');
      }

      const message = await this.chatService.saveMessage({
        id: uuidv4(),
        chatId: payload.chatId,
        senderId: userId,
        content: payload.content,
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date()
      });

      this.logger.log('Message saved:', message);
      this.logger.log('Emitting to room:', `chat:${payload.chatId}`);
      this.logger.log('Room members:', Array.from(this.io.sockets.adapter.rooms.get(`chat:${payload.chatId}`) || []));

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
      this.logger.log('=== Handling users:list ===');
      this.logger.log('Client:', { 
        id: client.id, 
        userId: client.data?.user?.id,
        connected: client.connected,
        disconnected: client.disconnected,
        rooms: Array.from(client.rooms)
      });
      this.logger.log('Connected clients:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

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
      this.logger.log('Client:', { 
        id: client.id, 
        userId: client.data?.user?.id,
        connected: client.connected,
        disconnected: client.disconnected,
        rooms: Array.from(client.rooms)
      });
      this.logger.log('Payload:', payload);
      this.logger.log('Connected clients:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

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
      this.logger.log('Updated client rooms:', Array.from(client.rooms));
      this.logger.log('Room members:', Array.from(this.io.sockets.adapter.rooms.get(`chat:${payload.chatId}`) || []));

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
      this.logger.log('Client:', { 
        id: client.id, 
        userId: client.data?.user?.id,
        connected: client.connected,
        disconnected: client.disconnected,
        rooms: Array.from(client.rooms)
      });
      this.logger.log('Payload:', payload);
      this.logger.log('Connected clients:', Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      })));

      const userId = client.data.user.id;
      const message = await this.chatService.getMessage(payload.messageId);

      if (!message) {
        this.logger.error(`Message ${payload.messageId} not found`);
        return { status: 'error', message: 'Message not found' };
      }

      this.logger.log('Message found:', message);
      this.logger.log('Sender room:', `user:${message.senderId}`);
      this.logger.log('Room members:', Array.from(this.io.sockets.adapter.rooms.get(`user:${message.senderId}`) || []));

      // Проверяем, что пользователь является участником чата
      const chat = await this.chatService.getChat(message.chatId);
      if (!chat.participants.includes(userId)) {
        this.logger.error(`User ${userId} is not a participant of chat ${message.chatId}`);
        return { status: 'error', message: 'User is not a participant of this chat' };
      }

      // Обновляем статус сообщения
      await this.chatService.updateMessageStatus(payload.messageId, MessageDeliveryStatus.READ);
      
      const statusUpdate = {
        messageId: payload.messageId,
        status: MessageDeliveryStatus.READ,
        timestamp: new Date().toISOString()
      };
      
      this.logger.log('Emitting status update:', statusUpdate);
      this.logger.log('To room:', `user:${message.senderId}`);
      
      // Уведомляем отправителя об обновлении статуса
      this.io.to(`user:${message.senderId}`).emit('message:status', statusUpdate);
      
      this.logger.log('Status update emitted');
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

  async onModuleDestroy() {
    if (this.io) {
      try {
        // Отключаем все соединения
        const sockets = await this.io.fetchSockets();
        for (const socket of sockets) {
          socket.disconnect(true);
        }
        
        // Закрываем сервер и ждем пока все соединения закроются
        await new Promise<void>((resolve) => {
          this.io.close(() => {
            resolve();
          });
        });
      } catch (error) {
        // Игнорируем ошибку если сервер уже не запущен
        if (error.message !== 'Server is not running') {
          throw error;
        }
      }
    }
  }
}

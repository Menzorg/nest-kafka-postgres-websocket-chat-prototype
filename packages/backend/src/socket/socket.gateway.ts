import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import { ChatService } from '../chat/chat.service';
import { ChatMessage, MessageDeliveryStatus } from '@webchat/common';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { WsExceptionsFilter } from '../common/filters/ws-exceptions.filter';

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
@UseFilters(new WsExceptionsFilter())
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
    this.logger.log('=== Client disconnecting ===', {
      socketId: client.id,
      userId: client.data?.user?.id,
      rooms: Array.from(client.rooms),
      connected: client.connected,
      disconnected: client.disconnected
    });

    // Получаем информацию о клиенте до удаления
    const clientInfo = this.connectedClients.get(client.id);
    if (clientInfo) {
      this.logger.log('=== Found client info ===', {
        socketId: client.id,
        userId: clientInfo.userId,
        lastActivity: clientInfo.lastActivity,
        otherSockets: Array.from(this.connectedClients.entries())
          .filter(([socketId]) => socketId !== client.id)
          .filter(([_, client]) => client.userId === clientInfo.userId)
          .map(([socketId]) => socketId)
      });

      // Проверяем комнаты перед отключением
      const rooms = this.io.sockets.adapter.rooms;
      this.logger.log('=== Rooms before disconnect ===', {
        allRooms: Array.from(rooms.keys()).map(roomName => ({
          name: roomName,
          members: Array.from(rooms.get(roomName) || [])
        }))
      });

      // Удаляем клиента из списка подключенных
      this.connectedClients.delete(client.id);

      // Проверяем, есть ли еще активные соединения у пользователя
      const hasOtherConnections = Array.from(this.connectedClients.values())
        .some(client => client.userId === clientInfo.userId);

      this.logger.log('=== User connection status ===', {
        userId: clientInfo.userId,
        hasOtherConnections,
        remainingConnections: Array.from(this.connectedClients.entries())
          .filter(([_, client]) => client.userId === clientInfo.userId)
          .map(([id]) => id)
      });

      // Если это было последнее соединение пользователя, оповещаем других
      if (!hasOtherConnections) {
        this.broadcastUserStatus(clientInfo.userId, false);
      }

      // Проверяем комнаты после отключения
      this.logger.log('=== Rooms after disconnect ===', {
        allRooms: Array.from(rooms.keys()).map(roomName => ({
          name: roomName,
          members: Array.from(rooms.get(roomName) || [])
        }))
      });
    }

    this.logger.log('=== Client disconnected ===', {
      totalConnections: this.connectedClients.size,
      remainingClients: Array.from(this.connectedClients.keys())
    });
  }

  private broadcastUserStatus(userId: string, isOnline: boolean) {
    this.logger.log(`=== Broadcasting user status ===`);
    this.logger.log(`User ID: ${userId}, online: ${isOnline}`);
    this.logger.log('Connected sockets:', this.io.sockets.sockets.size);
    
    const data = { userId, isOnline };
    this.logger.log('Emitting data:', data);
    
    // Отправляем всем подключенным клиентам
    this.io.emit('users:update', data);
    
    this.logger.log('Status broadcasted');
  }

  private isUserInActiveChat(userId: string, chatId: string): boolean {
    this.logger.log('=== Checking if user is in active chat ===', {
      userId,
      chatId
    });

    const roomName = `chat:${chatId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    
    this.logger.log('Room state:', {
      exists: !!room,
      members: room ? Array.from(room) : [],
      roomName
    });

    if (!room) {
      this.logger.log('Room does not exist, user is not in chat');
      return false;
    }

    // Находим все сокеты пользователя
    const userSockets = Array.from(this.connectedClients.entries())
      .filter(([_, client]) => client.userId === userId)
      .map(([socketId]) => socketId);

    this.logger.log('User sockets:', {
      userId,
      socketIds: userSockets,
      connectedClients: Array.from(this.connectedClients.entries()).map(([id, client]) => ({
        socketId: id,
        userId: client.userId,
        connected: client.socket.connected
      }))
    });

    // Проверяем, есть ли хотя бы один сокет пользователя в комнате
    const isInChat = userSockets.some(socketId => room.has(socketId));
    
    this.logger.log('Check result:', {
      userId,
      chatId,
      isInChat,
      userSocketsInRoom: userSockets.filter(socketId => room.has(socketId))
    });

    return isInChat;
  }

  @SubscribeMessage('message')
  async handleMessage(client: Socket, payload: { chatId: string; content: string }) {
    const requestId = uuidv4();
    const userId = client.data?.user?.id;
    if (!userId) {
      this.logger.error('=== Message handling failed: No user ID ===');
      return;
    }

    this.logger.log(`=== Starting message handling (Request ID: ${requestId}) ===`);
    this.logger.log('Client:', {
      id: client.id,
      userId,
      connected: client.connected,
      disconnected: client.disconnected,
      rooms: Array.from(client.rooms)
    });
    this.logger.log('Payload:', payload);

    // Получаем чат и проверяем права
    this.logger.log(`[${requestId}] Getting chat for user ${userId}`);
    const chat = await this.chatService.getChat(payload.chatId);

    // Проверяем статус получателя
    const recipientId = chat.participants.find((id: string) => id !== userId);
    this.logger.log(`[${requestId}] Checking active chats:`, {
      senderId: userId,
      recipientId,
      chatId: payload.chatId
    });

    // Проверяем состояние комнаты
    const roomName = `chat:${payload.chatId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    this.logger.log(`[${requestId}] Room state when sending message:`, {
      roomName,
      exists: !!room,
      members: room ? Array.from(room) : []
    });

    // Проверяем все сокеты получателя
    const recipientSockets = Array.from(this.connectedClients.entries())
      .filter(([_, client]) => client.userId === recipientId)
      .map(([socketId]) => ({
        socketId,
        inRoom: room?.has(socketId) || false
      }));

    this.logger.log(`[${requestId}] Recipient sockets:`, {
      recipientId,
      sockets: recipientSockets,
      totalSockets: recipientSockets.length
    });

    const isRecipientInChat = recipientSockets.some(socket => socket.inRoom);
    this.logger.log(`[${requestId}] Recipient ${recipientId} in chat: ${isRecipientInChat}`);

    // Определяем начальный статус сообщения
    const initialStatus = isRecipientInChat ? MessageDeliveryStatus.DELIVERED : MessageDeliveryStatus.SENT;
    this.logger.log(`[${requestId}] Initial message status: ${initialStatus}`);

    // Сохраняем сообщение
    const message = await this.chatService.saveMessage({
      id: uuidv4(),
      chatId: payload.chatId,
      senderId: userId,
      content: payload.content,
      status: initialStatus,
      createdAt: new Date()
    });

    this.logger.log(`[${requestId}] Message saved:`, {
      id: message.id,
      senderId: message.senderId,
      status: message.status
    });

    // Отправляем сообщение в комнату чата
    this.io.to(roomName).emit('message', message);
    this.logger.log(`[${requestId}] Message broadcasted to chat room: ${roomName}`);

    // Отправляем подтверждение отправителю
    client.emit('message:ack', { messageId: message.id });
    this.logger.log(`[${requestId}] Acknowledgment sent to sender`);

    this.logger.log(`=== Finished message handling (Request ID: ${requestId}) ===`);
    return message;
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
      const userId = client.data?.user?.id;
      if (!userId) {
        this.logger.error('=== Chat join failed: No user ID ===');
        return;
      }

      const requestId = uuidv4();
      this.logger.log(`=== Starting chat join (Request ID: ${requestId}) ===`);
      this.logger.log('Client:', { 
        id: client.id, 
        userId,
        connected: client.connected,
        disconnected: client.disconnected,
        rooms: Array.from(client.rooms)
      });
      this.logger.log('Payload:', payload);

      // Проверяем существование чата
      this.logger.log(`[${requestId}] Getting chat for user ${userId}`);
      const chat = await this.chatService.getChat(payload.chatId);

      if (!chat) {
        this.logger.error(`[${requestId}] Chat ${payload.chatId} not found`);
        throw new Error('Chat not found');
      }

      if (!chat.participants.includes(userId)) {
        this.logger.error(`[${requestId}] User ${userId} is not a participant of chat ${payload.chatId}`);
        throw new Error('User is not a participant of this chat');
      }

      // Присоединяемся к комнате чата
      const roomName = `chat:${payload.chatId}`;
      this.logger.log(`[${requestId}] Joining room ${roomName}`);
      await client.join(roomName);

      this.logger.log(`[${requestId}] Room members after join:`, 
        Array.from(this.io.sockets.adapter.rooms.get(roomName) || []));

      // Получаем непрочитанные сообщения
      this.logger.log(`[${requestId}] Getting undelivered messages for user ${userId} in chat ${payload.chatId}`);
      const undeliveredMessages = await this.chatService.getUndeliveredMessages(userId, payload.chatId);
      this.logger.log(`[${requestId}] Found ${undeliveredMessages.length} undelivered messages:`, 
        undeliveredMessages.map(m => ({
          id: m.id,
          senderId: m.senderId,
          status: m.status,
          content: m.content.substring(0, 20) + (m.content.length > 20 ? '...' : '')
        }))
      );
      
      // Обновляем статус сообщений на DELIVERED
      for (const message of undeliveredMessages) {
        this.logger.log(`[${requestId}] Processing message ${message.id}:`);
        this.logger.log(`[${requestId}] - Current status: ${message.status}`);
        this.logger.log(`[${requestId}] - Sender: ${message.senderId}`);
        
        await this.chatService.updateMessageStatus(message.id, MessageDeliveryStatus.DELIVERED);
        this.logger.log(`[${requestId}] - Status updated to DELIVERED`);
        
        // Находим сокеты отправителя
        const senderSockets = Array.from(this.connectedClients.entries())
          .filter(([_, client]) => client.userId === message.senderId)
          .map(([socketId]) => socketId);
        
        this.logger.log(`[${requestId}] - Sender sockets:`, senderSockets);
        
        // Уведомляем отправителя об обновлении статуса
        for (const socketId of senderSockets) {
          this.io.to(socketId).emit('message:status', {
            messageId: message.id,
            status: MessageDeliveryStatus.DELIVERED
          });
        }
      }

      this.logger.log(`=== Finished chat join (Request ID: ${requestId}) ===`);

      return {
        status: 'ok',
        message: 'Joined chat room successfully'
      };
    } catch (error) {
      this.logger.error('Error in handleChatJoin:', error);
      throw error;
    }
  }

  @SubscribeMessage('chat:leave')
  async handleChatLeave(client: Socket, payload: { chatId: string }): Promise<{ success: boolean }> {
    const requestId = uuidv4();
    const userId = client.data?.user?.id;
    if (!userId) {
      this.logger.error('=== Chat leave failed: No user ID ===');
      return { success: false };
    }

    this.logger.log(`=== Starting chat leave (Request ID: ${requestId}) ===`);
    this.logger.log('Client:', {
      id: client.id,
      userId,
      connected: client.connected,
      disconnected: client.disconnected,
      rooms: Array.from(client.rooms)
    });
    this.logger.log('Payload:', payload);

    const roomName = `chat:${payload.chatId}`;
    
    // Проверяем состояние комнаты до выхода
    const roomBefore = this.io.sockets.adapter.rooms.get(roomName);
    this.logger.log(`[${requestId}] Room state before leave:`, {
      roomName,
      exists: !!roomBefore,
      members: roomBefore ? Array.from(roomBefore) : []
    });

    try {
      // Покидаем комнату
      await client.leave(roomName);

      // Проверяем все сокеты этого пользователя
      const userSockets = Array.from(this.connectedClients.entries())
        .filter(([_, socket]) => socket.userId === userId)
        .map(([socketId]) => this.io.sockets.sockets.get(socketId))
        .filter((socket): socket is Socket => socket !== undefined);

      this.logger.log(`[${requestId}] User sockets:`, {
        userId,
        total: userSockets.length,
        socketIds: userSockets.map(socket => socket.id)
      });

      // Отключаем все сокеты пользователя от этой комнаты
      for (const socket of userSockets) {
        await socket.leave(roomName);
        this.logger.log(`[${requestId}] Socket ${socket.id} left room ${roomName}`);
      }
    } catch (error) {
      this.logger.error(`[${requestId}] Error during room leave:`, error);
      return { success: false };
    }
    
    // Проверяем состояние комнаты после выхода
    const roomAfter = this.io.sockets.adapter.rooms.get(roomName);
    this.logger.log(`[${requestId}] Room state after leave:`, {
      roomName,
      exists: !!roomAfter,
      members: roomAfter ? Array.from(roomAfter) : []
    });

    this.logger.log(`=== Finished chat leave (Request ID: ${requestId}) ===`);
    return { success: true };
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

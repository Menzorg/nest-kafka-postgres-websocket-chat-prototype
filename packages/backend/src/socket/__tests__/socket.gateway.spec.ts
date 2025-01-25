import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import { SocketGateway } from '../socket.gateway';
import { SocketAdapter } from '../socket.adapter';
import { AuthService } from '../../auth/auth.service';
import { ChatService } from '../../chat/chat.service';
import { JwtModule } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user/user.service';

jest.setTimeout(15000);

describe('SocketGateway', () => {
  let app: INestApplication;
  let gateway: SocketGateway;
  let socketAdapter: SocketAdapter;
  let socket: Socket | null = null;
  let socket2: Socket | null = null;
  let authService: AuthService;
  let jwtService: JwtService;
  let userService: UserService;
  let chatService: ChatService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'FRONTEND_URL':
          return 'http://localhost:3000';
        case 'JWT_SECRET':
          return 'test-secret-key';
        default:
          return undefined;
      }
    }),
  };

  const mockUserService = {
    findById: jest.fn((id) => {
      if (id === 'test-user-id') {
        return Promise.resolve({
          id: 'test-user-id',
          email: 'test@example.com',
          name: 'Test User'
        });
      }
      return Promise.resolve(null);
    }),
    findAll: jest.fn(() => Promise.resolve([]))
  };

  const mockAuthService = {
    validateUser: jest.fn().mockImplementation((payload) => {
      if (payload.sub === 'test-user-id') {
        return Promise.resolve({
          id: 'test-user-id',
          email: 'test@example.com',
          name: 'Test User'
        });
      }
      throw new UnauthorizedException('User not found');
    }),
    getAllUsers: jest.fn(() => Promise.resolve([]))
  };

  const mockChatService = {
    findChatByParticipants: jest.fn((userId1, userId2) => {
      if (userId1 === 'test-user-id' && userId2 === 'other-user-id') {
        return Promise.resolve({
          id: 'test-chat-id',
          participants: [userId1, userId2],
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      return Promise.resolve(undefined);
    }),
    createChat: jest.fn((userId1, userId2) => {
      return Promise.resolve({
        id: 'new-chat-id',
        participants: [userId1, userId2],
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }),
    getChatMessages: jest.fn(() => Promise.resolve([])),
    getChat: jest.fn((id) => {
      return Promise.resolve({
        id,
        participants: ['test-user-id', 'other-user-id'],
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }),
    saveMessage: jest.fn((message) => Promise.resolve(message)),
    getMessage: jest.fn((id) => Promise.resolve({
      id,
      chatId: 'test-chat-id',
      senderId: 'test-user-id',
      content: 'test message',
      status: 'SENT',
      createdAt: new Date()
    })),
    updateMessageStatus: jest.fn(),
    getUndeliveredMessages: jest.fn(() => Promise.resolve([]))
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      providers: [
        SocketGateway,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    gateway = moduleFixture.get<SocketGateway>(SocketGateway);
    authService = moduleFixture.get<AuthService>(AuthService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
    userService = moduleFixture.get<UserService>(UserService);
    chatService = moduleFixture.get<ChatService>(ChatService);

    socketAdapter = new SocketAdapter(app);
    app.useWebSocketAdapter(socketAdapter);

    await app.init();
    await app.listen(0);
  });

  afterEach(async () => {
    // Закрываем сокеты если они открыты
    if (socket?.connected) {
      socket.disconnect();
    }
    if (socket2?.connected) {
      socket2.disconnect();
    }

    socket = null;
    socket2 = null;

    // Важно: закрываем сервер и очищаем все интервалы
    await gateway.closeServer();
    
    // Закрываем приложение
    await app.close();

    // Очищаем все моки
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Закрываем все соединения
    if (socket?.connected) {
      socket.disconnect();
    }
    if (socket2?.connected) {
      socket2.disconnect();
    }
    
    // Закрываем сервер
    await gateway?.closeServer();
    
    // Закрываем приложение
    await app?.close();

    // Очищаем все таймеры
    jest.clearAllTimers();
    
    // Очищаем все моки
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    let authSocket: Socket | null = null;

    beforeEach(async () => {
      // Создаем тестового пользователя
      const testUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User'
      };

      // Настраиваем моки
      mockAuthService.validateUser.mockImplementation((payload) => {
        if (payload.sub === 'test-user-id') {
          return Promise.resolve({
            id: 'test-user-id',
            email: 'test@example.com',
            name: 'Test User'
          });
        }
        throw new UnauthorizedException('User not found');
      });

      // Создаем токен
      const testToken = jwtService.sign({ sub: 'test-user-id' });

      // Создаем сокет
      authSocket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken}` },
        transports: ['websocket']
      });
    });

    afterEach(() => {
      if (authSocket?.connected) {
        authSocket.disconnect();
      }
      authSocket = null;
    });

    it('should fail connection without token', (done) => {
      const socketWithoutToken = io(`http://localhost:${app.getHttpServer().address().port}`, {
        transports: ['websocket']
      });

      if (!socketWithoutToken) return done(new Error('Socket not initialized'));

      const handleConnectError = (error: Error) => {
        expect(error.message).toBe('No token provided');
        socketWithoutToken.disconnect();
        done();
      };

      socketWithoutToken.on('connect_error', handleConnectError);
      socketWithoutToken.connect();
    });

    it('should fail connection with invalid token', (done) => {
      const socketWithInvalidToken = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: 'invalid-token' },
        transports: ['websocket']
      });

      if (!socketWithInvalidToken) return done(new Error('Socket not initialized'));

      const handleConnectError = (error: Error) => {
        expect(error.message).toBe('jwt malformed');
        socketWithInvalidToken.disconnect();
        done();
      };

      socketWithInvalidToken.on('connect_error', handleConnectError);
      socketWithInvalidToken.connect();
    });

    it('should fail connection with non-existent user token', (done) => {
      const invalidToken = jwtService.sign({ sub: 'non-existent-user' });

      const socketWithNonExistentUserToken = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${invalidToken}` },
        transports: ['websocket']
      });

      if (!socketWithNonExistentUserToken) return done(new Error('Socket not initialized'));

      const handleConnectError = (error: Error) => {
        expect(error.message).toBe('User not found');
        socketWithNonExistentUserToken.disconnect();
        done();
      };

      socketWithNonExistentUserToken.on('connect_error', handleConnectError);
      socketWithNonExistentUserToken.connect();
    });

    it('should connect with valid token', (done) => {
      const testToken = jwtService.sign({ sub: 'test-user-id' });
      const socketWithValidToken = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken}` },
        transports: ['websocket']
      });

      if (!socketWithValidToken) return done(new Error('Socket not initialized'));

      const handleConnect = () => {
        expect(socketWithValidToken?.connected).toBe(true);
        socketWithValidToken.disconnect();
        done();
      };

      socketWithValidToken.on('connect', handleConnect);
      socketWithValidToken.connect();
    });
  });

  describe.skip('Connection Management', () => {
    let testUser: any;
    let testToken: string;

    beforeEach(async () => {
      // Создаем тестового пользователя
      testUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User'
      };

      // Настраиваем моки
      mockAuthService.validateUser.mockImplementation((payload) => {
        if (payload.sub === 'test-user-id') {
          return Promise.resolve({
            id: 'test-user-id',
            email: 'test@example.com',
            name: 'Test User'
          });
        }
        throw new UnauthorizedException('User not found');
      });

      // Создаем токен
      testToken = jwtService.sign({ sub: testUser.id });

      // Создаем сокет с аутентификацией
      socket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken}` },
        transports: ['websocket']
      });
    });

    afterEach(() => {
      if (socket?.connected) {
        socket.disconnect();
      }
      socket = null;
    });

    it('should add client to connectedClients and send confirmation on connection', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleEstablished = (data: any) => {
        expect(data.userId).toBe(testUser.id);
        expect(gateway.getActiveConnections()).toBe(1);
        done();
      };

      socket.on('connection:established', handleEstablished);
      socket.connect();
    });

    it('should update lastActivity on client connection', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleConnect = () => {
        const client = Array.from(gateway['connectedClients'].values())[0];
        expect(client.lastActivity).toBeInstanceOf(Date);
        expect(client.userId).toBe(testUser.id);
        done();
      };

      socket.on('connect', handleConnect);
      socket.connect();
    });

    it('should remove client and broadcast status on disconnect', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      console.log('=== Starting disconnect test ===');

      // Создаем второй сокет для получения broadcast событий
      socket2 = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken}` },
        transports: ['websocket']
      });

      if (!socket2) return done(new Error('Socket2 not initialized'));

      const handleSocket2Connect = () => {
        console.log('Socket2 connected');

        const handleUsersUpdate = (data: any) => {
          console.log('Socket2 received users:update:', data);

          if (data.isOnline) {
            console.log('Socket2: Ignoring online status update');
            return;
          }

          console.log('Socket2: Processing offline status update');
          expect(data.userId).toBe(testUser.id);
          expect(data.isOnline).toBe(false);

          console.log('Active connections after disconnect:', gateway.getActiveConnections());
          expect(gateway.getActiveConnections()).toBe(1);

          socket2?.disconnect();
          done();
        };

        socket2?.on('users:update', handleUsersUpdate);

        // Создаем первый сокет
        if (!socket) return done(new Error('Socket1 not initialized'));

        const handleSocket1Connect = () => {
          console.log('Socket1 connected');

          setTimeout(() => {
            console.log('Disconnecting socket1...');
            socket?.disconnect();
          }, 100);
        };

        socket.on('connect', handleSocket1Connect);
        socket.connect();
      };

      socket2.on('connect', handleSocket2Connect);
      socket2.connect();
    }, 15000);

    it('should cleanup all listeners on disconnect', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      console.log('=== Starting cleanup test ===');

      const handleConnect = () => {
        console.log('Socket connected');

        if (!socket) return done(new Error('Socket not initialized'));
        
        // Добавляем тестовый обработчик
        socket.on('test:event', () => {});

        const initialListenersCount = socket.listeners('test:event').length;
        console.log('Listeners before disconnect:', initialListenersCount);

        const handleDisconnect = () => {
          console.log('Socket disconnected');

          if (!socket) return done(new Error('Socket not initialized'));
          
          const finalListenersCount = socket.listeners('test:event').length;
          console.log('Listeners after manual cleanup:', finalListenersCount);

          expect(finalListenersCount).toBe(0);
          expect(gateway.getActiveConnections()).toBe(0);

          done();
        };

        socket.on('disconnect', handleDisconnect);

        console.log('Waiting before disconnect...');
        setTimeout(() => {
          console.log('Calling disconnect...');
          socket?.disconnect();
        }, 100);
      };

      socket.on('connect', handleConnect);
      socket.connect();
    }, 15000);

    it('should handle multiple connections and disconnections correctly', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      // Настраиваем мок для двух разных пользователей
      mockAuthService.validateUser
        .mockResolvedValueOnce({
          id: 'test-user-id',
          email: 'test@example.com',
          name: 'Test User'
        })
        .mockResolvedValueOnce({
          id: 'test-user-2',
          email: 'test2@example.com',
          name: 'Test User 2'
        });

      // Создаем второй токен
      const testToken2 = jwtService.sign({ sub: 'test-user-2' });

      // Создаем второй сокет
      socket2 = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken2}` },
        transports: ['websocket']
      });

      if (!socket2) return done(new Error('Socket2 not initialized'));

      let socket1Connected = false;
      let socket2Connected = false;

      const handleSocket1Connect = () => {
        socket1Connected = true;
        if (socket1Connected && socket2Connected) {
          expect(gateway.getActiveConnections()).toBe(2);
          socket?.disconnect();
          socket2?.disconnect();
          done();
        }
      };

      const handleSocket2Connect = () => {
        socket2Connected = true;
        if (socket1Connected && socket2Connected) {
          expect(gateway.getActiveConnections()).toBe(2);
          socket?.disconnect();
          socket2?.disconnect();
          done();
        }
      };

      socket.on('connect', handleSocket1Connect);
      socket2.on('connect', handleSocket2Connect);

      socket.connect();
      socket2.connect();
    });
  });

  describe.skip('Chat Management', () => {
    let testUser: any;
    let testToken: string;
    let otherUser: any;

    beforeEach(async () => {
      // Создаем тестового пользователя
      testUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User'
      };
      
      // Создаем второго пользователя для тестов чата
      otherUser = {
        id: 'other-user-id',
        email: 'other@example.com',
        name: 'Other User'
      };

      // Настраиваем моки
      mockUserService.findById.mockImplementation((id) => {
        if (id === testUser.id) return Promise.resolve(testUser);
        if (id === otherUser.id) return Promise.resolve(otherUser);
        return Promise.resolve(null);
      });

      // Создаем токен с правильным payload
      testToken = jwtService.sign({ sub: testUser.id });

      // Создаем сокет с аутентификацией
      socket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken}` },
        transports: ['websocket']
      });

      // Ждем подключения
      await new Promise<void>((resolve) => {
        socket?.on('connection:established', () => {
          resolve();
        });
        socket?.connect();
      });
    });

    afterEach(() => {
      if (socket?.connected) {
        socket.disconnect();
      }
      socket = null;
      jest.clearAllMocks();
    });

    it('should get existing chat', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      console.log('Socket connected, requesting chat...');
      
      socket.emit('chat:get', { recipientId: otherUser.id });

      socket.on('chat:get:response', (data: any) => {
        console.log('Received chat:get:response:', data);
        
        expect(data).toBeDefined();
        expect(data.chatId).toBe('test-chat-id');
        expect(data.messages).toEqual([]);
        
        // Проверяем что был вызван правильный метод
        expect(mockChatService.findChatByParticipants).toHaveBeenCalledWith(testUser.id, otherUser.id);
        
        done();
      });
    }, 15000);

    it('should create new chat', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      // Переопределяем мок для этого теста
      mockChatService.findChatByParticipants.mockResolvedValueOnce(undefined);

      console.log('Socket connected, creating chat...');
      
      socket.emit('chat:get', { recipientId: 'new-user-id' });

      socket.on('chat:get:response', (data: any) => {
        console.log('Received chat:get:response:', data);
        
        expect(data).toBeDefined();
        expect(data.chatId).toBe('new-chat-id');
        expect(data.messages).toEqual([]);
        
        // Проверяем что были вызваны правильные методы
        expect(mockChatService.findChatByParticipants).toHaveBeenCalledWith(testUser.id, 'new-user-id');
        expect(mockChatService.createChat).toHaveBeenCalledWith(testUser.id, 'new-user-id');
        
        done();
      });
    }, 15000);
  });
});

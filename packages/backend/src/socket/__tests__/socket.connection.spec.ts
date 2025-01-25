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
  let timeoutId: NodeJS.Timeout | undefined;

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
      if (id === 'test-user-id' || id === 'other-user-id') {
        return Promise.resolve({
          id: id,
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
      if (payload.sub === 'test-user-id' || payload.sub === 'other-user-id') {
        return Promise.resolve({
          id: payload.sub,
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
          secret: 'test-secret-key',
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
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    // Создаем приложение и инициализируем его
    app = moduleFixture.createNestApplication();
    await app.init();

    // Получаем все сервисы
    gateway = moduleFixture.get<SocketGateway>(SocketGateway);
    jwtService = moduleFixture.get<JwtService>(JwtService);
    authService = moduleFixture.get<AuthService>(AuthService);
    userService = moduleFixture.get<UserService>(UserService);
    chatService = moduleFixture.get<ChatService>(ChatService);

    // Создаем и настраиваем адаптер
    socketAdapter = new SocketAdapter(app);
    app.useWebSocketAdapter(socketAdapter);

    // Запускаем сервер на случайном порту
    await app.listen(0);

    // Создаем тестовый сокет
    const testToken = jwtService.sign({ sub: 'test-user-id' });
    socket = io(`http://localhost:${app.getHttpServer().address().port}`, {
      auth: { token: `Bearer ${testToken}` },
      transports: ['websocket'],
      autoConnect: false // Отключаем автоматическое подключение
    });
  });

  afterEach(async () => {
    // Закрываем все соединения
    if (socket?.connected) {
      socket.disconnect();
    }
    if (socket2) {
      socket2.disconnect();
    }

    // Очищаем таймаут
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Явно вызываем closeServer для очистки всех ресурсов
    await gateway.closeServer();
    
    // Увеличиваем время ожидания закрытия соединений
    await new Promise(resolve => setTimeout(resolve, 500));

    // Закрываем приложение
    await app.close();
  });

  describe('Connection Management', () => {
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
        if (payload.sub === 'test-user-id' || payload.sub === 'other-user-id') {
          return Promise.resolve({
            id: payload.sub,
            email: 'test@example.com',
            name: 'Test User'
          });
        }
        throw new UnauthorizedException('User not found');
      });

      // Создаем токен
      testToken = jwtService.sign({ sub: 'test-user-id' });

      // Создаем сокет
      socket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${testToken}` },
        transports: ['websocket']
      });
    });

    it('should add client to connectedClients and send confirmation on connection', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleEstablished = (data: any) => {
        expect(data.userId).toBe(testUser.id);
        expect(gateway.getActiveConnections()).toBe(1);
        socket?.disconnect();
        done();
      };

      socket.on('connection:established', handleEstablished);
      socket.connect();
    });

    it('should update lastActivity on client connection', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleConnect = () => {
        expect(socket?.connected).toBe(true);
        socket?.disconnect();
        done();
      };

      socket.on('connect', handleConnect);
      socket.connect();
    });

    it('should remove client and broadcast status on disconnect', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleConnect = () => {
        expect(socket?.connected).toBe(true);
        // Даем время на обработку подключения
        setTimeout(() => {
          socket?.disconnect();
        }, 100);
      };

      const handleDisconnect = () => {
        // Даем время на обработку отключения
        setTimeout(() => {
          expect(gateway.getActiveConnections()).toBe(0);
          done();
        }, 100);
      };

      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.connect();
    }, 10000);

    it('should cleanup all listeners on disconnect', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleConnect = () => {
        expect(socket?.connected).toBe(true);
        // Даем время на обработку подключения
        setTimeout(() => {
          socket?.disconnect();
        }, 100);
      };

      const handleDisconnect = () => {
        // Даем время на обработку отключения
        setTimeout(() => {
          expect(gateway.getActiveConnections()).toBe(0);
          done();
        }, 100);
      };

      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.connect();
    }, 10000);

    it('should handle multiple connections and disconnections correctly', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      // Создаем второй сокет
      socket2 = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${jwtService.sign({ sub: 'other-user-id' })}` },
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
    }, 15000);
  });
});

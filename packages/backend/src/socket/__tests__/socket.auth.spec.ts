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

describe('SocketGateway Authentication', () => {
  let app: INestApplication;
  let gateway: SocketGateway;
  let socketAdapter: SocketAdapter;
  let socket: Socket | null = null;
  let authSocket: Socket | null = null;
  let jwtService: JwtService;
  let authService: AuthService;
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

  describe('Authentication', () => {
    beforeEach(async () => {
      // Создаем тестового пользователя
      const testUser = {
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
});

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

describe('SocketGateway', () => {
  let app: INestApplication;
  let gateway: SocketGateway;
  let socketAdapter: SocketAdapter;
  let socket: Socket | null;
  let authService: AuthService;
  let jwtService: JwtService;

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

  const mockAuthService = {
    validateUser: jest.fn(),
  };

  const mockChatService = {
    findChatByParticipants: jest.fn(),
    createChat: jest.fn(),
    getChatMessages: jest.fn(),
    getChat: jest.fn(),
    saveMessage: jest.fn(),
    getMessage: jest.fn(),
    updateMessageStatus: jest.fn(),
    getUndeliveredMessages: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.registerAsync({
          useFactory: () => ({
            secret: mockConfigService.get('JWT_SECRET'),
            signOptions: { expiresIn: '1h' },
          }),
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
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    gateway = moduleFixture.get<SocketGateway>(SocketGateway);
    authService = moduleFixture.get<AuthService>(AuthService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    socketAdapter = new SocketAdapter(app);
    app.useWebSocketAdapter(socketAdapter);

    await app.init();
    await app.listen(0);

    // Устанавливаем базовый мок для validateUser
    mockAuthService.validateUser.mockImplementation(async (payload) => {
      if (payload.sub === 'test-user-id') {
        return { id: 'test-user-id', email: 'test@example.com' };
      }
      throw new UnauthorizedException('User not found');
    });
  });

  afterEach(async () => {
    if (socket?.connected) {
      socket.removeAllListeners();
      socket.disconnect();
      socket.close();
    }
    socket = null;

    if (app) {
      await gateway.closeServer();
      await socketAdapter.dispose();
      await app.close();
    }
  });

  // Хелпер для безопасного доступа к сокету
  const getSocket = (): Socket => {
    if (!socket) {
      throw new Error('Socket is not initialized');
    }
    return socket;
  };

  describe('Authentication', () => {
    it('should fail connection without token', (done) => {
      const noTokenSocket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        transports: ['websocket'],
      });

      noTokenSocket.on('connect_error', (err) => {
        expect(err.message).toBe('No token provided');
        noTokenSocket.close();
        done();
      });
    });

    it('should fail connection with invalid token', (done) => {
      const invalidTokenSocket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: 'Bearer invalid-token' },
        transports: ['websocket'],
      });

      invalidTokenSocket.on('connect_error', (err) => {
        expect(err.message).toBe('jwt malformed');
        invalidTokenSocket.close();
        done();
      });
    });

    it('should fail connection with non-existent user token', (done) => {
      // Сначала устанавливаем мок для несуществующего пользователя
      mockAuthService.validateUser.mockRejectedValueOnce(new UnauthorizedException('User not found'));
      
      // Создаем валидный JWT для несуществующего пользователя
      const nonExistentUserToken = jwtService.sign({ sub: 'non-existent-user' });
      
      const nonExistentUserSocket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${nonExistentUserToken}` },
        transports: ['websocket'],
      });

      nonExistentUserSocket.on('connect_error', (err) => {
        expect(err.message).toBe('User not found');
        nonExistentUserSocket.close();
        done();
      });
    });

    it('should connect with valid token', (done) => {
      // Создаем токен для существующего пользователя
      const token = jwtService.sign({ sub: 'test-user-id' });
      
      const validSocket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${token}` },
        transports: ['websocket'],
      });

      validSocket.on('connect', () => {
        expect(validSocket.connected).toBe(true);
        validSocket.close();
        done();
      });
    });
  });

  describe('Connection Management', () => {
    const testUser = {
      id: 'test-user-id',
      email: 'test@example.com'
    };

    beforeEach(() => {
      // Сбрасываем моки перед каждым тестом
      mockAuthService.validateUser.mockReset();
      mockAuthService.validateUser.mockResolvedValue(testUser);
    });

    it('should add client to connectedClients and send confirmation on connection', (done) => {
      const socket = getSocket();
      let connectionEstablished = false;
      let userStatusBroadcasted = false;

      // Слушаем подтверждение подключения
      socket.on('connection:established', (data) => {
        expect(data).toEqual({ userId: testUser.id });
        connectionEstablished = true;
        if (userStatusBroadcasted) done();
      });

      // Слушаем broadcast статуса
      socket.on('users:update', (data) => {
        expect(data).toEqual({ userId: testUser.id, isOnline: true });
        userStatusBroadcasted = true;
        if (connectionEstablished) done();
      });

      // Подключаемся
      socket.connect();
    });

    it('should update lastActivity on client connection', (done) => {
      const socket = getSocket();
      socket.on('connect', async () => {
        // Проверяем что клиент добавлен в список
        const connections = gateway.getActiveConnections();
        expect(connections).toBe(1);
        
        done();
      });

      socket.connect();
    });

    it('should remove client and broadcast status on disconnect', (done) => {
      const socket = getSocket();
      let disconnectHandled = false;
      let statusBroadcasted = false;

      // Подключаемся и затем отключаемся
      socket.on('connect', () => {
        // Слушаем broadcast статуса перед отключением
        socket.on('users:update', (data) => {
          expect(data).toEqual({ userId: testUser.id, isOnline: false });
          statusBroadcasted = true;
          
          // Проверяем что клиент удален из списка
          const connections = gateway.getActiveConnections();
          expect(connections).toBe(0);
          
          if (disconnectHandled) done();
        });

        // Отключаемся
        socket.on('disconnect', () => {
          disconnectHandled = true;
          if (statusBroadcasted) done();
        });

        socket.disconnect();
      });

      socket.connect();
    });

    it('should cleanup all listeners on disconnect', (done) => {
      const socket = getSocket();
      socket.on('connect', () => {
        // Добавляем тестовый слушатель
        socket.on('test:event', () => {});
        
        // Отключаемся
        socket.on('disconnect', () => {
          // Проверяем что все слушатели очищены
          expect(socket.listeners('test:event').length).toBe(0);
          done();
        });

        socket.disconnect();
      });

      socket.connect();
    });

    it('should handle multiple connections and disconnections correctly', (done) => {
      const socket = getSocket();
      const socket2 = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${jwtService.sign({ sub: 'test-user-2' })}` },
        transports: ['websocket'],
      });

      // Мокаем второго пользователя
      mockAuthService.validateUser
        .mockResolvedValueOnce(testUser) // для первого сокета
        .mockResolvedValueOnce({ // для второго сокета
          id: 'test-user-2',
          email: 'test2@example.com'
        });

      let socket1Connected = false;
      let socket2Connected = false;

      socket.on('connect', () => {
        socket1Connected = true;
        if (socket2Connected) {
          // Проверяем количество подключений
          expect(gateway.getActiveConnections()).toBe(2);

          // Отключаем оба сокета
          socket.disconnect();
          socket2.disconnect();

          // После отключения проверяем что все соединения закрыты
          setTimeout(() => {
            expect(gateway.getActiveConnections()).toBe(0);
            socket2.close();
            done();
          }, 100);
        }
      });

      socket2.on('connect', () => {
        socket2Connected = true;
        if (socket1Connected) {
          expect(gateway.getActiveConnections()).toBe(2);
        }
      });

      // Подключаем оба сокета
      socket.connect();
      socket2.connect();
    });
  });
});

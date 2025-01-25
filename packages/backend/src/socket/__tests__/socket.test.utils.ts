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

export const mockConfigService = {
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

export const mockUserService = {
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

export const mockAuthService = {
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

export const mockChatService = {
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

export const createTestingModule = async () => {
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

  const app = moduleFixture.createNestApplication();
  await app.init();

  const gateway = moduleFixture.get<SocketGateway>(SocketGateway);
  const socketAdapter = new SocketAdapter(app);
  app.useWebSocketAdapter(socketAdapter);

  await app.listen(0);

  return {
    app,
    module: moduleFixture,
    gateway,
    socketAdapter,
  };
};

export const createSocketClient = (app: INestApplication, token?: string): Socket => {
  const port = app.getHttpServer().address().port;
  return io(`http://localhost:${port}`, {
    auth: token ? { token: `Bearer ${token}` } : undefined,
    transports: ['websocket'],
    autoConnect: false,
  });
};

export const cleanupSocket = (socket: Socket | null) => {
  if (socket?.connected) {
    socket.disconnect();
  }
};

export const cleanupApp = async (app: INestApplication) => {
  if (app) {
    await app.close();
  }
};

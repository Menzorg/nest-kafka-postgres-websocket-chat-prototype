import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ChatService } from '../chat/chat.service';
import { ChatController } from '../chat/chat.controller';
import { ChatGateway } from '../chat/chat.gateway';
import { KafkaAdapter } from '../adapters/kafka/kafka.adapter';
import { UserService } from '../user/user.service';
import { WsJwtGuard } from '../auth/ws-jwt.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';

describe('ChatController (e2e)', () => {
  let app: INestApplication;
  let chatService: ChatService;

  const mockUser = { id: 'user1', username: 'testuser' };

  const mockChat: Chat = {
    id: 'chat1',
    participants: ['user1', 'user2'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMessage: ChatMessage = {
    id: 'msg1',
    chatId: 'chat1',
    senderId: 'user1',
    content: 'Test message',
    status: MessageDeliveryStatus.SENT,
    createdAt: new Date(),
  };

  const mockChatService = {
    createChat: jest.fn().mockResolvedValue(mockChat),
    getChat: jest.fn().mockResolvedValue(mockChat),
    getUserChats: jest.fn().mockResolvedValue([mockChat]),
    getChatMessages: jest.fn().mockResolvedValue([mockMessage]),
    saveMessage: jest.fn().mockResolvedValue(mockMessage),
    getUndeliveredMessages: jest.fn().mockResolvedValue([]),
  };

  const mockAuthService = {
    validateUser: jest.fn().mockResolvedValue(mockUser),
  };

  const mockKafkaAdapter = {
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
      ],
      controllers: [ChatController],
      providers: [
        ChatGateway,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: KafkaAdapter,
          useValue: mockKafkaAdapter,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock.jwt.token'),
          },
        },
        JwtStrategy,
        WsJwtGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = mockUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    chatService = moduleFixture.get<ChatService>(ChatService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/chat', () => {
    it('GET /chats should return user chats', () => {
      return request(app.getHttpServer())
        .get('/chat/chats')
        .expect(200)
        .expect([mockChat]);
    });

    it('GET /chat/:id should return chat by id', () => {
      return request(app.getHttpServer())
        .get('/chat/chat1')
        .expect(200)
        .expect(mockChat);
    });

    it('GET /chat/:id/messages should return chat messages', () => {
      return request(app.getHttpServer())
        .get('/chat/chat1/messages')
        .expect(200)
        .expect([mockMessage]);
    });

    it('POST /chat should create new chat', () => {
      return request(app.getHttpServer())
        .post('/chat')
        .send({ participantId: 'user2' })
        .expect(201)
        .expect(mockChat);
    });

    it('POST /chat/:id/message should save message', () => {
      const messageDto = {
        content: 'Test message',
      };

      return request(app.getHttpServer())
        .post('/chat/chat1/message')
        .send(messageDto)
        .expect(201)
        .expect(mockMessage);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { ChatModule } from '../chat/chat.module';
import { SocketModule } from '../socket/socket.module';
import { User } from '../user/entities/user.entity';
import { Chat } from '../chat/entities/chat.entity';
import { Message } from '../chat/entities/message.entity';
import { ChatService } from '../chat/chat.service';
import { UserService } from '../user/user.service';
import { AuthService } from '../auth/auth.service';
import { RegisterDto, AuthResponse } from '@webchat/common';
import { MessageDeliveryStatus } from '@webchat/common';

describe('ChatController (e2e)', () => {
  let app: INestApplication;
  let chatService: ChatService;
  let userService: UserService;
  let authService: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            type: 'postgres',
            host: configService.get('DB_HOST'),
            port: +configService.get('DB_PORT'),
            username: configService.get('DB_USERNAME'),
            password: configService.get('DB_PASSWORD'),
            database: configService.get('DB_DATABASE'),
            entities: [User, Chat, Message],
            synchronize: true,
            logging: true,
          }),
          inject: [ConfigService],
        }),
        AuthModule,
        UserModule,
        ChatModule,
        SocketModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    chatService = moduleFixture.get<ChatService>(ChatService);
    userService = moduleFixture.get<UserService>(UserService);
    authService = moduleFixture.get<AuthService>(AuthService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Chat endpoints', () => {
    let authToken: string;
    let testUser1: User;
    let testUser2: User;

    beforeAll(async () => {
      // Создаем тестовых пользователей
      const registerDto1: RegisterDto = {
        email: 'testuser1@example.com',
        password: 'password123',
        username: 'testuser1',
      };

      const registerDto2: RegisterDto = {
        email: 'testuser2@example.com',
        password: 'password123',
        username: 'testuser2',
      };

      testUser1 = await userService.create(registerDto1);
      testUser2 = await userService.create(registerDto2);

      // Получаем реальный JWT токен
      const loginResult = await authService.login({ 
        email: registerDto1.email, 
        password: registerDto1.password 
      });
      authToken = loginResult.accessToken;
    });

    afterAll(async () => {
      // Очищаем тестовые данные
      await userService.remove(testUser1.id);
      await userService.remove(testUser2.id);
    });

    it('/chats (POST) should create a new chat', async () => {
      const response = await request(app.getHttpServer())
        .post('/chats')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUser2.id,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.participants).toContain(testUser1.id);
      expect(response.body.participants).toContain(testUser2.id);
    });

    it('/chats (GET) should return user chats', async () => {
      const response = await request(app.getHttpServer())
        .get('/chats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('/chats/:id/messages (POST) should create a new message', async () => {
      // Создаем чат
      const chat = await chatService.createChat(testUser1.id, testUser2.id);

      const messageContent = 'Test message content';
      const response = await request(app.getHttpServer())
        .post(`/chats/${chat.id}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: messageContent,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.content).toBe(messageContent);
      expect(response.body.senderId).toBe(testUser1.id);
      expect(response.body.chatId).toBe(chat.id);
    });

    it('/chats/:id/messages (GET) should return chat messages', async () => {
      // Создаем чат и сообщение
      const chat = await chatService.createChat(testUser1.id, testUser2.id);

      await chatService.saveMessage({
        chatId: chat.id,
        senderId: testUser1.id,
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
        id: 'test-message-id',
        createdAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .get(`/chats/${chat.id}/messages`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });
});

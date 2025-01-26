import { Test, TestingModule } from '@nestjs/testing';
import { SocketGateway } from '../socket.gateway';
import { ChatService } from '../../chat/chat.service';
import { AuthService } from '../../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { MessageDeliveryStatus, Chat } from '@webchat/common';
import { v4 as uuidv4 } from 'uuid';
import { UserService } from '../../user/user.service';
import { User } from '../../user/entities/user.entity';

describe('SocketGateway', () => {
  let gateway: SocketGateway;
  let chatService: jest.Mocked<ChatService>;
  let authService: jest.Mocked<AuthService>;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    password: 'hashedpassword',
    name: 'Test User',
    get username() { return this.name; },
    isOnline: false,
    createdAt: new Date(),
    chats: [],
    sentMessages: [],
    validatePassword: jest.fn(),
    hashPassword: jest.fn(),
  } as User;

  const otherUser = {
    id: 'other-user-id',
    email: 'other@example.com',
    name: 'Other User',
  } as User;

  const mockChat: Chat = {
    id: 'test-chat-id',
    participants: [mockUser.id, otherUser.id],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  let mockSocket = {
    id: 'test-socket-id',
    data: { user: mockUser },
    rooms: new Set(),
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn().mockImplementation((room: string) => {
      mockSocket.rooms.delete(room);
    }),
    disconnect: jest.fn(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocketGateway,
        {
          provide: ChatService,
          useValue: {
            getMessage: jest.fn(),
            getChat: jest.fn(),
            updateMessageStatus: jest.fn(),
            createMessage: jest.fn(),
            findById: jest.fn(),
            getUndeliveredMessages: jest.fn(),
            saveMessage: jest.fn(),
          }
        },
        {
          provide: AuthService,
          useValue: {
            validateUser: jest.fn(),
          }
        },
        {
          provide: UserService,
          useValue: {
            updateUserStatus: jest.fn(),
          }
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn().mockReturnValue({ sub: mockUser.id }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<SocketGateway>(SocketGateway);
    chatService = module.get(ChatService);
    authService = module.get(AuthService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);

    // Мокаем Server через Reflect.set, так как @WebSocketServer() делает свойство readonly
    const server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      sockets: {
        adapter: {
          rooms: new Map()
        }
      }
    } as any;
    Reflect.set(gateway, 'io', server);
  });

  describe('handleMessage after chat leave', () => {
    it('should set message status to SENT when recipient left the chat', async () => {
      // Arrange
      const chatId = 'test-chat-id';
      const messageContent = 'Hello after leave';
      const messageId = uuidv4();
      const timestamp = new Date();
      
      // Мокаем существование чата
      chatService.getChat.mockResolvedValue({
        ...mockChat,
        id: chatId,
        participants: [mockUser.id, otherUser.id]
      });

      // Мокаем сохранение сообщения
      chatService.saveMessage.mockImplementation(async (message) => ({
        ...message,
        id: messageId,
        createdAt: timestamp
      }));

      // Добавляем чат в комнаты сокета для тестирования leave
      mockSocket.rooms.add(`chat:${chatId}`);

      // Act
      // 1. Сначала пользователь покидает чат
      await gateway.handleChatLeave(mockSocket, { chatId });

      // Проверяем что пользователь покинул комнату чата
      expect(mockSocket.leave).toHaveBeenCalledWith(`chat:${chatId}`);
      expect(mockSocket.rooms.has(`chat:${chatId}`)).toBeFalsy();

      // 2. Затем отправляем сообщение
      const message = await gateway.handleMessage(mockSocket, {
        chatId,
        content: messageContent
      });

      // Assert
      // 1. Проверяем что был запрос на получение чата
      expect(chatService.getChat).toHaveBeenCalledWith(chatId);

      // 2. Проверяем что сообщение было сохранено со статусом SENT
      expect(chatService.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId,
          content: messageContent,
          senderId: mockUser.id,
          status: MessageDeliveryStatus.SENT,
          id: expect.any(String),
          createdAt: expect.any(Date)
        })
      );

      // 3. Проверяем что сообщение было отправлено с правильным статусом
      expect(message).toEqual(
        expect.objectContaining({
          chatId,
          content: messageContent,
          senderId: mockUser.id,
          status: MessageDeliveryStatus.SENT,
          id: messageId,
          createdAt: timestamp
        })
      );

      // 4. Проверяем что сообщение было отправлено в комнату чата
      expect(gateway['io'].to).toHaveBeenCalledWith(`chat:${chatId}`);
      expect(gateway['io'].emit).toHaveBeenCalledWith('message', expect.objectContaining({
        chatId,
        content: messageContent,
        senderId: mockUser.id,
        status: MessageDeliveryStatus.SENT
      }));

      // 5. Проверяем что было отправлено подтверждение отправителю
      expect(mockSocket.emit).toHaveBeenCalledWith('message:ack', { messageId });

      // 6. Проверяем что не было отправлено уведомление о доставке
      expect(gateway['io'].to).not.toHaveBeenCalledWith(`user:${mockUser.id}`);
      expect(gateway['io'].emit).not.toHaveBeenCalledWith('message:status', expect.objectContaining({
        messageId,
        status: MessageDeliveryStatus.DELIVERED
      }));
    });
  });
});

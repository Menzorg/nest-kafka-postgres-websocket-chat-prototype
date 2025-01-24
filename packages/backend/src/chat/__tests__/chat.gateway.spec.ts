import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { ChatGateway } from '../chat.gateway';
import { ChatService } from '../chat.service';
import { KafkaAdapter } from '../../adapters/kafka/kafka.adapter';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../../user/user.service';
import { User } from '../../user/entities/user.entity';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';
import { v4 as uuidv4 } from 'uuid';
import { WsJwtGuard } from '../../auth/ws-jwt.guard';
import { NotFoundException } from '@nestjs/common';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: jest.Mocked<ChatService>;
  let kafkaAdapter: jest.Mocked<KafkaAdapter>;
  let jwtService: JwtService;
  let userService: UserService;

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

  const mockMessage: ChatMessage = {
    id: 'test-message-id',
    chatId: mockChat.id,
    senderId: otherUser.id, // Сообщение от другого пользователя
    content: 'Test message',
    status: MessageDeliveryStatus.SENT,
    createdAt: new Date()
  };

  const mockSocket = {
    id: 'test-socket-id',
    data: {
      user: mockUser,
    },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
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
          provide: KafkaAdapter,
          useValue: {
            produceMessage: jest.fn().mockResolvedValue(undefined),
            subscribe: jest.fn(),
            publish: jest.fn(),
          }
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn().mockReturnValue({ sub: mockUser.id }),
          },
        },
        {
          provide: UserService,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockUser),
          },
        },
        WsJwtGuard,
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    chatService = module.get(ChatService);
    kafkaAdapter = module.get(KafkaAdapter);
    jwtService = module.get<JwtService>(JwtService);
    userService = module.get<UserService>(UserService);

    (gateway as any).server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should handle new connection', async () => {
      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith(`user:${mockUser.id}`);
    });

    it('should disconnect if no user id', async () => {
      const invalidSocket = {
        ...mockSocket,
        data: { user: null },
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(invalidSocket);

      expect(invalidSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle disconnect', async () => {
      await gateway.handleDisconnect(mockSocket);

      expect(mockSocket.leave).toHaveBeenCalledWith(`user:${mockUser.id}`);
    });
  });

  describe('handleJoinChat', () => {
    it('should allow user to join chat', async () => {
      jest.spyOn(chatService, 'getChat').mockResolvedValue(mockChat);
      jest.spyOn(chatService, 'getUndeliveredMessages').mockResolvedValue([]);

      const result = await gateway.handleJoinChat(mockSocket, { chatId: mockChat.id });

      expect(result).toEqual({ status: 'ok' });
      expect(mockSocket.join).toHaveBeenCalledWith(`chat:${mockChat.id}`);
    });

    it('should not allow user to join non-existent chat', async () => {
      jest.spyOn(chatService, 'getChat').mockRejectedValue(new NotFoundException());

      const response = await gateway.handleJoinChat(mockSocket, { chatId: mockChat.id });

      expect(response).toEqual({
        status: 'error',
        message: 'Not Found'
      });
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('should not allow non-participant to join chat', async () => {
      const nonParticipantUser = { ...mockUser, id: 'non-participant-id' };
      const nonParticipantSocket = {
        ...mockSocket,
        data: { user: nonParticipantUser },
      } as unknown as Socket;

      jest.spyOn(chatService, 'getChat').mockResolvedValue(mockChat);

      const response = await gateway.handleJoinChat(nonParticipantSocket, { chatId: mockChat.id });

      expect(response).toEqual({
        status: 'error',
        message: 'User is not a participant of this chat'
      });
      expect(nonParticipantSocket.join).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('should handle new message', async () => {
      jest.spyOn(chatService, 'getChat').mockResolvedValue(mockChat);
      jest.spyOn(chatService, 'saveMessage').mockResolvedValue(mockMessage);
      jest.spyOn(kafkaAdapter, 'publish').mockResolvedValue();

      const messagePayload = {
        ...mockMessage,
        senderId: mockUser.id,
      };

      const result = await gateway.handleMessage(mockSocket, messagePayload);

      expect(result).toEqual({
        status: 'ok',
        data: mockMessage,
      });
      expect(chatService.saveMessage).toHaveBeenCalledWith({
        ...messagePayload,
        senderId: mockUser.id,
      });
      expect(mockSocket.emit).toHaveBeenCalledWith('message:ack', { messageId: mockMessage.id });
    });

    it('should handle message error', async () => {
      const error = new Error('Test error');
      jest.spyOn(chatService, 'saveMessage').mockRejectedValue(error);

      const messagePayload = {
        ...mockMessage,
        senderId: mockUser.id,
      };

      const response = await gateway.handleMessage(mockSocket, messagePayload);

      expect(response).toEqual({
        status: 'error',
        message: 'Test error'
      });
      expect(chatService.saveMessage).toHaveBeenCalled();
    });
  });

  describe('handleMessageRead', () => {
    it('should handle message read status', async () => {
      const messageDto = {
        messageId: mockMessage.id,
      };

      jest.spyOn(chatService, 'getMessage').mockResolvedValue(mockMessage);
      jest.spyOn(chatService, 'getChat').mockResolvedValue(mockChat);
      jest.spyOn(chatService, 'updateMessageStatus').mockResolvedValue();

      const result = await gateway.handleMessageRead(mockSocket, messageDto);

      expect(result.status).toBe('ok');
      expect(chatService.getMessage).toHaveBeenCalledWith(messageDto.messageId);
      expect(chatService.getChat).toHaveBeenCalledWith(mockMessage.chatId);
      expect(chatService.updateMessageStatus).toHaveBeenCalledWith(
        messageDto.messageId,
        MessageDeliveryStatus.READ
      );
    });

    it('should not update status if user is sender', async () => {
      const senderMessage = {
        ...mockMessage,
        senderId: mockUser.id,
      };

      jest.spyOn(chatService, 'getMessage').mockResolvedValue(senderMessage);
      jest.spyOn(chatService, 'getChat').mockResolvedValue(mockChat);
      jest.spyOn(chatService, 'updateMessageStatus').mockResolvedValue();

      const messageDto = {
        messageId: senderMessage.id,
      };

      const result = await gateway.handleMessageRead(mockSocket, messageDto);

      expect(result).toEqual({ status: 'ok' });
      expect(chatService.getMessage).toHaveBeenCalledWith(messageDto.messageId);
      expect(chatService.getChat).toHaveBeenCalledWith(senderMessage.chatId);
      expect(chatService.updateMessageStatus).not.toHaveBeenCalled();
    });

    it('should handle non-existent message', async () => {
      jest.spyOn(chatService, 'getMessage').mockResolvedValue(undefined);

      const messageDto = {
        messageId: 'non-existent-id',
      };

      const result = await gateway.handleMessageRead(mockSocket, messageDto);

      expect(result).toEqual({
        status: 'error',
        message: 'Message not found',
      });
      expect(chatService.updateMessageStatus).not.toHaveBeenCalled();
    });

    it('should handle unauthorized user', async () => {
      const unauthorizedSocket = {
        ...mockSocket,
        data: {},
      } as unknown as Socket;

      const messageDto = {
        messageId: mockMessage.id,
      };

      const result = await gateway.handleMessageRead(unauthorizedSocket, messageDto);

      expect(result).toEqual({
        status: 'error',
        message: 'Unauthorized',
      });
      expect(chatService.getMessage).not.toHaveBeenCalled();
      expect(chatService.updateMessageStatus).not.toHaveBeenCalled();
    });

    it('should handle non-participant user', async () => {
      const nonParticipantChat = {
        ...mockChat,
        participants: ['other-user-1', 'other-user-2'],
      };

      jest.spyOn(chatService, 'getMessage').mockResolvedValue(mockMessage);
      jest.spyOn(chatService, 'getChat').mockResolvedValue(nonParticipantChat);

      const messageDto = {
        messageId: mockMessage.id,
      };

      const result = await gateway.handleMessageRead(mockSocket, messageDto);

      expect(result).toEqual({
        status: 'error',
        message: 'User is not a participant of this chat',
      });
      expect(chatService.updateMessageStatus).not.toHaveBeenCalled();
    });
  });
});

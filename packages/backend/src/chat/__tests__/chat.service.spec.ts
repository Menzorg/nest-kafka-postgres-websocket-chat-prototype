import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Chat } from '../entities/chat.entity';
import { Message } from '../entities/message.entity';
import { User } from '../../user/entities/user.entity';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MessageDeliveryStatus } from '@webchat/common';
import { Repository } from 'typeorm';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepository: jest.Mocked<Repository<Chat>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let messageRepository: jest.Mocked<Repository<Message>>;

  const mockUser1 = {
    id: 'user1',
    email: 'user1@example.com',
    password: 'hashedpassword',
    name: 'User 1',
    get username() { return this.name; },
    isOnline: false,
    createdAt: new Date(),
    chats: [],
    sentMessages: [],
    validatePassword: jest.fn(),
    hashPassword: jest.fn(),
  } as Partial<User> as User;

  const mockUser2 = {
    id: 'user2',
    email: 'user2@example.com',
    password: 'hashedpassword',
    name: 'User 2',
    get username() { return this.name; },
    isOnline: false,
    createdAt: new Date(),
    chats: [],
    sentMessages: [],
    validatePassword: jest.fn(),
    hashPassword: jest.fn(),
  } as Partial<User> as User;

  const mockChat: Chat = {
    id: 'test-chat-id',
    participants: [mockUser1, mockUser2],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockMessage = {
    id: 'message1',
    chatId: 'test-chat-id',
    senderId: 'user1',
    content: 'Test message',
    status: MessageDeliveryStatus.SENT,
    createdAt: new Date()
  } as Message;

  beforeEach(async () => {
    const queryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(Chat),
          useValue: {
            findOneBy: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockReturnValue(null),
            save: jest.fn().mockResolvedValue(null),
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
          }
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOneBy: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([])
          }
        },
        {
          provide: getRepositoryToken(Message),
          useValue: {
            findOneBy: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockReturnValue(null),
            save: jest.fn().mockResolvedValue(null)
          }
        }
      ]
    }).compile();

    service = module.get<ChatService>(ChatService);
    chatRepository = module.get(getRepositoryToken(Chat));
    userRepository = module.get(getRepositoryToken(User));
    messageRepository = module.get(getRepositoryToken(Message));
  });

  describe('createChat', () => {
    it('should create a new chat between two users', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(mockUser2);

      (chatRepository.createQueryBuilder as jest.Mock)().getOne.mockResolvedValueOnce(null);
      chatRepository.create.mockReturnValue(mockChat);
      chatRepository.save.mockResolvedValue(mockChat);

      const result = await service.createChat(mockUser1.id, mockUser2.id);

      expect(userRepository.findOneBy).toHaveBeenNthCalledWith(1, { id: mockUser1.id });
      expect(userRepository.findOneBy).toHaveBeenNthCalledWith(2, { id: mockUser2.id });
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');
      expect(chatRepository.create).toHaveBeenCalledWith({
        participants: [mockUser1, mockUser2]
      });
      expect(chatRepository.save).toHaveBeenCalledWith(mockChat);

      expect(result).toEqual({
        id: mockChat.id,
        participants: [mockUser1.id, mockUser2.id],
        messages: [],
        createdAt: mockChat.createdAt,
        updatedAt: mockChat.updatedAt
      });
    });

    it('should throw ConflictException if chat already exists', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(mockUser2);

      (chatRepository.createQueryBuilder as jest.Mock)().getOne.mockResolvedValueOnce(mockChat);

      await expect(service.createChat(mockUser1.id, mockUser2.id))
        .rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if user1 does not exist', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(service.createChat('nonexistent', mockUser2.id))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if user2 does not exist', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(null);

      await expect(service.createChat(mockUser1.id, 'nonexistent'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserChats', () => {
    it('should return all chats for user', async () => {
      const mockChats = [
        {
          id: mockChat.id,
          participants: [mockUser1.id, mockUser2.id],
          messages: [],
          createdAt: mockChat.createdAt,
          updatedAt: mockChat.updatedAt,
        },
      ];

      jest.spyOn(userRepository, 'findOneBy')
        .mockResolvedValue(mockUser1);

      jest.spyOn(chatRepository, 'find')
        .mockResolvedValue([{
          ...mockChat,
          participants: [mockUser1, mockUser2],
        }]);

      const result = await service.getUserChats(mockUser1.id);

      expect(result).toEqual(mockChats);
    });
  });

  describe('saveMessage', () => {
    it('should save message to existing chat', async () => {
      chatRepository.findOneBy.mockResolvedValue(mockChat);
      userRepository.findOneBy.mockResolvedValue(mockUser1);
      messageRepository.create.mockReturnValue(mockMessage);
      messageRepository.save.mockResolvedValue(mockMessage);

      const messageDto = {
        id: 'message1',
        chatId: 'test-chat-id',
        senderId: 'user1',
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };

      const result = await service.saveMessage(messageDto);

      expect(chatRepository.findOneBy).toHaveBeenCalledWith({ id: 'test-chat-id' });
      expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: 'user1' });
      expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        chatId: 'test-chat-id',
        senderId: 'user1',
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
      }));
      expect(messageRepository.save).toHaveBeenCalledWith(mockMessage);

      expect(result).toEqual({
        id: mockMessage.id,
        chatId: mockMessage.chatId,
        senderId: mockMessage.senderId,
        content: mockMessage.content,
        status: mockMessage.status,
        createdAt: mockMessage.createdAt,
      });
    });

    it('should throw NotFoundException if chat does not exist', async () => {
      chatRepository.findOneBy.mockResolvedValue(null);

      const messageDto = {
        id: 'message1',
        chatId: 'nonexistent',
        senderId: 'user1',
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };

      await expect(service.saveMessage(messageDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if sender does not exist', async () => {
      chatRepository.findOneBy.mockResolvedValue(mockChat);
      userRepository.findOneBy.mockResolvedValue(null);

      const messageDto = {
        id: 'message1',
        chatId: 'test-chat-id',
        senderId: 'nonexistent',
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };

      await expect(service.saveMessage(messageDto)).rejects.toThrow(NotFoundException);
    });
  });
});

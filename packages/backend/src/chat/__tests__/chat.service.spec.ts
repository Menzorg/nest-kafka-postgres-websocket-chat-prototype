import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Chat } from '../entities/chat.entity';
import { Message } from '../entities/message.entity';
import { User } from '../../user/entities/user.entity';
import { MessageDeliveryStatus } from '@webchat/common';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('ChatService - Message Pinning and Forwarding', () => {
  let service: ChatService;
  let messageRepository: Repository<Message>;
  let chatRepository: Repository<Chat>;

  const mockMessage = {
    id: 'message-1',
    chatId: 'chat-1',
    senderId: 'user-1',
    content: 'Test message',
    status: MessageDeliveryStatus.SENT,
    isPinned: false,
    pinnedAt: null,
    pinnedBy: null,
    isForwarded: false,
    forwardedFromId: null,
    originalSenderId: null,
    createdAt: new Date()
  };

  const mockChat = {
    id: 'chat-1',
    participants: [
      { id: 'user-1' },
      { id: 'user-2' }
    ]
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(Chat),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            findOneBy: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockReturnValue(null),
            save: jest.fn().mockResolvedValue(null),
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Message),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    messageRepository = module.get<Repository<Message>>(getRepositoryToken(Message));
    chatRepository = module.get<Repository<Chat>>(getRepositoryToken(Chat));
  });

  describe('Message Pinning', () => {
    it('should pin a message successfully', async () => {
      const pinnedMessage = { ...mockMessage, isPinned: true, pinnedAt: new Date(), pinnedBy: 'user-1' };
      
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(pinnedMessage as Message);

  describe('createChat', () => {
    it('should create a new chat between two users', async () => {
      userRepository.findOneBy
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(mockUser2);

      const mockQueryBuilder = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        having: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        rightJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        rightJoin: jest.fn().mockReturnThis(),
        whereInIds: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getCount: jest.fn().mockResolvedValue(0),
        execute: jest.fn().mockResolvedValue([]),
        getExists: jest.fn().mockResolvedValue(false)
      } as any;

      chatRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      chatRepository.create.mockReturnValue(mockChat);
      chatRepository.save.mockResolvedValue(mockChat);
      chatRepository.findOne.mockResolvedValue(mockChat);

      const result = await service.createChat(mockUser1.id, mockUser2.id);

      expect(userRepository.findOneBy).toHaveBeenNthCalledWith(1, { id: mockUser1.id });
      expect(userRepository.findOneBy).toHaveBeenNthCalledWith(2, { id: mockUser2.id });
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');
      expect(chatRepository.create).toHaveBeenCalledWith({
        id: expect.any(String),
        participants: [mockUser1, mockUser2]
      });
      expect(chatRepository.save).toHaveBeenCalledWith(mockChat);


      const result = await service.pinMessage('message-1', 'user-1');

      expect(result.isPinned).toBe(true);
      expect(result.pinnedBy).toBe('user-1');
    });
  });

  describe('Message Forwarding', () => {
    it('should forward a message successfully', async () => {
      const forwardedMessage = {
        ...mockMessage,
        id: 'message-2',
        chatId: 'chat-2',
        isForwarded: true,
        forwardedFromId: 'message-1',
        originalSenderId: 'user-1'
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'create').mockReturnValue(forwardedMessage as Message);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(forwardedMessage as Message);

      const result = await service.forwardMessage('message-1', 'chat-2', 'user-1');

      expect(result.isForwarded).toBe(true);
      expect(result.forwardedFromId).toBe('message-1');
    });
  });
});

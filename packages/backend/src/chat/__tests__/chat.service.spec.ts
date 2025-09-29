import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Chat } from '../entities/chat.entity';
import { Message } from '../entities/message.entity';
import { User } from '../../user/entities/user.entity';
import { Reaction } from '../entities/reaction.entity';
import { MessageDeliveryStatus } from '@webchat/common';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

describe('ChatService', () => {
  let service: ChatService;
  let messageRepository: Repository<Message>;
  let chatRepository: Repository<Chat>;
  let userRepository: Repository<User>;
  let reactionRepository: Repository<Reaction>;

  const mockUser1 = {
    id: 'user-1',
    username: 'user1',
    email: 'user1@test.com'
  };

  const mockUser2 = {
    id: 'user-2',
    username: 'user2',
    email: 'user2@test.com'
  };

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
    isEdited: false,
    editedAt: null,
    editHistory: [],
    isDeleted: false,
    deletedAt: null,
    deletedFor: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockChat = {
    id: 'chat-1',
    participants: [mockUser1, mockUser2],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
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
            createQueryBuilder: jest.fn(),
            count: jest.fn()
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOneBy: jest.fn(),
            find: jest.fn()
          },
        },
        {
          provide: getRepositoryToken(Reaction),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn()
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'MESSAGE_MAX_PINS') return '5';
              if (key === 'MESSAGE_EDIT_TIME_LIMIT') return '300';
              if (key === 'MESSAGE_DELETE_TIME_LIMIT') return '600';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    messageRepository = module.get<Repository<Message>>(getRepositoryToken(Message));
    chatRepository = module.get<Repository<Chat>>(getRepositoryToken(Chat));
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    reactionRepository = module.get<Repository<Reaction>>(getRepositoryToken(Reaction));
  });

  describe('Chat Management', () => {
    describe('createChat', () => {
      it('should create a new chat between two users', async () => {
        (userRepository.findOneBy as jest.Mock)
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

        (chatRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);
        (chatRepository.create as jest.Mock).mockReturnValue(mockChat);
        (chatRepository.save as jest.Mock).mockResolvedValue(mockChat);

        // Service returns participants as IDs
        const mockChatWithIds = {
          id: 'chat-1',
          participants: ['user-1', 'user-2'],
          messages: [],
          createdAt: mockChat.createdAt,
          updatedAt: mockChat.updatedAt
        };
        (chatRepository.findOne as jest.Mock).mockResolvedValue(mockChat);

        const result = await service.createChat(mockUser1.id, mockUser2.id);

        expect(userRepository.findOneBy).toHaveBeenNthCalledWith(1, { id: mockUser1.id });
        expect(userRepository.findOneBy).toHaveBeenNthCalledWith(2, { id: mockUser2.id });
        expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');
        expect(chatRepository.create).toHaveBeenCalledWith({
          id: expect.any(String),
          participants: [mockUser1, mockUser2]
        });
        expect(chatRepository.save).toHaveBeenCalledWith(mockChat);
        expect(result).toEqual(mockChatWithIds);
      });
    });
  });

  describe('Message Pinning', () => {
    it('should pin a message successfully', async () => {
      const pinnedMessage = {
        ...mockMessage,
        isPinned: true,
        pinnedAt: new Date(),
        pinnedBy: 'user-1'
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as any);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(pinnedMessage as any);
      (messageRepository.count as jest.Mock).mockResolvedValue(0);

      const result = await service.pinMessage('message-1', 'user-1');

      expect(result.isPinned).toBe(true);
      expect(result.pinnedBy).toBe('user-1');
    });

    it('should throw NotFoundException when message does not exist', async () => {
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(null);

      await expect(service.pinMessage('non-existent', 'user-1')).rejects.toThrow(NotFoundException);
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

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as any);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'create').mockReturnValue(forwardedMessage as any);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(forwardedMessage as any);

      const result = await service.forwardMessage('message-1', 'chat-2', 'user-1');

      expect(result.isForwarded).toBe(true);
      expect(result.forwardedFromId).toBe('message-1');
      expect(result.originalSenderId).toBe('user-1');
    });
  });

  describe('Message Editing', () => {
    it('should edit a message successfully', async () => {
      const editedMessage = {
        ...mockMessage,
        content: 'Edited content',
        isEdited: true,
        editedAt: new Date(),
        editHistory: [{ content: 'Test message', editedAt: new Date() }]
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as any);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(editedMessage as any);

      const result = await service.editMessage('message-1', 'user-1', 'Edited content');

      expect(result.isEdited).toBe(true);
      expect(result.content).toBe('Edited content');
      expect(result.editHistory).toHaveLength(1);
    });
  });

  describe('Message Deletion', () => {
    it('should delete a message for self successfully', async () => {
      const deletedMessage = {
        ...mockMessage,
        deletedFor: ['user-1']
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as any);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(deletedMessage as any);

      await service.deleteMessageForSelf('message-1', 'user-1');

      expect(messageRepository.save).toHaveBeenCalled();
    });

    it('should delete a message for everyone successfully', async () => {
      const deletedMessage = {
        ...mockMessage,
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: 'user-1'
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as any);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(deletedMessage as any);

      const result = await service.deleteMessageForEveryone('message-1', 'user-1');

      expect(result.isDeleted).toBe(true);
      expect(result.deletedAt).toBeDefined();
      expect(result.deletedBy).toBe('user-1');
    });
  });

  describe('Message Search', () => {
    it('should search messages by query', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockMessage]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis()
      };

      (messageRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.searchMessages('chat-1', { query: 'test' });

      expect(result.messages).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(messageRepository.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('Message Reactions', () => {
    it('should add a reaction to a message', async () => {
      const mockReaction = {
        id: 'reaction-1',
        messageId: 'message-1',
        userId: 'user-1',
        emoji: '👍',
        createdAt: new Date()
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue({
        ...mockMessage,
        chat: mockChat
      } as any);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(reactionRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(reactionRepository, 'create').mockReturnValue(mockReaction as any);
      jest.spyOn(reactionRepository, 'save').mockResolvedValue(mockReaction as any);

      const result = await service.addReaction('message-1', 'user-1', '👍');

      expect(result.emoji).toBe('👍');
      expect(result.userId).toBe('user-1');
    });

    it('should get user reaction statistics', async () => {
      const mockReactions = [
        { emoji: '👍', messageId: 'msg1', createdAt: new Date() },
        { emoji: '👍', messageId: 'msg2', createdAt: new Date() },
        { emoji: '❤️', messageId: 'msg3', createdAt: new Date() }
      ];

      jest.spyOn(reactionRepository, 'find').mockResolvedValue(mockReactions as any);

      const result = await service.getUserReactionStats('user-1');

      expect(result).toEqual({
        mostUsedEmojis: [
          { emoji: '👍', count: 2 },
          { emoji: '❤️', count: 1 }
        ],
        totalReactions: 3,
        recentReactions: mockReactions
      });
    });
  });
});
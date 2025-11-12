import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Chat } from '../entities/chat.entity';
import { Message } from '../entities/message.entity';
import { User } from '../../user/entities/user.entity';
import { MessageDeliveryStatus } from '@webchat/common';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('ChatService - High Priority Features', () => {
  let service: ChatService;
  let messageRepository: Repository<Message>;
  let chatRepository: Repository<Chat>;
  let userRepository: Repository<User>;

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
    originalContent: null,
    isDeleted: false,
    isDeletedForEveryone: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date()
  };

  const mockChat = {
    id: 'chat-1',
    participants: [
      { id: 'user-1' },
      { id: 'user-2' }
    ],
    maxPinnedMessages: 10
  };

  const mockUser1 = { id: 'user-1', email: 'user1@test.com', name: 'User 1' };
  const mockUser2 = { id: 'user-2', email: 'user2@test.com', name: 'User 2' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(Chat),
          useValue: {
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn()
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOneBy: jest.fn()
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    messageRepository = module.get<Repository<Message>>(getRepositoryToken(Message));
    chatRepository = module.get<Repository<Chat>>(getRepositoryToken(Chat));
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  describe('Message Pinning with Limit', () => {
    it('should pin a message successfully when under limit', async () => {
      const pinnedMessage = { ...mockMessage, isPinned: true, pinnedAt: new Date(), pinnedBy: 'user-1' };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'count').mockResolvedValue(5);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(pinnedMessage as Message);

      const result = await service.pinMessage('message-1', 'user-1');

      expect(result.isPinned).toBe(true);
      expect(result.pinnedBy).toBe('user-1');
      expect(messageRepository.count).toHaveBeenCalledWith({
        where: { chatId: 'chat-1', isPinned: true }
      });
    });

    it('should throw error when pinned messages limit is reached', async () => {
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'count').mockResolvedValue(10);

      await expect(service.pinMessage('message-1', 'user-1'))
        .rejects.toThrow(ConflictException);
    });

    it('should throw error when message is already pinned', async () => {
      const pinnedMessage = { ...mockMessage, isPinned: true };
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(pinnedMessage as Message);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);

      await expect(service.pinMessage('message-1', 'user-1'))
        .rejects.toThrow('Message is already pinned');
    });
  });

  describe('Message Editing', () => {
    it('should edit a message successfully within time limit', async () => {
      const recentMessage = { ...mockMessage, createdAt: new Date() };
      const editedMessage = { ...recentMessage, isEdited: true, editedAt: new Date(), content: 'Edited content' };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(recentMessage as Message);
      jest.spyOn(messageRepository, 'save').mockResolvedValue(editedMessage as Message);

      const result = await service.editMessage('message-1', 'user-1', 'Edited content');

      expect(result.isEdited).toBe(true);
      expect(result.content).toBe('Edited content');
    });

    it('should throw error when edit time limit exceeded', async () => {
      const oldDate = new Date();
      oldDate.setMinutes(oldDate.getMinutes() - 20);
      const oldMessage = { ...mockMessage, createdAt: oldDate };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(oldMessage as Message);

      await expect(service.editMessage('message-1', 'user-1', 'Edited content'))
        .rejects.toThrow('Edit time limit exceeded');
    });

    it('should throw error when user is not the sender', async () => {
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);

      await expect(service.editMessage('message-1', 'user-2', 'Edited content'))
        .rejects.toThrow('Only the sender can edit the message');
    });

    it('should preserve original content on first edit', async () => {
      const recentMessage = { ...mockMessage, createdAt: new Date() };
      const editedMessage = { ...recentMessage, isEdited: true, editedAt: new Date(), content: 'Edited content', originalContent: 'Test message' };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(recentMessage as Message);
      const saveSpy = jest.spyOn(messageRepository, 'save').mockResolvedValue(editedMessage as Message);

      await service.editMessage('message-1', 'user-1', 'Edited content');

      const savedMessage = saveSpy.mock.calls[0][0];
      expect(savedMessage.originalContent).toBe('Test message');
    });
  });

  describe('Message Deletion', () => {
    it('should delete message for self', async () => {
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);
      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      const saveSpy = jest.spyOn(messageRepository, 'save');

      await service.deleteMessageForSelf('message-1', 'user-1');

      const savedMessage = saveSpy.mock.calls[0][0];
      expect(savedMessage.isDeleted).toBe(true);
      expect(savedMessage.deletedBy).toBe('user-1');
    });

    it('should delete message for everyone within time limit', async () => {
      const recentMessage = { ...mockMessage, createdAt: new Date() };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(recentMessage as Message);
      const saveSpy = jest.spyOn(messageRepository, 'save');

      await service.deleteMessageForEveryone('message-1', 'user-1');

      const savedMessage = saveSpy.mock.calls[0][0];
      expect(savedMessage.isDeletedForEveryone).toBe(true);
      expect(savedMessage.deletedBy).toBe('user-1');
    });

    it('should throw error when delete time limit exceeded', async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 2);
      const oldMessage = { ...mockMessage, createdAt: oldDate };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(oldMessage as Message);

      await expect(service.deleteMessageForEveryone('message-1', 'user-1'))
        .rejects.toThrow('Delete time limit exceeded');
    });

    it('should throw error when user is not the sender for delete everyone', async () => {
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);

      await expect(service.deleteMessageForEveryone('message-1', 'user-2'))
        .rejects.toThrow('Only the sender can delete the message for everyone');
    });
  });

  describe('Message Edit History', () => {
    it('should return edit history for edited message', async () => {
      const editedMessage = {
        ...mockMessage,
        isEdited: true,
        editedAt: new Date(),
        originalContent: 'Original content',
        content: 'Edited content'
      };

      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(editedMessage as Message);

      const history = await service.getMessageEditHistory('message-1');

      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('Original content');
      expect(history[1].content).toBe('Edited content');
    });

    it('should return empty history for non-edited message', async () => {
      jest.spyOn(messageRepository, 'findOne').mockResolvedValue(mockMessage as Message);

      const history = await service.getMessageEditHistory('message-1');

      expect(history).toHaveLength(0);
    });
  });

  describe('Message Search', () => {
    it('should search messages by content', async () => {
      const mockChats = [{ id: 'chat-1' }, { id: 'chat-2' }];
      const mockMessages = [
        { ...mockMessage, content: 'Hello world' },
        { ...mockMessage, id: 'message-2', content: 'Hello there' }
      ];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockChats),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        createQueryBuilder: jest.fn().mockReturnThis(),
      };

      jest.spyOn(chatRepository, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const messageQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockMessages)
      };

      jest.spyOn(messageRepository, 'createQueryBuilder').mockReturnValue(messageQueryBuilder as any);

      const result = await service.searchMessages('user-1', 'hello');

      expect(result).toHaveLength(2);
      expect(messageQueryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(message.content) LIKE LOWER(:query)',
        { query: '%hello%' }
      );
    });

    it('should search messages with filters', async () => {
      const mockChats = [{ id: 'chat-1' }];
      const mockMessages = [mockMessage];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockChats),
      };

      jest.spyOn(chatRepository, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const messageQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockMessages)
      };

      jest.spyOn(messageRepository, 'createQueryBuilder').mockReturnValue(messageQueryBuilder as any);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      await service.searchMessages('user-1', 'test', {
        chatId: 'chat-1',
        senderId: 'user-1',
        startDate,
        endDate,
        limit: 50
      });

      expect(messageQueryBuilder.andWhere).toHaveBeenCalledWith('message.chatId = :chatId', { chatId: 'chat-1' });
      expect(messageQueryBuilder.andWhere).toHaveBeenCalledWith('message.senderId = :senderId', { senderId: 'user-1' });
      expect(messageQueryBuilder.andWhere).toHaveBeenCalledWith('message.createdAt >= :startDate', { startDate });
      expect(messageQueryBuilder.andWhere).toHaveBeenCalledWith('message.createdAt <= :endDate', { endDate });
      expect(messageQueryBuilder.limit).toHaveBeenCalledWith(50);
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

    it('should forward multiple messages', async () => {
      const messages = [
        mockMessage,
        { ...mockMessage, id: 'message-2' },
        { ...mockMessage, id: 'message-3' }
      ];

      messages.forEach(msg => {
        jest.spyOn(messageRepository, 'findOne').mockResolvedValueOnce(msg as Message);
      });

      jest.spyOn(chatRepository, 'findOne').mockResolvedValue(mockChat as any);
      jest.spyOn(messageRepository, 'create').mockImplementation(() => ({} as Message));
      jest.spyOn(messageRepository, 'save').mockImplementation((msg) => Promise.resolve(msg as Message));

      const result = await service.forwardMultipleMessages(
        ['message-1', 'message-2', 'message-3'],
        'chat-2',
        'user-1'
      );

      expect(result).toHaveLength(3);
    });
  });
});
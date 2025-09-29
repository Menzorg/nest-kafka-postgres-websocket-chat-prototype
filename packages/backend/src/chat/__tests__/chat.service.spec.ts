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
            findOne: jest.fn(),
          },
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

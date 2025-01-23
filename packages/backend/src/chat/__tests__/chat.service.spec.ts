import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatService],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('createChat', () => {
    it('should create a new chat between two users', async () => {
      const result = await service.createChat('user1', 'user2');

      expect(result).toBeDefined();
      expect(result.participants).toContain('user1');
      expect(result.participants).toContain('user2');
    });

    it('should throw ConflictException if chat already exists', async () => {
      await service.createChat('user1', 'user2');

      await expect(service.createChat('user1', 'user2')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getChat', () => {
    it('should return chat by id', async () => {
      const chat = await service.createChat('user1', 'user2');
      const result = await service.getChat(chat.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(chat.id);
    });

    it('should throw NotFoundException if chat not found', async () => {
      await expect(service.getChat('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserChats', () => {
    it('should return all chats for user', async () => {
      const chat1 = await service.createChat('user1', 'user2');
      const chat2 = await service.createChat('user1', 'user3');
      await service.createChat('user2', 'user3'); // chat without user1

      const result = await service.getUserChats('user1');

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(expect.objectContaining({ id: chat1.id }));
      expect(result).toContainEqual(expect.objectContaining({ id: chat2.id }));
    });
  });

  describe('saveMessage', () => {
    it('should save message to existing chat', async () => {
      const chat = await service.createChat('user1', 'user2');
      const message: ChatMessage = {
        id: '1',
        chatId: chat.id,
        senderId: 'user1',
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };

      const result = await service.saveMessage(message);

      expect(result).toBeDefined();
      expect(result.id).toBe(message.id);
      expect(result.content).toBe(message.content);
    });

    it('should throw NotFoundException if chat does not exist', async () => {
      const message: ChatMessage = {
        id: '1',
        chatId: 'nonexistent',
        senderId: 'user1',
        content: 'Test message',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };

      await expect(service.saveMessage(message)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getChatMessages', () => {
    it('should return all messages for chat', async () => {
      const chat = await service.createChat('user1', 'user2');
      const message1: ChatMessage = {
        id: '1',
        chatId: chat.id,
        senderId: 'user1',
        content: 'Test message 1',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };
      const message2: ChatMessage = {
        id: '2',
        chatId: chat.id,
        senderId: 'user2',
        content: 'Test message 2',
        status: MessageDeliveryStatus.SENT,
        createdAt: new Date(),
      };

      await service.saveMessage(message1);
      await service.saveMessage(message2);

      const result = await service.getChatMessages(chat.id);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(expect.objectContaining({ id: message1.id }));
      expect(result).toContainEqual(expect.objectContaining({ id: message2.id }));
    });
  });
});

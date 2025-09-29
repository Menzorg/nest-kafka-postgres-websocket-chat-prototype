import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat as ChatEntity } from './entities/chat.entity';
import { Message as MessageEntity } from './entities/message.entity';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';
import { User } from '../user/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';
import { In } from 'typeorm';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatEntity)
    private readonly chatRepository: Repository<ChatEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createChat(userId1: string, userId2: string): Promise<Chat> {
    // Проверяем существование пользователей
    const user1 = await this.userRepository.findOneBy({ id: userId1 });
    if (!user1) {
      throw new NotFoundException(`User with ID ${userId1} not found`);
    }

    const user2 = await this.userRepository.findOneBy({ id: userId2 });
    if (!user2) {
      throw new NotFoundException(`User with ID ${userId2} not found`);
    }

    // Проверяем существование чата
    const existingChat = await this.chatRepository
      .createQueryBuilder('chat')
      .select('chat.id')
      .innerJoin('chat.participants', 'participant')
      .where('participant.id IN (:...userIds)', { userIds: [userId1, userId2] })
      .groupBy('chat.id')
      .having('COUNT(DISTINCT participant.id) = 2')
      .getOne();

    if (existingChat) {
      throw new ConflictException('Chat between these users already exists');
    }

    // Создаем новый чат
    const chat = this.chatRepository.create({
      id: uuidv4(), // Генерируем UUID для чата
      participants: [user1, user2]
    });

    const savedChat = await this.chatRepository.save(chat);

    // Загружаем чат со всеми связями
    const fullChat = await this.chatRepository.findOne({
      where: { id: savedChat.id },
      relations: ['participants']
    });

    if (!fullChat) {
      throw new Error('Failed to load created chat');
    }

    return {
      id: fullChat.id,
      participants: fullChat.participants.map(p => p.id),
      messages: [],
      createdAt: fullChat.createdAt,
      updatedAt: fullChat.updatedAt
    };
  }

  async getChat(chatId: string): Promise<Chat> {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId },
      relations: ['participants', 'messages'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return {
      id: chat.id,
      participants: chat.participants.map(p => p.id),
      messages: chat.messages.map(m => ({
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt,
      })),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }

  async getUserChats(userId: string): Promise<Chat[]> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const chats = await this.chatRepository.find({
      where: { participants: { id: userId } },
      relations: ['participants', 'messages'],
    });

    return chats.map(chat => ({
      id: chat.id,
      participants: chat.participants.map(p => p.id),
      messages: chat.messages.map(m => ({
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt,
      })),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }));
  }

  async findChatByParticipants(userId1: string, userId2: string): Promise<Chat | undefined> {
    // Сначала находим ID чата
    const chatId = await this.chatRepository
      .createQueryBuilder('chat')
      .select('chat.id')
      .innerJoin('chat.participants', 'participant')
      .where('participant.id IN (:...userIds)', { userIds: [userId1, userId2] })
      .groupBy('chat.id')
      .having('COUNT(DISTINCT participant.id) = 2')
      .getOne();

    if (!chatId) {
      return undefined;
    }

    // Затем загружаем полные данные чата с правильной группировкой
    const chat = await this.chatRepository
      .createQueryBuilder('chat')
      .select([
        'chat.id',
        'chat.createdAt',
        'chat.updatedAt',
        'participant.id',
        'participant.email',
        'participant.name',
        'participant.isOnline',
        'participant.createdAt',
        'message.id',
        'message.chatId',
        'message.senderId',
        'message.content',
        'message.status',
        'message.createdAt'
      ])
      .innerJoin('chat.participants', 'participant')
      .leftJoin('chat.messages', 'message')
      .where('chat.id = :chatId', { chatId: chatId.id })
      .groupBy('chat.id, chat.createdAt, chat.updatedAt, participant.id, participant.email, participant.name, participant.isOnline, participant.createdAt, message.id, message.chatId, message.senderId, message.content, message.status, message.createdAt')
      .getOne();

    if (!chat) {
      return undefined;
    }

    return {
      id: chat.id,
      participants: chat.participants.map(p => p.id),
      messages: chat.messages?.map(m => ({
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt,
      })) || [],
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }

  async saveMessage(messageDto: ChatMessage): Promise<ChatMessage> {
    console.log('=== Saving Message ===', {
      id: messageDto.id,
      chatId: messageDto.chatId,
      senderId: messageDto.senderId,
      status: messageDto.status
    });

    const chat = await this.chatRepository.findOneBy({ id: messageDto.chatId });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const sender = await this.userRepository.findOneBy({ id: messageDto.senderId });
    if (!sender) {
      throw new NotFoundException('Sender not found');
    }

    // Используем переданный ID и статус сообщения
    const message = this.messageRepository.create({
      id: messageDto.id,
      chatId: messageDto.chatId,
      senderId: messageDto.senderId,
      content: messageDto.content,
      status: messageDto.status,
      createdAt: messageDto.createdAt || new Date(),
    });

    const savedMessage = await this.messageRepository.save(message);
    console.log('=== Message Saved ===', {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      status: savedMessage.status
    });

    return {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      content: savedMessage.content,
      status: savedMessage.status,
      createdAt: savedMessage.createdAt,
    };
  }

  async getMessage(messageId: string): Promise<ChatMessage | undefined> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      return undefined;
    }

    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
    };
  }

  async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    const messages = await this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });

    return messages.map(message => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
    }));
  }

  async updateMessageStatus(messageId: string, status: MessageDeliveryStatus): Promise<void> {
    console.log('=== Updating Message Status in DB ===', { messageId, status });
    
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    
    console.log('=== Message Status Updating in DB ===', {
      messageId,
      oldStatus: message.status,
      newStatus: status
    });

    message.status = status;
    await this.messageRepository.save(message);

    console.log('=== Message Status Updated in DB ===', {
      messageId,
    });

  }

  async getUndeliveredMessages(userId: string, chatId?: string): Promise<ChatMessage[]> {
    console.log('=== Getting Undelivered Messages ===', { userId, chatId });

    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.chat', 'chat')
      .leftJoinAndSelect('chat.participants', 'participant')
      .where('participant.id = :userId', { userId })
      .andWhere('message.status = :status', { status: MessageDeliveryStatus.SENT })
      .andWhere('message.senderId != :userId', { userId });

    if (chatId) {
      queryBuilder.andWhere('message.chatId = :chatId', { chatId });
    }

    const messages = await queryBuilder.getMany();

    console.log('=== Found Undelivered Messages ===', messages.map(m => ({
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      status: m.status
    })));

    return messages.map(message => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
    }));
  }

  async pinMessage(messageId: string, userId: string): Promise<ChatMessage> {
    console.log('=== Pinning Message ===', { messageId, userId });

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Verify user is participant
    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    // Check if already pinned
    if (message.isPinned) {
      throw new ConflictException('Message is already pinned');
    }

    // Update message
    message.isPinned = true;
    message.pinnedAt = new Date();
    message.pinnedBy = userId;

    const savedMessage = await this.messageRepository.save(message);

    console.log('=== Message Pinned ===', {
      messageId: savedMessage.id,
      pinnedBy: savedMessage.pinnedBy,
      pinnedAt: savedMessage.pinnedAt,
    });

    return {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      content: savedMessage.content,
      status: savedMessage.status,
      createdAt: savedMessage.createdAt,
      isPinned: savedMessage.isPinned,
      pinnedAt: savedMessage.pinnedAt,
      pinnedBy: savedMessage.pinnedBy,
    };
  }

  async unpinMessage(messageId: string, userId: string): Promise<ChatMessage> {
    console.log('=== Unpinning Message ===', { messageId, userId });

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Verify user is participant
    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    // Check if not pinned
    if (!message.isPinned) {
      throw new ConflictException('Message is not pinned');
    }

    // Update message
    message.isPinned = false;
    message.pinnedAt = null;
    message.pinnedBy = null;

    const savedMessage = await this.messageRepository.save(message);

    console.log('=== Message Unpinned ===', {
      messageId: savedMessage.id,
    });

    return {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      content: savedMessage.content,
      status: savedMessage.status,
      createdAt: savedMessage.createdAt,
      isPinned: savedMessage.isPinned,
      pinnedAt: savedMessage.pinnedAt,
      pinnedBy: savedMessage.pinnedBy,
    };
  }

  async getPinnedMessages(chatId: string): Promise<ChatMessage[]> {
    const messages = await this.messageRepository.find({
      where: {
        chatId,
        isPinned: true
      },
      order: {
        pinnedAt: 'DESC'
      },
    });

    return messages.map(message => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      isPinned: message.isPinned,
      pinnedAt: message.pinnedAt,
      pinnedBy: message.pinnedBy,
    }));
  }

  async forwardMessage(
    messageId: string,
    toChatId: string,
    userId: string,
    additionalContent?: string
  ): Promise<ChatMessage> {
    console.log('=== Forwarding Message ===', {
      messageId,
      toChatId,
      userId,
      hasAdditionalContent: !!additionalContent,
    });

    // Get original message
    const originalMessage = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!originalMessage) {
      throw new NotFoundException('Original message not found');
    }

    // Verify user has access to original message
    const originalChat = await this.chatRepository.findOne({
      where: { id: originalMessage.chatId },
      relations: ['participants'],
    });

    if (!originalChat) {
      throw new NotFoundException('Original chat not found');
    }

    const hasAccessToOriginal = originalChat.participants.some(p => p.id === userId);
    if (!hasAccessToOriginal) {
      throw new ConflictException('User does not have access to original message');
    }

    // Verify user has access to target chat
    const targetChat = await this.chatRepository.findOne({
      where: { id: toChatId },
      relations: ['participants'],
    });

    if (!targetChat) {
      throw new NotFoundException('Target chat not found');
    }

    const hasAccessToTarget = targetChat.participants.some(p => p.id === userId);
    if (!hasAccessToTarget) {
      throw new ConflictException('User is not a participant of target chat');
    }

    // Create forwarded message content
    let forwardedContent = originalMessage.content;
    if (additionalContent) {
      forwardedContent = `${additionalContent}\n\n--- Forwarded message ---\n${originalMessage.content}`;
    }

    // Create new message as forwarded
    const forwardedMessage = this.messageRepository.create({
      id: uuidv4(),
      chatId: toChatId,
      senderId: userId,
      content: forwardedContent,
      status: MessageDeliveryStatus.SENT,
      isForwarded: true,
      forwardedFromId: originalMessage.id,
      originalSenderId: originalMessage.senderId,
      createdAt: new Date(),
    });

    const savedMessage = await this.messageRepository.save(forwardedMessage);

    console.log('=== Message Forwarded ===', {
      newMessageId: savedMessage.id,
      originalMessageId: messageId,
      toChatId,
      forwardedBy: userId,
    });

    return {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      content: savedMessage.content,
      status: savedMessage.status,
      createdAt: savedMessage.createdAt,
      isForwarded: savedMessage.isForwarded,
      forwardedFromId: savedMessage.forwardedFromId,
      originalSenderId: savedMessage.originalSenderId,
    };
  }

  async forwardMultipleMessages(
    messageIds: string[],
    toChatId: string,
    userId: string
  ): Promise<ChatMessage[]> {
    console.log('=== Forwarding Multiple Messages ===', {
      messageCount: messageIds.length,
      toChatId,
      userId,
    });

    const forwardedMessages: ChatMessage[] = [];

    for (const messageId of messageIds) {
      try {
        const forwarded = await this.forwardMessage(messageId, toChatId, userId);
        forwardedMessages.push(forwarded);
      } catch (error) {
        console.error(`Failed to forward message ${messageId}:`, error);
      }
    }

    console.log('=== Multiple Messages Forwarded ===', {
      requestedCount: messageIds.length,
      forwardedCount: forwardedMessages.length,
    });

    return forwardedMessages;
  }
}

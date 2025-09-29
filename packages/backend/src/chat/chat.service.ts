import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat as ChatEntity } from './entities/chat.entity';
import { Message as MessageEntity } from './entities/message.entity';
import { Reaction as ReactionEntity } from './entities/reaction.entity';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';
import { User } from '../user/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';
import { In } from 'typeorm';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChatService {
  private readonly maxPinnedMessages: number;

  constructor(
    @InjectRepository(ChatEntity)
    private readonly chatRepository: Repository<ChatEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(ReactionEntity)
    private readonly reactionRepository: Repository<ReactionEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    this.maxPinnedMessages = this.configService.get<number>('MAX_PINNED_MESSAGES', 10);
  }

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

  async getChatMessages(chatId: string, userId?: string): Promise<ChatMessage[]> {
    const messages = await this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });

    // Filter out messages deleted for this specific user
    const filteredMessages = userId
      ? messages.filter(m => !m.deletedFor || !m.deletedFor.includes(userId))
      : messages;

    return filteredMessages.map(message => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      isEdited: message.isEdited,
      editedAt: message.editedAt,
      isDeleted: message.isDeleted,
      deletedAt: message.deletedAt,
      deletedBy: message.deletedBy,
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

    // Check maximum pinned messages limit
    const pinnedCount = await this.messageRepository.count({
      where: {
        chatId: message.chatId,
        isPinned: true
      }
    });

    if (pinnedCount >= this.maxPinnedMessages) {
      throw new ConflictException(`Maximum number of pinned messages (${this.maxPinnedMessages}) reached. Please unpin a message before pinning a new one.`);
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

  async editMessage(
    messageId: string,
    userId: string,
    newContent: string
  ): Promise<ChatMessage> {
    console.log('=== Editing Message ===', { messageId, userId });

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if message is already deleted
    if (message.isDeleted) {
      throw new ConflictException('Cannot edit a deleted message');
    }

    // Check if user is the sender
    if (message.senderId !== userId) {
      throw new ConflictException('You can only edit your own messages');
    }

    // Check time limit (5 minutes)
    const editTimeLimit = 5 * 60 * 1000; // 5 minutes in milliseconds
    const messageAge = Date.now() - message.createdAt.getTime();
    if (messageAge > editTimeLimit) {
      throw new ConflictException('Edit time limit exceeded (5 minutes)');
    }

    // Save edit history
    const editHistoryEntry = {
      content: message.content,
      editedAt: new Date(),
      editedBy: userId,
    };

    if (!message.editHistory) {
      message.editHistory = [];
    }
    message.editHistory.push(editHistoryEntry);

    // Update message
    message.content = newContent;
    message.isEdited = true;
    message.editedAt = new Date();

    const savedMessage = await this.messageRepository.save(message);

    console.log('=== Message Edited ===', {
      messageId: savedMessage.id,
      editedAt: savedMessage.editedAt,
    });

    return {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      content: savedMessage.content,
      status: savedMessage.status,
      createdAt: savedMessage.createdAt,
      isEdited: savedMessage.isEdited,
      editedAt: savedMessage.editedAt,
      editHistory: savedMessage.editHistory,
    };
  }

  async deleteMessageForSelf(
    messageId: string,
    userId: string
  ): Promise<void> {
    console.log('=== Deleting Message for Self ===', { messageId, userId });

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is participant
    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    // Add user to deletedFor array
    if (!message.deletedFor) {
      message.deletedFor = [];
    }

    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
      await this.messageRepository.save(message);
    }

    console.log('=== Message Deleted for Self ===', {
      messageId,
      deletedForUser: userId,
    });
  }

  async deleteMessageForEveryone(
    messageId: string,
    userId: string
  ): Promise<ChatMessage> {
    console.log('=== Deleting Message for Everyone ===', { messageId, userId });

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if already deleted
    if (message.isDeleted) {
      throw new ConflictException('Message is already deleted');
    }

    // Check if user is the sender
    if (message.senderId !== userId) {
      throw new ConflictException('You can only delete your own messages for everyone');
    }

    // Check time limit (10 minutes)
    const deleteTimeLimit = 10 * 60 * 1000; // 10 minutes in milliseconds
    const messageAge = Date.now() - message.createdAt.getTime();
    if (messageAge > deleteTimeLimit) {
      throw new ConflictException('Delete time limit exceeded (10 minutes)');
    }

    // Mark as deleted
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = userId;
    message.content = 'This message has been deleted';

    const savedMessage = await this.messageRepository.save(message);

    console.log('=== Message Deleted for Everyone ===', {
      messageId: savedMessage.id,
      deletedAt: savedMessage.deletedAt,
    });

    return {
      id: savedMessage.id,
      chatId: savedMessage.chatId,
      senderId: savedMessage.senderId,
      content: savedMessage.content,
      status: savedMessage.status,
      createdAt: savedMessage.createdAt,
      isDeleted: savedMessage.isDeleted,
      deletedAt: savedMessage.deletedAt,
      deletedBy: savedMessage.deletedBy,
    };
  }

  async getMessageEditHistory(
    messageId: string,
    userId: string
  ): Promise<any[]> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is participant
    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    return message.editHistory || [];
  }

  async searchMessages(
    userId: string,
    searchParams: {
      query?: string;
      senderId?: string;
      chatId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<{
    messages: ChatMessage[];
    total: number;
    hasMore: boolean;
  }> {
    console.log('=== Searching Messages ===', { userId, searchParams });

    const {
      query,
      senderId,
      chatId,
      startDate,
      endDate,
      limit = 20,
      offset = 0,
    } = searchParams;

    // Build query
    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.chat', 'chat')
      .leftJoinAndSelect('chat.participants', 'participant')
      .where('participant.id = :userId', { userId })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false });

    // Add search conditions
    if (query) {
      queryBuilder.andWhere('LOWER(message.content) LIKE LOWER(:query)', {
        query: `%${query}%`,
      });
    }

    if (senderId) {
      queryBuilder.andWhere('message.senderId = :senderId', { senderId });
    }

    if (chatId) {
      queryBuilder.andWhere('message.chatId = :chatId', { chatId });
    }

    if (startDate) {
      queryBuilder.andWhere('message.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('message.createdAt <= :endDate', { endDate });
    }

    // Exclude messages deleted for this user
    queryBuilder.andWhere(
      '(message.deletedFor IS NULL OR NOT message.deletedFor @> :userIdArray)',
      { userIdArray: [userId] }
    );

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder
      .orderBy('message.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    const messages = await queryBuilder.getMany();

    console.log('=== Search Results ===', {
      found: messages.length,
      total,
      offset,
      limit,
    });

    return {
      messages: messages.map(message => ({
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
        isEdited: message.isEdited,
        editedAt: message.editedAt,
        highlightedContent: query
          ? this.highlightSearchTerms(message.content, query)
          : undefined,
      })),
      total,
      hasMore: offset + limit < total,
    };
  }

  async searchMessagesInChat(
    chatId: string,
    userId: string,
    query: string,
    options?: {
      limit?: number;
      beforeMessageId?: string;
      afterMessageId?: string;
    }
  ): Promise<{
    messages: ChatMessage[];
    total: number;
  }> {
    console.log('=== Searching Messages in Chat ===', {
      chatId,
      userId,
      query,
      options,
    });

    // Verify user is participant
    const chat = await this.chatRepository.findOne({
      where: { id: chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    const { limit = 20, beforeMessageId, afterMessageId } = options || {};

    // Build query
    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .where('message.chatId = :chatId', { chatId })
      .andWhere('LOWER(message.content) LIKE LOWER(:query)', {
        query: `%${query}%`,
      })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere(
        '(message.deletedFor IS NULL OR NOT message.deletedFor @> :userIdArray)',
        { userIdArray: [userId] }
      );

    // Handle context navigation
    if (beforeMessageId) {
      const beforeMessage = await this.messageRepository.findOne({
        where: { id: beforeMessageId },
      });
      if (beforeMessage) {
        queryBuilder.andWhere('message.createdAt < :beforeDate', {
          beforeDate: beforeMessage.createdAt,
        });
      }
    }

    if (afterMessageId) {
      const afterMessage = await this.messageRepository.findOne({
        where: { id: afterMessageId },
      });
      if (afterMessage) {
        queryBuilder.andWhere('message.createdAt > :afterDate', {
          afterDate: afterMessage.createdAt,
        });
      }
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder
      .orderBy('message.createdAt', afterMessageId ? 'ASC' : 'DESC')
      .take(limit);

    const messages = await queryBuilder.getMany();

    // Reverse if we were searching forward
    if (afterMessageId) {
      messages.reverse();
    }

    console.log('=== Chat Search Results ===', {
      found: messages.length,
      total,
      chatId,
    });

    return {
      messages: messages.map(message => ({
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
        isEdited: message.isEdited,
        editedAt: message.editedAt,
        highlightedContent: this.highlightSearchTerms(message.content, query),
      })),
      total,
    };
  }

  async getMessageContext(
    messageId: string,
    userId: string,
    contextSize: number = 10
  ): Promise<{
    targetMessage: ChatMessage;
    beforeMessages: ChatMessage[];
    afterMessages: ChatMessage[];
  }> {
    console.log('=== Getting Message Context ===', {
      messageId,
      userId,
      contextSize,
    });

    const targetMessage = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!targetMessage) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is participant
    const chat = await this.chatRepository.findOne({
      where: { id: targetMessage.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    // Get messages before
    const beforeMessages = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.chatId = :chatId', { chatId: targetMessage.chatId })
      .andWhere('message.createdAt < :targetDate', {
        targetDate: targetMessage.createdAt,
      })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere(
        '(message.deletedFor IS NULL OR NOT message.deletedFor @> :userIdArray)',
        { userIdArray: [userId] }
      )
      .orderBy('message.createdAt', 'DESC')
      .take(contextSize)
      .getMany();

    // Get messages after
    const afterMessages = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.chatId = :chatId', { chatId: targetMessage.chatId })
      .andWhere('message.createdAt > :targetDate', {
        targetDate: targetMessage.createdAt,
      })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere(
        '(message.deletedFor IS NULL OR NOT message.deletedFor @> :userIdArray)',
        { userIdArray: [userId] }
      )
      .orderBy('message.createdAt', 'ASC')
      .take(contextSize)
      .getMany();

    // Reverse beforeMessages to get chronological order
    beforeMessages.reverse();

    const formatMessage = (message: MessageEntity): ChatMessage => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      isEdited: message.isEdited,
      editedAt: message.editedAt,
    });

    return {
      targetMessage: formatMessage(targetMessage),
      beforeMessages: beforeMessages.map(formatMessage),
      afterMessages: afterMessages.map(formatMessage),
    };
  }

  private highlightSearchTerms(content: string, query: string): string {
    // Simple highlight implementation - wraps matched terms with markers
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return content.replace(regex, '<<HIGHLIGHT>>$1<</HIGHLIGHT>>');
  }

  async addReaction(
    messageId: string,
    userId: string,
    emoji: string,
    isCustom: boolean = false
  ): Promise<any> {
    console.log('=== Adding Reaction ===', { messageId, userId, emoji, isCustom });

    // Verify message exists
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['chat', 'chat.participants'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is participant
    const chat = await this.chatRepository.findOne({
      where: { id: message.chatId },
      relations: ['participants'],
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isParticipant = chat.participants.some(p => p.id === userId);
    if (!isParticipant) {
      throw new ConflictException('User is not a participant of this chat');
    }

    // Check if user already reacted with this emoji
    const existingReaction = await this.reactionRepository.findOne({
      where: {
        messageId,
        userId,
        emoji,
      },
    });

    if (existingReaction) {
      throw new ConflictException('You have already reacted with this emoji');
    }

    // Create new reaction
    const reaction = this.reactionRepository.create({
      messageId,
      userId,
      emoji,
      isCustom,
    });

    const savedReaction = await this.reactionRepository.save(reaction);

    console.log('=== Reaction Added ===', {
      reactionId: savedReaction.id,
      messageId,
      userId,
      emoji,
    });

    return savedReaction;
  }

  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<void> {
    console.log('=== Removing Reaction ===', { messageId, userId, emoji });

    // Find the reaction
    const reaction = await this.reactionRepository.findOne({
      where: {
        messageId,
        userId,
        emoji,
      },
    });

    if (!reaction) {
      throw new NotFoundException('Reaction not found');
    }

    await this.reactionRepository.remove(reaction);

    console.log('=== Reaction Removed ===', {
      messageId,
      userId,
      emoji,
    });
  }

  async getMessageReactions(messageId: string): Promise<any[]> {
    const reactions = await this.reactionRepository.find({
      where: { messageId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    // Group reactions by emoji
    const groupedReactions = reactions.reduce((acc: any, reaction) => {
      const key = reaction.emoji;
      if (!acc[key]) {
        acc[key] = {
          emoji: reaction.emoji,
          isCustom: reaction.isCustom,
          count: 0,
          users: [],
        };
      }
      acc[key].count++;
      acc[key].users.push({
        userId: reaction.userId,
        userName: reaction.user?.name,
      });
      return acc;
    }, {});

    return Object.values(groupedReactions);
  }

  async getUserReactionStats(userId: string): Promise<{
    mostUsedEmojis: Array<{ emoji: string; count: number }>;
    totalReactions: number;
    recentReactions: Array<{ emoji: string; messageId: string; createdAt: Date }>;
  }> {
    // Get all reactions by user
    const reactions = await this.reactionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    // Calculate most used emojis
    const emojiCounts = reactions.reduce((acc: any, reaction) => {
      acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
      return acc;
    }, {});

    const mostUsedEmojis = Object.entries(emojiCounts)
      .map(([emoji, count]) => ({ emoji, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 most used emojis

    // Get recent reactions
    const recentReactions = reactions.slice(0, 20).map(r => ({
      emoji: r.emoji,
      messageId: r.messageId,
      createdAt: r.createdAt,
    }));

    return {
      mostUsedEmojis,
      totalReactions: reactions.length,
      recentReactions,
    };
  }

  async getChatReactionStats(chatId: string): Promise<{
    topEmojis: Array<{ emoji: string; count: number }>;
    totalReactions: number;
  }> {
    // Get all reactions in chat
    const reactions = await this.reactionRepository
      .createQueryBuilder('reaction')
      .innerJoin('reaction.message', 'message')
      .where('message.chatId = :chatId', { chatId })
      .getMany();

    // Calculate top emojis
    const emojiCounts = reactions.reduce((acc: any, reaction) => {
      acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
      return acc;
    }, {});

    const topEmojis = Object.entries(emojiCounts)
      .map(([emoji, count]) => ({ emoji, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 emojis in chat

    return {
      topEmojis,
      totalReactions: reactions.length,
    };
  }
}

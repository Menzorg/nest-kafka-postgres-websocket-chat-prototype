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
      .innerJoinAndSelect('chat.participants', 'participant')
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

    return {
      id: savedChat.id,
      participants: savedChat.participants.map(p => p.id),
      messages: [],
      createdAt: savedChat.createdAt,
      updatedAt: savedChat.updatedAt
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
    // Сначала находим ID чата, в котором участвуют оба пользователя
    const chatQuery = await this.chatRepository
      .createQueryBuilder('chat')
      .select('chat.id')
      .innerJoin('chat.participants', 'participant')
      .where('participant.id IN (:...userIds)', { userIds: [userId1, userId2] })
      .groupBy('chat.id')
      .having('COUNT(DISTINCT participant.id) = 2')
      .getOne();

    if (!chatQuery) {
      return undefined;
    }

    // Затем загружаем полные данные чата
    const chat = await this.chatRepository.findOne({
      where: { id: chatQuery.id },
      relations: ['participants', 'messages'],
    });

    if (!chat) {
      return undefined;
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

  async saveMessage(messageDto: ChatMessage): Promise<ChatMessage> {
    const chat = await this.chatRepository.findOneBy({ id: messageDto.chatId });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const sender = await this.userRepository.findOneBy({ id: messageDto.senderId });
    if (!sender) {
      throw new NotFoundException('Sender not found');
    }

    // Используем переданный ID сообщения
    const message = this.messageRepository.create({
      id: messageDto.id,
      chatId: messageDto.chatId,
      senderId: messageDto.senderId,
      content: messageDto.content,
      status: MessageDeliveryStatus.SENT,
      createdAt: messageDto.createdAt || new Date(),
    });

    const savedMessage = await this.messageRepository.save(message);

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
}

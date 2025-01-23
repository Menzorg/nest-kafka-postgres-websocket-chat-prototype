import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat as ChatEntity } from './entities/chat.entity';
import { Message as MessageEntity } from './entities/message.entity';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';
import { User } from '../user/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';

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
    // Проверяем, нет ли уже чата между этими пользователями
    const existingChat = await this.findChatByParticipants(userId1, userId2);
    if (existingChat) {
      throw new ConflictException('Chat already exists between these users');
    }

    // Получаем пользователей
    const [user1, user2] = await Promise.all([
      this.userRepository.findOneBy({ id: userId1 }),
      this.userRepository.findOneBy({ id: userId2 }),
    ]);

    if (!user1 || !user2) {
      throw new NotFoundException('One or both users not found');
    }

    // Создаем новый чат
    const chat = this.chatRepository.create({
      id: uuidv4(),
      participants: [user1, user2],
    });

    await this.chatRepository.save(chat);

    return {
      id: chat.id,
      participants: [userId1, userId2],
      messages: [],
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
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
    const chats = await this.chatRepository
      .createQueryBuilder('chat')
      .leftJoinAndSelect('chat.participants', 'participant')
      .leftJoinAndSelect('chat.messages', 'message')
      .where('participant.id = :userId', { userId })
      .getMany();

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

  async saveMessage(message: ChatMessage): Promise<ChatMessage> {
    const chat = await this.chatRepository.findOneBy({ id: message.chatId });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const sender = await this.userRepository.findOneBy({ id: message.senderId });
    if (!sender) {
      throw new NotFoundException('Sender not found');
    }

    const newMessage = this.messageRepository.create({
      id: message.id,
      content: message.content,
      chatId: chat.id,
      senderId: sender.id,
      status: message.status,
      createdAt: message.createdAt,
    });

    await this.messageRepository.save(newMessage);
    return message;
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

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
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

    if (!chat || !chat.participants.some(p => p.id === userId)) {
      throw new Error('User is not a participant of this chat');
    }

    message.status = MessageDeliveryStatus.READ;
    await this.messageRepository.save(message);
  }

  async getUndeliveredMessages(userId: string): Promise<ChatMessage[]> {
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.chat', 'chat')
      .leftJoinAndSelect('chat.participants', 'participant')
      .where('participant.id = :userId', { userId })
      .andWhere('message.status = :status', { status: MessageDeliveryStatus.SENT })
      .andWhere('message.senderId != :userId', { userId })
      .getMany();

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

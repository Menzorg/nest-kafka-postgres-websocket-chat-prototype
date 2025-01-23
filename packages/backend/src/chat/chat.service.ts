import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Chat, ChatMessage, MessageDeliveryStatus } from '@webchat/common';

@Injectable()
export class ChatService {
  private chats: Chat[] = [];
  private messages: ChatMessage[] = [];
  private undeliveredMessages: Map<string, ChatMessage[]> = new Map();

  async createChat(userId1: string, userId2: string): Promise<Chat> {
    // Проверяем, нет ли уже чата между этими пользователями
    const existingChat = await this.findChatByParticipants(userId1, userId2);
    if (existingChat) {
      throw new ConflictException('Chat already exists between these users');
    }

    const chat: Chat = {
      id: Date.now().toString(),
      participants: [userId1, userId2],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.chats.push(chat);
    return chat;
  }

  async getChat(chatId: string): Promise<Chat> {
    const chat = this.chats.find(c => c.id === chatId);
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    return chat;
  }

  async getUserChats(userId: string): Promise<Chat[]> {
    return this.chats.filter(chat => chat.participants.includes(userId));
  }

  async findChatByParticipants(userId1: string, userId2: string): Promise<Chat | undefined> {
    return this.chats.find(chat => 
      chat.participants.includes(userId1) && 
      chat.participants.includes(userId2)
    );
  }

  async saveMessage(message: ChatMessage): Promise<ChatMessage> {
    // Проверяем существование чата
    await this.getChat(message.chatId);
    
    this.messages.push(message);
    return message;
  }

  async getMessage(messageId: string): Promise<ChatMessage | undefined> {
    return this.messages.find(m => m.id === messageId);
  }

  async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    return this.messages.filter(m => m.chatId === chatId);
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    const message = await this.getMessage(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const chat = await this.getChat(message.chatId);
    if (!chat.participants.includes(userId)) {
      throw new Error('User is not a participant of this chat');
    }
  }

  async getUndeliveredMessages(userId: string): Promise<ChatMessage[]> {
    return this.undeliveredMessages.get(userId) || [];
  }
}

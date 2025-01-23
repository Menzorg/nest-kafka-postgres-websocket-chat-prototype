import { MessageDeliveryStatus } from './message';

export interface Chat {
  id: string;
  participants: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  status: MessageDeliveryStatus;
  createdAt: Date;
}

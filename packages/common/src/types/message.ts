export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  timestamp: Date;
  status: MessageDeliveryStatus;
}

export interface MessageStatus {
  messageId: string;
  senderId: string;
  status: MessageDeliveryStatus;
}

export enum MessageDeliveryStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
}

export interface MessageEvent {
  type: MessageEventType;
  payload: Message;
}

export enum MessageEventType {
  NEW = 'message:new',
  ACK = 'message:ack',
  ERROR = 'message:error'
}

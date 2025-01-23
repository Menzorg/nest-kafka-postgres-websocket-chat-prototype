import { Entity, Column, PrimaryColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Chat } from './chat.entity';
import { MessageDeliveryStatus } from '@webchat/common';

@Entity('messages')
export class Message {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text')
  content: string;

  @Column('uuid')
  senderId: string;

  @Column('uuid')
  chatId: string;

  @Column({
    type: 'enum',
    enum: MessageDeliveryStatus,
    default: MessageDeliveryStatus.SENT
  })
  status: MessageDeliveryStatus;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Chat, chat => chat.messages)
  @JoinColumn({ name: 'chatId' })
  chat: Chat;
}

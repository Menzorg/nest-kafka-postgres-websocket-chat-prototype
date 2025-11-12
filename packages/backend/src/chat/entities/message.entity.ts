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

  // Pinning fields
  @Column({ default: false })
  isPinned: boolean;

  @Column({ type: 'timestamp', nullable: true })
  pinnedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  pinnedBy: string | null;

  // Forwarding fields
  @Column({ default: false })
  isForwarded: boolean;

  @Column({ type: 'uuid', nullable: true })
  forwardedFromId: string | null;

  @Column({ type: 'uuid', nullable: true })
  originalSenderId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  // Edit fields
  @Column({ default: false })
  isEdited: boolean;

  @Column({ type: 'timestamp', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  originalContent: string | null;

  // Delete fields
  @Column({ default: false })
  isDeleted: boolean;

  @Column({ default: false })
  isDeletedForEveryone: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy: string | null;

  @ManyToOne(() => Chat, chat => chat.messages)
  @JoinColumn({ name: 'chatId' })
  chat: Chat;

  @ManyToOne(() => Message, { nullable: true })
  @JoinColumn({ name: 'forwardedFromId' })
  forwardedFrom: Message | null;
}

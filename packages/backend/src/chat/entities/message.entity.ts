import { Entity, Column, PrimaryColumn, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Chat } from './chat.entity';
import { Reaction } from './reaction.entity';
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

  // Editing fields
  @Column({ default: false })
  isEdited: boolean;

  @Column({ type: 'timestamp', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  editHistory: Array<{
    content: string;
    editedAt: Date;
    editedBy: string;
  }>;

  // Deletion fields
  @Column({ default: false })
  isDeleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy: string | null;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  deletedFor: string[]; // Array of user IDs who deleted the message for themselves

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Chat, chat => chat.messages)
  @JoinColumn({ name: 'chatId' })
  chat: Chat;

  @ManyToOne(() => Message, { nullable: true })
  @JoinColumn({ name: 'forwardedFromId' })
  forwardedFrom: Message | null;

  @OneToMany(() => Reaction, reaction => reaction.message)
  reactions: Reaction[];
}

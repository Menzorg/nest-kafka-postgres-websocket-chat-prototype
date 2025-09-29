import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../../user/entities/user.entity';

@Entity('reactions')
@Index(['messageId', 'userId', 'emoji'], { unique: true }) // One reaction per emoji per user per message
export class Reaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  messageId: string;

  @Column('uuid')
  userId: string;

  @Column('varchar', { length: 100 })
  emoji: string; // Can be emoji unicode or custom emoji identifier

  @Column({ default: false })
  isCustom: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Message, message => message.reactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message: Message;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
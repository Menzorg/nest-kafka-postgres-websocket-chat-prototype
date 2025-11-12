import { Entity, PrimaryColumn, ManyToMany, OneToMany, CreateDateColumn, UpdateDateColumn, JoinTable, Column } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Message } from './message.entity';

@Entity('chats')
export class Chat {
  @PrimaryColumn('uuid')
  id: string;

  @ManyToMany(() => User)
  @JoinTable({
    name: 'chat_participants',
    joinColumn: {
      name: 'chatId',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'userId',
      referencedColumnName: 'id',
    },
  })
  participants: User[];

  @OneToMany(() => Message, message => message.chat)
  messages: Message[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'int', default: 10 })
  maxPinnedMessages: number;
}

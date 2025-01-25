import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToMany, OneToMany, BeforeInsert } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Chat } from '../../chat/entities/chat.entity';
import { Message } from '../../chat/entities/message.entity';
import * as bcrypt from 'bcrypt';

@Entity()
export class User {
  @ApiProperty({
    description: 'Unique identifier of the user',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Email address of the user',
    example: 'user@example.com'
  })
  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @BeforeInsert()
  async hashPassword() {
    console.log('=== Hashing password ===');
    console.log('Original password:', this.password);
    this.password = await bcrypt.hash(this.password, 10);
    console.log('Hashed password:', this.password);
  }

  @ApiProperty({
    description: 'Display name of the user',
    example: 'John Doe'
  })
  @Column()
  name: string;

  // Виртуальное свойство для обратной совместимости
  @ApiProperty({
    description: 'Username of the user (same as name)',
    example: 'John Doe'
  })
  get username(): string {
    return this.name;
  }

  @ApiProperty({
    description: 'Whether the user is currently online',
    example: true
  })
  @Column({ default: false })
  isOnline: boolean;

  @ApiProperty({
    description: 'When the user was created',
    example: '2025-01-23T12:50:49.167Z'
  })
  @CreateDateColumn()
  createdAt: Date;

  @ManyToMany(() => Chat, chat => chat.participants)
  chats: Chat[];

  @OneToMany(() => Message, message => message.senderId)
  sentMessages: Message[];

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }
}

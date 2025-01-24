import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegisterDto } from '@webchat/common';
import { User } from './entities/user.entity';

export interface UserStatus {
  userId: string;
  isOnline: boolean;
  lastSeen: Date;
}

@Injectable()
export class UserService {
  private userStatuses: Map<string, UserStatus> = new Map();
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(dto: RegisterDto & { password: string }) {
    this.logger.log('=== Creating new user ===');
    this.logger.log('Email:', dto.email);
    
    const existingUser = await this.findByEmail(dto.email);
    if (existingUser) {
      this.logger.error('User with this email already exists');
      throw new ConflictException('User with this email already exists');
    }

    const user = this.userRepository.create({
      ...dto,
    });

    await this.userRepository.save(user);
    this.updateUserStatus(user.id, true);
    this.logger.log('User created successfully:', user.id);
    return user;
  }

  async findByEmail(email: string) {
    this.logger.log('=== Finding user by email ===');
    this.logger.log('Email:', email);
    
    try {
      const user = await this.userRepository.findOne({ where: { email } });
      this.logger.log('User found:', !!user);
      return user;
    } catch (error) {
      this.logger.error('Error finding user by email');
      this.logger.error('Error:', error.message);
      this.logger.error('Stack:', error.stack);
      throw error;
    }
  }

  async findById(id: string) {
    try {
      this.logger.log(`=== Finding user by ID: ${id || 'undefined'} ===`);

      if (!id) {
        this.logger.error('Invalid user ID: undefined or null');
        throw new NotFoundException('Invalid user ID');
      }

      const user = await this.userRepository.findOne({ where: { id } });
      this.logger.log(`User found: ${user ? 'yes' : 'no'}`);
      
      if (!user) {
        this.logger.error(`User not found for ID: ${id}`);
        throw new NotFoundException('User not found');
      }
      
      return user;
    } catch (error) {
      this.logger.error(`Error finding user by ID: ${id || 'undefined'}`);
      this.logger.error(`Error message: ${error.message}`);
      if (error.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      throw error;
    }
  }

  async findAll() {
    this.logger.log('=== Finding all users ===');
    
    try {
      const users = await this.userRepository.find();
      this.logger.log('Users found:', users.length);
      
      return users.map(user => ({
        ...user,
        status: this.userStatuses.get(user.id) || {
          isOnline: false,
          lastSeen: user.createdAt,
        },
      }));
    } catch (error) {
      this.logger.error('Error finding all users');
      this.logger.error('Error:', error.message);
      this.logger.error('Stack:', error.stack);
      throw error;
    }
  }

  updateUserStatus(userId: string, isOnline: boolean) {
    this.logger.log('=== Updating user status ===');
    this.logger.log('User ID:', userId);
    this.logger.log('Is online:', isOnline);
    
    this.userStatuses.set(userId, {
      userId,
      isOnline,
      lastSeen: new Date(),
    });
  }

  async getUserStatus(userId: string): Promise<UserStatus | undefined> {
    this.logger.log('=== Getting user status ===');
    this.logger.log('User ID:', userId);
    
    try {
      return this.userStatuses.get(userId);
    } catch (error) {
      this.logger.error('Error getting user status');
      this.logger.error('Error:', error.message);
      this.logger.error('Stack:', error.stack);
      throw error;
    }
  }

  async remove(id: string) {
    this.logger.log('=== Removing user ===');
    this.logger.log('User ID:', id);
    
    try {
      const user = await this.findById(id);
      await this.userRepository.remove(user);
      this.userStatuses.delete(id);
      this.logger.log('User removed successfully');
    } catch (error) {
      this.logger.error('Error removing user');
      this.logger.error('Error:', error.message);
      this.logger.error('Stack:', error.stack);
      throw error;
    }
  }
}

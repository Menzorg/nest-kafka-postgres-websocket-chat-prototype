import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '../user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Repository } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RegisterDto } from '@webchat/common';

describe('UserService', () => {
  let service: UserService;
  let userRepository: Repository<User>;

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    password: 'hashedpassword',
    name: 'Test User',
    get username() { return this.name; },
    isOnline: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    chats: [],
    sentMessages: [],
    validatePassword: jest.fn(),
    hashPassword: jest.fn(),
  } as Partial<User> as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  describe('create', () => {
    const createUserDto = {
      email: 'test@example.com',
      password: 'password123',
      username: 'Test User', 
    } as RegisterDto & { password: string };

    it('should create a new user', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(userRepository, 'create').mockReturnValue(mockUser);
      jest.spyOn(userRepository, 'save').mockResolvedValue(mockUser);

      const result = await service.create(createUserDto);

      expect(result).toEqual(mockUser);
      expect(userRepository.create).toHaveBeenCalledWith(createUserDto);
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if user with email already exists', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      await expect(service.create(createUserDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      const result = await service.findById(mockUser.id);

      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      const result = await service.findByEmail(mockUser.email);

      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all users with their status', async () => {
      const users = [mockUser];
      jest.spyOn(userRepository, 'find').mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual([
        {
          ...mockUser,
          status: {
            isOnline: false,
            lastSeen: mockUser.createdAt,
          },
        },
      ]);
    });
  });

  describe('updateUserStatus', () => {
    it('should update user status', async () => {
      service.updateUserStatus(mockUser.id, true);

      const status = await service.getUserStatus(mockUser.id);

      expect(status).toBeDefined();
      expect(status?.isOnline).toBe(true);
      expect(status?.userId).toBe(mockUser.id);
      expect(status?.lastSeen).toBeInstanceOf(Date);
    });
  });
});

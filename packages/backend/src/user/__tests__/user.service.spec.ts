import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '../user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Repository } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('UserService', () => {
  let service: UserService;
  let userRepository: Repository<User>;

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashed_password',
    isOnline: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    chats: [],
    sentMessages: [],
    hashPassword: jest.fn(),
    validatePassword: jest.fn(),
    get username() { return this.name; },
  } as unknown as User;

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
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  describe('create', () => {
    it('should create a new user', async () => {
      const dto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'hashed_password',
      };

      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(userRepository, 'create').mockReturnValue(mockUser);
      jest.spyOn(userRepository, 'save').mockResolvedValue(mockUser);

      const result = await service.create(dto);

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(userRepository.create).toHaveBeenCalledWith(dto);
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
    });

    it('should throw ConflictException if user exists', async () => {
      const dto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'hashed_password',
      };

      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
    });
  });

  describe('findById', () => {
    it('should find a user by id', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      const result = await service.findById(mockUser.id);

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if id is empty', async () => {
      await expect(service.findById('')).rejects.toThrow(NotFoundException);
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(userRepository, 'findOne').mockRejectedValue(error);

      await expect(service.findById(mockUser.id)).rejects.toThrow(error);
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

      const result = await service.findByEmail(mockUser.email);

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockUser.email },
      });
    });

    it('should return null if user not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(userRepository, 'findOne').mockRejectedValue(error);

      await expect(service.findByEmail(mockUser.email)).rejects.toThrow(error);
    });
  });

  describe('findAll', () => {
    it('should return an array of users', async () => {
      const mockUsers = [mockUser];
      jest.spyOn(userRepository, 'find').mockResolvedValue(mockUsers);

      const result = await service.findAll();

      expect(result).toEqual(mockUsers.map(user => ({
        ...user,
        status: {
          isOnline: false,
          lastSeen: user.createdAt,
        },
      })));
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(userRepository, 'find').mockRejectedValue(error);

      await expect(service.findAll()).rejects.toThrow(error);
    });
  });

  describe('updateUserStatus', () => {
    it('should update user status', async () => {
      service.updateUserStatus(mockUser.id, true);

      const status = await service.getUserStatus(mockUser.id);
      expect(status).toBeDefined();
      expect(status?.isOnline).toBe(true);
      expect(status?.userId).toBe(mockUser.id);
      expect(status?.lastSeen).toBeDefined();
    });

    it('should update lastSeen timestamp', async () => {
      const before = new Date();
      service.updateUserStatus(mockUser.id, true);
      const after = new Date();

      const status = await service.getUserStatus(mockUser.id);
      expect(status).toBeDefined();
      expect(status?.lastSeen.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(status?.lastSeen.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getUserStatus', () => {
    it('should return undefined for unknown user', async () => {
      const status = await service.getUserStatus('unknown-id');
      expect(status).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove user and their status', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);
      jest.spyOn(userRepository, 'remove').mockResolvedValue(mockUser);

      // Сначала установим статус
      service.updateUserStatus(mockUser.id, true);

      // Проверяем что статус установлен
      let status = await service.getUserStatus(mockUser.id);
      expect(status).toBeDefined();
      expect(status?.isOnline).toBe(true);

      // Удаляем пользователя
      await service.remove(mockUser.id);

      // Проверяем что пользователь удален
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
      expect(userRepository.remove).toHaveBeenCalledWith(mockUser);

      // Проверяем что статус тоже удален
      status = await service.getUserStatus(mockUser.id);
      expect(status).toBeUndefined();
    });

    it('should throw NotFoundException if user not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should handle repository errors', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);
      
      const error = new Error('Database error');
      jest.spyOn(userRepository, 'remove').mockRejectedValue(error);

      await expect(service.remove(mockUser.id)).rejects.toThrow(error);
    });
  });
});
